const amqp = require('amqplib');
const { rabbitmq } = require('./config');

let connection;
let channel;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRabbitMq(options = {}) {
  const maxAttempts = options.maxAttempts || 10;
  const retryDelayMs = options.retryDelayMs || 1000;

  if (channel) {
    return channel;
  }

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      connection = await amqp.connect(rabbitmq.url);
      channel = await connection.createChannel();

      await channel.assertExchange(rabbitmq.exchange, 'direct', { durable: true });
      await channel.assertExchange(rabbitmq.deadLetterExchange, 'direct', { durable: true });

      await channel.assertQueue(rabbitmq.queue, {
        durable: true,
        deadLetterExchange: rabbitmq.deadLetterExchange
      });

      await channel.assertQueue(rabbitmq.deadLetterQueue, {
        durable: true
      });

      await channel.bindQueue(rabbitmq.queue, rabbitmq.exchange, rabbitmq.routingKey);
      await channel.bindQueue(
        rabbitmq.deadLetterQueue,
        rabbitmq.deadLetterExchange,
        rabbitmq.routingKey
      );

      return channel;
    } catch (error) {
      lastError = error;
      connection = null;
      channel = null;

      if (attempt === maxAttempts) {
        break;
      }

      console.warn('[rabbitmq] connect attempt failed, retrying', {
        attempt,
        maxAttempts,
        message: error.message
      });

      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}

async function publishMessage(payload) {
  const activeChannel = await connectRabbitMq();
  const buffer = Buffer.from(JSON.stringify(payload));

  activeChannel.publish(rabbitmq.exchange, rabbitmq.routingKey, buffer, {
    persistent: true,
    contentType: 'application/json'
  });
}

async function closeRabbitMq() {
  if (channel) {
    await channel.close();
    channel = null;
  }

  if (connection) {
    await connection.close();
    connection = null;
  }
}

module.exports = {
  connectRabbitMq,
  publishMessage,
  closeRabbitMq
};

// Made with Bob
