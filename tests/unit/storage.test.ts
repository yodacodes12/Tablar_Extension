import { Store } from '../../src/lib/background/store';
import { pruneHistory, markRestored } from '../../src/lib/core/history';
import {
  migrate,
  parsePersistedState,
  SCHEMA_VERSION,
  STORAGE_KEYS,
} from '../../src/lib/core/schema';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  sanitizeSettings,
} from '../../src/lib/core/settings';
import type { HistoryEntry } from '../../src/lib/core/types';
import { MemoryStorage } from './helpers';

const now = 1_800_000_000_000;
const DAY = 86_400_000;

describe('settings validation', () => {
  it('defaults: 30 min, auto on, pinned + audio protected', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      thresholdMinutes: 30,
      autoSuspend: true,
      protectPinned: true,
      protectAudible: true,
    });
  });

  it('sanitizes corrupted values field by field', () => {
    const s = sanitizeSettings({
      thresholdMinutes: 'lots',
      autoSuspend: 'yes',
      theme: 'neon',
      whitelist: ['github.com', 42, 'bad domain', 'GITHUB.com'],
      protectPinned: false,
    });
    expect(s.thresholdMinutes).toBe(30);
    expect(s.autoSuspend).toBe(true);
    expect(s.theme).toBe('system');
    expect(s.whitelist).toEqual(['github.com']);
    expect(s.protectPinned).toBe(false);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects invalid user patches instead of silently defaulting', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { thresholdMinutes: 0 }).ok).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { whitelist: ['not valid!'] }).ok).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { historyRetentionDays: 0 }).ok).toBe(false);
    const ok = applySettingsPatch(DEFAULT_SETTINGS, { thresholdMinutes: 17 });
    expect(ok.ok && ok.settings.thresholdMinutes).toBe(17);
  });
});

describe('schema & migration', () => {
  it('migrates an empty store to the current version', () => {
    const m = migrate({});
    expect(m.from).toBe(0);
    expect(m.to).toBe(SCHEMA_VERSION);
    expect(m.raw[STORAGE_KEYS.meta]).toEqual({ schemaVersion: SCHEMA_VERSION });
  });

  it('carries legacy pre-release settings over', () => {
    const m = migrate({ settings: { thresholdMinutes: 10 } });
    expect(parsePersistedState(m.raw, now).settings.thresholdMinutes).toBe(10);
  });

  it('is a no-op on current data and tolerates newer versions', () => {
    expect(migrate({ [STORAGE_KEYS.meta]: { schemaVersion: SCHEMA_VERSION } }).migrated).toBe(
      false,
    );
    expect(migrate({ [STORAGE_KEYS.meta]: { schemaVersion: 99 } }).to).toBe(99);
  });

  it('drops corrupt tab records and history entries individually', () => {
    const raw = {
      [STORAGE_KEYS.tabs]: {
        '1': {
          tabId: 1,
          windowId: 1,
          url: 'https://a.com',
          firstSeenAt: 1,
          lastActiveAt: now - 1000,
        },
        '2': { tabId: 'two' },
        '3': null,
        '4': {
          tabId: 4,
          windowId: 1,
          url: 'https://b.com',
          firstSeenAt: 1,
          lastActiveAt: now + 10 * DAY,
        },
      },
      [STORAGE_KEYS.history]: [
        { id: 'x' },
        'junk',
        {
          id: 'ok',
          url: 'u',
          tabTitle: 't',
          domain: 'd',
          suspendedAt: 1,
          reason: 'r',
          method: 'automatic',
          result: 'success',
        },
      ],
    };
    const s = parsePersistedState(raw, now);
    expect(Object.keys(s.tabs).sort()).toEqual(['1', '4']);
    expect(s.tabs['4']!.lastActiveAt).toBe(now); // future timestamps clamped
    expect(s.history.map((h) => h.id)).toEqual(['ok']);
  });

  it('handles a completely garbage store', () => {
    const s = parsePersistedState(
      { [STORAGE_KEYS.tabs]: 'nope', [STORAGE_KEYS.history]: { a: 1 }, [STORAGE_KEYS.settings]: 7 },
      now,
    );
    expect(s).toEqual({ settings: DEFAULT_SETTINGS, tabs: {}, history: [], orphans: [] });
  });
});

describe('Store', () => {
  it('loads, migrates and persists with a schema marker', async () => {
    const mem = new MemoryStorage();
    mem.data = { settings: { thresholdMinutes: 45 } };
    const store = new Store(mem, 0);
    const r = await store.load(now);
    expect(r.migratedFrom).toBe(0);
    expect(store.state.settings.thresholdMinutes).toBe(45);
    expect(mem.data[STORAGE_KEYS.meta]).toEqual({ schemaVersion: SCHEMA_VERSION });
  });

  it('survives unreadable storage', async () => {
    const store = new Store(
      { get: () => Promise.reject(new Error('boom')), set: async () => undefined },
      0,
    );
    const r = await store.load(now);
    expect(r.recovered).toBe(true);
    expect(store.state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('coalesces dirty parts into one write', async () => {
    const mem = new MemoryStorage();
    const store = new Store(mem, 50);
    store.markDirty('tabs');
    store.markDirty('settings');
    store.markDirty('tabs');
    await store.flush();
    expect(mem.writes).toBe(1);
    expect(Object.keys(mem.data).sort()).toEqual(
      [STORAGE_KEYS.meta, STORAGE_KEYS.settings, STORAGE_KEYS.tabs].sort(),
    );
  });
});

describe('history', () => {
  const e = (id: string, suspendedAt: number, restoredAt?: number): HistoryEntry => ({
    id,
    tabTitle: id,
    url: 'u',
    domain: 'd',
    suspendedAt,
    restoredAt,
    method: 'automatic',
    reason: 'r',
    result: 'success',
  });

  it('prunes by retention and sorts newest first', () => {
    const out = pruneHistory(
      [e('old', now - 10 * DAY), e('new', now - DAY), e('mid', now - 3 * DAY)],
      now,
      7,
    );
    expect(out.map((x) => x.id)).toEqual(['new', 'mid']);
  });

  it('keeps entries restored recently even if suspended long ago', () => {
    expect(pruneHistory([e('a', now - 10 * DAY, now - DAY)], now, 7)).toHaveLength(1);
  });

  it('marks restoration once', () => {
    const list = [e('a', now)];
    expect(markRestored(list, 'a', now + 1)).toBe(true);
    expect(markRestored(list, 'a', now + 2)).toBe(false);
    expect(list[0]!.restoredAt).toBe(now + 1);
  });
});
