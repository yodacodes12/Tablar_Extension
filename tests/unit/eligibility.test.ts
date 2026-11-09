import { evaluateEligibility } from '../../src/lib/core/eligibility';
import { DEFAULT_SETTINGS } from '../../src/lib/core/settings';
import type { Settings, TabRecord } from '../../src/lib/core/types';
import { MIN, tab } from './helpers';

const now = 1_000_000_000_000;
const old: TabRecord = {
  tabId: 1,
  windowId: 1,
  url: '',
  firstSeenAt: 0,
  lastActiveAt: now - 60 * MIN,
};
const s = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe('eligibility engine (safety rules)', () => {
  it('a normal inactive page past the threshold is eligible', () => {
    const e = evaluateEligibility(tab({ id: 1 }), old, s(), now);
    expect(e.autoEligible).toBe(true);
    expect(e.blockers).toEqual([]);
  });

  it('1. active tabs are never eligible, not even with force', () => {
    const e = evaluateEligibility(tab({ id: 1, active: true }), old, s(), now);
    expect(e.autoEligible).toBe(false);
    expect(e.manualForceAllowed).toBe(false);
  });

  it('2. pinned tabs are protected by default, overridable manually', () => {
    const e = evaluateEligibility(tab({ id: 1, pinned: true }), old, s(), now);
    expect(e.autoEligible).toBe(false);
    expect(e.manualAllowed).toBe(false);
    expect(e.manualForceAllowed).toBe(true);
    expect(
      evaluateEligibility(tab({ id: 1, pinned: true }), old, s({ protectPinned: false }), now)
        .autoEligible,
    ).toBe(true);
  });

  it('3. audible tabs are protected by default', () => {
    expect(evaluateEligibility(tab({ id: 1, audible: true }), old, s(), now).blockers).toContain(
      'audible',
    );
    expect(
      evaluateEligibility(tab({ id: 1, audible: true }), old, s({ protectAudible: false }), now)
        .autoEligible,
    ).toBe(true);
  });

  it('4. whitelisted domains are protected (label-based matching)', () => {
    const e = evaluateEligibility(
      tab({ id: 1, url: 'https://docs.github.com/x' }),
      old,
      s({ whitelist: ['github.com'] }),
      now,
    );
    expect(e.blockers).toContain('whitelisted');
    expect(e.whitelistRule).toBe('github.com');
    expect(
      evaluateEligibility(
        tab({ id: 1, url: 'https://notgithub.com/' }),
        old,
        s({ whitelist: ['github.com'] }),
        now,
      ).autoEligible,
    ).toBe(true);
  });

  it('5. browser internal pages are protected and cannot be forced', () => {
    const e = evaluateEligibility(tab({ id: 1, url: 'chrome://settings' }), old, s(), now);
    expect(e.blockers).toContain('internal-page');
    expect(e.manualForceAllowed).toBe(false);
  });

  it('6. already discarded tabs are skipped', () => {
    const e = evaluateEligibility(tab({ id: 1, discarded: true }), old, s(), now);
    expect(e.autoEligible).toBe(false);
    expect(e.manualForceAllowed).toBe(false);
  });

  it('respects the threshold', () => {
    const fresh: TabRecord = { ...old, lastActiveAt: now - 29 * MIN };
    expect(evaluateEligibility(tab({ id: 1 }), fresh, s(), now).blockers).toEqual([
      'recently-used',
    ]);
    expect(
      evaluateEligibility(tab({ id: 1 }), fresh, s({ thresholdMinutes: 5 }), now).autoEligible,
    ).toBe(true);
  });

  it('recently-used / auto-disabled / loading never block manual suspension', () => {
    const fresh: TabRecord = { ...old, lastActiveAt: now };
    const e = evaluateEligibility(
      tab({ id: 1, status: 'loading' }),
      fresh,
      s({ autoSuspend: false }),
      now,
    );
    expect(e.autoEligible).toBe(false);
    expect(e.manualAllowed).toBe(true);
  });

  it('media capture (Firefox sharingState) and opt-out flags protect', () => {
    expect(
      evaluateEligibility(tab({ id: 1, mediaCapture: true }), old, s(), now).blockers,
    ).toContain('media-capture');
    expect(
      evaluateEligibility(tab({ id: 1, autoDiscardable: false }), old, s(), now).blockers,
    ).toContain('not-auto-discardable');
  });

  it('private-window tabs follow the incognito policy', () => {
    expect(evaluateEligibility(tab({ id: 1, incognito: true }), old, s(), now).autoEligible).toBe(
      false,
    );
    expect(
      evaluateEligibility(tab({ id: 1, incognito: true }), old, s({ incognito: 'allow' }), now)
        .autoEligible,
    ).toBe(true);
  });
});
