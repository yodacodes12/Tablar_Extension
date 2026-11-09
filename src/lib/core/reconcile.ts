import type { TabRecord, TabSnapshot } from './types';

/**
 * Rebuild tab records against the live browser inventory.
 * Tab IDs are not stable across restarts, so records whose ID no longer matches the same URL
 * are re-associated by URL (most-recently-used first). Unknown tabs get a fresh record using
 * the browser's lastAccessed when available, otherwise "now" — never an invented older time.
 */
export function reconcileRecords(
  live: readonly TabSnapshot[],
  stored: Record<string, TabRecord>,
  now: number,
): Record<string, TabRecord> {
  return reconcileDetailed(live, stored, now).records;
}

export interface ReconcileResult {
  records: Record<string, TabRecord>;
  /** Stored records no live tab claimed — possibly tabs the browser has not restored yet. */
  unmatched: TabRecord[];
}

export function reconcileDetailed(
  live: readonly TabSnapshot[],
  stored: Record<string, TabRecord>,
  now: number,
): ReconcileResult {
  const result: Record<string, TabRecord> = {};
  const unclaimed = new Map<string, TabRecord[]>();
  const claimedIds = new Set<number>();

  // 1. Exact ID + URL matches (service-worker restart without browser restart).
  for (const tab of live) {
    const rec = stored[String(tab.id)];
    if (rec && rec.url === tab.url) {
      result[String(tab.id)] = {
        ...rec,
        windowId: tab.windowId,
        lastActiveAt: tab.active ? now : rec.lastActiveAt,
      };
      claimedIds.add(rec.tabId);
    }
  }

  // 2. Remaining stored records become candidates keyed by URL.
  for (const rec of Object.values(stored)) {
    if (claimedIds.has(rec.tabId)) continue;
    const list = unclaimed.get(rec.url) ?? [];
    list.push(rec);
    unclaimed.set(rec.url, list);
  }
  for (const list of unclaimed.values()) list.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  // 3. Assign to unmatched live tabs.
  for (const tab of live) {
    const key = String(tab.id);
    if (result[key]) continue;
    const candidate = unclaimed.get(tab.url)?.shift();
    const browserTime = tab.lastAccessed && tab.lastAccessed <= now ? tab.lastAccessed : undefined;
    if (candidate) {
      result[key] = {
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        firstSeenAt: candidate.firstSeenAt,
        // Tablar's record wins: browsers may bump lastAccessed when restoring a session.
        lastActiveAt: tab.active ? now : Math.min(candidate.lastActiveAt, now),
      };
    } else {
      result[key] = {
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        firstSeenAt: now,
        lastActiveAt: tab.active ? now : (browserTime ?? now),
      };
    }
  }
  const unmatched = [...unclaimed.values()].flat();
  return { records: result, unmatched };
}

/** How long unmatched records wait for a session-restored tab to claim them. */
export const ORPHAN_TTL_MS = 10 * 60_000;

export interface OrphanRecord extends TabRecord {
  orphanedAt: number;
}

/** Remove and return the best orphan (most recently used) for a URL, ignoring expired ones. */
export function adoptOrphan(
  orphans: OrphanRecord[],
  url: string,
  now: number,
): OrphanRecord | null {
  let best = -1;
  for (let i = 0; i < orphans.length; i++) {
    const o = orphans[i]!;
    if (o.url !== url || now - o.orphanedAt > ORPHAN_TTL_MS) continue;
    if (best === -1 || o.lastActiveAt > orphans[best]!.lastActiveAt) best = i;
  }
  return best === -1 ? null : (orphans.splice(best, 1)[0] ?? null);
}

export function pruneOrphans(orphans: OrphanRecord[], now: number): OrphanRecord[] {
  return orphans.filter((o) => now - o.orphanedAt <= ORPHAN_TTL_MS);
}
