import {
  migrate,
  parsePersistedState,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  type PersistedState,
} from '../core/schema';
import { DEFAULT_SETTINGS } from '../core/settings';

export interface KeyValueStorage {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

type Part = 'settings' | 'tabs' | 'history' | 'orphans';

/**
 * In-memory cache of persisted state with coalesced write-through.
 * The service worker can be killed at any time, so writes are flushed quickly (≤ debounceMs)
 * and every important mutation path awaits `flush()` before reporting success.
 */
export class Store {
  state: PersistedState = { settings: { ...DEFAULT_SETTINGS }, tabs: {}, history: [], orphans: [] };
  private dirty = new Set<Part>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly debounceMs = 200,
  ) {}

  async load(now: number): Promise<{ migratedFrom: number | null; recovered: boolean }> {
    let raw: Record<string, unknown> = {};
    let recovered = false;
    try {
      raw = await this.storage.get(null);
    } catch {
      recovered = true; // unreadable storage → start from defaults rather than crash
    }
    let migratedFrom: number | null = null;
    try {
      const m = migrate(raw);
      raw = m.raw;
      if (m.migrated) migratedFrom = m.from;
    } catch {
      recovered = true;
    }
    this.state = parsePersistedState(raw, now);
    if (migratedFrom !== null || recovered) {
      this.markDirty('settings', 'tabs', 'history', 'orphans');
      await this.flush();
    }
    return { migratedFrom, recovered };
  }

  markDirty(...parts: Part[]): void {
    for (const p of parts) this.dirty.add(p);
    if (this.timer === null) this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty.size === 0) return this.writing;
    const items: Record<string, unknown> = {
      [STORAGE_KEYS.meta]: { schemaVersion: SCHEMA_VERSION },
    };
    for (const part of this.dirty) items[STORAGE_KEYS[part]] = this.state[part];
    this.dirty.clear();
    this.writing = this.writing
      .then(() => this.storage.set(items))
      .catch((e) => {
        console.error('[Tablar] storage write failed', e);
      });
    return this.writing;
  }
}
