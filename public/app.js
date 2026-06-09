let socket;
let tasks = [];
let settings = {};
let isElectron = false;
let editingTaskIds = new Set();
let profiles = [];
let statsData = null;
let editingProfileId = null;
let showingProfileForm = false;

// Elementy DOM
const connectionIndicator = document.getElementById('connection-indicator');
const connectionText = document.getElementById('connection-text');
const addTaskForm = document.getElementById('add-task-form');
const storeSelect = document.getElementById('store-select');
const productUrl = document.getElementById('product-url');
const checkInterval = document.getElementById('check-interval');
const productQuantity = document.getElementById('product-quantity');
// Zapis ustawień nie potrzebuje już nasłuchiwacza na submit, bo zmieniamy to na auto-save
// Podłącz auto-save pod każde wejście
['set-test-mode', 'set-mute-alarm', 'set-headless-checkout', 'set-discord', 'set-captcha-key', 'set-email', 'set-buyer-name', 'set-phone', 'set-street', 'set-city', 'set-zip', 'set-delivery-method', 'set-paczkomat', 'set-rebel-login', 'set-rebel-password', 'set-cluster-browsers', 'set-cluster-checks', 'set-cluster-checkouts'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      saveSettings(false); // pass false to avoid showing alert on every little change
    });
    // for text inputs, auto-save on blur as well
    if (el.type === 'text' || el.type === 'email' || el.type === 'url') {
      el.addEventListener('blur', () => saveSettings(false));
    }
  }
});
const consoleTerminal = document.getElementById('console-terminal');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnDevLock = document.getElementById('btn-dev-lock');

// Pola ustawień
const setEmail = document.getElementById('set-email');
const setPhone = document.getElementById('set-phone');
const setBuyerName = document.getElementById('set-buyer-name');
const setStreet = document.getElementById('set-street');
const setDeliveryMethod = document.getElementById('set-delivery-method');
const setPaczkomat = document.getElementById('set-paczkomat');
const setZip = document.getElementById('set-zip');
const setCity = document.getElementById('set-city');
const setDiscord = document.getElementById('set-discord');
const btnTestWebhook = document.getElementById('btn-test-webhook');
const btnLoginRebel = document.getElementById('btn-login-rebel');
const setRebelLogin = document.getElementById('set-rebel-login');
const setRebelPassword = document.getElementById('set-rebel-password');
const setTestMode = document.getElementById('set-test-mode');
const setMuteAlarm = document.getElementById('set-mute-alarm');
const setHeadlessCheckout = document.getElementById('set-headless-checkout');
const btnFillTestData = document.getElementById('btn-fill-test-data');
const setCaptchaKey = document.getElementById('set-captcha-key');
const setClusterBrowsers = document.getElementById('set-cluster-browsers');
const setClusterChecks = document.getElementById('set-cluster-checks');
const setClusterCheckouts = document.getElementById('set-cluster-checkouts');
const clusterStatsLine = document.getElementById('cluster-stats-line');
const monitorsList = document.getElementById('monitors-list');
// Zmienne UI już nie potrzebują obsługi task-search-mode
// Inicjalizacja połączenia WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    connectionIndicator.className = 'status-indicator online';
    connectionText.textContent = 'Połączono';
    addSystemLog('Połączono z serwerem bota.');
  };

  socket.onclose = () => {
    connectionIndicator.className = 'status-indicator offline';
    connectionText.textContent = 'Rozłączony (ponowna próba...)';
    addSystemLog('Połączenie z serwerem przerwane. Reconnecting w tle...');
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.error('Błąd połączenia WebSocket:', err);
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleSocketMessage(data);
  };
}

// Obsługa wiadomości z WebSocketu
function handleSocketMessage(data) {
  switch (data.type) {
    case 'init':
      tasks = data.tasks;
      settings = data.settings;
      isElectron = data.isElectron;
      profiles = data.profiles || [];
      
      // Synchronizacja stanu Dev Mode z serwerem
      if (settings && settings.devModeUnlocked === true) {
        localStorage.setItem('devMode', 'true');
      } else {
        localStorage.removeItem('devMode');
      }
      
      renderTasks();
      fillSettingsForm();
      renderProfiles();
      updateDevModeUI();
      // Statystyki są teraz w init payload — renderuj natychmiast
      if (data.stats) {
        statsData = data.stats;
        renderStats(statsData);
      }
      // Załaduj początkowe logi ze wszystkich zadań
      tasks.forEach(task => {
        if (task.logs && task.logs.length > 0) {
          task.logs.forEach(logLine => addLogLine(task.id, logLine));
        }
      });
      break;

    case 'log':
      addLogLine(data.taskId, data.message);
      break;

    case 'task-update':
      const updatedTask = tasks.find(t => t.id === data.taskId);
      if (updatedTask && data.resolvedUrl) {
        updatedTask.resolvedUrl = data.resolvedUrl;
        renderTasks();
      }
      break;

    case 'status':
      const task = tasks.find(t => t.id === data.taskId);
      if (task) {
        task.status = data.status;
        renderTasks();
        
        // Jeżeli bot doszedł do kasy, odpal alarm!
        if (data.status === 'checkout-ready') {
          const muteAlarm = settings.checkoutDetails && settings.checkoutDetails.muteAlarm === true;
          if (!muteAlarm) {
            playAlarmSound();
          }
        }
      }
      break;

    case 'turbo':
      const turboTask = tasks.find(t => t.id === data.taskId);
      if (turboTask) {
        turboTask.turboActive = data.active;
        renderTasks();
      }
      break;
  }
}

// Logi konsolowe
function addLogLine(taskId, message) {
  const line = document.createElement('div');
  line.className = 'log-line';
  
  // Kolorowanie w zależności od zawartości
  if (message.includes('[BŁĄD]') || message.includes('Błąd')) {
    line.classList.add('error-line');
  } else if (message.includes('SUKCES') || message.includes('[ZAKUP]') || message.includes('DOSTĘPNY')) {
    line.classList.add('success-line');
  } else if (message.includes('BENCHMARK')) {
    line.classList.add('benchmark-line');
  } else {
    line.classList.add('task-line');
  }

  // Wyszukanie nazwy zadania dla ładniejszego logu
  const task = tasks.find(t => t.id === taskId);
  const storeName = task ? task.store.toUpperCase() : 'BOT';
  
  line.innerText = `[${storeName}] ${message}`;
  consoleTerminal.appendChild(line);
  
  // Autoscroll
  consoleTerminal.scrollTop = consoleTerminal.scrollHeight;
}

