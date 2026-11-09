import { evaluateEligibility } from '../../src/lib/core/eligibility';
import { DEFAULT_SETTINGS } from '../../src/lib/core/settings';
import {
  assertTransition,
  canTransition,
  deriveState,
  InvalidTransitionError,
  PENDING_OP_TIMEOUT_MS,
} from '../../src/lib/core/state-machine';
import type { TabRecord } from '../../src/lib/core/types';
import { MIN, tab } from './helpers';

const now = 2_000_000_000_000;
const rec = (o: Partial<TabRecord> = {}): TabRecord => ({
  tabId: 1,
  windowId: 1,
  url: '',
  firstSeenAt: 0,
  lastActiveAt: now - 60 * MIN,
  ...o,
});
const derive = (t: ReturnType<typeof tab> | undefined, r?: TabRecord) =>
  deriveState(t, r, t ? evaluateEligibility(t, r, DEFAULT_SETTINGS, now) : undefined, now);

describe('state machine', () => {
  it('covers the main lifecycle path', () => {
    const path = [
      'ACTIVE',
      'INACTIVE',
      'ELIGIBLE',
      'SUSPENDING',
      'SUSPENDED',
      'RESTORING',
      'ACTIVE',
    ] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it('rejects impossible transitions', () => {
    expect(canTransition('ACTIVE', 'SUSPENDING')).toBe(false);
    expect(canTransition('CLOSED', 'ACTIVE')).toBe(false);
    expect(canTransition('SUSPENDED', 'SUSPENDING')).toBe(false);
    expect(() => assertTransition('ACTIVE', 'SUSPENDING')).toThrow(InvalidTransitionError);
  });

  it('derives states with the browser as the source of truth', () => {
    expect(derive(undefined)).toBe('CLOSED');
    expect(derive(tab({ id: 1, active: true }), rec())).toBe('ACTIVE');
    expect(derive(tab({ id: 1, discarded: true }), rec())).toBe('SUSPENDED');
    expect(derive(tab({ id: 1 }), rec())).toBe('ELIGIBLE');
    expect(derive(tab({ id: 1 }), rec({ lastActiveAt: now }))).toBe('INACTIVE');
    expect(derive(tab({ id: 1, pinned: true }), rec())).toBe('PROTECTED');
  });

  it('pending ops show SUSPENDING/RESTORING only while consistent and fresh', () => {
    const p = rec({ pendingOp: { kind: 'suspend', startedAt: now - 1000 } });
    expect(derive(tab({ id: 1 }), p)).toBe('SUSPENDING');
    // Browser already reports discarded → authoritative.
    expect(derive(tab({ id: 1, discarded: true }), p)).toBe('SUSPENDED');
    // Interrupted operation (stale) no longer shows as in progress.
    const stale = rec({
      pendingOp: { kind: 'suspend', startedAt: now - PENDING_OP_TIMEOUT_MS - 1 },
    });
    expect(derive(tab({ id: 1 }), stale)).toBe('ELIGIBLE');
    expect(
      derive(
        tab({ id: 1, discarded: true }),
        rec({ pendingOp: { kind: 'restore', startedAt: now } }),
      ),
    ).toBe('RESTORING');
  });

  it('errors are shown until the tab is used again', () => {
    expect(derive(tab({ id: 1 }), rec({ lastError: { message: 'x', at: now - MIN } }))).toBe(
      'ERROR',
    );
    expect(
      derive(
        tab({ id: 1 }),
        rec({ lastActiveAt: now, lastError: { message: 'x', at: now - MIN } }),
      ),
    ).toBe('INACTIVE');
  });
});
