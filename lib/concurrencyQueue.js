/**
 * Kolejka z limitem równoległych zadań async.
 */
class ConcurrencyQueue {
  constructor(maxConcurrency = 4) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
    this.running = 0;
    this.waiting = [];
  }

  setMaxConcurrency(maxConcurrency) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
    this._pump();
  }

  run(taskFn) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ taskFn, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    while (this.running < this.maxConcurrency && this.waiting.length > 0) {
      const job = this.waiting.shift();
      this.running += 1;

      Promise.resolve()
        .then(() => job.taskFn())
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running -= 1;
          this._pump();
        });
    }
  }

  getStats() {
    return {
      running: this.running,
      pending: this.waiting.length,
      maxConcurrency: this.maxConcurrency
    };
  }
}

module.exports = ConcurrencyQueue;
