---
name: browser-verify
description: Prove a change works on the real screen — drive the app in a browser and record observed vs expected. Use for any change that renders, for "screenshot and verify", "test it in the browser", "does it work on iPhone", layout/i18n/print checks, console or network errors, slow pages, and before claiming a UI bug fixed. Covers DOM/a11y reading, click/type, screenshots, console and network capture, CPU/network throttling, device emulation, profiling, and isolated parallel instances per worktree.
---

# Browser verification

A green build is not a working screen. Anything that renders is done only when driven in a browser
with the observed value written next to the expected one.

## Pick the driver your harness has
1. **Harness browser tools** (Claude Browser pane, Cursor browser, Chrome DevTools MCP): best for interactive checks.
2. **Playwright** (`frontend/playwright.config.ts`, specs in `frontend/e2e/`): scripted, repeatable, runs in any harness and CI. Prefer it for anything you will need to check twice.
3. **Raw CDP** only when neither exposes what you need (heap snapshot, coverage).

## Targets
Named in `.claude/launch.json` (readable by any harness): `frontend` 5173 = live edits (proxies `/api` to the Worker on 8787), `worker-dev` 8787 = Worker + local D1 serving the last build, production URLs = read-only. Details and traps: `fleet-coordination/references/browser-verification.md`.

**Parallel isolated instances:** each worktree runs its own Vite on its own port (`npm run dev -- --port <5200+n> --strictPort`) and, when it needs its own data, its own `wrangler dev --port <8800+n> --persist-to .wrangler/state-<lane>`. Never point two lanes at one local D1 state dir. A preview started from a worktree must be checked to serve that worktree (compare a changed string or the emitted CSS), not the main checkout.

## The loop
1. State the expected result per check (text, number, element, layout at width).
2. Navigate; wait for the network to settle.
3. Read before looking: accessibility tree / page text for content and structure; screenshot for layout.
4. Act: click, type, select — as the real role (cashier vs admin) and in both languages.
5. Collect: console errors, failed requests (status + body), timings.
6. Compare observed vs expected; on mismatch → `debug-with-evidence`, fix, repeat from 2.
7. Evidence: screenshot or trace + the observed values in the report.

## Checks by need
| Need | How |
|---|---|
| Content/structure | a11y tree or `page.getByRole` |
| Layout | screenshots at 375×812 (iPhone), 768×1024, 1440×900; check no horizontal scroll |
| Slow network / device | Playwright `context.route` delay or CDP `Network.emulateNetworkConditions`; `Emulation.setCPUThrottlingRate` 4× |
| Mobile | Playwright `devices['iPhone 13']` / `['Pixel 7']` (emulation only — real iOS PWA/camera/printer still needs a physical device; say so) |
| Performance | `page.tracing` or CDP `Performance.getMetrics`; `frontend/e2e/perf-budget.spec.ts` |
| Console hygiene | `frontend/e2e/console-hygiene.spec.ts` pattern |
| Print | the print surface's QR/image readiness before print, both languages |

Never enter real credentials or payment data; use seed/test accounts from the project's dev seed.
