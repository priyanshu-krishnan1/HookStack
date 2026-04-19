function numberFromEnv(name, fallback) {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

module.exports = {
  app: {
    webhookSecret: process.env.WEBHOOK_SECRET || 'change-me',
    receiverPort: numberFromEnv('PORT', 4000),
    maxAttempts: numberFromEnv('MAX_RETRIES', 3),
    retryDelayMs: numberFromEnv('RETRY_DELAY_MS', 1000),
    workerPrefetch: numberFromEnv('WORKER_PREFETCH', 10)
  },
  db: {
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://app_user:app_password@localhost:5432/app_db'
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://app_user:app_password@localhost:5672',
    exchange: process.env.RABBITMQ_EXCHANGE || 'app.events',
    queue: process.env.RABBITMQ_QUEUE || 'app.events.processing',
    deadLetterExchange: process.env.RABBITMQ_DLX || 'app.events.dlx',
    deadLetterQueue: process.env.RABBITMQ_DLQ || 'app.events.dead',
    routingKey: process.env.RABBITMQ_ROUTING_KEY || 'app.event.process'
  }
};

// Made with Bob
