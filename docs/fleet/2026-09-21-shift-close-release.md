# Shift close fix and combined root checkpoint — 21 September 2026

Checkpoint tip `80f379ffb43f61da300e67a1dc7d70eefb756a42`, pushed to `origin/main`
and `origin/codex/supplier-settlement-20260918` (fast-forward from `ebafdada`).

## Ledger

| Item | Implemented | Verified | Pushed | Deployed |
| --- | --- | --- | --- | --- |
| Shift close clock-skew fix `ae45e101` (Worker close/amend routes, POS transport, tests) | yes | yes (root gates below) | yes | **yes — ce056cc0, see below** |
| Ordinary maintenance guard `46be2d68` / `3862413f` / `9997674a` (inherited, previously unverified) | yes | yes (root gates below) | yes | yes |
| Harness repairs `680ba83a` / `80f379ff` (22 test loaders, subtotal repair script parity, regenerated `ops/scripts/audit/orphan-audit.sql`) | yes | yes | yes | n/a |
| Adjust candidate `a22d3b1e` (`/inventory/adjust` single guarded batch) | candidate only | reviewed: **REJECT** | no | no |
| Downloads checkout cleanup | 300 worktrees archived then removed; 11 plain folders + 6 loose files moved to the recovery archive | journal reconciled against disk | archive branches pushed for every unpushed head | n/a |

Still open: the yesterday-open-shift trap; three baseline red
Worker tests; reset lifecycle blockers (unchanged, destructive reset stays
disabled); the adjust candidate's defects.

## Shift unable to close — root cause and fix

The POS End Shift request stamped `closed_at` from the device clock, and
`POST /api/shifts/:id/close` refused any instant ahead of the Worker clock with
zero tolerance. A phone running seconds fast could never end its shift from POS,
while the Shifts popup (which picks an earlier minute) worked. Production shift 20
(2026-09-21) shows the pattern: closed `13:02:00.000Z`, stamped `13:03:16Z`,
unlike every POS close before it.

Fix `ae45e101` (`cloudflare/src/routes/shifts.ts`, `frontend/src/api/shiftTransport.ts`):

- A missing `closed_at` is stamped server-side; POS no longer sends one on a live close.
- Up to five minutes of clock skew is clamped to the server's now; further ahead is
  still refused with 400 "Shift time cannot be in the future."
- The amend route applies the same clamp only to timestamps the caller actually
  sent; an untouched timestamp passes through verbatim (rewriting it registered a
  change the operator never made and broke the adjacent-shift text comparison).
- Nothing was cleared or weakened: interval/overlap checks, revision CAS,
  `canMutateShift` / `canAmendShift`, account isolation, registered/closing/
  additional amounts and the informational reconciliation are unchanged.

Coverage: `cloudflare/scripts/test-shift-close-clock-skew-pure.cjs` (server-stamped
close, clamp, far-future refusal, exact replay after a lost response, two identical
in-flight clicks commit once, other account 403, stale revision 409, reconciliation
informational and admin-only, amend clamp) and `frontend/tests/shiftCloseServerTime.test.ts`
(transport parity). Existing `test-shift-lifecycle-pure` and `test-shift-security-pure`
pass unchanged in intent (future-time controls moved to +10 min, beyond the clamp).

Production check (read-only D1): zero open shifts; the two null-closed rows (ids 2, 4)
are cancelled; no `maintenance` flag in `system_flags`. No production shift or
payment was created.

**Open trap (recorded, not fixed):** `readCurrent` returns only today's business-date
shift. A shift left open yesterday is invisible to the POS gate, and a POS-style close
of it fails with "Closing time overlaps the next shift segment."; only the Shifts
popup with a time before the next opening works. Needs an owner ruling: auto-close
at day end versus surfacing yesterday's open shift in the gate.

## Verification on the committed tip

- Frontend: `verify:i18n` and `build` exit 0. **Correction:** the earlier claim that
  `test:utils` (every file) was green on `80f379ff` was not backed by a full-chain run
  in this session; the first full run (below) found four baseline reds that Codex's
  own progress note had already flagged as "previous full510 gate predates these
  edits". See "Frontend gate correction".
- Worker: `tsc --noEmit` exit 0; every shift test; the maintenance-guard route tests.
- Full Worker sweep, every `scripts/test-*.cjs` run individually. Reds classified:
  - Baseline (present on `origin/main` before this session): `lib/db.ts` re-exports the
    import fence since `d787f440`, so every harness loading `db.ts` raw failed with
    "Cannot find module './importMaintenanceFence'"; migration 0188's trigger changed
    one refusal message; migration-registration coverage lacked companions for
    0188/0190/0191.
  - Regression from the inherited guard commits: harnesses that whitelist route
    imports did not load `lib/businessMaintenanceGuard`; one source-shape assertion
    pinned the old unguarded batch; the subtotal repair script's planner drifted from
    the route's guard SQL.
  - All repairs are loader/assertion changes (`80f379ff`); no route behaviour was
    changed to make a test pass. After repair every file passes except three
    baseline reds that predate this session and are disclosed, not hidden:
    `test-dated-stock-count-apply-pure`, `test-dated-stock-count-decisions-pure`
    (an inserted movement id reads back 0; `withCanonicalImportBranchWriteGuard.run`
    takes `last_row_id` from the second batch result, which the pure D1 shim does not
    populate — harness limitation is the likely cause, not proven against real D1)
    and `test-reset-products-pure` (0188's "exact member retirement required before
    delete" trigger refuses the reset route's member delete; reset stays disabled,
    which is the intended state).
  - Native workerd tests flake under CPU contention; each red rerun standalone passed.
    `test-record-orphans-native` regenerated `ops/scripts/audit/orphan-audit.sql` for
    the 0188/0190/0191 tables; that regeneration is committed in `80f379ff`.
- Paid and Free Wrangler dry-runs exit 0 at the tip. Packaging only; not a Free-plan
  capacity certification.

## Frontend gate correction — first full chain on the tip

The full frontend chain (`npm run test:utils`, 512 files) was run for the first
time this session on `f5c9866c` after the workspace's `frontend/node_modules`
was rebuilt with `npm ci` (its `@playwright/test` had been a symlink into a
worktree the cleanup removed). Result: 506 passed, 6 red. Classification, each
rerun standalone and then at the pre-session tip `ebafdada` in a temporary
worktree sharing the same dependencies:

- **Contention flakes (2):** `builtStartupGate` and `helpPopoverResponsive`
  (Playwright) pass standalone; they exceeded their time budget under the chain's
  CPU load. No change.