function addSystemLog(message) {
  const line = document.createElement('div');
  line.className = 'log-line system-line';
  line.innerText = `[SYSTEM] ${message}`;
  consoleTerminal.appendChild(line);
  consoleTerminal.scrollTop = consoleTerminal.scrollHeight;
}

function formatTaskUrlHtml(task) {
  const isKeywords = !task.url.startsWith('http');
  if (isKeywords) {
    let html = `<div class="monitor-url" title="${task.url}">Słowa: ${task.url}</div>`;
    if (task.resolvedUrl) {
      html += `<a href="${task.resolvedUrl}" target="_blank" class="monitor-url resolved-url" title="${task.resolvedUrl}">${task.resolvedUrl}</a>`;
    }
    return html;
  }
  const href = task.resolvedUrl || task.url;
  return `<a href="${href}" target="_blank" class="monitor-url" title="${href}">${href}</a>`;
}

// Renderowanie listy zadań monitorujących
function renderTasks() {
  if (tasks.length === 0) {
    monitorsList.innerHTML = `<div class="no-monitors">Brak aktywnych monitorów. Dodaj produkt powyżej, aby rozpocząć.</div>`;
    return;
  }

  monitorsList.innerHTML = '';
  tasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'monitor-card';
    
    // Nazwa sklepu
    const storeClass = 'monitor-store';
    const storeLabel = 'Rebel.pl';

    // Badge statusu
    let statusClass = 'idle';
    let statusText = 'Bezczynny';
    if (task.status === 'polling') {
      statusClass = 'polling';
      statusText = 'Monitoruje';
    } else if (task.status === 'checkout') {
      statusClass = 'checkout';
      statusText = 'W koszyku...';
    } else if (task.status === 'checkout-ready') {
      statusClass = 'checkout-ready';
      statusText = 'Czeka na kasę!';
    } else if (task.status === 'failed') {
      statusClass = 'failed';
      statusText = 'Błąd';
    }

    const isEditing = editingTaskIds.has(task.id);

    // Profile dropdown options
    const profileOptions = profiles.map(p => 
      `<option value="${p.id}" ${task.profileId === p.id ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    // Assigned profile name for badge
    const assignedProfile = task.profileId ? profiles.find(p => p.id === task.profileId) : null;
    const profileBadgeHtml = assignedProfile ? `<span class="profile-badge">${assignedProfile.name}</span>` : '';

    // Drop info for normal mode
    let dropInfoHtml = '';
    if (task.dropTime) {
      const dropDate = new Date(task.dropTime);
      const formattedDrop = dropDate.toLocaleString('pl-PL');
      dropInfoHtml += `<div class="drop-info">Drop: ${formattedDrop}</div>`;
      dropInfoHtml += `<div class="drop-countdown" data-drop-task-id="${task.id}" data-drop-time="${task.dropTime}"></div>`;
    }
    const turboHtml = task.turboActive ? `<span class="turbo-badge">TURBO</span>` : '';
    
    const urlOrKeywordsHtml = formatTaskUrlHtml(task);

    if (isEditing) {
      card.innerHTML = `
        <div class="monitor-info editing" style="flex: 1;">
          <div class="monitor-header-row" style="margin-bottom: 6px;">
            <span class="${storeClass}">${storeLabel}</span>
          </div>
          ${urlOrKeywordsHtml}
          
          <div style="display: flex; gap: 8px; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); width: fit-content; margin-top: 8px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 0.75rem; color: var(--text-muted);">co </span>
              <input type="number" id="edit-interval-${task.id}" value="${task.interval}" min="1" step="0.5" style="width: 60px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; text-align: center;">
              <span style="font-size: 0.75rem; color: var(--text-muted);"> min</span>
            </div>
            
            <div style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
            
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="edit-quantity-${task.id}" value="${task.quantity || 1}" min="1" max="100" style="width: 50px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; text-align: center;">
              <span style="font-size: 0.75rem; color: var(--text-muted);"> szt.</span>
            </div>

            <div style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>

            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 0.75rem; color: var(--text-muted);">Profil: </span>
              <select id="edit-profile-${task.id}" style="padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px;">
                <option value="">Domyślne (globalne)</option>
                ${profileOptions}
              </select>
            </div>
          </div>

          <div style="margin-top: 12px; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); width: fit-content;">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">Opcjonalnie: Tryb TURBO (Drop)</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.7rem; color: var(--text-muted);">Czas dropu</label>
                <input type="datetime-local" id="edit-drop-time-${task.id}" value="${task.dropTime ? new Date(task.dropTime).toISOString().slice(0, 16) : ''}" style="padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px;">
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.7rem; color: var(--text-muted);">Turbo okno (min)</label>
                <input type="number" id="edit-turbo-window-${task.id}" value="${task.turboWindow || 10}" min="1" style="width: 60px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; text-align: center;">
              </div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <label style="font-size: 0.7rem; color: var(--text-muted);">Interwał (sek)</label>
                <input type="number" id="edit-turbo-interval-${task.id}" value="${task.turboInterval || 5}" min="1" style="width: 60px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; text-align: center;">
              </div>
            </div>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; align-items: flex-end; justify-content: center;">
          <div class="status-badge ${statusClass}">
            <div class="pulse-dot"></div>
            <span>${statusText}</span>
          </div>
          <div class="monitor-actions">
            <button class="btn btn-secondary btn-success btn-small" onclick="saveEditInline('${task.id}')" style="background: var(--accent-green); color: #000; border: none; padding: 6px 12px; font-weight: bold; border-radius: 6px;">Zapisz</button>
            <button class="btn btn-secondary btn-small" onclick="cancelEditInline('${task.id}')">Anuluj</button>
          </div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="monitor-info">
          <div class="monitor-header-row">
            <span class="${storeClass}">${storeLabel}</span>
            <span class="monitor-interval">co ${task.interval} min | ${task.quantity || 1} szt.</span>
            ${turboHtml}
          </div>
          ${urlOrKeywordsHtml}
          ${dropInfoHtml}
        </div>
        <div class="status-badge ${statusClass}">
          <div class="pulse-dot"></div>
          <span>${statusText}</span>
        </div>
        <div class="monitor-actions">
          ${task.status === 'idle' || task.status === 'failed' ? 
            `<button class="btn btn-secondary btn-small" onclick="startTask('${task.id}')">Start</button>` : 
            `<button class="btn btn-danger btn-small" onclick="stopTask('${task.id}')">Stop</button>`
          }
          <button class="btn btn-secondary btn-small" onclick="editTaskInline('${task.id}')">Edytuj</button>
          <button class="btn btn-secondary btn-danger btn-small" onclick="deleteTask('${task.id}')">Usuń</button>
        </div>
      `;
    }
    
    monitorsList.appendChild(card);
  });
}

function togglePaczkomatVisibility() {
  const paczkomatGroup = document.getElementById('paczkomat-group');
  if (paczkomatGroup) {
    if (setDeliveryMethod.value === 'inpost') {
      paczkomatGroup.style.display = 'block';
      setPaczkomat.required = true;
    } else {
      paczkomatGroup.style.display = 'none';
      setPaczkomat.required = false;
      setPaczkomat.value = ''; // Wyczyść kod paczkomatu jeśli wybrano kuriera, by uniknąć konfuzji
    }
  }
}

setDeliveryMethod.addEventListener('change', togglePaczkomatVisibility);

// Uzupełnienie danych w formularzu ustawień
function fillSettingsForm() {
  if (settings.checkoutDetails) {
    const d = settings.checkoutDetails;
    setEmail.value = d.email || '';
    setPhone.value = d.phone || '';
    setBuyerName.value = d.buyerName || '';
    setStreet.value = d.street || '';
    setZip.value = d.zipCode || '';
    setCity.value = d.city || '';
    setDeliveryMethod.value = d.deliveryMethod || 'inpost';
    setPaczkomat.value = d.paczkomat || '';
    setRebelLogin.value = d.rebelLoginEmail || '';
    setRebelPassword.value = d.rebelPassword || '';
    setTestMode.checked = d.testMode !== false;
    setMuteAlarm.checked = d.muteAlarm === true;
    setHeadlessCheckout.checked = d.headlessCheckout === true;
  }
  setDiscord.value = settings.discordWebhookUrl || '';
  if (setCaptchaKey) setCaptchaKey.value = settings.captchaApiKey || '';
  if (settings.cluster) {
    if (setClusterBrowsers) setClusterBrowsers.value = settings.cluster.maxBrowsers ?? 2;
    if (setClusterChecks) setClusterChecks.value = settings.cluster.maxConcurrentChecks ?? 4;
    if (setClusterCheckouts) setClusterCheckouts.value = settings.cluster.maxConcurrentCheckouts ?? 1;
  }
  togglePaczkomatVisibility();
}


// --- AKCJE REST API ---

// Dodawanie zadania
addTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  console.log('>>> SUBMIT FIRED');
  const url = productUrl.value;
  const store = storeSelect.value;
  const interval = parseFloat(checkInterval.value);
  const quantity = parseInt(productQuantity.value) || 1;
  const searchMode = url.startsWith('http') ? 'url' : 'keywords';

  if (!url || !store || !interval) {
    alert('Wypełnij wszystkie pola formularza.');
    return;
  }

  try {
    addSystemLog(`Wysyłam żądanie dodania monitora: ${store} / ${url}`);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, store, interval, quantity, searchMode })
    });
    
    if (res.ok) {
      const newTask = await res.json();
      tasks.push(newTask);
      renderTasks();
      productUrl.value = '';
      productQuantity.value = '1';
      addSystemLog(`Dodano nowe zadanie monitorowania dla: ${store}`);
      // Automatycznie startujemy dodane zadanie
      startTask(newTask.id);
    } else {
      const err = await res.json();
      alert(`Błąd serwera: ${err.error}`);
      addSystemLog(`Błąd dodawania zadania: ${err.error}`);
    }
  } catch (err) {
    console.error('Błąd dodawania zadania:', err);
    alert(`Błąd sieci: ${err.message}`);
    addSystemLog(`Błąd sieci przy dodawaniu: ${err.message}`);
  }
});

// Zapisywanie ustawień
async function saveSettings(showNotification = true) {
  const updatedSettings = {
    discordWebhookUrl: setDiscord.value,
    captchaApiKey: setCaptchaKey ? setCaptchaKey.value : '',
    cluster: {
      maxBrowsers: parseInt(setClusterBrowsers?.value, 10) || 2,
      maxConcurrentChecks: parseInt(setClusterChecks?.value, 10) || 4,
      maxConcurrentCheckouts: parseInt(setClusterCheckouts?.value, 10) || 1
    },
    checkoutDetails: {
      email: setEmail.value,
      phone: setPhone.value,
      buyerName: setBuyerName.value,
      street: setStreet.value,
      zipCode: setZip.value,
      city: setCity.value,
      deliveryMethod: setDeliveryMethod.value,
      paczkomat: setPaczkomat.value,
      rebelLoginEmail: setRebelLogin.value,
      rebelPassword: setRebelPassword.value,
      testMode: setTestMode.checked,
      muteAlarm: setMuteAlarm.checked,
      headlessCheckout: setHeadlessCheckout.checked
    }
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSettings)
    });
    
    if (res.ok) {
      settings = updatedSettings;
      addSystemLog('Ustawienia globalne zostały automatycznie zapisane.');
      if (showNotification) alert('Zapisano ustawienia pomyślnie!');
    } else {
      if (showNotification) alert('Wystąpił błąd podczas zapisu ustawień.');
    }
  } catch (err) {
    console.error('Błąd zapisu ustawień:', err);
  }
}

// Testowanie webhooka Discorda
btnTestWebhook.addEventListener('click', async () => {
  const webhookUrl = setDiscord.value;
  if (!webhookUrl) {
    alert('Najpierw wpisz adres Webhook URL.');
    return;
  }

  btnTestWebhook.disabled = true;
  btnTestWebhook.textContent = 'Wysyłanie...';
  
  try {
    const res = await fetch('/api/settings/test-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl })
    });
    
    if (res.ok) {
      addSystemLog('Wysłano testowe powiadomienie na Discord.');
      alert('Powiadomienie testowe wysłane!');
    } else {
      const err = await res.json();
      alert(`Błąd testu webhooka: ${err.error}`);
    }
  } catch (err) {
    console.error(err);
    alert('Błąd sieciowy podczas testu webhooka.');
  } finally {
    btnTestWebhook.disabled = false;
    btnTestWebhook.textContent = 'Test';
  }
});

// Czyszczenie logów konsoli
btnClearLogs.addEventListener('click', () => {
  consoleTerminal.innerHTML = '';
  addSystemLog('Wyczyszczono logi lokalne.');
});

// Sterowanie zadaniami (wywoływane inline z przycisków w tabeli)
async function startTask(id) {
  try {
    const res = await fetch(`/api/tasks/${id}/start`, { method: 'POST' });
    if (res.ok) {
      const task = tasks.find(t => t.id === id);
      if (task) task.status = 'polling';
      renderTasks();
    }
  } catch (err) {
    console.error('Błąd startu zadania:', err);
  }
}

async function stopTask(id) {
  try {
    const res = await fetch(`/api/tasks/${id}/stop`, { method: 'POST' });
    if (res.ok) {
      const task = tasks.find(t => t.id === id);
      if (task) task.status = 'idle';
      renderTasks();
    }
  } catch (err) {
    console.error('Błąd zatrzymania zadania:', err);
  }
}

async function deleteTask(id) {
  if (!confirm('Czy na pewno chcesz usunąć to zadanie monitorowania?')) return;
  try {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      tasks = tasks.filter(t => t.id !== id);
      renderTasks();
      addSystemLog('Usunięto monitor.');
    }
  } catch (err) {
    console.error('Błąd usuwania zadania:', err);
  }
}

function editTaskInline(id) {
  editingTaskIds.add(id);
  renderTasks();
}

function cancelEditInline(id) {
  editingTaskIds.delete(id);
  renderTasks();
}

async function saveEditInline(id) {
  const intervalInput = document.getElementById(`edit-interval-${id}`);
  const quantityInput = document.getElementById(`edit-quantity-${id}`);
  
  if (!intervalInput || !quantityInput) return;

  const interval = parseFloat(intervalInput.value);
  const quantity = parseInt(quantityInput.value);

  if (isNaN(interval) || interval < 1) {
    alert('Interwał musi być liczbą większą lub równą 1.');
    return;
  }

  if (isNaN(quantity) || quantity < 1) {
    alert('Ilość sztuk musi wynosić co najmniej 1.');
    return;
  }

  const profileInput = document.getElementById(`edit-profile-${id}`);
  const profileId = profileInput && profileInput.value ? profileInput.value : null;

  const dropTimeInput = document.getElementById(`edit-drop-time-${id}`);
  const turboWindowInput = document.getElementById(`edit-turbo-window-${id}`);
  const turboIntervalInput = document.getElementById(`edit-turbo-interval-${id}`);

  const dropTime = dropTimeInput && dropTimeInput.value ? new Date(dropTimeInput.value).toISOString() : null;
  const turboWindow = turboWindowInput ? parseInt(turboWindowInput.value) || 10 : 10;
  const turboInterval = turboIntervalInput ? parseInt(turboIntervalInput.value) || 5 : 5;

  try {
    const res = await fetch(`/api/tasks/${id}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval, quantity, profileId, dropTime, turboWindow, turboInterval })
    });
    
    if (res.ok) {
      const updatedTask = await res.json();
      // Aktualizujemy lokalną tablicę zadań
      const index = tasks.findIndex(t => t.id === id);
      if (index !== -1) {
        tasks[index] = { ...tasks[index], ...updatedTask };
      }
      editingTaskIds.delete(id);
      renderTasks();
      addSystemLog(`Zaktualizowano parametry zadania: co ${interval} min | ${quantity} szt.`);
    } else {
      const err = await res.json();
      alert(`Błąd edycji: ${err.error}`);
    }
  } catch (err) {
    console.error('Błąd zapisu edycji zadania:', err);
    alert('Błąd sieciowy podczas zapisywania zmian.');
  }
}

