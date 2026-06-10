const fs = require('fs');
const path = require('path');

/** Katalog zapisu danych użytkownika (db, sesje, logi). W Electronie = userData. */
function getDataDir() {
  const dir = process.env.BOT_DATA_DIR || path.join(__dirname, '..');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getDbPath() {
  return path.join(getDataDir(), 'db.json');
}

function getSessionsDir(store) {
  const base = path.join(getDataDir(), '.sessions');
  if (store) return path.join(base, store);
  return base;
}

function getLogsDir() {
  const dir = path.join(getDataDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCheckoutErrorsDir() {
  const dir = path.join(getLogsDir(), 'checkout-errors');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  getDataDir,
  getDbPath,
  getSessionsDir,
  getLogsDir,
  getCheckoutErrorsDir
};
