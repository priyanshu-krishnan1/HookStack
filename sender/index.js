const axios = require('axios');
const crypto = require('crypto');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:4000/webhook';
const SHARED_SECRET = process.env.WEBHOOK_SECRET || 'change-me';
const EVENT_COUNT = Number(process.env.EVENT_COUNT || 1);
const CONCURRENCY = Number(process.env.SENDER_CONCURRENCY || 1);
const EVENT_TYPE = process.env.EVENT_TYPE || 'sample.event.created';

function createEventId() {
  return `evt_${Date.now()}_${crypto.randomUUID()}`;
}

function createPayload(index) {
  const eventType = index % 2 === 0 && process.env.MIXED_EVENT_TYPES === 'true'
    ? 'sample.event.failed'
    : EVENT_TYPE;

  return {
    id: createEventId(),
    type: eventType,
    createdAt: new Date().toISOString(),
    data: {
      entityId: `entity-${1001 + index}`,
      reference: `ref-${1001 + index}`,
      amount: 1000 + index,
      currency: 'USD',
      contactEmail: `user+${index}@example.com`
    }
  };
}

function createSignature(body) {
  return crypto.createHmac('sha256', SHARED_SECRET).update(body).digest('hex');
}

async function sendWebhook(index) {
  const payload = createPayload(index);
  const body = JSON.stringify(payload);
  const signature = createSignature(body);

  try {
    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature
      },
      timeout: 5000
    });

    console.log('[sender] delivered', {
      index,
      eventId: payload.id,
      eventType: payload.type,
      status: response.status
    });

    return { ok: true, eventId: payload.id };
  } catch (error) {
    if (error.response) {
      console.error('[sender] delivery failed', {
        index,
        eventId: payload.id,
        status: error.response.status,
        response: error.response.data
      });

      return { ok: false, eventId: payload.id };
    }

    console.error('[sender] request error', {
      index,
      eventId: payload.id,
      message: error.message
    });

    return { ok: false, eventId: payload.id };
  }
}

async function runBatch() {
  const pending = Array.from({ length: EVENT_COUNT }, (_, index) => index);
  const results = [];

  async function workerLoop() {
    while (pending.length > 0) {
      const index = pending.shift();
      const result = await sendWebhook(index);
      results.push(result);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, () => workerLoop())
  );

  const delivered = results.filter((result) => result.ok).length;
  const failed = results.length - delivered;

  console.log('[sender] batch complete', {
    requested: EVENT_COUNT,
    concurrency: CONCURRENCY,
    delivered,
    failed
  });
}

runBatch();

// Made with Bob
