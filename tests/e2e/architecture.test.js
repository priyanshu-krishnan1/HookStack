const fs = require('fs');
const path = require('path');

describe('production architecture wiring', () => {
  test('receiver persists event, job, and outbox message', () => {
    const receiver = fs.readFileSync(path.join(__dirname, '../../receiver/index.js'), 'utf8');

    expect(receiver).toContain('INSERT INTO webhook_events');
    expect(receiver).toContain('INSERT INTO job_queue');
    expect(receiver).toContain('INSERT INTO outbox_messages');
    expect(receiver).toContain('Webhook accepted and durably queued');
  });

  test('worker processes queue and updates event/job state', () => {
    const worker = fs.readFileSync(path.join(__dirname, '../../worker/index.js'), 'utf8');

    expect(worker).toContain('UPDATE job_queue');
    expect(worker).toContain("SET status = 'processing'");
    expect(worker).toContain("SET status = 'processed'");
    expect(worker).toContain("SET status = 'dead-lettered'");
    expect(worker).toContain('INSERT INTO dead_letters');
  });

  test('shared rabbitmq setup defines exchange and queues', () => {
    const rabbit = fs.readFileSync(path.join(__dirname, '../../shared/rabbitmq.js'), 'utf8');

    expect(rabbit).toContain('assertExchange');
    expect(rabbit).toContain('assertQueue');
    expect(rabbit).toContain('bindQueue');
    expect(rabbit).toContain('persistent: true');
  });
});

// Made with Bob
