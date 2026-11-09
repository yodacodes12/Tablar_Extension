import { reconcileRecords } from '../../src/lib/core/reconcile';
import type { TabRecord } from '../../src/lib/core/types';
import { MIN, tab } from './helpers';

const now = 1_900_000_000_000;
const r = (tabId: number, url: string, lastActiveAt: number): TabRecord => ({
  tabId,
  windowId: 1,
  url,
  firstSeenAt: 1,
  lastActiveAt,
});

describe('startup reconciliation', () => {
  it('keeps records whose id and url still match (worker restart)', () => {
    const out = reconcileRecords(
      [tab({ id: 5, url: 'https://a.com/' })],
      { '5': r(5, 'https://a.com/', now - 40 * MIN) },
      now,
    );
    expect(out['5']!.lastActiveAt).toBe(now - 40 * MIN);
  });

  it('re-associates by URL when ids changed after a browser restart (does not reset timestamps)', () => {
    const stored = {
      '1': r(1, 'https://a.com/', now - 90 * MIN),
      '2': r(2, 'https://b.com/', now - 10 * MIN),
    };
    const out = reconcileRecords(
      [tab({ id: 101, url: 'https://b.com/' }), tab({ id: 102, url: 'https://a.com/' })],
      stored,
      now,
    );
    expect(out['102']!.lastActiveAt).toBe(now - 90 * MIN);
    expect(out['101']!.lastActiveAt).toBe(now - 10 * MIN);
    expect(out['1']).toBeUndefined();
  });

  it('handles duplicate URLs one-to-one, most recent first', () => {
    const stored = {
      '1': r(1, 'https://x.com/', now - 50 * MIN),
      '2': r(2, 'https://x.com/', now - 5 * MIN),
    };
    const out = reconcileRecords(
      [tab({ id: 10, url: 'https://x.com/' }), tab({ id: 11, url: 'https://x.com/' })],
      stored,
      now,
    );
    expect([out['10']!.lastActiveAt, out['11']!.lastActiveAt]).toEqual([
      now - 5 * MIN,
      now - 50 * MIN,
    ]);
  });

  it('new tabs use the browser lastAccessed if sane, otherwise now', () => {
    const out = reconcileRecords(
      [
        tab({ id: 1, lastAccessed: now - 20 * MIN }),
        tab({ id: 2, lastAccessed: now + 99 * MIN }),
        tab({ id: 3 }),
      ],
      {},
      now,
    );
    expect(out['1']!.lastActiveAt).toBe(now - 20 * MIN);
    expect(out['2']!.lastActiveAt).toBe(now);
    expect(out['3']!.lastActiveAt).toBe(now);
  });

  it('active tabs are stamped now; records for closed tabs are dropped', () => {
    const out = reconcileRecords(
      [tab({ id: 1, active: true })],
      { '1': r(1, 'https://site1.example/page', now - 99 * MIN), '9': r(9, 'https://gone.com', 0) },
      now,
    );
    expect(out['1']!.lastActiveAt).toBe(now);
    expect(Object.keys(out)).toEqual(['1']);
  });
});

describe('session restore quirks', () => {
  it("ignores lastAccessed bumped by the browser's session restore when a record exists", () => {
    const out = reconcileRecords(
      [tab({ id: 7, url: 'https://a.com/', lastAccessed: now - 1000 })],
      { '3': r(3, 'https://a.com/', now - 50 * MIN) },
      now,
    );
    expect(out['7']!.lastActiveAt).toBe(now - 50 * MIN);
  });
});
