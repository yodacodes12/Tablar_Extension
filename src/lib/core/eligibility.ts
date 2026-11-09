import { isInternalUrl, matchWhitelist } from './domain';
import { inactiveMs, thresholdMs } from './inactivity';
import type {
  AutoOnlyBlocker,
  Blocker,
  HardBlocker,
  Settings,
  SoftBlocker,
  TabRecord,
  TabSnapshot,
} from './types';

const HARD: ReadonlySet<Blocker> = new Set<HardBlocker>([
  'active',
  'internal-page',
  'already-discarded',
]);
const SOFT: ReadonlySet<Blocker> = new Set<SoftBlocker>([
  'pinned',
  'audible',
  'media-capture',
  'whitelisted',
  'incognito',
  'not-auto-discardable',
]);
const AUTO_ONLY: ReadonlySet<Blocker> = new Set<AutoOnlyBlocker>([
  'recently-used',
  'loading',
  'auto-disabled',
]);

export const isHardBlocker = (b: Blocker): b is HardBlocker => HARD.has(b);
export const isSoftBlocker = (b: Blocker): b is SoftBlocker => SOFT.has(b);
export const isAutoOnlyBlocker = (b: Blocker): b is AutoOnlyBlocker => AUTO_ONLY.has(b);

export interface Eligibility {
  /** Would the scheduler suspend this tab right now? */
  autoEligible: boolean;
  /** Can the user suspend it manually without overriding a protection? */
  manualAllowed: boolean;
  /** Can the user suspend it manually after explicitly confirming an override? */
  manualForceAllowed: boolean;
  blockers: Blocker[];
  /** Protections that make the tab "PROTECTED" (hard + soft, excluding active/discarded which have own states). */
  protections: Blocker[];
  whitelistRule: string | null;
  inactiveMs: number;
}

export function evaluateEligibility(
  tab: TabSnapshot,
  record: TabRecord | undefined,
  settings: Settings,
  now: number,
): Eligibility {
  const blockers: Blocker[] = [];
  if (tab.active) blockers.push('active');
  if (tab.discarded) blockers.push('already-discarded');
  if (isInternalUrl(tab.url)) blockers.push('internal-page');

  if (settings.protectPinned && tab.pinned) blockers.push('pinned');
  if (settings.protectAudible && tab.audible) blockers.push('audible');
  if (settings.protectMediaCapture && tab.mediaCapture) blockers.push('media-capture');
  const whitelistRule = matchWhitelist(tab.url, settings.whitelist);
  if (whitelistRule) blockers.push('whitelisted');
  if (tab.incognito && settings.incognito === 'protect') blockers.push('incognito');
  if (tab.autoDiscardable === false) blockers.push('not-auto-discardable');

  const idle = inactiveMs(tab, record, now);
  if (!settings.autoSuspend) blockers.push('auto-disabled');
  if (tab.status === 'loading') blockers.push('loading');
  if (!tab.active && idle < thresholdMs(settings.thresholdMinutes)) blockers.push('recently-used');

  const hasHard = blockers.some(isHardBlocker);
  const hasSoft = blockers.some(isSoftBlocker);
  return {
    autoEligible: blockers.length === 0,
    manualAllowed: !hasHard && !hasSoft,
    manualForceAllowed: !hasHard,
    blockers,
    protections: blockers.filter((b) => b === 'internal-page' || isSoftBlocker(b)),
    whitelistRule,
    inactiveMs: idle,
  };
}

export const BLOCKER_LABELS: Record<Blocker, string> = {
  active: 'Active tab',
  'internal-page': 'Browser page',
  'already-discarded': 'Already suspended',
  pinned: 'Pinned',
  audible: 'Playing audio',
  'media-capture': 'Using camera, mic or screen',
  whitelisted: 'Protected website',
  incognito: 'Private window',
  'not-auto-discardable': 'Discarding disabled for this tab',
  'recently-used': 'Recently used',
  loading: 'Still loading',
  'auto-disabled': 'Automatic suspension off',
};
