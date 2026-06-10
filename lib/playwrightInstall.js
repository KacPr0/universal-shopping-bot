const fs = require('fs');
const path = require('path');
const { getDataDir, getLogsDir } = require('./paths');

/** Chromium + headless-shell + ffmpeg w userData (Electron). */
function ensurePlaywrightBrowsersPath() {
  const dir = path.join(getDataDir(), 'playwright-browsers');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
  return dir;
}

function appendInstallLog(line) {
  try {
    getLogsDir();
    const logPath = path.join(getDataDir(), 'logs', 'playwright-install.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch (e) {
    console.error('[Playwright] Nie można zapisać logu:', e.message);
  }
}

function getPlaywrightRegistry() {
  return require('playwright-core/lib/coreBundle').registry;
}

/**
 * Pobiera Chromium + headless-shell + ffmpeg (bez npx/CLI — działa w Electron).
 */
function resolveChromiumExecutables(reg) {
  const executables = reg.registry.resolveBrowsers(['chromium'], {});
  if (process.platform === 'win32') {
    const winldd = reg.registry.findExecutable('winldd');
    if (winldd) executables.push(winldd);
  }
  const seen = new Set();
  return executables.filter((e) => {
    const key = e.name + (e.directory || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function installPlaywrightChromium(onLog = console.log, { force = false } = {}) {
  const browsersPath = ensurePlaywrightBrowsersPath();
  const log = (msg) => {
    onLog(msg);
    appendInstallLog(msg);
  };

  if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
    log('[Playwright] PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD jest ustawione — pomijam pobieranie.');
    return false;
  }

  log(`[Playwright] Instalacja do: ${browsersPath}`);

  try {
    const reg = getPlaywrightRegistry();
    const executables = resolveChromiumExecutables(reg);
    const names = [...new Set(executables.map((e) => e.name))];
    log(`[Playwright] Pobieranie: ${names.join(', ')} (~260 MB, wymagany internet)...`);

    await reg.registry.install(executables, { force });
    log('[Playwright] Pobieranie zakończone.');
    return true;
  } catch (err) {
    log(`[Playwright] Błąd instalacji: ${err.message}`);
    if (err.stack) log(err.stack);
    return false;
  }
}

async function tryLaunchChromium(onLog = console.log) {
  const { chromium } = require('playwright-extra');
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  onLog('[Playwright] Chromium gotowy.');
  return true;
}

async function ensurePlaywrightChromium(onLog = console.log) {
  ensurePlaywrightBrowsersPath();
  appendInstallLog(`--- start (platform=${process.platform}, browsers=${process.env.PLAYWRIGHT_BROWSERS_PATH}) ---`);

  try {
    return await tryLaunchChromium(onLog);
  } catch (err) {
    onLog(`[Playwright] Brak przeglądarki: ${err.message}`);
    appendInstallLog(`launch fail: ${err.message}`);
  }

  let installed = await installPlaywrightChromium(onLog);
  if (!installed) return false;

  try {
    return await tryLaunchChromium(onLog);
  } catch (err) {
    onLog(`[Playwright] Po instalacji nadal błąd: ${err.message}`);
    appendInstallLog(`launch fail after install: ${err.message}`);
    onLog('[Playwright] Ponawiam pobieranie (force)...');
    installed = await installPlaywrightChromium(onLog, { force: true });
    if (!installed) return false;
    try {
      return await tryLaunchChromium(onLog);
    } catch (err2) {
      onLog(`[Playwright] Nadal nie działa: ${err2.message}`);
      appendInstallLog(`launch fail after force install: ${err2.message}`);
      return false;
    }
  }
}

module.exports = {
  ensurePlaywrightBrowsersPath,
  installPlaywrightChromium,
  ensurePlaywrightChromium
};
