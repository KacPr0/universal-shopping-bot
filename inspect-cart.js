const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');

async function test() {
  console.log('Uruchamianie przeglądarki...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = route.request().url().toLowerCase();
    if (url.includes('didomi') || url.includes('cookie') || url.includes('consent')) {
      route.abort().catch(() => {});
    } else {
      route.continue().catch(() => {});
    }
  });
  const page = await context.newPage();
  
  const productUrl = 'https://www.rebel.pl/karcianki/star-wars-unlimited-shadows-of-the-galaxy-booster-2020059.html';
  console.log(`Przejście do produktu: ${productUrl}`);
  await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  console.log('Klikanie "Dodaj do koszyka"...');
  const btn = page.locator('button:has-text("Dodaj do koszyka")').first();
  await btn.click();
  await page.waitForTimeout(2000);
  
  console.log('Przejście do koszyka...');
  await page.goto('https://www.rebel.pl/shopping/cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  
  const content = await page.content();
  fs.writeFileSync('cart-page.html', content);
  console.log('Zapisano HTML koszyka do cart-page.html');
  
  // Zróbmy inspekcję pól input w koszyku
  const inputs = await page.locator('input').all();
  console.log(`\nZnaleziono ${inputs.length} elementów input w koszyku:`);
  for (const input of inputs) {
    const id = await input.getAttribute('id') || '';
    const name = await input.getAttribute('name') || '';
    const className = await input.getAttribute('class') || '';
    const value = await input.getAttribute('value') || '';
    const isVisible = await input.isVisible();
    console.log(`- INPUT: id="${id}", name="${name}", class="${className}", value="${value}", visible=${isVisible}`);
  }
  
  await browser.close();
}

test().catch(console.error);
