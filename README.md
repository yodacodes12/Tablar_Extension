# Tablar

Tablar is a privacy-first browser extension that suspends inactive tabs using the browser's **native tab discard**. Suspended tabs stay in your tab bar with their URL and position. They reload normally when you open them.

## Features

- **Automatic suspension** after a configurable inactivity time (default **30 min**; presets 5/10/15/30/45/60, or custom 1–1440 min). Checked every minute with browser alarms.
- **Manual control:** suspend or restore one tab, multi-select, "suspend idle tabs", "suspend all except active", "restore all".
- **Protection engine:** the active tab is always protected, and browser pages are never touched. Pinned tabs, tabs playing audio, tabs using camera/mic/screen (Firefox) and private-window tabs are protected by default and configurable. Protected websites use proper domain matching (`example.com` covers its subdomains but never `fakeexample.com`). A protected tab can be suspended manually only after an explicit confirmation.
- **Honest memory insights:** real numbers only where the browser provides them, always labelled with their scope (system / process). Otherwise you get labelled estimates or "Unknown". No invented per-tab MB figures.
- **History** of suspensions and restorations with filtering, configurable retention and clearing.
- **Popup, full dashboard and settings**, with light, dark and system themes.
- **Private by design:** no network requests, no telemetry, no account. Everything is stored locally. See [PRIVACY.md](PRIVACY.md).

## Supported browsers

| Browser | Package | Validation status |
|---|---|---|
| Google Chrome | `chrome-mv3` | Automated real-browser E2E (Playwright Chromium 158) |
| Brave | `brave-mv3` | Same Chromium package; not yet run in Brave itself |
| Microsoft Edge | `edge-mv3` | Same Chromium package; not yet run in Edge itself |
| Mozilla Firefox (140+) | `firefox-mv3` | Automated real-browser E2E (Firefox 159, Selenium) + `web-ext lint` |

Details and test results: [BROWSER_COMPATIBILITY.md](BROWSER_COMPATIBILITY.md).

## Technology

WXT 0.21 · TypeScript (strict) · React 19 · Tailwind CSS 4 · Vitest · Playwright · Selenium (Firefox) · ESLint · Prettier. Manifest V3 everywhere: a service worker on Chromium, an event page on Firefox.

## Install from source

```bash
npm install
npm run build          # builds .output/{chrome,edge,brave,firefox}-mv3
```

- **Chrome / Brave / Edge:** open `chrome://extensions` (or `brave://extensions`, `edge://extensions`), enable *Developer mode*, choose *Load unpacked*, and select `.output/chrome-mv3` (or `brave-mv3` / `edge-mv3`).
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on…*, and pick `.output/firefox-mv3/manifest.json`. For a permanent install, the package must be signed by Mozilla (`npm run zip` produces the upload).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:firefox` | Dev build with hot reload, launches a browser |
| `npm run build` | Production builds for all four targets |
| `npm run build:chrome` / `:edge` / `:brave` / `:firefox` | Single target |
| `npm run zip` | Store-ready zip files in `.output/` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Real-Chromium E2E tests (Playwright) |
| `npm run test:e2e:firefox` | Real-Firefox E2E tests (needs `.venv-e2e`, see DEVELOPMENT.md) |
| `npm run lint` / `npm run compile` / `npm run lint:firefox` | ESLint / TypeScript / `web-ext lint` |
| `npm run check` | Type-check, lint, unit tests, all builds, Firefox lint |

## Known limitations

- **No per-tab RAM anywhere.** No stable browser lets extensions measure an individual tab's memory. `chrome.processes` (renderer-process memory) exists only on the Chromium **Dev channel**. Tablar supports it through an opt-in build (`TABLAR_PROCESSES=1`), but stable Chrome, Brave and Edge show system memory plus estimates. Firefox has no memory API at all.
- **Camera/microphone/screen-share detection** exists only on Firefox (`tab.sharingState`). On Chromium, tabs in a call are usually protected because they are playing audio.
- **Unsaved form data cannot be detected.** Tablar does not read page content. Firefox refuses to discard pages with a "leave page?" prompt, and Tablar reports that as a failure.
- **The browser can refuse a discard.** Tablar verifies the result and never reports success unless the tab is actually discarded.
- **Chromium gives a discarded tab a new tab ID.** Tablar follows the change. Firefox keeps the ID.
- **Sleep:** time spent asleep counts as inactivity (it is real elapsed time). After waking, tabs past the threshold are suspended on the next check, and the active tab is never touched.
- Automatic suspension happens on the next one-minute check after a tab crosses the threshold, not at the exact second.

## License

[MIT](LICENSE) © 2026 yodacodes12
