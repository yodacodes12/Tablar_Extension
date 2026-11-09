import { Engine, MIN_EVALUATION_GAP_MS } from '../../src/lib/background/engine';
import { Store } from '../../src/lib/background/store';
import { STORAGE_KEYS } from '../../src/lib/core/schema';
import type { Settings, TabSnapshot } from '../../src/lib/core/types';
import { FakeTabs, MemoryStorage, MIN, tab } from './helpers';

const T0 = Date.UTC(2026, 10, 9, 10, 0);

async function setup(
  list: TabSnapshot[],
  settings: Partial<Settings> = {},
  storage = new MemoryStorage(),
) {
  let clock = T0;
  const tabs = new FakeTabs(list);
  const store = new Store(storage, 0);
  await store.load(clock);
  const onAuto = vi.fn();
  const engine = new Engine({
    tabs,
    store,
    now: () => clock,
    browserFamily: 'chromium',
    onAutoSuspended: onAuto,
  });
  await engine.initialize();
  if (Object.keys(settings).length) {
    const r = await engine.updateSettings(settings);
    if (!r.ok) throw new Error(r.error);
  }
  return {
    tabs,
    store,
    storage,
    engine,
    onAuto,
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

describe('tracking', () => {
  it('stamps the tab being left when switching tabs', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(5 * MIN);
    t.tabs.tabs.get(1)!.active = false;
    t.tabs.tabs.get(2)!.active = true;
    await t.engine.onActivated(2, 1);
    expect(t.store.state.tabs['1']!.lastActiveAt).toBe(T0 + 5 * MIN);
    expect(t.store.state.tabs['2']!.lastActiveAt).toBe(T0 + 5 * MIN);
  });

  it('background-opened tabs get an initial timestamp', async () => {
    const t = await setup([tab({ id: 1, active: true })]);
    t.advance(MIN);
    const bg = tab({ id: 7 });
    t.tabs.tabs.set(7, bg);
    await t.engine.onCreated(bg);
    expect(t.store.state.tabs['7']!.lastActiveAt).toBe(T0 + MIN);
  });

  it('switching windows does not mark other tabs inactive or reset their timers', async () => {
    const t = await setup([
      tab({ id: 1, active: true, windowId: 1 }),
      tab({ id: 2, windowId: 1 }),
      tab({ id: 3, active: true, windowId: 2 }),
    ]);
    const before = t.store.state.tabs['2']!.lastActiveAt;
    t.advance(10 * MIN);
    await t.engine.onWindowFocused(2);
    expect(t.store.state.tabs['2']!.lastActiveAt).toBe(before);
    expect(t.store.state.tabs['1']!.lastActiveAt).toBe(T0 + 10 * MIN);
    expect(t.store.state.tabs['3']!.lastActiveAt).toBe(T0 + 10 * MIN);
  });

  it('tab replacement moves the record', async () => {
    const t = await setup([tab({ id: 1 })]);
    await t.engine.onReplaced(50, 1);
    expect(t.store.state.tabs['50']?.tabId).toBe(50);
    expect(t.store.state.tabs['1']).toBeUndefined();
  });
});

describe('automatic suspension', () => {
  it('suspends after the default 30 min threshold, not before', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(29 * MIN);
    expect(await t.engine.evaluate()).toEqual([]);
    t.advance(MIN);
    const r = await t.engine.evaluate();
    expect(r).toEqual([{ tabId: 2, ok: true }]);
    expect(t.tabs.tabs.get(2)!.discarded).toBe(true);
    expect(t.onAuto).toHaveBeenCalledWith(1);
    const h = t.store.state.history[0]!;
    expect(h).toMatchObject({ method: 'automatic', result: 'success', domain: 'site2.example' });
    expect(h.reason).toMatch(/30 min/);
  });

  it('custom thresholds work', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })], { thresholdMinutes: 5 });
    t.advance(5 * MIN);
    expect((await t.engine.evaluate()).map((r) => r.ok)).toEqual([true]);
  });

  it('safety: never suspends active, pinned, audible, whitelisted, internal or already-discarded tabs', async () => {
    const t = await setup(
      [
        tab({ id: 1, active: true }),
        tab({ id: 2, pinned: true }),
        tab({ id: 3, audible: true }),
        tab({ id: 4, url: 'https://mail.google.com/x' }),
        tab({ id: 5, url: 'chrome://settings/' }),
        tab({ id: 6, discarded: true }),
        tab({ id: 7 }),
      ],
      { whitelist: ['mail.google.com'] },
    );
    t.advance(120 * MIN);
    const r = await t.engine.evaluate();
    expect(r.map((x) => x.tabId)).toEqual([7]);
    expect(t.tabs.discardCalls).toEqual([7]);
  });

  it('race: a tab activated right before discard is not discarded', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(40 * MIN);
    const realGet = t.tabs.get.bind(t.tabs);
    let calls = 0;
    t.tabs.get = async (id) => {
      calls++;
      if (id === 2 && calls === 2) {
        t.tabs.tabs.get(1)!.active = false;
        t.tabs.tabs.get(2)!.active = true; // user clicks the tab between check and discard
      }
      return realGet(id);
    };
    const r = await t.engine.evaluate();
    expect(r[0]).toMatchObject({ tabId: 2, ok: false });
    expect(t.tabs.discardCalls).toEqual([]);
    expect(t.tabs.tabs.get(2)!.discarded).toBe(false);
    expect(t.store.state.tabs['2']!.pendingOp).toBeUndefined();
  });

  it('race at the browser level: active tab rejected by the browser is reported as failure, not success', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(40 * MIN);
    t.tabs.beforeDiscard = (id) => {
      t.tabs.tabs.get(id)!.active = true;
    };
    const [r] = await t.engine.evaluate();
    expect(r!.ok).toBe(false);
    expect(t.store.state.history[0]).toMatchObject({ result: 'failed' });
  });

  it('8. failed discards are recorded once, backed off, and never reported as success', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.tabs.decline.add(2);
    t.advance(40 * MIN);
    expect((await t.engine.evaluate())[0]!.ok).toBe(false);
    expect(t.store.state.tabs['2']!.lastError).toBeDefined();
    t.advance(MIN);
    await t.engine.evaluate(); // backoff → no second browser call
    expect(t.tabs.discardCalls).toEqual([2]);
    t.advance(11 * MIN);
    await t.engine.evaluate(); // retried, same error → not duplicated in history
    expect(t.tabs.discardCalls).toEqual([2, 2]);
    expect(t.store.state.history.filter((h) => h.result === 'failed')).toHaveLength(1);
  });

  it('7. tabs closed mid-run do not crash the scheduler', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 }), tab({ id: 3 })]);
    t.advance(40 * MIN);
    t.tabs.beforeDiscard = (id) => {
      if (id === 2) t.tabs.tabs.delete(2);
    };
    const r = await t.engine.evaluate();
    expect(r).toEqual([
      { tabId: 2, ok: false, error: 'The tab was closed.' },
      { tabId: 3, ok: true },
    ]);
  });

  it('is idempotent: duplicate alarm firings do nothing extra', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(40 * MIN);
    await t.engine.evaluate();
    t.advance(MIN_EVALUATION_GAP_MS - 1);
    expect(await t.engine.evaluate()).toEqual([]);
    t.advance(MIN);
    expect(await t.engine.evaluate()).toEqual([]); // already discarded → skipped
    expect(t.store.state.history).toHaveLength(1);
  });

  it('concurrent evaluations are serialised', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(40 * MIN);
    const [a, b] = await Promise.all([t.engine.evaluate(), t.engine.evaluate({ ignoreGap: true })]);
    expect([...a, ...b].filter((r) => r.ok)).toHaveLength(1);
    expect(t.tabs.discardCalls).toEqual([2]);
  });

  it('disabling automatic suspension stops the scheduler but not manual suspension', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })], { autoSuspend: false });
    t.advance(99 * MIN);
    expect(await t.engine.evaluate()).toEqual([]);
    expect(await t.engine.suspend([2], { method: 'manual-single' })).toEqual([
      { tabId: 2, ok: true },
    ]);
  });

  it('handles Chromium returning a new tab id after discard', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.tabs.replaceIdOnDiscard.set(2, 200);
    t.advance(40 * MIN);
    expect(await t.engine.evaluate()).toEqual([{ tabId: 200, ok: true }]);
    expect(t.store.state.tabs['200']?.openHistoryId).toBeDefined();
  });

  it('private-window tabs are never written to history', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2, incognito: true })], {
      incognito: 'allow',
    });
    t.advance(40 * MIN);
    expect((await t.engine.evaluate())[0]!.ok).toBe(true);
    expect(t.store.state.history).toHaveLength(0);
  });
});

