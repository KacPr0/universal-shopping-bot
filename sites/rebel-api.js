/**
 * Rebel.pl — szybkie ścieżki przez wewnętrzne API sklepu (z scripts.js).
 */

const REBEL_BASE = 'https://www.rebel.pl';
const EASY_PACK_SDK = 'https://geowidget.easypack24.net/js/sdk-for-javascript.js';

function extractProductId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/-(\d+)\.html(?:[?#]|$)/i) || url.match(/[?&]product_id=(\d+)/i);
  return match ? match[1] : null;
}

async function rebelFetch(page, path, { method = 'GET', body } = {}) {
  return page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, {
      method,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include'
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  }, { path, method, body });
}

async function getCartInfo(page) {
  const result = await rebelFetch(page, '/shopping/cart/info');
  if (!result.ok || !result.data) return null;
  const content = result.data.content || result.data.data?.content || result.data;
  return content;
}

async function clearCartViaApi(page, log) {
  const info = await getCartInfo(page);
  const items = info?.items || info?.cart?.items || [];
  const quantity = info?.total_quantity ?? info?.totalQuantity ?? items.length;

  if (!quantity || quantity === 0) {
    return true;
  }

  log(`[API] Czyszczenie koszyka (${quantity} szt.)...`);
  const truncated = await rebelFetch(page, '/shopping/cart/truncate');
  if (truncated.ok) {
    log('[API] Koszyk opróżniony (truncate).');
    return true;
  }

  for (const item of items) {
    const id = item.product_id || item.id;
    if (!id) continue;
    await rebelFetch(page, `/shopping/cart/remove/${id}`, { method: 'POST', body: {} });
  }
  log('[API] Koszyk wyczyszczony (remove per item).');
  return true;
}

async function addToCartViaApi(page, productId, quantity, log) {
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  log(`[API] POST /shopping/cart/add/${productId}/${qty}`);
  const result = await rebelFetch(page, `/shopping/cart/add/${productId}/${qty}`, {
    method: 'POST',
    body: {}
  });

  if (!result.ok) {
    log(`[API] Dodanie do koszyka nie powiodło się (HTTP ${result.status}).`);
    return false;
  }

  const content = result.data?.content || result.data?.data?.content;
  const totalQty = content?.total_quantity ?? content?.totalQuantity;
  log(`[API] Produkt dodany do koszyka${totalQty != null ? ` (razem: ${totalQty} szt.)` : ''}.`);
  return true;
}

/** Zielony kwadracik przy „1. Sposób dostawy” = klasa checkout__step--ready */
async function isDeliveryStepReady(page) {
  return page.locator('.checkout__step--delivery-method.checkout__step--ready').isVisible({ timeout: 1500 }).catch(() => false);
}

const INPOST_HOOKS_SCRIPT = () => {
  if (window.__rebelInPostHooksInstalled) return;
  window.__rebelInPostHooksInstalled = true;

  const patchEasyPack = () => {
      if (typeof easyPack === 'undefined' || !easyPack.mapWidget || easyPack.__rebelBotPatched) return false;
      const origMapWidget = easyPack.mapWidget.bind(easyPack);
      easyPack.mapWidget = function (mapId, onSelect) {
        const widget = origMapWidget(mapId, onSelect);
        window.__rebelInPostWidget = widget;
        window.__rebelInPostOnSelect = onSelect;
        window.__rebelSelectPaczkomat = (code) => {
          if (typeof onSelect !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no-onSelect' });
          }
          return new Promise((resolve) => {
            try {
              onSelect({ name: code });
            } catch (e) {
              resolve({ ok: false, reason: e.message });
              return;
            }
            const deadline = Date.now() + 10000;
            const wait = () => {
              const ready = document.querySelector('.checkout__step--delivery-method.checkout__step--ready');
              if (ready) {
                resolve({ ok: true });
                return;
              }
              if (Date.now() > deadline) {
                resolve({ ok: false, reason: 'choosePoint-timeout' });
                return;
              }
              setTimeout(wait, 150);
            };
            wait();
          });
        };
        return widget;
      };
      easyPack.__rebelBotPatched = true;
      return true;
    };

  const poll = setInterval(() => {
    if (patchEasyPack()) clearInterval(poll);
  }, 100);
  setTimeout(() => clearInterval(poll), 60000);
};

/** Przechwytuje callback mapWidget → choosePoint() w JS Rebela */
async function installInPostHooks(page) {
  await page.addInitScript(INPOST_HOOKS_SCRIPT);
  await page.evaluate(INPOST_HOOKS_SCRIPT).catch(() => {});
}

