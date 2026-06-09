/**
 * Selektory DOM dla Rebel.pl — jedno miejsce do aktualizacji przy zmianach layoutu sklepu.
 */
module.exports = {
  checkoutButtons: [
    'a:has-text("DALEJ")',
    'button:has-text("DALEJ")',
    'a:has-text("Dalej")',
    'button:has-text("Dalej")',
    'a:has-text("Przejdź do kasy")',
    'button:has-text("Przejdź do kasy")',
    'a:has-text("Zamawiam")',
    'button:has-text("Zamawiam")',
    '.checkout-button',
    'a[href*="/checkout"]'
  ],

  login: {
    email: [
      '#login_login',
      'input[name="login[login]"]',
      'input[placeholder="Twój login albo adres e-mail"]',
      'input[placeholder*="login"]',
      'input[placeholder*="e-mail"]',
      'input[name*="username"]',
      'input[name*="login"]'
    ],
    password: [
      '#login_password',
      'input[name="login[password]"]',
      'input[type="password"]'
    ],
    submit: [
      '#login_submit',
      'button:has-text("ZALOGUJ")',
      'button:has-text("Zaloguj")',
      'input[type="submit"][value="ZALOGUJ"]',
      'button[type="submit"]',
      '#send2'
    ],
    remember: [
      '#login_remember',
      'input[name="login[remember]"]',
      'input[name="remember_me"]',
      'input#remember_me',
      'input[type="checkbox"]'
    ],
    visibleWait: '#login_login:visible, input[placeholder="Twój login albo adres e-mail"]:visible',
    rememberQuick: '#login_remember:visible, input[name*="remember"]:visible'
  },

  availability: {
    productWait: 'button:has-text("dodaj do koszyka"), button:has-text("Dodaj do koszyka"), .add-to-cart-button',
    unavailableText: 'text=Produkt tymczasowo niedostępny',
    addToCart: [
      'button:has-text("dodaj do koszyka")',
      'button:has-text("Dodaj do koszyka")',
      '.add-to-cart-button',
      'button.add-to-cart',
      '#add-to-cart'
    ],
    outOfStockPhrases: ['Produkt tymczasowo niedostępny', 'Chwilowy brak towaru'],
    price: '.price, .product-price, [itemprop="price"]',
    searchResults: '.product-box, .product, a[href$=".html"]',
    searchItems: '.product-box, main a[href$=".html"]'
  },

  search: {
    mainLinks: 'main a[href$=".html"]'
  }
};
