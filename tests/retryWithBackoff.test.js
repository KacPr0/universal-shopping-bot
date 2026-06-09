const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const retryWithBackoff = require('../lib/retryWithBackoff');

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const result = await retryWithBackoff(async () => 'ok');
    assert.equal(result, 'ok');
  });

  it('retries until success', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls += 1;
      if (calls < 3) throw new Error('fail');
      return 'done';
    }, { attempts: 3, baseDelayMs: 1 });

    assert.equal(result, 'done');
    assert.equal(calls, 3);
  });

  it('throws after exhausting attempts', async () => {
    await assert.rejects(
      () => retryWithBackoff(async () => { throw new Error('nope'); }, { attempts: 2, baseDelayMs: 1 }),
      /nope/
    );
  });
});
