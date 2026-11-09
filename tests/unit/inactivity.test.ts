import { inactiveMs, lastUsedAt, validateThreshold } from '../../src/lib/core/inactivity';
import type { TabRecord } from '../../src/lib/core/types';
import { MIN, tab } from './helpers';

const rec = (lastActiveAt: number): TabRecord => ({
  tabId: 1,
  windowId: 1,
  url: 'https://a.com',
  firstSeenAt: 0,
  lastActiveAt,
});

describe('inactivity', () => {
  const t0 = Date.UTC(2026, 0, 1, 10, 0);

  it('follows the spec example: left at 10:05, eligible at ~10:35 with a 30 min threshold', () => {
    const left = t0 + 5 * MIN;
    const t = tab({ id: 1 });
    expect(inactiveMs(t, rec(left), t0 + 34 * MIN)).toBe(29 * MIN);
    expect(inactiveMs(t, rec(left), t0 + 35 * MIN)).toBe(30 * MIN);
  });

  it('active tabs are never inactive', () => {
    expect(inactiveMs(tab({ id: 1, active: true }), rec(t0), t0 + 999 * MIN)).toBe(0);
  });

  it("prefers Tablar's record; falls back to the browser's lastAccessed", () => {
    const t = tab({ id: 1, lastAccessed: t0 + 10 * MIN });
    expect(lastUsedAt(t, rec(t0))).toBe(t0);
    expect(lastUsedAt(t, undefined)).toBe(t0 + 10 * MIN);
    expect(inactiveMs(t, undefined, t0 + 15 * MIN)).toBe(5 * MIN);
  });

  it('is based on timestamps, so a late/delayed evaluation still computes the true idle time', () => {
    expect(inactiveMs(tab({ id: 1 }), rec(t0), t0 + 3 * 60 * MIN)).toBe(180 * MIN);
  });

  it('never returns negative values on clock skew', () => {
    expect(inactiveMs(tab({ id: 1 }), rec(t0 + MIN), t0)).toBe(0);
  });

  it('unknown history counts as just used', () => {
    expect(inactiveMs(tab({ id: 1 }), undefined, t0)).toBe(0);
  });
});

describe('validateThreshold', () => {
  it.each([5, 10, 15, 30, 45, 60, 1, 1440, '25'])('accepts %j', (v) =>
    expect(validateThreshold(v).ok).toBe(true),
  );
  it.each([0, -5, 1441, 2.5, 'abc', '', null, undefined, NaN, Infinity])('rejects %j', (v) =>
    expect(validateThreshold(v).ok).toBe(false),
  );
});