describe('manual controls', () => {
  it('single, protected-with-force, and refusal of the active tab', async () => {
    const t = await setup([
      tab({ id: 1, active: true }),
      tab({ id: 2 }),
      tab({ id: 3, pinned: true }),
    ]);
    expect((await t.engine.suspend([2], { method: 'manual-single' }))[0]).toEqual({
      tabId: 2,
      ok: true,
    });
    expect((await t.engine.suspend([3], { method: 'manual-single' }))[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining('Pinned'),
    });
    expect((await t.engine.suspend([3], { method: 'manual-single', force: true }))[0]).toEqual({
      tabId: 3,
      ok: true,
    });
    expect(t.store.state.history[0]!.reason).toMatch(/override/i);
    expect((await t.engine.suspend([1], { method: 'manual-single', force: true }))[0]!.ok).toBe(
      false,
    );
    expect(t.tabs.tabs.get(1)!.discarded).toBe(false);
  });

  it('bulk: suspend idle vs all-other-tabs vs restore all', async () => {
    const t = await setup([
      tab({ id: 1, active: true }),
      tab({ id: 2 }),
      tab({ id: 3 }),
      tab({ id: 4, audible: true }),
    ]);
    t.advance(40 * MIN);
    await t.engine.debugSetLastActive(3, t.now()); // 3 was just used
    await t.engine.onActivated(1, 1);
    const idle = await t.engine.suspendIdle();
    expect(idle.map((r) => r.tabId)).toEqual([2]);
    const all = await t.engine.suspendAllInactive();
    expect(all.map((r) => r.tabId)).toEqual([3]); // audible + active excluded
    expect(t.store.state.history.every((h) => h.method === 'manual-bulk')).toBe(true);
    const restored = await t.engine.restoreAll();
    expect(restored.map((r) => r.ok)).toEqual([true, true]);
    expect([...t.tabs.tabs.values()].some((x) => x.discarded)).toBe(false);
    expect(t.store.state.history.every((h) => typeof h.restoredAt === 'number')).toBe(true);
  });

  it('restoring a non-suspended or closed tab fails clearly', async () => {
    const t = await setup([tab({ id: 2 })]);
    expect((await t.engine.restore([2]))[0]!.error).toMatch(/not suspended/);
    expect((await t.engine.restore([99]))[0]!.error).toMatch(/no longer exists/);
  });

  it('a restored tab is not immediately re-suspended', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(40 * MIN);
    await t.engine.evaluate();
    await t.engine.restore([2]);
    t.advance(MIN);
    expect(await t.engine.evaluate()).toEqual([]);
  });

  it('browser-side reload (user opens the tab) closes the history entry', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.advance(40 * MIN);
    await t.engine.evaluate();
    t.advance(MIN);
    const live = t.tabs.tabs.get(2)!;
    live.discarded = false;
    await t.engine.onUpdated(2, { discarded: false }, { ...live });
    expect(t.store.state.history[0]!.restoredAt).toBe(t.now());
  });
});

