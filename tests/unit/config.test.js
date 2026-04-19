describe('shared/config', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.PORT;
    delete process.env.MAX_RETRIES;
    delete process.env.RETRY_DELAY_MS;
    delete process.env.WORKER_PREFETCH;
    delete process.env.WEBHOOK_SECRET;
  });

  test('uses defaults when env is not set', () => {
    delete process.env.PORT;
    delete process.env.MAX_RETRIES;
    delete process.env.RETRY_DELAY_MS;
    delete process.env.WORKER_PREFETCH;
    delete process.env.WEBHOOK_SECRET;

    jest.resetModules();
    const config = require('../../shared/config');

    expect(config.app.receiverPort).toBe(4000);
    expect(config.app.maxAttempts).toBe(3);
    expect(config.app.retryDelayMs).toBe(1000);
    expect(config.app.workerPrefetch).toBe(10);
    expect(config.app.webhookSecret).toBe('change-me');
  });

  test('uses env overrides', () => {
    process.env.PORT = '4100';
    process.env.MAX_RETRIES = '5';
    process.env.RETRY_DELAY_MS = '2000';
    process.env.WORKER_PREFETCH = '20';
    process.env.WEBHOOK_SECRET = 'abc123';

    jest.resetModules();
    const config = require('../../shared/config');

    expect(config.app.receiverPort).toBe(4100);
    expect(config.app.maxAttempts).toBe(5);
    expect(config.app.retryDelayMs).toBe(2000);
    expect(config.app.workerPrefetch).toBe(20);
    expect(config.app.webhookSecret).toBe('abc123');
  });
});

// Made with Bob
