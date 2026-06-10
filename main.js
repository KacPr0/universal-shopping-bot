const { app, BrowserWindow } = require('electron');
const path = require('path');
const { ensurePlaywrightChromium } = require('./lib/playwrightInstall');
const { getLogsDir } = require('./lib/paths');

// Flag indicate running inside Electron context
process.env.IS_ELECTRON = 'true';

let loadingWindow;
let mainWindow;
let serverInstance;

const PORT = process.env.PORT || 3000;
const APP_ICON = path.join(__dirname, 'build', 'icon.png');

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 550,
    height: 400,
    icon: APP_ICON,
    frame: false, // brak systemowej ramki okna
    transparent: true, // przezroczyste tło modalu
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // pozwala na proste używanie ipcRenderer w loading.html
    }
  });

  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
  
  loadingWindow.on('closed', () => {
    loadingWindow = null;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: APP_ICON,
    title: 'Universal Shopping Bot Console',
    show: false, // pokażemy dopiero po załadowaniu URL
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    if (loadingWindow) {
      loadingWindow.close();
    }
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Zatrzymanie serwera Express i zamknięcie aplikacji
    if (serverInstance) {
      console.log('Zatrzymywanie serwera Express...');
      serverInstance.close(() => {
        console.log('Serwer Express zatrzymany.');
        app.quit();
      });
    } else {
      app.quit();
    }
  });
}

function sendLoadingStatus(payload) {
  if (loadingWindow) {
    loadingWindow.webContents.send('status-update', payload);
  }
}

async function verifyAndInstallPlaywright() {
  sendLoadingStatus({
    title: 'Inicjalizacja Bota...',
    status: 'Sprawdzanie Chromium',
    details: 'Weryfikacja przeglądarki Playwright...'
  });

  const log = (msg) => {
    console.log(msg);
    if (loadingWindow && msg.includes('[Playwright]')) {
      const short = msg.replace(/^\[Playwright\]\s*/, '');
      sendLoadingStatus({
        title: 'Instalacja zależności...',
        status: 'Pobieranie Chromium',
        details: short
      });
    }
  };

  sendLoadingStatus({
    title: 'Instalacja zależności...',
    status: 'Pobieranie Chromium',
    details: 'Pierwsze uruchomienie: pobieranie Chromium (~260 MB). Wymagany internet — może potrwać kilka minut.'
  });

  const ok = await ensurePlaywrightChromium(log);

  if (ok) {
    sendLoadingStatus({
      title: 'Zakończono pobieranie',
      status: 'Gotowe',
      details: 'Przeglądarka gotowa. Uruchamianie aplikacji...',
      done: true
    });
    return true;
  }

  sendLoadingStatus({
    title: 'Błąd instalacji',
    status: 'Błąd Playwright',
    details:
      'Nie udało się pobrać Chromium. Sprawdź internet, wyłącz antywirus na chwilę i uruchom aplikację ponownie. ' +
      'Log: %APPDATA%\\Universal Shopping Bot\\logs\\playwright-install.log'
  });
  return false;
}

function startExpressServer() {
  return new Promise((resolve) => {
    try {
      console.log('Uruchamianie serwera Express...');
      // server.js eksportuje instancję serwera po modyfikacji
      serverInstance = require('./server');
      
      // Dajemy chwilę na pełną gotowość serwera
      setTimeout(() => {
        console.log('Serwer Express uruchomiony.');
        resolve(true);
      }, 1000);
    } catch (err) {
      console.error('Krytyczny błąd podczas uruchamiania serwera Express:', err);
      resolve(false);
    }
  });
}

app.on('ready', async () => {
  process.env.BOT_DATA_DIR = app.getPath('userData');
  getLogsDir();

  createLoadingWindow();
  
  // Dajmy oknu ładowania 1s na wyrenderowanie HTML
  await new Promise(r => setTimeout(r, 1000));
  
  const playwrightOk = await verifyAndInstallPlaywright();
  if (!playwrightOk) {
    return;
  }

  await startExpressServer();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null && loadingWindow === null) {
    createMainWindow();
  }
});