// --- GENERATOR DŹWIĘKU ALARMU (Web Audio API) ---
function playAlarmSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    
    // Gramy serię potrójnych pisków
    const playBeep = (delay, frequency, duration) => {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + duration);
      }, delay);
    };

    // Cykl 1
    playBeep(0, 880, 0.15);
    playBeep(200, 880, 0.15);
    playBeep(400, 1200, 0.3);

    // Cykl 2 (po 1 sekundzie)
    playBeep(1000, 880, 0.15);
    playBeep(1200, 880, 0.15);
    playBeep(1400, 1200, 0.3);

  } catch (e) {
    console.error('Nie można odtworzyć alarmu audio:', e);
  }
}

// Obsługa logowania w sesji
async function openLoginSession(store, btn) {
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Otwieranie...';
  
  try {
    const res = await fetch(`/api/sessions/${store}/login`, { method: 'POST' });
    if (res.ok) {
      addSystemLog(`Zażądano otwarcia sesji logowania dla: ${store}. Zaloguj się w nowym oknie.`);
    } else {
      alert('Nie udało się otworzyć okna logowania.');
    }
  } catch (err) {
    console.error(err);
    alert('Błąd sieciowy podczas otwierania sesji.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

btnLoginRebel.addEventListener('click', () => openLoginSession('rebel', btnLoginRebel));

// Electron (contextIsolation) blokuje window.prompt/confirm/alert — własny modal
function showAppDialog({ title, message, inputType = null, okText = 'OK', cancelText = 'Anuluj', alertOnly = false }) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('app-dialog');
    const titleEl = document.getElementById('app-dialog-title');
    const messageEl = document.getElementById('app-dialog-message');
    const inputEl = document.getElementById('app-dialog-input');
    const okBtn = document.getElementById('app-dialog-ok');
    const cancelBtn = document.getElementById('app-dialog-cancel');
    const backdrop = document.getElementById('app-dialog-backdrop');

    if (!dialog || !titleEl || !messageEl || !inputEl || !okBtn || !cancelBtn) {
      resolve(inputType ? null : false);
      return;
    }

    const cleanup = () => {
      dialog.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      inputEl.removeEventListener('keydown', onKeydown);
    };

    const onOk = () => {
      const value = inputType ? inputEl.value : true;
      cleanup();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      resolve(inputType ? null : false);
    };

    const onKeydown = (e) => {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    };

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    if (inputType) {
      inputEl.type = inputType;
      inputEl.value = '';
      inputEl.classList.remove('hidden');
      setTimeout(() => inputEl.focus(), 50);
    } else {
      inputEl.classList.add('hidden');
    }

    cancelBtn.style.display = alertOnly ? 'none' : '';
    dialog.classList.remove('hidden');

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    inputEl.addEventListener('keydown', onKeydown);
  });
}

