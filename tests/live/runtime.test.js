const crypto = require('crypto');
const { execSync } = require('child_process');
const { Pool } = require('pg');

const TEST_TIMEOUT_MS = 120000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_user:app_password@localhost:5432/app_db';
const RECEIVER_PORT = Number(process.env.PORT || 4100);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me';

let receiverRuntime;
let workerRuntime;
let pool;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensurePodmanAvailable() {
  try {
    execSync('podman info', { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      'Podman is installed but not running. Start it first with `podman machine start` (or initialize it with `podman machine init` once), then rerun `npm run test:live`.'
    );
  }
}

function runCompose(args, options = {}) {
  return execSync(`podman-compose ${args}`, {
    stdio: options.quiet ? 'ignore' : 'inherit'
  });
}

async function waitFor(check, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const intervalMs = options.intervalMs || 500;
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function signPayload(payload) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

  return { body, signature };
}

function createPayload(overrides = {}) {
  return {
    id: `evt_test_${Date.now()}_${crypto.randomUUID()}`,
    type: 'sample.event.created',
    createdAt: new Date().toISOString(),
    data: {
      entityId: `entity-${Date.now()}`,
      reference: `ref-${Date.now()}`,
      amount: 1000,
      currency: 'USD',
      contactEmail: 'template-test@example.com'
    },
    ...overrides
  };
}

async function sendWebhook(payload) {
  const { body, signature } = signPayload(payload);
  const response = await fetch(`http://127.0.0.1:${RECEIVER_PORT}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': signature
    },
    body
  });

  const json = await response.json();
  return { status: response.status, json };
}

async function resetDatabase() {
  await pool.query(
    'TRUNCATE TABLE dead_letters, outbox_messages, job_queue, webhook_events RESTART IDENTITY CASCADE'
  );
}

async function getEvent(eventId) {
  const result = await pool.query(
    `SELECT event_id, event_type, status, processed_at
     FROM webhook_events
     WHERE event_id = $1`,
    [eventId]
  );

  return result.rows[0] || null;
}

async function getJob(eventId) {
  const result = await pool.query(
    `SELECT event_id, status, attempt_count, max_attempts, last_error, next_retry_at
     FROM job_queue
     WHERE event_id = $1`,
    [eventId]
  );

  return result.rows[0] || null;
}

async function getOutbox(eventId) {
  const result = await pool.query(
    `SELECT event_id, published_at
     FROM outbox_messages
     WHERE event_id = $1`,
    [eventId]
  );

  return result.rows[0] || null;
}

async function getDeadLetters(eventId) {
  const result = await pool.query(
    `SELECT event_id, reason
     FROM dead_letters
     WHERE event_id = $1`,
    [eventId]
  );

  return result.rows;
}

describe('live runtime webhook flow', () => {
  jest.setTimeout(TEST_TIMEOUT_MS);

  beforeAll(async () => {
    ensurePodmanAvailable();
    runCompose('up -d');

    pool = new Pool({ connectionString: DATABASE_URL });

    await waitFor(
      async () => {
        await pool.query('SELECT 1');
        return true;
      },
      { timeoutMs: 60000, intervalMs: 1000 }
    );

    process.env.PORT = String(RECEIVER_PORT);
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.MAX_RETRIES = '2';
    process.env.RETRY_DELAY_MS = '200';
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://app_user:app_password@localhost:5672';

    await waitFor(
      async () => {
        const amqp = require('amqplib');
        const connection = await amqp.connect(
          process.env.RABBITMQ_URL || 'amqp://app_user:app_password@localhost:5672'
        );
        await connection.close();
        return true;
      },
      { timeoutMs: 60000, intervalMs: 1000 }
    );

    const { startReceiver } = require('../../receiver/index.js');
    const { startWorker } = require('../../worker/index.js');

    receiverRuntime = await startReceiver({ port: RECEIVER_PORT });
    workerRuntime = await startWorker();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    if (workerRuntime) {
      await workerRuntime.shutdown();
    }

    if (receiverRuntime) {
      await receiverRuntime.shutdown();
    }

    if (pool) {
      await pool.end();
    }

    try {
      ensurePodmanAvailable();
      runCompose('down');
    } catch (error) {
      // Ignore teardown infra errors when Podman is unavailable.
    }
  });

  test('accepts a live webhook and processes it end-to-end', async () => {
    const payload = createPayload();

    const response = await sendWebhook(payload);

    expect(response.status).toBe(202);
    expect(response.json.receivedEventId).toBe(payload.id);

    const storedEvent = await waitFor(() => getEvent(payload.id));
    expect(storedEvent.event_type).toBe(payload.type);

    const outbox = await waitFor(async () => {
      const row = await getOutbox(payload.id);
      return row && row.published_at ? row : null;
    });
    expect(outbox.published_at).not.toBeNull();

    const processedJob = await waitFor(
      async () => {
        const job = await getJob(payload.id);
        return job && job.status === 'processed' ? job : null;
      },
      { timeoutMs: 30000, intervalMs: 500 }
    );

    expect(processedJob.attempt_count).toBeGreaterThanOrEqual(1);

    const processedEvent = await waitFor(
      async () => {
        const event = await getEvent(payload.id);
        return event && event.status === 'processed' ? event : null;
      },
      { timeoutMs: 30000, intervalMs: 500 }
    );

    expect(processedEvent.processed_at).not.toBeNull();
  });

  test('stores duplicate webhook only once and returns duplicate response', async () => {
    const payload = createPayload();

    const first = await sendWebhook(payload);
    const second = await sendWebhook(payload);

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.json.message).toBe('Duplicate event ignored');

    await waitFor(async () => {
      const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM webhook_events WHERE event_id = $1',
        [payload.id]
      );

      return result.rows[0].count === 1 ? result.rows[0].count : null;
    });

    const jobCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM job_queue WHERE event_id = $1',
      [payload.id]
    );

    const outboxCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM outbox_messages WHERE event_id = $1',
      [payload.id]
    );

    expect(jobCount.rows[0].count).toBe(1);
    expect(outboxCount.rows[0].count).toBe(1);
  });

  test('rejects invalid signatures without persisting data', async () => {
    const payload = createPayload();
    const response = await fetch(`http://127.0.0.1:${RECEIVER_PORT}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': 'invalid-signature'
      },
      body: JSON.stringify(payload)
    });

    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('Invalid signature');

    await sleep(500);

    const event = await getEvent(payload.id);
    const job = await getJob(payload.id);
    const outbox = await getOutbox(payload.id);

    expect(event).toBeNull();
    expect(job).toBeNull();
    expect(outbox).toBeNull();
  });

  test('processes unsupported event types as completed no-op work', async () => {
    const payload = createPayload({ type: 'sample.event.unknown' });
    const response = await sendWebhook(payload);

    expect(response.status).toBe(202);

    const job = await waitFor(
      async () => {
        const row = await getJob(payload.id);
        return row && row.status === 'processed' ? row : null;
      },
      { timeoutMs: 30000, intervalMs: 500 }
    );

    const event = await waitFor(
      async () => {
        const row = await getEvent(payload.id);
        return row && row.status === 'processed' ? row : null;
      },
      { timeoutMs: 30000, intervalMs: 500 }
    );

    const deadLetters = await getDeadLetters(payload.id);

    expect(job.status).toBe('processed');
    expect(event.status).toBe('processed');
    expect(deadLetters).toHaveLength(0);
  });
});

// Made with Bob