describe('persistence & recovery', () => {
  it('12. browser restart (new tab ids) keeps inactivity timestamps', async () => {
    const storage = new MemoryStorage();
    const a = await setup(
      [tab({ id: 1, active: true }), tab({ id: 2, url: 'https://docs.example/a' })],
      {},
      storage,
    );
    a.advance(20 * MIN);
    await a.engine.evaluate();
    await a.store.flush();

    // Browser restarts 15 minutes later with new IDs.
    const restartAt = T0 + 35 * MIN;
    const tabs = new FakeTabs([
      tab({ id: 501, active: true, url: 'https://site1.example/page' }),
      tab({ id: 502, url: 'https://docs.example/a' }),
    ]);
    const store = new Store(storage, 0);
    await store.load(restartAt);
    const engine = new Engine({ tabs, store, now: () => restartAt, browserFamily: 'chromium' });
    await engine.initialize();
    expect(store.state.tabs['502']!.lastActiveAt).toBe(T0);
    const r = await engine.evaluate();
    expect(r).toEqual([{ tabId: 502, ok: true }]);
  });

  it('session restore: tabs restored after the worker started adopt their old timestamps', async () => {
    const storage = new MemoryStorage();
    const a = await setup(
      [tab({ id: 1, active: true }), tab({ id: 2, url: 'https://docs.example/a' })],
      {},
      storage,
    );
    await a.store.flush();
    const restartAt = T0 + 40 * MIN;
    // Worker starts while the browser has restored only the new-tab page.
    const tabs = new FakeTabs([tab({ id: 900, active: true, url: 'chrome://newtab/' })]);
    const store = new Store(storage, 0);
    await store.load(restartAt);
    const engine = new Engine({ tabs, store, now: () => restartAt, browserFamily: 'chromium' });
    await engine.initialize();
    expect(store.state.orphans.map((o) => o.url).sort()).toEqual([
      'https://docs.example/a',
      'https://site1.example/page',
    ]);
    // Session restore creates the tab blank, then navigates it.
    const restored = tab({ id: 901, url: '' });
    tabs.tabs.set(901, restored);
    await engine.onCreated(restored);
    const navigated = { ...restored, url: 'https://docs.example/a' };
    tabs.tabs.set(901, navigated);
    await engine.onUpdated(901, { url: navigated.url }, navigated);
    expect(store.state.tabs['901']!.lastActiveAt).toBe(T0);
    expect(store.state.orphans.map((o) => o.url)).toEqual(['https://site1.example/page']);
    expect(await engine.evaluate()).toEqual([{ tabId: 901, ok: true }]);
  });

  it('interrupted operations (worker killed mid-suspend) are recovered on start', async () => {
    const storage = new MemoryStorage();
    storage.data = {
      [STORAGE_KEYS.meta]: { schemaVersion: 1 },
      [STORAGE_KEYS.tabs]: {
        '2': {
          tabId: 2,
          windowId: 1,
          url: 'https://site2.example/page',
          firstSeenAt: T0,
          lastActiveAt: T0 - 60 * MIN,
          pendingOp: { kind: 'suspend', startedAt: T0 - 5000 },
        },
      },
    };
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })], {}, storage);
    expect(t.store.state.tabs['2']!.pendingOp).toBeUndefined();
    expect((await t.engine.evaluate())[0]).toEqual({ tabId: 2, ok: true });
  });

  it('records for tabs closed while the worker was asleep are cleaned up', async () => {
    const t = await setup([tab({ id: 1, active: true }), tab({ id: 2 })]);
    t.tabs.tabs.delete(2);
    t.advance(MIN);
    await t.engine.evaluate();
    expect(t.store.state.tabs['2']).toBeUndefined();
  });

  it('settings persist and invalid ones are rejected', async () => {
    const t = await setup([]);
    expect(
      (await t.engine.updateSettings({ thresholdMinutes: 12, whitelist: ['github.com'] })).ok,
    ).toBe(true);
    expect(t.storage.data[STORAGE_KEYS.settings]).toMatchObject({
      thresholdMinutes: 12,
      whitelist: ['github.com'],
    });
    expect((await t.engine.updateSettings({ thresholdMinutes: -1 })).ok).toBe(false);
  });

  it('snapshot counts and states', async () => {
    const t = await setup([
      tab({ id: 1, active: true }),
      tab({ id: 2 }),
      tab({ id: 3, pinned: true }),
      tab({ id: 4, discarded: true }),
    ]);
    t.advance(31 * MIN);
    const s = await t.engine.snapshot();
    expect(s.counts).toEqual({
      total: 4,
      active: 1,
      inactive: 2,
      eligible: 1,
      suspended: 1,
      protected: 1,
    });
    expect(s.tabs.map((x) => x.state)).toEqual(['ACTIVE', 'ELIGIBLE', 'PROTECTED', 'SUSPENDED']);
  });
});
