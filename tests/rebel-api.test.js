const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractProductId } = require('../sites/rebel-api');

describe('rebel-api', () => {
  it('extracts product id from rebel URL', () => {
    assert.equal(
      extractProductId('https://www.rebel.pl/karcianki/star-wars-booster-2020059.html'),
      '2020059'
    );
  });

  it('returns null for keyword input', () => {
    assert.equal(extractProductId('star wars booster'), null);
  });
});
