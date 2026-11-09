/** Normalised subset of the browser Tab object that Tablar relies on. */
export interface TabSnapshot {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  discarded: boolean;
  incognito: boolean;
  /** 'loading' | 'complete' | 'unloaded' (Chromium) — undefined when not reported. */
  status?: string;
  /** false when the user or another extension opted the tab out of discarding. */
  autoDiscardable?: boolean;
  /** Browser-reported last activation time (Chrome 121+, Firefox). */
  lastAccessed?: number;
  /** Camera / microphone / screen capture, only where the browser exposes it (Firefox sharingState). */
  mediaCapture: boolean;
}

export type PendingOpKind = 'suspend' | 'restore';

/** Persisted per-tab metadata. Kept intentionally small. */
export interface TabRecord {
  tabId: number;
  windowId: number;
  url: string;
  /** When Tablar first saw the tab. */
  firstSeenAt: number;
  /** Last moment the tab was known to be in use (active, or the moment it stopped being active). */
  lastActiveAt: number;
  pendingOp?: { kind: PendingOpKind; startedAt: number };
  lastError?: { message: string; at: number };
  /** History entry of the most recent suspension, used to stamp the restore time. */
  openHistoryId?: string;
}

export type SuspensionMethod = 'automatic' | 'manual-single' | 'manual-bulk';

export type TabState =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'ELIGIBLE'
  | 'SUSPENDING'
  | 'SUSPENDED'
  | 'RESTORING'
  | 'PROTECTED'
  | 'ERROR'
  | 'CLOSED';

/** Blockers that no user action can override. */
export type HardBlocker = 'active' | 'internal-page' | 'already-discarded';
/** Protections the user may override with an explicit, confirmed manual action. */
export type SoftBlocker =
  'pinned' | 'audible' | 'media-capture' | 'whitelisted' | 'incognito' | 'not-auto-discardable';
/** Conditions that only delay automatic suspension. */
export type AutoOnlyBlocker = 'recently-used' | 'loading' | 'auto-disabled';
export type Blocker = HardBlocker | SoftBlocker | AutoOnlyBlocker;

export type ThemePreference = 'system' | 'light' | 'dark';
export type IncognitoPolicy = 'protect' | 'allow';

export interface Settings {
  autoSuspend: boolean;
  thresholdMinutes: number;
  protectPinned: boolean;
  protectAudible: boolean;
  protectMediaCapture: boolean;
  whitelist: string[];
  notifications: boolean;
  memoryMonitoring: boolean;
  historyRetentionDays: number;
  theme: ThemePreference;
  incognito: IncognitoPolicy;
}

export type HistoryResult = 'success' | 'failed';

export interface HistoryEntry {
  id: string;
  tabTitle: string;
  url: string;
  domain: string;
  suspendedAt: number;
  method: SuspensionMethod;
  reason: string;
  restoredAt?: number;
  result: HistoryResult;
  error?: string;
}
