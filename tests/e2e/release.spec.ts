import { chromium } from '@playwright/test';
import path from 'node:path';
import { expect, test } from './fixtures';

// Smoke test of the *release* Chromium package (no test hooks).
test('release build loads, works, and has test hooks disabled', async () => {
  const ext = path.resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    const errors: string[] = [];
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByText('Monitoring · 30 min')).toBeVisible();
    const snap = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'getSnapshot' }));
    expect(snap.ok).toBe(true);
    const hook = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'debug:evaluate' }));
    expect(hook).toEqual({ ok: false, error: 'Not available' });
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.content_scripts ?? []).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
