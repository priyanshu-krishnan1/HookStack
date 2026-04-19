class InMemoryQueue {
  constructor({ concurrency = 2, maxQueued = 100 } = {}) {
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.running = 0;
    this.items = [];
    this.shuttingDown = false;
    this.idleResolvers = [];
  }

  enqueue(task) {
    if (this.shuttingDown) {
      throw new Error('Queue is shutting down');
    }

    if (this.items.length >= this.maxQueued) {
      throw new Error('Queue capacity exceeded');
    }

    return new Promise((resolve, reject) => {
      this.items.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.running < this.concurrency && this.items.length > 0 && !this.shuttingDown) {
      const item = this.items.shift();
      this.running += 1;

      Promise.resolve()
        .then(() => item.task())
        .then((result) => item.resolve(result))
        .catch((error) => item.reject(error))
        .finally(() => {
          this.running -= 1;
          this.resolveIdleIfNeeded();
          this.drain();
        });
    }

    this.resolveIdleIfNeeded();
  }

  markShuttingDown() {
    this.shuttingDown = true;
    this.resolveIdleIfNeeded();
  }

  onIdle() {
    if (this.running === 0 && this.items.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  resolveIdleIfNeeded() {
    if (this.running === 0 && this.items.length === 0) {
      while (this.idleResolvers.length > 0) {
        const resolve = this.idleResolvers.shift();
        resolve();
      }
    }
  }

  getStats() {
    return {
      concurrency: this.concurrency,
      running: this.running,
      queued: this.items.length,
      maxQueued: this.maxQueued,
      shuttingDown: this.shuttingDown
    };
  }
}

module.exports = {
  InMemoryQueue
};

// Made with Bob
