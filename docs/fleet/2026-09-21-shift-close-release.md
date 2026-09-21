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
  Worker gate on `22554ff6`: `tsc --noEmit` exit 0; 492 of 497 `scripts/test-*.cjs` green; red: `test-dated-stock-count-apply-pure.cjs`, `test-dated-stock-count-decisions-pure.cjs`, `test-reset-products-pure.cjs` (the three disclosed baseline reds); `test-product-conflict-action-apply-native.cjs`, `test-product-conflict-action-remove-native.cjs` red in the sweep, green standalone (contention).
- **Chips:** `task_e8f6d763` (swShellContent navigation timeout),
  `task_dc150fae` (ReceiptSettings hard-codes its language labels) — fixed in
  `1d9c7004` (committed, not pushed, not deployed, per the owner's task brief):
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
The temporary `bos-baseline-ebafdada-tmp` and `bos-deploy-20260921` worktrees
were removed after the deploy. Downloads now holds exactly three checkouts:
`business-os-v1` (primary `.git`, still backs 98 worktrees under `.codex`,
`.claude` and Temp), `bos-supplier-settlement-20260918` (workspace; its dangling
`cloudflare/node_modules` junction was repointed at the primary's real install,
typecheck green) and `bos-business-maintenance-guards-20260921` (rejected
candidate, stash preserved). Journal:
`BusinessOS-Recovery/2026-09-21/cleanup-journal.jsonl`.
