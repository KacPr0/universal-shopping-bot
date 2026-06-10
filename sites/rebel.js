/**
 * Adapter dla sklepu Rebel.pl
 */

const SELECTORS = require('./rebel-selectors');
const {
  parseSearchQuery,
  buildSearchPhrases,
  findBestProductMatch,
  validateProductName
} = require('./lib/productSearch');
const {
  extractProductId,
  clearCartViaApi,
  addToCartViaApi,
  installInPostHooks,
  selectInPostPaczkomatFast
} = require('./rebel-api');

const CHECKOUT_BTN_SELECTORS = SELECTORS.checkoutButtons;

/**
 * Loguje użytkownika automatycznie, jeśli pojawi się formularz logowania (strona lub modal).
 */
/** @returns {number} Czas logowania w sekundach (0 jeśli logowanie nie było potrzebne). */
async function handleLoginIfRequired(page, details, log) {
  const email = details.rebelLoginEmail;
  const password = details.rebelPassword;
  let loginElapsed = 0;

  const loginSelectors = SELECTORS.login.email;
  const passwordSelectors = SELECTORS.login.password;
  const submitSelectors = SELECTORS.login.submit;

  const loginUrl = page.url();
  const waitTimeout = (loginUrl.includes('/security') || loginUrl.includes('/login')) ? 5000 : 500;
  
  try {
    await page.locator(SELECTORS.login.visibleWait).first().waitFor({ state: 'visible', timeout: waitTimeout });
  } catch (e) {
    // Brak formularza logowania - nie jest wymagany w tym kroku
  }

  let loginInput = null;
  for (const sel of loginSelectors) {
    try {
      const locator = page.locator(sel);
      const count = await locator.count();
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i);
        if (await el.isVisible()) {
          loginInput = el;
          break;
        }
      }
      if (loginInput) break;
    } catch (e) {}
  }

  if (loginInput) {
    let passwordInput = null;
    for (const sel of passwordSelectors) {
      try {
        const locator = page.locator(sel);
        const count = await locator.count();
        for (let i = 0; i < count; i++) {
          const el = locator.nth(i);
          if (await el.isVisible()) {
            passwordInput = el;
            break;
          }
        }
        if (passwordInput) break;
      } catch (e) {}
    }

    if (passwordInput) {
      log('Wykryto widoczny formularz logowania do Rebel.pl.');
      if (!email || !password) {
        const errorMsg = 'Logowanie jest wymagane, ale dane logowania (e-mail/hasło) dla Rebel.pl nie zostały skonfigurowane w panelu Ustawień!';
        log(`[BŁĄD] ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      const tLoginStart = Date.now();
      
      // Agresywne czyszczenie autouzupełnionych danych i wpisanie nowych
      // Używamy evaluate() bo autofill przeglądarki może blokować fill()
      const currentEmail = await loginInput.inputValue().catch(() => '');
      if (currentEmail !== email) {
        log(`Wpisywanie e-maila (autouzupełnione: "${currentEmail}")...`);
        // Force-clear przez JS + fill
        await loginInput.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await loginInput.fill(email);
      } else {
        log('E-mail prawidłowy.');
      }

      const currentPassword = await passwordInput.inputValue().catch(() => '');
      if (currentPassword !== password) {
        log('Wpisywanie hasła...');
        await passwordInput.evaluate(el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await passwordInput.fill(password);
      } else {
        log('Hasło prawidłowe.');
      }

      // "Zapamiętaj mnie" - szybkie zaznaczenie bez pętli
      try {
        const rememberChk = page.locator(SELECTORS.login.rememberQuick).first();
        if (await rememberChk.isVisible().catch(() => false)) {
          await rememberChk.check().catch(() => {});
        }
      } catch (e) {}

      // Klikanie przycisku logowania
      let clickedSubmit = false;
      for (const btnSel of submitSelectors) {
        try {
          const locator = page.locator(btnSel);
          const count = await locator.count();
          let btn = null;
          for (let i = 0; i < count; i++) {
            const el = locator.nth(i);
            if (await el.isVisible() && await el.isEnabled()) {
              btn = el;
              break;
            }
          }
          if (btn) {
            log(`Klikanie przycisku logowania: ${btnSel}`);
            await btn.click();
            clickedSubmit = true;
            // Warp Mode: Dynamiczne oczekiwanie na zniknięcie formularza logowania zamiast sztywnego 4s
            await Promise.race([
              page.waitForURL(url => !url.includes('/security'), { timeout: 8000 }).catch(() => {}),
              page.locator('#login_login').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {}),
              page.locator('.modal.show .modal-dialog').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {})
            ]);
            // Krótka chwila na ustabilizowanie DOM po przekierowaniu/zamknięciu modala
            await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
            break;
          }
        } catch (e) {}
      }

      if (!clickedSubmit) {
        const errorMsg = 'Nie udało się kliknąć przycisku logowania (brak przycisku lub zablokowany).';
        log(`[BŁĄD] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Sprawdzamy czy logowanie się powiodło (czy formularz nadal jest widoczny)
      const postLoginInputVisible = await loginInput.isVisible().catch(() => false);
      if (postLoginInputVisible) {
        let errorText = '';
        try {
          const invalidFeedback = page.locator('.invalid-feedback, .error, .alert-danger, .flash-message--danger').first();
          if (await invalidFeedback.isVisible()) {
            errorText = await invalidFeedback.innerText();
          }
        } catch (e) {}
        
        const errorMsg = `Logowanie nie powiodło się (formularz nadal widoczny). ${errorText ? 'Błąd: ' + errorText.trim() : ''}`;
        log(`[BŁĄD] ${errorMsg}`);
        throw new Error(errorMsg);
      } else {
        log('Logowanie do Rebel.pl zakończone sukcesem.');
        loginElapsed = (Date.now() - tLoginStart) / 1000;
        log(`[BENCHMARK] Automatyczne logowanie: ${loginElapsed.toFixed(2)}s`);
      }
    }
  }

  return loginElapsed;
}

function isProductHref(href) {
  if (!href || !href.endsWith('.html')) return false;
  return !(
    href.includes('/cart') ||
    href.includes('/checkout') ||
    href.includes('/szukaj') ||
    href.includes('/login') ||
    href.includes('/register') ||
    href.includes('/site/')
  );
}

function resolveRebelUrl(href) {
  return href.startsWith('http') ? href : new URL(href, 'https://www.rebel.pl').toString();
}

async function extractSearchResults(page) {
  const cards = await page.locator(SELECTORS.search.productCards).all();
  const products = [];

  for (const card of cards) {
    try {
      let href = await card.getAttribute('data-url');
      if (!href) {
        href = await card.locator('a[href$=".html"]').first().getAttribute('href').catch(() => null);
      }
      if (!isProductHref(href)) continue;

      let name = (await card.getAttribute('data-name').catch(() => '')) || '';
      const titleLocators = [
        '.product__title a',
        '.product__title',
        '.product__name',
        '.product-name',
        'h2',
        'h3',
        'a[href$=".html"]'
      ];
      if (!name) {
        for (const sel of titleLocators) {
          const loc = card.locator(sel).first();
          if (await loc.count()) {
            name = (await loc.innerText().catch(() => '')).trim();
            if (name) break;
          }
        }
      }
      if (!name) {
        name = (await card.innerText().catch(() => '')).trim().split('\n')[0];
      }
      if (!name) continue;

      products.push({ name, href: resolveRebelUrl(href) });
    } catch (e) {}
  }

  return products;
}

async function waitForSearchResults(page) {
  await page
    .waitForFunction(
      () => {
        const products = document.querySelectorAll('#search-results .js-product, #search-results .product');
        const noResults = document.querySelector('#no-results:not(.d-none), .search--no-items');
        return products.length > 0 || noResults;
      },
      { timeout: 20000 }
    )
    .catch(() => {});
}

/**
 * Wyszukuje produkt na Rebel.pl po frazie i zwraca URL najlepszego dopasowania.
 */
async function findProductUrlBySearch(page, input, log) {
  const { searchPhrase, negativeWords } = parseSearchQuery(input);
  const phrases = buildSearchPhrases(searchPhrase);

  for (const phrase of phrases) {
    log(`Wyszukiwanie na Rebel.pl: "${phrase}"`);
    const searchUrl = `https://www.rebel.pl/site/search?phrase=${encodeURIComponent(phrase)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForSearchResults(page);

    const products = await extractSearchResults(page);
    log(`Znaleziono ${products.length} wyników dla frazy "${phrase}".`);

    if (products.length === 0) continue;

    const match = findBestProductMatch(input, products, { negativeWords, minScore: 0.65 });
    if (match) {
      log(`Dopasowanie (${Math.round(match.score * 100)}%): "${match.name}" -> ${match.href}`);
      return match.href;
    }
  }

  return null;
}

/**
 * Sprawdza dostępność produktu.
 * @param {import('playwright').Page} page
 * @param {string} urlOrQuery
 * @param {function} log
 */
async function checkAvailability(page, inputUrl, log) {
  if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
    log(`Wyszukiwanie produktu na Rebel.pl według słów kluczowych: "${inputUrl}"`);

    const resolvedUrl = await findProductUrlBySearch(page, inputUrl, log);
    if (!resolvedUrl) {
      log('Brak produktów pasujących do słów kluczowych.');
      return { available: false, resolvedUrl: null };
    }

    return await checkAvailability(page, resolvedUrl, log);
  }

  let resolvedUrl = inputUrl;

  log(`Przechodzenie na stronę produktu: ${resolvedUrl}`);
  await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Warp Mode: Czekamy na pojawienie się przycisku "Dodaj do koszyka" lub info o niedostępności zamiast sztywnych 2s
  await Promise.race([
    page.locator(SELECTORS.availability.productWait).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {}),
    page.locator(SELECTORS.availability.unavailableText).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  ]);

  let productName = 'Nieznany produkt';
  try {
    productName = await page.locator('h1').first().innerText();
    productName = productName.trim();
  } catch (err) {
    log(`Nie udało się odczytać nazwy produktu: ${err.message}`);
  }

  let price = 'Nieznana cena';
  try {
    const priceElement = page.locator(SELECTORS.availability.price).first();
    if (await priceElement.isVisible()) {
      price = await priceElement.innerText();
      price = price.trim();
    }
  } catch (err) {
    log(`Nie udało się odczytać ceny: ${err.message}`);
  }

  let isAvailable = false;
  for (const selector of SELECTORS.availability.addToCart) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible() && await button.isEnabled()) {
        isAvailable = true;
        break;
      }
    } catch (e) {}
  }

  if (isAvailable) {
    const pageText = await page.innerText('body');
    if (SELECTORS.availability.outOfStockPhrases.some(phrase => pageText.includes(phrase))) {
      log('Wykryto informację o braku dostępności produktu.');
      isAvailable = false;
    }
  }

  return {
    available: isAvailable,
    productName,
    price,
    resolvedUrl
  };
}

/**
 * Automatycznie przechodzi przez proces zakupu (checkout) jako gość.
 */
async function checkout(page, url, details, log) {
  log(`Rozpoczynanie checkoutu dla: ${url}`);
  await installInPostHooks(page);
  const tStart = Date.now();
  let tStepStart = Date.now();

  // Zmienne do zbierania czasów poszczególnych kroków
  let addToCartTime = null;
  let cartLoadTime = null;
  let loginTime = null;
  let cartPrepTime = null;
  let deliveryTime = null;
  let paymentTime = null;
  let billingTime = null;
  let termsTime = null;
  
  const currentUrl = page.url();
  let onCheckout = currentUrl.includes('/shopping/checkout');
  let onCart = currentUrl.includes('/shopping/cart');

  if (!onCheckout && !onCart) {
    const tProductStart = Date.now();
    const productId = extractProductId(url);
    let addedViaApi = false;

    await page.goto(url, { waitUntil: 'commit' });

    if (productId) {
      await clearCartViaApi(page, log).catch(() => {});
      addedViaApi = await addToCartViaApi(page, productId, details.quantity || 1, log);
    }

    if (!addedViaApi) {
      try {
        const cartBadge = page.locator('.toolbar__cart .badge').first();
        const badgeText = await cartBadge.innerText().catch(() => '0');
        if (parseInt(badgeText, 10) > 0) {
          log(`[Koszyk] Wykryto ${badgeText} produkt(ów) w koszyku z poprzedniego runu. Czyszczenie...`);
          await clearCartViaApi(page, log).catch(async () => {
            await page.goto('https://www.rebel.pl/shopping/cart', { waitUntil: 'domcontentloaded' });
            const removeButtons = page.locator('.cart--remove a, .cart--remove button, a[title="Usuń"], button[title="Usuń"]');
            let removeCount = await removeButtons.count();
            if (removeCount > 10) removeCount = 10;
            for (let i = 0; i < removeCount; i++) {
              await removeButtons.first().click().catch(() => {});
              await page.waitForResponse(res => res.url().includes('/cart') && res.status() === 200, { timeout: 1000 }).catch(() => {});
            }
            await page.goto(url, { waitUntil: 'domcontentloaded' });
          });
        }
      } catch (e) {}

      log('Klikanie przycisku "Dodaj do koszyka"...');
      const buyBtnSelectors = [
        'button:has-text("dodaj do koszyka")',
        'button:has-text("Dodaj do koszyka")',
        '.add-to-cart-button',
        'button.add-to-cart'
      ];

      let clicked = false;
      for (const sel of buyBtnSelectors) {
        try {
          const btn = page.locator(sel).first();
          await btn.waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
          if (await btn.isVisible()) {
            await btn.click({ force: true });
            clicked = true;
            break;
          }
        } catch (e) {}
      }

      if (!clicked) {
        return { success: false, error: 'Nie znaleziono przycisku "Dodaj do koszyka".' };
      }

      await Promise.race([
        page.waitForResponse(response => response.url().includes('/cart/'), { timeout: 1200 }).catch(() => {}),
        page.locator('.toolbar__cart .badge').evaluate(el => new Promise(resolve => {
          if (el.textContent.trim() !== '0') return resolve();
          const obs = new MutationObserver(() => {
            if (el.textContent.trim() !== '0') { obs.disconnect(); resolve(); }
          });
          obs.observe(el, { childList: true, characterData: true, subtree: true });
          setTimeout(resolve, 1200);
        })).catch(() => {})
      ]);
    }

    log(`[BENCHMARK] ${addedViaApi ? 'API' : 'DOM'} add-to-cart: ${((Date.now() - tProductStart) / 1000).toFixed(2)}s`);
    addToCartTime = (Date.now() - tProductStart) / 1000;

    const tCartStart = Date.now();

    if (addedViaApi) {
      log('Skrót API: bezpośrednio do kasy (pomijanie koszyka)...');
      await page.goto('https://www.rebel.pl/shopping/checkout', { waitUntil: 'domcontentloaded' });

      const postGotoResult = await Promise.race([
        page.locator('#deliveryMethodContent').waitFor({ state: 'attached', timeout: 8000 }).then(() => 'checkout').catch(() => null),
        page.locator('#login_login').waitFor({ state: 'attached', timeout: 8000 }).then(() => 'login').catch(() => null),
        page.waitForURL('**/security**', { timeout: 8000 }).then(() => 'login-page').catch(() => null)
      ]);

      cartLoadTime = (Date.now() - tCartStart) / 1000;

      if (postGotoResult === 'checkout' || page.url().includes('/shopping/checkout')) {
        const loginVisible = await page.locator('#login_login').isVisible().catch(() => false);
        if (!loginVisible) {
          onCheckout = true;
        }
      }
    } else if (details.quantity && details.quantity > 1) {
      log(`Przechodzenie na stronę koszyka (wymagana zmiana ilości na ${details.quantity})...`);
      await page.goto('https://www.rebel.pl/shopping/cart', { waitUntil: 'domcontentloaded' });
      await page.locator('#checkout-shopping-cart, .shopping-cart__list').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      log(`[BENCHMARK] Przejście do koszyka i załadowanie strony: ${((Date.now() - tCartStart) / 1000).toFixed(2)}s`);
      cartLoadTime = (Date.now() - tCartStart) / 1000;
      onCart = true;
      
      loginTime = await handleLoginIfRequired(page, details, log);

      const tCheckoutGotoStart = Date.now();
      log(`Przechodzenie do kasy...`);
      let wentToCheckout = false;
      for (const sel of CHECKOUT_BTN_SELECTORS) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible()) {
            await btn.click();
            wentToCheckout = true;
            break;
          }
        } catch (e) {}
      }

      if (!wentToCheckout) {
        await page.goto('https://www.rebel.pl/shopping/checkout', { waitUntil: 'domcontentloaded' });
      }

      const postClickResult = await Promise.race([
        page.waitForURL('**/shopping/checkout**', { timeout: 10000 }).then(() => 'checkout').catch(() => null),
        page.locator('#login_login:visible').waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login').catch(() => null),
        page.waitForURL('**/security**', { timeout: 10000 }).then(() => 'login-page').catch(() => null)
      ]);

      if (postClickResult === 'checkout') {
        await page.locator('#deliveryMethodContent').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        onCheckout = true;
      }
    } else {
      // FAST TRACK: Bezpośrednio do checkout
      log('Skrót: przechodzenie bezpośrednio do kasy (pomijanie koszyka)...');
      await page.goto('https://www.rebel.pl/shopping/checkout', { waitUntil: 'domcontentloaded' });
      
      // Czekamy deterministycznie: albo załaduje się kasa, albo formularz logowania (przekierowanie)
      const postGotoResult = await Promise.race([
        page.locator('#deliveryMethodContent').waitFor({ state: 'attached', timeout: 8000 }).then(() => 'checkout').catch(() => null),
        page.locator('#login_login').waitFor({ state: 'attached', timeout: 8000 }).then(() => 'login').catch(() => null),
        page.waitForURL('**/security**', { timeout: 8000 }).then(() => 'login-page').catch(() => null)
      ]);

      cartLoadTime = (Date.now() - tCartStart) / 1000;
      
      if (postGotoResult === 'checkout' || page.url().includes('/shopping/checkout')) {
         // Upewnijmy się że faktycznie nie ma formularza logowania (czasem url to checkout a ładuje logowanie)
         const loginVisible = await page.locator('#login_login').isVisible().catch(() => false);
         if (!loginVisible) {
           onCheckout = true;
         }
      }
    }
  }

  // Weryfikacja logowania (jeśli po kliknięciu "DALEJ" wyskoczył modal na koszyku lub przekierowało na /security)
  if (!onCheckout) {
    loginTime = await handleLoginIfRequired(page, details, log);
  }

  // Sprawdzamy, czy wciąż jesteśmy na stronie koszyka (np. po zalogowaniu w modalu nie przeszło automatycznie dalej)
  if (page.url().includes('/shopping/cart')) {
    log('Po zalogowaniu wciąż jesteśmy na stronie koszyka.');

    // Zmiana ilości sztuk w koszyku PO zalogowaniu (żeby przeładowanie strony po logowaniu nie zresetowało ilości)
    if (details.quantity && details.quantity > 1) {
      const tQtyStart = Date.now();
      log(`[Koszyk] Zmiana ilości sztuk na: ${details.quantity}...`);
      // Czekamy na załadowanie koszyka po logowaniu
      await page.locator('#checkout-shopping-cart .cart--quantity input').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      try {
        const qtyInput = page.locator('#checkout-shopping-cart .cart--quantity input').first();
        
        // Odczytujemy aktualną wartość, aby wiedzieć czy trzeba ją zmieniać
        const currentQty = await qtyInput.inputValue().catch(() => '1');
        log(`[Koszyk] Aktualna ilość w polu: ${currentQty}, docelowa: ${details.quantity}`);
        
        if (parseInt(currentQty) !== details.quantity) {
          await qtyInput.click({ clickCount: 3 }); // Zaznacz cały tekst
          await qtyInput.fill(details.quantity.toString());
          
          // Wymuszenie zdarzeń JS, aby koszyk przeliczył sumę i odpytał serwer
          await qtyInput.dispatchEvent('input');
          await qtyInput.dispatchEvent('change');
          // Naciśnięcie Tab wymusza blur i triggeruje update koszyka na rebel.pl
          await page.keyboard.press('Tab');
          
          // Czekamy na AJAX odpowiedź serwera z przeliczeniem koszyka
          await page.waitForResponse(
            response => response.url().includes('/cart') && response.status() === 200,
            { timeout: 3000 }
          ).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
          
          // Weryfikacja: odczytujemy wartość ponownie
          const updatedQty = await qtyInput.inputValue().catch(() => '?');
          log(`[Koszyk] Ilość po aktualizacji: ${updatedQty}`);
          log(`[BENCHMARK] Zmiana ilości sztuk w koszyku: ${((Date.now() - tQtyStart) / 1000).toFixed(2)}s`);
        } else {
          log(`[Koszyk] Ilość już prawidłowa (${currentQty}), pomijam zmianę.`);
        }
      } catch (e) {
        log(`[Koszyk] Nie udało się wpisać ilości (Błąd: ${e.message}). Próba klikania przycisku "+"...`);
        try {
          const incrementBtn = page.locator('#checkout-shopping-cart .cart--quantity .increment').first();
          await incrementBtn.waitFor({ state: 'visible', timeout: 3000 });
          
          for (let i = 0; i < details.quantity - 1; i++) {
            await incrementBtn.click();
            await page.waitForTimeout(250);
          }
          log(`[Koszyk] Pomyślnie zwiększono ilość o ${details.quantity - 1} za pomocą przycisku "+".`);
          await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
          log(`[BENCHMARK] Zmiana ilości sztuk w koszyku (kliknięcie "+"): ${((Date.now() - tQtyStart) / 1000).toFixed(2)}s`);
        } catch (err) {
          log(`[Koszyk] Błąd podczas alternatywnego klikania "+": ${err.message}`);
        }
      }
    }

    log('Klikamy "Dalej" ponownie...');
    let clickedAgain = false;
    for (const sel of CHECKOUT_BTN_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible()) {
          log(`Ponowne klikanie przycisku kasy: ${sel}`);
          await btn.click();
          clickedAgain = true;
          break;
        }
      } catch (e) {}
    }
    // Warp Mode: Dynamiczne oczekiwanie na checkout zamiast sztywnych 3s
    await page.waitForURL('**/shopping/checkout**', { timeout: 5000 }).catch(() => {});
    await page.locator('#deliveryMethodContent').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  }

  // Sprawdzamy czy na pewno jesteśmy w checkout (nie na stronie logowania /security)
  const currentUrlAfterLogin = page.url();
  if (currentUrlAfterLogin.includes('/security') || currentUrlAfterLogin.includes('/site/login')) {
    return { success: false, error: 'Bot utknął na stronie logowania. Logowanie nie powiodło się lub brak danych.' };
  }

  // Od tego momentu mierzymy tylko przygotowanie formularza kasy (bez nawigacji/koszyka)
  tStepStart = Date.now();

  // Usuwamy baner cookie Didomi jeśli istnieje, aby nie zasłaniał elementów
  try {
    log('Czyszczenie banerów nakładkowych/cookie...');
    await page.evaluate(() => {
      const host = document.getElementById('didomi-host');
      if (host) host.remove();
      const notice = document.getElementById('didomi-notice');
      if (notice) notice.remove();
      document.body.style.overflow = 'auto';
      document.body.classList.remove('didomi-popup-open');
      document.documentElement.classList.remove('didomi-popup-open');
    }).catch(() => {});
  } catch (e) {
    log(`Ostrzeżenie przy usuwaniu banera cookie: ${e.message}`);
  }

  log(`[BENCHMARK] Przygotowanie koszyka i logowanie: ${((Date.now() - tStepStart) / 1000).toFixed(2)}s`);
  cartPrepTime = (Date.now() - tStepStart) / 1000;
  tStepStart = Date.now();

  // Upewniamy się najpierw, że sekcja dostawy jest rozwinięta, ponieważ InPost i DHL są w niej zdefiniowane
  try {
    const deliveryContent = page.locator('#deliveryMethodContent').first();
    const isCollapsed = await deliveryContent.evaluate(el => !el.classList.contains('show'));
    if (isCollapsed) {
      log('Sekcja dostawy jest zwinięta. Próba rozwinięcia...');
      const deliveryHeader = page.locator('a[href="#deliveryMethodContent"], a[aria-controls="deliveryMethodContent"]').first();
      await deliveryHeader.click();
      // Warp Mode: Czekamy aż sekcja otrzyma klasę 'show' (animacja CSS) zamiast sztywnych 1.5s
      await deliveryContent.evaluate(async el => {
        for (let i = 0; i < 30; i++) {
          if (el.classList.contains('show')) return;
          await new Promise(r => setTimeout(r, 50));
        }
      }).catch(() => {});
    }
  } catch (e) {
    log(`Nie udało się zweryfikować/rozwinąć sekcji dostawy: ${e.message}`);
  }

  const fillField = async (selectors, value) => {
    if (!value) return false;
    for (const sel of selectors) {
      try {
        const field = page.locator(sel).first();
        if (await field.isVisible()) {
          await field.fill('');
          await field.fill(value);
          return true;
        }
      } catch (e) {}
    }
    return false;
  };

  // Wypełniamy e-mail (który jest wspólny na samej górze)
  await fillField(['input[name="email"]', 'input[type="email"]', '#customer-email'], details.email);

  let selectedInpost = false;
  let inpostFastPath = false;

  const deliveryMethod = details.deliveryMethod || (details.paczkomat ? 'inpost' : 'dhl');

  if (deliveryMethod === 'inpost') {
    log('Wybieranie opcji dostawy "InPost Paczkomat"...');
    const inpostLabel = page.locator('label[for="delivery-method-INPOST"]').first();
    const inpostRadio = page.locator('input#delivery-method-INPOST').first();

    if (await inpostLabel.isVisible().catch(() => false)) {
      await inpostLabel.click().catch(() => {});
    }
    await inpostRadio.check({ force: true }).catch(() => {});
    await inpostRadio.dispatchEvent('change').catch(() => {});
    selectedInpost = await inpostRadio.isChecked().catch(() => false)
      || await page.locator('#paczkomaty').isVisible().catch(() => false);

    if (selectedInpost) {
      log('InPost Paczkomat zaznaczony.');
    }
  } else {
    // ----------------------------------------------------
    // FLOW DHL KURIER (Wyszukanie i zaznaczenie DHL Kurier oraz wypełnienie adresu)
    // ----------------------------------------------------
    log(`Wybieranie opcji dostawy "Przesyłka kurierska DHL"...`);
    const dhlLabel = page.locator('label[for="delivery-method-DHL-DETAL"]').first();
    const dhlRadio = page.locator('input#delivery-method-DHL-DETAL').first();
    let selectedDhl = false;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        if (await dhlLabel.isVisible()) {
          log(`Klikanie opcji DHL (próba ${attempt})...`);
          await dhlLabel.click();
          
          const isChecked = await dhlRadio.isChecked();
          if (isChecked) {
            log(`Sukces: DHL Kurier został zaznaczony.`);
            selectedDhl = true;
            break;
          } else {
            log(`Opcja DHL nie została jeszcze zaznaczona, ponawiam...`);
          }
        } else {
          log(`Etykieta DHL jest niewidoczna w próbie ${attempt}.`);
        }
      } catch (e) {
        log(`Błąd przy zaznaczaniu DHL (próba ${attempt}): ${e.message}`);
      }
      await page.waitForTimeout(200);
    }

    if (!selectedDhl) {
      log('Próba bezpośredniego zaznaczenia (check force) radia DHL...');
      try {
        await dhlRadio.check({ force: true });
        await page.waitForTimeout(200);
        if (await dhlRadio.isChecked()) {
          log('Sukces: Radio DHL zaznaczone bezpośrednio.');
          selectedDhl = true;
        }
      } catch (e) {
        log(`Błąd bezpośredniego zaznaczania radia: ${e.message}`);
      }
    }

    log(`Wypełnianie formularza dostawy kurierskiej DHL...`);
    
    // Wypełniamy Imię i Nazwisko (Nazwa nabywcy / odbiorcy)
    await fillField([
      '#shippingaddress_name',
      '#billingaddress_name',
      'input[name="shippingaddress[name]"]',
      'input[name="billingaddress[name]"]',
      'input[name="billing[name]"]',
      'input[name="name"]',
      'input[name="shipping[name]"]'
    ], details.buyerName);

    await fillField([
      'input[name="telephone"]',
      '#telephone',
      'input[name="shipping[telephone]"]'
    ], details.phone);

    await fillField([
      '#shippingaddress_street',
      'input[name="shippingaddress[street]"]',
      'input[name="street[0]"]',
      'input[name="shipping[street][0]"]'
    ], details.street);

    await fillField([
      '#shippingaddress_zip',
      'input[name="shippingaddress[zip]"]',
      'input[name="postcode"]',
      'input[name="shipping[postcode]"]'
    ], details.zipCode);

    await fillField([
      '#shippingaddress_city',
      'input[name="shippingaddress[city]"]',
      'input[name="city"]',
      'input[name="shipping[city]"]'
    ], details.city);

    log(`Formularz adresowy DHL wypełniony.`);

    // Klikamy "DODAJ ADRES" jeśli przycisk jest widoczny i aktywny
    const addAddressBtn = page.locator('#checkout__address--save, button:has-text("Dodaj adres")').first();
    if (await addAddressBtn.isVisible()) {
      log('Klikanie przycisku "DODAJ ADRES"...');
      await addAddressBtn.click();
      // Warp Mode: Czekamy na ukończenie zapytania sieciowego
      await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    }
  }

  if (selectedInpost && details.paczkomat) {
    log(`Wprowadzanie kodu Paczkomatu: ${details.paczkomat}...`);
    inpostFastPath = await selectInPostPaczkomatFast(page, details.paczkomat, log);
    if (!inpostFastPath) {
      return { success: false, error: `Nie udało się potwierdzić paczkomatu ${details.paczkomat} (brak zielonego znacznika przy dostawie).` };
    }
  } else if (selectedInpost && !details.paczkomat) {
    return { success: false, error: 'Wybrano InPost, ale nie podano kodu paczkomatu w ustawieniach.' };
  }

  log(`[BENCHMARK] Wybór dostawy i adresu: ${((Date.now() - tStepStart) / 1000).toFixed(2)}s`);
  deliveryTime = (Date.now() - tStepStart) / 1000;
  tStepStart = Date.now();

  // Przejście dalej / Rozwinięcie płatności
  log('Rozwijanie sekcji płatności...');
  try {
    const paymentContent = page.locator('#paymentMethodContent').first();
    const paymentHeader = page.locator('a[data-href="#paymentMethodContent"], a[href="#paymentMethodContent"], .checkout__step--payment-method a').first();
    
    // Warp Mode: Czekamy aż nagłówek przestanie mieć klasę 'disabled' (AJAX po wyborze dostawy)
    await paymentHeader.evaluate(async el => {
      for (let i = 0; i < 100; i++) {
        if (!el.classList.contains('disabled')) return;
        await new Promise(r => setTimeout(r, 50));
      }
    }).catch(() => {});

    const isPaymentCollapsed = await paymentContent.evaluate(el => !el.classList.contains('show'));
    if (isPaymentCollapsed) {
      log('Klikanie nagłówka sekcji płatności...');
      await paymentHeader.click();
      // Warp Mode: Czekamy na animację rozwinięcia
      await paymentContent.evaluate(async el => {
        for (let i = 0; i < 20; i++) {
          if (el.classList.contains('show')) return;
          await new Promise(r => setTimeout(r, 100));
        }
      }).catch(() => {});
    }
  } catch (e) {
    log(`Błąd przy rozwijaniu sekcji płatności: ${e.message}`);
  }

  // 2. WYBÓR PŁATNOŚCI (Autopay)
  log(`Wybieranie opcji płatności "Autopay"...`);
  const autopayLabel = page.locator('label[for="payment-method-BLUEMEDIA"], label[for*="bluemedia"], label[for*="BLUEMEDIA"], label[for*="autopay"], label[for*="Autopay"]').first();
  const autopayRadio = page.locator('input#payment-method-BLUEMEDIA, input[id*="bluemedia"], input[id*="BLUEMEDIA"], input[id*="autopay"], input[id*="Autopay"]').first();

  let selectedAutopay = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (await autopayLabel.isVisible()) {
        log(`Klikanie opcji Autopay (próba ${attempt})...`);
        
        if (deliveryMethod === 'inpost' && !inpostFastPath) {
          await page.waitForResponse(res => res.url().includes('checkout') && res.status() === 200, { timeout: 3000 }).catch(() => {});
        }

        await autopayLabel.click({ force: true });
        
        // Wymuszenie zdarzeń JS żeby strona załapała zmianę płatności (częsty problem przy szybkich botach)
        await autopayRadio.evaluate(el => {
           el.checked = true;
           el.dispatchEvent(new Event('change', { bubbles: true }));
           el.dispatchEvent(new Event('input', { bubbles: true }));
        }).catch(() => {});
        
        // Warp Mode: Czekamy krótko aż radio zostanie zaznaczone
        await autopayRadio.evaluate(async el => {
          for (let i = 0; i < 15; i++) {
            if (el.checked) return;
            await new Promise(r => setTimeout(r, 100));
          }
        }).catch(() => {});
        
        // Czekamy na przetworzenie płatności przez serwer (np. przeliczenie koszyka)
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        
        const isChecked = await autopayRadio.isChecked();
        if (isChecked) {
          log(`Sukces: Płatność Autopay została zaznaczona.`);
          selectedAutopay = true;
          break;
        } else {
          log(`Opcja Autopay nie została jeszcze zaznaczona, ponawiam...`);
        }
      } else {
        log(`Etykieta Autopay jest niewidoczna w próbie ${attempt}.`);
      }
    } catch (e) {
      log(`Błąd przy zaznaczaniu Autopay (próba ${attempt}): ${e.message}`);
    }
  }

  if (!selectedAutopay) {
    log('Próba bezpośredniego zaznaczenia (check force) radia Autopay...');
    try {
      await autopayRadio.check({ force: true });
      await autopayRadio.evaluate(async el => {
        for (let i = 0; i < 15; i++) {
          if (el.checked) return;
          await new Promise(r => setTimeout(r, 100));
        }
      }).catch(() => {});
      if (await autopayRadio.isChecked()) {
        log('Sukces: Radio Autopay zaznaczone bezpośrednio.');
        selectedAutopay = true;
      }
    } catch (e) {
      log(`Błąd bezpośredniego zaznaczania radia Autopay: ${e.message}`);
    }
  }

  log(`[BENCHMARK] Wybór płatności Autopay: ${((Date.now() - tStepStart) / 1000).toFixed(2)}s`);
  paymentTime = (Date.now() - tStepStart) / 1000;
  tStepStart = Date.now();

  // 3. WYPEŁNIENIE DANYCH ZAMAWIAJĄCEGO (KROK 3 - Billing Details)
  log('Wypełnianie danych zamawiającego (Krok 3)...');
  try {
    const billingContent = page.locator('#billing').first();
    const billingHeader = page.locator('a[data-href="#billing"], a[href="#billing"], .checkout__step--billing-details a').first();
    
    // Warp Mode: Czekamy aż sekcja danych zamawiającego przestanie mieć klasę 'disabled'
    await billingHeader.evaluate(async el => {
      for (let i = 0; i < 100; i++) {
        if (!el.classList.contains('disabled')) return;
        await new Promise(r => setTimeout(r, 50));
      }
    }).catch(() => {});

    const isBillingCollapsed = await billingContent.evaluate(el => !el.classList.contains('show'));
    if (isBillingCollapsed) {
      log('Klikanie nagłówka sekcji danych zamawiającego...');
      await billingHeader.click();
      // Warp Mode: Czekamy na animację rozwinięcia
      await billingContent.evaluate(async el => {
        for (let i = 0; i < 20; i++) {
          if (el.classList.contains('show')) return;
          await new Promise(r => setTimeout(r, 100));
        }
      }).catch(() => {});
    }

    // Wypełniamy pola danych zamawiającego
    await fillField(['#billingaddress_name', 'input[name="billingaddress[name]"]'], details.buyerName);
    await fillField(['#billingaddress_street', 'input[name="billingaddress[street]"]'], details.street);
    await fillField(['#billingaddress_zip', 'input[name="billingaddress[zip]"]'], details.zipCode);
    await fillField(['#billingaddress_city', 'input[name="billingaddress[city]"]'], details.city);
    await fillField(['#billingaddress_phone', 'input[name="billingaddress[phone]"]'], details.phone);

    log('Klikanie przycisku Zapisz w danych zamawiającego...');
    const billingSubmitBtn = page.locator('#billingaddress_submit, button:has-text("Zapisz")').first();
    if (await billingSubmitBtn.isVisible()) {
      await billingSubmitBtn.click();
      // Warp Mode: Czekamy aż etykieta regulaminu lub przycisk finalny stanie się widoczny (sam input może być ukryty przez CSS)
      await page.locator('label[for="edit_checkout_accept_rules"], #edit_checkout_submit').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }
  } catch (e) {
    log(`Błąd przy wypełnianiu danych zamawiającego: ${e.message}`);
  }

  log(`[BENCHMARK] Dane zamawiającego (Krok 3): ${((Date.now() - tStepStart) / 1000).toFixed(2)}s`);
  billingTime = (Date.now() - tStepStart) / 1000;
  tStepStart = Date.now();

  // 4. AKCEPTACJA REGULAMINU / WARUNKÓW ZAMÓWIENIA
  log('Zaznaczanie akceptacji regulaminu (warunki zamówienia)...');
  try {
    const termsCheckbox = page.locator('input#edit_checkout_accept_rules').first();

    // Sprawdźmy czy checkbox już jest zaznaczony
    const isAlreadyChecked = await termsCheckbox.isChecked().catch(() => false);
    if (!isAlreadyChecked) {
      log('Błyskawiczne zaznaczanie regulaminu (JS click)...');
      // Najszybsze i niezawodne zaznaczenie z pominięciem warstw graficznych
      await termsCheckbox.evaluate(el => el.click()).catch(() => {});
      
      // Fallback w razie niepowodzenia (bardzo rzadkie)
      const isCheckedNow = await termsCheckbox.isChecked().catch(() => false);
      if (!isCheckedNow) {
        log('Próba alternatywnego kliknięcia w etykietę...');
        const label = page.locator('label[for="edit_checkout_accept_rules"]').first();
        await label.click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
      }
      
      // Warp Mode: Czekamy aż przycisk finalny stanie się aktywny (zdjęta blokada disabled)
      const submitBtn = page.locator('#edit_checkout_submit').first();
      await submitBtn.evaluate(async el => {
        for (let i = 0; i < 40; i++) {
          if (!el.disabled && !el.classList.contains('disabled')) return;
          await new Promise(r => setTimeout(r, 50));
        }
      }).catch(() => {});
    } else {
      log('Regulamin był już zaakceptowany.');
    }
  } catch (e) {
    log(`Błąd podczas zaznaczania akceptacji regulaminu: ${e.message}`);
  }

  log(`[BENCHMARK] Akceptacja regulaminu: ${((Date.now() - tStepStart) / 1000).toFixed(2)}s`);
  termsTime = (Date.now() - tStepStart) / 1000;
  log(`[BENCHMARK] CAŁKOWITY CZAS CHECKOUTU: ${((Date.now() - tStart) / 1000).toFixed(2)}s`);

  // Sprawdzamy czy tryb testowy (testMode) jest włączony (domyślnie jest włączony dla bezpieczeństwa)
  const isTestMode = details.testMode !== false;
  if (isTestMode) {
    log('[SYMULACJA] Regulamin zaakceptowany. Zatrzymano bota przed kliknięciem "KUPUJĘ I PŁACĘ" (tryb testowy aktywny).');
    
    // Czyszczenie koszyka po teście wyłączone na życzenie użytkownika
  } else {
    log('[ZAKUP] Tryb testowy wyłączony. Klikanie przycisku finalnego "KUPUJĘ I PŁACĘ"...');
    try {
      const submitBtn = page.locator('#edit_checkout_submit').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click({ force: true });
        log('[ZAKUP] Kliknięto przycisk finalny. Zamówienie zostało wysłane i przekierowane do Autopay.');
        // Czekamy na przekierowanie do bramki płatności
        await page.waitForURL(url => !url.includes('rebel.pl/shopping/checkout'), { timeout: 15000 }).catch(() => {});
      } else {
        log('[BŁĄD ZAKUPU] Przycisk finalny "#edit_checkout_submit" nie jest widoczny.');
      }
    } catch (e) {
      log(`[BŁĄD ZAKUPU] Błąd podczas klikania przycisku finalnego: ${e.message}`);
    }
  }

  return { 
    success: true, 
    totalTime: ((Date.now() - tStart) / 1000),
    steps: {
      addToCart: addToCartTime,
      cartLoad: cartLoadTime,
      login: loginTime,
      cartPrep: cartPrepTime,
      delivery: deliveryTime,
      payment: paymentTime,
      billing: billingTime,
      terms: termsTime
    }
  };
}

module.exports = {
  checkAvailability,
  checkout
};
