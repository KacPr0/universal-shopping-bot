/**
 * Wspólna logika dopasowywania produktów po słowach kluczowych (Rebel).
 */
function cleanString(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function parseSearchQuery(input) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const negativeWords = tokens.filter((t) => t.startsWith('-')).map((t) => t.slice(1));
  const positiveTokens = tokens.filter((t) => !t.startsWith('-')).map((t) => t.replace(/^\+/, ''));
  return {
    searchPhrase: positiveTokens.join(' '),
    negativeWords
  };
}

function getCriticalWords(input) {
  const { searchPhrase } = parseSearchQuery(input);
  return cleanString(searchPhrase).filter((w) => w.length > 1);
}

function wordMatches(criticalWord, nameWords) {
  return nameWords.some(
    (nameWord) => nameWord.includes(criticalWord) || criticalWord.includes(nameWord)
  );
}

function scoreProductName(input, resolvedName) {
  const criticalWords = getCriticalWords(input);
  if (criticalWords.length === 0) return 1;

  const nameWords = cleanString(resolvedName);
  let matched = 0;
  for (const word of criticalWords) {
    if (wordMatches(word, nameWords)) matched++;
  }
  return matched / criticalWords.length;
}

function validateProductName(input, resolvedName) {
  return scoreProductName(input, resolvedName) === 1;
}

function matchesProductName(input, resolvedName, { minScore = 0.65, negativeWords = [] } = {}) {
  if (scoreProductName(input, resolvedName) < minScore) return false;

  const normalizedText = cleanString(resolvedName).join(' ');
  for (const negative of negativeWords) {
    const n = cleanString(negative).join(' ');
    if (n && normalizedText.includes(n)) return false;
  }
  return true;
}

/** Fraza bez znaków interpunkcyjnych — lepiej indeksuje się w wyszukiwarce Rebel (Algolia). */
function normalizeSearchPhrase(phrase) {
  return phrase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Warianty frazy: pełna, znormalizowana, skrócona, końcówka (np. „Ascended Heroes Portfolio”). */
function buildSearchPhrases(searchPhrase, { minWords = 3, maxAttempts = 5 } = {}) {
  const trimmed = searchPhrase.trim();
  if (!trimmed) return [];

  const normalized = normalizeSearchPhrase(trimmed);
  const normWords = normalized.split(/\s+/).filter(Boolean);
  const phrases = [trimmed];

  if (normalized && normalized !== trimmed) {
    phrases.push(normalized);
  }

  if (normWords.length > 0) {
    const step = Math.max(1, Math.ceil((normWords.length - minWords) / Math.max(1, maxAttempts - 1)));
    for (let len = normWords.length; len >= minWords; len -= step) {
      phrases.push(normWords.slice(0, len).join(' '));
    }
    if (normWords.length > 4) {
      phrases.push(normWords.slice(-5).join(' '));
      phrases.push(normWords.slice(-4).join(' '));
    }
  }

  return [...new Set(phrases)].filter(Boolean);
}

function findBestProductMatch(input, products, options = {}) {
  const parsed = parseSearchQuery(input);
  const negativeWords = options.negativeWords ?? parsed.negativeWords;
  const minScore = options.minScore ?? 0.65;
  let best = null;
  let bestScore = 0;

  for (const product of products) {
    const score = scoreProductName(input, product.name);
    if (score < minScore) continue;
    if (!matchesProductName(input, product.name, { minScore, negativeWords })) continue;
    if (score > bestScore) {
      bestScore = score;
      best = { ...product, score };
    }
  }

  return best;
}

module.exports = {
  cleanString,
  parseSearchQuery,
  normalizeSearchPhrase,
  scoreProductName,
  validateProductName,
  matchesProductName,
  buildSearchPhrases,
  findBestProductMatch
};
