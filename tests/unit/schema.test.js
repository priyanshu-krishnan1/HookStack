const fs = require('fs');
const path = require('path');

describe('shared/schema.sql', () => {
  test('contains required production tables', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../shared/schema.sql'), 'utf8');

    expect(schema).toContain('CREATE TABLE IF NOT EXISTS webhook_events');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS job_queue');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS dead_letters');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS outbox_messages');
  });

  test('contains index definitions for queue and outbox', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../shared/schema.sql'), 'utf8');

    expect(schema).toContain('idx_job_queue_status_available_at');
    expect(schema).toContain('idx_outbox_messages_published_at');
  });
});

// Made with Bob
