# Tablar architecture

## Overview

```
┌───────────── extension pages (React) ─────────────┐        ┌──────────── background ─────────────┐
│ popup.html      dashboard.html      options.html  │        │ entrypoints/background.ts           │
│        │ components/* (TabList, panels, actions)  │ runtime│   ├─ router.ts   (typed messages)   │
│        └─ lib/ui/client.ts  call({type…}) ────────┼───────▶│   ├─ engine.ts   (all state changes)│
│        ◀── "tablar:changed" broadcast ────────────┼────────│   ├─ store.ts    (storage cache)    │
└───────────────────────────────────────────────────┘ msgs   │   └─ memory/service.ts (on demand)  │
                                                              └───────────┬─────────────────────────┘
                                                                          │ TabsPort (lib/browser/tabs.ts)
                                                     browser.tabs / alarms / storage / system.memory
```

Pure, browser-independent logic lives in `src/lib/core` and is unit-tested directly. Browser APIs are only touched in `lib/browser`, `lib/memory/*` detection helpers, `lib/background/notify.ts` and `entrypoints/background.ts`.

## Modules

| Module | Responsibility |
|---|---|
| `core/types.ts` | Shared types: `TabSnapshot`, `TabRecord`, `Settings`, `HistoryEntry`, states and blockers. |
| `core/domain.ts` | Whitelist rule parsing and label-based host matching (`example.com` ≠ `fakeexample.com`), internal-URL detection. |
| `core/inactivity.ts` | Threshold validation and timestamp-based idle time. |
| `core/eligibility.ts` | **Central eligibility engine.** Produces blockers (hard / soft / auto-only) plus `autoEligible`, `manualAllowed`, `manualForceAllowed`. |
| `core/state-machine.ts` | Tab states, allowed transitions, `deriveState()` (browser state is authoritative). |
| `core/settings.ts` | Defaults, field-by-field sanitisation of stored data, strict validation of user patches. |
| `core/schema.ts` | Storage keys, schema version, ordered migrations, tolerant parsing of persisted data. |
| `core/reconcile.ts` | Startup reconciliation of stored records against live tabs; orphan records for session-restored tabs. |
| `core/history.ts` | Retention pruning, restore stamping, entry validation. |
| `browser/tabs.ts` | `TabsPort` adapter: normalises Chromium/Firefox tab objects, native discard **with verification**, reload, activate. |
| `background/engine.ts` | Event tracking, suspension and restoration workflows, scheduler run, settings/history, snapshots. All mutations run under one `Mutex`. |
| `background/store.ts` | In-memory cache of persisted state with coalesced write-through (≤ 200 ms) and explicit `flush()`. |
| `background/router.ts` | Validates and dispatches UI requests. Debug hooks only exist in E2E builds. |
| `memory/*` | Capability-based memory layer (see below). |
| `components/*`, `entrypoints/*` | React UI. Every control calls a real background operation. |

## Data flow

1. Browser events (`tabs.onCreated/Activated/Updated/Removed/Replaced/Attached`, `windows.onFocusChanged`, `alarms.onAlarm`) are registered synchronously at the top level of the background script so MV3 can wake the worker for them.
2. Each handler waits for initialisation (`ready`), then calls an `Engine` method. The engine updates `Store.state` and marks the changed part dirty. The store flushes to `storage.local`.
3. After every change the background broadcasts `tablar:changed`. Open UI pages re-fetch a `Snapshot`, which is computed from **live** `tabs.query()` plus stored records.

## Inactivity tracking

- `TabRecord.lastActiveAt` is the last moment a tab was in use. It is stamped when a tab is activated, when the user **leaves** it (the previous active tab of that window), when a window gains focus (active tabs of all windows), and on every scheduler heartbeat for active tabs.
- Idle time is `now − lastActiveAt`. It is never derived from alarm counts. Late or delayed alarms therefore still compute the true idle time.
- Every window's active tab is `ACTIVE` and can never be suspended, so switching windows never makes tabs look idle.
- Background-opened tabs start at their creation time.
- Tablar's record is authoritative. The browser's `lastAccessed` (Chrome 121+, Firefox) is used only for tabs without a record, because browsers bump it during session restore.

## Suspension workflow (`Engine.suspendOne`)

