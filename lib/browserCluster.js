const { chromium } = require('playwright-extra');
const ConcurrencyQueue = require('./concurrencyQueue');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Pula wielu instancji Chromium z kolejką — równoległe checki dostępności bez launch/close na każdy cykl.
 */
class BrowserCluster {
  constructor({ maxBrowsers = 2, maxConcurrency = 4, setupContextRouting, launchOptions = { headless: true } }) {
    this.maxBrowsers = Math.max(1, maxBrowsers);
    this.setupContextRouting = setupContextRouting;
    this.launchOptions = launchOptions;
    this.slots = [];
    this.queue = new ConcurrencyQueue(maxConcurrency);
    this.totalActiveContexts = 0;
  }

  configure({ maxBrowsers, maxConcurrency }) {
    if (maxBrowsers !== undefined) {
      this.maxBrowsers = Math.max(1, maxBrowsers);
    }
    if (maxConcurrency !== undefined) {
      this.queue.setMaxConcurrency(Math.max(1, maxConcurrency));
    }
  }

  async run(taskFn) {
    return this.queue.run(async () => {
      const session = await this._acquireSession();
      try {
        return await taskFn(session);
      } finally {
        await this._releaseSession(session);
      }
    });
  }

  async _acquireSession() {
    const slot = await this._pickSlot();
    const context = await slot.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 }
    });
    await this.setupContextRouting(context);
    const page = await context.newPage();
    slot.activeContexts += 1;
    this.totalActiveContexts += 1;
    return { page, context, slot };
  }

  async _releaseSession({ context, slot }) {
    await context.close().catch(() => {});
    slot.activeContexts = Math.max(0, slot.activeContexts - 1);
    this.totalActiveContexts = Math.max(0, this.totalActiveContexts - 1);
    await this._cleanupIdleBrowsers();
  }

  async _pickSlot() {
    this._pruneDisconnected();

    const connected = this.slots.filter(slot => slot.browser.isConnected());
    const canLaunchMore = connected.length < this.maxBrowsers;
    const allBusy = connected.length > 0 && connected.every(slot => slot.activeContexts > 0);

    if (connected.length === 0 || (canLaunchMore && allBusy)) {
      const browser = await chromium.launch(this.launchOptions);
      const slot = { browser, activeContexts: 0 };
      this.slots.push(slot);
      return slot;
    }

    return connected.sort((a, b) => a.activeContexts - b.activeContexts)[0];
  }

  _pruneDisconnected() {
    this.slots = this.slots.filter(slot => slot.browser.isConnected());
  }

  async _cleanupIdleBrowsers() {
    this._pruneDisconnected();
    const connected = this.slots.filter(slot => slot.browser.isConnected());
    if (connected.length <= 1) return;

    const idle = connected.filter(slot => slot.activeContexts === 0);
    while (idle.length > 0 && connected.length > 1) {
      const slot = idle.shift();
      const idx = this.slots.indexOf(slot);
      if (idx === -1) continue;
      this.slots.splice(idx, 1);
      await slot.browser.close().catch(() => {});
      connected.splice(connected.indexOf(slot), 1);
    }
  }

  async shutdown() {
    for (const slot of this.slots) {
      await slot.browser.close().catch(() => {});
    }
    this.slots = [];
    this.totalActiveContexts = 0;
  }

  getStats() {
    this._pruneDisconnected();
    return {
      browsers: this.slots.length,
      maxBrowsers: this.maxBrowsers,
      activeContexts: this.totalActiveContexts,
      queue: this.queue.getStats()
    };
  }
}

module.exports = BrowserCluster;