function showAppPrompt(title, message, inputType = 'password') {
  return showAppDialog({ title, message, inputType, okText: 'Odblokuj', cancelText: 'Anuluj' });
}

function showAppConfirm(title, message) {
  return showAppDialog({ title, message, okText: 'Tak', cancelText: 'Anuluj' });
}

function showAppAlert(title, message) {
  return showAppDialog({ title, message, okText: 'OK', alertOnly: true });
}

// Funkcja zapisu stanu Dev Mode na serwerze i wyłączenia trybu symulacji przy zablokowaniu
async function saveDevModeStateOnServer(unlocked, password) {
  try {
    const res = await fetch('/api/settings/dev-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlocked, password })
    });
    if (res.ok) {
      settings.devModeUnlocked = unlocked;
      if (!unlocked && settings.checkoutDetails) {
        settings.checkoutDetails.testMode = false;
        if (setTestMode) {
          setTestMode.checked = false;
        }
      }
    }
  } catch (err) {
    console.error('Błąd zapisu stanu Dev Mode na serwerze:', err);
  }
}

// Funkcja aktualizacji interfejsu trybu deweloperskiego
function updateDevModeUI() {
  const isDevUnlocked = localStorage.getItem('devMode') === 'true';
  const testModeContainer = document.getElementById('test-mode-container');
  const devLockBtn = document.getElementById('btn-dev-lock');
  const statsPanel = document.getElementById('stats-panel');
  
  if (testModeContainer) {
    if (isDevUnlocked) {
      testModeContainer.style.display = 'block';
      if (setTestMode) {
        setTestMode.disabled = false;
      }
    } else {
      testModeContainer.style.display = 'none';
      if (setTestMode) {
        setTestMode.checked = false;
        setTestMode.disabled = true;
      }
    }
  }

  // Show/hide stats panel based on dev mode
  if (statsPanel) {
    statsPanel.style.display = isDevUnlocked ? 'block' : 'none';
  }
  
  if (devLockBtn) {
    if (isDevUnlocked) {
      devLockBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
        <span style="color: var(--accent-green); font-weight: 600;">Dev Mode</span>
      `;
    } else {
      devLockBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <span>Dev Mode</span>
      `;
    }
  }
}

