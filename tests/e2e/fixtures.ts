/// <reference types="chrome" />
import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import path from 'node:path';

export const SITE = 'http://127.0.0.1:4517/page';
const extPath = path.resolve('.output-e2e/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  ext: Page;
  worker: Worker;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: process.env.HEADED ? false : true,
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ worker }, use) => {
    await use(worker.url().split('/')[2]!);
  },
  /** An extension page we can call chrome.* and the Tablar background from. */
  ext: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await use(page);
  },
});
export const expect = test.expect;

type Msg = Record<string, unknown> & { type: string };
export async function send<T = unknown>(ext: Page, msg: Msg): Promise<T> {
  const res = await ext.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const env = res as { ok: boolean; data?: T; error?: string };
  if (!env?.ok) throw new Error(`background error: ${env?.error}`);
  return env.data as T;
}

export async function openBackgroundTab(
  ext: Page,
  name: string,
  extra: chrome.tabs.CreateProperties = {},
): Promise<number> {
  return ext.evaluate(
    async ({ url, extra }) => {
      const t = await chrome.tabs.create({ url, active: false, ...extra });
      await new Promise<void>((resolve) => {
        const check = async () => {
          const cur = await chrome.tabs.get(t.id!);
          if (cur.status === 'complete' && cur.url?.startsWith('http')) return resolve();
          setTimeout(check, 50);
        };
        void check();
      });
      return t.id!;
    },
    { url: `${SITE}/${name}`, extra },
  );
}

export async function getTab(ext: Page, id: number) {
  return ext.evaluate((tabId) => chrome.tabs.get(tabId), id);
}

export const minutesAgo = (m: number) => Date.now() - m * 60_000;
