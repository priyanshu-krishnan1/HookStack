const { app, rabbitmq } = require('../shared/config');
const { query, withTransaction, closePool } = require('../shared/db');
const { connectRabbitMq, closeRabbitMq } = require('../shared/rabbitmq');

const workerId = process.env.WORKER_ID || `worker-${process.pid}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processSampleEventCreated(event) {
  console.log('[worker] processing sample.event.created', {
    workerId,
    eventId: event.event_id
  });
}

async function processSampleEventFailed(event) {
  console.log('[worker] processing sample.event.failed', {
    workerId,
    eventId: event.event_id
  });
}

async function processEventBusinessLogic(event) {
  if (event.event_type === 'sample.event.created') {
    await processSampleEventCreated(event);
    return {
      status: 'processed',
      action: 'sample_action_completed'
    };
  }

  if (event.event_type === 'sample.event.failed') {
    await processSampleEventFailed(event);
    return {
      status: 'processed',
      action: 'sample_failure_followup_completed'
    };
  }

  return {
    status: 'ignored',
    reason: `No handler for ${event.event_type}`
  };
}

async function markDeadLetter(job, event, error) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE job_queue
       SET status = 'dead-lettered',
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [job.id, error.message]
    );

    await client.query(
      `INSERT INTO dead_letters (event_id, job_id, reason, payload_json)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [event.event_id, job.id, error.message, JSON.stringify(event.payload_json)]
    );
  });
}

async function retryJob(job, error) {
  const nextRetryAt = new Date(Date.now() + app.retryDelayMs).toISOString();

  await query(
    `UPDATE job_queue
     SET status = 'queued',
         last_error = $2,
         next_retry_at = $3,
         available_at = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [job.id, error.message, nextRetryAt]
  );

  await sleep(app.retryDelayMs);
}

async function loadAndLockJob(eventId) {
  return withTransaction(async (client) => {
    const jobResult = await client.query(
      `SELECT id, event_id, job_type, status, attempt_count, max_attempts
       FROM job_queue
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (jobResult.rows.length === 0) {
      return null;
    }

    const job = jobResult.rows[0];

    if (job.status === 'processed' || job.status === 'dead-lettered') {
      return null;
    }

    const eventResult = await client.query(
      `SELECT event_id, event_type, payload_json
       FROM webhook_events
       WHERE event_id = $1`,
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      return null;
    }

    await client.query(
      `UPDATE job_queue
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [job.id]
    );

    return {
      job,
      event: eventResult.rows[0]
    };
  });
}

async function completeJob(jobId, eventId, processing) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE job_queue
       SET status = 'processed',
           updated_at = NOW(),
           last_error = NULL,
           next_retry_at = NULL
       WHERE id = $1`,
      [jobId]
    );

    await client.query(
      `UPDATE webhook_events
       SET status = 'processed',
           processed_at = NOW()
       WHERE event_id = $1`,
      [eventId]
    );

    console.log('[worker] completed job', {
      workerId,
      jobId,
      eventId,
      processing
    });
  });
}

function createWorkerRuntime() {
  let channel;
  let consumerTag;
  let isShuttingDown = false;

  async function processMessage(message) {
    const payload = JSON.parse(message.content.toString('utf8'));
    const locked = await loadAndLockJob(payload.eventId);

    if (!locked) {
      channel.ack(message);
      return;
    }

    const { job, event } = locked;

    try {
      const processing = await processEventBusinessLogic(event);
      await completeJob(job.id, event.event_id, processing);
      channel.ack(message);
    } catch (error) {
      console.error('[worker] processing failed', {
        workerId,
        eventId: event.event_id,
        message: error.message
      });

      if (job.attempt_count + 1 >= job.max_attempts) {
        await markDeadLetter(job, event, error);
        channel.ack(message);
        return;
      }

      await retryJob(job, error);
      channel.nack(message, false, true);
    }
  }

  return {
    async start() {
      channel = await connectRabbitMq();
      channel.prefetch(app.workerPrefetch);

      const consumeResult = await channel.consume(
        rabbitmq.queue,
        async (message) => {
          if (!message || isShuttingDown) {
            return;
          }

          try {
            await processMessage(message);
          } catch (error) {
            console.error('[worker] unhandled message failure', {
              workerId,
              message: error.message
            });
            channel.nack(message, false, true);
          }
        },
        { noAck: false }
      );

      consumerTag = consumeResult.consumerTag;
      console.log('[worker] listening for messages', { workerId });

      return this;
    },

    async shutdown() {
      if (isShuttingDown) {
        return;
      }

      isShuttingDown = true;

      if (channel && consumerTag) {
        await channel.cancel(consumerTag);
      }

      await closeRabbitMq();
      await closePool();
    }
  };
}

async function startWorker() {
  const runtime = createWorkerRuntime();
  await runtime.start();
  return runtime;
}

if (require.main === module) {
  let runtime;

  async function shutdown(signal) {
    if (!runtime) {
      return;
    }

    console.log(`[worker] received ${signal}, shutting down`, { workerId });
    await runtime.shutdown();
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  startWorker()
    .then((started) => {
      runtime = started;
    })
    .catch(async (error) => {
      console.error('[worker] startup failed', {
        workerId,
        message: error.message
      });
      await closeRabbitMq();
      await closePool();
      process.exit(1);
    });
}

module.exports = {
  processEventBusinessLogic,
  createWorkerRuntime,
  startWorker
};

// Made with Bob
