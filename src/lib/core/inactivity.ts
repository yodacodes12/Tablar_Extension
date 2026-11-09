import type { TabRecord, TabSnapshot } from './types';

export const THRESHOLD_PRESETS = [5, 10, 15, 30, 45, 60] as const;
export const MIN_THRESHOLD_MINUTES = 1;
export const MAX_THRESHOLD_MINUTES = 24 * 60;
export const DEFAULT_THRESHOLD_MINUTES = 30;

export type ThresholdValidation = { ok: true; value: number } | { ok: false; error: string };

export function validateThreshold(input: unknown): ThresholdValidation {
  const n = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
  if (typeof n !== 'number' || !Number.isFinite(n))
    return { ok: false, error: 'Enter a number of minutes' };
  if (!Number.isInteger(n)) return { ok: false, error: 'Use whole minutes' };
  if (n < MIN_THRESHOLD_MINUTES || n > MAX_THRESHOLD_MINUTES)
    return {
      ok: false,
      error: `Choose between ${MIN_THRESHOLD_MINUTES} and ${MAX_THRESHOLD_MINUTES} minutes`,
    };
  return { ok: true, value: n };
}

const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * The moment the tab was last in use. Tablar's own record is authoritative: it is stamped
 * when a tab is left (not just when it is entered) and on every scheduler heartbeat.
 * The browser's lastAccessed (Chrome 121+, Firefox) is only a fallback for tabs without a
 * record — and is merged in during startup reconciliation.
 */
export function lastUsedAt(tab: TabSnapshot, record: TabRecord | undefined): number | null {
  if (record && valid(record.lastActiveAt)) return record.lastActiveAt;
  return valid(tab.lastAccessed) ? tab.lastAccessed : null;
}

/** Milliseconds since the tab was last used. Active tabs are always 0. Clock skew never yields negatives. */
export function inactiveMs(tab: TabSnapshot, record: TabRecord | undefined, now: number): number {
  if (tab.active) return 0;
  const last = lastUsedAt(tab, record);
  if (last === null) return 0;
  return Math.max(0, now - last);
}

export function thresholdMs(minutes: number): number {
  return minutes * 60_000;
}
