const axios = require('axios');
const crypto = require('crypto');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:4000/webhook';
const SHARED_SECRET = process.env.WEBHOOK_SECRET || 'change-me';
const EVENT_COUNT = Number(process.env.EVENT_COUNT || 1);
const CONCURRENCY = Number(process.env.SENDER_CONCURRENCY || 1);
const EVENT_TYPE = process.env.EVENT_TYPE || 'sample.event.created';
const WEBHOOK_PROVIDER = process.env.WEBHOOK_PROVIDER || 'generic';

function createEventId() {
  return `evt_${Date.now()}_${crypto.randomUUID()}`;
}

function createGenericPayload(index) {
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

function createGitHubPayload(index) {
  const isPullRequest = index % 2 === 0 && process.env.MIXED_EVENT_TYPES === 'true';

  if (isPullRequest) {
    return {
      eventName: 'pull_request',
      deliveryId: createEventId(),
      payload: {
        action: 'opened',
        number: 42 + index,
        pull_request: {
          id: 9000 + index,
          number: 42 + index,
          title: `Improve webhook processing ${index}`,
          state: 'open'
        },
        repository: {
          id: 123456,
          name: 'hookstack',
          full_name: 'example/hookstack',
          updated_at: new Date().toISOString()
        },
        sender: {
          login: 'octocat'
        }
      }
    };
  }

  return {
    eventName: 'push',
    deliveryId: createEventId(),
    payload: {
      ref: 'refs/heads/main',
      after: crypto.randomBytes(20).toString('hex'),
      repository: {
        id: 123456,
        name: 'hookstack',
        full_name: 'example/hookstack',
        updated_at: new Date().toISOString()
      },
      pusher: {
        name: 'octocat',
        email: 'octocat@example.com'
      },
      head_commit: {
        id: crypto.randomBytes(20).toString('hex'),
        message: `Template test commit ${index}`
      },
      sender: {
        login: 'octocat'
      }
    }
  };
}

function createRequest(index) {
  if (WEBHOOK_PROVIDER === 'github') {
    return createGitHubPayload(index);
  }

  return {
    payload: createGenericPayload(index)
  };
}

function createSignature(body) {
  return crypto.createHmac('sha256', SHARED_SECRET).update(body).digest('hex');
}

async function sendWebhook(index) {
  const request = createRequest(index);
  const body = JSON.stringify(request.payload);
  const signature = createSignature(body);

  const headers = {
    'Content-Type': 'application/json'
  };

  if (WEBHOOK_PROVIDER === 'github') {
    headers['x-github-event'] = request.eventName;
    headers['x-github-delivery'] = request.deliveryId;
    headers['x-hub-signature-256'] = `sha256=${signature}`;
  } else {
    headers['x-webhook-signature'] = signature;
  }

  try {
    const response = await axios.post(WEBHOOK_URL, request.payload, {
      headers,
      timeout: 5000
    });

    console.log('[sender] delivered', {
      index,
      eventId: request.deliveryId || request.payload.id,
      eventType: request.eventName || request.payload.type,
      provider: WEBHOOK_PROVIDER,
      status: response.status
    });

    return { ok: true, eventId: request.deliveryId || request.payload.id };
  } catch (error) {
    if (error.response) {
      console.error('[sender] delivery failed', {
        index,
        eventId: request.deliveryId || request.payload.id,
        status: error.response.status,
        response: error.response.data
      });

      return { ok: false, eventId: request.deliveryId || request.payload.id };
    }

    console.error('[sender] request error', {
      index,
      eventId: request.deliveryId || request.payload.id,
      message: error.message
    });

    return { ok: false, eventId: request.deliveryId || request.payload.id };
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
    provider: WEBHOOK_PROVIDER,
    requested: EVENT_COUNT,
    concurrency: CONCURRENCY,
    delivered,
    failed
  });
}

runBatch();

// Made with Bob