- **Baseline reds (4), identical at `ebafdada`:** all four were left red by Codex's
  `43f656d3` (product save actor fence: `createProduct`/`updateProduct`/
  `uploadProductImage` gained an `assertCurrent` fence and `productWriteTransport`
  now imports `actorReadScope`) and `6324e286` (Products.tsx line drift). Codex's
  progress note disclosed that the full gate was not rerun after those edits.
  - `apiHttp`: source-shape regexes for `createProduct`/`updateProduct` predated
    the fence parameter. Repinned to the fenced shape (the check runs inside the
    route closure before dispatch).
  - `hookDepsFilterState`: the `filtered` useMemo moved from :3359 to :3435, past
    the 60-line drift budget. Re-verified (object key, `effectiveStockState` in deps)
    and repinned with a dated reason.
  - `leadingZeroMergeUi`: loader lacked a stub for the new `actorReadScope` import.
    Stub added.
  - `privateTransportScope`: expected the quarantine code on a session change during
    compression; the read-scope fence now rejects first with `stale_read_scope`
    (still not dispatched, `sent === 0` kept). It also expected a product image
    upload to keep its response after a session change; since `43f656d3` that upload
    is fenced to the actor that started the save and rejects after dispatch, which
    Codex's `productSaveActorFence.test.ts` pins deliberately (phase `response`).
    The older test now asserts that exception explicitly and keeps the
    keep-response contract for the generic file/form transports.
- Assertion and loader changes only; no source behaviour changed. The four
  repaired files, `productSaveActorFence`, and then the full chain were rerun:
  **test:utils: 512 passed, 0 red of 512 executed files (0 skipped; 320520 ms)**, `verify:i18n` and `build` exit 0.

## AI Council and debloat gates (simulated: one model, five labelled perspectives)

Disclosed per AGENTS.md: a single model simulated the five perspectives and the
cross-critique; this is not five independent reviewers.

- **Contrarian Skeptic:** the five-minute clamp hides how far a device clock drifts;
  a badly drifting phone now closes successfully with a server-stamped time and
  nobody is told. Plausible, low loss: the stored time is the truer one. Real
  remaining failure: a shift left open yesterday still cannot be closed from POS.
- **First-Principles Engineer:** invariant is "stored shift times never exceed the
  server clock"; the server is the only time authority. The tolerance is the same
  window offline sale timestamps get, so it should be one constant, not two.
- **Expansionist (aspirational):** return the measured skew so the POS can warn the
  operator; auto-close or surface stale open shifts at business-day rollover.
- **Outsider:** why did a live close send a client time at all? It no longer does.
  Missing context: no rule yet for shifts spanning the day boundary.
- **Executor:** one POS End Shift on a real device on the deployed build; success is
  the shift closing with a server-stamped time within seconds of the tap.
- **Cross-critique:** the Skeptic's silent-clamp point stands but does not block;
  the Engineer's shared-constant point was acted on (below). The Expansionist's
  skew warning is deferred; nobody defended keeping two constants.
- **Chairman:** decision within the hour: ship (done, `80f379ff`). Biggest risk:
  the yesterday-open-shift trap, needs an owner ruling. Number-one next step: the
  owner's signed-in End Shift smoke on the live build.

Dead-code / debloat inspection of the touched surfaces: `withinServerClock` had
redefined the five-minute tolerance that `lib/clientTimestamp` already exports;
follow-up commit `be19267a` makes the shifts route import that constant (one
window for "device clock skew" system-wide) while keeping its own clamp semantics,
because sale timestamps fall back to the server clock rather than clamp. No new
unused export, helper or listener was added; the harness edits are import
mappings only. Reset, permission and financial rules untouched. That refactor is
behaviour-identical to the deployed `80f379ff` and ships with the next checkpoint.

## Adjust candidate `a22d3b1e` — independent review: REJECT

Reviewed in `C:/Users/mrkl6/Downloads/bos-business-maintenance-guards-20260921`
(parent `3a6ea807`). Not integrated. Reproduced defects:

1. A correction with a condition tag commits the stock change, then the handler
   returns 500 with no held row; the caller sees failure while stock already moved.
2. Catalog cost uses SQL `ROUND` (4.4166) where `meanMoney4` yields 4.4167; violates
   "nearest four decimals" and "mean of distinct positive costs".
3. Concurrency guards surface as 500 instead of 400/409, so retries are undiagnosable.
4. Exceptions A–D in the review notes plus a committed-then-400 hole: a validation
   failure after the batch leaves the write in place.

The stash in that worktree (excluded undo trial) is preserved; do not pop it blindly.

## Deployment — DONE (Paid), 21 September 2026 14:39Z

Deployed from the isolated worktree `C:/Users/mrkl6/Downloads/bos-deploy-20260921`
(detached at `80f379ff`, tracked tree clean, frontend built from that tip, Worker
typecheck and Paid/Free dry-runs exit 0) with `npm run deploy` (wrangler.toml, Paid),
after the owner granted permission in chat; the first two attempts were refused by
the auto-mode permission classifier. No `deploy:full`, `migrate:remote` or
`secrets:sync`; migrations 0185/0186/0188/0190/0191 remain unapplied by design.

- Source: `80f379ffb43f61da300e67a1dc7d70eefb756a42`.
- Worker version: `ce056cc0-ceba-44b0-b42c-177c7aa41247`; live
  `/api/runtime/version`: revision `80f379ffb43f`, hash `670972707d43682e`,
  built `2026-09-21T14:39:47.302Z`, tier `paid`. Startup 22 ms; exit 0.
- Frontend: `business-os-build.json` revision `80f379ffb43f`, hash
  `42f5adb0b7dbd0ce`, built `2026-09-21T14:19:10.501Z`; entry
  `index-BVUic7Xo.js`. 208 assets uploaded (113 already present).
- Live smoke (browser pane, signed out): admin shell renders the login screen and
  loads `index-BVUic7Xo.js` / `index-DYvo3wTI.css` with 200; the only console
  error is the expected 401 session probe. Public storefront renders About/contact.
  No sign-in was performed and no transaction touched; a signed-in POS End Shift
  smoke on a real device is the owner's remaining check.
- Previous production: `85a3e752` / `0bdfffc5-b4a9-48a6-9db3-3c0958979f1b`.

## Telegram reports — sectioned layout and language mode (3d213998, 22554ff6)

Owner request (21 September): the shift report follows the pasted reference
layout, every Telegram report is "smarter and compact" with a title, dividers and
numbered sections, and the language is a Settings choice — Khmer, English or both,
both by default.

- **Worker (`3d213998`, `cloudflare/src/lib/telegram.ts`, `telegramLang.ts`):**
  `formatShiftReport` renders six numbered sections in the reference order —
  title "Shift report — open/closed", shop / cashier / from / to, invoice counts
  (total, deleted, edited), Sales (revenue, discount on items, discount on
  invoices, gross sales when a cut exists, profit), Actual count (registered cash,
  final amount, additional used), Payment methods, Delivery service, Other
  expenses — under a shared rule line. `shiftFigures` reads the payment-method
  and courier breakdowns from the existing `salesAnalytics` readers (cap 8 rows
  plus "Other"); `gross_sales_usd` comes from the report kernel. Day and period
  reports and `/report` replies use the same section helpers. Language mode:
  `telegram_language` setting (`both` | `en` | `km`, junk → `both`) is read
  in the existing settings SELECT and applied through a synchronous
  `withLanguage` scope that restores the previous mode in `finally`; `pair()`
  emits both, English or Khmer labels. Khmer glossary checked against
  `km.json` (`gross_sales` reused).
- **Settings (`22554ff6`):** one `AppSelect` row "Report language" (both /
  English / Khmer, display default both, disabled without full settings
  access) writing `telegram_language` through the existing `POST /api/settings`
  path; three new keys in both packs (`telegram_language_label`, `_desc`,
  `_both`); the en/km options reuse the existing `english` / `khmer` keys.
