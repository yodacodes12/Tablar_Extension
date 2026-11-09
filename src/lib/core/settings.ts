import { parseRule } from './domain';
import { DEFAULT_THRESHOLD_MINUTES, validateThreshold } from './inactivity';
import type { Settings } from './types';

export const HISTORY_RETENTION_OPTIONS = [1, 7, 30, 90] as const;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  autoSuspend: true,
  thresholdMinutes: DEFAULT_THRESHOLD_MINUTES,
  protectPinned: true,
  protectAudible: true,
  protectMediaCapture: true,
  whitelist: [],
  notifications: false,
  memoryMonitoring: true,
  historyRetentionDays: 7,
  theme: 'system',
  incognito: 'protect',
});

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d;

export function sanitizeWhitelist(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const res = parseRule(item);
    if (res.ok) out.add(res.normalized);
  }
  return [...out];
}

/** Coerce anything (including corrupted storage) into valid Settings, field by field. */
export function sanitizeSettings(input: unknown): Settings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const threshold = validateThreshold(s.thresholdMinutes);
  const retention = s.historyRetentionDays;
  return {
    autoSuspend: bool(s.autoSuspend, d.autoSuspend),
    thresholdMinutes: threshold.ok ? threshold.value : d.thresholdMinutes,
    protectPinned: bool(s.protectPinned, d.protectPinned),
    protectAudible: bool(s.protectAudible, d.protectAudible),
    protectMediaCapture: bool(s.protectMediaCapture, d.protectMediaCapture),
    whitelist: sanitizeWhitelist(s.whitelist),
    notifications: bool(s.notifications, d.notifications),
    memoryMonitoring: bool(s.memoryMonitoring, d.memoryMonitoring),
    historyRetentionDays:
      typeof retention === 'number' &&
      Number.isInteger(retention) &&
      retention >= 1 &&
      retention <= 365
        ? retention
        : d.historyRetentionDays,
    theme: oneOf(s.theme, ['system', 'light', 'dark'] as const, d.theme),
    incognito: oneOf(s.incognito, ['protect', 'allow'] as const, d.incognito),
  };
}

export type SettingsPatchResult = { ok: true; settings: Settings } | { ok: false; error: string };

/** Apply a user patch with strict validation (unlike sanitize, invalid input is rejected, not defaulted). */
export function applySettingsPatch(
  current: Settings,
  patch: Partial<Settings>,
): SettingsPatchResult {
  if ('thresholdMinutes' in patch) {
    const v = validateThreshold(patch.thresholdMinutes);
    if (!v.ok) return { ok: false, error: v.error };
  }
  if ('historyRetentionDays' in patch) {
    const r = patch.historyRetentionDays;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 365)
      return { ok: false, error: 'History retention must be 1–365 days' };
  }
  if ('whitelist' in patch) {
    if (!Array.isArray(patch.whitelist)) return { ok: false, error: 'Invalid website list' };
    for (const item of patch.whitelist) {
      const res = parseRule(String(item));
      if (!res.ok) return { ok: false, error: res.error };
    }
  }
  return { ok: true, settings: sanitizeSettings({ ...current, ...patch }) };
}
