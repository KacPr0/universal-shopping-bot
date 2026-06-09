/**
 * Ponawia async task z rosnącym opóźnieniem (exponential backoff).
 */
async function retryWithBackoff(taskFn, { attempts = 3, baseDelayMs = 2000, onRetry } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await taskFn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      if (onRetry) {
        onRetry(attempt, attempts, delayMs, err);
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

module.exports = retryWithBackoff;