// Obsługa kliknięcia przycisku Dev Mode
if (btnDevLock) {
  btnDevLock.addEventListener('click', async () => {
    const isDevUnlocked = localStorage.getItem('devMode') === 'true';
    if (isDevUnlocked) {
      const lock = await showAppConfirm(
        'Zablokuj Dev Mode',
        'Czy chcesz zablokować tryb deweloperski i ukryć opcje zaawansowane?'
      );
      if (lock) {
        localStorage.removeItem('devMode');
        updateDevModeUI();
        addSystemLog('Tryb deweloperski został zablokowany.');
        await saveDevModeStateOnServer(false);
      }
    } else {
      const pw = await showAppPrompt(
        'Dev Mode',
        'Podaj hasło deweloperskie, aby odblokować opcje zaawansowane.'
      );
      if (!pw) return;
      const res = await fetch('/api/settings/dev-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlocked: true, password: pw })
      });
      if (res.ok) {
        localStorage.setItem('devMode', 'true');
        updateDevModeUI();
        addSystemLog('Tryb deweloperski odblokowany pomyślnie!');
        settings.devModeUnlocked = true;
      } else {
        await showAppAlert('Dev Mode', 'Błędne hasło.');
      }
    }
  });
}

// Obsługa przycisku auto-uzupełniania danych testowych
if (btnFillTestData) {
  btnFillTestData.addEventListener('click', () => {
    setEmail.value = 'gckfxkvrgjkypphvse@jbsze.com';
    setPhone.value = '500000000';
    setBuyerName.value = 'Marek Tokarz';
    setStreet.value = 'Kolejowa 12';
    setZip.value = '30-340';
    setCity.value = 'Warszawa';
    setDeliveryMethod.value = 'dhl';
    setRebelLogin.value = 'gckfxkvrgjkypphvse@jbsze.com';
    setRebelPassword.value = 'testtest';
    
    togglePaczkomatVisibility();
    saveSettings(true);
    addSystemLog('Uznano i uzupełniono dane testowe (zostały zapisane).');
  });
}

// Obsługa akordeonu w ustawieniach globalnych
function initAccordionHeaders() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    // Avoid re-binding by checking a flag
    if (header._accordionBound) return;
    header._accordionBound = true;
    header.addEventListener('click', () => {
      const item = header.parentElement;
      
      // Zamykamy inne sekcje, aby oszczędzić miejsce i uniknąć scrollowania
      document.querySelectorAll('.accordion-item').forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });
      
      item.classList.toggle('active');
    });
  });
}
initAccordionHeaders();

// ============================================
// FEATURE 1: PROFILE ZAKUPOWE
// ============================================

