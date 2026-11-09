# Browser compatibility

One shared codebase. Browser differences are isolated in `src/lib/browser/tabs.ts` (tab normalisation and discard verification), `src/lib/memory/*` (runtime capability detection) and `wxt.config.ts` (manifest per target).

## Build targets

| Target | Command | Output | Manifest |
|---|---|---|---|
| Chrome | `npm run build:chrome` | `.output/chrome-mv3` | MV3, `background.service_worker` |
| Edge | `npm run build:edge` | `.output/edge-mv3` | identical to Chrome |
| Brave | `npm run build:brave` | `.output/brave-mv3` | identical to Chrome |
| Firefox 140+ | `npm run build:firefox` | `.output/firefox-mv3` | MV3, `background.scripts` (event page), `browser_specific_settings.gecko` (id, `strict_min_version: 140.0`, `data_collection_permissions: none`) |
| Chromium Dev channel (optional) | `TABLAR_PROCESSES=1 npm run build:chrome` | `.output/chrome-mv3` | adds the `processes` permission |

## API support

| Capability | Chrome / Brave / Edge | Firefox |
|---|---|---|
| Native discard `tabs.discard` | ✅ Resolves with the discarded `Tab`. **The tab gets a new ID** (observed in Chromium 158), and Tablar follows it. Refuses the active tab. | ✅ Resolves with nothing, **even when it declines** (active tab, `beforeunload` prompt), so Tablar always verifies `discarded`. Tab ID unchanged. |
| `tab.discarded` | ✅ | ✅ |
| `tab.lastAccessed` | ✅ 121+ (bumped on session restore, so only used as a fallback) | ✅ |
| `tab.autoDiscardable` | ✅ (respected: `false` means protected from automatic suspension) | ✅ |
| `tab.audible` | ✅ | ✅ |
| Camera / mic / screen capture | ❌ not exposed to extensions | ✅ `tab.sharingState` |
| `tabs.onReplaced` | ✅ handled | n/a |
| Alarms (1 min period) | ✅ | ✅ |
| `storage.local` | ✅ | ✅ |
| Background lifecycle | Service worker; killed when idle; state rebuilt from storage on every start | Event page; suspended when idle; same code path |
| Session restore | Worker starts **before** tabs are restored. Tablar keeps unmatched records as orphans and restored tabs adopt them by URL. | Same mechanism |

## Memory measurement availability

| Source | Chrome / Brave / Edge stable | Chromium Dev channel | Firefox |
|---|---|---|---|
| True per-tab memory | ❌ | ❌ | ❌ |
| Renderer-process memory (`chrome.processes`) | ❌ (Dev channel only) | ✅ opt-in build; shown as **process** scope with "shared by N tabs" | ❌ |
| System RAM (`chrome.system.memory`) | ✅ shown as **whole computer**, not per tab | ✅ | ❌ |
| Qualitative estimate | ✅ Low for unloaded tabs, otherwise Unknown | ✅ | ✅ |

Brave and Edge are Chromium-based and expose the same extension APIs. Whether Brave or Edge ship `chrome.processes` on any channel has not been verified. Tablar detects it at runtime either way.

## Test results (2026-11-09, this machine)

### Chromium: Playwright, Chromium 158.0.8127 (Playwright build 1254), headless, real extension loaded

`npm run test:e2e` gave **10/10 passed**:

- Tab discovery across two windows and states
- Automatic suspension of only eligible tabs (pinned, recently used and whitelisted tabs kept); URL preserved; new tab ID followed
- Active tab never discarded, even with force
- Manual single, protected-tab override, bulk and restore-all; history restore times
- Activating a suspended tab reloads it and closes its history entry
- Settings persisted; invalid values rejected
- Memory: no per-tab or process data on stable, system memory available, no fabricated bytes
- Popup and dashboard UI: suspend/restore from the popup, add a protected site, theme switch
- **Real browser restart** with session restore: new tab IDs, inactivity timestamps preserved, alarm recreated, suspension proceeds
- Release package smoke test: loads with no console errors, test hooks disabled, no host permissions or content scripts

### Firefox: Selenium + geckodriver, Firefox 159.0.1 (snap), headless, temporary add-on

`npm run test:e2e:firefox` gave **21/21 passed**: background start, 30-min default, tab discovery, automatic suspension of only the eligible tab (native discard, same tab ID, URL preserved), pinned and recently-used tabs untouched, active tab refused even when forced, protected override, bulk suspend, restore all, history methods and restore times, no memory APIs detected with no byte values, settings persisted, alarm registered, dashboard page loads.

Firefox's WebDriver cannot script or screenshot extension pages, so the Firefox suite drives Tablar from a local test page through an E2E-only content script (`src/entrypoints/e2e-bridge.content.ts`, removed from release builds). **The Firefox popup and dashboard UI have not been visually checked by automation.** See the manual procedure below.

`web-ext lint` on `.output/firefox-mv3`: **0 errors**, 3 warnings:
- `data_collection_permissions` needs Firefox **for Android** 142 (desktop minimum is 140; Android is not a target).
- 2× `innerHTML` inside React DOM's internals (no dynamic HTML in Tablar code).

### Brave and Edge

**Not run.** Neither browser is installed on the development machine. The packages are byte-for-byte the same build as Chrome apart from the target name. Run the manual procedure below before publishing to those stores.

## Manual test procedure (Brave, Edge, Firefox UI)

1. Load the package (see README).
2. Open 5+ normal tabs, pin one, play audio in one, and add one site under *Protected websites*.
3. In Settings, choose **Custom → 1 minute**. Wait about 2 minutes without touching those tabs.
4. Expected: only the unprotected, unpinned, silent, non-active tabs show "Suspended" in the popup, the tab strip shows them as unloaded, and clicking one reloads it.
5. Popup: suspend a tab manually, use "Suspend idle", "Suspend all others" and "Restore all". Try suspending the pinned tab and confirm the warning dialog appears.
6. Dashboard: check every section loads. History lists the events with methods and restore times. Memory insights shows "System memory" on Chromium and only estimates on Firefox.
7. Restart the browser with "continue where you left off". Tabs that were idle before the restart should keep their idle time (the dashboard's "Next to be suspended" list).
8. Switch the theme to Dark and Light.
