import { browser, type Browser } from 'wxt/browser';
import type { TabSnapshot } from '../core/types';

export type DiscardResult = { ok: true; tab: TabSnapshot } | { ok: false; error: string };

/** Everything the engine needs from the tabs API. Implemented for real browsers below and faked in tests. */
export interface TabsPort {
  query(): Promise<TabSnapshot[]>;
  get(tabId: number): Promise<TabSnapshot | null>;
  /** Native discard + verification against the browser's resulting state. */
  discard(tabId: number): Promise<DiscardResult>;
  /** Reload a discarded tab in place (does not switch to it). Resolves when the browser reports it loaded or after a timeout. */
  reload(tabId: number): Promise<TabSnapshot | null>;
  activate(tabId: number): Promise<void>;
}

type RawTab = Browser.tabs.Tab & {
  // Firefox-only, not in Chromium typings.
  sharingState?: { camera?: boolean; microphone?: boolean; screen?: string | boolean };
  // Chromium 132+.
  frozen?: boolean;
};

export function toSnapshot(raw: RawTab | undefined | null): TabSnapshot | null {
  if (!raw || typeof raw.id !== 'number' || raw.id < 0 || typeof raw.windowId !== 'number')
    return null;
  const sharing = raw.sharingState;
  return {
    id: raw.id,
    windowId: raw.windowId,
    index: typeof raw.index === 'number' ? raw.index : 0,
    url: raw.url ?? raw.pendingUrl ?? '',
    title: raw.title || raw.url || 'Untitled',
    favIconUrl: raw.favIconUrl || undefined,
    active: !!raw.active,
    pinned: !!raw.pinned,
    audible: !!raw.audible,
    muted: !!raw.mutedInfo?.muted,
    discarded: !!raw.discarded,
    incognito: !!raw.incognito,
    status: raw.status,
    autoDiscardable: typeof raw.autoDiscardable === 'boolean' ? raw.autoDiscardable : undefined,
    lastAccessed: typeof raw.lastAccessed === 'number' ? raw.lastAccessed : undefined,
    mediaCapture: !!(sharing && (sharing.camera || sharing.microphone || sharing.screen)),
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unknown error';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getTab(tabId: number): Promise<TabSnapshot | null> {
  try {
    return toSnapshot((await browser.tabs.get(tabId)) as RawTab);
  } catch {
    return null;
  }
}

/** Poll until `done` or timeout; returns the last observed tab. */
async function waitFor(
  tabId: number,
  done: (t: TabSnapshot) => boolean,
  timeoutMs: number,
): Promise<TabSnapshot | null> {
  const start = Date.now();
  let tab = await getTab(tabId);
  while (tab && !done(tab) && Date.now() - start < timeoutMs) {
    await sleep(100);
    tab = await getTab(tabId);
  }
  return tab;
}

export const browserTabs: TabsPort = {
  async query() {
    const all = (await browser.tabs.query({})) as RawTab[];
    return all.map(toSnapshot).filter((t): t is TabSnapshot => t !== null);
  },

  get: getTab,

  async discard(tabId) {
    let returnedId = tabId;
    try {
      // Chromium resolves with the discarded Tab (or undefined); Firefox resolves with nothing,
      // even when it silently declined (active tab, beforeunload prompt). Always verify.
      const returned = (await browser.tabs.discard(tabId)) as RawTab | undefined;
      if (returned && typeof returned.id === 'number') returnedId = returned.id;
    } catch (e) {
      return { ok: false, error: friendlyDiscardError(errorMessage(e)) };
    }
    let tab = await waitFor(returnedId, (t) => t.discarded, 1500);
    if (!tab && returnedId !== tabId) tab = await getTab(tabId);
    if (!tab) return { ok: false, error: 'The tab was closed.' };
    if (!tab.discarded) {
      return {
        ok: false,
        error: tab.active
          ? 'The tab became active, so it was not suspended.'
          : 'The browser declined to suspend this tab (it may be showing a "leave page?" prompt or be otherwise busy).',
      };
    }
    return { ok: true, tab };
  },

  async reload(tabId) {
    try {
      await browser.tabs.reload(tabId);
    } catch (e) {
      throw new Error(errorMessage(e), { cause: e });
    }
    return waitFor(tabId, (t) => !t.discarded, 3000);
  },

  async activate(tabId) {
    const tab = (await browser.tabs.update(tabId, { active: true })) as RawTab | undefined;
    if (tab && typeof tab.windowId === 'number') {
      await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    }
  },
};

function friendlyDiscardError(raw: string): string {
  if (/active/i.test(raw)) return 'The active tab cannot be suspended.';
  if (/no tab|invalid tab|not found/i.test(raw)) return 'The tab no longer exists.';
  return `The browser rejected the request: ${raw}`;
}
