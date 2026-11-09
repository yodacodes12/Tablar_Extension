import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, minutesAgo, send, SITE, test } from './fixtures';

const extPath = path.resolve('.output-e2e/chrome-mv3');

async function launch(dir: string): Promise<{ context: BrowserContext; ext: Page }> {
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2]!;
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/dashboard.html`);
  return { context, ext };
}

interface Snap {
  tabs: { id: number; url: string; state: string }[];
}

test('browser restart: new tab ids, inactivity timestamps preserved, alarm recreated', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tablar-restart-'));
  mkdirSync(path.join(dir, 'Default'), { recursive: true });
  // Ask Chromium to restore the previous session on startup.
  writeFileSync(
    path.join(dir, 'Default', 'Preferences'),
    JSON.stringify({ session: { restore_on_startup: 1 } }),
  );
  try {
    const first = await launch(dir);
    const url = `${SITE}/survivor`;
    const oldId = await first.ext.evaluate(
      async (u) => (await chrome.tabs.create({ url: u, active: false })).id!,
      url,
    );
    await expect
      .poll(async () =>
        (await send<Snap>(first.ext, { type: 'getSnapshot' })).tabs.some((t) => t.url === url),
      )
      .toBe(true);
    await send(first.ext, { type: 'debug:setLastActive', tabId: oldId, at: minutesAgo(50) });
    await first.context.close();

    const second = await launch(dir);
    let survivor: Snap['tabs'][number] | undefined;
    await expect
      .poll(
        async () => {
          survivor = (await send<Snap>(second.ext, { type: 'getSnapshot' })).tabs.find(
            (t) => t.url === url,
          );
          return survivor?.state;
        },
        { timeout: 15_000 },
      )
      .toBe('ELIGIBLE');
    expect(survivor!.id).not.toBe(oldId); // the browser assigned a new id; Tablar matched it by URL
    expect(await second.ext.evaluate(() => chrome.alarms.get('tablar:evaluate'))).toBeTruthy();
    const results = await send<{ ok: boolean }[]>(second.ext, { type: 'debug:evaluate' });
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await second.context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
