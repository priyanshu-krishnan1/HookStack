const crypto = require('crypto');
const express = require('express');
const { app, rabbitmq } = require('../shared/config');
const { withTransaction, query, closePool } = require('../shared/db');
const { connectRabbitMq, publishMessage, closeRabbitMq } = require('../shared/rabbitmq');

function computeSignature(rawBody) {
  return crypto.createHmac('sha256', app.webhookSecret).update(rawBody).digest('hex');
}

function signaturesMatch(receivedSignature, expectedSignature) {
  const receivedBuffer = Buffer.from(receivedSignature || '', 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return 'Invalid JSON payload';
  }

  if (!event.id || !event.type || !event.createdAt) {
    return 'Payload must include id, type, and createdAt';
  }

  return null;
}

async function publishOutboxMessages() {
  const result = await query(
    `SELECT id, event_id, exchange_name, routing_key, payload_json
     FROM outbox_messages
     WHERE published_at IS NULL
     ORDER BY id ASC
     LIMIT 100`
  );

  for (const row of result.rows) {
    await publishMessage(row.payload_json);

    await query(
      `UPDATE outbox_messages
       SET published_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
  }
}

function createReceiverApp() {
  const server = express();
  let isShuttingDown = false;

  server.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
      }
    })
  );

  server.get('/health', async (req, res) => {
    const events = await query('SELECT COUNT(*)::int AS count FROM webhook_events');
    const jobs = await query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE status = 'processed')::int AS processed,
        COUNT(*) FILTER (WHERE status = 'dead-lettered')::int AS dead_lettered
       FROM job_queue`
    );

    res.json({
      status: isShuttingDown ? 'shutting-down' : 'ok',
      events: events.rows[0].count,
      jobs: jobs.rows[0]
    });
  });

  server.get('/events', async (req, res) => {
    const result = await query(
      `SELECT event_id, event_type, status, received_at, processed_at
       FROM webhook_events
       ORDER BY id DESC
       LIMIT 100`
    );

    res.json({
      count: result.rows.length,
      events: result.rows
    });
  });

  server.get('/jobs', async (req, res) => {
    const jobs = await query(
      `SELECT id, event_id, job_type, status, attempt_count, max_attempts, last_error, next_retry_at, created_at, updated_at
       FROM job_queue
       ORDER BY id DESC
       LIMIT 100`
    );

    const deadLetters = await query(
      `SELECT id, event_id, job_id, reason, dead_lettered_at
       FROM dead_letters
       ORDER BY id DESC
       LIMIT 100`
    );

    res.json({
      jobs: jobs.rows,
      deadLetters: deadLetters.rows
    });
  });

  server.post('/webhook', async (req, res) => {
    if (isShuttingDown) {
      return res.status(503).json({ error: 'Receiver is shutting down' });
    }

    const receivedSignature = req.header('x-webhook-signature');

    if (!receivedSignature) {
      return res.status(400).json({ error: 'Missing x-webhook-signature header' });
    }

    const expectedSignature = computeSignature(req.rawBody || '');

    if (!signaturesMatch(receivedSignature, expectedSignature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const validationError = validateEvent(req.body);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    try {
      const result = await withTransaction(async (client) => {
        const existingEvent = await client.query(
          `SELECT event_id, status
           FROM webhook_events
           WHERE event_id = $1`,
          [req.body.id]
        );

        if (existingEvent.rows.length > 0) {
          return {
            duplicate: true,
            eventId: req.body.id,
            status: existingEvent.rows[0].status
          };
        }

        await client.query(
          `INSERT INTO webhook_events (event_id, event_type, payload_json, signature, status)
           VALUES ($1, $2, $3::jsonb, $4, 'received')`,
          [req.body.id, req.body.type, JSON.stringify(req.body), receivedSignature]
        );

        await client.query(
          `INSERT INTO job_queue (event_id, job_type, status, attempt_count, max_attempts, available_at)
           VALUES ($1, $2, 'queued', 0, $3, NOW())`,
          [req.body.id, req.body.type, app.maxAttempts]
        );

        await client.query(
          `INSERT INTO outbox_messages (event_id, exchange_name, routing_key, payload_json)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [
            req.body.id,
            rabbitmq.exchange,
            rabbitmq.routingKey,
            JSON.stringify({ eventId: req.body.id })
          ]
        );

        return {
          duplicate: false,
          eventId: req.body.id
        };
      });

      if (result.duplicate) {
        return res.status(200).json({
          message: 'Duplicate event ignored',
          receivedEventId: result.eventId,
          status: result.status
        });
      }

      await publishOutboxMessages();

      return res.status(202).json({
        message: 'Webhook accepted and durably queued',
        receivedEventId: result.eventId
      });
    } catch (error) {
      console.error('[receiver] failed to persist webhook', error);
      return res.status(500).json({ error: 'Failed to persist webhook' });
    }
  });

  return {
    app: server,
    setShuttingDown(value) {
      isShuttingDown = value;
    }
  };
}

async function startReceiver(options = {}) {
  const port = options.port || app.receiverPort;
  const receiver = createReceiverApp();

  await connectRabbitMq();
  await publishOutboxMessages();

  const httpServer = await new Promise((resolve) => {
    const instance = receiver.app.listen(port, () => {
      console.log(`Receiver listening on http://localhost:${port}`);
      resolve(instance);
    });
  });

  return {
    app: receiver.app,
    httpServer,
    async shutdown() {
      receiver.setShuttingDown(true);

      await new Promise((resolve) => httpServer.close(resolve));
      await closeRabbitMq();
      await closePool();
    }
  };
}

if (require.main === module) {
  let runtime;

  async function shutdown(signal) {
    if (!runtime) {
      return;
    }

    console.log(`[receiver] received ${signal}, shutting down`);
    await runtime.shutdown();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  startReceiver()
    .then((started) => {
      runtime = started;
    })
    .catch(async (error) => {
      console.error('[receiver] startup failed', error);
      await closeRabbitMq();
      await closePool();
      process.exit(1);
    });
}

module.exports = {
  computeSignature,
  publishOutboxMessages,
  createReceiverApp,
  startReceiver
};

// Made with Bob