function renderProfiles() {
  const list = document.getElementById('profiles-list');
  const select = document.getElementById('load-profile-select');
  
  if (select) {
    select.innerHTML = '<option value="">Wybierz profil...</option>' + profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  }

  if (!list) return;

  if (profiles.length === 0) {
    list.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; text-align: center; padding: 10px 0;">Brak profili. Kliknij poniżej, aby dodać pierwszy.</p>';
  } else {
    list.innerHTML = profiles.map(p => {
      const deliveryLabel = p.deliveryMethod === 'inpost' ? 'InPost' : 'DHL';
      return `
        <div class="profile-card">
          <div class="profile-card-info">
            <div class="profile-card-name">${p.name}</div>
            <div class="profile-card-detail">${p.email || '—'} · ${deliveryLabel}</div>
          </div>
          <div class="profile-card-actions">
            <button class="btn btn-secondary btn-small" onclick="editProfile('${p.id}')">Edytuj</button>
            <button class="btn btn-secondary btn-danger btn-small" onclick="deleteProfile('${p.id}')">Usuń</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function getProfileFormHtml(profile = null) {
  const p = profile || {};
  const isEdit = !!profile;
  const title = isEdit ? 'Edytuj profil' : 'Nowy profil zakupowy';
  return `
    <div class="profile-form" id="profile-form-container">
      <h3 style="margin-top: 0; font-size: 0.9rem;">${title}</h3>
      <div class="form-group">
        <label>Nazwa profilu</label>
        <input type="text" id="pf-name" value="${p.name || ''}" placeholder="np. Mój profil główny" required>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="pf-email" value="${p.email || ''}">
        </div>
        <div class="form-group">
          <label>Telefon</label>
          <input type="tel" id="pf-phone" value="${p.phone || ''}" placeholder="501502503">
        </div>
      </div>
      <div class="form-group">
        <label>Imię i Nazwisko</label>
        <input type="text" id="pf-buyerName" value="${p.buyerName || ''}" placeholder="Jan Kowalski">
      </div>
      <div class="form-group">
        <label>Ulica i nr</label>
        <input type="text" id="pf-street" value="${p.street || ''}" placeholder="Kolejowa 12">
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Kod pocztowy</label>
          <input type="text" id="pf-zipCode" value="${p.zipCode || ''}" placeholder="00-000">
        </div>
        <div class="form-group">
          <label>Miejscowość</label>
          <input type="text" id="pf-city" value="${p.city || ''}" placeholder="Warszawa">
        </div>
      </div>
      <div class="form-group">
        <label>Metoda dostawy</label>
        <select id="pf-deliveryMethod">
          <option value="inpost" ${p.deliveryMethod === 'inpost' || !p.deliveryMethod ? 'selected' : ''}>InPost Paczkomat 24/7</option>
          <option value="dhl" ${p.deliveryMethod === 'dhl' ? 'selected' : ''}>Przesyłka kurierska DHL</option>
        </select>
      </div>
      <div class="form-group">
        <label>Kod Paczkomatu</label>
        <input type="text" id="pf-paczkomat" value="${p.paczkomat || ''}" placeholder="np. WAW14A">
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Rebel.pl Email</label>
          <input type="email" id="pf-rebelLoginEmail" value="${p.rebelLoginEmail || ''}">
        </div>
        <div class="form-group">
          <label>Rebel.pl Hasło</label>
          <input type="password" id="pf-rebelPassword" value="${p.rebelPassword || ''}">
        </div>
      </div>
      <div class="profile-form-actions">
        <button type="button" class="btn btn-secondary btn-small" onclick="copySettingsToProfileForm()">Kopiuj z ustawień</button>
        <button type="button" class="btn btn-secondary btn-success btn-small" onclick="saveProfileForm(${isEdit ? '\'' + p.id + '\'' : 'null'})">${isEdit ? 'Zapisz' : 'Dodaj'}</button>
        <button type="button" class="btn btn-secondary btn-small" onclick="hideProfileForm()">Anuluj</button>
      </div>
    </div>
  `;
}

function showAddProfileForm() {
  editingProfileId = null;
  showingProfileForm = true;
  const list = document.getElementById('profiles-list');
  if (!list) return;
  // Prepend form
  const existingForm = document.getElementById('profile-form-container');
  if (existingForm) existingForm.remove();
  list.insertAdjacentHTML('afterbegin', getProfileFormHtml());
}

function editProfile(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;
  editingProfileId = id;
  showingProfileForm = true;
  const list = document.getElementById('profiles-list');
  if (!list) return;
  const existingForm = document.getElementById('profile-form-container');
  if (existingForm) existingForm.remove();
  list.insertAdjacentHTML('afterbegin', getProfileFormHtml(profile));
}

function hideProfileForm() {
  showingProfileForm = false;
  editingProfileId = null;
  const existingForm = document.getElementById('profile-form-container');
  if (existingForm) existingForm.remove();
}

function copySettingsToProfileForm() {
  const fields = {
    'pf-email': setEmail.value,
    'pf-phone': setPhone.value,
    'pf-buyerName': setBuyerName.value,
    'pf-street': setStreet.value,
    'pf-zipCode': setZip.value,
    'pf-city': setCity.value,
    'pf-paczkomat': setPaczkomat.value,
    'pf-rebelLoginEmail': setRebelLogin.value,
    'pf-rebelPassword': setRebelPassword.value
  };
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  const dm = document.getElementById('pf-deliveryMethod');
  if (dm) dm.value = setDeliveryMethod.value;
}

function getProfileFormData() {
  return {
    name: document.getElementById('pf-name').value,
    email: document.getElementById('pf-email').value,
    phone: document.getElementById('pf-phone').value,
    buyerName: document.getElementById('pf-buyerName').value,
    street: document.getElementById('pf-street').value,
    zipCode: document.getElementById('pf-zipCode').value,
    city: document.getElementById('pf-city').value,
    deliveryMethod: document.getElementById('pf-deliveryMethod').value,
    paczkomat: document.getElementById('pf-paczkomat').value,
    rebelLoginEmail: document.getElementById('pf-rebelLoginEmail').value,
    rebelPassword: document.getElementById('pf-rebelPassword').value
  };
}

async function saveProfileForm(editId) {
  const data = getProfileFormData();
  if (!data.name.trim()) {
    alert('Nazwa profilu jest wymagana.');
    return;
  }

  try {
    let res;
    if (editId) {
      res = await fetch(`/api/profiles/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } else {
      res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }

    if (res.ok) {
      const saved = await res.json();
      if (editId) {
        const idx = profiles.findIndex(p => p.id === editId);
        if (idx !== -1) profiles[idx] = saved;
        addSystemLog(`Profil "${saved.name}" zaktualizowany.`);
      } else {
        profiles.push(saved);
        addSystemLog(`Dodano nowy profil: "${saved.name}".`);
      }
      hideProfileForm();
      renderProfiles();
      renderTasks(); // refresh profile badges
    } else {
      const err = await res.json();
      alert(`Błąd: ${err.error}`);
    }
  } catch (err) {
    console.error('Błąd zapisu profilu:', err);
    alert('Błąd sieciowy podczas zapisu profilu.');
  }
}

async function deleteProfile(id) {
  const profile = profiles.find(p => p.id === id);
  const name = profile ? profile.name : id;
  if (!confirm(`Czy na pewno chcesz usunąć profil "${name}"?`)) return;
  try {
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    if (res.ok) {
      profiles = profiles.filter(p => p.id !== id);
      renderProfiles();
      renderTasks();
      addSystemLog(`Usunięto profil: "${name}".`);
    }
  } catch (err) {
    console.error('Błąd usuwania profilu:', err);
  }
}

function loadSettingsFromProfile() {
  const select = document.getElementById('load-profile-select');
  if (!select || !select.value) {
    alert('Wybierz profil z listy najpierw.');
    return;
  }
  
  const p = profiles.find(pr => pr.id === select.value);
  if (!p) return;
  
  const mapping = {
    'set-email': p.email,
    'set-phone': p.phone,
    'set-buyer-name': p.buyerName,
    'set-street': p.street,
    'set-zip': p.zipCode,
    'set-city': p.city,
    'set-delivery-method': p.deliveryMethod,
    'set-paczkomat': p.paczkomat,
    'set-rebel-login': p.rebelLoginEmail,
    'set-rebel-password': p.rebelPassword
  };
  
  for (const [id, val] of Object.entries(mapping)) {
    const el = document.getElementById(id);
    if (el && val !== undefined) {
      el.value = val;
    }
  }
  
  togglePaczkomat();
  addSystemLog(`Załadowano dane do wysyłki z profilu: "${p.name}". Kliknij Zapisz Ustawienia, aby je zachować na stałe.`);
}

// Bind add-profile button
const btnAddProfile = document.getElementById('btn-add-profile');
if (btnAddProfile) {
  btnAddProfile.addEventListener('click', showAddProfileForm);
}

// ============================================
// FEATURE 2: DROP SCHEDULER
// ============================================

async function saveDropSchedule(id) {
  const dropTimeInput = document.getElementById(`edit-drop-time-${id}`);
  const turboWindowInput = document.getElementById(`edit-turbo-window-${id}`);
  const turboIntervalInput = document.getElementById(`edit-turbo-interval-${id}`);

  const dropTime = dropTimeInput && dropTimeInput.value ? new Date(dropTimeInput.value).toISOString() : null;
  const turboWindow = turboWindowInput ? parseInt(turboWindowInput.value) || 10 : 10;
  const turboInterval = turboIntervalInput ? parseInt(turboIntervalInput.value) || 5 : 5;

  try {
    const res = await fetch(`/api/tasks/${id}/drop-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropTime, turboWindow, turboInterval })
    });
    if (res.ok) {
      const task = tasks.find(t => t.id === id);
      if (task) {
        task.dropTime = dropTime;
        task.turboWindow = turboWindow;
        task.turboInterval = turboInterval;
      }
      addSystemLog(`Ustawiono harmonogram dropu dla zadania.`);
    }
  } catch (err) {
    console.error('Błąd zapisu harmonogramu dropu:', err);
  }
}

// Global countdown timer - updates every second
function updateDropCountdowns() {
  const countdownEls = document.querySelectorAll('.drop-countdown[data-drop-time]');
  const now = Date.now();
  countdownEls.forEach(el => {
    const dropTime = new Date(el.dataset.dropTime).getTime();
    const diff = dropTime - now;
    if (diff <= 0) {
      el.textContent = 'Drop teraz!';
    } else {
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      el.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  });
}
setInterval(updateDropCountdowns, 1000);

// ============================================
// FEATURE 3: STATS DASHBOARD
// ============================================

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      statsData = await res.json();
      renderStats(statsData);
    }
  } catch (err) {
    // Stats endpoint may not exist yet - silently fail
    console.log('Stats endpoint not available:', err.message);
  }
}

// Refresh stats every 30s
setInterval(() => {
  const isDevUnlocked = localStorage.getItem('devMode') === 'true';
  if (isDevUnlocked) fetchStats();
}, 30000);

const btnClearStats = document.getElementById('btn-clear-stats');
if (btnClearStats) {
  btnClearStats.addEventListener('click', async () => {
    const ok = await showAppConfirm('Wyczyść statystyki', 'Wyczyścić historię checkoutów i sprawdzeń dostępności?');
    if (!ok) return;
    try {
      const res = await fetch('/api/stats/clear', { method: 'POST' });
      if (res.ok) {
        statsData = await res.json();
        renderStats(statsData);
        addSystemLog('Statystyki wyczyszczone.');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Nie udało się wyczyścić statystyk.');
      }
    } catch (err) {
      alert(`Błąd sieci: ${err.message}`);
    }
  });
}

function renderStats(stats) {
  if (!stats) return;
  const grid = document.getElementById('stats-grid');
  const availList = document.getElementById('availability-list');
  if (!grid) return;

  const fastest = stats.fastestCheckout != null ? `${(stats.fastestCheckout / 1000).toFixed(1)}s` : '—';
  const averageRecent = stats.averageCheckoutRecent != null
    ? `${(stats.averageCheckoutRecent / 1000).toFixed(1)}s`
    : (stats.averageCheckout != null ? `${(stats.averageCheckout / 1000).toFixed(1)}s` : '—');
  const rate = stats.successRate != null ? Math.round(stats.successRate) : 0;
  const total = stats.totalCheckouts != null ? stats.totalCheckouts : 0;

  const circumference = 2 * Math.PI * 20;
  const offset = circumference - (circumference * rate / 100);

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${fastest}</div>
      <div class="stat-label">Najszybszy checkout</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${averageRecent}</div>
      <div class="stat-label">Średni czas (ostatnie 10)</div>
    </div>
    <div class="stat-card">
      <div class="circular-progress">
        <svg width="48" height="48" viewBox="0 0 48 48">
          <defs>
            <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#a78bfa"/>
              <stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
          </defs>
          <circle class="progress-bg" cx="24" cy="24" r="20"/>
          <circle class="progress-fill" cx="24" cy="24" r="20" 
                  stroke-dasharray="${circumference}" 
                  stroke-dashoffset="${offset}"/>
        </svg>
        <span class="progress-text">${rate}%</span>
      </div>
      <div class="stat-label">Success rate</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${total}</div>
      <div class="stat-label">Ilość checkoutów</div>
    </div>
  `;

  // Draw chart
  drawCheckoutChart((stats.checkoutHistory || []).filter(c => c.success));

  // Render availability list
  if (availList) {
    const checks = stats.availabilityChecks || [];
    if (checks.length === 0) {
      availList.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 10px 0;">Brak danych o sprawdzeniach.</p>';
    } else {
      availList.innerHTML = checks.slice(0, 20).map(check => {
        const icon = check.available ? 'DOSTĘPNY' : 'BRAK';
        const price = check.price ? `${check.price} zł` : '—';
        const time = new Date(check.timestamp).toLocaleString('pl-PL');
        const name = check.productName || 'Produkt';
        return `
          <div class="availability-item">
            <span class="avail-icon">${icon}</span>
            <span class="avail-name" title="${name}">${name}</span>
            <span class="avail-price">${price}</span>
            <span class="avail-time">${time}</span>
          </div>
        `;
      }).join('');
    }
  }

  if (clusterStatsLine && stats.cluster) {
    const checks = stats.cluster.checks;
    const checkouts = stats.cluster.checkouts;
    if (checks && checkouts) {
      clusterStatsLine.textContent =
        `Klastr: ${checks.browsers}/${checks.maxBrowsers} przeglądarek · ` +
        `${checks.activeContexts} aktywnych checków · ` +
        `kolejka checków: ${checks.queue.pending} · ` +
        `checkout: ${checkouts.running} aktywnych, ${checkouts.pending} w kolejce`;
    }
  }
}

function drawCheckoutChart(history) {
  const canvas = document.getElementById('checkout-chart');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.clientWidth || 700;
  const displayH = 250;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, displayW, displayH);

  const data = history.filter(entry => entry.success).slice(-10);
  if (data.length === 0) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Brak danych o checkoutach', displayW / 2, displayH / 2);
    return;
  }

  const stepColors = {
    addToCart: '#8b5cf6',
    cartLoad: '#6366f1',
    login: '#3b82f6',
    cartPrep: '#a855f7',
    delivery: '#10b981',
    payment: '#f59e0b',
    billing: '#ef4444',
    terms: '#06b6d4',
    other: '#4b5563'
  };
  const stepLabels = {
    addToCart: 'koszyk',
    cartLoad: 'kasa',
    login: 'login',
    cartPrep: 'przygot.',
    delivery: 'dostawa',
    payment: 'płatność',
    billing: 'dane',
    terms: 'regulamin',
    other: 'inne'
  };
  const stepKeys = ['addToCart', 'cartLoad', 'login', 'cartPrep', 'delivery', 'payment', 'billing', 'terms', 'other'];

  const entryTotalSec = (entry) => {
    if (entry.totalTime != null && entry.totalTime > 0) return entry.totalTime;
    return stepKeys.reduce((sum, key) => sum + ((entry.steps && entry.steps[key]) || 0), 0);
  };

  const entrySegments = (entry) => {
    const total = entryTotalSec(entry);
    const steps = entry.steps || {};
    const raw = {};
    let trackedSum = 0;
    for (const key of stepKeys) {
      if (key === 'other') continue;
      const val = steps[key] || 0;
      if (val > 0) {
        raw[key] = val;
        trackedSum += val;
      }
    }

    const segments = {};
    if (total <= 0) return { total: 0, segments };

    if (trackedSum <= 0) {
      segments.other = total;
      return { total, segments };
    }

    // Stare wpisy mają nakładające się kroki (cartPrep liczył też koszyk) — skaluj do totalTime
    if (trackedSum > total) {
      const scale = total / trackedSum;
      for (const key of Object.keys(raw)) {
        segments[key] = raw[key] * scale;
      }
      return { total, segments };
    }

    Object.assign(segments, raw);
    const remainder = total - trackedSum;
    if (remainder > 0.05) segments.other = remainder;
    return { total, segments };
  };

  // Skala Y = max totalTime + zapas na etykietę nad słupkiem
  let maxTotal = 0;
  data.forEach(entry => {
    const total = entryTotalSec(entry);
    if (total > maxTotal) maxTotal = total;
  });
  if (maxTotal === 0) maxTotal = 10;
  const yMax = maxTotal * 1.18 + 0.3;

  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40;
  const chartW = displayW - paddingLeft - paddingRight;
  const chartH = displayH - paddingTop - paddingBottom;
  const barWidth = Math.min(40, (chartW / data.length) * 0.6);
  const barGap = (chartW - barWidth * data.length) / (data.length + 1);

  // Y axis grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = paddingTop + (chartH / 4) * i;
    const val = ((yMax * (4 - i)) / 4).toFixed(1);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(displayW - paddingRight, y);
    ctx.stroke();
    ctx.fillText(`${val}s`, paddingLeft - 8, y + 4);
  }

  // Draw stacked bars (wysokość = totalTime z logu)
  data.forEach((entry, i) => {
    const x = paddingLeft + barGap * (i + 1) + barWidth * i;
    const { total, segments } = entrySegments(entry);
    let yOffset = paddingTop + chartH;

    stepKeys.forEach(key => {
      const val = segments[key] || 0;
      const barH = (val / yMax) * chartH;
      if (barH > 0.5) {
        yOffset -= barH;
        ctx.fillStyle = stepColors[key];
        ctx.beginPath();
        ctx.roundRect(x, yOffset, barWidth, barH, [2, 2, 0, 0]);
        ctx.fill();
      }
    });

    if (total > 0) {
      ctx.fillStyle = '#f3f4f6';
      ctx.font = 'bold 11px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(total.toFixed(1) + 's', x + barWidth / 2, yOffset - 6);
    }

    // Label under bar
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`#${i + 1}`, x + barWidth / 2, displayH - paddingBottom + 16);
  });

  // Legend
  const legendY = displayH - 10;
  let legendX = paddingLeft;
  ctx.font = '10px Outfit, sans-serif';
  stepKeys.forEach(key => {
    if (key === 'other') return;
    const label = stepLabels[key] || key;
    ctx.fillStyle = stepColors[key];
    ctx.fillRect(legendX, legendY - 8, 8, 8);
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'left';
    ctx.fillText(label, legendX + 12, legendY);
    legendX += ctx.measureText(label).width + 24;
  });
}

