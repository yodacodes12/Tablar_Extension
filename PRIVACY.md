# Tablar privacy

Tablar works entirely on your device. It has no server, no account, no analytics and no telemetry, and it makes **no network requests**.

## Information stored locally (`browser.storage.local`)

| Data | Why | Kept until |
|---|---|---|
| Settings and protected-website list | Your preferences | You change them or uninstall |
| Per open tab: tab ID, window ID, URL, first-seen time, last-used time | To measure inactivity and survive browser restarts | The tab closes (records of tabs not restored after a restart are deleted within 10 min) |
| Suspension history: tab title, URL, domain, suspend/restore time, method, reason, result | The History view | Your retention period (default 7 days), at most 1000 events, or "Clear history" |

Tabs in **private windows** are never written to history. Tablar only sees them at all if you allow the extension in private windows.

Nothing else is collected. Tablar does not read page content, cookies, browsing history, downloads or network traffic.

## Permissions

| Permission | Browsers | Purpose |
|---|---|---|
| `tabs` | all | Read tab titles/URLs/state, discard and reload tabs |
| `storage` | all | Store the data above locally |
| `alarms` | all | The once-a-minute inactivity check |
| `system.memory` | Chromium | Total and available RAM of the computer (whole-system figure) |
| `notifications` (optional) | all | Requested only if you turn on "Notify when tabs are auto-suspended" |

Tablar requests **no host permissions**, injects **no content scripts**, and does not use `history`, `cookies`, `downloads` or `webRequest`. On Firefox the manifest declares `data_collection_permissions: none`.

## Data transmission

None. URLs, titles and usage never leave the browser. Uninstalling the extension removes all of its stored data.
