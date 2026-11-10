# Store listing kit

Copy-paste material for the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO).
Screenshots are in `store/screenshots/` (regenerate with `npm run store:screenshots`).

| Asset | File | Used by |
|---|---|---|
| Store icon 128×128 | `public/icon/128.png` | Chrome, Edge (Edge wants 300×300 if possible; 128 is accepted) |
| Screenshots 1280×800 | `store/screenshots/1-…6-*.png` | All three |
| Small promo tile 440×280 | `store/screenshots/promo-small-440x280.png` | Chrome, Edge |

**Privacy policy URL:** https://github.com/yodacodes12/Tablar_Extension/blob/main/PRIVACY.md
**Homepage / support URL:** https://github.com/yodacodes12/Tablar_Extension
**Category:** Productivity (Chrome: *Workflow & Planning* / *Tools*; Edge: *Productivity*; AMO: *Tabs*)
**Language:** English

---

## Name

Tablar

## Short description (≤ 132 chars)

Suspends inactive tabs with the browser's native discard to free memory. Local-only, no tracking, no account.

## Full description

Tablar frees up memory by suspending tabs you haven't used for a while — using the browser's own built-in tab discard, the same mechanism behind Chrome's Memory Saver. Suspended tabs stay in your tab bar with their title and position, and reload when you click them.

**Suspend on your terms**
• Automatic suspension after 30 minutes of inactivity (presets from 5 to 60 minutes, or any custom value up to 24 hours)
• Suspend a single tab, all idle tabs, or everything except the tab you're on — in one click
• Restore one tab or all of them at once

**Never suspends what matters**
• The tab you're looking at is never touched
• Pinned tabs, tabs playing audio, and tabs using your camera, microphone or screen (Firefox) are protected
• Protect whole websites — "example.com" covers its subdomains, but never "fakeexample.com"
• Browser pages and private windows are left alone

**Honest memory information**
No browser lets extensions measure a single tab's memory. Tablar never invents numbers: it shows your computer's real memory usage (Chrome, Edge, Brave) and clearly labelled estimates.

**Private by design**
• No accounts, no servers, no analytics, no tracking
• Tablar makes no network requests at all
• Settings and history stay on your device

Also includes a full dashboard with search and filters, suspension history, light and dark themes, and keyboard-accessible controls. Open source.

---

## Chrome Web Store: Privacy practices tab

**Single purpose:**
Tablar suspends (discards) inactive browser tabs to reduce memory use, automatically after a configurable idle time or on demand.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `tabs` | Needed to read each tab's URL, title, pinned/audio state and last-active state to decide whether it may be suspended, and to call the native `tabs.discard()` and `tabs.reload()`. Tab data is only used locally and never transmitted. |
| `storage` | Stores the user's settings, the list of protected websites and the local suspension history on the device. |
| `alarms` | Runs the once-per-minute inactivity check that suspends tabs past the user's chosen idle time. |
| `system.memory` | Shows the computer's total and available memory on the Memory page so users can see the effect of suspending tabs. Read on demand only, never transmitted. |
| `notifications` (optional) | Only requested if the user turns on notifications in Settings. |

**Remote code:** No, I am not using remote code. All code is packaged with the extension.

**Data usage:** Tick nothing. Tablar does not collect or transmit any user data.
Certify all three statements (no selling data, no unrelated use, no creditworthiness use).

---

## Microsoft Edge Add-ons (Partner Center)

Use the same description, screenshots and privacy policy URL. Upload `tablar-1.0.0-edge.zip`.
**Notes for certification:** "Tablar uses chrome.tabs.discard to suspend inactive tabs. No network access, no data collection. To test: open several tabs, open the Tablar toolbar popup, click 'Suspend all others'. Automatic suspension defaults to 30 minutes of inactivity and can be set to 5 minutes in Settings for quicker testing."

---

## Firefox Add-ons (AMO)

Upload `tablar-1.0.0-firefox.zip`. AMO will ask for source code because the package is bundled/minified: upload `tablar-1.0.0-sources.zip`.

**Notes to reviewer:**

```
Build environment: Linux/macOS/Windows, Node.js 22 (tested 22.22), npm 9+.

Steps to reproduce the exact package:
  npm ci
  npm run build:firefox
Output: .output/firefox-mv3/ (identical to the uploaded package contents).

The package is built with WXT (Vite). No remote code, no network requests, no data collection
(data_collection_permissions: none). Tabs are suspended with the native tabs.discard() API.
To test quickly: Settings → inactivity threshold → 5 minutes, or use the popup's
"Suspend all others" button.
```

**License:** choose the license you want before submitting (the repo has none yet).

---

## Brave

Brave has no separate store: Brave users install from the Chrome Web Store. The `brave` zip is identical in function to the Chrome one.

## Opera (optional)

Opera add-ons (addons.opera.com) accepts the Chrome package. Not tested on Opera.
