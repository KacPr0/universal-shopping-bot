const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

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

// Funkcja weryfikująca i instalująca przeglądarkę Playwright (Chromium)
async function verifyAndInstallPlaywright() {
  return new Promise((resolve) => {
    // Sprawdzamy instalację poprzez próbę uruchomienia Chromium headless przy użyciu playwright
    const { chromium } = require('playwright-extra');
    
    console.log('Weryfikacja instalacji Chromium...');
    chromium.launch({ headless: true })
      .then((browser) => {
        browser.close().then(() => {
          console.log('Chromium jest zainstalowane i działa poprawnie.');
          resolve(true);
        });
      })
      .catch((err) => {
        console.log('Wykryto brak przeglądarki Playwright lub błąd uruchomienia:', err.message);
        
        // Aktualizacja statusu na ekranie ładowania
        if (loadingWindow) {
          loadingWindow.webContents.send('status-update', {
            title: 'Instalacja zależności...',
            status: 'Pobieranie Chromium',
            details: 'Trwa pobieranie oficjalnej kompilacji Chromium dla Playwright (ok. 150MB). Może to potrwać dłuższą chwilę...'
          });
        }

        // Uruchomienie npx playwright install chromium
        console.log('Uruchamianie npx playwright install chromium...');
        const installProcess = exec('npx playwright install chromium');

        installProcess.stdout.on('data', (data) => {
          console.log(`[Playwright Install STDOUT]: ${data}`);
        });

        installProcess.stderr.on('data', (data) => {
          console.error(`[Playwright Install STDERR]: ${data}`);
        });

        installProcess.on('close', (code) => {
          console.log(`Instalator Playwright zakończył pracę z kodem: ${code}`);
          if (code === 0) {
            if (loadingWindow) {
              loadingWindow.webContents.send('status-update', {
                title: 'Zakończono pobieranie',
                status: 'Instalowanie przeglądarki',
                details: 'Przeglądarka została zainstalowana. Trwa uruchamianie aplikacji...',
                done: true
              });
            }
            setTimeout(() => resolve(true), 1500);
          } else {
            if (loadingWindow) {
              loadingWindow.webContents.send('status-update', {
                title: 'Błąd instalacji',
                status: 'Błąd Playwright',
                details: `Instalator zakończył pracę z błędem (kod: ${code}). Spróbuj uruchomić aplikację ponownie.`
              });
            }
            // Mimo błędu próbujemy przejść dalej (może błąd był niekrytyczny)
            setTimeout(() => resolve(false), 3000);
          }
        });
      });
  });
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

  createLoadingWindow();
  
  // Dajmy oknu ładowania 1s na wyrenderowanie HTML
  await new Promise(r => setTimeout(r, 1000));
  
  // Weryfikacja i ew. instalacja Chromium
  await verifyAndInstallPlaywright();
  
  // Uruchomienie backendu Express
  await startExpressServer();
  
  // Otwarcie głównego okna z konsolą bota
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
