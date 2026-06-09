require('dotenv').config();
const express = require('express');
const http = require('http');
const ws = require('ws');
const path = require('path');
const botManager = require('./botManager');

const app = express();
const server = http.createServer(app);
const wss = new ws.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Powiązanie WebSockets z BotManagerem
botManager.setWsServer(wss);

// --- REST API ENDPOINTS ---

// Pobierz wszystkie zadania
app.get('/api/tasks', (req, res) => {
  res.json(botManager.getTasks());
});

// Dodaj nowe zadanie
app.post('/api/tasks', (req, res) => {
  const { url, store, interval, quantity, profileId } = req.body;
  if (!url || !store || !interval) {
    return res.status(400).json({ error: 'Brakujące parametry (url, store, interval)' });
  }
  const newTask = botManager.addTask(url, store, interval, quantity, profileId);
  res.status(201).json(newTask);
});

// Usuń zadanie
app.delete('/api/tasks/:id', (req, res) => {
  botManager.deleteTask(req.params.id);
  res.json({ success: true });
});

// Uruchom zadanie
app.post('/api/tasks/:id/start', (req, res) => {
  botManager.startTask(req.params.id);
  res.json({ success: true });
});

// Zatrzymaj zadanie
app.post('/api/tasks/:id/stop', (req, res) => {
  botManager.stopTask(req.params.id);
  res.json({ success: true });
});

// Edytuj zadanie (interwał sprawdzania, ilość sztuk i opcjonalnie profil)
app.post('/api/tasks/:id/edit', (req, res) => {
  const { interval, quantity, profileId } = req.body;
  if (interval === undefined || quantity === undefined) {
    return res.status(400).json({ error: 'Brakujące parametry (interval, quantity)' });
  }
  const updatedTask = botManager.editTask(req.params.id, interval, quantity, profileId);
  if (updatedTask) {
    res.json(updatedTask);
  } else {
    res.status(404).json({ error: 'Zadanie nie znalezione' });
  }
});

// --- PROFILE ZAKUPOWE ---

// Pobierz wszystkie profile
app.get('/api/profiles', (req, res) => {
  res.json(botManager.getProfiles());
});

// Dodaj nowy profil
app.post('/api/profiles', (req, res) => {
  const profile = botManager.addProfile(req.body);
  res.status(201).json(profile);
});

// Edytuj profil
app.put('/api/profiles/:id', (req, res) => {
  const updated = botManager.editProfile(req.params.id, req.body);
  if (updated) {
    res.json(updated);
  } else {
    res.status(404).json({ error: 'Profil nie znaleziony' });
  }
});

// Usuń profil
app.delete('/api/profiles/:id', (req, res) => {
  const deleted = botManager.deleteProfile(req.params.id);
  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Profil nie znaleziony' });
  }
});

// --- DROP SCHEDULER ---

// Ustaw lub wyczyść drop schedule dla zadania
app.post('/api/tasks/:id/drop-schedule', (req, res) => {
  const { dropTime, turboWindow, turboInterval } = req.body;
  if (!dropTime) {
    const result = botManager.clearDropSchedule(req.params.id);
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Zadanie nie znalezione' });
    }
  } else {
    const result = botManager.setDropSchedule(req.params.id, dropTime, turboWindow, turboInterval);
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Zadanie nie znalezione' });
    }
  }
});

// --- STATYSTYKI ---

// Pobierz statystyki
app.get('/api/stats', (req, res) => {
  res.json(botManager.getStats());
});

// Pobierz ustawienia
app.get('/api/settings', (req, res) => {
  res.json(botManager.getSettings());
});

// Zapisz ustawienia
app.post('/api/settings', (req, res) => {
  botManager.updateSettings(req.body);
  res.json({ success: true });
});

// Zapisz stan Dev Mode (odblokowany/zablokowany)
app.post('/api/settings/dev-mode', (req, res) => {
  const { unlocked } = req.body;
  botManager.settings.devModeUnlocked = unlocked === true;
  botManager.saveDb();
  res.json({ success: true });
});

// Przetestuj webhook Discorda
app.post('/api/settings/test-webhook', async (req, res) => {
  const { webhookUrl } = req.body;
  if (!webhookUrl) {
    return res.status(400).json({ error: 'Brak adresu webhook' });
  }
  
  // Zapisz tymczasowo webhook i wyślij test
  const oldUrl = botManager.settings.discordWebhookUrl;
  botManager.settings.discordWebhookUrl = webhookUrl;
  
  try {
    await botManager.sendDiscordWebhook('🤖 **Universal Shopping Bot**: Test powiadomienia zakończony sukcesem!');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    // Przywróć stary webhook lub zachowaj, jeśli użytkownik kliknie zapisz
    botManager.settings.discordWebhookUrl = oldUrl;
  }
});

// Otwórz sesję logowania w przeglądarce
app.post('/api/sessions/:store/login', async (req, res) => {
  const store = req.params.store;
  if (store !== 'rebel' && store !== 'pokecenter') {
    return res.status(400).json({ error: 'Nieprawidłowy sklep' });
  }
  try {
    // Uruchamiamy bez blokowania wątku serwera
    botManager.openLoginSession(store).catch(err => {
      console.error(`Błąd sesji logowania dla ${store}:`, err);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WEBSOCKET CONNECTION ---
wss.on('connection', (socket) => {
  console.log('Nowe połączenie WebSocket z dashboardem.');
  
  // Wyślij aktualny stan zadań na start
  socket.send(JSON.stringify({
    type: 'init',
    tasks: botManager.getTasks(),
    settings: botManager.getSettings(),
    profiles: botManager.getProfiles(),
    stats: botManager.getStats(),
    isElectron: process.env.IS_ELECTRON === 'true'
  }));

  socket.on('close', () => {
    console.log('Połączenie WebSocket zamknięte.');
  });
});

// Uruchomienie serwera
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  Universal Shopping Bot Dashboard działa pod adresem:`);
  console.log(`  👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
});

module.exports = server;
