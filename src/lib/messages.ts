import type { Blocker, HistoryEntry, Settings, SuspensionMethod, TabState } from './core/types';
import type { MemoryReport } from './memory/service';

export interface TabView {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  domain: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  discarded: boolean;
  incognito: boolean;
  state: TabState;
  inactiveMs: number;
  blockers: Blocker[];
  protections: Blocker[];
  whitelistRule: string | null;
  autoEligible: boolean;
  manualAllowed: boolean;
  manualForceAllowed: boolean;
  lastError?: string;
  suspension?: { at: number; method: SuspensionMethod; reason: string };
}

export interface Counts {
  total: number;
  active: number;
  inactive: number;
  eligible: number;
  suspended: number;
  protected: number;
}

export interface Snapshot {
  now: number;
  tabs: TabView[];
  counts: Counts;
  settings: Settings;
  browser: 'firefox' | 'chromium';
  lastEvaluationAt: number | null;
  nextEvaluationAt: number | null;
  recentHistory: HistoryEntry[];
}

export interface OpResult {
  tabId: number;
  ok: boolean;
  error?: string;
}

export type Request =
  | { type: 'getSnapshot' }
  | { type: 'getMemory' }
  | {
      type: 'suspend';
      tabIds: number[];
      method: Exclude<SuspensionMethod, 'automatic'>;
      force?: boolean;
    }
  | { type: 'suspendIdle' }
  | { type: 'suspendAllInactive' }
  | { type: 'restore'; tabIds: number[] }
  | { type: 'restoreAll' }
  | { type: 'activate'; tabId: number }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'getHistory' }
  | { type: 'clearHistory' }
  | { type: 'debug:setLastActive'; tabId: number; at: number }
  | { type: 'debug:evaluate' }
  | {
      type: 'debug:browser';
      op: 'create';
      props: { url: string; active?: boolean; pinned?: boolean };
    }
  | { type: 'debug:browser'; op: 'get'; tabId: number }
  | { type: 'debug:browser'; op: 'activeTab' | 'alarm' | 'settingsStored' };

export type ResponseMap = {
  getSnapshot: Snapshot;
  getMemory: MemoryReport;
  suspend: OpResult[];
  suspendIdle: OpResult[];
  suspendAllInactive: OpResult[];
  restore: OpResult[];
  restoreAll: OpResult[];
  activate: { ok: true };
  updateSettings: { ok: true; settings: Settings } | { ok: false; error: string };
  getHistory: HistoryEntry[];
  clearHistory: { ok: true };
  'debug:setLastActive': { ok: boolean };
  'debug:evaluate': OpResult[];
  'debug:browser': unknown;
};

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export const CHANGED_EVENT = 'tablar:changed';
