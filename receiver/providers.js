const crypto = require('crypto');
const { app } = require('../shared/config');

function computeHexSignature(rawBody) {
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

function buildGenericEvent(req) {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return { error: 'Invalid JSON payload' };
  }

  if (!payload.id || !payload.type || !payload.createdAt) {
    return { error: 'Payload must include id, type, and createdAt' };
  }

  return {
    eventId: payload.id,
    eventType: payload.type,
    receivedSignature: req.header('x-webhook-signature'),
    expectedSignature: computeHexSignature(req.rawBody || ''),
    normalizedPayload: payload
  };
}

function buildGitHubEvent(req) {
  const deliveryId = req.header('x-github-delivery');
  const githubEvent = req.header('x-github-event');
  const receivedSignature = req.header('x-hub-signature-256');
  const payload = req.body;

  if (!deliveryId || !githubEvent) {
    return { error: 'Missing GitHub delivery or event headers' };
  }

  if (!payload || typeof payload !== 'object') {
    return { error: 'Invalid JSON payload' };
  }

  const actionSuffix = typeof payload.action === 'string' ? `.${payload.action}` : '';
  const normalizedType = `github.${githubEvent}${actionSuffix}`;

  return {
    eventId: deliveryId,
    eventType: normalizedType,
    receivedSignature,
    expectedSignature: `sha256=${computeHexSignature(req.rawBody || '')}`,
    normalizedPayload: {
      id: deliveryId,
      type: normalizedType,
      createdAt: payload.repository?.updated_at || payload.sender?.updated_at || new Date().toISOString(),
      source: 'github',
      headers: {
        delivery: deliveryId,
        event: githubEvent
      },
      data: payload
    }
  };
}

function getProviderAdapter(provider) {
  if (provider === 'github') {
    return {
      name: 'github',
      signatureHeader: 'x-hub-signature-256',
      parse: buildGitHubEvent
    };
  }

  return {
    name: 'generic',
    signatureHeader: 'x-webhook-signature',
    parse: buildGenericEvent
  };
}

module.exports = {
  computeHexSignature,
  signaturesMatch,
  getProviderAdapter
};

// Made with Bob
