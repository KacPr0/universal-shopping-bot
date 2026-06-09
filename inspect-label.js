const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');

chromium.use(stealth);

const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
const details = db.settings.checkoutDetails;

async function main() {
  const sessionDir = path.join(__dirname, '.sessions', 'rebel');
  
  console.log('Uruchamianie przeglądarki...');
  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = context.pages()[0] || await context.newPage();
  
  console.log('Wchodzenie na /security w celu zalogowania...');
  await page.goto('https://www.rebel.pl/security', { waitUntil: 'networkidle' });
  
  const loginInput = page.locator('#login_login').first();
  if (await loginInput.isVisible()) {
    console.log('Logowanie...');
    await loginInput.fill(details.rebelLoginEmail);
    await page.locator('#login_password').first().fill(details.rebelPassword);
    await page.locator('#login_submit').first().click();
    await page.waitForTimeout(4000);
  }

  // Wejdź na stronę produktu, dodaj do koszyka
  const productUrl = 'https://www.rebel.pl/pokemon/ultra-pro-pokemon-one-touch-edge-poke-ball-2023590.html';
  await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Usuwamy baner cookie Didomi jeśli istnieje, aby nie zasłaniał elementów
  await page.evaluate(() => {
    const host = document.getElementById('didomi-host');
    if (host) host.remove();
    const notice = document.getElementById('didomi-notice');
    if (notice) notice.remove();
    document.body.style.overflow = 'auto';
  }).catch(() => {});

  const addBtn = page.locator('button:has-text("Dodaj do koszyka"), button:has-text("dodaj do koszyka")').first();
  if (await addBtn.isVisible()) {
    await addBtn.click({ force: true });
    await page.waitForTimeout(3000);
  }

  console.log('Przechodzenie na checkout...');
  await page.goto('https://www.rebel.pl/shopping/checkout', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000); // Czekamy na pełne załadowanie strony
  console.log('Aktualny URL:', page.url());

  // Szukamy elementu o id="edit_checkout_accept_rules"
  console.log('--- DETALE ELEMENTU ZGODY ---');
  const checkbox = page.locator('#edit_checkout_accept_rules').first();
  if (await checkbox.count() > 0) {
    const outerHtml = await checkbox.evaluate(el => el.outerHTML);
    console.log('Checkbox HTML:', outerHtml);
    
    // Szukamy rodzica (parent) elementu checkbox
    const parentHtml = await checkbox.evaluate(el => el.parentElement.outerHTML);
    console.log('Rodzic (Parent) HTML:', parentHtml);

    // Usuwamy baner cookie Didomi jeśli istnieje, aby nie zasłaniał elementów
    await page.evaluate(() => {
      const host = document.getElementById('didomi-host');
      if (host) host.remove();
      const notice = document.getElementById('didomi-notice');
      if (notice) notice.remove();
      document.body.style.overflow = 'auto';
    }).catch(() => {});

    // Test kliknięcia w span (kwadracik) z opcją force: true
    const checkboxSquare = page.locator('label:has(input#edit_checkout_accept_rules) > span').first();
    console.log('Czy checkboxSquare jest widoczny?', await checkboxSquare.isVisible());
    
    console.log('Klikanie checkboxSquare...');
    await checkboxSquare.click({ force: true });
    await page.waitForTimeout(2000);
    
    console.log('Czy checkbox jest zaznaczony po kliknięciu?', await checkbox.isChecked());

    console.log('--- FINAL SUBMIT BUTTONS ---');
    const allButtons = page.locator('button, input[type="submit"], a');
    const count = await allButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = allButtons.nth(i);
      const text = await btn.innerText().catch(() => '');
      const id = await btn.getAttribute('id').catch(() => '');
      const className = await btn.getAttribute('class').catch(() => '');
      const outerHtml = await btn.evaluate(el => el.outerHTML).catch(() => '');
      
      const textLower = (text || '').toLowerCase();
      const idLower = (id || '').toLowerCase();
      const outerHtmlLower = (outerHtml || '').toLowerCase();
      
      if (textLower.includes('kupuję') || textLower.includes('płacę') || idLower.includes('submit') || outerHtmlLower.includes('submit')) {
        console.log(`Button #${i}: text="${(text || '').trim()}", id="${id}", class="${className}", tag="${await btn.evaluate(el => el.tagName)}"`);
      }
    }
  } else {
    console.log('Nie znaleziono elementu o ID edit_checkout_accept_rules');
  }

  await context.close();
}

main().catch(console.error);
