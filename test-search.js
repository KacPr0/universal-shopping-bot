const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const query = "tcg:battle academy";
  console.log(`Szukanie dla frazy: "${query}"`);
  
  const searchUrl = `https://rebel.pl/site/search?phrase=${encodeURIComponent(query)}`;
  console.log(`URL: ${searchUrl}`);
  
  await page.goto(searchUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const fs = require('fs');
  fs.writeFileSync('rebel-search.html', await page.content());
  console.log('Zapisano HTML do rebel-search.html');

  // Przetestujmy selektor, który używa nasza funkcja resolveProductUrl
  const productSelectors = [
    '.product-item-link',
    '.product-title a',
    '.product-name a',
    'a.product-name',
    'a[href*="/gry-planszowe/"][href$=".html"]',
    'main a[href$=".html"]'
  ];

  console.log('\n--- Test selektorów ---');
  for (const sel of productSelectors) {
    try {
      const link = page.locator(sel).first();
      if (await link.isVisible()) {
        const href = await link.getAttribute('href');
        const text = await link.innerText();
        console.log(`Selektor "${sel}": Znalazł [${text.trim()}] -> ${href}`);
      } else {
        console.log(`Selektor "${sel}": Niewidoczny`);
      }
    } catch (e) {
      console.log(`Selektor "${sel}": Błąd: ${e.message}`);
    }
  }

  await browser.close();
}

test().catch(console.error);
