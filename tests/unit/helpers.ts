import type { DiscardResult, TabsPort } from '../../src/lib/browser/tabs';
import type { KeyValueStorage } from '../../src/lib/background/store';
import type { TabSnapshot } from '../../src/lib/core/types';

export const MIN = 60_000;

export function tab(over: Partial<TabSnapshot> & { id: number }): TabSnapshot {
  return {
    windowId: 1,
    index: over.id,
    url: `https://site${over.id}.example/page`,
    title: `Tab ${over.id}`,
    active: false,
    pinned: false,
    audible: false,
    muted: false,
    discarded: false,
    incognito: false,
    status: 'complete',
    mediaCapture: false,
    ...over,
  };
}

export class MemoryStorage implements KeyValueStorage {
  data: Record<string, unknown> = {};
  writes = 0;
  async get(keys: string[] | null) {
    const src = structuredClone(this.data);
    if (!keys) return src;
    return Object.fromEntries(keys.filter((k) => k in src).map((k) => [k, src[k]]));
  }
  async set(items: Record<string, unknown>) {
    this.writes++;
    Object.assign(this.data, structuredClone(items));
  }
}

/** In-memory browser with Chromium/Firefox-like discard semantics and hooks for races. */
export class FakeTabs implements TabsPort {
  tabs = new Map<number, TabSnapshot>();
  discardCalls: number[] = [];
  /** Runs just before the native discard executes — used to simulate races. */
  beforeDiscard?: (id: number) => void;
  /** Force the browser to decline / throw for specific tabs. */
  decline = new Set<number>();
  throwOn = new Map<number, string>();
  /** Simulate Chromium returning a different tab id after discard. */
  replaceIdOnDiscard = new Map<number, number>();

  constructor(list: TabSnapshot[] = []) {
    for (const t of list) this.tabs.set(t.id, { ...t });
  }
  async query() {
    return [...this.tabs.values()].map((t) => ({ ...t }));
  }
  async get(id: number) {
    const t = this.tabs.get(id);
    return t ? { ...t } : null;
  }
  async discard(id: number): Promise<DiscardResult> {
    this.discardCalls.push(id);
    this.beforeDiscard?.(id);
    const t = this.tabs.get(id);
    if (this.throwOn.has(id)) return { ok: false, error: this.throwOn.get(id)! };
    if (!t) return { ok: false, error: 'The tab was closed.' };
    if (t.active) return { ok: false, error: 'The active tab cannot be suspended.' };
    if (this.decline.has(id))
      return { ok: false, error: 'The browser declined to suspend this tab.' };
    let current = t;
    const newId = this.replaceIdOnDiscard.get(id);
    if (newId !== undefined) {
      this.tabs.delete(id);
      current = { ...t, id: newId };
    }
    current.discarded = true;
    this.tabs.set(current.id, current);
    return { ok: true, tab: { ...current } };
  }
  async reload(id: number) {
    const t = this.tabs.get(id);
    if (!t) return null;
    t.discarded = false;
    return { ...t };
  }
  async activate(id: number) {
    const t = this.tabs.get(id);
    if (!t) throw new Error('No tab');
    for (const o of this.tabs.values()) if (o.windowId === t.windowId) o.active = false;
    t.active = true;
  }
}
