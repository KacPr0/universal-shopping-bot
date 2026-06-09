/**
 * Adapter dla sklepu Pokemon Center (pokemoncenter.com)
 */

const { validateProductName } = require('./lib/productSearch');

/**
 * Rozpoznaje czy wejście to URL czy fraza do wyszukiwania. Jeśli fraza, wyszukuje produkt i zwraca jego URL.
 */
async function resolveProductUrl(page, input, log) {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }
  
  log(`Wyszukiwanie produktu na Pokemon Center dla frazy: "${input}"`);
  
  // Przejście na URL wyszukiwania
  const searchUrl = `https://www.pokemoncenter.com/search/${encodeURIComponent(input)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const productLinkSelector = 'a[href*="/product/"]';
  try {
    const links = await page.locator(productLinkSelector).all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      const text = await link.innerText();
      const cleanText = text.trim();
      
      if (href && cleanText.length > 2 && validateProductName(input, cleanText)) {
        const resolved = href.startsWith('http') ? href : new URL(href, 'https://www.pokemoncenter.com').toString();
        log(`Znaleziono produkt pasujący do nazwy: "${cleanText}" -> ${resolved}`);
        return resolved;
      }
    }
  } catch (e) {}
  
  // Rezerwowa próba przez formularz wyszukiwania na głównej
  log(`Rezerwowa próba wyszukiwania za pomocą formularza na stronie głównej...`);
  await page.goto('https://www.pokemoncenter.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  const searchInputSelectors = [
    'input[type="search"]',
    'input[name="q"]',
    '#search-input',
    'input[placeholder*="Search"]'
  ];
  
  let filled = false;
  for (const sel of searchInputSelectors) {
    try {
      const inputEl = page.locator(sel).first();
      if (await inputEl.isVisible()) {
        await inputEl.fill(input);
        await inputEl.press('Enter');
        filled = true;
        break;
      }
    } catch (e) {}
  }
  
  if (filled) {
    await page.waitForTimeout(4000);
    const links = await page.locator(productLinkSelector).all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      const text = await link.innerText();
      const cleanText = text.trim();
      
      if (href && cleanText.length > 2 && validateProductName(input, cleanText)) {
        const resolved = href.startsWith('http') ? href : new URL(href, 'https://www.pokemoncenter.com').toString();
        log(`Znaleziono produkt pasujący do nazwy (metoda formularza): "${cleanText}" -> ${resolved}`);
        return resolved;
      }
    }
  }
  
  throw new Error(`Brak pasujących wyników wyszukiwania na Pokemon Center dla frazy: "${input}"`);
}

/**
 * Sprawdza dostępność produktu.
 * @param {import('playwright').Page} page
 * @param {string} urlOrQuery
 * @param {function} log
 */
async function checkAvailability(page, urlOrQuery, log) {
  let resolvedUrl;
  try {
    resolvedUrl = await resolveProductUrl(page, urlOrQuery, log);
  } catch (err) {
    log(`[BŁĄD] Błąd wyszukiwania: ${err.message}`);
    return { available: false, resolvedUrl: null };
  }

  log(`Przechodzenie na stronę produktu: ${resolvedUrl}`);
  await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  let productName = 'Nieznany produkt Pokémon';
  try {
    productName = await page.locator('h1').first().innerText();
    productName = productName.trim();
  } catch (err) {
    log(`Nie udało się odczytać nazwy: ${err.message}`);
  }

  let price = 'Nieznana cena';
  try {
    const priceSelectors = [
      '.product-price',
      '.price',
      '[data-testid="product-price"]',
      '.product-details__price'
    ];
    for (const sel of priceSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible()) {
        price = await el.innerText();
        price = price.trim();
        break;
      }
    }
  } catch (err) {
    log(`Nie udało się odczytać ceny: ${err.message}`);
  }

  const buyBtnSelectors = [
    'button:has-text("Add to Cart")',
    'button:has-text("Add to cart")',
    'button.add-to-cart',
    'input[value="Add to Cart"]',
    '[data-testid="add-to-cart-button"]'
  ];

  let isAvailable = false;
  for (const selector of buyBtnSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible() && await button.isEnabled()) {
        const text = await button.innerText();
        if (!text.toLowerCase().includes('out of stock') && !text.toLowerCase().includes('unavailable')) {
          isAvailable = true;
          break;
        }
      }
    } catch (e) {}
  }

  if (isAvailable) {
    const bodyText = await page.innerText('body');
    if (bodyText.includes('Out of Stock') || bodyText.includes('Sold Out') || bodyText.includes('Currently Unavailable')) {
      log('Wykryto informację "Out of Stock". Produkt jest niedostępny.');
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
 * Przechodzi przez proces checkoutu jako gość na Pokemon Center.
 */
async function checkout(page, url, details, log) {
  log(`Rozpoczynanie checkoutu dla: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });

  log(`Klikanie przycisku "Add to Cart"...`);
  const buyBtnSelectors = [
    'button:has-text("Add to Cart")',
    'button:has-text("Add to cart")',
    'button.add-to-cart',
    '[data-testid="add-to-cart-button"]'
  ];

  let clicked = false;
  for (const sel of buyBtnSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible()) {
        await btn.click();
        clicked = true;
        break;
      }
    } catch (e) {}
  }

  if (!clicked) {
    return { success: false, error: 'Nie znaleziono przycisku "Add to Cart".' };
  }

  await page.waitForTimeout(4000);

  log(`Przechodzenie do koszyka...`);
  await page.goto(new URL(url).origin + '/cart', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  log(`Przechodzenie do kasy...`);
  const checkoutBtnSelectors = [
    'button:has-text("Proceed to Checkout")',
    'a:has-text("Proceed to Checkout")',
    'button:has-text("Checkout")',
    'a:has-text("Checkout")',
    'button[name="checkout"]',
    'a[href*="/checkout"]'
  ];

  let wentToCheckout = false;
  for (const sel of checkoutBtnSelectors) {
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
    await page.goto(new URL(url).origin + '/checkout', { waitUntil: 'networkidle' });
  }

  await page.waitForTimeout(3000);

  const guestBtnSelectors = [
    'button:has-text("Checkout as Guest")',
    'a:has-text("Checkout as Guest")',
    'button:has-text("Continue as Guest")',
    'button[type="submit"]:has-text("Guest")'
  ];

  for (const sel of guestBtnSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(2500);
        break;
      }
    } catch (e) {}
  }

  log(`Wypełnianie formularza adresowego...`);
  const fillField = async (selectors, value) => {
    for (const sel of selectors) {
      try {
        const field = page.locator(sel).first();
        if (await field.isVisible()) {
          await field.fill('');
          await field.type(value, { delay: 50 });
          return true;
        }
      } catch (e) {}
    }
    return false;
  };

  await fillField(['input[name="email"]', 'input[type="email"]', '#email'], details.email);
  await fillField(['input[name="firstName"]', 'input[name="shippingAddress.firstName"]', '#firstName'], details.firstName);
  await fillField(['input[name="lastName"]', 'input[name="shippingAddress.lastName"]', '#lastName'], details.lastName);
  await fillField(['input[name="phone"]', 'input[name="shippingAddress.phone"]', '#phone'], details.phone);
  await fillField(['input[name="address1"]', 'input[name="shippingAddress.address1"]', '#address1'], details.street);
  await fillField(['input[name="postalCode"]', 'input[name="shippingAddress.postalCode"]', '#postalCode'], details.zipCode);
  await fillField(['input[name="city"]', 'input[name="shippingAddress.city"]', '#city'], details.city);

  log(`Formularz adresowy wypełniony.`);
  await page.waitForTimeout(2000);

  const nextBtnSelectors = [
    'button:has-text("Continue to Shipping")',
    'button:has-text("Continue to payment")',
    'button:has-text("Continue")',
    'button[type="submit"]'
  ];

  for (const sel of nextBtnSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible() && await btn.isEnabled()) {
        await btn.click();
        await page.waitForTimeout(2500);
        break;
      }
    } catch (e) {}
  }

  log(`Doprowadzono do sekcji płatności na Pokemon Center. Ukończ transakcję w oknie przeglądarki.`);
  return { success: true };
}

module.exports = {
  checkAvailability,
  checkout
};