- **Council / dead-code / debloat (simulated, five labelled perspectives):** the
  duplicated rule constant collapsed to one exported `RULE`; `expenseBlock`
  folded into `expenseTotals`; the language normaliser lives in one place
  (`normalizeTelegramLanguage`, used by both the setting reader and
  `setTelegramLanguage`); the duplicate `telegram_language_en/_km` keys were
  removed in favour of the existing keys; no new module, listener or request-path
  allocation. Free/paid: no plan-sensitive capability touched (one settings row,
  same message count). Retired copy ("Gross sale", "still open" wording) is
  pinned as retired in the tests.
- **Tests (`3d213998`):** `test-telegram-shift-report-pure.cjs` renders the
  fixture in both / en / km and pins the reference order, the gross-sales row and
  the 38-line cap; `test-shift-report-pure.cjs` repinned to the six sections
  with a strict-after order loop and a swapped-order positive control, and its
  stale "no breakdown queries" assertion (vacuous: the stub answered from a
  snapshot) replaced by a call-count pin on both breakdown readers (removing one
  increment fails it); bilingual, day-report and messages tests extended
  (glossary, mode restoration, junk fallback, `withLanguage` source check).
  Frontend: `settingsShiftTelegramI18n.test.ts` pins the keys and the wiring
  (name, `setValue`, both fallback, disabled, exactly three options).
- **Gates on the tip `22554ff6`:** frontend **test:utils: 511 passed, 1 red of 512 executed files (0 skipped; 380034 ms)**, `verify:i18n` and
  `build` exit 0. The one red is `swShellContent.test.ts`: its Playwright
  navigation to `/business-os-build.json` times out (30 s, `waitUntil: commit`)
  three of three standalone runs and in both full chains, with every source it
  reads byte-identical to HEAD; it passed in the 23:38 chain on the same sources.
  Restoring the CRLF endings of `frontend/public/sw.js` (the build rewrites the
  trio to LF) did not change the result. Classified environmental, not a
  regression; chip `task_e8f6d763` holds the evidence. Latent weakness noted:
  the test's source-replace of the app-document guard silently no-ops on CRLF.
  **Root cause found (22 September, test-only fix):** that latent weakness *was*
  the failure. `frontend/public/sw.js` is checked in CRLF; the fixture's needle
  `if (!isAppDocumentPath(url.pathname))\n            return;` never matched, so
  the legacy worker kept the guard, returned early for the
  `/business-os-build.json` navigation without `respondWith()`, and the request
  fell through to the fixture server that deliberately holds that route: nothing
  to commit, 30 s timeout. It passed in the 23:38 chain because the build had just
  rewritten the public trio to LF; restoring CRLF with `git checkout --` made the
  no-op return. Fix: normalise `source` to LF once and assert the needle matches
  **before** replacing (a replace-then-`!includes` check is always true and was
  removed as vacuous). Positive control: a needle mangled to `\r\n` fails in
  0.45 s at the new assertion, no navigation timeout. Five consecutive green
  runs at ~2.3 s. `builtStartupGate.test.ts` unaffected.
  Worker gate on `22554ff6`: `tsc --noEmit` exit 0; 492 of 497 `scripts/test-*.cjs` green; red: `test-dated-stock-count-apply-pure.cjs`, `test-dated-stock-count-decisions-pure.cjs`, `test-reset-products-pure.cjs` (the three disclosed baseline reds); `test-product-conflict-action-apply-native.cjs`, `test-product-conflict-action-remove-native.cjs` red in the sweep, green standalone (contention).
- **Chips:** `task_e8f6d763` (swShellContent navigation timeout),
  `task_dc150fae` (ReceiptSettings hard-codes its language labels) — fixed in
  `1d9c7004` (committed under the owner's task brief, then pushed and deployed at
  the 17:50Z checkpoint below once the brief was widened to "keep going until all
  are finish"):
  one shared `RECEIPT_LANGUAGE_OPTIONS` feeds the Settings cards, both preview
  pill rows and the printable receipt's switcher with keyed labels, English
  fallbacks and real Khmer; the receipt toolbar shows EN / KM / EN/KM below `sm`
  to keep its one-line phone layout (Opus verifier found the widening). Sweep
  leftovers, disclosed not changed: the header toggle's EN/KM code badge and
  the storefront translate list's English/Khmer entries among 26 language names.
- Not in this lane: `telegram_help_paragraph` "switches" wording untouched;
  `/stock` and `/inventory` keep the single-block layout.

### Deployment — DONE (Paid), 21 September 2026 17:11Z

Deployed from the isolated worktree `C:/Users/mrkl6/Downloads/bos-deploy-20260922`
(detached at `ee226065`, tracked tree clean after restoring the build's
line-ending churn on the `frontend/public` trio, Worker typecheck exit 0, frontend
built from that tip, Paid and Free dry-runs exit 0 with a clean stamp) with
`npm run deploy` (wrangler.toml, Paid) under the owner's standing checkpoint
authorization. No `deploy:full`, `migrate:remote` or `secrets:sync`; the unapplied
migrations stay unapplied by design. Pushed first: `origin/main` and
`origin/codex/supplier-settlement-20260918` both at `ee226065`.

- Source: `ee226065610becba09d0fe8f3fa2bd76f8c55f86` (code tip `22554ff6`; `ee226065`
  is the docs record on top).
- Worker version: `d6851e03-5548-488a-8fc7-28720c2da15e`; live `/api/runtime/version`:
  revision `ee226065610b`, hash `e9ef43ac6cbe0809`, built `2026-09-21T17:10:56.699Z`,
  tier `paid`. Startup 36 ms; exit 0.
- Frontend: `business-os-build.json` revision `ee226065610b`, hash `9cde5f6b800bd51b`,
  built `2026-09-21T17:09:14.950Z`. 210 assets uploaded (111 already present).
- Live smoke (browser pane, signed out): admin shell renders the login screen with
  only the expected 401 session probes in the console; public storefront renders
  About/contact. No sign-in, no transaction, no shift touched. The owner's remaining
  checks: a signed-in shift report on Telegram in the chosen language, and the
  Settings → "Report language" row.
- Previous production: `80f379ff` / `ce056cc0-ceba-44b0-b42c-177c7aa41247`.

### Deployment — DONE (Paid), 21 September 2026 17:50Z (receipt-language chooser)

Deployed from the isolated worktree `C:/Users/mrkl6/Downloads/bos-deploy-20260922b`
(detached at `c5b20a80`, tracked tree clean after restoring the public trio,
Worker typecheck exit 0, frontend built from that tip, Paid and Free dry-runs
exit 0 with a clean stamp) with `npm run deploy` (wrangler.toml, Paid) under the
owner's "keep going until all are finish" direction and the standing checkpoint
authorization. No `deploy:full`, `migrate:remote` or `secrets:sync`. Pushed
first: `origin/main` and `origin/codex/supplier-settlement-20260918` both at
`c5b20a80`.

- Source: `c5b20a8066b89c977ac8a4af02fd5c3869e14776` (code tip `1d9c7004`; `c5b20a80`
  is the docs record on top).
- Worker version: `0093be5b-5ea6-4926-841e-fe6caa0f6e1a`; live `/api/runtime/version`:
  revision `c5b20a8066b8`, hash `56fe20116c2869da`, built `2026-09-21T17:49:02.172Z`,
  booted `17:50:03Z`, tier `paid`. Startup 18 ms; exit 0.
- Frontend: `business-os-build.json` revision `c5b20a8066b8`, hash `f1187a522235752b`,
  built `2026-09-21T17:48:25.133Z`. 211 assets uploaded (110 already present).
- Live smoke (browser pane, signed out): admin shell renders the login screen with
  only the expected 401 session probes; public storefront renders. No sign-in, no
  transaction, no shift touched. Owner's remaining check: the receipt toolbar at
  phone width shows EN / KM / EN/KM and the Settings receipt-language cards read
  in Khmer when the app language is Khmer.
- Previous production: `ee226065` / `d6851e03-5548-488a-8fc7-28720c2da15e`.

## 22 September checkpoint — carry-over shift close, Telegram sections, test repairs

Ten commits on the tip, each one lane, each reviewed by the coordinator with a
rerun of the lane's tests, a simulated council pass (product, security, debloat,
dead-code, free/paid) and at least one refutation attempt.

