import { isHistoryEntry } from './history';
import { sanitizeSettings } from './settings';
import type { OrphanRecord } from './reconcile';
import type { HistoryEntry, Settings, TabRecord } from './types';

export const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  meta: 'tablar:meta',
  settings: 'tablar:settings',
  tabs: 'tablar:tabs',
  history: 'tablar:history',
  orphans: 'tablar:orphans',
} as const;

export interface PersistedState {
  settings: Settings;
  tabs: Record<string, TabRecord>;
  history: HistoryEntry[];
  /** Records waiting to be re-claimed by session-restored tabs after a browser restart. */
  orphans: OrphanRecord[];
}

type RawStore = Record<string, unknown>;

/**
 * Ordered migrations: MIGRATIONS[n] upgrades a raw store from version n to n + 1.
 * Version 0 means "nothing stored yet / pre-release layout".
 */
export const MIGRATIONS: Record<number, (raw: RawStore) => RawStore> = {
  0: (raw) => {
    // Pre-release builds stored settings under "settings"; carry them over if present.
    const legacy = raw['settings'];
    return {
      ...raw,
      [STORAGE_KEYS.settings]: raw[STORAGE_KEYS.settings] ?? legacy,
      [STORAGE_KEYS.meta]: { schemaVersion: 1 },
    };
  },
};

export function readSchemaVersion(raw: RawStore): number {
  const meta = raw[STORAGE_KEYS.meta];
  const v =
    meta && typeof meta === 'object' ? (meta as Record<string, unknown>).schemaVersion : undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

export interface MigrationResult {
  raw: RawStore;
  from: number;
  to: number;
  migrated: boolean;
}

export function migrate(input: RawStore): MigrationResult {
  const from = readSchemaVersion(input);
  if (from > SCHEMA_VERSION) {
    // Written by a newer Tablar (downgrade). Don't guess — sanitisation below keeps what is valid.
    return { raw: input, from, to: from, migrated: false };
  }
  let raw = input;
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Missing storage migration ${v} → ${v + 1}`);
    raw = step(raw);
  }
  return { raw, from, to: SCHEMA_VERSION, migrated: from !== SCHEMA_VERSION };
}

function isTabRecord(v: unknown): v is TabRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.tabId === 'number' &&
    typeof r.windowId === 'number' &&
    typeof r.url === 'string' &&
    typeof r.firstSeenAt === 'number' &&
    typeof r.lastActiveAt === 'number' &&
    Number.isFinite(r.lastActiveAt)
  );
}

/** Turn whatever is in storage into a valid PersistedState, dropping corrupt pieces individually. */
export function parsePersistedState(raw: RawStore, now: number): PersistedState {
  const settings = sanitizeSettings(raw[STORAGE_KEYS.settings]);

  const tabs: Record<string, TabRecord> = {};
  const rawTabs = raw[STORAGE_KEYS.tabs];
  if (rawTabs && typeof rawTabs === 'object' && !Array.isArray(rawTabs)) {
    for (const value of Object.values(rawTabs as Record<string, unknown>)) {
      if (!isTabRecord(value)) continue;
      // A timestamp in the future (clock change) must not make a tab look "never idle" forever.
      const record: TabRecord = { ...value, lastActiveAt: Math.min(value.lastActiveAt, now) };
      tabs[String(record.tabId)] = record;
    }
  }

  const rawHistory = raw[STORAGE_KEYS.history];
  const history = Array.isArray(rawHistory) ? rawHistory.filter(isHistoryEntry) : [];

  const rawOrphans = raw[STORAGE_KEYS.orphans];
  const orphans = Array.isArray(rawOrphans)
    ? rawOrphans.filter(
        (o): o is OrphanRecord =>
          isTabRecord(o) &&
          typeof (o as unknown as Record<string, unknown>).orphanedAt === 'number',
      )
    : [];
  return { settings, tabs, history, orphans };
}
