const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ConcurrencyQueue = require('../lib/concurrencyQueue');

describe('ConcurrencyQueue', () => {
  it('limits parallel execution', async () => {
    const queue = new ConcurrencyQueue(2);
    let running = 0;
    let maxRunning = 0;

    const task = () => new Promise((resolve) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      setTimeout(() => {
        running -= 1;
        resolve();
      }, 20);
    });

    await Promise.all([
      queue.run(task),
      queue.run(task),
      queue.run(task),
      queue.run(task)
    ]);

    assert.equal(maxRunning, 2);
  });

  it('updates max concurrency dynamically', async () => {
    const queue = new ConcurrencyQueue(1);
    queue.setMaxConcurrency(3);
    assert.equal(queue.getStats().maxConcurrency, 3);
  });
});
