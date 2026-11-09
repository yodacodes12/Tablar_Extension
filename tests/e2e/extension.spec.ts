import { expect, getTab, minutesAgo, openBackgroundTab, send, SITE, test } from './fixtures';

interface TabView {
  id: number;
  windowId: number;
  state: string;
  discarded: boolean;
  active: boolean;
  autoEligible: boolean;
  title: string;
  blockers: string[];
}
interface Snapshot {
  tabs: TabView[];
  counts: Record<string, number>;
  settings: { thresholdMinutes: number; whitelist: string[] };
}
interface OpResult {
  tabId: number;
  ok: boolean;
  error?: string;
}

test('discovers tabs across windows with correct states', async ({ ext }) => {
  const a = await openBackgroundTab(ext, 'alpha');
  const win = await ext.evaluate(() =>
    chrome.windows.create({ url: 'http://127.0.0.1:4517/page/beta' }),
  );
  await expect
    .poll(async () => (await send<Snapshot>(ext, { type: 'getSnapshot' })).tabs.length)
    .toBeGreaterThanOrEqual(3);
  const snap = await send<Snapshot>(ext, { type: 'getSnapshot' });
  expect(snap.tabs.find((t) => t.id === a)?.state).toBe('INACTIVE');
  const beta = snap.tabs.find((t) => t.windowId === win!.id);
  expect(beta?.active).toBe(true);
  expect(beta?.state).toBe('ACTIVE');
  expect(snap.settings.thresholdMinutes).toBe(30);
});

test('automatic suspension discards only eligible tabs (native discard, URL preserved)', async ({
  ext,
}) => {
  await send(ext, { type: 'updateSettings', patch: { whitelist: ['localhost'] } });
  const plain = await openBackgroundTab(ext, 'plain');
  const pinned = await openBackgroundTab(ext, 'pinned', { pinned: true });
  const fresh = await openBackgroundTab(ext, 'fresh');
  const white = await ext.evaluate(
    async () =>
      (await chrome.tabs.create({ url: 'http://localhost:4517/page/white', active: false })).id!,
  );
  for (const id of [plain, pinned, white])
    await send(ext, { type: 'debug:setLastActive', tabId: id, at: minutesAgo(45) });

  const results = await send<OpResult[]>(ext, { type: 'debug:evaluate' });
  expect(results).toHaveLength(1);
  expect(results[0]?.ok).toBe(true);
  // Chromium assigns a new tab id to a discarded tab; Tablar reports the new one.
  const suspendedId = results[0]!.tabId;
  const t = await getTab(ext, suspendedId);
  expect(t.discarded).toBe(true);
  expect(t.url).toBe(`${SITE}/plain`); // tab, URL and position kept
  for (const id of [pinned, fresh, white]) expect((await getTab(ext, id)).discarded).toBe(false);

  const snap = await send<Snapshot>(ext, { type: 'getSnapshot' });
  expect(snap.tabs.find((x) => x.id === suspendedId)?.state).toBe('SUSPENDED');
  expect(snap.tabs.find((x) => x.id === pinned)?.state).toBe('PROTECTED');
  const history = await send<{ method: string; result: string }[]>(ext, { type: 'getHistory' });
  expect(history[0]).toMatchObject({ method: 'automatic', result: 'success' });
});

test('the active tab is never discarded, even when forced', async ({ ext }) => {
  const id = await ext.evaluate(async () => (await chrome.tabs.getCurrent())!.id!);
  await send(ext, { type: 'debug:setLastActive', tabId: id, at: minutesAgo(999) });
  const [r] = await send<OpResult[]>(ext, {
    type: 'suspend',
    tabIds: [id],
    method: 'manual-single',
    force: true,
  });
  expect(r?.ok).toBe(false);
  expect((await getTab(ext, id)).discarded).toBe(false);
});

test('manual single, bulk, protected override and restore', async ({ ext }) => {
  const a = await openBackgroundTab(ext, 'm-a');
  const b = await openBackgroundTab(ext, 'm-b');
  const p = await openBackgroundTab(ext, 'm-p', { pinned: true });

  const [ra] = await send<OpResult[]>(ext, {
    type: 'suspend',
    tabIds: [a],
    method: 'manual-single',
  });
  expect(ra?.ok).toBe(true);
  const refused = await send<OpResult[]>(ext, {
    type: 'suspend',
    tabIds: [p],
    method: 'manual-single',
  });
  expect(refused[0]?.ok).toBe(false);
  expect(refused[0]?.error).toMatch(/Pinned/);
  const [rp] = await send<OpResult[]>(ext, {
    type: 'suspend',
    tabIds: [p],
    method: 'manual-single',
    force: true,
  });
  expect(rp?.ok).toBe(true);

  const bulk = await send<OpResult[]>(ext, { type: 'suspendAllInactive' });
  const rb = bulk.find((r) => r.ok && r.tabId !== ra!.tabId && r.tabId !== rp!.tabId);
  expect(rb).toBeTruthy();
  const ids = [ra!.tabId, rb!.tabId, rp!.tabId];
  for (const id of ids) expect((await getTab(ext, id)).discarded).toBe(true);
  for (const id of [a, b, p]) await expect(getTab(ext, id)).rejects.toThrow(/No tab/); // ids were replaced

  const restored = await send<OpResult[]>(ext, { type: 'restoreAll' });
  expect(restored.length).toBeGreaterThanOrEqual(3);
  expect(restored.every((r) => r.ok)).toBe(true);
  for (const id of ids) expect((await getTab(ext, id)).discarded).toBe(false);
  const history = await send<{ restoredAt?: number; result: string }[]>(ext, {
    type: 'getHistory',
  });
  expect(
    history.filter((h) => h.result === 'success').every((h) => typeof h.restoredAt === 'number'),
  ).toBe(true);
});

