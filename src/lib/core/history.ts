import type { HistoryEntry } from './types';

export const HISTORY_MAX_ENTRIES = 1000;
const DAY = 86_400_000;

export function pruneHistory(
  entries: readonly HistoryEntry[],
  now: number,
  retentionDays: number,
): HistoryEntry[] {
  const cutoff = now - retentionDays * DAY;
  return entries
    .filter((e) => Math.max(e.suspendedAt, e.restoredAt ?? 0) >= cutoff)
    .sort((a, b) => b.suspendedAt - a.suspendedAt)
    .slice(0, HISTORY_MAX_ENTRIES);
}

export function markRestored(entries: HistoryEntry[], id: string, at: number): boolean {
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.result !== 'success' || entry.restoredAt) return false;
  entry.restoredAt = at;
  return true;
}

export function isHistoryEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.url === 'string' &&
    typeof e.tabTitle === 'string' &&
    typeof e.domain === 'string' &&
    typeof e.suspendedAt === 'number' &&
    typeof e.reason === 'string' &&
    (e.method === 'automatic' || e.method === 'manual-single' || e.method === 'manual-bulk') &&
    (e.result === 'success' || e.result === 'failed') &&
    (e.restoredAt === undefined || typeof e.restoredAt === 'number')
  );
}

let counter = 0;
export function newHistoryId(now: number): string {
  counter = (counter + 1) % 1_000_000;
  return `${now.toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
