const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateProductName,
  scoreProductName,
  matchesProductName,
  findBestProductMatch,
  buildSearchPhrases,
  normalizeSearchPhrase
} = require('../sites/lib/productSearch');

const PORTFOLIO_QUERY =
  'Ultra-Pro: Pokémon - 9-Pocket Portfolio - Mega Evolution - Ascended Heroes';
const PORTFOLIO_REBEL_TITLE =
  'Ultra-Pro: Pokémon - 9-Pocket Portfolio - Mega Evolution - Ascended Heroes';

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

  it('matches full Rebel product title with punctuation', () => {
    assert.equal(validateProductName(PORTFOLIO_QUERY, PORTFOLIO_REBEL_TITLE), true);
  });

  it('normalizes punctuation for Algolia search phrase', () => {
    assert.equal(
      normalizeSearchPhrase(PORTFOLIO_QUERY),
      'Ultra Pro Pokemon 9 Pocket Portfolio Mega Evolution Ascended Heroes'
    );
  });

  it('picks best product from search results', () => {
    const products = [
      { name: 'Ultra Pro: Pokémon - 4-Pocket Portfolio - Greninja', href: '/a.html' },
      { name: PORTFOLIO_REBEL_TITLE, href: '/b.html' }
    ];
    const match = findBestProductMatch(PORTFOLIO_QUERY, products);
    assert.equal(match.href, '/b.html');
  });

  it('excludes products matching minus words', () => {
    const products = [
      { name: 'Star Wars Unlimited Booster', href: '/a.html' },
      { name: 'Star Wars Unlimited Display', href: '/b.html' }
    ];
    const match = findBestProductMatch('+Star +Wars -Booster', products);
    assert.equal(match.href, '/b.html');
  });

  it('builds normalized and shorter search phrases', () => {
    const phrases = buildSearchPhrases(PORTFOLIO_QUERY);
    assert.ok(phrases.includes(PORTFOLIO_QUERY));
    assert.ok(phrases.includes('Ultra Pro Pokemon 9 Pocket Portfolio Mega Evolution Ascended Heroes'));
    assert.ok(phrases.some((p) => p.includes('Ascended Heroes')));
  });
});