test('activating a suspended tab reloads it and closes the history entry', async ({
  ext,
  context,
}) => {
  const a0 = await openBackgroundTab(ext, 'reopen');
  const [r] = await send<OpResult[]>(ext, {
    type: 'suspend',
    tabIds: [a0],
    method: 'manual-single',
  });
  const a = r!.tabId;
  await send(ext, { type: 'activate', tabId: a });
  await expect.poll(async () => (await getTab(ext, a)).discarded).toBe(false);
  await expect
    .poll(
      async () =>
        (await send<{ restoredAt?: number }[]>(ext, { type: 'getHistory' }))[0]?.restoredAt,
    )
    .toBeTruthy();
  void context;
});

test('settings persist in storage and invalid values are rejected', async ({ ext }) => {
  await send(ext, {
    type: 'updateSettings',
    patch: { thresholdMinutes: 15, whitelist: ['github.com'] },
  });
  const stored = await ext.evaluate(() => chrome.storage.local.get('tablar:settings'));
  expect(stored['tablar:settings']).toMatchObject({
    thresholdMinutes: 15,
    whitelist: ['github.com'],
  });
  const bad = await send<{ ok: boolean }>(ext, {
    type: 'updateSettings',
    patch: { thresholdMinutes: 0 },
  });
  expect(bad.ok).toBe(false);
});

test('memory capability layer never fabricates per-tab bytes on stable Chromium', async ({
  ext,
}) => {
  await openBackgroundTab(ext, 'mem');
  const report = await send<{
    capabilities: { perTab: boolean; perProcess: boolean; system: boolean };
    tabs: Record<string, { source: string; valueBytes: number | null }>;
    system: { capacityBytes: number } | null;
  }>(ext, { type: 'getMemory' });
  expect(report.capabilities.perTab).toBe(false);
  expect(report.capabilities.perProcess).toBe(false); // chrome.processes is Dev-channel only
  expect(report.capabilities.system).toBe(true);
  expect(report.system?.capacityBytes).toBeGreaterThan(0);
  for (const m of Object.values(report.tabs)) {
    expect(m.source).not.toBe('actual');
    expect(m.valueBytes).toBeNull();
  }
});

test('popup and dashboard UI drive real actions', async ({ context, extensionId, ext }) => {
  const id = await openBackgroundTab(ext, 'ui-target');
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const row = popup.locator('li', { hasText: 'ui-target' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Suspend this tab' }).click();
  await expect(row.getByText('Suspended', { exact: true })).toBeVisible();
  const newId = await ext.evaluate(
    async () => (await chrome.tabs.query({ url: 'http://127.0.0.1:4517/page/ui-target' }))[0]!.id!,
  );
  expect(newId).not.toBe(id);
  expect((await getTab(ext, newId)).discarded).toBe(true);
  await popup.screenshot({ path: 'test-results/popup.png' });

  await row.getByRole('button', { name: /Restore/ }).click();
  await expect.poll(async () => (await getTab(ext, newId)).discarded).toBe(false);

  const dash = await context.newPage();
  await dash.setViewportSize({ width: 1280, height: 860 });
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#protected`);
  await dash.getByLabel('Domain to protect').fill('fakeexample.com');
  await dash.getByRole('button', { name: 'Add' }).click();
  await expect(dash.getByText('fakeexample.com', { exact: true })).toBeVisible();
  const stored = await ext.evaluate(() => chrome.storage.local.get('tablar:settings'));
  expect((stored['tablar:settings'] as { whitelist: string[] }).whitelist).toContain(
    'fakeexample.com',
  );

  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#overview`);
  await expect(dash.getByText('Open tabs')).toBeVisible();
  await dash.screenshot({ path: 'test-results/dashboard-overview.png' });
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#memory`);
  await expect(dash.getByText('What this browser can measure')).toBeVisible();
  await dash.screenshot({ path: 'test-results/dashboard-memory.png' });
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings`);
  await dash.getByRole('tab', { name: 'Dark' }).click();
  await expect(dash.locator('html.dark')).toHaveCount(1);
  await dash.screenshot({ path: 'test-results/dashboard-settings-dark.png' });
});
