const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const ws = require('ws');

const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');

// Użycie stealth plugin z playwright-extra
chromium.use(stealth);

const DB_PATH = path.join(__dirname, 'db.json');

// Helper do czyszczenia blokad sesji Chromium (zapobiega konfliktom i zamarzaniu na about:blank)
function clearChromiumLocks(profileDir) {
  try {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lock'];
    for (const file of lockFiles) {
      const filePath = path.join(profileDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Session Lock] Usunięto osieroconą blokadę: ${filePath}`);
      }
    }
  } catch (err) {
    // Czasami plik jest zablokowany, co ignorujemy
  }
}

// Helper do optymalizacji szybkości przez blokowanie zbędnych zasobów (obrazki, trackery, didomi)
async function setupContextRouting(context) {
  try {
    await context.route('**/*', (route) => {
      const url = route.request().url().toLowerCase();
      const type = route.request().resourceType();
      if (
        type === 'image' ||
        type === 'font' ||
        type === 'media' ||
        url.includes('google-analytics') ||
        url.includes('googletagmanager') ||
        url.includes('facebook') ||
        url.includes('hotjar') ||
        url.includes('didomi') ||
        url.includes('analytics') ||
        url.includes('doubleclick') ||
        url.includes('tiktok') ||
        url.includes('criteo') ||
        url.includes('onetrust') ||
        url.includes('sentry') ||
        url.includes('newrelic') ||
        url.includes('clarity.ms')
      ) {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    });
  } catch (err) {
    console.error('[Speed Optimization] Błąd konfiguracji trasowania:', err);
  }
}

class BotManager {
  constructor() {
    this.tasks = [];
    this.settings = {};
    this.profiles = [];
    this.stats = { checkouts: [], availability: [] };
    this.activeTasks = new Map(); // id -> { intervalId, page, browser, status }
    this.activeSessions = new Map(); // store -> { context, page }
    this.wsServer = null;
    this.loadDb();
    
    if (this.settings.captchaApiKey) {
      chromium.use(RecaptchaPlugin({
        provider: { id: '2captcha', token: this.settings.captchaApiKey }
      }));
    }
  }

  setWsServer(wsServer) {
    this.wsServer = wsServer;
  }

  loadDb() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        this.tasks = data.tasks || [];
        this.settings = data.settings || { discordWebhookUrl: '', checkoutDetails: {} };
        this.profiles = data.profiles || [];
        this.stats = data.stats || { checkouts: [], availability: [] };
      }
    } catch (err) {
      console.error('Błąd podczas wczytywania db.json:', err);
    }
  }

  saveDb() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify({
        settings: this.settings,
        profiles: this.profiles,
        stats: this.stats,
        tasks: this.tasks.map(t => ({
          ...t,
          status: this.activeTasks.has(t.id) ? this.activeTasks.get(t.id).status : 'idle',
          logs: [] // Nie zapisujemy logów do pliku, trzymamy je tylko w pamięci / wysyłamy na WS
        }))
      }, null, 2));
    } catch (err) {
      console.error('Błąd podczas zapisu db.json:', err);
    }
  }

  getTasks() {
    return this.tasks.map(t => {
      const active = this.activeTasks.get(t.id);
      return {
        ...t,
        status: active ? active.status : 'idle',
        logs: active ? active.logs : []
      };
    });
  }

  getSettings() {
    return this.settings;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveDb();
  }

  // --- Profile zakupowe (CRUD) ---

  addProfile(data) {
    const profile = {
      id: 'profile_' + Date.now(),
      name: data.name || '',
      email: data.email || '',
      phone: data.phone || '',
      buyerName: data.buyerName || '',
      street: data.street || '',
      zipCode: data.zipCode || '',
      city: data.city || '',
      deliveryMethod: data.deliveryMethod || '',
      paczkomat: data.paczkomat || '',
      rebelLoginEmail: data.rebelLoginEmail || '',
      rebelPassword: data.rebelPassword || ''
    };
    this.profiles.push(profile);
    this.saveDb();
    return profile;
  }

  editProfile(id, data) {
    const profile = this.profiles.find(p => p.id === id);
    if (!profile) return null;
    const allowedFields = ['name', 'email', 'phone', 'buyerName', 'street', 'zipCode', 'city', 'deliveryMethod', 'paczkomat', 'rebelLoginEmail', 'rebelPassword'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        profile[field] = data[field];
      }
    }
    this.saveDb();
    return profile;
  }

  deleteProfile(id) {
    const idx = this.profiles.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.profiles.splice(idx, 1);
    this.saveDb();
    return true;
  }

  getProfiles() {
    return this.profiles;
  }

  // --- Statystyki ---

  getStats() {
    const checkouts = this.stats.checkouts || [];
    const successful = checkouts.filter(c => c.success);
    
    let fastestCheckout = null;
    let totalMs = 0;
    
    successful.forEach(c => {
      const ms = c.totalTime * 1000;
      if (ms > 0) {
        if (fastestCheckout === null || ms < fastestCheckout) {
          fastestCheckout = ms;
        }
        totalMs += ms;
      }
    });

    const averageCheckout = successful.length > 0 ? totalMs / successful.length : null;
    const successRate = checkouts.length > 0 ? (successful.length / checkouts.length) * 100 : 0;

    return {
      fastestCheckout,
      averageCheckout,
      successRate,
      totalCheckouts: checkouts.length,
      checkoutHistory: checkouts,
      availabilityChecks: this.stats.availability || []
    };
  }

  addTask(url, store, interval, quantity = 1, profileId = null) {
    const newTask = {
      id: 'task_' + Date.now(),
      url,
      store,
      interval: parseFloat(interval) || 15,
      quantity: parseInt(quantity) || 1,
      profileId: profileId || null,
      dropTime: null,
      turboWindow: 10,
      turboInterval: 5,
      status: 'idle',
      logs: []
    };
    this.tasks.push(newTask);
    this.saveDb();
    return newTask;
  }

  deleteTask(id) {
    this.stopTask(id);
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.saveDb();
  }

  log(id, message) {
    const active = this.activeTasks.get(id);
    const logMsg = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (active) {
      active.logs.push(logMsg);
      if (active.logs.length > 200) active.logs.shift(); // Ograniczenie pamięci logów
    }
    console.log(`[Task ${id}] ${message}`);
    this.broadcast({
      type: 'log',
      taskId: id,
      message: logMsg
    });
  }

  updateTaskStatus(id, status) {
    const active = this.activeTasks.get(id);
    if (active) {
      active.status = status;
      const task = this.tasks.find(t => t.id === id);
      if (task) task.status = status;
    }
    this.broadcast({
      type: 'status',
      taskId: id,
      status
    });
  }

  broadcast(data) {
    if (this.wsServer) {
      this.wsServer.clients.forEach(client => {
        if (client.readyState === ws.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    }
  }

  // --- Drop Scheduler (Tryb Turbo) ---

  setDropSchedule(id, dropTime, turboWindow, turboInterval) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    task.dropTime = dropTime;
    task.turboWindow = parseFloat(turboWindow) || 10;
    task.turboInterval = parseFloat(turboInterval) || 5;
    this.saveDb();

    // Jeżeli zadanie jest aktywne, uruchamiamy turbo checker
    const active = this.activeTasks.get(id);
    if (active) {
      this._startTurboChecker(id);
    }

    this.log(id, `📅 Ustawiono drop schedule: ${dropTime}, okno turbo: ${task.turboWindow} min, interwał turbo: ${task.turboInterval}s`);
    return task;
  }

  clearDropSchedule(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    task.dropTime = null;
    this.saveDb();

    const active = this.activeTasks.get(id);
    if (active) {
      if (active.turboCheckerId) {
        clearInterval(active.turboCheckerId);
        active.turboCheckerId = null;
      }
      // Jeśli był w trybie turbo, przywracamy normalny interwał
      if (active.turboActive) {
        active.turboActive = false;
        this._restoreNormalInterval(id);
        this.log(id, '🔥 TRYB TURBO zakończony. Powrót do normalnego interwału.');
        this.broadcast({ type: 'turbo', taskId: id, active: false, dropTime: null, turboWindow: task.turboWindow });
      }
    }

    this.log(id, '📅 Drop schedule wyczyszczony.');
    return task;
  }

  checkTurboMode(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task || !task.dropTime) return;

    const active = this.activeTasks.get(id);
    if (!active) return;

    const now = Date.now();
    const dropMs = new Date(task.dropTime).getTime();
    const windowMs = (task.turboWindow || 10) * 60 * 1000;
    const inWindow = now >= (dropMs - windowMs) && now <= (dropMs + windowMs);

    if (inWindow && !active.turboActive) {
      // Wejście w tryb turbo
      active.turboActive = true;
      if (active.intervalId) {
        clearInterval(active.intervalId);
        active.intervalId = null;
      }
      const turboMs = (task.turboInterval || 5) * 1000;
      active.intervalId = setInterval(() => {
        this.checkAndBuy(id);
      }, turboMs);
      this.log(id, `🔥 TRYB TURBO aktywowany! Sprawdzanie co ${task.turboInterval} sekund.`);
      this.broadcast({ type: 'turbo', taskId: id, active: true, dropTime: task.dropTime, turboWindow: task.turboWindow });
    } else if (!inWindow && active.turboActive) {
      // Wyjście z trybu turbo
      active.turboActive = false;
      this._restoreNormalInterval(id);
      this.log(id, '🔥 TRYB TURBO zakończony. Powrót do normalnego interwału.');
      this.broadcast({ type: 'turbo', taskId: id, active: false, dropTime: task.dropTime, turboWindow: task.turboWindow });
    }
  }

  _startTurboChecker(id) {
    const active = this.activeTasks.get(id);
    if (!active) return;
    // Czyścimy poprzedni checker jeśli istnieje
    if (active.turboCheckerId) {
      clearInterval(active.turboCheckerId);
    }
    active.turboCheckerId = setInterval(() => {
      this.checkTurboMode(id);
    }, 1000);
  }

  _restoreNormalInterval(id) {
    const task = this.tasks.find(t => t.id === id);
    const active = this.activeTasks.get(id);
    if (!task || !active) return;
    if (active.intervalId) {
      clearInterval(active.intervalId);
    }
    const intervalMs = task.interval * 60 * 1000;
    active.intervalId = setInterval(() => {
      this.checkAndBuy(id);
    }, intervalMs);
  }

  startTask(id) {
    if (this.activeTasks.has(id)) {
      this.log(id, 'Bot już działa.');
      return;
    }

    const task = this.tasks.find(t => t.id === id);
    if (!task) return;

    this.activeTasks.set(id, {
      status: 'polling',
      logs: [`[${new Date().toLocaleTimeString()}] Uruchomiono monitorowanie.`],
      intervalId: null,
      turboCheckerId: null,
      turboActive: false,
      browser: null,
      page: null
    });

    this.updateTaskStatus(id, 'polling');
    this.log(id, `Rozpoczęto cykl sprawdzania co ${task.interval} minut.`);

    // Od razu uruchamiamy pierwsze sprawdzenie
    this.checkAndBuy(id);

    // Konfigurujemy cykliczne sprawdzanie
    const intervalMs = task.interval * 60 * 1000;
    const intervalId = setInterval(() => {
      this.checkAndBuy(id);
    }, intervalMs);

    this.activeTasks.get(id).intervalId = intervalId;

    // Jeśli zadanie ma ustawiony dropTime, uruchamiamy turbo checker
    if (task.dropTime) {
      this._startTurboChecker(id);
    }

    this.saveDb();
  }

  stopTask(id) {
    const active = this.activeTasks.get(id);
    if (!active) return;

    if (active.intervalId) {
      clearInterval(active.intervalId);
    }
    if (active.turboCheckerId) {
      clearInterval(active.turboCheckerId);
    }

    this.cleanupBrowser(id).then(() => {
      this.activeTasks.delete(id);
      const task = this.tasks.find(t => t.id === id);
      if (task) task.status = 'idle';
      this.updateTaskStatus(id, 'idle');
      this.log(id, 'Zatrzymano monitorowanie.');
      this.saveDb();
    });
  }

  editTask(id, interval, quantity, profileId) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    const parsedInterval = parseFloat(interval) || 15;
    const parsedQuantity = parseInt(quantity) || 1;

    task.interval = parsedInterval;
    task.quantity = parsedQuantity;
    if (profileId !== undefined) {
      task.profileId = profileId || null;
    }

    // Jeżeli zadanie jest aktywne (monitoruje), aktualizujemy interwał w locie
    const active = this.activeTasks.get(id);
    if (active) {
      // Nie nadpisujemy interwału jeśli aktualnie w trybie turbo
      if (!active.turboActive) {
        if (active.intervalId) {
          clearInterval(active.intervalId);
        }
        const intervalMs = parsedInterval * 60 * 1000;
        active.intervalId = setInterval(() => {
          this.checkAndBuy(id);
        }, intervalMs);
      }
      this.log(id, `[EDYCJA] Zaktualizowano interwał na ${parsedInterval} min oraz ilość sztuk na ${parsedQuantity} szt. w aktywnym monitorze.`);
    } else {
      this.log(id, `[EDYCJA] Zaktualizowano interwał na ${parsedInterval} min oraz ilość sztuk na ${parsedQuantity} szt. (zadanie bezczynne).`);
    }

    this.saveDb();
    
    // Rozsyłamy zaktualizowany stan zadań przez WS do wszystkich podłączonych paneli
    this.broadcast({
      type: 'init',
      tasks: this.getTasks(),
      settings: this.getSettings()
    });

    return task;
  }

  async cleanupBrowser(id) {
    const active = this.activeTasks.get(id);
    if (!active) return;
    try {
      if (active.page) {
        if (!active.isSharedSession) {
          await active.page.close().catch(() => {});
        }
        active.page = null;
      }
      if (active.browser) {
        if (!active.isSharedSession) {
          await active.browser.close().catch(() => {});
        }
        active.browser = null;
      }
    } catch (err) {
      this.log(id, `Błąd podczas zamykania przeglądarki: ${err.message}`);
    }
  }

  async checkAndBuy(id) {
    const active = this.activeTasks.get(id);
    if (!active) return;

    // Jeżeli bot jest w trakcie koszykowania lub kasy, nie odpalamy kolejnego sprawdzenia w pętli
    if (active.status !== 'polling') {
      this.log(id, `Pętla zablokowana. Bot jest w stanie: ${active.status}`);
      return;
    }

    const task = this.tasks.find(t => t.id === id);
    if (!task) return;

    this.log(id, 'Sprawdzanie dostępności produktu...');
    
    let browser = null;
    let page = null;
    try {
      const launchOptions = { headless: true };
      
      // Uruchamiamy przeglądarkę bezgłową (headless: true) do samego sprawdzenia dostępności
      browser = await chromium.launch(launchOptions);
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });
      await setupContextRouting(context);
      page = await context.newPage();

      // Załaduj adapter
      const adapterPath = path.join(__dirname, 'sites', `${task.store}.js`);
      if (!fs.existsSync(adapterPath)) {
        throw new Error(`Brak obsługi sklepu: ${task.store}`);
      }
      const adapter = require(adapterPath);

      // Sprawdź dostępność
      const checkResult = await adapter.checkAvailability(page, task.url, (msg) => this.log(id, msg));
      
      // Statystyki: zapis wyniku sprawdzenia dostępności
      this.stats.availability.push({
        timestamp: Date.now(),
        taskId: id,
        store: task.store,
        productName: checkResult.productName,
        available: checkResult.available,
        price: checkResult.price
      });
      if (this.stats.availability.length > 100) this.stats.availability.shift();
      this.saveDb();

      await browser.close();
      browser = null;

      if (checkResult.available) {
        const resolvedUrl = checkResult.resolvedUrl || task.url;
        this.log(id, `🎉 Produkt JEST DOSTĘPNY! [Nazwa: ${checkResult.productName || 'nieznana'}, Cena: ${checkResult.price || 'nieznana'}]`);
        // Wyślij wstępny webhook
        await this.sendDiscordWebhook(`🔔 **Produkt dostępny!**\nNazwa: ${checkResult.productName || 'N/A'}\nCena: ${checkResult.price || 'N/A'}\nRozpoczynam proces automatycznego zakupu... \nLink: ${resolvedUrl}`);
        
        // Przechodzimy do zakupu
        this.executeCheckout(id, checkResult.productName, resolvedUrl);
      } else {
        this.log(id, `Produkt niedostępny. Kolejna próba za ${task.interval} min.`);
      }

    } catch (err) {
      this.log(id, `❌ Błąd podczas sprawdzania dostępności: ${err.message}`);
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  async executeCheckout(id, productName, resolvedUrl) {
    const active = this.activeTasks.get(id);
    if (!active) return;

    this.updateTaskStatus(id, 'checkout');

    const task = this.tasks.find(t => t.id === id);
    if (!task) return;

    const targetUrl = resolvedUrl || task.url;

    try {
      let context;
      let page;
      let isSharedSession = false;

      // Sprawdzamy, czy użytkownik ma już otwarte okno logowania dla tego sklepu
      if (this.activeSessions.has(task.store)) {
        this.log(id, `🔄 Wykryto otwarte okno sesji dla ${task.store}. Reużywanie aktywnej przeglądarki...`);
        const session = this.activeSessions.get(task.store);
        context = session.context;
        page = session.page;
        isSharedSession = true;
      } else {
        this.log(id, 'Uruchamianie przeglądarki (headed) w celu realizacji zakupu...');
        const sessionDir = path.join(__dirname, '.sessions', task.store);
        
        // Zapewniamy, że katalog istnieje
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Czyścimy osierocone blokady przed uruchomieniem
        clearChromiumLocks(sessionDir);

        const isHeadless = this.settings.checkoutDetails && this.settings.checkoutDetails.headlessCheckout === true;
        const launchOptions = {
          headless: isHeadless,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 800 }
        };

        context = await chromium.launchPersistentContext(sessionDir, launchOptions);
        await setupContextRouting(context);
        page = context.pages()[0] || await context.newPage();
      }

      page.on('load', async () => {
        try {
          const title = await page.title();
          if (title.includes('Just a moment...') || title.includes('Attention Required!')) {
            this.log(id, 'Wykryto zabezpieczenie Cloudflare/Captcha, próba rozwiązania...');
            await page.solveRecaptchas();
          }
        } catch (err) {
          // ignore
        }
      });

      active.browser = context;
      active.page = page;
      active.isSharedSession = isSharedSession;

      const adapterPath = path.join(__dirname, 'sites', `${task.store}.js`);
      const adapter = require(adapterPath);

      // Bezpieczeństwo: testMode domyślnie TRUE (symulacja). Wyłączenie wymaga devModeUnlocked=true ORAZ testMode=false w ustawieniach.
      // Jeśli zadanie ma przypisany profil, dane z profilu nadpisują globalne ustawienia
      let profileOverrides = {};
      if (task.profileId) {
        const profile = this.profiles.find(p => p.id === task.profileId);
        if (profile) {
          this.log(id, `📋 Używanie profilu zakupowego: "${profile.name}"`);
          profileOverrides = {
            email: profile.email || undefined,
            phone: profile.phone || undefined,
            buyerName: profile.buyerName || undefined,
            street: profile.street || undefined,
            zipCode: profile.zipCode || undefined,
            city: profile.city || undefined,
            deliveryMethod: profile.deliveryMethod || undefined,
            paczkomat: profile.paczkomat || undefined,
            rebelLoginEmail: profile.rebelLoginEmail || undefined,
            rebelPassword: profile.rebelPassword || undefined
          };
          // Usuwamy klucze z wartością undefined, żeby nie nadpisywały istniejących danych
          Object.keys(profileOverrides).forEach(k => profileOverrides[k] === undefined && delete profileOverrides[k]);
        } else {
          this.log(id, `⚠️ Profil ${task.profileId} nie został znaleziony. Używam globalnych ustawień.`);
        }
      }

      const checkoutDetails = {
        ...(this.settings.checkoutDetails || {}),
        ...profileOverrides,
        testMode: this.settings.devModeUnlocked === true 
          ? (this.settings.checkoutDetails && this.settings.checkoutDetails.testMode === false ? false : true) 
          : true,
        quantity: task.quantity || 1
      };

      this.log(id, `Dodawanie do koszyka i przechodzenie przez formularze dla URL: ${targetUrl}...`);
      const checkoutResult = await adapter.checkout(page, targetUrl, checkoutDetails, (msg) => this.log(id, msg));

      if (checkoutResult.success) {
        // Statystyki: zapis udanego checkoutu
        this.stats.checkouts.push({
          timestamp: Date.now(),
          taskId: id,
          store: task.store,
          totalTime: checkoutResult.totalTime,
          steps: checkoutResult.steps,
          success: true
        });
        if (this.stats.checkouts.length > 100) this.stats.checkouts.shift();
        this.saveDb();

        this.updateTaskStatus(id, 'checkout-ready');
        this.log(id, '🔔 SUKCES: Dane dostawy zostały wypełnione! Odtwarzam alarm. Dokończ płatność w oknie przeglądarki.');
        
        // Wyślij webhook Discord
        await this.sendDiscordWebhook(`🚀 **Kasa gotowa do opłacenia!**\nProdukt: ${productName || 'N/A'}\nSklep: ${task.store.toUpperCase()}\nStatus: Sukces bota. Proszę dokończyć płatność w otwartym oknie na komputerze hosta.`);

        // Zatrzymujemy odpytywanie dla tego zadania
        if (active.intervalId) {
          clearInterval(active.intervalId);
          active.intervalId = null;
        }
      } else {
        throw new Error(checkoutResult.error || 'Nieznany błąd podczas checkoutu');
      }

    } catch (err) {
      // Statystyki: zapis nieudanego checkoutu
      this.stats.checkouts.push({
        timestamp: Date.now(),
        taskId: id,
        store: task.store,
        totalTime: null,
        steps: null,
        success: false
      });
      if (this.stats.checkouts.length > 100) this.stats.checkouts.shift();
      this.saveDb();

      this.log(id, `❌ Błąd podczas checkoutu: ${err.message}`);
      this.updateTaskStatus(id, 'failed');
      await this.sendDiscordWebhook(`⚠️ **Błąd bota zakupowego!**\nZadanie: ${task.url}\nBłąd: ${err.message}`);
      await this.cleanupBrowser(id);
      // Resetujemy status na polling po błędzie, aby spróbował ponownie w kolejnym cyklu
      setTimeout(() => {
        if (this.activeTasks.has(id)) {
          this.activeTasks.get(id).status = 'polling';
          this.updateTaskStatus(id, 'polling');
          this.log(id, '🔄 Ponowne uruchomienie monitorowania po błędzie.');
        }
      }, 5000);
    }
  }

  async sendDiscordWebhook(content) {
    const url = this.settings.discordWebhookUrl;
    if (!url) return;

    try {
      // Dynamic import of node-fetch or simple https request
      const https = require('https');
      const data = JSON.stringify({ content });
      const parsedUrl = new URL(url);

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`Błąd wysyłania Discord Webhook: HTTP ${res.statusCode}`);
        }
      });

      req.on('error', (err) => {
        console.error('Błąd wysyłania Discord Webhook:', err);
      });

      req.write(data);
      req.end();
    } catch (err) {
      console.error('Błąd wysyłania webhooka:', err);
    }
  }

  async openLoginSession(store) {
    // Jeśli sesja już jest otwarta, przechodzimy na stronę logowania w tym samym oknie
    if (this.activeSessions.has(store)) {
      console.log(`Sesja dla ${store} jest już otwarta. Przełączanie karty na stronę logowania...`);
      const { page } = this.activeSessions.get(store);
      let targetUrl = 'https://www.rebel.pl/security';
      if (store === 'pokecenter') {
        targetUrl = 'https://www.pokemoncenter.com';
      }
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      return;
    }

    const sessionDir = path.join(__dirname, '.sessions', store);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Czyścimy osierocone blokady przed uruchomieniem
    clearChromiumLocks(sessionDir);
    
    console.log(`Otwieranie okna logowania dla ${store}...`);
    const context = await chromium.launchPersistentContext(sessionDir, {
      headless: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });
    
    const page = context.pages()[0] || await context.newPage();
    
    // Zapisujemy sesję do późniejszego reużycia w checkout
    this.activeSessions.set(store, { context, page });

    // Nasłuchujemy na zamknięcie okna przez użytkownika, aby zamknąć cały kontekst i zwolnić profil
    page.on('close', async () => {
      console.log(`[Session ${store}] Okno zamknięte przez użytkownika. Zwalnianie blokady profilu...`);
      this.activeSessions.delete(store);
      await context.close().catch(() => {});
    });

    let targetUrl = 'https://www.rebel.pl/security';
    if (store === 'pokecenter') {
      targetUrl = 'https://www.pokemoncenter.com';
    }
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
      console.error(`Błąd przechodzenia do URL logowania: ${err.message}`);
    });
    // Przeglądarka pozostanie otwarta, dopóki użytkownik jej nie zamknie.
  }
}

module.exports = new BotManager();
