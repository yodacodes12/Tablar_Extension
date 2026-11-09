import { domainOf } from '../core/domain';
import {
  BLOCKER_LABELS,
  evaluateEligibility,
  isAutoOnlyBlocker,
  type Eligibility,
} from '../core/eligibility';
import { markRestored, newHistoryId, pruneHistory } from '../core/history';
import { adoptOrphan, pruneOrphans, reconcileDetailed } from '../core/reconcile';
import { applySettingsPatch } from '../core/settings';
import {
  assertTransition,
  deriveState,
  InvalidTransitionError,
  isPendingOpStale,
} from '../core/state-machine';
import type {
  HistoryEntry,
  Settings,
  SuspensionMethod,
  TabRecord,
  TabSnapshot,
} from '../core/types';
import type { Counts, OpResult, Snapshot, TabView } from '../messages';
import type { TabsPort } from '../browser/tabs';
import { Mutex } from './mutex';
import type { Store } from './store';

export interface EngineDeps {
  tabs: TabsPort;
  store: Store;
  now: () => number;
  browserFamily: 'firefox' | 'chromium';
  /** Called after any change the UI should see. */
  onChange?: () => void;
  /** Called after an automatic run suspended tabs. */
  onAutoSuspended?: (count: number) => void;
  /** Next scheduled alarm time, for display. */
  nextAlarmAt?: () => Promise<number | null>;
}

/** Automatic runs closer together than this are duplicates (e.g. alarm fired twice after wake). */
export const MIN_EVALUATION_GAP_MS = 20_000;
/** After an automatic failure, wait this long before the scheduler retries the same tab. */
export const AUTO_RETRY_BACKOFF_MS = 10 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;

interface SuspendOptions {
  method: SuspensionMethod;
  force?: boolean;
}

export class Engine {
  readonly lock = new Mutex();
  private lastEvaluationAt: number | null = null;
  private lastPruneAt = 0;
  /** windowId → active tabId, so we can stamp the tab the user just left. */
  private activeByWindow = new Map<number, number>();

  constructor(private readonly d: EngineDeps) {}

  private get state() {
    return this.d.store.state;
  }

