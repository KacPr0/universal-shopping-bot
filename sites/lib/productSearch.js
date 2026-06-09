/**
 * Wspólna logika dopasowywania produktów po słowach kluczowych (Rebel, Pokemon Center).
 */
function validateProductName(input, resolvedName) {
  const cleanString = (str) => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  };

  const inputWords = cleanString(input);
  const nameWords = cleanString(resolvedName);
  const criticalWords = inputWords.filter(w => w.length > 1);
  if (criticalWords.length === 0) return true;

  return criticalWords.every(word =>
    nameWords.some(nameWord => nameWord.includes(word) || word.includes(nameWord))
  );
}

module.exports = { validateProductName };