1. Read the live tab (`tabs.get`). If it is missing, report "closed".
2. Evaluate eligibility (automatic: `autoEligible`; manual: `manualAllowed`, or `manualForceAllowed` + explicit `force`).
3. Automatic runs back off for 10 min after a failure on the same tab.
4. `assertTransition(state, 'SUSPENDING')`, set `pendingOp`, flush to storage.
5. **Race guard:** re-read the tab and re-evaluate immediately before discarding.
6. `tabs.discard()`, the browser-native discard.
7. **Verify:** re-read the tab until `discarded === true` (Firefox resolves even when it silently declines). Follow a changed tab id (Chromium replaces the id of a discarded tab).
8. Clear `pendingOp`, move the record if the id changed, record a history entry (success or failure; repeated automatic failures are recorded once), flush, broadcast.

Restoration uses `tabs.reload()` and waits for `discarded === false`. Restoring a tab counts as using it, so it is not re-suspended on the next tick. If the user simply opens a suspended tab, `tabs.onUpdated({discarded:false})` stamps `restoredAt` in history.

## State machine

States: `ACTIVE, INACTIVE, ELIGIBLE, SUSPENDING, SUSPENDED, RESTORING, PROTECTED, ERROR, CLOSED`.

```
ACTIVE ⇄ INACTIVE → ELIGIBLE → SUSPENDING → SUSPENDED → RESTORING → ACTIVE/INACTIVE
   ↘ PROTECTED ↗            ↘ ERROR (failed op, cleared when the tab is used again)
any → CLOSED
```

`deriveState()` computes the state from the live tab first. `discarded`, `active` and "missing" always win over Tablar's own bookkeeping. A `pendingOp` older than 30 s is treated as interrupted. Initialisation also clears every pending op, which recovers from a worker killed mid-operation.

## Scheduler

- One alarm, `tablar:evaluate`, with a 1-minute period. `ensureAlarm()` runs on every background start, `onStartup` and `onInstalled`, and recreates the alarm if it is missing or wrong.
- `Engine.evaluate()` is idempotent: it ignores firings closer than 20 s together, holds the mutex, re-reads live tabs, drops records of tabs that disappeared, heartbeats active tabs, prunes history hourly, and re-checks every candidate before discarding.
- There is no `setInterval` in the background. UI pages tick every 30 s only while they are open, to refresh idle durations.

## Storage

`browser.storage.local` keys:

| Key | Content |
|---|---|
| `tablar:meta` | `{ schemaVersion }` |
| `tablar:settings` | `Settings` |
| `tablar:tabs` | `Record<tabId, TabRecord>` for open tabs only |
| `tablar:history` | `HistoryEntry[]` (newest first, max 1000, retention-pruned) |
| `tablar:orphans` | Records waiting up to 10 min to be adopted by session-restored tabs |

`migrate()` runs ordered migrations from the stored version up to `SCHEMA_VERSION`. `parsePersistedState()` validates every piece independently, so corrupt fields fall back to defaults instead of crashing. Future timestamps are clamped.

### Startup reconciliation

Tab IDs are not stable across browser restarts:

1. A stored record with the same id **and** URL is kept (service-worker restart).
2. Other live tabs claim stored records by URL, most recently used first.
3. Unclaimed records become *orphans*. Chromium starts the worker before it finishes restoring the session, so restored tabs arrive later through `onCreated` and `onUpdated(url)` and adopt the matching orphan's timestamps.

## Memory providers

```ts
interface MemoryMeasurement {
  valueBytes: number | null;          // only for source "actual"
  source: 'actual' | 'estimated' | 'unavailable';
  scope: 'tab' | 'process' | 'browser' | 'system' | 'unknown';
  confidence: 'high' | 'medium' | 'low' | 'none';
  measuredAt: number | null;
  level?: 'low' | 'moderate' | 'high' | 'unknown';   // estimates only
  sharedByTabs?: number; processId?: number;          // process scope
  basis: string;                                      // human explanation
}
```

- `ChromiumProcessesProvider`: `chrome.processes` (Dev channel only, opt-in build). Reports renderer-process private memory with `scope: "process"` and the number of tabs sharing it. The value is never divided or relabelled as per-tab.
- `EstimateProvider`: `Low` for discarded or unloaded tabs, `Unknown` otherwise. It never produces byte values.
- `system.memory`: whole-computer capacity and availability (Chromium), shown separately and labelled "not per tab".
- `MemoryService` picks providers at runtime and caches for 10 s. It runs only when a UI page asks.

## Background lifecycle

- **Chromium (MV3 service worker):** can be terminated at any time. All state is in storage, writes are flushed within 200 ms and before any operation reports success, and everything is rebuilt on start.
- **Firefox (MV3 event page, `background.scripts`):** same code path. Event pages are also suspended when idle.