  private changed(): void {
    this.d.onChange?.();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /** Rebuild state against the live browser. Safe to call on every service-worker start. */
  async initialize(): Promise<void> {
    await this.lock.run(async () => {
      const now = this.d.now();
      const live = await this.d.tabs.query();
      const { records, unmatched } = reconcileDetailed(live, this.state.tabs, now);
      // Tabs the browser has not restored yet keep their history for a while (see adoptFrom).
      const known = new Set(this.state.orphans.map((o) => `${o.tabId}|${o.url}`));
      const fresh = unmatched
        .filter((r) => !known.has(`${r.tabId}|${r.url}`))
        .map((r) => ({ ...r, orphanedAt: now }));
      this.state.orphans = pruneOrphans([...this.state.orphans, ...fresh], now);

      // Recover operations interrupted by a service-worker shutdown or browser restart.
      for (const tab of live) {
        const rec = records[String(tab.id)];
        if (rec?.pendingOp) delete rec.pendingOp;
      }
      this.state.tabs = records;
      this.activeByWindow.clear();
      for (const t of live) if (t.active) this.activeByWindow.set(t.windowId, t.id);
      this.closeDanglingHistory(new Set(live.filter((t) => t.discarded).map((t) => t.id)), now);
      this.d.store.markDirty('tabs', 'history', 'orphans');
      await this.d.store.flush();
    });
    this.changed();
  }

  /**
   * A tab Tablar has not seen before may be a session-restored tab whose record was stored
   * before the browser restarted. Adopt that record (matched by URL) so its inactivity time
   * is not reset.
   */
  private adoptFrom(tab: TabSnapshot, rec: TabRecord, now: number): void {
    if (!tab.url || this.state.orphans.length === 0) return;
    const orphan = adoptOrphan(this.state.orphans, tab.url, now);
    if (!orphan) return;
    rec.firstSeenAt = orphan.firstSeenAt;
    if (!tab.active) rec.lastActiveAt = Math.min(orphan.lastActiveAt, now);
    if (tab.discarded && orphan.openHistoryId) rec.openHistoryId = orphan.openHistoryId;
    this.d.store.markDirty('tabs', 'orphans');
  }

  /** Suspension entries whose tab is no longer discarded (or gone) were restored while we were not running. */
  private closeDanglingHistory(discardedIds: Set<number>, now: number): void {
    const stillOpen = new Set(
      Object.values(this.state.tabs)
        .filter((r) => r.openHistoryId && discardedIds.has(r.tabId))
        .map((r) => r.openHistoryId as string),
    );
    for (const rec of Object.values(this.state.tabs)) {
      if (rec.openHistoryId && !stillOpen.has(rec.openHistoryId)) {
        markRestored(this.state.history, rec.openHistoryId, now);
        delete rec.openHistoryId;
      }
    }
  }

  // ───────────────────────── event tracking ─────────────────────────

  private ensureRecord(tab: TabSnapshot, now: number): TabRecord {
    const key = String(tab.id);
    let rec = this.state.tabs[key];
    if (!rec) {
      rec = {
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        firstSeenAt: now,
        // A brand-new tab (foreground or background) counts as used at creation.
        lastActiveAt: now,
      };
      this.state.tabs[key] = rec;
      this.d.store.markDirty('tabs');
    }
    return rec;
  }

  onCreated(tab: TabSnapshot): Promise<void> {
    return this.lock.run(async () => {
      const now = this.d.now();
      const rec = this.ensureRecord(tab, now);
      rec.lastActiveAt = now;
      this.adoptFrom(tab, rec, now);
      if (tab.active) this.setActive(tab.windowId, tab.id, now);
      this.d.store.markDirty('tabs');
      this.changed();
    });
  }

  private touch(tabId: number | undefined, now: number): void {
    if (tabId === undefined) return;
    const rec = this.state.tabs[String(tabId)];
    if (rec) {
      rec.lastActiveAt = now;
      this.d.store.markDirty('tabs');
    }
  }

  private setActive(windowId: number, tabId: number, now: number): void {
    const previous = this.activeByWindow.get(windowId);
    if (previous !== undefined && previous !== tabId) this.touch(previous, now); // the moment it was left
    this.activeByWindow.set(windowId, tabId);
    this.touch(tabId, now);
  }

  onActivated(tabId: number, windowId: number): Promise<void> {
    return this.lock.run(async () => {
      const now = this.d.now();
      const tab = await this.d.tabs.get(tabId);
      if (tab) this.ensureRecord(tab, now);
      this.setActive(windowId, tabId, now);
      this.changed();
    });
  }

  /** Focus moving between windows: stamp the active tab of the focused window. Other windows' tabs are untouched. */
  onWindowFocused(windowId: number): Promise<void> {
    return this.lock.run(async () => {
      const now = this.d.now();
      for (const [, tabId] of this.activeByWindow) this.touch(tabId, now);
      void windowId;
      this.changed();
    });
  }

  onUpdated(
    tabId: number,
    change: { url?: string; discarded?: boolean; status?: string },
    tab: TabSnapshot,
  ): Promise<void> {
    return this.lock.run(async () => {
      const now = this.d.now();
      const rec = this.ensureRecord(tab, now);
      if (rec.windowId !== tab.windowId) rec.windowId = tab.windowId;
      if (typeof change.url === 'string' && change.url !== rec.url) {
        rec.url = change.url;
        if (!tab.discarded) delete rec.openHistoryId;
        // Restored tabs often start blank and receive their real URL in an update.
        if (rec.firstSeenAt === rec.lastActiveAt || now - rec.firstSeenAt < 5_000)
          this.adoptFrom(tab, rec, now);
      }
      if (change.discarded === false && rec.openHistoryId) {
        markRestored(this.state.history, rec.openHistoryId, now);
        delete rec.openHistoryId;
        rec.lastActiveAt = Math.max(rec.lastActiveAt, now);
        this.d.store.markDirty('history');
      }
      this.d.store.markDirty('tabs');
      this.changed();
    });
  }

  onRemoved(tabId: number): Promise<void> {
    return this.lock.run(async () => {
      const key = String(tabId);
      if (this.state.tabs[key]) {
        delete this.state.tabs[key];
        this.d.store.markDirty('tabs');
      }
      for (const [w, t] of this.activeByWindow) if (t === tabId) this.activeByWindow.delete(w);
      this.changed();
    });
  }

  onReplaced(addedTabId: number, removedTabId: number): Promise<void> {
    return this.lock.run(async () => {
      this.moveRecord(removedTabId, addedTabId);
      this.changed();
    });
  }

  onAttached(tabId: number, windowId: number): Promise<void> {
    return this.lock.run(async () => {
      const rec = this.state.tabs[String(tabId)];
      if (rec) {
        rec.windowId = windowId;
        this.d.store.markDirty('tabs');
      }
    });
  }

  private moveRecord(from: number, to: number): void {
    if (from === to) return;
    const rec = this.state.tabs[String(from)];
    if (!rec) return;
    delete this.state.tabs[String(from)];
    this.state.tabs[String(to)] = { ...rec, tabId: to };
    for (const [w, t] of this.activeByWindow) if (t === from) this.activeByWindow.set(w, to);
    this.d.store.markDirty('tabs');
  }

  // ───────────────────────── suspension ─────────────────────────

  private explain(e: Eligibility, mode: 'auto' | 'manual'): string {
    const relevant = e.blockers.filter((b) => mode === 'auto' || !isAutoOnlyBlocker(b));
    return relevant.map((b) => BLOCKER_LABELS[b]).join(', ') || 'Not eligible';
  }

  private record(entry: Omit<HistoryEntry, 'id'>, now: number): HistoryEntry {
    const full: HistoryEntry = { id: newHistoryId(now), ...entry };
    this.state.history.unshift(full);
    this.d.store.markDirty('history');
    return full;
  }

  /** One tab, under the lock. Implements the full verify → discard → verify → record workflow. */
  private async suspendOne(tabId: number, opts: SuspendOptions): Promise<OpResult> {
    const now = this.d.now();
    const settings = this.state.settings;
    const tab = await this.d.tabs.get(tabId);
    if (!tab) return { tabId, ok: false, error: 'The tab no longer exists.' };
    const rec = this.ensureRecord(tab, now);
    const auto = opts.method === 'automatic';

    const elig = evaluateEligibility(tab, rec, settings, now);
    const allowed = auto
      ? elig.autoEligible
      : elig.manualAllowed || (!!opts.force && elig.manualForceAllowed);
    if (!allowed) {
      if (tab.discarded) return { tabId, ok: false, error: 'Already suspended.' };
      return {
        tabId,
        ok: false,
        error: `Protected: ${this.explain(elig, auto ? 'auto' : 'manual')}.`,
      };
    }
    if (auto && rec.lastError && now - rec.lastError.at < AUTO_RETRY_BACKOFF_MS) {
      return { tabId, ok: false, error: 'Waiting before retrying a failed suspension.' };
    }

    try {
      assertTransition(deriveState(tab, rec, elig, now), 'SUSPENDING');
    } catch (e) {
      if (e instanceof InvalidTransitionError) return { tabId, ok: false, error: e.message };
      throw e;
    }
    rec.pendingOp = { kind: 'suspend', startedAt: now };
    this.d.store.markDirty('tabs');
    await this.d.store.flush();
    this.changed();

    // Race guard: re-read the live tab immediately before discarding.
    const fresh = await this.d.tabs.get(tabId);
    const freshElig = fresh ? evaluateEligibility(fresh, rec, settings, this.d.now()) : null;
    const stillAllowed =
      fresh &&
      freshElig &&
      (auto
        ? freshElig.autoEligible
        : freshElig.manualAllowed || (!!opts.force && freshElig.manualForceAllowed));
    if (!fresh || !freshElig || !stillAllowed) {
      delete rec.pendingOp;
      this.d.store.markDirty('tabs');
      const why = !fresh
        ? 'The tab was closed.'
        : fresh.active
          ? 'The tab became active.'
          : 'The tab is no longer eligible.';
      return { tabId, ok: false, error: why };
    }

    const reason = auto
      ? `Inactive for ${Math.round(freshElig.inactiveMs / 60_000)} min (threshold ${settings.thresholdMinutes} min)`
      : opts.force && !freshElig.manualAllowed
        ? `Manual override of: ${this.explain(freshElig, 'manual')}`
        : opts.method === 'manual-bulk'
          ? 'Bulk action'
          : 'Suspended by user';

    const result = await this.d.tabs.discard(tabId);
    const done = this.d.now();
    let current = rec;
    if (result.ok && result.tab.id !== tabId) {
      this.moveRecord(tabId, result.tab.id);
      current = this.state.tabs[String(result.tab.id)] ?? rec;
    }
    delete current.pendingOp;

    const base = {
      tabTitle: fresh.title,
      url: fresh.url,
      domain: domainOf(fresh.url),
      suspendedAt: done,
      method: opts.method,
      reason,
    };
    const keepHistory = !fresh.incognito; // never write private-window URLs to disk

    if (result.ok) {
      delete current.lastError;
      if (keepHistory) current.openHistoryId = this.record({ ...base, result: 'success' }, done).id;
      this.d.store.markDirty('tabs');
      return { tabId: result.tab.id, ok: true };
    }

    const repeated = current.lastError?.message === result.error;
    current.lastError = { message: result.error, at: done };
    if (keepHistory && !(auto && repeated))
      this.record({ ...base, result: 'failed', error: result.error }, done);
    this.d.store.markDirty('tabs');
    return { tabId, ok: false, error: result.error };
  }

  suspend(tabIds: readonly number[], opts: SuspendOptions): Promise<OpResult[]> {
    return this.lock.run(() => this.suspendMany(tabIds, opts));
  }

  private async suspendMany(tabIds: readonly number[], opts: SuspendOptions): Promise<OpResult[]> {
    const results: OpResult[] = [];
    for (const id of new Set(tabIds)) {
      try {
        results.push(await this.suspendOne(id, opts));
      } catch (e) {
        const rec = this.state.tabs[String(id)];
        if (rec) delete rec.pendingOp;
        results.push({
          tabId: id,
          ok: false,
          error: e instanceof Error ? e.message : 'Unexpected error',
        });
      }
    }
    await this.d.store.flush();
    this.changed();
    return results;
  }

  /** "Suspend idle tabs": tabs past the inactivity threshold that pass every protection rule. */
  suspendIdle(): Promise<OpResult[]> {
    return this.lock.run(async () => {
      const now = this.d.now();
      const live = await this.d.tabs.query();
      const settings = { ...this.state.settings, autoSuspend: true };
      const ids = live
        .filter(
          (t) => evaluateEligibility(t, this.state.tabs[String(t.id)], settings, now).autoEligible,
        )
        .map((t) => t.id);
      return this.suspendMany(ids, { method: 'manual-bulk' });
    });
  }

  /** "Suspend all other tabs": every unprotected inactive tab regardless of idle time. Active tabs are never included. */
  suspendAllInactive(): Promise<OpResult[]> {
    return this.lock.run(async () => {
      const now = this.d.now();
      const live = await this.d.tabs.query();
      const ids = live
        .filter(
          (t) =>
            evaluateEligibility(t, this.state.tabs[String(t.id)], this.state.settings, now)
              .manualAllowed,
        )
        .map((t) => t.id);
      return this.suspendMany(ids, { method: 'manual-bulk' });
    });
  }

  // ───────────────────────── restoration ─────────────────────────

  restore(tabIds: readonly number[]): Promise<OpResult[]> {
    return this.lock.run(async () => {
      const results: OpResult[] = [];
      for (const id of new Set(tabIds)) results.push(await this.restoreOne(id));
      await this.d.store.flush();
      this.changed();
      return results;
    });
  }

  restoreAll(): Promise<OpResult[]> {
    return this.lock.run(async () => {
      const live = await this.d.tabs.query();
      const results: OpResult[] = [];
      for (const t of live.filter((x) => x.discarded)) results.push(await this.restoreOne(t.id));
      await this.d.store.flush();
      this.changed();
      return results;
    });
  }

  private async restoreOne(tabId: number): Promise<OpResult> {
    const now = this.d.now();
    const tab = await this.d.tabs.get(tabId);
    if (!tab) return { tabId, ok: false, error: 'The tab no longer exists.' };
    if (!tab.discarded) return { tabId, ok: false, error: 'This tab is not suspended.' };
    const rec = this.ensureRecord(tab, now);
    assertTransition('SUSPENDED', 'RESTORING');
    rec.pendingOp = { kind: 'restore', startedAt: now };
    this.changed();
    let after: TabSnapshot | null;
    try {
      after = await this.d.tabs.reload(tabId);
    } catch (e) {
      delete rec.pendingOp;
      const msg = e instanceof Error ? e.message : 'Reload failed';
      rec.lastError = { message: msg, at: this.d.now() };
      this.d.store.markDirty('tabs');
      return { tabId, ok: false, error: `The browser could not reload the tab: ${msg}` };
    }
    delete rec.pendingOp;
    const done = this.d.now();
    if (!after) {
      return { tabId, ok: false, error: 'The tab was closed.' };
    }
    if (after.discarded) {
      rec.lastError = { message: 'The tab did not reload in time.', at: done };
      this.d.store.markDirty('tabs');
      return {
        tabId,
        ok: false,
        error: 'The tab did not reload in time. Try opening it directly.',
      };
    }
    if (rec.openHistoryId) {
      markRestored(this.state.history, rec.openHistoryId, done);
      delete rec.openHistoryId;
      this.d.store.markDirty('history');
    }
    delete rec.lastError;
    rec.lastActiveAt = done; // restoring is a deliberate use; don't re-suspend it on the next tick
    this.d.store.markDirty('tabs');
    return { tabId, ok: true };
  }

  activate(tabId: number): Promise<void> {
    return this.d.tabs.activate(tabId);
  }

  // ───────────────────────── scheduler ─────────────────────────

  /**
   * Alarm handler. Idempotent: uses wall-clock timestamps only, skips duplicate firings,
   * re-validates every tab against the live browser, and never trusts previous runs.
   */
  evaluate(opts: { ignoreGap?: boolean } = {}): Promise<OpResult[]> {
    return this.lock.run(async () => {
      const now = this.d.now();
      if (
        !opts.ignoreGap &&
        this.lastEvaluationAt !== null &&
        now - this.lastEvaluationAt < MIN_EVALUATION_GAP_MS &&
        now >= this.lastEvaluationAt
      ) {
        return [];
      }
      this.lastEvaluationAt = now;
      const live = await this.d.tabs.query();
      const liveIds = new Set(live.map((t) => t.id));

      // Drop records for tabs that disappeared without an event (e.g. while the worker was dead).
      for (const key of Object.keys(this.state.tabs)) {
        if (!liveIds.has(Number(key))) {
          delete this.state.tabs[key];
          this.d.store.markDirty('tabs');
        }
      }
      for (const tab of live) {
        const rec = this.ensureRecord(tab, now);
        if (tab.active) {
          rec.lastActiveAt = now; // heartbeat: an active tab is in use right now
          this.activeByWindow.set(tab.windowId, tab.id);
        }
        if (isPendingOpStale(rec, now)) delete rec.pendingOp;
        if (tab.url && rec.url !== tab.url) rec.url = tab.url;
      }
      this.d.store.markDirty('tabs');

      if (this.state.orphans.length) {
        const kept = pruneOrphans(this.state.orphans, now);
        if (kept.length !== this.state.orphans.length) {
          this.state.orphans = kept;
          this.d.store.markDirty('orphans');
        }
      }
      if (now - this.lastPruneAt > PRUNE_EVERY_MS) {
        this.state.history = pruneHistory(
          this.state.history,
          now,
          this.state.settings.historyRetentionDays,
        );
        this.lastPruneAt = now;
        this.d.store.markDirty('history');
      }

      let results: OpResult[] = [];
      if (this.state.settings.autoSuspend) {
        const candidates = live
          .filter(
            (t) =>
              evaluateEligibility(t, this.state.tabs[String(t.id)], this.state.settings, now)
                .autoEligible,
          )
          .map((t) => t.id);
        results = await this.suspendMany(candidates, { method: 'automatic' });
        const succeeded = results.filter((r) => r.ok).length;
        if (succeeded > 0) this.d.onAutoSuspended?.(succeeded);
      } else {
        await this.d.store.flush();
        this.changed();
      }
      return results;
    });
  }

  // ───────────────────────── settings & history ─────────────────────────

  updateSettings(
    patch: Partial<Settings>,
  ): Promise<{ ok: true; settings: Settings } | { ok: false; error: string }> {
    return this.lock.run(async () => {
      const res = applySettingsPatch(this.state.settings, patch);
      if (!res.ok) return res;
      const retentionChanged =
        res.settings.historyRetentionDays !== this.state.settings.historyRetentionDays;
      this.state.settings = res.settings;
      this.d.store.markDirty('settings');
      if (retentionChanged) {
        this.state.history = pruneHistory(
          this.state.history,
          this.d.now(),
          res.settings.historyRetentionDays,
        );
        this.d.store.markDirty('history');
      }
      await this.d.store.flush();
      this.changed();
      return { ok: true as const, settings: res.settings };
    });
  }

  clearHistory(): Promise<void> {
    return this.lock.run(async () => {
      this.state.history = [];
      for (const rec of Object.values(this.state.tabs)) delete rec.openHistoryId;
      this.d.store.markDirty('history', 'tabs');
      await this.d.store.flush();
      this.changed();
    });
  }

  history(): HistoryEntry[] {
    return this.state.history.slice();
  }

  /** Test hook (E2E builds only): pretend a tab was last used at `at`. */
  debugSetLastActive(tabId: number, at: number): Promise<boolean> {
    return this.lock.run(async () => {
      const rec = this.state.tabs[String(tabId)];
      if (!rec) return false;
      rec.lastActiveAt = at;
      this.d.store.markDirty('tabs');
      await this.d.store.flush();
      return true;
    });
  }

  // ───────────────────────── snapshot ─────────────────────────

  async snapshot(): Promise<Snapshot> {
    const now = this.d.now();
    const live = await this.d.tabs.query();
    const settings = this.state.settings;
    const historyById = new Map(this.state.history.map((h) => [h.id, h]));
    const views: TabView[] = live.map((tab) => {
      const rec = this.state.tabs[String(tab.id)];
      const elig = evaluateEligibility(tab, rec, settings, now);
      const state = deriveState(tab, rec, elig, now);
      const entry = rec?.openHistoryId ? historyById.get(rec.openHistoryId) : undefined;
      return {
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title,
        url: tab.url,
        domain: domainOf(tab.url),
        favIconUrl: tab.favIconUrl,
        active: tab.active,
        pinned: tab.pinned,
        audible: tab.audible,
        muted: tab.muted,
        discarded: tab.discarded,
        incognito: tab.incognito,
        state,
        inactiveMs: elig.inactiveMs,
        blockers: elig.blockers,
        protections: elig.protections,
        whitelistRule: elig.whitelistRule,
        autoEligible: elig.autoEligible,
        manualAllowed: elig.manualAllowed,
        manualForceAllowed: elig.manualForceAllowed,
        lastError: state === 'ERROR' ? rec?.lastError?.message : undefined,
        suspension:
          tab.discarded && entry
            ? { at: entry.suspendedAt, method: entry.method, reason: entry.reason }
            : undefined,
      };
    });
    return {
      now,
      tabs: views,
      counts: countStates(views),
      settings,
      browser: this.d.browserFamily,
      lastEvaluationAt: this.lastEvaluationAt,
      nextEvaluationAt: (await this.d.nextAlarmAt?.()) ?? null,
      recentHistory: this.state.history.slice(0, 8),
    };
  }
}

export function countStates(views: readonly TabView[]): Counts {
  return {
    total: views.length,
    active: views.filter((v) => v.active).length,
    inactive: views.filter((v) => !v.active && !v.discarded).length,
    eligible: views.filter((v) => v.autoEligible).length,
    suspended: views.filter((v) => v.discarded).length,
    protected: views.filter((v) => v.state === 'PROTECTED').length,
  };
}