async function ensureEasyPackSdk(page, log) {
  const hasSdk = await page.evaluate(() => {
    return typeof easyPack !== 'undefined'
      || [...document.scripts].some(s => (s.src || '').includes('easypack24.net'));
  }).catch(() => false);

  if (hasSdk) return true;

  log('Ładowanie SDK InPost (geowidget)...');
  const loaded = await page.evaluate((sdkUrl) => new Promise((resolve) => {
    if (typeof easyPack !== 'undefined') {
      resolve(true);
      return;
    }
    const existing = [...document.scripts].find(s => (s.src || '').includes('easypack24.net'));
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(typeof easyPack !== 'undefined'), 8000);
      return;
    }
    const script = document.createElement('script');
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    setTimeout(() => resolve(typeof easyPack !== 'undefined'), 10000);
  }), EASY_PACK_SDK).catch(() => false);

  return loaded;
}

async function triggerInPostRadioChange(page) {
  await page.locator('label[for="delivery-method-INPOST"]').click({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => {
    const radio = document.querySelector('input#delivery-method-INPOST');
    if (!radio) return;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openPaczkomatyTab(page) {
  const tabSelectors = [
    '.checkout__providers-item label[href="#paczkomaty"]',
    'label[href="#paczkomaty"]',
    '#paczkomaty-tab',
    'a[href="#paczkomaty"]'
  ];

  for (const sel of tabSelectors) {
    const tab = page.locator(sel).first();
    if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tab.click().catch(() => {});
      break;
    }
  }

  await page.evaluate(() => {
    const tab = document.querySelector('label[href="#paczkomaty"], a[href="#paczkomaty"]');
    if (tab) tab.click();
    const pane = document.querySelector('#paczkomaty');
    if (pane && pane.classList.contains('tab-pane') && !pane.classList.contains('active')) {
      pane.classList.add('active', 'show');
    }
  }).catch(() => {});

  // Rebel debounce na initGeowidget: 500 ms
  await page.waitForTimeout(700);
}

async function runEasyPackAsyncInit(page, log) {
  const ran = await page.evaluate(() => {
    if (typeof window.easyPackAsyncInit === 'function') {
      try {
        window.easyPackAsyncInit();
        return 'called';
      } catch (e) {
        return `error:${e.message}`;
      }
    }
    return 'missing';
  }).catch(() => 'evaluate-failed');

  if (ran === 'called') {
    log('Zainicjalizowano widget InPost (easyPackAsyncInit).');
    return true;
  }
  if (ran.startsWith('error:')) {
    log(`easyPackAsyncInit błąd: ${ran.slice(6)}`);
  }
  return false;
}

async function waitForInPostWidget(page, timeoutMs = 15000) {
  try {
    await page.waitForFunction(() => {
      if (typeof easyPack !== 'undefined' && easyPack.mapWidget) return true;
      return document.querySelector('#easypack-map .easypack-search, #easypack-search, #easypack-map.easypack-widget');
    }, { timeout: timeoutMs });
    return true;
  } catch (e) {
    return false;
  }
}

async function initInPostGeowidget(page, log) {
  await installInPostHooks(page);
  await triggerInPostRadioChange(page);
  await openPaczkomatyTab(page);
  await ensureEasyPackSdk(page, log);
  await runEasyPackAsyncInit(page, log);

  const ready = await waitForInPostWidget(page, 12000);
  if (!ready) {
    log('Widget InPost nie pojawił się — ponawiam inicjalizację...');
    await openPaczkomatyTab(page);
    await runEasyPackAsyncInit(page, log);
    await waitForInPostWidget(page, 8000);
  }
}

async function selectViaRebelCallback(page, code, log) {
  const result = await page.evaluate(async (paczkomatCode) => {
    if (typeof window.__rebelSelectPaczkomat === 'function') {
      return window.__rebelSelectPaczkomat(paczkomatCode);
    }
    return { ok: false, reason: 'no-callback' };
  }, code).catch(() => ({ ok: false, reason: 'evaluate-failed' }));

  if (result?.ok) {
    log(`Paczkomat ${code} wybrany przez choosePoint() Rebela.`);
    return true;
  }
  if (result?.reason && result.reason !== 'no-callback') {
    log(`choosePoint() nie powiódł się: ${result.reason}`);
  }
  return false;
}

async function clickWybierzPaczkomat(page, log) {
  const chooseSelectors = [
    '#easypack-map button:has-text("Wybierz")',
    '#easypack-map a:has-text("Wybierz")',
    '#paczkomaty button:has-text("Wybierz")',
    '#paczkomaty a:has-text("Wybierz")',
    '#easypack-widget button:has-text("Wybierz")',
    '.easypack-widget-button-select',
    '.easypack-button-select'
  ];

  for (const sel of chooseSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      log(`Klikanie „Wybierz”: ${sel}`);
      await btn.click({ force: true }).catch(async () => {
        await btn.evaluate(el => el.click()).catch(() => {});
      });
      return true;
    }
  }
  return false;
}

async function selectViaSearchUi(page, code, log) {
  const searchSelectors = [
    '#easypack-search',
    '#easypack-map input[type="search"]',
    '#easypack-map input[type="text"]',
    '.easypack-search-widget input'
  ];

  let searchInput = null;
  for (const sel of searchSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      searchInput = loc;
      break;
    }
  }

  if (!searchInput) {
    log('Pole wyszukiwania InPost niedostępne.');
    return false;
  }

  log(`Wyszukiwanie paczkomatu w mapie: ${code}`);
  await searchInput.fill('');
  await searchInput.fill(code);

  let clickedSuggest = false;
  const suggestScopes = ['#easypack-map', '#searchWidget', '#paczkomaty'];
  for (const scope of suggestScopes) {
    const item = page.locator(scope).locator('*').filter({ hasText: code }).first();
    if (await item.isVisible({ timeout: 1500 }).catch(() => false)) {
      await item.click().catch(() => {});
      clickedSuggest = true;
      break;
    }
  }

  if (!clickedSuggest) {
    const searchBtn = page.locator('#easypack-map .btn-search, .easypack-search-widget .btn-search').first();
    if (await searchBtn.isVisible().catch(() => false)) {
      await searchBtn.click();
    } else {
      await searchInput.press('Enter');
    }
    await page.waitForResponse(
      res => {
        const u = res.url().toLowerCase();
        return u.includes('inpost.pl') || u.includes('easypack');
      },
      { timeout: 5000 }
    ).catch(() => {});
  }

  if (await clickWybierzPaczkomat(page, log)) {
    return true;
  }

  // searchLockerPoint na przechwyconym widgecie
  const viaWidget = await page.evaluate(async (paczkomatCode) => {
    const widget = window.__rebelInPostWidget;
    if (!widget || typeof widget.searchLockerPoint !== 'function') {
      return false;
    }
    widget.searchLockerPoint(paczkomatCode);
    await new Promise(r => setTimeout(r, 1500));
    const btn = document.querySelector('#easypack-map button, #easypack-map a');
    const buttons = [...document.querySelectorAll('#easypack-map button, #easypack-map a')];
    const wybierz = buttons.find(b => (b.textContent || '').trim().toLowerCase() === 'wybierz');
    if (wybierz) {
      wybierz.click();
      return true;
    }
    return false;
  }, code).catch(() => false);

  return viaWidget;
}

async function selectInPostPaczkomatFast(page, paczkomat, log) {
  const code = (paczkomat || '').trim().toUpperCase();
  if (!code) return false;

  if (await isDeliveryStepReady(page)) {
    log('Krok dostawy już ukończony.');
    return true;
  }

  await initInPostGeowidget(page, log);

  // 1) Natywny choosePoint() Rebela (najpewniejsze — ustawia setDeliveryReady + renderTotal)
  if (await selectViaRebelCallback(page, code, log)) {
    if (await isDeliveryStepReady(page)) {
      const summary = await page.locator('.checkout__step--delivery-method .checkout__step-summary').first().innerText().catch(() => '');
      log(`Paczkomat potwierdzony${summary ? `: ${summary.trim().slice(0, 80)}` : ''}.`);
      return true;
    }
  }

  // 2) UI mapy: wyszukiwarka + „Wybierz”
  if (await selectViaSearchUi(page, code, log)) {
    await page.locator('.checkout__step--delivery-method.checkout__step--ready').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    if (await isDeliveryStepReady(page)) {
      const summary = await page.locator('.checkout__step--delivery-method .checkout__step-summary').first().innerText().catch(() => '');
      log(`Paczkomat potwierdzony (UI)${summary ? `: ${summary.trim().slice(0, 80)}` : ''}.`);
      return true;
    }
  }

  // 3) Ponowna próba choosePoint po UI (widget mógł się dopiero zainicjalizować)
  await runEasyPackAsyncInit(page, log);
  if (await selectViaRebelCallback(page, code, log) && await isDeliveryStepReady(page)) {
    log('Paczkomat potwierdzony (retry choosePoint).');
    return true;
  }

  log('[BŁĄD] Paczkomat nie został potwierdzony — brak zielonego znacznika przy „Sposób dostawy”.');
  return false;
}

module.exports = {
  REBEL_BASE,
  extractProductId,
  clearCartViaApi,
  addToCartViaApi,
  isDeliveryStepReady,
  installInPostHooks,
  selectInPostPaczkomatFast
};
