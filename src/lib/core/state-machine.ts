import type { Eligibility } from './eligibility';
import type { TabRecord, TabSnapshot, TabState } from './types';

/**
 * Allowed transitions. The browser's live state is authoritative, so derived states may
 * "jump" (e.g. the user closes a tab mid-operation); the table lists every transition the
 * engine is allowed to *initiate* or *observe*.
 */
const TRANSITIONS: Record<TabState, readonly TabState[]> = {
  ACTIVE: ['INACTIVE', 'ELIGIBLE', 'PROTECTED', 'SUSPENDED', 'CLOSED'],
  INACTIVE: ['ACTIVE', 'ELIGIBLE', 'PROTECTED', 'SUSPENDING', 'SUSPENDED', 'CLOSED'],
  ELIGIBLE: ['ACTIVE', 'INACTIVE', 'PROTECTED', 'SUSPENDING', 'SUSPENDED', 'CLOSED'],
  PROTECTED: ['ACTIVE', 'INACTIVE', 'ELIGIBLE', 'SUSPENDING', 'SUSPENDED', 'CLOSED'],
  SUSPENDING: ['SUSPENDED', 'ERROR', 'ACTIVE', 'INACTIVE', 'ELIGIBLE', 'PROTECTED', 'CLOSED'],
  SUSPENDED: ['RESTORING', 'ACTIVE', 'INACTIVE', 'PROTECTED', 'ELIGIBLE', 'CLOSED'],
  RESTORING: ['ACTIVE', 'INACTIVE', 'ELIGIBLE', 'PROTECTED', 'SUSPENDED', 'ERROR', 'CLOSED'],
  ERROR: [
    'ACTIVE',
    'INACTIVE',
    'ELIGIBLE',
    'PROTECTED',
    'SUSPENDING',
    'SUSPENDED',
    'RESTORING',
    'CLOSED',
  ],
  CLOSED: [],
};

export function canTransition(from: TabState, to: TabState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TabState,
    readonly to: TabState,
  ) {
    super(`Cannot move tab from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: TabState, to: TabState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** A pending operation older than this is treated as interrupted (e.g. the service worker was killed). */
export const PENDING_OP_TIMEOUT_MS = 30_000;

export function isPendingOpStale(record: TabRecord | undefined, now: number): boolean {
  return !!record?.pendingOp && now - record.pendingOp.startedAt > PENDING_OP_TIMEOUT_MS;
}

/** Derive the user-facing state from the live tab (authoritative) plus Tablar's record. */
export function deriveState(
  tab: TabSnapshot | undefined,
  record: TabRecord | undefined,
  eligibility: Eligibility | undefined,
  now: number,
): TabState {
  if (!tab) return 'CLOSED';
  if (record?.pendingOp && !isPendingOpStale(record, now)) {
    if (record.pendingOp.kind === 'suspend' && !tab.discarded && !tab.active) return 'SUSPENDING';
    if (record.pendingOp.kind === 'restore' && tab.discarded) return 'RESTORING';
  }
  if (tab.discarded) return 'SUSPENDED';
  if (tab.active) return 'ACTIVE';
  if (record?.lastError && record.lastError.at >= record.lastActiveAt) return 'ERROR';
  if (eligibility && eligibility.protections.length > 0) return 'PROTECTED';
  if (eligibility?.autoEligible) return 'ELIGIBLE';
  return 'INACTIVE';
}
