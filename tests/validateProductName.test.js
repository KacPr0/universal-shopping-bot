const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateProductName } = require('../sites/lib/productSearch');

describe('validateProductName', () => {
  it('matches when all keywords appear in product name', () => {
    assert.equal(validateProductName('star wars booster', 'Star Wars Unlimited Booster'), true);
  });

  it('rejects when a keyword is missing', () => {
    assert.equal(validateProductName('star wars booster', 'Star Wars Display'), false);
  });

  it('ignores single-character words', () => {
    assert.equal(validateProductName('a star wars', 'Star Wars Booster'), true);
  });

  it('is case and diacritic insensitive', () => {
    assert.equal(validateProductName('pokemon karta', 'Pokémon Karta kolekcjonerska'), true);
  });
});
