# Live-browser verification: screenshot → verify → fix → continue

Typecheck, tests and a build prove the *shape* of the code. They do not prove that the button the
user asked about is on the page, that clicking it does the thing, that the number shown is the
number the API returned, or that the page still fits an iPhone. The user has watched "verified"
fixes arrive broken on screen, so any change that renders something is not done until it has been
driven in a real browser and the observed result written down next to the expected one.

This is verification layer 5 in `SKILL.md`. It never replaces layers 1–4; it sits on top of them.

## Where to point the browser — and what each port actually shows

`.claude/launch.json` names every target. Use the Browser pane's `preview_start` with a `name` (or
`url`) — never Bash — and check `preview_list` / `tabs_context` first to reuse a server a peer
already has up. The wiring (from `frontend/vite.config.ts` and `cloudflare/wrangler.toml`):

| Config | What it serves | Use it for |
|---|---|---|
| `frontend` (5173) / `frontend-b` (5175) | **Your live edits** (Vite, HMR). Proxies `/api`, `/uploads`, `/health`, `/ws` to the Worker on **8787** — so the Worker must be running for data. | Verifying the change you just made, with real data and real writes. |
| `worker-dev` (8787) / `worker-dev-b` (8899) | The Worker + local D1, serving the **last-built** `frontend/dist` as its assets. **It does not show unbuilt edits.** Shared community property: ask who owns 8787 before restarting; never a second miniflare on the shared state dir. | API-direct checks; verifying the *built* bundle after `npm run build`; anything a peer already has up. |
| `admin (production)` / `store (production)` | leangbeauty.com live | **Read-only** post-deploy verification. No writes on production unless the user asked for that specific probe. |

Traps that make a correct change look broken (or a broken one look fine):

- **Writes silently no-op on the bare Vite port.** `api/http.ts` blocks every write when no
  sync-server URL is configured (`businessos_sync_server`, see `frontend/src/constants.ts`). If a form
  "does nothing" on 5173 with no console error, run
  `localStorage.setItem('businessos_sync_server', window.location.origin)` and reload — the Vite proxy
  then carries the write to 8787. A control that fails the same way as the change under test is
  evidence about the environment, not the change.
- **Looking at 8787 for an edit you never built.** The Worker serves `frontend/dist`; a "fix that
  didn't take" on 8787 is usually a stale build. Verify edits on 5173, or rebuild first.
- **Stale service worker.** `/assets/*` all `net::ERR_FAILED` while `/api/*` works is the tab's
  cached app shell (`business-os-app-shell` / `business-os-static` caches), not the server.
  Unregister the tab's service workers, delete its caches, reload.
- **Screenshots sometimes render at a broken scale**, and `ResizeObserver` callbacks are paint-gated
  in the pane (overflow/truncation checks can false-negative). Prefer DOM facts from `read_page` /
  `javascript_tool` for anything precise; use the screenshot for what only eyes catch.
- **Theme.** The app deliberately opens **light** for first-time visitors regardless of OS dark mode.
  A dark first paint under `colorScheme: dark` emulation is a regression, not the feature working.
- **Login.** There is no dev bypass. Do not type credentials. `read_page` on the admin root tells you
  whether a tab is signed in (app shell and sidebar vs the login form); reuse a signed-in tab. If none
  is, tell the user the pane needs one sign-in and continue meanwhile with the unauthenticated
  surfaces (storefront, `/health`).

## The loop, per surface

Run this for every surface the change touches — and for every **sibling** surface that shares the
component or rule (see `consistency-audit.md`), because the user's standing complaint is "fixed here,
still broken there".

1. **Reload cleanly.** Navigate to the route (or `window.location.reload()`); skip only if HMR is
   certainly live.
2. **Read errors first.** `read_console_messages` (errors), `preview_logs` for the Worker, and
   `read_network_requests` for the calls the surface makes. A 4xx/5xx or a red console line is a
   finding even when the screen looks fine.
3. **Confirm structure with `read_page`.** The button exists, the label is the translated string
   (switch to Khmer once — a raw `snake_case` key or English in km mode is a finding), the count in
   the header matches the rows rendered, disabled states are real (`aria-disabled`/`disabled`).
4. **Interact.** `computer` click / `form_input` on the real control, then `read_page` again to
   confirm the state change, and for a write, confirm the row in the DB or via the read API — the
   toast is not the evidence, the persisted row is (Golden Rule 3).
5. **Screenshot** what only eyes can judge: alignment, density, clipped text, a legend that wraps,
   a card that ballooned to its neighbor's height.
6. **Viewports and modes that matter.** `resize_window` mobile (375×812) for every list/dialog
   (cards below 768px, one bounded section row, bottom-nav clearance), then back to `desktop`;
   dark `colorScheme` for any surface whose colors changed. Reload after switching.
7. **Write the row** in the ledger before moving on (format below). A step you did not record did
   not happen.

If a step is red: read source, find the **cause** (not the symptom — the user has seen re-broken
fixes), fix, and re-run from **step 1 of that surface**, not from the failing step. Then continue to
the next surface. Never stop at a green screenshot without the ledger row, and never ask the user to
"check it looks right" — that is this loop's job.

## Evidence: the verification ledger

Screenshots exist only in the moment; the durable evidence is the observed value written next to the
expected one. Keep a ledger in the scratchpad while working (`verify-ledger-<lane>.md`) and carry
the summary into the session-log Part's **Verified** section.

```
| # | Surface / route | Action | Expected | Actual (observed) | How observed | Verdict |
|---|---|---|---|---|---|---|
| 1 | Sales › list, desktop, 5173 | Load w/ today range | 12 rows, header count 12 | 12 rows, header 12 | read_page | ✅ |
| 2 | Sales › list, mobile 375 | Same | cards, 4 tabs on one row | tabs wrapped to 2 rows | screenshot | ❌ → fix #a1 |
| 3 | POS › checkout, 5173 | Complete sale | receipt id `YYYYMMDD-HHMMSS`, sale row in D1 | `20260902-141233`, row id 15022 | read_page + sqlite | ✅ |
```

Rules for the ledger: one row per probe; "Actual" is the observed value, never "as expected"; a red
row names the fix commit that closed it, and the row is re-run after the fix. A production
(post-deploy) pass is a separate ledger, read-only, and states the deployed commit hash and the
version id wrangler printed at deploy (`/health` only returns a hard-coded `version` string).

## Broad passes

- **Page matrix.** For a stage certification or a "check every page" ask, walk every page
  registered in `frontend/src/components/shared/navigationConfig.ts` (read it — the set changes;
  don't work from a remembered list) plus the storefront, one ledger row per page per viewport:
  loads, no console errors, section row bounded, scroll root owned by the page, primary action
  reachable. `docs/nested-ui-action-audit-2026-09-01.md` shows the shape of a finished matrix.
- **Multi-viewport / PWA** — the `responsive-pwa-audit` skill covers device sweeps of a URL;
  `run` launches the app when no server is up. Reach for them; don't rebuild them.
