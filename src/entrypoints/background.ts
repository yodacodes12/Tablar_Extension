import { browser } from 'wxt/browser';
import { browserTabs, toSnapshot } from '../lib/browser/tabs';
import { Engine } from '../lib/background/engine';
import { notifyAutoSuspended } from '../lib/background/notify';
import { createRouter } from '../lib/background/router';
import { Store } from '../lib/background/store';
import { MemoryService } from '../lib/memory/service';
import { CHANGED_EVENT, type Request } from '../lib/messages';

export const ALARM_NAME = 'tablar:evaluate';
const ALARM_PERIOD_MINUTES = 1;

export default defineBackground(() => {
  const store = new Store(browser.storage.local);
  let changeTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcast = () => {
    if (changeTimer) return;
    changeTimer = setTimeout(() => {
      changeTimer = null;
      browser.runtime.sendMessage({ type: CHANGED_EVENT }).catch(() => undefined); // no UI open → ignore
    }, 150);
  };

  const engine = new Engine({
    tabs: browserTabs,
    store,
    now: Date.now,
    browserFamily: import.meta.env.FIREFOX ? 'firefox' : 'chromium',
    onChange: broadcast,
    onAutoSuspended: (n) => {
      if (store.state.settings.notifications) void notifyAutoSuspended(n);
    },
    nextAlarmAt: async () => (await browser.alarms.get(ALARM_NAME))?.scheduledTime ?? null,
  });
  const memory = MemoryService.fromBrowser(browser);

  // Runs on every background start (install, browser start, service-worker wake-up).
  const ready = (async () => {
    await store.load(Date.now());
    await engine.initialize();
    await ensureAlarm();
  })().catch((e) => console.error('[Tablar] init failed', e));

  async function ensureAlarm() {
    const existing = await browser.alarms.get(ALARM_NAME);
    if (!existing || existing.periodInMinutes !== ALARM_PERIOD_MINUTES) {
      await browser.alarms.create(ALARM_NAME, {
        periodInMinutes: ALARM_PERIOD_MINUTES,
        delayInMinutes: ALARM_PERIOD_MINUTES,
      });
    }
  }

  const after = (fn: () => Promise<unknown>) => {
    void ready.then(fn).catch((e) => console.error('[Tablar]', e));
  };

  // Listeners are registered synchronously at top level so MV3 can wake the worker for them.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) after(() => engine.evaluate());
  });
  browser.tabs.onCreated.addListener((tab) => {
    const snap = toSnapshot(tab);
    if (snap) after(() => engine.onCreated(snap));
  });
  browser.tabs.onActivated.addListener(({ tabId, windowId }) =>
    after(() => engine.onActivated(tabId, windowId)),
  );
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    const interesting =
      'url' in change ||
      'discarded' in change ||
      'status' in change ||
      'pinned' in change ||
      'audible' in change ||
      'title' in change;
    const snap = toSnapshot(tab);
    if (interesting && snap) after(() => engine.onUpdated(tabId, change, snap));
  });
  browser.tabs.onRemoved.addListener((tabId) => after(() => engine.onRemoved(tabId)));
  browser.tabs.onReplaced?.addListener((added, removed) =>
    after(() => engine.onReplaced(added, removed)),
  );
  browser.tabs.onAttached.addListener((tabId, info) =>
    after(() => engine.onAttached(tabId, info.newWindowId)),
  );
  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== browser.windows.WINDOW_ID_NONE) after(() => engine.onWindowFocused(windowId));
  });
  browser.runtime.onStartup.addListener(() => after(ensureAlarm));
  browser.runtime.onInstalled.addListener(() => after(ensureAlarm));
  if (__TABLAR_E2E__) {
    // Test builds only: WebDriver cannot navigate to extension pages in Firefox, so open one ourselves.
    browser.runtime.onInstalled.addListener(
      () => void browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') }),
    );
  }

  const handle = createRouter(engine, memory, ready, __TABLAR_E2E__);
  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    if (sender.id !== browser.runtime.id) return undefined; // only our own pages
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string')
      return undefined;
    if ((msg as { type: string }).type === CHANGED_EVENT) return undefined;
    return handle(msg as Request);
  });
});
