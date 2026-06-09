const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const STORES = ['rebel', 'pokecenter'];

describe('store adapters', () => {
  for (const store of STORES) {
    describe(store, () => {
      const adapter = require(path.join(__dirname, '..', 'sites', `${store}.js`));

      it('exports checkAvailability and checkout', () => {
        assert.equal(typeof adapter.checkAvailability, 'function');
        assert.equal(typeof adapter.checkout, 'function');
      });
    });
  }
});

describe('rebel selectors config', () => {
  const selectors = require('../sites/rebel-selectors');

  it('defines checkout and login selector groups', () => {
    assert.ok(Array.isArray(selectors.checkoutButtons) && selectors.checkoutButtons.length > 0);
    assert.ok(Array.isArray(selectors.login.email) && selectors.login.email.length > 0);
    assert.ok(Array.isArray(selectors.availability.addToCart) && selectors.availability.addToCart.length > 0);
  });
});