- **Yesterday-open-shift trap — FIXED (`9335232b`, `77b740c1`, `4f932d49` Worker; `b3ccd9a8`, `db2158d7`, `4d1bb37f` POS).**
  Owner ruling applied: the daily prompt stays; nothing closes a shift on a
  timer; no fabricated closing time. `GET /api/shifts/current` gains one
  additive key, `previous_open_shift` (the OLDEST still-open, uncancelled,
  uncontinued shift from an earlier business date for the same scope, account
  and branch; no reconciliation; `77b740c1` corrected the first cut's newest-first
  order, which the interval guard could only refuse with a 409 while an older day
  was open; the test drains two stale days oldest to newest with a DESC
  discriminator), read by a second query beside the unchanged
  today-only `readCurrent`. The non-dismissible registration modal is now two
  steps in one modal: close the earlier shift first (fact strip, required
  closing time prefilled to now, the shared count fields, `closeShiftById` with
  an explicit `closed_at`) or "Open today's shift instead" (a step switch, not
  a close). With today already registered, the POS header offers the same close
  beside End Shift whenever the earlier row is closable (the coordinator widened
  the implementer's `!canCloseCurrent` gate, which had made the row unreachable
  once today's shift was open). The live current-day close still sends no
  `closed_at` (`ae45e101`). Ordering rule surfaced to the cashier: once today's
  shift is open, the Worker refuses a carry-over close stamped after that
  opening (409, verbatim in the toast). Four keys per pack. Not changed, noted:
  `shop_wide` rows owned by someone else render the locked reason (pre-existing
  `canMutateShift` inconsistency); a carry-over on another branch is visible
  only from that branch's POS or the Shifts popup; a mistaken carry-over close
  is corrected through amend, not reopen. One shared `shiftLocalDateTimeFromMs`
  replaced the Shifts popup's Intl copy. The first verifier pass on `b3ccd9a8`
  found the header prefill always refused once today's shift was open (D1), no
  `pendingShiftMutation` replay parity with an unknown outcome shown as a red
  toast (D2), two identical buttons (D4), the form implemented twice (D5) and the
  ORDER BY unpinned (D6). `db2158d7` folds both entry points onto one
  `useCarryOverClose` hook and one `CarryOverCloseFields` body (D2, D5), seeds
  the header prefill at min(now, today's opened_at − 60 s) (D1), and gives the
  header an amber button naming the earlier day (D4); `77b740c1` pins and
  corrects the order (D6). The carry-over test now executes the component:
  prefill, submitted body, toast and frozen replay, 83 checks. The second
  verifier pass on `db2158d7` (Opus, read-only) re-proved D1, D2, D4, D5 and D6
  with reverted-fix controls and found that the D1 seed and the D6 order did not
  compose (D7, high): the POS seeded against today's opening while the Worker's
  interval guard binds against the segment opened right after the offered row,
  so with two or more stale days the default press was refused with 409 and the
  hint named the wrong rule. Root cause, fixed at the source: `GET /current` now
  also returns `previous_open_close_before`, the bound computed by the same
  `readAdjacentShift` the guard uses (`4f932d49`), and the POS seeds
  min(now, bound − 60 s), clamped to the row's own opening (D9), shows the bound
  and the acting username on the fact strip (D10), and the hint states the real
  rule in both packs (`4d1bb37f`). D8 (medium): admin-exempt users never
  received the carry-over row although they are the only ones who can close a
  foreign shop-wide one; the read is now unconditional, so the header button
  surfaces it for admins while their registration exemption is unchanged. D11
  (low, observation): End Shift keeps its own replay read because its body
  genuinely differs (no `closed_at`); left as is. The third pass (Opus, read-only)
  re-proved D7, D8, D9 and D10 on `4d1bb37f` with the old seed as positive control
  (409 on every multi-day drain, 200 with the bound), showed the sub-minute residue
  is unreachable under the per-day unique indexes of 0123, and found: D12 (medium)
  the Shifts popup's historic close still seeds from the clock and meets the same
  409 (pre-existing since `3f9a6b56`, 10 September; sibling-surface lane in
  progress, chip `task_40e6bb0a`); D13 (low) the bound query scans
  `shift_sessions` on `opened_at` without an index (runs only when a stale row
  exists; 20 rows in production; index migration if the table grows); D14 (low)
  the hint no longer warns that today's End Shift is refused while a stale row is
  open (the amber close button beside End Shift is the remedy); D15 the POS half
  must not ship without the Worker half (this checkpoint ships both). Verdict:
  every claim made by 4f932d49 and 4d1bb37f holds under execution — D7, D8, D9/[O2] and D10 are genuinely fixed, with positive controls proving the probes and the tests discriminate — but the lane leaves one sibling surface, ShiftHistoryModal, still seeding a historical close from the bare clock (D12, pre-existing, now its own lane).
  Production facts (read-only D1, 22 September): `shift_scope_mode = shop_wide`,
  `shift_admin_exempt = true`, 20 shift rows, 0 open, 0 stale-open. Under
  `shop_wide` the carry-over query walks `idx_shift_sessions_business_date`
  with a correlated subquery (20 rows today, one more per day); revisit with an
  index only if the table grows by orders of magnitude. **Follow-up registered:**
  under `shop_wide` a stale row left open by another cashier is shown locked and
  today's End Shift then fails with the pre-existing "Opening time overlaps the
  previous shift segment" 409; `canMutateShift` is owner-or-admin while the
  setting's own hint promises any staff member can close a shop-wide shift. That
  widening is an owner decision (chip `task_4c313434`), not part of this lane.
- **Telegram `/stock` and `/inventory` — DONE (`8d4db70e`):** numbered, ruled
  sections through the existing helpers and labels; `telegram_help_paragraph`
  checked sentence by sentence against current behaviour and left as is.
- **Three baseline Worker reds — REPAIRED, test-only (`41bc3abe`):** the two
  dated-stock-count harnesses flattened `db.batch()` results and dropped the
  row id; `test-reset-products` built its schema from the unapplied 0185–0191
  migrations, whose 0188 retirement trigger correctly refuses the reset route's
  member delete. **Reset blocker recorded:** before 0188 is ever applied to
  production the reset route must retire `transfer_operation_members` through
  that kernel. Five more harnesses with the same flattening repaired
  (`91e2f69b`); six named files already passed raw results through. An independent
  audit (Sonnet, read-only) then found the same dormant shim in four sibling
  harnesses; repaired the same way (`2d95bfc9`), closing the class in the tree.
- **swShellContent** root-caused and repaired earlier today (`54926130`).
- **Gates:** frontend on `4d1bb37f` **test:utils: 514 passed, 0 red of 514 executed files (0 skipped; 338273 ms)**, `verify:i18n` and
  `build` exit 0 — the first fully green frontend chain of this program.
  Worker gate on `4d1bb37f`: `tsc --noEmit` exit 0; 496 of 498 `scripts/test-*.cjs` green; `test-queue-fallback-native.cjs`, `test-record-orphans-native.cjs` red in the sweep, green standalone (workerd contention while the frontend chain ran).

### Deployment — DONE (Paid), 21 September 2026 21:38Z (carry-over shift close checkpoint)

Deployed from an isolated worktree detached at `f98754b3` (the docs record on
top of code tip `4d1bb37f`; tracked tree clean after restoring the public trio,
`npm ci` in both packages, Worker typecheck exit 0, frontend built from that tip,
Paid and Free dry-runs exit 0) with `npm run deploy` (wrangler.toml, Paid) under
the owner's "fix and make deploy" direction and the standing checkpoint
authorization. No `deploy:full`, `migrate:remote` or `secrets:sync`; no
production D1 write. Pushed first: `origin/main` and
`origin/codex/supplier-settlement-20260918` both at `f98754b3`.

- Source: `f98754b364ba` (code tip `4d1bb37f`).
- Worker version: `c77d84db-2d7a-4308-8b97-674b60bdb439`; live `/api/runtime/version`:
  revision `f98754b364ba`, hash `aea0cc55ceb3a067`, built `2026-09-21T21:35:49.659Z`,
  booted `21:38:34Z`, tier `paid`. Upload 131 s, triggers 11 s; exit 0.
- Frontend: `business-os-build.json` revision `f98754b364ba`, hash `858e11877a4da3a1`,
  built `2026-09-21T21:34:54.691Z`.
- Live smoke (browser pane, signed out): admin shell renders the login screen with
  only the expected 401 session probes; public storefront: the pane's cached shell
  from the previous build asked for a retired chunk, the Worker answered 404 "Stale
  build asset" and the stale-chunk guard reloaded once onto the live build
  (`__bos_reason=nested-chunk:public-catalog-secondary-tabs:live-build-first-attempt`),
  after which the About and Products tabs render (3 586 results, page 1 of 72;
  portal bootstrap, search and promotions 200). The anonymous client-error report
  answered 401 as before. No sign-in, no transaction, no shift touched. Owner's
  remaining check: on a phone with a shift left open from an earlier day, the POS
  prompt offers "close it first" with the closing time prefilled a minute before
  the next opening, and the amber header button does the same once today is open.
- Previous production: `c5b20a80` / `0093be5b-5ea6-4926-841e-fe6caa0f6e1a`.
- Deploy worktree removed after the smoke (`git worktree remove`, then the long-path
  residue deleted and the registration pruned).

### D12 — Shifts popup close seeded from the Worker bound — FIXED (`f69e81f1` Worker, `e2c744bf` POS)

Sibling-surface parity for the carry-over close. The admin Shifts popup's Close
form seeded its closing time from the bare clock and posted to the same
`POST /shifts/:id/close`, so for any open row with a later segment the default
press met the same 409 the POS had. Lane (Opus, own detached worktree, one writer),
reviewed by the coordinator and cherry-picked onto the branch:

- **Worker:** `closeBoundFor(db, row)` returns `readAdjacentShift(..., 'next')?.opened_at`
  for an OPEN row and `null` without a query for a closed or cancelled one;
  `presentShift` = `responseShift` + `close_before` on every surface that offers a
  close (plain and paged list, `/:id/history` segments, the record read, and the
  close / cancel / reopen / amend responses the popup replaces its selected row
  from). `/current` unchanged. One extra D1 read per open row only; a correlated
  subquery would have duplicated the adjacency rule in SQL, the drift the
  carry-over test pins against. New `test-shift-list-close-bound-pure.cjs`
  (29 checks: bound on an open row with a later segment, null on the last open
  row, on a closed row and on a cancelled row that does have a later segment;
  paged list; the seeded close accepted; source pins through `readAdjacentShift`).
- **Frontend:** `carryOverCloseSeedMs` moved verbatim from `ShiftGate.tsx` into
  `shiftTransport.ts` as the single exported definition (the gate imports it, no
  behaviour change); `Shift.close_before` documented; `blankClose(shift)` seeds an
  open row at min(now, bound − 60 s) clamped to its own opening, closed rows and
  the popup's reset keep the current minute; the bound shown in one compact row
  with the existing `shift_previous_open_close_before` key and `fmtDateTime24`
  (no pack change). New `shiftModalCloseBound.test.ts` (12 checks, executed
  component; negative controls: a clock-seeded copy of the component fails the
  same assertion, the bound row hidden when the server states none, the form
  reads the record response rather than the list); `shiftCarryOverClose.test.ts`
  clamp control now injects a mutated seed through the transport mock.
- **Gates on `e2c744bf`:** focused shift suite 18 files green in both packages
  first; then frontend **test:utils: 515 passed, 0 red of 515 executed files (0 skipped; 508104 ms)**, `verify:i18n` and `build` exit 0, public trio
  restored; Worker `tsc --noEmit` exit 0, 497 of 499 `scripts/test-*.cjs` green; `test-product-conflict-action-apply-native.cjs`, `test-product-conflict-action-remove-native.cjs` red in the sweep, green standalone (workerd contention).
- **Simulated council (one model, five perspectives):** product — the popup's
  default press is now accepted and the operator sees the bound it was seeded
  from; security — `close_before` is the opening time of an adjacent row the
  same user can already list, no new permission path; debloat — one helper, one
  seed definition, closed majority costs nothing; dead-code — the gate's private
  copy of the seed is gone, `ShiftPresentedRow` has one consumer; free/paid — D1
  reads not CPU, bounded by open rows per page. Accepted.
- **Registered, not fixed here:** the popup counts its always-prefilled
  `closedAt` as an unsaved change, so opening the Close form disables the other
  actions and arms the unsaved-changes guard before anything is typed
  (pre-existing, `ShiftHistoryModal.tsx` `closeDirty`; chip `task_4683ad2f`).
- **Shared checkout repair, environment only:** `business-os-v1/frontend/node_modules/@playwright/test`
  was a dangling symlink into a folder removed by the 21 September cleanup
  (`bos-precision-final-candidate-20260914`) and `playwright` / `playwright-core`
  were absent, so `npm run typecheck` there failed TS2307 in four test files for
  every session. The three packages were copied at the lockfile's 1.63.0 from
  this workspace's install (no `npm install` in the shared tree); typecheck exit 0
  there afterwards. The lane worktree's `node_modules` junctions into the shared
  checkout were deleted as links only (entry counts unchanged) before
  `git worktree remove`.

### Deployment — DONE (Paid), 21 September 2026 23:10Z (D12 Shifts popup checkpoint)

Deployed from an isolated worktree detached at `fee0a315` (the D12 docs record on
top of code tip `e2c744bf`; tracked tree clean after restoring the public trio,
`npm ci` in both packages, Worker typecheck exit 0, frontend built from that tip,
Paid and Free dry-runs exit 0) with `npm run deploy` (wrangler.toml, Paid) under
the owner's "fix and make deploy" direction and the standing checkpoint
authorization. No `deploy:full`, `migrate:remote` or `secrets:sync`; no
production D1 write. Pushed first: `origin/main` and
`origin/codex/supplier-settlement-20260918` both at `fee0a315`; the merged lane
branch `codex/shift-modal-bound-20260922` deleted locally (its two commits are
`f69e81f1` and `e2c744bf` on both branches).

- Source: `fee0a315baf3` (code tip `e2c744bf`).
- Worker version: `4d263940-1996-43d6-aeac-19514c8080b0`; live `/api/runtime/version`:
  revision `fee0a315baf3`, hash `914e1ac2b2ee6afe`, built `2026-09-21T23:07:39.083Z`,
  booted `23:10:02Z`, tier `paid`. Upload 101 s, triggers 11 s; exit 0.
- Frontend: `business-os-build.json` revision `fee0a315baf3`, hash `1bef2af49779c663`,
  built `2026-09-21T23:06:23.162Z`.
- Live smoke (browser pane, signed out): admin shell renders the login screen with
  only the expected 401 session probes; public storefront About and Products tabs
  render on the new build with no console errors. No sign-in, no transaction, no
  shift touched. Owner's remaining check: Shifts popup → an open row from an earlier
  day → Close: the closing time is prefilled a minute before the next shift's opening
  and that bound is shown above the form.
- Previous production: `f98754b3` / `c77d84db-2d7a-4308-8b97-674b60bdb439`.
- Deploy worktree removed after the smoke (long-path residue deleted with PowerShell,
  registration pruned).

### Program workspace removed — DONE, 22 September 2026

With both branches at `e864268c` and nothing uncommitted, the settlement workspace
`bos-supplier-settlement-20260918` was removed under the owner's "delete the many
folders" direction: its ignored evidence (`outputs/`, `frontend/e2e-report`,
`frontend/test-results`; 1 669 files) copied to
`BusinessOS-Recovery/2026-09-22/bos-supplier-settlement-20260918/`, its
`cloudflare/node_modules` junction into the shared checkout deleted as a link only
(target entry count unchanged), then `git worktree remove` and prune. Under
Downloads only `business-os-v1` remains. `codex/supplier-settlement-20260918` stays
on origin at the same tip as `main`.

**Still open after this program:** the 22 Sep "changed on another device" class (fixed below); shift 20 (21.09.2026) closing-count amendment
(needs the owner signed in; Claude does not enter passwords); shop-wide close permission (chip `task_4c313434`,
owner decision); D13 `opened_at` index (low, only if `shift_sessions` grows); 0188
reset blocker; adjust candidate `a22d3b1e` stays REJECT.

### "Changed on another device" on every edit — FIXED class-wide (`4c163015`)

Owner report, 22 September (phone screenshot): a product edit was refused with
"Product changed on another device — your version expected 16/09/2026 19:10,
latest 22/09/2026 13:33", the "Current saved details" showed a raw ISO
timestamp, and "many things are still expecting old versions": images, product
changes, other actions.

**Root cause (one class, not one screen; corrected after the adversarial
verifier refuted the first version by executing the old helper).** The version
token a guarded write sent was whatever `updated_at` rode along in the form
payload — the record the screen loaded with (a Products list on a phone kept
open for days, or an autosaved draft restored into the form) — and nothing ever
refreshed it: a refused save kept the same record, so "Reload latest" and every
further press sent the same stale token. Where a payload carried no
`updated_at` at all, `frontend/src/api/expectedUpdatedAt.ts` filled one from a
Dexie mirror row the live app stopped rewriting on 12 Sep (`10b4d902`,
`localMirrors.ts` `shouldPersistLocalMirror` false on any http(s) origin):
stale where a row existed, absent otherwise. The settings variant read a
device-local `settings_meta` row holding a wrong-scope global version. The
image symptom is the same defect: the form's image upload does not bump the
product row, but the save that follows it was refused on the stale token.

**Fix (simulated council decision, five labelled perspectives, one model).**
- The helper module is deleted. Transports send the payload they are given,
  synchronously (`branch`, `contactWrite`, `lookup`, `productWrite`, `returns`,
  `sales`, `userAdmin`, `settings`); no mirror read on the request path. The
  Worker already accepts `expectedUpdatedAt` / `expected_updated_at` /
  `updated_at` (`conflictControl.ts` `getExpectedUpdatedAt`) and skips the check
  on an empty token, so a write with no version is checked by nothing rather than
  refused on a stale one.
- Every caller passes the version its screen holds, explicitly: Products edit
  (`selected.updated_at`), single and bulk delete (row / snapshot), undo/redo
  restore and delete-redo (re-read first), promotion discount save, branch save,
  contact deletes (single + bulk from the pre-delete snapshots; contact edits
  already carried the row's `updated_at`), role delete. Sales, returns, users,
  lookups, batches, fees, notes and files already did.
- A refused product save re-reads the row (`fetchProductsByIds`) into the open
  form AND patches the list row, so the next press carries the version that won
  and closing/reopening the form does not replay the stale one; a refused
  contact save (customers, suppliers, delivery) reloads its tab so the reopened
  form carries the version that won. The dialog names the product (name,
  barcode) and formats every `*_at` as dd/mm/yyyy 24-hour; the Worker's PUT
  pre-read returns `id, name, barcode, updated_at` as `current`.
- `DELETE /roles/:id` read the token only from the query string, which the client
  never used, so that guard never ran; it now reads the JSON body first (as the
  lookups routes do) with the query string as fallback.
- Dead after tracing callers: `contactsTransport` update/delete/bulkImport
  (the live path is `contactWriteTransport`), `deleteBranch`,
  `attachSaleCustomer` (+ its private types), the `methods.ts` re-exports of all
  of them, `localGetSettingsMeta` / `localSaveSettingsMeta` (the Dexie
  `settings_meta` store declaration stays: Dexie versions are append-only).
- Tests: `productWriteConflictToken.test.ts` (13, executed dialog), new
  `writeVersionFromScreen.test.ts` (81: helper absent, no transport reads a
  mirror, contact and role transports EXECUTED with a fake `apiFetch` send
  exactly the caller's body, every caller and the 409 re-read/reload pinned
  with a negative control), Worker
  `test-products-update-conflict-current-pure.cjs` (6) and new
  `test-roles-delete-conflict-body-pure.cjs` (6: the route's body-first
  extraction executed verbatim with a fake context; negative control). Twelve
  pinned tests updated to the new seam (`apiHttp`, `directMutationRequest`,
  `posMoneyV1`, `productSaveActorFence`, …).
- **Gates on `4c163015`:** frontend **test:utils: 517 passed, 0 red of 517 executed files (0 skipped; 453870 ms)**, `verify:i18n` and `build` exit 0,
  public trio restored; Worker `tsc --noEmit` exit 0, 494 of 501
  `scripts/test-*.cjs` green; `test-backup-schema-discovery-native.cjs`, `test-catalog-live-stock-native.cjs`, `test-import-maintenance-fence-native.cjs`, `test-product-conflict-action-apply-native.cjs`, `test-product-conflict-action-remove-native.cjs`, `test-sale-return-money-precision-native.cjs` red in the sweep, green standalone (workerd contention); `test-product-money-write-policy-native.cjs` red for real (its race hook named the old pre-read SQL), repaired at `4c163015`, green standalone twice.
- **New rule and skill (owner, 22 Sep: "make a skill and rule to not break
  anything and verify the affected surroundings"):** `.claude/skills/blast-radius/SKILL.md`
  plus a non-negotiable line in `AGENTS.md` and a start-here step in
  `CLAUDE.md` — map callers, siblings, the other package and pinned tests with
  `git grep` before editing; treat one symptom as one instance of a class; verify
  the map afterwards on the surface the owner uses; record the matrix.

**Council record (simulated).** Product: the owner's exact flow (edit a product
that changed elsewhere, save with a new image) now succeeds or names the product.
Security: no guard weakened — the token is still compared server-side whenever
the client holds one, and one guard (roles delete) that never ran now does.
Debloat: −53-line helper, −69 lines of dead contact transports, −40 of sale
attach, no `await` on the write path. Dead-code: every removal traced to zero
importers (`git grep`). Free/paid: no plan-sensitive change. Accepted; no
unresolved objection.

**Adversarial verifier (bos-verify agent, read-only, on the lane tip before the
follow-up).** Verdict NOT CERTIFIED on two counts, both answered in the follow-up
commit: (1) the stated root cause was refuted by executing the old helper (it
short-circuited on `payload.updated_at`, so the mirror branch never ran for a
form that spread its record) — the story above is the corrected one and the
false version was removed from four source comments and the test header;
(2) the class was not closed for contact edits — now a refused contact save
reloads its tab; the open modal itself still holds the `updated_at` it opened
with, so "close, reopen, save" is the path there (recorded as the residual; the
product form gets the stronger in-place re-read) — closed in `c58a847a`, see the
follow-up below. Certified: no remaining
importer of the removed modules; the guarded-write matrix (every
`assertUpdatedAtMatch` route and its frontend caller — no route lost a token,
branch PUT and role DELETE go from "guard never ran" to "guard runs"); settings
scoped-meta semantics intact; sales/returns unchanged; the products re-read
cannot clobber the operator's edits (form hydrates on id change only) and
cannot fire after close (revision fence); DELETE bodies are really sent
(`http.ts` `methodAllowsRequestBody`); no offline-queue/PWA path imported the
helper; the conflict dialog was already English-only (pre-existing, not new).
Not driven at runtime: the two newly effective guards against live concurrency.

**Deployment.** DEPLOYED 22 Sep 09:00Z from `9895c5ec` (origin/main = codex/supplier-settlement-20260918): Worker version `582c0642-b4a4-4de4-bab6-080d65584b07`, revision `9895c5ec725a`, frontend hash `9b87775267b62e7e`, tier paid, Free dry-run bundle green, no remote migration. Smoke: admin login shell and storefront render on the new chunks; the browser pane's first storefront load ran the previous build's cached shell (stale-asset 404 until reload — the normal service-worker transition, not this lane). The owner's exact flow (edit a product changed elsewhere, save with an image) needs a signed-in session and is verified by the executed tests, not live.

## Follow-up, 22 September (lane C)

- `bbbf8be8` (lane commit `88d5cbd1`, chip `task_4683ad2f`): opening the Shifts popup's
  Close form is not an unsaved change — `closeDirty` compares against the prefilled
  seed, so the X closes silently until the operator edits a field; every edit still
  guards. Pinned in `shiftModalCloseBound.test.ts` (17 checks).
- `c58a847a`: the contact residual above is closed. While a customer, supplier or
  delivery-contact form is open, `selected` follows the list row's `updated_at` (an
  effect keyed on the list), and the edit payload spreads `selected.updated_at` over
  the form's copy; the form state itself seeds once, so the operator's edits are
  untouched. After the 409 handler's reload the next save press carries the version
  that won. Pinned with negative controls (`writeVersionFromScreen.test.ts`, 93 checks).
- Simulated council (five perspectives, labelled simulated): product owner — retry in
  place matches the product form; UX — no visible change until a conflict, no new
  dialog; architecture — one effect per tab, no shared helper (three call sites of
  three lines; a helper would be the fourth file); security — no route change, the
  Worker guard is unchanged; QA — the pins have controls that remove exactly the new
  lines. Dead code: none added, none left (`useEffect` was already imported). Debloat:
  no new state, no re-render beyond the reload that already happens.
- Gates on `c58a847a`: frontend 517 passed, 0 red of 517 executed files (0 skipped; 378108 ms), i18n/build 0. Worker unchanged since `4c163015`.
- Worktree cleanup 22 Sep (owner: "keep one business-os version only"): 23 registered worktrees under Temp, ~/.codex/worktrees and business-os-v1/.claude/worktrees archived then removed (unmerged heads and real uncommitted edits pushed as origin/archive/{aa7e-business-os-v1, aa98-business-os-v1, bos-efficiency-20260908-business-os-v1, private-read-caches, stock-transfer-existing-lots-20260912, bos-f51-c0ef-branch-review, bos-f51-e97-branch-review, bos-f65-phase1-browser-e2f5489b-4012fe0c, mergedry, lane-p9-assistant-chat, lane-p9-portal-reset, lane-p9-public-home}; untracked files in BusinessOS-Recovery/2026-09-22/<name>/; node_modules junctions deleted as links only; `git worktree prune`). Only business-os-v1 exists now; local branches were left in place.
- **Deployment.** DEPLOYED 22 Sep 10:38Z from `a7c03ee7` (origin/main = codex/supplier-settlement-20260918): Worker version `581d3612-154b-4256-b849-0f314cf1a854`, revision `a7c03ee74f2d`, frontend hash `1198099512be7c8c`, tier paid, Free dry-run bundle green, no remote migration. Smoke: /api/runtime/version and /business-os-build.json report the revision, admin login shell and storefront render, no console errors. Not driven live: a contact edit refused as changed on another device (needs a signed-in session). Temp: 1,977 unregistered `bos-*` test-fixture folders (819 MB, left behind by test runs) deleted after the 12 plain repo-like copies among them were moved to BusinessOS-Recovery/2026-09-22/temp-plain-copies/; the Codex result JSON files moved to .../codex-results/.
- **POS hotfix.** DEPLOYED 22 Sep 14:11Z from `2fd4adf7` (origin/main = codex/supplier-settlement-20260918) — POS hotfix, owner report "it works but seems not to close the order": Worker version `5d3f6aa6-cd0f-46d6-a084-17bf853dfae7`, revision `2fd4adf73a77`, frontend hash `2529a3df70a96b92`, tier paid, Free dry-run bundle green, no remote migration. Root cause (Sentry BUSINESS-OS-1A, 10:48Z): Chrome's page translator re-parented React-owned nodes on the POS, React threw removeChild AFTER the sale was recorded, and closeOrder only persisted the committed close from a post-commit effect, so the reload restored the recorded order with its pending request id and every retry recovered the same receipt and crashed again. Fix: (A) the admin branch of index.html's bootstrap opts the admin shell out of machine translation (meta google=notranslate + translate="no"; storefront unchanged) and its adminRoutes table is synced with pathRouting.ts (/notes /fees /delivery-contacts /promotions /promos /review /review-queue were missing); (B) a committed closeOrder writes orders/active/counter drafts synchronously before setState, like handleCheckout does for the pending id. Pinned in tests/posCommittedCloseDurability.test.ts (drives every admin segment from pathRouting.ts's maps; negative controls). Certified by an independent verifier (two exceptions fixed before deploy: route-table drift; a false "Discard & Leave" dirty-work entry dropped). Smoke (browser pane, 14:12Z): /api/runtime/version reports the revision, tier paid; /business-os-build.json reports the hash; the FIRST load of admin.leangbeauty.com/review still served the previous shell from the old service-worker cache (stale-shell class, title "Leang Beauty", no opt-out) and the second load had the new shell (title "Business OS", translate="no", meta present, /review in the route table); storefront renders and stays translatable; no console errors. Open tickets: receipt-print queue is in-memory (reprint from Sales); assertPosCheckoutOwner blocks an admin recovering an employee's crashed sale; stale-shell chunk class (BUSINESS-OS-4) self-heals via claimChunkReload; sales.updated_at mixed formats (writer not located).
- **Checkpoint 2 (Reports + no-ellipsis).** DEPLOYED 22 Sep 21:23Z from `ef0489c1` (origin/main = codex/supplier-settlement-20260918) — checkpoint 2, owner report "reports section ... text heavy and the boldness ... size is too big ... product names are using ellipses ... opened details are unreadable ... float auto closes when I move": Worker version `61a1afaa-024a-401b-bf94-ed5b6ba58c97`, revision `ef0489c12856`, frontend hash `722582f2f6b38731`, tier paid, Free dry-run bundle green, no Worker change, no remote migration. Composition of eight frontend-only commits on ee788be0: Reports lane (kit Fold closes only on X/outside/Escape/Back, never on a re-render; names scroll in every report row; row details render as readable Field|Before|After folds; weight and size balanced with one bold block per receipt sheet; float stays on screen and follows the pressed row via Fold.anchorKey; SectionHeader title scrolls instead of ellipsing; ReceiptBlock.summary) and the no-ellipsis class sweep (names scroll instead of ellipsing on every sibling surface: products, POS sheet, sales, returns, contacts, stock change, stock-in sessions, transfers, dashboard, audit log, catalog; five exceptions closed; the sweep test re-derives its claim instead of pinning an element count). Gates on the composed tree: frontend typecheck 0, verify:i18n OK (5903 keys), test:utils 521 passed, 0 red of 521 executed files (794742 ms), Worker tsc 0, build green, both dry-runs green. Lanes certified alone and once composed (independent verifier). Smoke: browser pane 21:27Z: /api/runtime/version reports revision ef0489c12856, tier paid, sourceHash 5f32eac839403d43; /business-os-build.json reports hash 722582f2f6b38731; admin.leangbeauty.com/review served the NEW shell on its first load (title Business OS, translate=no, only the signed-out 401s in the console). The storefront leangbeauty.com did NOT: the previous worker served the old shell, its chunks catalog-products-N5xbo9i_.js and catalog-secondary-tabs-B15JBamP.js answered 404 Stale build asset, the guard's one-shot reload (__bos_reason=nested-chunk:public-catalog-secondary-tabs:live-build-first-attempt) landed on the SAME old shell, and the root error boundary showed "The app could not start / Reload to try again"; a further manual load got the new worker and the catalog rendered (title Leang Cosmetics, products listed, no console errors). So the stale-shell class (BUSINESS-OS-4) does NOT self-heal on the storefront as previously recorded: a returning visitor sees one failed screen after a deploy until they reload again. Root-cause lane opened on frontend/src/public-runtime/service-worker.ts (recoverStaleShell, appShellFallback) and utils/chunkReloadGuard.ts; the fix goes into checkpoint 3. Follow-up lane also open for the composed verifier's exceptions (dense-cell-truncate names on Stock change and Returns desktop tables, batch-id reveal, doubled Khmer line box on the Reports hub, three dead summary flags).

## Downloads cleanup — DONE

314 `business-os` checkouts under `C:/Users/mrkl6/Downloads` were classified: 300
worktrees on the shared `business-os-v1/.git` to remove, 11 plain (non-git) folders,
3 keeps. After the owner's permission, `cleanup.mjs --apply` (plan in the session
scratchpad) archived every worktree before removing it: tracked diff, untracked
files and non-dependency ignored files to
`C:/Users/mrkl6/BusinessOS-Recovery/2026-09-21/<name>/`, and every head absent from
`origin` pushed as `refs/heads/archive/<name>` first. Two apply runs overlapped
(the first blocked attempt was executed once permission arrived, alongside a second
start); the duplicate was stopped and the journal reconciled: all 300 worktrees are
removed with archive evidence (293 clean, 7 left empty directory shells from the
race that were then deleted). The 11 plain folders (review snapshots, QA tooling,
an unpushed-lanes bundle, a pre-ChatGPT source copy) and 6 loose zips/logs were
moved, not deleted, into `BusinessOS-Recovery/2026-09-21/plain/` and `loose/`.

22 September, owner's "delete the many folders ... push what is done and needed":
`bos-business-maintenance-guards-20260921` (branch
`codex/business-maintenance-guards-20260921`, four commits beyond the checkpoint
tip including the rejected adjust candidate `a22d3b1e`, one uncommitted change to
`ops/scripts/audit/orphan-audit.sql`) had its dirty file committed as-is
(`284536b7`, wip) and the whole branch pushed to
`origin/archive/bos-business-maintenance-guards-20260921` before the worktree was
removed; nothing merged, the REJECT stands. The 78 stale `bos-rc-workers/*`
registrations whose folders were already gone were pruned. Remaining under
Downloads: `business-os-v1` (the shared checkout with peer work, never removed),
`bos-supplier-settlement-20260918` (this program's workspace, to be removed once its
untracked `outputs/` evidence is moved to `BusinessOS-Recovery/2026-09-22/`) and
`bos-shift-modal-bound-20260922` (the D12 lane, removed once its two commits were
cherry-picked onto the branch). After that: only `business-os-v1` and the
settlement workspace remain.
The temporary `bos-baseline-ebafdada-tmp` and `bos-deploy-20260921` worktrees
were removed after the deploy. Downloads now holds exactly three checkouts:
`business-os-v1` (primary `.git`, still backs 98 worktrees under `.codex`,
`.claude` and Temp), `bos-supplier-settlement-20260918` (workspace; its dangling
`cloudflare/node_modules` junction was repointed at the primary's real install,
typecheck green) and `bos-business-maintenance-guards-20260921` (rejected
candidate, stash preserved). Journal:
`BusinessOS-Recovery/2026-09-21/cleanup-journal.jsonl`.