// Inicjalizacja stanu Dev Mode
updateDevModeUI();

// Uruchomienie połączenia
connectWebSocket();

// Wymuszenie idealnego zrównania kart (piksel w piksel)
function alignCardHeights() {
  if (window.innerWidth <= 1024) return;
  
  const addMonitorCard = document.querySelector('.control-panel .card:nth-child(1)');
  const activeMonitorsCard = document.querySelector('.status-panel .card:nth-child(1)');
  const monitorsList = document.getElementById('monitors-list');
  
  if (addMonitorCard && activeMonitorsCard && monitorsList) {
    const targetHeight = addMonitorCard.offsetHeight;
    activeMonitorsCard.style.height = targetHeight + 'px';
    activeMonitorsCard.style.display = 'flex';
    activeMonitorsCard.style.flexDirection = 'column';
    monitorsList.style.flex = '1';
    monitorsList.style.height = 'auto';
    monitorsList.style.minHeight = '0';
    monitorsList.style.maxHeight = 'none';
  }

  const settingsCard = document.querySelector('.control-panel .card:nth-child(2)');
  const logsCard = document.querySelector('.status-panel .card.console-card');
  const consoleTerminal = document.getElementById('console-terminal');
  
  if (settingsCard && logsCard && consoleTerminal && !window.logsHeightLocked) {
    const targetHeight = settingsCard.offsetHeight;
    logsCard.style.height = targetHeight + 'px';
    logsCard.style.display = 'flex';
    logsCard.style.flexDirection = 'column';
    consoleTerminal.style.flex = '1';
    consoleTerminal.style.height = 'auto';
    consoleTerminal.style.minHeight = '0';
    consoleTerminal.style.maxHeight = 'none';
    window.logsHeightLocked = true; // Zablokuj wysokość, aby nie rosła przy rozwijaniu akordeonów
  }
}

window.addEventListener('load', alignCardHeights);
window.addEventListener('resize', () => {
  window.logsHeightLocked = false; 
  alignCardHeights();
});
