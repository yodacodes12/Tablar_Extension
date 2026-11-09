# Developing Tablar

## Setup

```bash
node -v   # 22+
npm install                    # also runs `wxt prepare` (generates .wxt types)
npx playwright install chromium   # for E2E
```

Firefox E2E (optional):

```bash
python3 -m venv .venv-e2e && .venv-e2e/bin/pip install selenium
# needs Firefox + geckodriver (snap installs are detected automatically;
# otherwise set FIREFOX_BIN and GECKODRIVER)
```

## Commands

```bash
npm run dev              # Chrome with hot reload
npm run dev:firefox      # Firefox with hot reload
npm run build            # all four production packages → .output/
npm run zip              # store zips
npm test                 # Vitest unit tests
npm run test:e2e         # Playwright: real Chromium with the extension loaded
npm run test:e2e:firefox # Selenium: real Firefox with the extension installed
npm run compile          # tsc --noEmit
npm run lint             # ESLint
npm run lint:firefox     # web-ext lint on the Firefox package
npm run check            # everything except E2E
node scripts/render-icons.mjs  # regenerate PNG icons from src/assets/logo.svg
```

## Build flags

| Env var | Effect |
|---|---|
| `TABLAR_E2E=1` | Test build into `.output-e2e/`: enables `debug:*` messages, the local test-page bridge and its host permission, and opens the dashboard on install. **Never ship it.** |
| `TABLAR_PROCESSES=1` | Adds the `processes` permission for Chromium Dev channel memory measurements. Stable Chrome rejects the permission with a warning. |

## Project layout

```
src/
  entrypoints/        background.ts, popup/, dashboard/, options/, e2e-bridge.content.ts (test-only)
  lib/core/           pure logic: domain, inactivity, eligibility, state-machine, settings, schema, reconcile, history
  lib/background/     engine (workflows), store (storage cache), router (messages), mutex, notify
  lib/browser/        tabs adapter (TabsPort)
  lib/memory/         memory providers + service
  lib/ui/             client, hooks, formatting, navigation
  components/         React components and dashboard sections
tests/
  unit/               Vitest (FakeTabs + MemoryStorage helpers)
  e2e/                Playwright (Chromium)
  e2e-firefox/        Selenium (Firefox)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## Testing approach

- Core logic is pure and unit-tested directly. `Engine` is tested against `FakeTabs`, which models Chromium-style ID replacement, declined discards and races.
- E2E tests drive the **real** extension in real browsers. Because waiting 30 minutes is impractical, E2E builds expose `debug:setLastActive` (back-date one tab's last use) and `debug:evaluate` (run the scheduler now). Everything else, including the native discard, is the production code path.
- The release package has its own smoke test (`tests/e2e/release.spec.ts`), which confirms the hooks are disabled.

## Contribution guidelines

- Keep TypeScript strict and browser-specific code inside `lib/browser` / `lib/memory` / `wxt.config.ts`.
- New persisted fields: bump `SCHEMA_VERSION`, add a migration in `core/schema.ts`, and extend `parsePersistedState`'s validation. Add tests for both.
- Never display a memory number without its `source` and `scope`. Estimates never carry bytes.
- Every UI control must call a real background operation, and the UI must show the browser-verified result.
- No network calls, telemetry or new permissions without updating PRIVACY.md.
- Run `npm run check && npm run test:e2e` before opening a PR.
