/// <reference types="chrome" />
// Renders the real extension UI with demo tabs and saves store-sized screenshots to store/screenshots/.
import { test, send, minutesAgo } from '../tests/e2e/fixtures';
import type { Page } from '@playwright/test';

const DEMO = [
  { host: 'docs.example.com', title: 'Q3 planning — Example Docs', idle: 3 },
  { host: 'news.example.org', title: 'Morning briefing · Example News', idle: 52 },
  { host: 'shop.example.net', title: 'Mechanical keyboards – Example Shop', idle: 95 },
  { host: 'wiki.example.org', title: 'Service workers — Example Wiki', idle: 140 },
  { host: 'mail.example.com', title: 'Inbox (3) — Example Mail', idle: 12, pinned: true },
  { host: 'video.example.com', title: 'Lo-fi beats to code to', idle: 64 },
  { host: 'bank.example.com', title: 'Accounts overview — Example Bank', idle: 75 },
  { host: 'recipes.example.net', title: 'Weeknight dal recipes', idle: 210 },
  { host: 'travel.example.org', title: 'Lisbon trip itinerary', idle: 33 },
];
const OUT = 'store/screenshots';

async function openDemoTabs(ext: Page) {
  const ids: Record<string, number> = {};
  for (const d of DEMO) {
    ids[d.host] = await ext.evaluate(
      async ({ url, pinned }) => {
        // Open blank first so Playwright's request routing is attached before the real navigation.
        const t = await chrome.tabs.create({ url: 'about:blank', active: false, pinned: !!pinned });
        await new Promise((r) => setTimeout(r, 400));
        await chrome.tabs.update(t.id!, { url });
        for (;;) {
          const cur = await chrome.tabs.get(t.id!);
          if (cur.status === 'complete' && cur.title && !cur.title.includes('example.'))
            return t.id!;
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      { url: `https://${d.host}/`, pinned: d.pinned },
    );
  }
  return ids;
}

test('store screenshots', async ({ context, extensionId, ext }) => {
  // Serve the fictional demo sites locally; nothing leaves the machine.
  await context.route(/https:\/\/[a-z]+\.example\.(com|org|net)\//, (route) => {
    const host = new URL(route.request().url()).host;
    const d = DEMO.find((x) => x.host === host)!;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><title>${d.title}</title><h1>${d.title}</h1>`,
    });
  });

  // Close the blank start page and the install-time dashboard; keep only `ext`.
  for (const p of context.pages()) if (p !== ext) await p.close();
  await send(ext, { type: 'updateSettings', patch: { whitelist: ['bank.example.com'] } });
  const ids = await openDemoTabs(ext);
  for (const d of DEMO) {
    await send(ext, { type: 'debug:setLastActive', tabId: ids[d.host]!, at: minutesAgo(d.idle) });
  }
  // Auto-suspend everything idle past the 30-min default (protected/pinned tabs are skipped).
  await send(ext, { type: 'debug:evaluate' });
  // Leave a couple of idle tabs awake so the list shows a mix of states.
  const snap = await send<{ tabs: { id: number; url: string }[] }>(ext, { type: 'getSnapshot' });
  const restore = snap.tabs.filter((t) => /news|travel/.test(t.url)).map((t) => t.id);
  if (restore.length) await send(ext, { type: 'restore', tabIds: restore });
  for (const host of ['news.example.org', 'travel.example.org']) {
    const t = await ext.evaluate(
      async (u) => (await chrome.tabs.query({ url: u }))[0]!.id!,
      `https://${host}/`,
    );
    const d = DEMO.find((x) => x.host === host)!;
    await send(ext, { type: 'debug:setLastActive', tabId: t, at: minutesAgo(d.idle) });
  }

  const dash = ext;
  await dash.setViewportSize({ width: 1280, height: 800 });
  const shot = async (hash: string, name: string, dark = false) => {
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html#${hash}`);
    await dash.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
    await dash.waitForTimeout(600);
    await dash.screenshot({ path: `${OUT}/${name}.png` });
  };
  await shot('overview', '1-overview');
  await shot('tabs', '2-tabs');
  await shot('protected', '4-protected');
  await shot('settings', '5-settings');
  await shot('overview', '6-overview-dark', true);

  // Popup, centred on a 1280x800 canvas as the stores require.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForTimeout(600);
  const png = (await popup.screenshot()).toString('base64');
  await popup.close();
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1280, height: 800 });
  await canvas.setContent(`<body style="margin:0;height:800px;display:flex;align-items:center;justify-content:center;gap:56px;background:linear-gradient(135deg,#eef2ff,#f8fafc);font-family:system-ui,sans-serif">
    <div style="max-width:420px;color:#0f172a"><div style="font-size:44px;font-weight:700;line-height:1.1">Suspend tabs<br>in one click</div>
    <p style="font-size:20px;color:#475569;line-height:1.5">Uses the browser's own native discard. Your tabs stay in place and reload when you open them.</p></div>
    <img src="data:image/png;base64,${png}" style="width:400px;height:600px;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.25)"></body>`);
  await canvas.screenshot({ path: `${OUT}/3-popup.png` });

  // Small promo tile (440x280).
  const logo = await ext.evaluate(async () => {
    const r = await fetch(chrome.runtime.getURL('/icon/128.png'));
    const b = new Uint8Array(await r.arrayBuffer());
    let s = '';
    b.forEach((x) => (s += String.fromCharCode(x)));
    return btoa(s);
  });
  await canvas.setViewportSize({ width: 440, height: 280 });
  await canvas.setContent(`<body style="margin:0;height:280px;display:flex;align-items:center;justify-content:center;gap:22px;background:linear-gradient(135deg,#0f766e,#134e4a);font-family:system-ui,sans-serif;color:white">
    <img src="data:image/png;base64,${logo}" style="width:96px;height:96px">
    <div><div style="font-size:44px;font-weight:700">Tablar</div><div style="font-size:17px;opacity:.9;max-width:220px">Native tab suspension.<br>Private by design.</div></div></body>`);
  await canvas.screenshot({ path: `${OUT}/promo-small-440x280.png` });
});
