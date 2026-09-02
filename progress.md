# progress.md — business-os

The control document for this project. **Read this file top-to-bottom at the start of
every session**; it is deliberately kept short enough that this is realistic.

> **Running multiple sessions on this checkout?** Invoke the **`/fleet-coordination`** skill
> ([`.claude/skills/fleet-coordination/`](.claude/skills/fleet-coordination/SKILL.md)) — the standing
> playbook for session roles, conflict-prevention on the shared git index, the verify-before-trust
> confirmation layers, the staged commit→push→deploy cycle (Stage 1 vs Stage 2), live testing, and
> the ≤300K compaction rule.

The per-session narrative log is **not** in this file. It lives in
[`docs/history/session-log.md`](docs/history/session-log.md) — ~17,225 lines and growing (Parts 1–578 as of 2026-09-02),
which is exactly why it was moved out. Consult it when you need the reasoning behind a
specific past decision; do not read it end-to-end.

---


## How to use this file

**Order matters.** Open work sits at the top, reference in the middle, everything
finished at the bottom. (Restructured Aug 31 2026 — done items moved to one
archive. Restructured again 2026-09-02 — the "Status snapshot" +
"Current status" coordination scratchpad collapsed into one dated Status
block, the old archive + older backlog + request batches moved to
`docs/history/`. Nothing was deleted, only moved — see that file's "What
moved where" table.)

| Section | What it is | When to read |
|---|---|---|
| [Status — 2026-09-02](#status--2026-09-02) | Where things stand right now: deployed state, locked decisions, pointer to full coordinator history | First, every session |
| [OPEN — the queue](#open--the-queue) | Every open item, organized, one line each | To pick up work |
| [Master plan — open items](#master-plan--aug-28-2026-part-370--the-authoritative-queue) | Full detail behind each queue item | When picking an item |
| [Verification findings](#verification-findings--aug-30-part-77-sweep--open-triaged-not-yet-fixed) | Open defects from the Part-77 sweep | Before correctness work |
| [Needs the user, not code](#needs-the-user-not-code) | Blocked on user/account actions | To unblock |
| [Open work — ORDERED](#open-work--ordered) | **Spec library** (§11–§16 + the locked execution plan) | When an item cites a §number |
| [Golden Rules](#golden-rules) → [Environment notes](#environment-notes) | Non-negotiables, standards, QA method, decisions | Every session, first |
| [`docs/history/progress-archive-2026-09-02.md`](docs/history/progress-archive-2026-09-02.md) | Everything finished, incl. the pre-Sep-2 older backlog and request batches | To check "already done?" |
| [`docs/history/coordinator-notes-2026-08-31-to-09-02.md`](docs/history/coordinator-notes-2026-08-31-to-09-02.md) | Raw Aug-31→Sep-1 lane-claim/hazard transcript | Only if you need the blow-by-blow behind the Status block |
| [`docs/history/session-log.md`](docs/history/session-log.md) | Per-session narrative, Parts 1–578 | Reasoning behind a specific past decision |

**Precedence, if two sections disagree:** [Status](#status--2026-09-02) and
[OPEN — the queue](#open--the-queue) are authoritative for "is this open,
and what's deployed" — trust them first. Everything below OPEN queue in the
table is **reference that OPEN queue points into, not a second queue**:
[Master plan](#master-plan--aug-28-2026-part-370--the-authoritative-queue)
is the full detail behind each OPEN-queue item (same IDs, e.g. `D2`, `K4`);
[Task board](#task-board--still-open-rows) and the old "Older backlog" are
folded — their still-open rows are already represented in OPEN queue /
Master plan, so don't treat a line there as a separate open item; [Open work
— ORDERED](#open-work--ordered) is a **spec library only** (its own header
says so) — read it when an item cites a `§`number, never pick work from it
directly.


**Ending a session**, do all three:

1. Append a `## Part N` entry to `docs/history/session-log.md` (N continues from the
   highest that exists — check first, numbers have collided before).
2. Move anything you finished out of the open sections and into
   [`docs/history/progress-archive-2026-09-02.md`](docs/history/progress-archive-2026-09-02.md),
   one line each (append to its "DONE — archive" section, following the
   existing per-phase structure).
3. Update the [Status](#status--2026-09-02) block below with anything materially
   changed (deploy state, a newly locked decision) — it is a snapshot, not a
   running log; keep it under ~80 lines by editing in place, not appending.

### Writing a session-log entry

Each entry states, in this order:

- **Ask** — what was actually requested, quoted where the wording matters.
- **What changed** — per file or per subsystem, with the *reason*, not just the edit.
- **What was found** — real bugs discovered along the way, with how they were confirmed.
- **Verified** — the exact commands run and their real results. See Golden Rule 5.
- **Not done** — everything still open. Never omit this section.

Two rules learned the hard way, both from real incidents in this file's own history:

- **Never record a fix as done without having run it.** Parts 334, 335 and the first
  Part 337 each recorded the same `0037` migration fix; it had still not landed when
  Part 338 checked. A claim in this file is not evidence.
- **Check the highest existing Part number before writing one.** Parts 335 and 337 each
  exist twice because two sessions numbered themselves without looking.

---

## Status — 2026-09-02

*Replaces the old "Status snapshot — Aug 31 2026" + "Current status" sections
(merged 2026-09-02, Section 9 hygiene pass). Full historical coordinator notes —
lane claims, hazards, Part-number collisions — are preserved verbatim in
[`docs/history/coordinator-notes-2026-08-31-to-09-02.md`](docs/history/coordinator-notes-2026-08-31-to-09-02.md).
Everything below is a claim to **re-verify**, not ground truth.*

**Deployed (reference, re-verify):** production is commit `d558dcfb`, Worker
version `30e8a9b3-ee79-4c57-b732-cd63c2dc2cd6` (Part 577, Aug 31 ~17:15 UTC) —
the Stage-1 security batch (products `/rename-brand` gate, offline-upload gate,
`/ws` session gate) plus the branch-transfer C1 FIFO fix. Verified live at
deploy time: both `/health` 200, `/ws` unauth 426, admin root 200. All
migrations up to that deploy applied to remote D1 (main + the newer
`business-os-import` D1); none reported pending.

**NOT yet deployed (committed on top, Stage-1, Sep 1 — do not assume live):**
UTC+7 business-day bucketing (`efcf21e3`) and the canonical net-sales revenue
reconciliation (`9354f1ce`) — see the two locked decisions below; cashier-identity
reconciliation (`1378e07a` + `69673fbc`); contact-merge data-movement repoints
(`1655ea1e` + follow-ups `6e73b8b8`, `30210c86`, `5767a532`); Google-Drive
OAuth-url bugfix (`3820a971`); the D1-bloat / R2-lifecycle import-staging split
(Part 574/575 — code complete, needs deploy + one real test import to confirm
end to end); the date/time UX unification lane (Part 578 recovery). **The
deploy driver holds all deploy/migrate/secrets actions — no RC worktree
deploys, migrates against remote D1, or runs wrangler against shared state**
(binding per `docs/plans/coordinated-plan-2026-09-02.md` §0).

**Two locked decisions (user, Sep 1 — do not re-litigate; full spec in memory
`canonical-revenue-definition`):**
1. **Business day = fixed UTC+7**, ignoring viewer `tzOffsetMinutes`, for every
   date-bucketed query (sales, returns, inventory movements, audit log,
   dashboard). "The timezone and data are all Phnom Penh time."
2. **Canonical revenue = "Net sales"**: for sales not `cancelled`/
   `awaiting_payment`, `SUM(subtotal_usd − store_discount_usd −
   membership_discount_usd) − customer refunds`. Excludes tax + delivery fee.
   `awaiting_payment` is separate `pending_revenue_usd`. Secondary
   `collected_total_usd = revenue + tax + delivery`. The Sales-page `/stats`
   header and the Reports analytics kernel (`salesAnalytics.ts`) must both use
   this SAME definition — they were reconciled to it Sep 1 (commit `9354f1ce`),
   not deployed yet.

**Open at the top level:** see [OPEN — the queue](#open--the-queue) for the
full list, one line per item, IDs matching the [Master
plan](#master-plan--aug-28-2026-part-370--the-authoritative-queue) detail.
Headline items: A2 (live-verification checklist remainder), A3 (Google Drive
connect, now actionable post-deploy), the D2/D3 product-detail + date-scope
remainder, K1/K4/K6/K7 engineering backlog, N1b/N1c/N3/N3a import + section-UI
work, Y16 button placement, Z1/Z5/Z6/Z7 polish. `docs/history/session-log.md`
highest Part = 578.

**This isolated release-candidate effort (Sep 2 2026):** a coordinator plus
section workers are running in git worktrees under `rc/coordinated-2026-09-02`
/ `rc/sec-<n>-*`, working toward one certified RC without touching
`origin/main` or this main checkout — see
[`docs/plans/coordinated-plan-2026-09-02.md`](docs/plans/coordinated-plan-2026-09-02.md).
**Running multiple sessions on this checkout?** Invoke the
**`/fleet-coordination`** skill for session roles, conflict-prevention on the
shared git index, the staged commit→push→deploy cycle, and the ≤300K
compaction rule.

**Where finished work lives:** everything closed before 2026-09-02 is in
[`docs/history/progress-archive-2026-09-02.md`](docs/history/progress-archive-2026-09-02.md)
(the old DONE archive + older backlog + request batches) and
[`docs/history/session-log.md`](docs/history/session-log.md) (per-session
narrative, Parts 1–578). Nothing was deleted in the 2026-09-02 restructure —
only moved; see the archive file's "What moved where" table.

## OPEN — the queue

One line per open item; the full text lives in the master-plan phases below (same
IDs) or the section linked. Statuses: **[~]** = in progress / partly done,
**[ ]** = not started.

### Now / gate

- ~~**Deploy**~~ — **DONE, latest Aug 31 (Part 577): production is `d558dcfb` / Worker
  version `30e8a9b3-…`** (supersedes the Part-538 deploy this line originally recorded);
  see [Status](#status--2026-09-02) for what has landed on top since and is NOT yet
  deployed, and `docs/history/coordinator-notes-2026-08-31-to-09-02.md` for the full
  deploy-record narrative.
- [~] **A2** — live-verification checklist. Done read-only at deploy time (/health ×2,
  storefront 200, /api/products 401-gate, portal bootstrap 200, migrations list
  empty). REMAINING (user-facing writes): reset-data, a POS sale with lots confirming
  bare `YYYYMMDD-HHMMSS` receipt ids (no RCP — Part 540) + Phnom Penh labels,
  storefront iPhone install,
  import round-trip, R2 keeps exactly 2 finalized sets.
- [ ] **A3 follow-through** — connect Google Drive in Settings → Backup (now possible
  post-deploy), then confirm backup files actually appear in Drive.
- [x] **M-audit (Aug-30 legacy reports)** — **DONE Aug 31 (Part 551, session 1e).**
  Independent source-vs-production reconciliation of the `27th-30th` report pack:
  all 14,939 receipt signatures + dates exact, 79/79 supplemental lines exact,
  stock 23,115 on all three ledgers with 0 mismatches/negatives/FK errors, AP /
  deleted / transfers / fees all equal source. Importer fixed (`aa66334b`:
  archive-folder paths, zero-insensitive phone links, driver only on delivery);
  two 1-row production corrections (4362 customer link, 4361 driver unlink).
  ~~Open for user: ambiguous name-links 4353/4370; 8 optional new contacts.~~
  **→ resolved into the app (Part 555, session 1e, needs deploy):** the
  duplicates surfaces are renamed **Conflicts** (Contacts tab + Products
  section chip, both packs) and the Contacts Conflicts tab gained a
  **Sale links** section listing exactly these issues live — phone-mismatch
  links (4353/4370 appear there with a suggested relink) and
  missing-contact sales (the 8 optional customers + historical unlinked
  groups) with Relink / Create-and-link / Link-to-existing / dismiss
  actions. Conflicts sections are the standing home for future
  data-quality issue types.
  **Follow-through DONE (Part 552, session 1e, needs deploy):** both stored-but-
  invisible ledgers now have read-only screens — **Supplier AP Invoices** on
  Contacts → Suppliers (contacts_suppliers gate) and **Deleted sales (old
  system)** as the third Review & Logs chip (audit_log gate); live-E2E'd on an
  isolated worker incl. 403/401 gate probes. *Peer note: `test:utils` fails at
  clean HEAD in performanceLoadingUx.test.ts ("sales active filter count should
  reuse countActiveFlags") — the pattern left Sales.tsx in `a0b2edbf` (Part 549,
  sales-hub lane); attributed by git-show, left for that lane to reconcile.*

### In progress / partly done

- [x] **A4a** — Paid-plan re-basing (cpu_ms + queue batch size) — SHIPPED with the
  Aug-31 deploy.
- [~] **B1** — stats polish remainder: verify no old tooltip call sites remain, 5.3
  detail-panel responsiveness, 5.4 metric symmetry. *(Re-check against StatsStrip v2,
  Parts 516/526 — likely partly overtaken.)*
- [~] **D2(b)** — page-level Date-scope row below the search row on Products AND
  Inventory, with the Filter button moved onto it.
- [~] **D3** — product detail remainder: in-detail movement filters, full
  Date/Type/Batch/Qty/Balance/Reference table, receipt-# references, product search by
  supplier/batch.
- [~] **D5a** — supplier read-surface remainder: per-supplier totals in the product
  detail (foundation + pickers shipped).
- [~] **F3** — drafts slice 2: ✕/− tab chrome (minimize to a top-bar chip, restore
  anywhere).
- [~] **K1** — server undo/redo: create/delete reversal (row-id remapping) + the other
  action_history scopes (contacts, inventory, files, lookups…).
- [~] **K4** — R2 NDJSON staging for LIVE jobs, Sentry wiring beyond reportError,
  execution-plan phases 4–6 leftovers.
- [~] **K6** — permissions: preset bundle UX in the editor + guarantee-by-test that
  image-only tiers never touch POS/sales (view rows already shipped).
- [~] **K7** — measured performance pass, portal §6 leftovers, 10.2 (task board records
  it fixed in Part 394 — reconcile before working), 11.17 (needs the user to point at
  the too-wide input).
- [~] **M6** — deferred old-system ledgers: stock_adjustments (930), drawer_sessions
  (755), po_invoices (3,204); stock_in_invoice_lines stays an audit/backfill source.
- [~] **N3a** — SectionCard: palette confirmation with the user, then the page-by-page
  sweep + literal-label cleanup.
- [~] **P7-f** — inventory-ADD import lacks supplier/payment_status columns (kernel
  parity; deliberately deferred until after the M-phase migration imports).
- [~] **Y4** — print/reprint view scroll (not a hub surface; reproduce separately).
- [~] **Y16** — History + Manage buttons join the section-chip row on Sales, Branches,
  Contacts, Settings, Library, Review & Logs *(claimed by session a8 Aug 29 — check
  staleness before picking up)*.
- [~] **Z1(b)** — the products-import default path writes branch_stock without lot rows
  (the drift class 0079/0081 reconciled); needs the import-path decision.
- [~] **Z5** — currency-symbol contrast sweep; "Receipt Settings merged INTO the
  Settings page" stays its own unit.
- [~] **Z6** — verify the OTP enable/validation flow end to end once deployed.
- [~] **Z7** — tighten stats↔branch-list vertical spacing on the Branches hub.
- [~] **Umbrella-goal remainder** — media policy, storage/jobs hardening, final gate —
  see [the umbrella checklist](#active-umbrella-goal--aug-27-2026) in the spec library.

### Not started

- [ ] **N1b** — import-options wizard: surface more per-job calculation choices
  (discounts, notifications, duplicate policy) through the existing policy mechanism.
- [ ] **N1c** — one-entry-point / one-file-or-many import contract (multi-file Screen 1
  shipped as Part 402; the remaining contract items live in the item text).
- [ ] **N3** — colored SectionCard rows page-by-page, app-wide (after N3a's palette
  confirmation).
- [ ] **Fast loading / perf** — the task board's measured pass; same work as K7.

### Flagged for future sessions — Part 559 (filter-chips session, Aug 31)

Found while removing the FilterMenu outside-the-menu chips (Part 559, commit
`a04dd099`). Both are OUTSIDE that lane and were left for their owning sessions —
recorded here so they don't rot:

- **Stale test, RED at committed HEAD (needs a one-line fix).**
  `frontend/tests/performanceLoadingUx.test.ts` (~line 1568) asserts the sales
  active-filter-count regex
  `countActiveFlags([statusFilter !== 'all' ... salesGroupMode !== 'time'])`, but
  `frontend/src/components/sales/Sales.tsx:1160` no longer has the
  `salesGroupMode !== 'time'` flag — its own comment says "the count now covers
  only true filters". So `node --test tests/performanceLoadingUx.test.ts` fails
  at HEAD, independent of any working-tree edit. Fix: update the regex to the
  current four-flag call (status · user · date-range · sort-not-default). A
  background task chip was also raised for this.
- **Caution — the shared working tree keeps passing through non-compiling
  intermediate states.** During Part 559, `npx tsc --noEmit` over the whole
  `frontend/` tree was red at different moments in different peer lanes: first
  `users/PermissionEditor.tsx` + `AppContext.tsx` (`TS2345: "view" not
  assignable to PermissionTierValue`), later `shared/StatsStrip.tsx` mid-refactor
  (`DateTimeRangePicker`/`PRESETS`/`DateTimeRange` not yet defined). These are
  in-flight lanes, not defects. Lesson for any session here: run `tsc` scoped to
  your OWN files, judge your work by those, and never `git add -A` / "commit
  everything" — you would sweep another lane's half-written, non-compiling code
  onto `main`. Path-scoped adds only.

### Open defects — Part-77 verification sweep

Full detail in [Verification findings](#verification-findings--aug-30-part-77-sweep--open-triaged-not-yet-fixed):
restore slice C (maintenance lock / resumable restore) · returns cross-step atomicity
class · unpaged reads/N+1 + `date(created_at)` on 36 sites + movements-search REPLACE
chain · receipt/date locale duplicates (main date fixed Part 519) · MEDIUM list
(review-tier bypasses, offline-sale timestamps, import-review parity, failed-job
"Queued 0%", Suppliers/Delivery sort/pagination).

### Open defects — Part-549 verification sweep (7a, Aug 31)

Full detail + file:line evidence in session-log Part 549. Fixed in-sweep:
portalAi raw-stock leak (`da7dd0b7`), 2 HEAD-red suites (`28b45f94`), phantom
BACKUP_TABLES (`3a0a7cb2`). Still open:

- **HIGH (money UX):** mouse-wheel over a focused number input silently changes
  the value — reproduced live in POS (payment $20→$19 while scrolling the
  panel). Class fix: blur-on-wheel (or wheel preventDefault) on the shared
  number inputs; POS payment/discount fields first.
- **HIGH (layering):** InfoHint portals at z-[1000] but shared Modal is
  z-[1050] — every InfoHint inside any Modal renders its tooltip BEHIND the
  modal (ImportModeWizard, ExportFieldsModal, StockChangeSection, Branches,
  Products, ProductDuplicatesTab). One-line fix candidate: InfoHint → z-[1055].
- **MEDIUM (layering):** RenameCascadeModal (z-60) + InventoryReasonManagerModal
  (z-50) open BURIED under their own shared-Modal hosts; tracker/notes/
  notification family (z-1000..1010) still floats over every non-shared-Modal
  dialog (Part 547 fixed Import Hub only — ~19 inline `fixed inset-0` overlays
  remain, enumerated in Part 549); Sidebar.tsx:498 mobile account-menu backdrop
  is inside the transformed header (covers only the header strip).
- **MEDIUM (dates):** viewer-locale/timezone survivors: App.tsx:1253 sync
  banner; Branches.tsx:270, Backup.tsx:708, AuditLog.tsx:164/184,
  inventoryExport.ts:119 (no timeZone pin); recordFilters.ts:59 UTC-midnight
  day-shift; bare-number `.toLocaleString()` digit grouping incl. printed
  receipts (EU machines render 4.100).
- **MEDIUM (perf):** 7 non-sargable `date(created_at)` WHERE sites survive
  (returns.ts:492 reports; sales.ts:1758/1774 stats-strip — c8's file;
  audit-log retention ×3); `audit_logs` has NO indexes at all.
- **LOW:** POS touch targets under 40px (new-order 24px, split-payment remove
  28px; InfoHint trigger 20px app-wide); 10 unguarded fetch-then-setState
  sites (DeviceApprovals worst) + 6 uncleaned timers; 65
  window.confirm/prompt/alert sites vs styled-modal house rule; contact
  bulk-import transports call a removed route (latent 404, legacy window.api
  only); AppBootstrapPayload declares 2 never-sent fields.
- **Zombie-lane feed:** ~28 uncalled backend routes + 4 compat import-jobs
  routes shadowed by the real router + portal_password_resets table (flow
  never built) + RFID stub tables — enumerated in Part 549 for the existing
  dedicated zombie session.

### Open defects — Part-539 verification sweep (c8, Aug 31)

Full detail + live expected-vs-actual probes in session-log Part 539; fixes in
Part 543:

- ~~**HIGH (money)**~~ **[FIXED: c8, Part 543, `c5fa79aa`, needs deploy]** —
  `change_khr` now converts the EXACT overpay at the server-read
  change_exchange_rate on BOTH write paths (create + deferred-payment settle);
  live probe stores 8,820៛ == the POS display (was 9,061). Pure test 19/19
  incl. a frontend-twin parity lock. STILL OPEN (data-model decision): the
  resolved change rate isn't stamped on the sale row.
- ~~**MEDIUM (POS)**~~ **[FIXED: c8, Part 543, `9c9c9424`, needs deploy]** —
  the sheet now preselects the SAME branch the card badge resolved; verified
  live (lot picker queries the default branch, checkout books it).
- ~~**MEDIUM (settings)**~~ **[ROOT-CAUSED + FIXED: c8, Part 543, `1abe9fec`,
  needs deploy]** — not a hydration bug: `applyBootstrapPayload` wiped live
  context settings whenever a fallback bootstrap (offline / invalid-session /
  auth-recovery) delivered `settings:{}`. Now keeps current settings when the
  payload brought none (loadSettings' own guard, applied here too).
- **LOW:** POS needs a reload to pick up settings changes; storefront signup's
  blank-membership reminder is a native `window.confirm` (silently aborts in
  embedded/webview contexts; house style is styled modals); ~~React key warning
  in CatalogProductsSection~~ **[FIXED in-tree by c8 — keyed Fragment on the
  product map; riding as a NAMED ride-along in the active catalog lane's next
  commit (hunks at lines 1/691/852)]**; `aiProviderId` internal id in public
  portal /config; membership-existence oracle on POST /portal/submissions
  (404 vs success, rate-limited).
- **Zombie/orphan cleanup lane (Golden Rule 6, needs one dedicated session):**
  custom-tables cluster (unmounted route + unimported component + transport),
  DatedStockReconciliationModal chain (+ BulkImportModal's dead "choose Dated
  Reconciliation" button), `lib/businessMetrics.ts`, `__lightbox_test_entry.tsx`,
  `utils/index.ts` barrel, PublicCatalogPage dead membership machinery (props
  threaded into CatalogSecondaryTabs that no section consumes); duplicates:
  users.ts normalizePhoneLookup, 3× escapeHtml, localDb.ts dead CSV exports.
  Removals must retire the tests pinning them (datedStockReconciliationModal,
  productReplaceImportPlan noted test-only since Part 319).

### Flagged, not guessed / needs a decision

- Commission/service fields for sales import/export still have no business rule.
- H1's exact per-page export option lists want confirming against real usage.
- Production portal settings still carry "Leang Cosmetics" in four user-editable
  fields (see [Flagged, not guessed](#flagged-not-guessed-golden-rule-7)).
- `redeemValueKhrStep` ceil-to-1000 (Part 529): denominations rule or bug? (user call)

### Deferred by request

See the [deferred table](#task-board--still-open-rows) — the Canva-like promotions
template editor. *(Public customer accounts left this list — built as Part 535.)*

---


## Master plan — Aug 28 2026 (Part 370) — THE authoritative queue

> **This section supersedes `## Open work — ORDERED` and the task-board tables as the
> queue.** Those sections stay because they carry the specs (§11/§12/§13/§14/§15 and
> the locked execution plan) that the items below reference by number — read the spec
> when picking up an item; read THIS list to know what is open and in what order.
> Statuses: `[ ]` not started · `[~]` in progress / partly done · `[x]` done in code
> (deploy status noted per item). Rebuilt from the user's Aug 28 request batch plus
> every still-open item in the older sections.

> **Aug 31 restructure:** completed items were moved to
> [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive); only open items remain below.

### Phase A — Deploy, domain and live verification

- [ ] A2. Live-verify the deploy checklist: reset-data, /api/products, POS sale with lots,
  storefront iPhone install (delete old shortcut first), import round-trip, R2 keeps
  exactly 2 finalized sets. *(Added Aug 30, Part 519 / session 0b via coordinator:)*
  make one POS sale and confirm live — receipt id is the bare `YYYYMMDD-HHMMSS`
  (no RCP prefix — user, Aug 31, Part 540) Phnom Penh
  wall clock, printed receipt date is mm/dd/yyyy 24-hour, and every timezone label
  reads Phnom Penh (never Bangkok).

- [~] A4a. **First Paid-plan re-basing applied (Part 376, needs deploy):**
  `[limits] cpu_ms = 300000` restored (the block wrangler.toml itself said to re-add on
  Paid — it was removed only because Free rejected it with error 100328), and the import
  queue consumer's `max_batch_size` returned 1 → 5, the exact condition its comment set.
  `wrangler deploy --dry-run` validates. The M4 continuation-dispatch engine remains the
  big remaining Paid unlock (see M4).

### Phase M — Old-system data migration (files received Aug 28; analysis done)

*The user is leaving the old POS. Nine spreadsheets received; reconciliation ran Aug 28
(Part 371) — normalized outputs + README in `Downloads/businessos-migration-aug28/`.
Rules (also in assistant memory): the two `products-template-*` files are AUTHORITATIVE
for name/barcode/price/brand/category — old-system exports never overwrite them; naming
is `before_qty / stock_in / stock_out / after_qty`; customers match by PHONE then NAME
against the de-duplicated current contacts; historical sales never accrue loyalty;
barcodes stay text (no scientific notation), Khmer never becomes `?`, no Excel
autocorrect — templates, imports, exports and generated files alike.*

- [~] M6. **Expenses are complete; the unsupported ledgers remain deliberately
  deferred.** Migration 0064 loaded all 4,240 expenses into Fees (USD 129,696.60 +
  KHR 82,419,900). `stock_adjustments.csv` (930) still waits for the stock-change
  ledger, `drawer_sessions.csv` (755) for cash-session import, and `po_invoices.csv`
  (3,204) for supplier accounting. `stock_in_invoice_lines.csv` (7,340) is already
  joined into the stock history where attributable and must not be imported again as
  stock; it remains the audit/backfill source for a future supplier-invoice ledger.

### Phase B — Stats/tooltips finish + small confirmed UI corrections

- [~] B1. (11.26/5.1–5.3) Same-row stat label + info, portaled viewport-aware tooltip.
  **5.3 landed (Part 414, session a7):** the click-to-view panels were
  inline position:fixed overlays anchoring to transformed ancestors, not
  the viewport — 16 of them now portal to document.body like Modal/
  InfoHint (Dashboard×3, InventoryStatDetailModal, TransferModal,
  SaleDetailModal, CancelSaleModal, ImageGalleryLightbox,
  RenameCascadeModal, 4 free inventory modals; returns/* ride 6e's K2
  commit by agreement). Measured before/after at 375×812. Remaining
  non-portaled overlays are enumerated in the Part-414 log entry — same
  three-line pattern, most in peers' active lanes (POS, products
  surfaces, settings-area, 4a's stock modals).
  **5.4 landed (Part 413, with E1):** one rule decided per the item's
  mandate — each derived metric is card-visible only on its home page:
  Gross Profit card stays Dashboard-only (drill-row on Inventory), Net
  Sold's home is Inventory where it now reads on the Returns card's sub
  line at card level (no new tiles, consistent with 5.6's slimming).
  **Dashboard `MiniStat`, Branches, Inventory, Returns landed this session (Part 370):**
  hint and drill-down are separate controls (a `role="button"` wrapper would re-fire the
  drill-down from the hint's keyboard events), tooltip height uses the real space above/
  below the trigger, panel is scrollable on touch. **Open:** sweep every remaining stats
  page for the old pattern (no `InfoHint className="absolute…"` call sites remain — verify
  visually), then the click-to-view detail panels' responsiveness (5.3), then 5.4's
  Dashboard-vs-Inventory metric symmetry.

### Phase C — Delivery: customer charge vs internal actual cost (11.27, full)

*The revenue-truth feature. Charge stays what the customer sees; actual cost is what the
store really paid the rider; margin = charge − cost and is internal only.*

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase D — Products data model: stock-change ledger, batches, suppliers

- [~] D2 *(Part 420, session a7: the LEDGER's filter row shipped — branch
  (AppSelect), inclusive date range, action type (the view chips), all
  server-side on /stock-ledger which took these params from day one.
  **(a) CLOSED, Part 510, session d2lot (needs deploy):** migration 0084
  `inventory_movements.batch_id` + stamping in every writer where ONE lot
  truthfully covers the whole movement; the ledger now joins the lot and
  filters by supplier (id-attributed OR name-only lots, D1b identity
  rule) with unattributed rows honestly excluded, and the StockChange
  filter row carries the supplier select. REMAINING: (b) the page-level
  Date-scope row below the search row on Products AND Inventory with the
  Filter button moved onto it — Inventory.tsx hot with 9d's F2 at the time.)*
  Filters grow: by supplier, by date range (the new date row), by action type,
  by branch. **Date-scope row** sits directly below the search row on Products AND
  Inventory, with the Filter button moved onto it.
  **[Sep-2 hygiene-pass note, not independently verified]:** session-log Parts
  561 and 564 (Aug 31) excised Inventory.tsx's entire dormant products-list
  slice — the section no longer has a search row or a product list to put a
  date row below. `docs/history/session-log.md` Part 561's own "Not done" also
  flags this exact remainder as an open board item. Re-verify against current
  Inventory.tsx before starting (b); it may now apply to Products only, or be
  moot pending Section 3 of `docs/plans/coordinated-plan-2026-09-02.md`
  (restoring Branches → Inventory as a product-stock workspace).

- [~] D3 *(first full slice SHIPPED, Part 422, session a7: the detail modal gained four folded N3 SectionCards -- Batches (per-lot totals across branches + received/expiry + supplier), Suppliers (D1b identity rule, honest lots_without_cost), Sales (kernel per-day/month via whereActiveSales), Stock Changes (D1 ledger scoped to the product -- running balance, never disagrees with the page ledger). One new read /products/:id/detail-report + kernel getProductSalesBreakdown. **Batch attribution LANDED (Part 510, session d2lot):** the movement list now shows each attributable row's lot chip via movements.batch_id (0084) -- the D2 linkage gap is closed, blank only where no single lot truthfully owns the row. STILL OPEN here: in-detail movement filters + the full Date/Type/Batch/Qty/Balance/Reference table layout, receipt-# references, and product-search-by-supplier/batch (search-engine unit).)* **[CLAIMED: session a7]** (the drill half shipped with D1/Part 415;
  this claim = the full user detail-page spec below. Footprint:
  products/surfaces/ProductDetailModal.tsx + new folded sections +
  salesAnalytics kernel gains the per-product breakdown + one new
  /products/:id/detail-report read. The movement table's Batch column will
  be blank-honest until the movements.batch_id migration lands — same
  linkage gap D2 documented.)
  Product "click to view details" absorbs Inventory's stock-movement detail, so
  the product detail is the one place with: info, batches (§14 modal), movements,
  supplier section. Inventory's product list then repurposes/thins accordingly (see F1).
  **Detail-page spec (user, Aug 28):** header = name + barcode + total current stock
  (sum of batches) with click-to-view opening the batch details; a batch summary card
  (each lot: current qty + received/expiry dates **+ its supplier** — D5); a movement
  history table filterable by date range / movement type / batch with columns Date ·
  Type · Batch · Quantity · **Running Balance** · Reference (receipt #, adjustment #,
  import job); a sales breakdown (total sold per day/month); and a Supplier section
  listing every distinct supplier the product was bought from with per-supplier totals.
  All of it SEARCHABLE — within the detail, and product search can filter by supplier/
  batch attributes. The templates are a SNAPSHOT (final quantity only — clarified in
  the migration pack README); this page is where the real history becomes visible once
  M4/M6 load it. Sections here render through N3's SectionCard.
  **[Sep-2 hygiene-pass note, not independently verified]:** session-log Part
  564 (Aug 31, "products-slice-excision lane") added paginated ("Load more")
  movement history to the product detail's Stock Changes float as part of the
  same Inventory excision noted under D2 above. Re-verify against current
  `ProductDetailModal.tsx` whether the full Date/Type/Batch/Qty/Balance/
  Reference column layout and in-detail filters are now met before
  re-implementing them from scratch.

- [~] D5a. **Supplier-on-batch foundation is BUILT (Part 377, needs deploy).**
  Migration 0062: `product_batches.supplier_id/supplier_name`. §12 template accepts an
  optional 11th `supplier` column (ten-column files unchanged; vendor/suppliername
  aliases); the apply engine matches names against the suppliers table (match-only,
  never auto-creates) and the atomic ADD writer stores it on batch creation — a lot's
  first attribution sticks, later adds never rewrite it, a blank changes nothing
  (all test-proven). **The manual add-stock/receive UI supplier picker SHIPPED
  (Part 409, session 4a — 2e5dd7e5, needs deploy).** One shared
  `SupplierPickerField` (suggestions from the permission-free
  `/api/suppliers?fields=names` read; picking links id+name, free text stays the
  deliberate name-only attribution, never auto-creates) on ALL FOUR manual add
  surfaces: ReceiveBatchModal (its free-text field upgraded; supplierId joins the
  draft), Inventory's Adjust modal, BranchStockAdjuster's per-branch rows,
  BulkAddStockModal (one supplier for the whole bulk event, fill-not-rewrite
  note). First-attribution-sticks is VISIBLE, not silent: an attributed lot locks
  the field to its recorded supplier and the wire sends nothing; an unattributed
  existing lot still offers the picker because a choice there FILLS the blank
  (receiveBatchStock's COALESCE honors it). routes/inventory.ts /adjust gains the
  camelCase supplierId/supplierName passthrough (remove ignores them); the
  batches list SELECT + `ProductBatch` type now carry supplier_id/supplier_name
  so pickers can tell locked from fill (name-only rule: same visibility K6
  already grants). 8-check backend pure test on real migrations (both wires:
  create sets, attributed top-up sticks, unattributed top-up fills, auto-routed
  bulk wire attributes, remove ignores, GET carries fields); 9-check frontend
  pin test whose first check IS the cross-surface law (all four surfaces import
  the one picker); live-verified on wrangler dev (lot 9103 attributed end to
  end). **Remaining:** the read surfaces below (D3 supplier section,
  per-supplier totals).

### Phase E — Information architecture: fewer, deeper pages

*Primarily rewiring. Clarified Aug 28: polish and logic improvements ARE allowed along
the way — but only where they improve the product without disturbing any calculation's
results; every number shown before/after a move must come from the same shared kernel
(single-source rule), and consistency across pages is part of done. Keep internal page
ids + permission keys STABLE (the permission model, `canAccessPage`, and audit
references key off them); the sidebar shrinks and the moved pages become sections with
deep-linkable tabs.*

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase F — Add/create flows: wizard, fast batch entry, drafts

- [~] F3 **[session 6e — Part 424. SLICE 1 SHIPPED: extract
  Part-388's ProductForm localStorage-draft pattern into ONE shared
  utils/workDrafts.ts and wire FastStockInModal (batch-in header + the
  in-progress line survive reload; the received log is already server
  truth) with ProductForm re-based onto the shared store unchanged in
  behavior. Slice 2: the ✕/− tab chrome — minimize parks the flow as a
  top-bar chip (draft store + N2's dirtyWork registry behind it),
  restore reopens it anywhere. Footprint: new util + ProductForm +
  FastStockInModal + the top-bar host; coordinated before touching any
  shell file a peer holds.]** **Draft persistence + tab chrome:** unfinished add-product / batch-in / detail
  tabs survive navigation and reload (persisted drafts); each tab gets ✕ (close) and −
  (minimize to a top-bar icon). One draft store, used by all three flows.

### Phase G — Promotions + public portal

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase N — Import options + navigation guard + section UI (user, Aug 28 third batch)

- [ ] N1b. **The wider import-options wizard** (user spec, Aug 28): before an import
  commits, the operator can choose calculation options (loyalty above; later: discount
  application, notification sending, overwrite-vs-skip duplicates) and see them recorded
  per job. Notes against the existing system: the two-screen analyze→review flow IS
  already the requested "dry run" (analysis writes nothing; Confirm is the commit gate),
  duplicate handling already exists per import type, and each job already persists its
  `policy` — so this is about surfacing MORE choices through the same policy mechanism,
  not new machinery. Add options only where a real calculation exists to gate.

- [ ] N1c. **One place or many, one file or many (user, Aug 28).** The import surface
  must take the messy real shape of the data: EITHER one combined sheet OR separate
  files per aspect (catalog, stock-in with its many batches, adjustments, period
  summaries, sales) — uploaded together or over multiple sessions — and everything
  lands in the same engines with the same review gates. Concretely: (a) one Import
  entry point that routes by detected template rather than forcing the user to know
  which page owns which file; (b) multi-file selection in Screen 1 queued as sibling
  jobs sharing one review session; (c) the §12 template's optional `supplier` column
  (D5) and the M4 continuation dispatch so volume is never the reason to split a file.
  Builds on §13's two-screen contract — no new commit paths.

- [~] N3a. **SectionCard is BUILT and debuted (Part 377, needs deploy).** One shared
  component + ONE kind→color map (`shared/SectionCard.tsx`: search blue, catalog green,
  stock orange, batches amber, suppliers purple, sales red, reports teal — change it
  there and every page follows). Color chip + title + fold chevron with the actions as
  SEPARATE controls; fold state persists per user; an `onBack` slot so every drill-down
  level has a back button. Debuts: Products' sticky search row is the foldable
  "Search & Filters" section (folding reclaims list space; the select-all toolbar
  deliberately stays outside), and the Manage Batches day view renders through it.
  **Batch dates (user, Aug 28) shipped with it:** batches show the received DATE only
  in everyday use; selecting the date drills into that day's movements with each
  entry's clock TIME where recorded — imported history carries the date only and the
  view says so instead of faking midnight; Back returns to the list. **Glossary rule
  now in force:** the canonical en/km keys already agree with the user's pairs
  (stock_in = ស្តុកចូល, stock_out = ស្តុកចេញ, adjustment = ការកែប្រែ…) — every new
  surface must label through these keys, never fresh literals; six missing keys added
  and both packs re-sorted. **Remaining:** palette confirmation with the user, then the
  page-by-page sweep (+ the literal-label cleanup in existing surfaces).

- [ ] N3. **Section UI: colored card rows WITHIN pages — clarified Aug 28 (supersedes
  the per-page palette reading).** The colors identify the SECTIONS inside a page, not
  the pages: e.g. on Products, the search/filter block, the stock-change ledger, the
  batches area and the supplier section each get their own colored card-row header so a
  long page reads as distinct, obvious blocks. Requirements from the user: clear AND
  detailed AND responsive — sections are collapsible ("fold in buttons": a section's
  actions fold behind its header on small widths, expand on wide screens), headers stay
  smart/compact, and the SAME section kind uses the SAME color on every page (search =
  one color everywhere, stock movements = another…) so color becomes meaning, not
  decoration. Build: one shared `SectionCard` (header row = color chip + title +
  fold/expand + folded action buttons; body = content) driven by `--section-color`
  tokens per section KIND, fold state persisted per user. Apply page by page starting
  with Products (D1/D2) and the Phase E merged pages. Final palette still gets user
  confirmation before the app-wide pass.

### Phase H — Exports/imports everywhere

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase I — Audit log wraps the whole app

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase J — Sessions & devices

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase K — Carried-over engineering backlog (unchanged priorities)

- [~] K1. Server-level undo/redo (3.1) — appliers replay stored payloads; admin sees all,
  users see their own. **First slice SHIPPED (session business-os-v1-17,
  needs deploy — `ef5f5e40`).** The store always held undo/redo payloads but the
  CLIENT replayed them from a live closure, so reversibility died on reload
  (utils/actionHistory.ts's own comment: a generic closure can't be serialized).
  Added the server-replay path, ADDITIVELY: `lib/undoAppliers.ts` (registry + a
  `branch.update` applier) — a payload naming a registered applier is replayed by
  the Worker (response `applied:true`); any payload without one behaves exactly as
  before. `lib/branchWrites.ts` holds the branch field-write SQL now shared by the
  PUT route AND the applier (one definition, source-locked by test).
  `routes/actionHistory.ts` runs the applier before the status flip (a failed
  applier stays reversible/retryable). `utils/actionHistory.ts` gained an optional
  refresh-only callback: on `applied:true` the hook refreshes instead of re-running
  the mutating closure (no redundant/conflicting second write). Branches' edit
  emits the payloads + refresh, so a live branch edit's undo now goes through the
  server end to end. `test-undo-appliers-pure` 6 checks; both tsc + vite build
  green. **Slice 2 SHIPPED (session b9, Aug 30, Part 507 — `b63e6c67`, needs
  deploy):** reloaded server rows whose payload names a registered applier now
  render REAL Undo/Redo buttons in ActionHistoryBar instead of the inert
  "Recorded" label — GET stamps `server_replayable` (new shared
  `isServerReplayable` helper), the hook's `undoServer`/`redoServer` send
  `require_applied`, and the route refuses BEFORE any status flip when no
  applier is registered, so a reversal is never recorded that didn't happen.
  Live closures keep their exact prior contract. Pure test 6→8 checks.
  **Still open:** create/delete reversal (row-id remapping across the
  cycle) and the other action_history scopes (contacts,
  inventory, files, lookups…) — each lands as its consumer emits a declarative
  payload, all peer-hot, so coordinate per scope.

- [~] K4. Storage/jobs hardening phases 1–6 of the locked execution plan (leases, R2
  NDJSON staging, D1 slimming — the 193MB staging JSON), safeguards, Sentry wiring.
  **Phase-1 slice SHIPPED (Part 508, session k4s, needs deploy — migration 0085):**
  scheduled import-artifact retention per the locked plan (24h detail / 7d summary,
  settings-overridable, bounded per tick, terminal jobs only, auto-merge evidence
  + Library-linked files exempt) — the standing policy that drains the ~193MB of
  D1 staging; deleteJobData now shares ONE delete list with the sweep (fixing the
  per-job-delete orphan leak) and /retry 409s on a pruned job; the three unbounded
  Promise.all R2 sweeps A4 flagged are chunked bulk deletes (≤1000 keys = 1
  subrequest) with failures reported, plus POST /api/system/import-retention/orphans
  (dry-run by default; force required to delete — take a backup first). Leases/
  states/cancel were ALREADY built (verified in importEngine.ts, not re-done).
  **Still open:** R2 NDJSON staging for LIVE jobs (write-time, not just deletion),
  Sentry wiring beyond client-error/reportError, phases 4–6 leftovers.
  **[Sep-2 hygiene-pass note, not independently verified]:** session-log Parts
  574 and 575 (Aug 31, "D1-bloat + R2-backup-lifecycle lane") found the actual
  D1-bloat source was import-staging tables, not this write path, and shipped
  a different fix — isolating `import_job_rows`/`import_job_source_rows` into
  a second D1 (`business-os-import`, `db.staging`) rather than R2 NDJSON —
  code complete, needs deploy + one real test import to confirm end to end.
  This may fully or partly retire the "R2 NDJSON staging" ask above; re-verify
  against Part 574/575 before building it as originally spec'd.

- [~] K7. Performance pass (measured), portal §6 leftovers, Library details (8.1
  **[8.1 SHIPPED — Part 418, session 6e: clicking a Library image opens
  DETAILS — full preview + named usage (product covers with barcode,
  gallery rows with position, avatars, settings keys), and a Full-Access
  rewire flow: pick another library image, every product/gallery/avatar
  reference repoints in one atomic batch (duplicate-gallery-safe,
  image-to-image only, settings deliberately skipped — branding belongs
  to Settings), audited + broadcast + products cache bumped. Rename
  stays on the card (already existed). Backend GET /:id/usage +
  POST /:id/rewire; tests/libraryAssetDetails.test.ts pins all four
  layers.]**),
  edit-form section jump bug (10.2), path-width inputs (11.17 — still needs the user to
  point at which input). **K7's remaining items (perf pass, portal §6
  leftovers, 10.2, 11.17) stay open — 6e's claim covered 8.1 only.**

### Phase P — Aug-28 eighth-batch additions (Part 380)

- [~] P7. **Identity rules + feature parity across ALL codepaths (user, Aug 28).**
  Done (Part 381): the MANUAL product create/edit routes now enforce the identity
  rule — same name + same non-empty barcode returns 409 `duplicate_product` with the
  match (guard runs BEFORE the review queue so reviewers never approve twins; edits
  that rename/re-barcode into a collision are judged too; no override flag — the rule
  is absolute; `test-product-identity-guard-pure` proves the SQL against the real
  schema + the wiring). **Open — the parity sweep:** every capability must exist on
  every surface that plausibly needs it. Named example: POS quick-add creates plain
  contacts while the full contact forms support multi-OPTION contacts (option rows,
  serialized storage, pick-on-select — the POS picker already picks options, but
  quick-add cannot create them). Sweep surface-by-surface (POS quick-adds, manual
  add-stock vs import validation, receive-batch vs §12 rules, edit forms vs import
  normalizers) and list every gap found as its own item before fixing.
  **SWEEP DONE (Part 394) — measured results, fixes listed as their own items:**
  - [x] P7-a *(Part 400: shipped, needs deploy — f5b72502. POS quick-add now
    serializes ONE primary option ('Default': name + phone + address/area)
    through the same createContactOption/serializeContactOptions the full
    forms use, so quick-added contacts open in the full form as real editable
    option rows; empty forms still store ''. Two source pins updated to the
    customerPayload shape with intent preserved.)* POS quick-add
    customer/delivery saved a
    BARE address/area string; the full contact forms serialize multi-OPTION rows
    into the same column.
  - [x] P7-b *(CLOSED in Part 408 with F1, session 6e: ProductForm submit
    rejects the pattern with the planner's own regex + a clear alert;
    routes/products.ts returns 400 `barcode_scientific_notation` on BOTH
    create and update, checked before the identity/duplicate logic.)*
    *(was: new, confirmed)*: the scientific-notation barcode guard exists ONLY
    on import screens (BulkImportModal/productImportPlanner/spreadsheetImport) —
    manual product create/edit accepts a pasted `8.85156E+12` barcode; ProductForm
    AND routes/products.ts (server-side, like the identity guard) should reject it.
    G1 landed long ago; the footprint (ProductForm + routes/products.ts create path)
    is exactly 6e's F1 lane — HANDED TO 6e to fold into F1 (Part 408) so two
    sessions don't share ProductForm. Spec: reject `^\d+(\.\d+)?[eE][+-]?\d+$`-shaped
    barcodes client-side with a clear message; server rejects the same pattern 400.
  - [x] P7-c *(Part 409, session 4a — SHIPPED, needs deploy (a0ec6207), and it
    uncovered a REAL production bug)*: `formatPhoneP8` in lib/contactDuplicates
    mirrors the migration validator's exact contract (`0XX XXX XXX` / `0XX XXX
    XXXX`, +855 folded to local, anything else preserved untouched) and both
    contacts POST + PUT store it, so every manual path incl. POS quick-add
    matches the 10,352 migrated numbers; matching stays digit-based. **The bug:
    the duplicate-check SQL selected `membership_number` from all three contact
    tables — only customers HAVE that column (0001 schema, production-verified
    read-only) — so EVERY manual supplier and delivery-contact create/update
    500'd at the duplicate check (the live-typing flag hid it by design: it
    fails soft), and the DuplicatesTab sweep for those tables failed with it.
    Both call sites now use table-aware columns; 9-check pure test incl.
    real-SQL regression against all three tables on real migrations;
    live-verified (supplier + courier creates succeed, phones stored as
    012 999 888 / 098 765 4321).* Original note: manual contact creates don't apply the P8 phone
    display convention (`XXX XXX XXX`); matching is digit-based so linkage works —
    display consistency only. `contactDuplicates.normalizePhone` exists to reuse.
  - P7-d *(checked, NOT a gap)*: §12 import deliberately cannot set supplier-credit
    payment_status (NULL = historical is 0065's design); credit is manual-receive-only.
  - P7-e *(checked, NOT a gap)*: POS quick-add duplicate handling already matches
    the contacts form (11.8: possible-duplicate confirm-retry + phone-conflict
    select-existing).
  - [ ] P7-f *(new, confirmed — found by H2's Part-423 sweep)*: the
    inventory-ADD import takes NO supplier / payment_status /
    credit_due_date columns (classifyInventory parses none; the template
    has none) and its apply writes movements + stock only — no batch
    attribution — while EVERY manual receive surface carries the D5a
    supplier picker and paid/on-credit. Cross-surface rule violation.
    The fix is kernel parity (inventory-add apply attributing lots like
    the products import does at 5061), sized beyond a sweep and
    DELIBERATELY deferred until after the user's M-phase migration
    imports run — same import-stability reasoning that defers K4. The
    template regeneration rides the engine fix, never precedes it (a
    template column the engine ignores is a lie).
  - Receive-batch vs §12 historical dates remains D4 (already tracked).

### Phase Q — Aug-28 ninth batch (Part 382)

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase R — Aug-28 tenth batch (Part 383)

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase S — Aug-28 eleventh batch (Part 384)

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase T — Aug-28 twelfth batch (Part 385): the connection preflight

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase U — Aug-28 thirteenth batch (Part 386): backlog continuation

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase V — Aug-28 fourteenth batch (Part 387): P3 + N2 + K6

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase W — Aug-28 fifteenth batch (Part 388): the quantity proof + the mm/dd/yyyy sweep

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase X — Aug-28 sixteenth batch (Part 396): date+time range, daily sales report, per-contact delivery totals

*User batch with two mockups (a date+time range panel; a "Start → End" trigger
pill). Standing principle recorded as X0. Claimed by session a7 except X5.
(Originally headed "Part 395" — session 35's migration-pack entry took 395
first; renumbered per the reservation protocol.)*

*(every item in this phase is complete — see [DONE — archive](docs/history/progress-archive-2026-09-02.md#done--archive))*

### Phase Y — Aug-28 seventeenth batch (session 43): live-use regressions + speed + density

*The user ran the migrated system for real (products import, POS sale, searching)
and reported ~20 issues, two screenshots. Ordered by severity: broken function
first, then workflow regressions, then density/design. Several land in files hot
with 6e's F3 slice 2 (Products.tsx / Inventory.tsx / ProductForm.tsx /
FastStockInModal.tsx / Modal.tsx / Sidebar.tsx) — marked [HOT-6e], do not start
those until that unit commits.*

- [~] Y4 *(hub half SHIPPED, Part 425: PageSlot is an overflow-hidden flex
  column, and all four Phase-E hubs rooted with a plain block div, so the
  hosted components' page-scroll containers resolved height:100% against
  an auto-height parent — everything below the fold was clipped and
  unscrollable. Hub roots are now height-filling flex columns; verified
  live on worker-dev (Settings/Fees/Branches all get bounded scroll
  containers, deep links intact). REMAINING: the print/reprint view the
  user also named — it is not a hub surface; reproduce separately.)*
  **Scroll regressions everywhere:** Fees section can't scroll, Settings
  page can't scroll, print/reprint view, Sales page + its sections, Branch page.
  Likely one shared cause in the hub-section layout (overflow clipped at the hub
  wrapper). Fix the pattern, then verify every hub.

- [~] Y16. **History + Manage buttons join the section-chip row** (not their own
  toolbar row) on: Sales, Branches, Contacts, Settings, Library, Review & Logs.
  (Products' equivalent rides Y15.) **CLAIMED Part-TBD, session a8 (Aug 29):**
  scoping each surface's current toolbar; must ship on ALL siblings at once
  (cross-surface rule) — Sales/Contacts/AuditLog files are peer-hot, will
  coordinate file-by-file.

### Phase Z — Aug-28 eighteenth batch (session 43): returns-to-same-batch + the ten-point triage list

*Follow-up to Phase Y: the user answered the open questions (Y6 closed "no
need"; Y12 clarified as the recordable per-currency sales change) and added a
correctness bug plus a pasted ten-point triage list to record "next to each
other" with the Phase-Y items.*

- [~] Z1. **Stats not updating / inconsistent data.** (a) **Z1a FIXED (Part
  437, needs deploy).** The rule is decided + enforced: a date-derived lot
  code (MMDDYYYY, e.g. 08242026) renders as its mm/dd/yyyy date where a date
  belongs; a genuine CUSTOM lot code renders as a code. Landed in the shared
  batchDisplayLabel util (fixes ManageBatchesModal, the POS lot picker,
  ReceiveBatchModal, InventoryStockModals, BranchStockAdjuster) + a new
  lotCodeAsDate helper, test-covered (6 cases, wired into test:utils). Three
  direct-render date-identifier surfaces also routed through it
  (inventory/ProductDetailModal, products/surfaces/ProductRowParts,
  branches/TransferModal); code-columns that show the date separately
  (ProductDetailReport + supplier/stock-in report tables) correctly keep the
  code. **Z1a REMAINING now CLOSED (Part 451, session e4, needs deploy):** the
  Inventory.tsx batch pill (`InventoryBatchPreview`, ~475/477) rendered
  `lot_code` raw — the one surface still showing "08242026" where every other
  pill shows "08/24/2026". F3 has since landed (Inventory.tsx clean), so it is
  now routed through `batchDisplayLabel`, an exact mirror of the Products page
  pill (surfaces/ProductRowParts.tsx); expiry/quantity untouched (both pills
  render expiry verbatim, so they still match). Re-audited every batch-display
  site while here: the three report tables (ProductDetailReport line 114,
  SupplierPurchasesModal's own "Received" column line 132, StockInInvoices'
  group header line 358) each show the received date SEPARATELY via
  fmtDate/fmtDateOnly, so their code column is the deliberate identifier, not a
  format bug — left as-is per the Z1a rule. (b) **MEASURED (Part 426), a real
  import-data inconsistency:** production branch_stock holds 23,113 units
  across 12,210 rows (6,105 products × 2 branches) but branch_batch_stock
  holds only 12,725 units in 6,105 lots (ONE lot per product, at ONE
  branch). The catalog import's default/legacy apply path writes
  branch_stock for the named branch but never a branch_batch_stock row, so
  a product with warehouse stock whose only lot sits at shop shows lot-qty
  0 at warehouse. POS/Products READ per-branch qty from branch_stock (the
  correct aggregate — line 346/363/648 in routes/products.ts). **CONFIRMED
  + FIXED (Part 427, needs deploy):** the user pointed at the batch DETAIL —
  "batch per row shows 0" and the branch selector "doesn't change the stock,
  just grand total". Both are the same root cause: branch_batch_stock had
  1,253 missing rows (+4 drifted), so the lot detail read 0 and switching
  branches showed nothing while the branch_stock grand total was right.
  Migration 0079 reconciles branch_batch_stock to branch_stock for the
  single-lot products (all 6,105 of them — unambiguous attribution),
  inserting missing rows and correcting drift, leaving any multi-lot product
  untouched; verified on synthetic data (insert/correct/skip-multi/
  idempotent) + real chain. The import-writer gap that created the drift
  (two-branch rows) is left for a focused fix per the P7-f/K4 mid-migration
  stability deferral. (a) the date-vs-lot-code display rule stays open.

- [~] Z5. **Global UI pass: contrast + button colors + hamburger menu.**
  **PART 1 DONE (Part 440):** the sidebar Refresh (Update) button renders BLUE
  and Logout (Exit) RED by default (were faint gray-400, hover-only tint); the
  modal ✕ went from text-gray-400 (~2.5:1, fails WCAG AA) to gray-600/gray-300
  (legible both themes). **PART 2 DONE (Part 446, session a8, needs deploy;
  user picked "desktop"):** the two loose footer icons are replaced by a
  single ☰ that opens an upward popover with Settings / Update (blue) / Exit
  (red); transparent-backdrop close (mobile-More pattern); Settings stays in
  the main nav too (not removed). tsc + build + langKeyIntegrity green; live
  click-through deferred (peer owns the shared 8787 dev server). **REMAINING:**
  (a) currency-symbol contrast — scattered across many files incl. peer POS
  lanes; needs a coordinated sweep. (b) "Receipt Settings moved into main
  Settings" — a larger IA change, its own unit. (c) **RESOLVED (Part 491, needs
  deploy):** the user made the call — Settings AND Receipt Settings are removed
  from the main nav and folded into a full-width, expandable **account row**
  (Profile / Settings / Receipt Settings / Update / Exit), which SUPERSEDES the
  Part-2 ☰ menu entirely; the same panel opens as a dropdown from the mobile
  header avatar so both form factors match. A shared `ACCOUNT_NAV_IDS`
  (navigationConfig) also drops them from the Settings nav-order/pinning editor.
  Partly covers (b): Receipt Settings now lives under the account, though not
  merged INTO the Settings page (that stays its own unit).

- [~] Z6. **OTP enable broken + buried under the profile page — HIGH
  priority.** **Layering FIXED (Part 426, needs deploy):** the OTP dialog
  rendered inline inside UserProfileModal — a DOM child of its tree,
  trapped in its stacking context (painted UNDER the profile at z-[60] vs
  the profile Modal's z-[1050]) and unmounted the moment the profile
  closed. It now portals to document.body at z-[1060], so it paints on top
  and owns its own lifecycle. REMAINING: verify the enable/validation flow
  end to end once deployed (the layering was the reported blocker; the
  generation/validation logic itself was not measured broken).

- [~] Z7. **Stats & Branch section + Khmer contrast.** **Khmer DONE (Part
  432, needs deploy):** the faint muted greys (text-gray-400/500,
  text-slate-400/500) now resolve to gray-600 (~7:1 vs gray-400's ~2.5:1,
  fails AA) in Khmer LIGHT mode only (scoped html:not(.dark) + body.lang-km;
  dark mode untouched — verified live); the tiny [10px]/[11px] bracket sizes
  gained a floor (the larger-Khmer-font ask was already handled by existing
  lang-km .text-* rules). The stats redundancy is effectively addressed by
  Z13 (Branch page now 6 balanced cards). REMAINING: tighten the vertical
  spacing between the stats block and the branch list on the hub — but that's
  in Inventory.tsx/BranchesHubPage (Inventory is F3-hot; do via isolation or
  after F3 lands).


### Flagged, not guessed (Golden Rule 7)

- ~~**Products now differs from the other five list pages (Part 389):** Products had
  a toolbar "Select all (N)" control and an empty header checkbox column — the
  opposite of Inventory/Sales/Returns/Branches/Contacts.~~ **RESOLVED (Part 451,
  session c1, needs deploy — `7a35f75c`):** the user confirmed the flip during the
  go-live hardening pass. Products' desktop header cell now renders the select-all
  checkbox in select mode (same isSelectionScope*/toggleSelectionScope helpers the
  section/group boxes use), and the always-visible toolbar "Select all (N)" control
  is gone (a select-mode "N selected" chip keeps the count; Y20's folded pager
  stays on that row). Long-press still enters select mode. tsc + vite build green.
- ~~B4's location (which page shows delivery inside a category column) is
  unconfirmed.~~ **Located Part 394** — the old-system expense labels
  (`Delivery / <courier>`, 3,130 rows) on the Fees page; migration 0072 separates.
- Commission/service fields for sales import/export still have no business rule.
- H1's exact per-page option lists should be confirmed against real usage before build.
- **Rebrand is incomplete in PRODUCTION portal SETTINGS DATA (post-deploy audit,
  Part 458, session business-os-v1-87).** The A6 code-rebrand (Part 376) swept all
  code strings — source has zero hardcoded "Leang Cosmetics" and every title
  fallback is "Leang Beauty" — but the live storefront still shows the old name
  because `GET /api/portal/bootstrap` (production data) carries it in five
  customer-facing portal-settings fields: `config.businessName` = "Leang
  Cosmetics", `config.title` = "Leang Cosmetics", `config.intro` = "Browse Leang
  Cosmetics products and promotions.", `config.submissionInstructions` = "Share
  \"Leang Cosmetics\" on social media…", and `config.publicUrl` =
  "https://leangcosmetics.dpdns.org" (old domain; the current apex is
  leangbeauty.com). (The `meta.brands.*` "… Cosmetics" values — BH/IT/Kylie/etc. —
  are legitimate PRODUCT brand names, correctly not touched.) These are stored
  settings, not code, so A5/A6 could not fix them; they are also user-editable
  (intro/submissionInstructions may be customised), so NOT auto-rewritten — the
  fix is the admin editing them in Settings → Customer Portal / business identity,
  or an explicitly-authorised one-time settings update. **`publicUrl` is now FIXED
  in code (Part 461, `341f7fce`, needs deploy):** `portalPublicUrl` drops a stored
  `customer_portal_public_url` override whose host is one of this shop's own
  DEPRECATED hosts (synced with index.html's redirect map) and falls back to the
  live `BUSINESS_OS_PUBLIC_URL`, while still honouring a genuine external funnel
  domain; `test-portal-public-url-pure.cjs` (17 checks) pins it. **Root cause now
  FIXED too (Part 471, `9a46056c`, needs deploy):** the portal editor was freezing
  the resolved publicUrl back into the stored override on every save —
  `CatalogPage.tsx` `buildDraft` prefilled the `customer_portal_public_url` input
  with the RESOLVED `config.publicUrl` (env fallback included), so a save promoted
  the fallback into an explicit override that then shadowed later env changes.
  `buildPortalConfig` now also returns `publicUrlOverride` (the RAW stored value,
  empty when unset); `buildDraft` prefills from that (falling back to `publicUrl`
  only for a pre-field cached config), and `applyDraft` carries the raw override in
  optimistic state — so a blank override stays blank and a real env change flows
  through. The four brand/text fields above remain user-side per the "no rebrand
  settings" instruction.

---

---


## Task board — still-open rows

*(The original task board, with its completed rows and full preamble, is in the
archive. Rows here are still open; bracketed notes flag likely supersessions.)*

### Blocking / production

| Task | Status | Notes |
|---|---|---|
| Image normalization, quality protection, all library objects, re-verified every 6h | **in progress (Part 356)** | **Revised Aug 27:** every image may be metadata-stripped and converted to WebP when the result is smaller while retaining roughly **80–90%+ visual quality**. Files already at or below 350KB do **not** enter the aggressive resize/compression ladder and are never padded up to 300KB. Only sources above 350KB use all methods in order — format/metadata first, dimensions second, encoder quality last — selecting the highest-quality result at or below 350KB and aiming for 300–350KB when naturally achievable. Provider failure may never fall through to storing an oversized original. **Part 356 checkpoint:** the server now rejects a fourth unique image for a normal user (409, no silent slicing) and permits five only for admin-control users; file upload, camera and Library picker share that cap. Existing admin-created positions 4–5 survive an ordinary edit but cannot be replaced with a new fourth path. Full server-authoritative quality normalization/provider pipeline is still open. **[Ladder itself shipped as K3 (Part 417); remaining: provider fallback + 6-hour re-audit pipeline.]** |

### Cross-cutting

| Task | Status | Notes |
|---|---|---|
| Permissions UI: more detail, per-action, "Review Required" renamed | **partly done — needs deploy** (Part 347) | Requested Part 347. Current editor shows very small buttons and too little detail; the admin should be able to pick individual **actions** themselves. Also: **"Review Required" is a misleading name** — it does not mean everything is reviewed (Fees only queues delete, Contacts allows add directly but limits edit, Products queues every write). **Done:** renamed to **"Partial Access"** in en+km including the seven per-section descriptions and the review-queue hint — the stored value stays `'review'`, so `reviewGate`/`reviewApply`/`REVIEW_TIER_KEYS` and every backend branch are untouched; this is a naming change, not a behaviour change. The old name told admins the wrong thing: Fees only queues *delete*, Contacts allows add directly and limits edit to the name field, Library cannot delete at all under it. Tier buttons went from `px-2.5 py-1 text-xs` (the "very tiny buttons") to `min-w-[5.5rem] px-3 py-2 text-sm`. The per-row explanation was a 4×4 button carrying `title` — the black native tooltip, which **does not open on tap at all**, so on touch the explanation was unreachable; now `InfoHint`, with a test asserting the native `title` is not also present. **Still open:** letting an admin pick individual *actions* directly rather than only per-section tiers. **[Open remainder tracked as K6 (preset bundle UX) + 7.1/7.2.]** |
| Fast loading, accuracy, efficiency | not started | Needs a measured pass, not guesswork. **[Open — tracked as K7’s measured performance pass.]** |

### Deferred by request

| Task | Status |
|---|---|
| Promotions / discounts, Canva-like template editor | deferred |

---

**DONE (session business-os-v1-77, Aug 30): full verification/stress sweep + four
first-wave loophole fixes** (portal same-name customer leak, ungated
`/auto-merges/:productId`, offline-sync sale deletion, one stale test) — nine
systematic architecture audits ran, and their CRITICAL/HIGH findings feed the
still-open "Verification findings" list right below. Full recap (commits,
methodology, the k4s ride-along) moved to
[`docs/history/progress-archive-2026-09-02.md`](docs/history/progress-archive-2026-09-02.md),
§ "Task board — Part-77 sweep DONE recap".

### Verification findings — Aug 30 (Part 77 sweep) — OPEN, triaged, not yet fixed

Nine architecture audits. Each item below is a real defect confirmed by reading the
shipped source; the parenthesical is how many independent audits surfaced it (higher
= stronger signal). **Four already fixed this session (above).** The rest are open,
ordered by severity. Many are backend-route behavioral changes or need a product
decision, so they were flagged rather than guessed (Golden Rule 7). A peer picking one
up should re-verify against current source first.

**CRITICAL — data loss / corruption / privilege:**
- **[SLICES A+B FIXED: session b9, Aug 30 — Part 521, `40ed7d90`, needs deploy;
  SLICE C STILL OPEN]** `BACKUP_TABLES` now carries the lot ledger AND the 17 other
  silently-dropped tables b9's sweep found (fees, loyalty_point_adjustments,
  damaged_stock_lots, replacement items, promotion_rules, notes, pending_actions,
  dismissals, import commit/guard ledgers, …) in FK order, with deliberate
  exclusions recorded; backups stamp `summary.schemaMigration` and restore REFUSES a
  newer-schema backup before any delete, reporting `schemaMismatch` +
  `tablesNotInBackup`. **Slice C open:** restore is still non-atomic
  DELETE-then-reinsert with no maintenance lock — realistic design is a
  write-blocking maintenance flag + resumable restore state (import-lease spirit),
  NOT whole-restore atomicity (impossible in D1 batch limits at this size).
- **[FIXED: session b9, Aug 30 — Part 518, `07fb7705`, needs deploy]** Inventory
  `/transfer` moved only `branch_stock`, stranding every lot at the source (the 0081
  drift class, ×3 audits). Now auto-allocates FIFO across source lots (same Z0 policy
  as checkout) and moves each take per-lot in the same atomic batch — strict source
  decrements (race aborts, never mints), same batch ids at the destination, 0084
  blank-honest movement stamping; uncovered legacy remainder moves on branch_stock
  alone (drift conserved, never created). No destination identity-merge added
  (branches.ts has one, inventory never did — asymmetry flagged, not smuggled in).
- **[FIXED: session b9, Aug 30 — Part 512, `bcf58378`, needs deploy]** Action-history
  undo applier derived its permission from a client-supplied `entity`; an unrecognized
  entity → empty permission → any cashier could run `branch.update` etc. with no gate.
  Now every applier declares its own permission section and the route demands its FULL
  tier at both record and operate time; `server_replayable` is per-user. (was ×1 auth)
- **[FIXED: session b9, Aug 30 — Part 513, `ea3174a3`, needs deploy]** `/reset-data`,
  `/reset-section`,`/finalize-migration`,`/factory-reset` (+ forced orphan cleanup)
  gated on `backup` (export) not `backup_restore`. Helper now demands backup_restore;
  frontend pre-flights mirror it. Password return kept (only path back in, now
  properly scoped). Open sub-question, flagged not changed: should
  `/repair-integrity` (guided repair, currently backup-OR-settings) demand more?
- **[FIXED — both paths: session b9, Aug 30 — Parts 523 + 530, `86125647` +
  `4fb6d108`, needs deploy]** Returns create AND edit now compensate their pre-batch
  stock writes on failure (loudly reporting anything unreversible via audit
  `return_rollback_incomplete` + the 500 message). Edit's even-exchange gate was
  also HOISTED — it used to 400 AFTER the reversal/re-apply loops committed,
  corrupting stock on a mere validation refusal. Still open (the shared slice-C
  class): true cross-step atomicity — post-batch failures degrade future edits'
  lot precision, never stock. (was ×2: write-path, batch-identity)

**HIGH — data / money / security:**
- **[FIXED: session b9, Aug 30 — Part 531, `5562f84c`, needs deploy]** Import apply
  idempotency: each additive row (products merge_stock/override_add, inventory) now
  commits its writes + a guard row in ONE db.batch (generic
  import_stock_action_guards ledger, action_key='generic_apply' — no new migration);
  retried chunks pre-read guards and skip applied rows. New group-atomic
  runD1BatchGroupsInChunks splits CPU-limit batches at group boundaries. (was ×1)
- **[FIXED: session b9, Aug 30 — Part 513, `31fa9f85`, needs deploy]** `GET /api/settings`
  + `/auth/bootstrap` leaked Google Drive OAuth tokens to any logged-in account. New
  `lib/settingsSensitive.ts` strips secret-bearing keys (explicit + credential
  suffixes) from both responses for everyone; no frontend surface read them.
- **[FIXED: session b9, Aug 30 — Part 517, `1b4580b6`, needs deploy]** Password-reset
  built the link from an unvalidated caller `redirectTo` (open redirect → token theft).
  New `resolvePasswordResetBase` honors only exact BUSINESS_OS_ADMIN_URL /
  BUSINESS_OS_PUBLIC_URL origins (origin+pathname kept, query/hash dropped); everything
  else falls back to the admin URL. (was ×1 auth)
- **[FIXED: session b9, Aug 30 — Part 527, `b158d347`, needs deploy]** OTP verify was a
  standalone 6-digit login (bare numeric userId, no lockout feed, no device gate). Now:
  first factor mints a 5-min KV challenge (`lib/otpChallenge.ts`) that /otp/verify
  demands before any DB read; wrong codes feed the same escalating lockout as wrong
  passwords; the device-approval gate re-runs at the OTP step with this request's
  deviceId; response gains role fields (the /login self-sufficiency fix). Operator
  note: an OTP user mid-login during the deploy re-enters their password once.
  (was ×1)
- **[FIXED: session b9, Aug 30 — Part 522, `8963f1a1`, needs deploy]** Chunk recovery
  wiped the app-shell/static caches with no online guard, bricking the offline PWA
  over one uncached page. Recovery now declines offline BEFORE spending the one-shot
  retry marker (caches kept, recovery stays armed for reconnection); lazyWithRetry
  falls through to the page-level error UI. (was ×1 offline)
- **[FIXED: session b9, Aug 30 — Part 525, `97f3fcde`, needs deploy]** The MAX(0)
  clamp sweep, judged per site: supplier returns gained the missing availability
  validation (cumulative per product+branch, 400 refusal) + strict decrements
  (races abort via 0058's CHECK); replacement drain strict (pre-validated);
  batch-correction floor KEPT deliberately (repair tool must work on drifted data)
  with stock_quantity now re-derived from SUM(branch_stock) instead of a clamped
  delta; dated-count apply reviewed and unchanged (documented deliberate
  reconciliation semantics). (was ×2)
- **[FIXED: session b9, Aug 30 — Part 529, `1360a7c8`, needs deploy]** POS money:
  loyalty redeem value now keeps CENTS ($0.25/step no longer burns points for $0;
  $0.50 no longer doubles to $1); KHR tax/total/change and payload subtotal round to
  whole riel. **Flagged for the user, not changed:** `redeemValueKhrStep`'s
  ceil-to-1000 floor can inflate a configured KHR step (2050 → 3000) — deliberate
  denominations rule, or the same value-inflation bug class? (was ×1 frontend)
- **[FK-INDEX SLICE FIXED: session b9, Aug 30 — Part 532, `9dfc7235`, migration 0086,
  needs deploy + remote migrate; the unpaged-reads/N+1, date(created_at) and
  REPLACE-chain slices STAY OPEN]** Unpaged full-catalog reads /
  N+1 on ordinary routes (~~`/catalog/products` unauth ~174 statements~~
  **[FIXED: session 77, Aug 31 — `0efd04bc`, needs deploy]** — that route was a
  dead, unauthenticated, ungated DUPLICATE of the gated `/portal/catalog/*`
  storefront; nothing called it (0 imports / 0 call sites verified), so it was
  removed entirely — route file, index.ts mount, and 3 dead frontend transports —
  closing both the unbounded-unauth-read and the portal-gate-bypass audit findings;
  `test-no-ungated-catalog-pure.cjs` locks it out. Still open here:
  `/inventory/summary`, `/customers` no-paging 220 statements); ~~missing FK
  indexes~~ (0086 adds sales(customer_id, created_at), returns(sale_id),
  loyalty_point_adjustments(customer_id) — the other named candidates already had
  indexes); `date(created_at)` defeats date indexes on 36 sites (**analytics slice
  FIXED: session 77, Aug 31 — `3c36bfba`, needs deploy** — `salesAnalytics.ts`'s
  shared `whereActiveSales` filter is now the sargable `created_at >= @start AND
  created_at < date(@end,'+1 day')`, index-backed and row-set-identical to the old
  form, proven across boundary cases in `test-sales-analytics-daterange-pure.cjs`;
  the by-day GROUP BY date() expressions are correct and untouched. **`stockLedgerQuery.ts`
  slice also FIXED: session 77, Aug 31 — `60df8ba0`, needs deploy** — same sargable
  rewrite, now uses `idx_inventory_movements_created_pg`, proven in
  `test-stock-ledger-daterange-pure.cjs` (incl. start-only/end-only/no-bound cases).
  `auditLogQuery.ts` was deliberately LEFT as date() — `audit_logs` has no created_at
  index, so a rewrite there is churn with no perf gain (add an index first if it ever
  matters). **`routes/inventory.ts` GET /movements slice also FIXED: session 77,
  Aug 31 — `bd2f0680`, needs deploy** — same sargable form (date() on the param only,
  so a malformed date param behaves identically), proven incl. malformed inputs in
  `test-inventory-movements-daterange-pure.cjs`. **`compat.ts` Dashboard/Analytics slice
  also FIXED: session 77, Aug 31 — `9736de07`, needs deploy** — all 10 sales/returns
  `date(created_at)` filters (both the `= date(@today)` equality and the 8 BETWEEN
  ranges) made sargable, both shapes proven equivalent incl. malformed inputs in
  `test-compat-dashboard-daterange-pure.cjs`; the expiry_date alert (per-row bound) and
  the audit_logs retention delete (no index) were deliberately left. **Still open:** the
  same rewrite in `sales.ts` list/export and `returns.ts` (both in active lanes));
  ~~`inventory/movements` text search still builds the depth-~92 REPLACE chain (D1
  depth-100 risk)~~ **[FIXED: session 77, Aug 31 — `ca3828e7`, needs deploy]** — the
  five per-column ~78-level diacritic folds were replaced by ONE shallow concatenated
  haystack + `buildLikeAliasClause(..., alreadyNormalizedCols=true)`, mirroring
  buildSalesSearchWhere; the new clause has ZERO `replace()` (was hundreds), proven
  in `test-inventory-movements-search-depth-pure.cjs` alongside preserved
  case-insensitive/multi-word/OR matching. **Follow-up flagged (not done):** full
  diacritic PARITY with Sales/Returns needs a write-time `inventory_movements.search_normalized`
  column (0082 pattern) populated in JS — but movements has 33 scattered INSERT sites
  and no shared writer, and movement text is a denormalized copy of product names
  (Part-484 measured ~0 Latin diacritics), so the practical loss is nil. (×1 D1-scale)
  — see report.
- Receipt/date locale: `Receipt.tsx:309` + 3 duplicated `formatDateTime` use viewer
  locale (dd/mm + 12h) violating the mm/dd + 24h rule. (×1 cross-surface).

**MEDIUM (representative):** ~~review-tier bypass on fees PUT / contacts create / returns
create~~ **[NOT A BUG — verified session 77, Aug 31: intentional, documented per-section
tier specs. DO NOT gate these.]** The auth-matrix audit flagged these against a generic
"Review Required must queue every write" assumption, but each section's spec is explicit
and narrower: Fees = "everything allowed directly EXCEPT delete" (fees.ts:284-288, only
delete is queued); Contacts = "view + add directly, name-only edit" (contacts.ts:859-860,
so create is deliberately direct and only delete/merge are blocked); Returns = create
allowed, PATCH edit blocked (the Part-154 pattern the contacts comment cites). Gating the
create/edit paths would REGRESS the intended Partial-Access behaviour — the exact
fix-one-break-another cycle. The `pickColumns`/name-only-drop and delete/merge blocks are
the real enforcement and are correct. — membership points balance formula ~~omits
`loyalty_point_adjustments`~~
**[FIXED: b9, Part 533, `ab8d172c`]** — checkout re-validation now carries the same
manual-award term as summarizePoints, with parity source locks; ~~offline sale
timestamps recorded at sync time not
sale time (day-boundary reports drift)~~ **[FIXED: r2, Part 541 — offline queue
stamps payload.created_at at queue time; POST /sales honors it with bounded
trust (lib/clientTimestamp.ts: parseable, not future beyond 5-min skew,
normalized to the CURRENT_TIMESTAMP shape so lexicographic ORDER BY stays
correct); online checkouts unchanged; test-client-timestamp-pure 8/8]**;
read-cache keys missing their id param (fees/
returns/customTables get-one collisions — **[FIXED by peer, Part 528]**); import
review screen (Sales/Inventory) lacks
Cancel + per-row decisions its Products sibling has; ~~failed import job renders "Queued
0%"~~ **[already fixed before this sweep landed — Part 509's "Failed" chip;
re-verified in source Aug 31 (getProgressDisplay's explicit failed branch)]**;
~~Suppliers/Delivery tabs lack the sort/pagination their sibling + backend
support~~ **[FIXED: r2, Part 542, `92648cef` — both tabs wire
sort/dir/page/pageSize + the ContactTable pager, mirroring CustomersTab]**.

Full detail with file:line, failure scenarios, and per-writer coverage matrices: the
**Part 77 verification report** artifact (link in the session's final summary).

---


## Needs the user, not code

*(Item "Deploy" was here, already marked done — moved to
[`docs/history/progress-archive-2026-09-02.md`](docs/history/progress-archive-2026-09-02.md)
2026-09-02, see its "Additional items closed" note.)*

1. **Connect Google Drive** in Settings → Backup — NOW ACTIONABLE post-deploy (A3
   measured the mirror was never connected), then confirm backup files appear in Drive.
2. **Resend** — verify a real sending domain (@leangbeauty.com) and set
   `RESEND_FROM_EMAIL` in `wrangler.toml`; until then password-reset email silently
   does nothing.
3. **Google OAuth redirect URIs** for leangbeauty.com in Google Cloud Console (A5).
4. **leangcosmetics.com DNS** still points at 36.37.242.94 (not Cloudflare) — its
   redirect route can't fire until the DNS moves (A5 caveat).
5. **Rotate the Cloudinary API secret** — it was pasted in chat. It is in `.dev.vars`
   (gitignored, verified absent from git history), never in `wrangler.toml`. User says
   they have since updated it in `.dev.vars` — confirm.
6. **Sentry** — create a project under `ungsethypagna` and wire the SDK, or drop it.
7. **Portal settings rebrand** — edit the four "Leang Cosmetics" fields in Settings →
   Customer Portal (stored data, deliberately not auto-rewritten).
8. **11.17** — point at which uploads/folder-path input is too wide.
9. **redeemValueKhrStep** — is ceil-to-1000 a denominations rule or a bug? (Part 529)
10. **User-defined options (Aug-25 §7)** — name which fixed dropdowns should become
    user-defined.

---


## Open work — ORDERED

> **Superseded as the queue by [Master plan — Aug 28 2026 (Part 370)](#master-plan--aug-28-2026-part-370--the-authoritative-queue).**
> Kept as the SPEC LIBRARY: the master plan references §11–§15 and the locked
> execution plan below by number. Do not pick work from here directly.

*Rebuilt Aug 26 2026 (Part 353), immediately before a context compaction, so this
section is the ONLY reliable record of what was asked. Everything below came from the
user's own messages; nothing is inferred. Top of the list is next.*

**Stated order:** 2.1 → 2.2 → 2.3 → undo/redo (server-level) → everything else.

### Active umbrella goal — Aug 27 2026


Do not call this goal complete until every box below is either implemented and
verified or is recorded here with a concrete external blocker. Each coherent
change is committed and pushed to `origin/main`; `progress.md` is updated from
the repository evidence, never from intent.

- [~] Stats: compact every page, put name + info on one row, and make tooltip/detail
  overlays viewport-aware top-layer UI (especially Returns). **Core landed Part 370**
  (portaled real-space tooltips; same-row label+hint on Dashboard/Branches/Inventory/
  Returns as separate controls); detail-panel responsiveness (5.3) and the metric
  symmetry rule (5.4) remain — see master plan B1.

- [ ] Delivery: store customer charge separately from restricted actual delivery
  cost; redact actual cost from receipts/customers/public APIs and report charge,
  expense and margin distinctly.

- [ ] Historical batches: allow safe received-date/batch entry from Product,
  Inventory and Branch batch views; preserve barcode on branch transfer and only
  permit barcode changes in create/add/adjust flows.

- [ ] Media: complete the shared 3-image normal / explicit admin exception policy,
  300–350KB ceiling strategy, magic-byte/decompression safeguards and bounded
  Cloudflare-primary/Cloudinary-fallback transformations across every entry point.

- [ ] Storage/backups/jobs/security: exact-two verified R2 retention, complete
  verified Google Drive mirror/prune, storage-growth remediation, finite job leases/
  cancellation, and CPU/SQL/rate/AI-input/abuse safeguards with deep tests.

- [ ] Remaining recorded UI/domain work: cross-page selection columns, Returns
  replace/damaged-stock chooser, contact duplicate-resolution clarity, §15 audit,
  and the rest of this ordered backlog.

- [ ] Final gate: full backend/frontend/type/build/migration checks pass,
  `progress.md` matches HEAD, every coherent commit is pushed, and anything requiring
  deployment/account configuration is named precisely.

---


*(Completed umbrella boxes moved to the archive.)*

### 0 — BROKEN IN PRODUCTION (jumps the queue)

| # | Task | Status |
|---|---|---|
| 0.1 | **`POST /api/system/reset-data` exceeds the CPU limit.** **FIXED (Part 354), needs deploy — the log the user re-pasted is from 13:45, before this shipped.** The reset code was never the problem: products mode called `createCloudflareBackup`, which walks all ~34 backup tables + lists the whole R2 bucket, so the request died inside the mandatory backup before deleting anything. Now takes a backup SCOPED to just the tables it will clear (`createSectionBackup`), the same fix `/reset-section` already had. Backup list and delete list derive from ONE array so a scoped backup can never miss a table the reset clears (test drives all 4 toggle combos). Products-only reset also MOVED into the page-reset grid as asked. includeImages R2 cleanup capped at 200 and the overflow reported. **Verify live after deploy.** |
| 0.2 | **`GET /api/products` → `D1_ERROR: too many SQL variables at offset 415`.** **FIXED (Part 354), needs deploy.** Probed live against production D1: the real cap is **100** bound parameters, not 999 — 101 placeholders fail at offset 227 (exactly the 101st placeholder), and offset 415 is the 101st placeholder of `attachBranchStock`'s query, which built one `IN (...)` over every product row on the page. It was NOT one query — ~40 sites built a placeholder-per-row list, several already over the limit before any search (importEngine dedupe chunked at 100 THEN bound @job_id = 101; bulkDelete sent 500 in one DELETE and recorded the throw as 500 failed deletes). All routed through new `lib/sqlBinding.ts` (the one place the 100 limit is now written down). New `test-d1-bound-params-repro.cjs` installs D1's limit in the shim (better-sqlite3 allows 32k, which is why this reached prod) and fails if any file builds an IN-list without chunking. Also stopped `withD1Retry` re-running deterministic SQL errors. **Verify live after deploy.** |

### 1 — Imports (the stated next three)

| # | Task | Status |
|---|---|---|
| 2.1 | **Unified Add/Sale/Reconciliation import — LIVE IN CODE end-to-end (Parts 359–362), needs deploy.** See [§12 below](#12--unified-addsalereconciliation-import-spec-part-354). The 10-column contract/parser, bounded analyze path, persisted resolved-row review, cross-window conflict seal, server confirmation gate, immutable reviewed source, and transactional apply engine are built and tested. Apply is FIFO, oversell-proof, partial-receipt-proof, cancellation-aware, retry-idempotent, and bounded for Workers Free. **Open:** deploy/live-browser verification and the OTHER import types in §13. | done in code; needs deploy/live verify |
| 2.2 | **Import review / resolve screen. DONE in code (Parts 361–368), needs deploy/live verification.** Stock Actions, Contacts, Sales, Inventory, Products and image-only imports stay in their modal for one server analyze → authoritative persisted review → explicit confirmation. Product's duplicate local review and synchronous preflight were removed in `a31bbd80`. | done in code; needs deploy/live verify |
| 2.3 | **Image auto-wire button — frontend half.** **DONE (Part 354), needs deploy.** `WireImagesReviewModal` built (grouped per product, ordered by `_1/_2/_3`, shows would-replace + unmatched + ambiguous); wired into the Products **Manage** menu (gated on the `products/image` action), the **Library** page next to Upload, and the import modal's result step for the per-job wire endpoint. **UNWIRE** shipped too: `POST /api/products/unwire-images` (detach-only, files stay in the Library; empty id list refused, `all:true` required to clear everything) with a disclosure in the modal. **Found + fixed a real bug while building it:** the apply endpoint ran one `UPDATE image_path` per matched image, so a 3-photo product kept only the last and `product_images` was never written — now goes through `syncProductImageGallery`. `test-wire-images-gallery-pure.cjs` (9 checks). |

### 2 — Undo / redo (after 2.1–2.3)

| # | Task | Status |
|---|---|---|
| 3.1 | **Make undo/redo SERVER-level, not session-level.** Currently undo is a live JS closure held in the tab that performed the action, so it never survives a reload and in practice never works — confirmed by reading the code, not guessed. The server stores `undo_payload`/`redo_payload` on every action but NEVER replays them: `routes/actionHistory.ts:225` marks the transition `serverPayloadOnly: true`, and `/undo` only flips a status column. **Required behaviour:** an admin sees ALL users' actions and can undo/redo any of them; a non-admin sees and can reverse only their OWN account's changes. Needs a per-action-type applier reconstructing the change from the stored payload, the same shape `lib/reviewApply.ts` already uses for the approval queue. The Part 352 label change ("Recorded", with an honest hint) was cosmetic and does NOT count as this. | not started |

### 3 — Products page layout (from annotated screenshots)

| # | Task | Status |
|---|---|---|
| 4.1 | **Large-screen alignment.** **FIXED (Part 354), needs deploy — but see NEW 11.x below, the user revised what "aligned" should mean.** Measured the real table in a browser: the 8 `<col>` widths summed to 90%, and `table-fixed` spread the unclaimed 10% across every column INCLUDING the fixed leading two (checkbox asked 2rem, rendered 51px), so the rail moved with the viewport and no hand-written copy could track it. Fix: full-width rows (category band, group header) now use REAL cells in the table's own columns (browser does the aligning, nothing to drift); the six % columns now sum to 100%. Rail is a constant 98px. `test-productsRowAlignment.test.ts` guards the cause. |
| 4.2 | Batches show 0 in Inventory. **DONE (Part 354), needs deploy** — was a missing list read (6,691 batches exist live); Products + Inventory now attach a scalar `batch_count`. See §14. | done, needs deploy |
| 4.3 | **Special price is not read or used correctly.** **DONE (Part 354), needs deploy.** Product list reads the real value and forms/imports no longer overwrite a real VIP price with selling price. See 11.24. | done, needs deploy |
| 4.4 | **Rename "Special price" → "VIP price" EVERYWHERE**, including the import template and its column headers. **DONE (Part 354), needs deploy.** See 11.25. | done, needs deploy |
| 4.5 | **POS naming:** use "Selling price" rather than "Regular". **DONE (Part 354), needs deploy.** | done, needs deploy |

### 4 — Stats cards (second pass; the Part 351 work was incomplete)

| # | Task | Status |
|---|---|---|
| 5.1 | **Info tooltips are broken in practice**: not responsive, overflow their container, render UNDER other elements (wrong stacking layer, so they are blocked), and are too large. Seen on Returns, Branches and others. `InfoHint` uses `absolute` positioning inside cards that clip — it likely needs a portal and viewport-aware placement, not a bigger z-index. | not started |
| 5.2 | Put the info affordance **on the same compact row as the stat name** on every page; do not render a separate tooltip row. | not started |
| 5.3 | The **click-to-view-more-details** panel is also not fully covered / not responsive. | not started |
| 5.4 | **Dashboard and Inventory removed opposite metrics**: Dashboard still shows Gross Profit, Inventory still shows Net Sold. The Part 351 removal was applied inconsistently — decide one rule and apply it to both. | not started |
| 5.5 | **Product stats: use COLOUR instead of labels** for healthy / low / out-of-stock in the default view. **DONE (Part 355), needs deploy.** Shared `stockHealthSummary` powers Inventory and Branches. See 11.20. | done, needs deploy |
| 5.6 | **Branches page: too many stock stats outside.** **DONE (Part 355), needs deploy.** Seven outer tiles became three; health folds into Items via the shared helper. See 11.21. | done, needs deploy |
| 5.7 | **History button in the profile menu is not responsive.** **DONE (Part 354), needs deploy** — see 11.22. | done, needs deploy |

### 5 — Public portal

| # | Task | Status |
|---|---|---|
| 6.1 | **Remove the colour overlay in the About section**, and make the **cover image cover the whole section**, not half of it. | done (Part 399) |
| 6.2 | Top bar: **remove the logo**; split social links to one side and language + light/dark to the other. | done (Part 399) |
| 6.3 | Stale cache of embedded sites on the public site — reproduce, then scope. | **REPRODUCED + scoped (Part 400 sweep)**: a `customer_portal_*` save stores instantly but `GET /api/portal/config` serves the old value the full 60s TTL (measured stale +30s, fresh +66s) — `portalCacheVersion` keys on the PRODUCTS version only and settings saves bump nothing. Fix (2 changes, in the G-session's claimed files, handed over): settings POST bumps a 'settings' version; portalCacheVersion composes products+settings. **FIXED (6e, same day): both changes landed exactly as scoped, regression-pinned in test-promotion-rules-pure.** |
| 6.4 | **Google Translate for languages** instead of hand-maintained packs. Must be fast, must not corrupt layout or Khmer text, and must degrade safely — the current packs are the fallback, not the casualty. | was already built (verified Part 399: portalTranslateController + admin toggle + tests); row had gone stale |
| 6.5 | Portal pagination counts **unmerged** rows: the server paginates at 50 before the browser merges duplicates, so the pager promises pages that do not exist. | done (Part 399): group pagination via familyPagination on both portal endpoints; behavioral test |

### 6 — Permissions (half done)

| # | Task | Status |
|---|---|---|
| 7.1 | **Per-action picking exists but only NARROWS.** An override can remove an action the tier granted, never add one it withheld — deliberate, because widening needs every route to honour it or the UI and API disagree. Wired through the Products routes only; other sections still honour the section tier alone. | partly done |
| 7.2 | **Editor UI: professional, clean, classic, smart.** Beyond the Part 347 sizing fix — real hierarchy, sections readable at a glance, related controls compacted onto one row, no wall of tiny chips. | not started |

### 12 — Unified Add/Sale/Reconciliation import (spec, Part 354)

*The user's full design, captured verbatim-in-substance. This replaces the
old multi-template Add/Sale + Dated Stock Reconciliation split.*

**One mode, one column set, two options.** Columns in EVERY option:
`name, barcode, shop, warehouse, date, action, selling_price, vip_price,
cost_price, batch`. The system decides create/add/sale from the numbers +
date; the `action` column only disambiguates a same-day mix or names a
specific POS sale. "No guessing and comparing stock current with import"
for the direct option; comparison only for the reconcile option.

- **Option DIRECT** — the shop/warehouse numbers ARE the change; `action`
  gives the direction. shop +2, warehouse 0, action=add ⇒ add 2 at shop.
  shop 0, warehouse 2, action=sale ⇒ sell 2 from warehouse. No comparison.
- **Option RECONCILE** — the numbers are the TOTAL count as of the date;
  the system computes delta vs current stock (import>current ⇒ add the
  difference; import<current ⇒ sale). The action column clarifies a
  same-day add-then-sale whose net count would otherwise hide one side.

**Sale grouping (why no per-sale templates):**
- `action = 'sale'` (no number) ⇒ ONE aggregated daily sale: every 'sale'
  row on the same date is one receipt for all its products.
- `action = 'sale1'/'sale2'/...` ⇒ a SPECIFIC POS sale that day: rows
  sharing `saleN` + date are one receipt, so several real sales in a day
  stay separate.

**Pricing is optional** when name+barcode match, the stock qty allows the
action, and there is no conflicting multiplicity. Selling & VIP price
differences are fine — both resolve to the selling price for a sale.
**What conflicts is batches:** the SAME product on multiple rows with
multiple batches AT multiple cost prices — flag with a reason, show in the
review, and gate the import behind a **Confirm Action** button. (Done in
the kernel: `detectCostBatchConflicts`.)

**DONE (kernel):** `lib/stockActionResolver.ts` — `parseStockAction`,
`resolveRowStockAction` (both options), `saleGroupKeyFor`,
`detectCostBatchConflicts`, `resolveStockActions` (one plan per row,
`needsReview` flag). Pure, DB-free, 16 tests.

**WIRING STATUS (Part 357 historical checkpoint; completed by Parts 358–362), in order:**
1. **DONE — unified template + column mapping** — one products-stock template with
   the 10 columns above; retire the separate Add/Sale and dated-count
   templates. `unifiedStockImport.ts` owns the exact canonical header/parser.
2. **DONE — resolution against real data + cross-window sealing** — resolve product (name→barcode per the
   existing `classifyProducts` order) and branch (shop/warehouse → branch
   ids, auto-create-on-miss like `resolveAndCreateBranches`), load current
   per-(product,branch) stock, then call `resolveStockActions`. The classifier
   performs only targeted, binding-capped reads; a missing branch is previewed
   as pending and ambiguity is non-actionable. Apply reclassifies against
   live state; final analyze seals conflicts across every persisted window.
3. **DONE — review screen** — the 10 columns, computed action per row, the
   conflicts, and a **Confirm Action** button that is the ONLY way to run a
   sheet with any conflict. Reuse the 2-screen flow from §13.
4. **DONE — apply path** — per plan kind: `create` inserts the product then seeds
   stock; `add` receives stock into the branch AND creates/updates the
   batch (product_batches + branch_batch_stock, lot_code from the date via
   `dateToBatchCode`); `sale` records a grouped sale (one row in `sales`
   per `saleGroupKey`, its lines in `sale_items`, deducting branch_stock
   and the chosen batch). Reuse `datedStockCountApply` / `productBatches`
   patterns; keep it chunked + resumable like the rest of the import path.

**Part 358 transactional checkpoint (committed, needs deploy).** The final
analyze invocation now seals cost+batch conflicts across **all persisted
windows** with one D1 JSON update; a product split between rows 2 and 302 can
no longer evade review just because it crossed a queue boundary. The seal is
idempotent and the summary records whether/how many rows require Confirm
Action. Approval is server-gated: stock actions require Products + Inventory +
Sales permissions, `awaiting_review` compare-and-set state, and an explicit
`confirm_stock_actions: true` for any conflicted plan; confirming actor/time
are persisted. Migration `0056` adds an apply ledger. New-product creation uses
a stable SHA-256 client request id and retry-safe branch zero seeding. The ADD
writer atomically commits ledger claim, product batch, branch-batch stock,
branch/product aggregates, optional prices, movement history and applied
marker; injected failure rolls everything back and retry cannot double stock.
**Still closed at this historical checkpoint (superseded by Parts 359–362):**
grouped-sale/FIFO deduction, apply orchestration, reviewed-source sealing,
public `stock_actions` allow-list and the stock-action §13 review UI.
Commits: `a09b2996`, `ea57e403`, `9fd5c0cf`, `85fe2c8b`.

**Part 359 — grouped-sale writer + apply engine WIRED (committed, needs deploy).**
Item 4's apply path is now complete and the engine is live-in-code (creation
still gated, see below). The atomic grouped-sale writer (`applyUnifiedStockSale`)
commits one receipt per `saleGroupKey`: sale header, line items, FIFO
allocations across lots (earliest expiry first, explicit lot labels reserved
before FIFO), branch/batch/product stock deductions, and the idempotency seal
— all or nothing. Availability is a **transaction-enforced CHECK** (migration
`0057`'s `import_stock_action_guards`), so a concurrent sale can never make an
import silently clamp or oversell; the old POS `MAX(0,…)` clamp gap does not
exist here. `runImportApply` no longer fails closed on `stock_actions`: a
dedicated, **isolated** `applyStockActionsJob` classifies the sheet, groups
rows into receipts, and dispatches each `create`/`add`/`sale` through the
atomic writers — it never reaches the generic products/sales-shaped write tail,
so no existing import type can be disturbed by it. Design decisions worth
keeping: (a) a **single whole-sheet pass**, not the chunked cursor — sale
grouping depends on the resolver's mode + per-branch numbers (a blank-action
reconcile drop is an inferred daily sale), which no SQL `GROUP BY` can
reproduce; windowing by any SQL key would split an inferred receipt and the
writer's idempotency seal would silently drop the second half. Kept
operator-scale by `STOCK_ACTION_MAX_UNITS`. (b) **Partial-receipt prevention** —
a blocked line has no `saleGroupKey`, so its would-be key is re-derived and the
whole receipt is poisoned; a sale group never commits some lines and drops the
rest. (c) **Per-unit error isolation** — an oversell/guard failure fails only
its own group (`completed_with_errors`); every other unit still applies. (d)
**Whole-job retry is idempotent** — no double receipt, no double deduction. The
apply-phase finalize was extracted into one shared `finalizeImportApply` so the
generic and stock-action paths can never disagree on how a finished import is
recorded (same single-source-of-truth rule as `attachBatchCounts`).
**Closed on purpose at Part 359 (superseded by Part 361):** the public `stock_actions` allow-list
(`ALLOWED_TYPES`) still omits the type — the engine is ready and safe, but
CREATION stays gated until the §13 two-screen import UI lands, so no half-wired
feature is exposed. Commits: `0e7192bb` (grouped writer), `131aa13d` (apply engine).
Tests: `test-stock-action-sale-commit-pure.cjs` (writer: FIFO, oversell,
rollback, retry, bounds), `test-stock-action-apply-pure.cjs` (engine end-to-end:
add / create / FIFO sale group / whole-job idempotency / oversell isolation /
partial-receipt prevention, against a real in-memory SQLite).

### 13 — Import UX: exactly TWO screens, ALL imports, ALL pages (Part 354)

**Part 361 — unified stock-action import is LIVE end-to-end (committed, needs deploy).**
The §12 engine is now reachable: `ALLOWED_TYPES` admits `stock_actions`, and a
new server-backed two-screen `StockActionImportModal` replaces the old
client-side `AddSaleImportModal` on the wizard's Add-Sale mode. **Screen 1**
uploads the one ten-column sheet and picks Direct vs Reconcile with a
client-side row/issue preview; **Screen 2** polls the analyzed job and shows
the resolved counts + conflicts behind an explicit **Confirm** gate
(`approveImportJob` forwards `confirm_stock_actions`). Apply runs in the
background queue through the atomic/idempotent/oversell-proof engine — never a
browser-side apply. The review-state logic (`analyzing`/`needsConfirm`/
`canConfirm`) is a pure, unit-tested helper (`stockActionImportModel.ts`) shared
by the modal and its tests. The old `AddSaleImportModal.tsx` was deleted (its
`addSaleImport*` helpers stay — `importModeDetection.ts` still uses them). This
is the stock-action slice of §13; the full 2-screen rework of every OTHER
import type is still open. Commit: `3bb9a67d`. Test: `stockActionImportModel.test.ts`.

**Part 362 — full-flow proof + review/apply hardening (committed, needs deploy).**
The previously unproved analyze half now has a real multi-invocation harness:
151 CSV rows are range-read from R2, materialized in bounded windows, classified
across two queue windows, persisted one-for-one for Screen 2, and sealed so a
same-product cost/batch conflict split between rows 2 and 152 still requires
confirmation. It proves analyze writes no products/stock/movements, releases
every lease, honors cancellation before R2, and rejects oversized sheets before
classification. The test found and fixed a shared bug: analyze's final SQL named
`@errored` without binding it, so `failed_rows` was stored as `NULL`.

The reviewed plan is now server-sealed by lifecycle: CSV replacement is allowed
only before start or after failure; stock-action row overrides are refused; and
`/retry` on `awaiting_review` can no longer bypass `/approve` + Confirm Action.
Apply is capped at **480 raw rows / 60 business units**, leaving headroom under
Workers Free's internal-service-subrequest ceiling even for a new product that
touches two branches. Queue-entry cancellation and both limits are directly
tested. Screen 2 now fetches the authoritative persisted rows and shows
product/date, computed branch action + quantity, status and conflict/error
reason, with pagination/search/action filtering. The shared review API performs
COUNT/filter/LIMIT/OFFSET in D1 instead of loading and JSON-parsing the whole job
on every request—also a concrete §11.18 contacts-speed improvement. Commits:
`7b201ee5`, `f554e736`, `f0d5626e`, `3286bea9`, `417ca902`.

**Part 363 — contacts review hardening + the real product Screen 1 merge
(committed, needs deploy).** Contacts review now uses the shared D1-paginated
review endpoint with server search (name, phone, email, membership number,
barcode and identifier), conflict filters, a bounded 50-row page, alphabetical /
reverse / source-row sort, and durable persisted merge decisions. Commit:
`af19985c`.

The product wrapper no longer renders a fake mode/template/upload page and then
opens a second importer. It is now only the mode owner. The **real** product and
stock-action import modals share the wrapper's compact Mode and Options design;
the real template, file picker, optional image folder/ZIP/library picker and
information all live on Screen 1, while the duplicated image picker was removed
from review. Commit: `aca7f1dd`. Verified in the local Worker at desktop width:
mode/options rendered first, followed by template, real upload, optional images
and information; switching to Stock Actions stayed inside the same modal. The
temporary local visual-test user was deleted afterwards.

**Historical status at Part 363; superseded by Part 368.** Product CSVs still performed a
client review before creating the server job, then the background job can reach
its own `awaiting_review` gate. The remaining product work is to make Screen 1
create/upload/analyze the job and make Screen 2 read the authoritative persisted
server rows and approve them—one review, never two. Sales and inventory still
need the same conversion. Tests for this part: frontend full chain **120/120**,
`tsc --noEmit` clean, source check **371 files**, production build **877 modules
in 13.72s** (only the existing circular-chunk warnings). Backend was not changed
by these two commits; the Part 362 backend sweep remains **78/78**.

**Part 364 — Contacts is now an exact, fail-closed two-screen import
(committed, needs deploy).** Commit `0773b470` closes the remaining Contacts
transition and a real approval loophole found while tracing it. **Screen 1** owns
template, policy and the one actual file upload/start. Server analysis is only a
loading state. **Screen 2** is the authoritative paginated conflict review and
now owns **Confirm & import** directly—there is no Done → separate Approve
screen. “Review later” safely hands the existing job to the tracker without
applying it.

Every name/phone conflict now needs a durable row decision. Phone acknowledgment
previously existed only in React state; it now persists `action: apply` like an
explicit merge. D1 computes one server-wide unresolved count across every page
using bound SQL + JSON decision lookup, so page 1 cannot claim completion while
page 2 still has conflicts. `/approve` independently recomputes that count and
returns `409 contact_conflicts_unresolved`; bypassing or racing the UI cannot
apply an unreviewed Contacts job. Verification: backend **78/78**, frontend full
chain **120/120**, both typechecks clean, real SQLite decision/count proof, and
production build **877 modules / 14.12s** with only the existing circular-chunk
warnings.

**Part 365 — Sales + Inventory now use the same authoritative Screen 2
(committed, needs deploy).** Commit `af261352` adds one shared
`ServerImportReviewScreen` and removes both modals' old “queued; go find the
top-right tracker” dead end. Their existing mode/template/real upload remains
Screen 1. After start, the same modal polls only job status, then Screen 2 reads
persisted `import_job_rows` with D1-backed 50-row pagination, search, fixed
action filters and fixed sort options. **Confirm & import** is protected by a
synchronous duplicate-action guard and calls the server approval gate; **Review
later** deliberately hands the still-unapplied job to the tracker. Parent pages
are notified only after one of those explicit outcomes, not merely because the
file was queued.

This closes the §13 screen-structure work for the existing Sales and Inventory
imports, but it does **not** claim the new §11.29 sales spreadsheet contract is
done: first-row invoice inheritance, strict 24-hour time, delivery revenue vs
restricted actual cost, and full import/export round-trip remain open. At Part 365,
Product was the only existing import modal with the duplicate client-review → server-
review architecture; **Part 368 removes that duplication.** Verification: frontend full chain **120/120**, source check
**372 files**, typecheck clean, and production build **878 modules / 27.99s**;
only the two pre-existing catalog circular warnings remain (an extra shared-
chunk cycle found during the first build was removed before commit). Backend was
unchanged; Part 364's **78/78** sweep remains current.

**Part 366 — iPhone storefront install branding corrected at the production root
(committed, needs deploy).** The static HTML route bootstrap disagreed with the real
router: it always classified `/` as admin, although `/` on
`leangcosmetics.dpdns.org` is the public storefront. It therefore presented the
Business OS manifest, Apple title and `apple-touch-icon` while iOS captured Add to
Home Screen metadata. `PublicCatalogPage` later swapped ordinary favicons/manifest,
but never the Apple-specific metadata.

Commit `1711a351` makes the parser-time bootstrap hostname-aware, gives the root-path
case precedence over the admin route table, and selects the static Leang manifest,
favicon, Apple title and a new opaque 180x180 versioned touch icon before React loads.
The runtime effect also maintains the Apple metadata. The Leang manifest now uses real
safe-zone maskable icons, and the service worker caches every storefront manifest/icon
asset. `brandIcons.test.ts` executes the real inline bootstrap against public-root,
admin-host, localhost and loopback DOM doubles and checks the 180x180 PNG dimensions.
Verification: full frontend `test:utils` **120/120 green**, icon generator `--check`
green, TypeScript/source checks clean, and production build **878 modules / 30.50s**
with only the two existing catalog circular warnings. Live iPhone verification still
requires deployment; remove the old home-screen shortcut before re-adding because iOS
caches installed icon URLs aggressively.

**Part 367 — Product server review now fail-closes on unresolved safety conflicts
(committed, needs deploy).** Commit `e28b116b` adds the prerequisite that was missing
before the final Product two-screen conversion: Product approval can no longer pass a
barcode collision, SKU collision or negative-stock coercion merely because the UI did
not open a resolver. D1 counts unresolved flagged rows across every persisted review
page using bound JSON/SQL; both `GET /review` and `POST /approve` use that source. Direct
API approval returns `409 product_conflicts_unresolved` until each row has a durable
choice.

The global tracker now opens a Product-specific resolver. Each flagged row explains the
consequence and records either **Use safe result** (collision remains a separate product;
negative stock becomes 0) or **Skip row**. Decisions survive refresh/page changes and
approval remains server-gated even if the frontend is bypassed. This was the Part 367
safety checkpoint, **not yet completion of Product §13 at that point**: `BulkImportModal`
still showed its client review before creating the server job. **Part 368 completes that
consolidation.** Verification: backend **78/78**, frontend full chain
**120/120**, both typechecks/source checks clean, and production build **879 modules /
26.66s**, with only the two existing catalog circular warnings.

**Part 368 — Products and image-only imports now use one authoritative two-screen
flow (committed, needs deploy/live-browser verification).** Commit `a31bbd80` removes
the remaining client-side Product review and the duplicate synchronous full-file
preflight. Screen 1 now owns mode/options, detail policy, template, real CSV/Excel
selection, optional folder/ZIP/Library images, header/scientific-barcode validation and
the dated-reconciliation warning. Local parsing cannot serialize `_action`, target ids
or other client review decisions into the upload. **Upload & review** creates/uploads
once and starts the bounded queued analysis.

Screen 2 polls that job, pages/searches/filters/sorts the persisted D1 review (50 rows at
a time), restores durable decisions, exposes update stock modes, and is the only place
that can explicitly Confirm. Barcode/SKU collisions and negative-stock coercions show
**Choose a safe result…** until a real apply/skip decision has been saved; the existing
server `409 product_conflicts_unresolved` gate remains authoritative if the UI is
bypassed. Review Later hands the same job to the tracker, Cancel remains available while
analysis runs, duplicate approval is guarded, and an image-match-triggered re-analysis
refreshes Screen 2 by job revision. Image-only imports use this same review instead of
closing into the tracker. Removing the synchronous preflight avoids an extra full-table
classification before queued analysis, reducing Worker/D1 work on the Free plan.

Verification: frontend `test:utils` **all 120 files green**, TypeScript/source checks
clean, Cloudflare typecheck + import-engine + image-match suites green, and production
build **880 modules / 27.68s** with only the two existing catalog circular warnings.

**Part 369 — Production sales import/export core is complete in code (committed,
needs migrations/deploy/live-browser verification).** Four pushed commits close the
real §11.29 data path without conflating it with the still-open restricted-delivery
schema in 11.27:

- `6970334d` seals compact multi-line invoice inheritance during bounded CSV
  materialization. Only the first row needs receipt/customer/payment fields; blank
  following rows inherit the preceding explicit invoice across 100-row Worker
  continuations. The JavaScript classifier and SQL group window use the same stored
  key, so analyze and apply cannot split a receipt or drift on retry.
- `99cce5e8` adds fail-closed historical timestamps (`YYYY-MM-DD HH:mm` 24-hour,
  `MM/DD/YYYY HH:mm[:ss]`, or explicit-zone ISO), interpreted in the canonical
  Asia/Phnom_Penh business timezone. Impossible dates/24:00 now block review instead
  of silently becoming another date or apply-time “now.” Product lookup is
  SKU→barcode→unique name (ambiguous names never guess), and exported historical
  per-line cost snapshots override today's catalog cost so COGS survives.
- `136ddef4` creates one `SALES_IMPORT_COLUMNS` source for template guidance,
  two-row compact example, selected/visible XLSX and detailed CSV. Exports are real
  line items, order fields appear only on line 1, Khmer/phone/barcode-safe XLSX stays
  available, and the detailed CSV has no decorative report preamble so it reimports
  directly. Base/product/manual discount metadata, KHR/USD price/cost, batch label,
  returned quantity, customer/payment/membership/delivery-charge fields and notes
  round-trip. Migration `0059` preserves imported per-line returned quantity.
  Oversized 5,000+ sale report ranges fail export with a narrow-range instruction
  instead of silently downloading a partial ledger, and `/sales/export` now enforces
  the `sales` permission.
- `a6c4cf09` removes the concurrency-unsafe “last N sales IDs” linkage and the three
  separate header/items/return-stock transactions. Migration `0060` adds a per-job
  receipt commit ledger; deterministic `client_request_id` resolves the parent ID
  inside one D1 batch. Header, every item, any product/branch/batch return increment,
  movement, and applied marker now commit or roll back together. At-least-once queue
  retry is idempotent, and each receipt is capped at 50 lines so the largest atomic
  transaction stays bounded for Workers/D1 Free.

Verification performed after these changes: frontend full `test:utils` **all 120
files green**; Cloudflare `test:import-engine` (now including the new real-SQL atomic
sales writer test) green; both typechecks and frontend source check clean; all **61**
migrations apply cleanly in the real SQLite harness; production build **881 modules /
23.86s**, with only the two existing catalog circular warnings. The atomic test forces
the final movement write to fail and proves sale/header/items/stock/ledger all roll
back; retries do not duplicate sales or return stock; an unrelated newer sale cannot
steal the lines; and the 50-line bound fails before a transaction is built.

*User, this session + mid-turn clarification.*

- **Screen 1 — upload.** ALL modes and their options on ONE screen; the
  file is picked and uploaded here. Today the products import fans out into
  several "Upload File & continue" steps — collapse them.
- **Screen 2 — review before the import officially starts.** The resolved
  rows / conflicts, then Confirm. **Only after Confirm does the real import
  run.**
- **No separate "analyze → resolve conflict → review → upload" chain** — the
  user calls the current contacts-import flow (analyze for a long time,
  THEN review, THEN upload) redundant. One upload screen, one review-before-
  commit screen, everywhere (products, contacts, sales, inventory).
- Contacts import is ALSO reported as far slower than the general import
  (§11.18). Its review screen's missing sort/search/filter work (§11.19) is
  complete in Part 363, and Part 364 closes the exact two-screen conversion
  with a server-enforced unresolved-conflict gate.
- **Exact product Screen 1 design (clarified after Part 362):** retain the
  wrapper's Mode and Options card design, but it must surround the REAL
  template, REAL upload, information and image inputs. Part 363 completes this
  visual/setup merge. Part 368 completes the authoritative server-review conversion.

### 14 — Batch count + "View details" across Products / Inventory / Branch (Part 354)

*User, this session.* Wherever batches surface, show the NUMBER of batches
plus a **View details** button that opens the specific per-batch stock,
details, and the date of each available batch — the same interaction as the
"view stock movement" detail already on the Inventory products page (click
View detail). Needs: a backend read returning per-(product[,branch]) batch
rows (product_batches joined to branch_batch_stock: lot_code, received_at,
expiry_date, per-branch quantity), and a shared "batch details" modal used
by all three pages. **DONE (Part 354), needs deploy.** Count now shows on BOTH product-grid pages (Products + Inventory) via one shared `attachBatchCounts` (`lib/productBatches.ts`), and the "Batches (N)" affordance opens the existing per-branch/per-lot `ManageBatchesModal` (each batch's date, expiry, per-branch qty). Products already wired that modal — it was only missing the count. Branch page left as-is: its only batch UI is the transfer picker, not a per-product grid, so the count belongs on the two product grids. **Remaining (optional):** a strictly read-only "view" variant if the editable ManageBatchesModal is deemed too much; and a per-branch batch view on the Branch page if one is wanted later.

**Original finding:** the data always EXISTED — production has 6,691
`product_batches` (all active) and 3,668 non-zero `branch_batch_stock`
rows. So "Inventory shows 0 batches" (§4.2/§11.23) is a DISPLAY-READ gap,
not missing data: `routes/inventory.ts` has no batch_count in its product
SELECT. The backend read that powers the modal, attached to the inventory +
products list reads, closes §4.2/§11.23 at the same time.

### 7 — Library

| # | Task | Status |
|---|---|---|
| 8.1 | Click an image to open **details**: what is using it (which products/rows), edit, and rewire. | not started |

### 15 — One stored image, many library names — SIMPLIFIED (user, Part 354)

An image is often the same photo reused across color variants of one item
(Anastasia Blush Stick **Nectarine / Peachy Keen / Soft Rose**). The user
does NOT want physical copies or a schema migration for this. The simple
model, in their words: "store the first image, but in UI in library show
multiple rows... when download, we do renaming."

So:
- **Storage:** ONE object. Wiring the same photo to several products keeps
  pointing every product at the one `public_path` — which `wire-images`
  already does (no copy). Nothing new is stored.
- **Library UI:** for that one object, show a ROW PER referencing product
  name (Nectarine, Peachy Keen, Soft Rose), derived from which products
  point at it (`products.image_path` / `product_images.image_path` = this
  object's path). It reads as three named images; it IS one file. A
  storage/"used by" line makes the sharing visible.
- **Download/export:** the rename happens HERE, not in storage. Downloading
  offers the object under a chosen name, or one copy per referencing name
  (`<Product>_1.jpg` each) — the user decides at download time.

**No migration, no dedup hashing, no alias table** — this supersedes the
heavier design first sketched here. The work is: (1) a Library grouping that
lists an image once per referencing product name (a read over
products/product_images by shared path), and (2) a download/export step that
renames on the fly. The import rename rule is unchanged; it just no longer
implies a separate stored file when the same photo serves several products.

**DONE in code (Part 357, needs deploy).** `GET /api/files` now builds one
logical row per distinct active product reference across both cover and gallery
paths, while an unreferenced physical asset remains one row. Search, count and
pagination operate on those logical rows. Migration `0055` indexes both path
joins so this does not add a full products/product_images scan to every Library
page. The UI gives each logical row its own selection key, shows the derived
`<Product>_1.ext` name plus the one shared stored filename, and can download
several selected references as separately named files. `GET
/api/files/:id/download` streams the same R2 body with a sanitized Unicode
`Content-Disposition`; it never copies/renames the object and remains gated by
Full Library access. Commits: `1f0d00b8`, `b1bf46cb`, `0f72c9aa`.

### Execution plan locked Aug 27 2026 — §§11, 12, 13 and 15 plus storage, media, contacts and safeguards

**Status: PLAN LOCKED; this entry does not mark implementation complete.**
When an older historical note conflicts with this section, this section is
authoritative. Existing completed Parts 346–355 remain unchanged and must be
deployed and baseline-tested before the new phases begin.

#### Locked product decisions

- **Images:** normalize every static-image entry point through one server-side
  pipeline. An image at or below 350KB may still be metadata-stripped and
  converted to WebP when that produces fewer bytes while preserving roughly
  **80–90%+ visual quality**; it does not undergo the aggressive resize/quality
  ladder and is never enlarged or padded to reach 300KB. Only an input above
  350KB uses the full ladder: orientation/metadata and format first, dimensions
  second, quality/compression last. Choose the largest/highest-quality valid
  result no larger than 350KB, with 300–350KB a target band when naturally
  achievable. Never save a larger transformed result over a smaller source.
- **Image count:** normal users/products/name-groups get at most **3** images;
  an administrator may explicitly allow up to **5**. The API rejects excess
  attachments with a clear 409 instead of silently slicing them. The cap covers
  the union of the group owner and child references, all file/camera/library,
  import, avatar, promotion, portal and settings upload paths.
- **Returns/replacements (§11.12–11.13):** the default is an even exchange from
  same-name stock. The user can instead settle the price difference or complete
  a refund followed by a new sale. Non-default price adjustment requires full
  access and an explicit preview. Returned stock is classified as no restock,
  restock as sellable, or restock as damaged.
- **Damaged stock:** use traceable damaged-stock lots tied to the exact return,
  branch and batch; do not create duplicate “damaged” product records. POS and
  stock pickers display Damage alongside batch/branch/barcode/SP/VIP, never cost.
- **Imports (§12–§13):** retain detailed import artifacts for **24 hours** and a
  compact summary for **7 days**. Every import has exactly two screens: upload,
  then resolved review/confirm. No business write occurs before confirmation.
- **Library (§15):** one R2 object can appear as multiple logical rows named for
  its product references. Downloads rename on the fly; no physical copies and
  no alias/dedup migration.
- **Backups:** R2 retains exactly the newest **2 finalized, verified** backups.
  Google Drive retains exactly the newest **7 finalized, verified** backups.
  Create and verify the replacement before deleting the oldest. Failed,
  cancelled, partial and stale-running jobs are visibly classified and cleaned
  without counting as valid retained backups.
- **Path-width UI:** narrow all three identified path fields (backup export path
  and both import image-folder path displays), keeping full values available by
  tooltip/copy/expand.

#### Phase 0 — baseline, deployment safety and measured evidence

1. Preserve the dirty worktree and deploy the already-completed Parts 346–355
   only after their existing backend/frontend/type/build/migration checks pass.
2. Capture before-change R2 inventory by prefix, object count, bytes, age and
   multipart state; capture D1 table/page counts and query metrics. The current
   audit found about **273MB/136 live R2 objects**, while 51 optimized image
   objects total only about **9.6MB** and imports about **14MB**; most live bytes
   are backup manifests and copied backup assets. A dashboard value above 900MB
   can therefore be a daily/GB-month measurement rather than current live image
   bytes and must be reconciled from Cloudflare metrics, not guessed.
3. The current D1 audit found about **243MB**, with roughly **193MB** in import
   staging source/result JSON plus orphan staging rows. The observed 24-hour
   query load (about 142.6M rows read / 799.8K written) is far beyond the free
   daily allowance and makes query-shape/index work a release blocker.

#### Phase 1 — stop storage growth and make asynchronous jobs finite

1. Add explicit job states and leases: queued, running, cancelling, cancelled,
   succeeded, failed and stale. Cancellation is idempotent, workers check it at
   bounded intervals, leases expire safely, retries use stable idempotency keys,
   and the UI exposes retry/cancel/cleanup rather than leaving “stuck” rows.
2. Move large import source and per-row result payloads from D1 into compressed
   R2 NDJSON. Keep only summaries, cursors, conflicts, lease/idempotency markers
   and short diagnostic text in D1. Delete detailed objects at 24h and summaries
   at 7d; clean existing orphan staging only after a dry-run report and backup.
3. Make backup artifacts self-describing and finalized only after manifest,
   assets and checksums verify. R2 pruning always keeps the two newest verified
   backup sets, and removes partial/stale artifacts separately.
4. Drive sync mirrors the newest verified R2 backup rather than creating a
   second backup. Upload the manifest **and every referenced asset** with
   resumable, chunked uploads (256KB-aligned chunks), tagged `appProperties`,
   bounded queue continuations and retry-safe session state. Verify the Drive
   set before pruning tagged old sets to seven. Add Drive listing, staged restore
   and checksum verification. Never auto-delete unrelated Drive files.

#### Phase 2 — §11 returns, replacements and damaged inventory

1. Add explicit `ReturnStockAction`, `ReplacementSettlement` and
   `StockCondition` values plus `damaged_stock_lots` and
   `return_replacement_items` records. Migrations are additive and reversible.
2. Build one stock-action chooser with a before/after consequence preview.
   Replacement selection uses the POS option picker constrained to same-name
   stock. Even exchange is preselected; difference settlement and
   refund-then-sale show all money/stock effects before confirmation.
3. Commit sale reversal, restock/damage movement, replacement deduction,
   settlement and audit events atomically, guarded by permissions, expected
   versions and an idempotency key. A retry cannot double-refund, double-restock
   or double-deduct.

#### Phase 3 — §§12–13 import engine and two-screen UX

1. Ship the single ten-column stock template and Direct/Reconcile semantics
   already specified in §12, including `sale` daily grouping and `saleN`
   receipt grouping.
2. Stream parse into R2 staging; resolve products, branches, batches, prices and
   conflicts in bounded chunks. Review supports search, alphabetic sort and
   filters, including contacts. Confirmation seals an immutable plan hash; only
   then may apply start.
3. Apply through bounded transactions with indexed keyset pagination, leases,
   cancellation checkpoints and idempotent chunk markers. Never rescan the full
   CSV, full sales grouping or full image-match catalog for every chunk.

#### Phase 4 — image pipeline, providers, counts and §15 library

1. Route file picker, camera capture, library upload, ZIP/folder/data-URL import,
   avatars, promotions, portal/settings and server attach APIs through one
   validation contract. Verify magic bytes by decoding, enforce pixel/dimension
   and decompression-bomb limits, strip metadata, correct orientation, sanitize
   filenames, use random object keys and reject SVG/polyglot/unsupported content.
2. Cloudflare transformation is the primary path and the existing Cloudinary
   secret is the bounded fallback. Fix Cloudinary incoming transformations,
   delete temporary provider assets, count attempts as well as successes, cap
   concurrency, and fail closed when no provider can produce a compliant object.
   Never expose provider secrets or accept a client-supplied transformation URL.
3. Generate only bounded variants (`thumb` 192px, `card` 640px, `detail`
   1600px) and guard unique transformation dimensions/quality to prevent abuse.
   Store a normalized master once and serve cached variants; periodically audit
   R2, report noncompliant/orphaned objects, and require a reviewed admin action
   for backfill deletion/replacement.
4. Replace every hidden hard-coded five-image client cap and every server-side
   silent slice with the shared, server-derived 3/5 policy. Concurrent attaches
   must remain within the cap transactionally.
5. Implement §15 as a reference-aware Library read: each shared path can render
   one logical row per product name, while details expose the single stored
   object and every “used by” reference. Export streams the same bytes with the
   chosen logical filename.

#### Phase 5 — contacts duplicate-resolution safety and clarity

1. Replace opaque Keep/Resolve/EyeOff actions with an expandable side-by-side
   comparison, permanent legend/help, field differences, sales/returns/loyalty
   history, explicit keeper choice and a before/after preview explaining every
   reassigned reference and discarded value.
2. Let the user choose the source for conflicting fields. The server returns an
   immutable merge plan; commit checks `updated_at` versions and performs keeper
   backfill, all reference moves, loyalty/history handling and duplicate removal
   in one atomic, idempotent operation.
3. Remove implicit pair ordering and “merge first into second” bulk behavior.
   Bulk merge accepts only explicit reviewed plans; clusters of three or more
   are never skipped silently. Destructive deletion of a contact with history
   requires admin + `destructive_delete` + typed-name confirmation. Dismissals
   have a visible filtered view and undo.
4. Add normalized, indexed identity keys so duplicate discovery does not rely on
   repeated full-table scans.

#### Phase 6 — application, AI and free-plan safeguards

1. Apply least-privilege server authorization to every mutation; validate all
   schemas and content types; use parameterized SQL, allowlisted sort/filter
   fields, bounded page sizes, statement/time limits and transactional invariants.
2. Use Cloudflare Workers Rate Limiting bindings on costly/authenticated actions,
   Turnstile on login recovery and public/high-risk actions, and one focused free
   WAF rule for public AI/abuse surfaces. Do not spend D1 writes on high-frequency
   rate-limit logs.
3. Put AI calls behind server-side quotas and AI Gateway telemetry/rate limits.
   Treat prompts, retrieved data and model output as untrusted: isolate system
   instructions, allowlist tool/action IDs, require strict output schemas, cap
   tokens/context/time, escape rendered output and require human confirmation for
   destructive or financial operations. Never let model text become SQL, URLs,
   headers or tool arguments without validation.
4. Add CSP in report-only mode before enforcement, CSRF/origin protection,
   secure cookies/session rotation, replay protection, upload/download headers,
   audit events without secrets/PII, Analytics Engine counters and alertable
   quota/error/latency/storage dashboards. Use bounded Queues for resumable work;
   do not add a paid or novelty service where a free-plan primitive suffices.

#### Deep test and release gates

- **Images:** magic-byte spoof, malformed/truncated files, EXIF rotation, huge
  dimensions/decompression bombs, animated inputs, transparency, WebP already
  below 300KB, source within 300–350KB, source above 350KB, provider timeout,
  Cloudinary cleanup, concurrent fourth/sixth attach, group union, import/camera
  bypass attempts, visual-quality fixtures and “never larger than source” checks.
- **Backups/storage:** interrupted multipart/chunk upload, stale lease, duplicate
  queue delivery, cancellation at every phase, corrupt checksum, missing asset,
  Drive 401/403/429/5xx and resume, restore round-trip, exactly 2 R2 / 7 Drive
  verified sets, and proof that unrelated Drive/R2 objects cannot be deleted.
- **Imports/D1:** million-row synthetic streams, quoted multiline UTF-8 data,
  conflict review, plan tamper, confirm race, cancel/retry, duplicate delivery,
  bounded memory/CPU/statements/rows-read, retention cleanup and orphan repair.
- **Returns/contacts/security:** concurrent stock change, replayed settlement,
  atomic rollback, permission matrix, three-plus duplicate clusters, stale merge
  plans, reference preservation, CSRF, IDOR, injection, stored XSS, rate-limit
  evasion, prompt injection/tool abuse and log/secret leakage.
- Every phase must pass backend suites individually, the full frontend test chain,
  both TypeScript checks, production build, migration validation and Wrangler
  configuration validation. Deploy in small phases, compare storage/D1/CPU/error
  metrics for 48 hours, and keep rollback paths. Update status rows only with
  test and deployment evidence; “planned” is never reported as “done.”

#### Continue after these phases

Resume the ordered tracker with server-backed undo/redo, remaining §14 batch
details, rename/regroup and orphan-image repair, stats/tooltips, then portal
pagination/cache/performance. Re-measure Cloudflare usage before each expansion.

### 8 — Identity rule, remaining

| # | Task | Status |
|---|---|---|
| 9.1 | **Rename does not regroup.** A renamed product does not re-merge into its new name group or re-split the old one. `name_key` is trigger-maintained so the flag is right, but nothing reconciles the rows. | not started |
| 9.2 | **Auto-merge flag + filter** so the user can see what merged automatically. No column exists yet. Relevant scale: the real file merges **2,013 rows** into other rows in-file, and the FIRST row's details win — those 2,013 losing values are currently invisible. | not started |

### 9 — Correctness carried over

| # | Task | Status |
|---|---|---|
| 10.1 | **Backup restore loaded the whole document into memory.** **DONE (Part 355), needs deploy.** `restoreCloudflareBackup` called `object.json()` (the ENTIRE backup parsed into one object) then built an INSERT for every row before applying any — so a database big enough to have OOMed its backup OOMed restoring it (the worse failure: you restore precisely when things are already bad). Now streams the R2 body through a new `lib/backupRestoreStream.ts` and applies rows in bounded 80-row batches; peak memory is one row + a small carry buffer, never the whole backup. Two passes keep the FK-safe delete order (learn present tables → reverse-delete → stream-insert). The scanner only finds token BOUNDARIES (string/escape aware) and hands each row to the trusted `JSON.parse`, so a truncated/corrupt backup throws loudly rather than silently mis-restoring; corrupt *asset-list* metadata degrades (best-effort) instead of undoing a good table restore. `test-backup-restore-stream-pure.cjs` (12 checks incl. per-char + 200 random chunkings) + the existing `test-backup-pure.cjs` round-trip now drives the streaming path. | done (Part 355) |
| 10.2 | Edit form does not auto-move sections back to Details — reported as a bug; not yet reproduced. | not started |

### 16 — Branding / PWA / media / notes batch (Part 354)

| # | Task | Status |
|---|---|---|
| 16.1 | **PWA install + correct storefront icon** (leangcosmetics.dpdns.org). **DONE in code (Parts 355 + 366), needs deploy/live iPhone verify.** Part 355 removed the non-installable blob manifest from the real public component. Part 366 fixed the remaining iPhone-specific root-route bug: static HTML classified production `/` as admin and never swapped `apple-touch-icon`/Apple app title. Public `/` now selects the static Leang manifest, favicon and a versioned opaque 180x180 Apple icon before React; admin/localhost remain Business OS. Real Leang maskable icons and service-worker caching were added. Full 120-test frontend chain + production build green. After deployment, delete the old iPhone shortcut before re-adding because iOS caches installed icon URLs. Commit `1711a351`. | done in code; needs deploy/live iPhone verify |
| 16.2 | **Logo preview matches the applied header; vertical/horizontal focus work when zoomed.** **DONE (Part 354), needs deploy** - editor preview + live header now share one `buildLogoImageStyle` (identical zoom clamp, so preview == applied and the full 80-180% range ships), and the zoom now originates at the focus point so H/V sliders stay meaningful when zoomed. Live header also honors fit=contain now. `logoImageStyle.test.ts`. | done, needs deploy |
| 16.3 | **Notes reorder now works on touch.** **DONE (Part 354), needs deploy** - replaced HTML5 `draggable` (no touch support) with pointer-event drag on an always-visible grip: press, move over a note (elementFromPoint -> nearest [data-note-id]), release to drop before it; blue top-border marks the target. reorderNotes unchanged. | done, needs deploy |

### 11 — NEW request batch, Aug 26 2026 (Part 354, post-compaction)

*Verbatim from the user's own message. Several overlap earlier rows — cross-referenced, not duplicated. Nothing here is started.*

**Selection / table chrome (ALL pages, not just Products)**

| # | Task | Status |
|---|---|---|
| 11.1 | **Select column only takes space in select mode.** **DONE on Products (Part 354), needs deploy** — the `<col>` collapses to 0 and the cells drop padding out of select mode. Mobile already did this. **Open:** apply the same to Inventory/Sales/Returns/Branches/contacts surfaces. | products done; other pages open |
| 11.2 | **Remove the redundant select-column header checkbox.** **DONE on Products (Part 354), needs deploy** — the toolbar "Select all (N)" stays; the dead ref/props were cleaned. **Open:** other pages. | products done; other pages open |
| 11.3 | **Hold-to-select on the group title row.** **DONE on Products desktop (Part 354), needs deploy** — long-press selects the whole group, with a ghost-click guard so it does not also toggle expand. **Open (optional):** the mobile group header. | done (desktop) |

**Products page — images & alignment (revises 4.1, now shipped)**

| # | Task | Status |
|---|---|---|
| 11.4 | **Category header aligns with the IMAGE column.** **DONE (Part 354), needs deploy.** Two rails now: category label on the image column, group titles + product names on the name column, child rows a small nudge (`pl-6 pr-2`) past the group title. Measured in a browser at 900/1400px, constant. `CATEGORY_BAND_SPAN = FULL_WIDTH_ROW_SPAN + 1` (the extra column is the image column); test asserts it. |
| 11.5 | **Child rows showed photos not on the group title.** **DONE (display half, Part 354), needs deploy.** Root cause was NOT the child rows (they already render no thumbnail) — it was `buildGroupThumbnailState` returning only the FIRST member with images, so a sibling's photo was orphaned/invisible while the header showed a different one. The group gallery is now the UNION of every member row (lead first, deduped, cap 3), so the header shows the whole set and nothing is hidden. **Still open (data half):** "move that" — physically CONSOLIDATING scattered member photos onto the group owner row so they live in one place — is a server-side migration, folded into 11.7 below since both need the owner defined first. |
| 11.6 | **No image upload on child rows.** **DONE (verified, Part 354).** ProductForm already shows "photos belong to the whole group" instead of the uploader for a child row (Part 347), and the detail modal is read-only. Renaming a child out of the group restores its own uploader via name-based grouping, no dedicated path. |
| 11.7 | **Group image UI + owner consistency (blocks the "move" half of 11.5).** **Found a real inconsistency (Part 354):** the group HEADER picks its lead via `compareProductsWithinGroup` (a domain sort) in `productGrouping.ts`, but `ProductForm` decides image ownership by **lowest id** (`groupImageOwnerId = Math.min(...ids)`). Those can be DIFFERENT rows — so "Add image" from the group title (`renderGroupActions` → `openProductFormTab(lead)`) can open a form ProductForm treats as a CHILD, hiding the uploader. **Fix order:** (1) pick ONE owner definition (lowest id is the server-side + wire-path convention — align the header's lead to it), (2) then either a dedicated group-image modal or a lead-form image section relabelled "Group photos", (3) then a consolidation step that MOVES scattered member photos onto that owner (the 11.5 "move that" data half). Do NOT relabel before (1) or it lands on the wrong row. | not started |

**POS**

| # | Task | Status |
|---|---|---|
| 11.8 | **Add-new Delivery/Customer from POS failed.** **DONE (Part 354), needs deploy.** Diagnosed: the create returns 409 on a duplicate and the quick-add dead-ended on it. A `phone_conflict` (phone already belongs to someone) is a HARD block — now it SELECTS that existing contact instead of failing; a `possible_duplicate` retries once confirmed. `createApiError` now carries the matched contact. This also delivers the "create vs select existing" choice the user asked for. **If it still fails after deploy**, the next suspect is the `contacts` permission gate (a cashier lacking `contacts` 403s) — flag then. | done, needs deploy |
| 11.9 | **POS must NOT show cost price.** **DONE (Part 355), needs deploy.** The option picker (`posCore.ts::buildVariantOptionLabels`) disambiguated rows in a name group by COST when barcodes matched (stepTitle "Cost", cost-valued pills). Now it disambiguates by barcode → SELLING price → a neutral `#id`, and never reads cost; rows differing only by cost collapse to the neutral label (the batch picker settles which lot's COGS a sale draws from). stepTitle is `Barcode`/`Price`/`Option`. `posCore.test.ts` updated + a guard that no cost value ever reaches a pill. **Still open (bigger redesign):** the SP/VIP short-label price picker and the `damage` option (the latter depends on 11.13's damaged-stock chooser). | core done; SP/VIP+damage picker open |
| 11.10 | **POS naming: "Selling price", not "Regular".** **DONE (Part 354), needs deploy.** The add-to-cart button's `posCopy('Regular')` → "Selling Price". (Also 4.5.) The SP/VIP short labels for a full price-mode picker belong to 11.9's POS redesign. |
| 11.11 | **Discount %/$ toggles larger, fee input narrower.** **DONE (Part 354), needs deploy.** Both toggle locations (POS cart-level + CartItem per-line) bumped from `px-1.5 py-1 text-[11px]` to `text-sm` with min-width; the delivery-fee input capped from w-full to w-28. | done, needs deploy |

**Returns — replace flow + a shared stock-action chooser**

| # | Task | Status |
|---|---|---|
| 11.12 | **Add a "Replace" option to Returns.** On top of returning, hand the customer a new product from the SAME-NAME stock, choosing options the POS way (batch/branch/etc). | not started |
| 11.13 | **Merge the return options into one chooser with a stock-action.** Each option carries what happens to stock: (a) return, no restock / no stock change; (b) return, restock as the SAME stock; (c) return, restock as **damaged** — which adds a "damage" entry in the product's information. This damaged-stock concept then feeds POS and the other POS-related option pickers (see 11.9's `damage`). | not started |

**Settings / portal image separation**

| # | Task | Status |
|---|---|---|
| 11.14 | **Portal-editor images must NOT bleed into the admin app.** **DONE (Part 355), needs deploy** - the shared bleed was the FAVICON/manifest. Part 354 removed the swaps from the admin App + CatalogPage; Part 355 removed the LAST one, on the live `PublicCatalogPage.tsx` (see 16.1), AND deleted the now-orphaned `utils/favicon.ts` + `utils/portalManifest.ts` helpers, the vite favicon chunk rule, and every test that still asserted the removed feature. Favicon/PWA icon are fixed app branding (admin=Business OS, storefront=Leang, both static); portal editor + Settings customize only the in-page LOGO. No image now crosses into the browser-tab/PWA layer. | done (Part 355) |
| 11.15 | **Settings business logo is only the topbar logo; favicon stays default.** **DONE (Part 354), needs deploy** - the favicon-image upload is removed from Settings and the admin favicon swap is gone, so the topbar logo can no longer become the favicon. | done, needs deploy |
| 11.16 | **Delete the favicon image (Settings + portal editor).** **DONE (Part 354), needs deploy** - both favicon upload controls removed; icon is app default. (The original 11.16 "expose the wire-images button in Settings" is a separate, still-open idea.) | favicon removal done |
| 11.17 | **The uploads/folder-path inputs are too wide.** Candidates found (Part 354): the backup folder-export path (`Backup.tsx:1750`, `input flex-1 font-mono`) and the import image-folder displays (`BulkImportModal.tsx:2922,3155`). Needs the user to confirm WHICH "uploads path input" (or all) before changing layout — not guessed. | needs user to point at it |

**Imports — contacts is slow and its review UI is bare**

| # | Task | Status |
|---|---|---|
| 11.18 | **Contacts import is far slower than the general import**, and its analyze→review→upload chain is redundant. **DONE (Parts 362–364), needs deploy.** Review reads are bounded in D1; Screen 1 uploads/starts once, then Screen 2 owns authoritative conflict resolution and Confirm. No Done→Approve third screen. Server approval refuses unresolved conflicts across all pages. | done (Part 364) |
| 11.19 | **Contacts import resolve/review screen has no sort/search.** **DONE (Part 363), needs deploy.** Server-backed search covers name/phone/email/membership/barcode/identifier, sort is row/A–Z/Z–A, conflict filters are bounded and merge decisions persist. Commit `af19985c`. | done (Part 363) |

**Inventory / Branches / stats colouring**

| # | Task | Status |
|---|---|---|
| 11.20 | **Inventory product stats: colour, not labels, in the default view.** **DONE (Part 355), needs deploy.** The Products card's sub-line shows healthy/low/out as green/amber/red counts (labels kept as title/aria; the click-through detail keeps the names). The health→colour mapping is one shared source, new `inventory/stockHealthSummary.ts` (`buildStockHealthSegments`), tested (`stockHealthSummary.test.ts`, 5 checks). **Other stat cards** already colour their values via `cls`. (5.5.) | done (Part 355) |
| 11.21 | **Branches page: too many stock stats outside.** **DONE (Part 355), needs deploy.** The outer row went from 7 tiles to 3 (Branches / Items / Value); the four health tiles (In Stock/Healthy/Low/Out) fold into the Items tile as one coloured sub via the SAME `buildStockHealthSegments` helper (Inventory + Branches can't disagree). Full breakdown stays on the Items detail; per-branch stats untouched. (5.6.) | done (Part 355) |
| 11.22 | **History menu overflowed the profile modal.** **DONE (Part 354), needs deploy** — the bar's dropdown/preview defaulted to open rightward off the modal edge; now `align="right"` + `flex-shrink-0`. (Also 5.7.) | done, needs deploy |

**Pricing / batches correctness (re-reported)**

| # | Task | Status |
|---|---|---|
| 11.23 | **Batches show 0 in Inventory.** **DONE (Part 354), needs deploy** — see §14 / 4.2. | done, needs deploy |
| 11.24 | **VIP (special) price read/write bug.** **DONE (Part 354), needs deploy.** Root cause: the products LIST/search SELECT never returned `special_price_usd/khr`, so ProductForm defaulted them to the selling price on load AND wrote that back on save — silently overwriting a real VIP price (8) with selling (12) on every edit; the detail modal showing "selling for both" was the visible symptom. Fixed the SELECT + dropped the `?? selling` fallback in the form and both import normalizers (blank VIP = 0; every consumer treats 0 as "use selling"). **Import also read it wrong the same way** and now defaults blank→0. Tests flipped/added on both sides. (Also 4.3.) |
| 11.25 | **Rename "Special price" → "VIP price" everywhere.** **DONE (Part 354), needs deploy.** Label-only (the `special_price_*` DB columns keep their names). Renamed the `special_price*` label values in en+km, POS/detail/Products/CartItem literals, the import template header → `vip_price_usd/khr` (+ the CSV-columns hint), and the export headers → `VIP_Price_USD/KHR`. Import accepts BOTH `vip_price_*` and legacy `special_price_*` so old files still load. (Also 4.4.) |

**New cross-page requirements — Aug 27 2026**

| # | Task | Status |
|---|---|---|
| 11.26 | **Compact every page's stat cards consistently.** Stat name and Info affordance belong on the same row; cards must fit instead of being oversized. Tooltip/detail overlays must use viewport-aware top-layer placement and respect mobile/container boundaries. Returns is the clearest broken case, but the fix must use shared components and cover every stats page rather than page-local CSS. | not started |
| 11.27 | **Separate customer delivery charge from secret actual delivery cost.** POS records both: the customer-facing charge remains on the receipt; actual delivery cost is staff/admin-only and never reaches customer/receipt/public responses. Sales/stats must distinguish delivery revenue, actual delivery expense and delivery margin (`charge - actual cost`). Requires permission/redaction, schema/API, edit/import/export, calculations and tests. | not started |
| 11.28 | **Allow manual historical batches in Product edit and Inventory/Branch batch details.** User may enter the real received date/batch when recording stock late. Branch transfers preserve the product barcode; only create/add/adjust-stock flows may set/change a barcode. All entry points must share validation and stock/batch logic. | not started |
| 11.29 | **Production sales CSV import/export core. DONE in code (Part 369), needs migrations/deploy/live verify.** Screen 1 → persisted Screen 2 was completed in Part 365. Part 369 adds compact first-row-only invoice/customer inheritance, strict Cambodia 24-hour timestamps, safe customer/product matching, permission and 5,000-sale export bounds, one shared template/export contract, historical COGS and discount metadata, and a queued retry-idempotent atomic per-receipt writer (50-line bound). Ordinary historical imports intentionally do not deduct today's stock; returned quantities restock product/branch/batch atomically. **Still open elsewhere, not falsely represented as sales columns:** secret actual-delivery expense/margin and redaction are 11.27; commission/service need an explicit real schema/business rule before import/export can carry them. | done in code; needs deploy/live verify; 11.27 extension open |

---

---


## Golden Rules

*Permanent. Read every session. Never traded against each other.*

- **Priority order when writing or editing any code, frontend or
  backend, in this order and never traded against each other**:
  1. **Correctness** — every edge case is actually handled and the code
     runs without errors; a write either fully succeeds or fully fails
     and is reported as such (no silent partial writes, no swallowed
     errors, no fake/optimistic success toasts ahead of a confirmed
     response).
  2. **Readability** — another engineer (including a future session of
     this same assistant) understands what the code is doing and why in
     under 10 seconds, without having to trace call sites.
  3. **Maintainability** — changing one feature later is a localized
     change and does not silently break an unrelated page/consumer (this
     is the same "find every reader/writer first" method Tracks A/F use,
     applied while writing code, not just while auditing it).
  4. **Brevity** — the fewest lines that don't compromise the three
     rules above; never the first thing optimized for.
- **The Goldilocks calibration for how much code to write**: too long
  is repetitive/copy-pasted boilerplate that hides the actual business
  logic (the fix is to extract the shared part, as `renderFilterFields()`
  did for the portal filter rail); too short is a clever/cryptic one-liner
  that costs the reader more time to decode than a plain version would
  have taken to write; just right is idiomatic code with self-documenting
  names and clear step-by-step logic — boring on purpose.
- **No shortcuts on writes/mutations, either side of the stack**:
  backend routes don't return a success response before a D1 write is
  actually committed; frontend code doesn't optimistically mark an action
  done before the network response confirms it; a partial failure in a
  multi-step operation (bulk action, import, transfer, backup/restore) is
  surfaced as partial, not swallowed into an overall "success."
- **Diff before trusting an uploaded update package.** Every
  `update_code` merge in this project's history that skipped a real
  content diff against the destination file (matching by content, not
  just filename) shipped a real bug at least once (Part 273's
  content-vs-filename misroute, Part 240's missing-file broken import).
  Always diff every incoming file against its actual destination before
  copying it in, and never assume a same-named file in an update package
  targets the same-named file at the obvious path — confirm via imports/
  relative-path depth like Part 273's `ProductDetailModal.tsx` case.
- **Verify for real, every session, both packages, before claiming
  anything works.** `tsc --noEmit` in both `frontend/` and `cloudflare/`,
  every relevant frontend test file run individually (not just the
  chained `npm run test:utils`, which stops at the first failure and
  hides everything after it — including the one pre-existing, unrelated
  `assetCompression.test.ts` icon-budget failure that should NOT block
  the other 96), every backend `test-*.cjs` script, and a real `vite
  build` (not just a type-check) — a clean typecheck alone is not proof
  the app builds or runs. Report exactly what ran and what its real
  result was; never say "should work" or "this looks right" in place of
  an actual run.
- **No zombie/orphaned code.** A new symbol, file, or component that
  nothing imports, an old one nothing calls anymore, or a duplicate
  parallel implementation of something that already exists elsewhere
  (the same class of bug as Part 251's `BulkAddStockModal` running its
  own smaller copy of `BranchStockAdjuster`'s Add/Remove/Set UI) gets
  found and either wired in or removed in the same session it's noticed
  — not left for a future session to rediscover.
- **Scope discipline: build what's confirmed, flag what's guessed.**
  When a request spans multiple files/surfaces and the exact intended
  behavior isn't fully determinable from what's already in source (an
  ambiguous ask, a missing screenshot, a design decision with more than
  one reasonable shape), write the concrete finding/design option into
  progress.md and flag it back rather than guessing and shipping the
  wrong thing — matches this project's established pattern (Part 271's
  import-mode question, Part 276's unidentified items 8/5/4).


## Engineering standards

*Standing. Applies to all future work — not a checklist to close out.*

- [x] **Priority order when writing or editing any code, frontend or
  backend, in this order and never traded against each other**:
  1. **Correctness** — every edge case is actually handled and the code
     runs without errors; a write either fully succeeds or fully fails
     and is reported as such (no silent partial writes, no swallowed
     errors, no fake/optimistic success toasts ahead of a confirmed
     response).
  2. **Readability** — another engineer (including a future session of
     this same assistant) understands what the code is doing and why in
     under 10 seconds, without having to trace call sites.
  3. **Maintainability** — changing one feature later is a localized
     change and does not silently break an unrelated page/consumer (this
     is the same "find every reader/writer first" method Tracks A/F use,
     applied while writing code, not just while auditing it).
  4. **Brevity** — the fewest lines that don't compromise the three
     rules above; never the first thing optimized for.
- [x] **The Goldilocks calibration for how much code to write**: too long
  is repetitive/copy-pasted boilerplate that hides the actual business
  logic (the fix is to extract the shared part, as `renderFilterFields()`
  did for the portal filter rail); too short is a clever/cryptic one-liner
  that costs the reader more time to decode than a plain version would
  have taken to write; just right is idiomatic code with self-documenting
  names and clear step-by-step logic — boring on purpose.
- [x] **No shortcuts on writes/mutations, either side of the stack**:
  backend routes don't return a success response before a D1 write is
  actually committed; frontend code doesn't optimistically mark an action
  done before the network response confirms it; a partial failure in a
  multi-step operation (bulk action, import, transfer, backup/restore) is
  surfaced as partial, not swallowed into an overall "success."


## QA method

*Tracks A–F. A standing framework, not a one-time checklist.*

**Core method — apply to every future change, not just this checklist:**
for anything shared (a setting, a component, a computed stat, a cached
value), find every consumer with a real grep first, then for each one
answer explicitly: *expected* (never touched this, no change is right),
*same* (touched, correctly reflects the change), *different* (touched,
reflects the change, but disagrees with another consumer in a way that's
wrong), or *not applied* (looks fine on the surface but the value never
actually reached this consumer). That fourth bucket is exactly the
`buildPortalConfig` and out-of-stock-filter bugs found earlier in this
project: no test caught either because only the reported-broken page was
checked, and the *editor preview* looked completely correct.

- **Track A — Config/flag propagation audits** (parallelizable). This bug
  class has hit twice already (`customer_portal_show_out_of_stock_
  products`; the four `showProduct*` toggles) via the same shape: editor
  writes a setting, editor's own preview reads it correctly, a *separate*
  server-side function serving the live page never reads it back. 5-step
  audit per setting: (1) where edited, (2) where persisted, (3) grep every
  reader across both packages — not just the one a bug report pointed at,
  (4) does each reader use the live value or a hardcoded default, (5)
  confirm on the *actual serving path* that toggling it changes output.
  **[x] Closed part 131 — re-run fresh against every setting this item
  named, not reused from an old reader list.** All confirmed genuinely
  wired, no propagation gaps found:
  `customer_portal_show_product_{brand,category,description,discount}` —
  `CatalogProductsSection.tsx` gates brand/category/description/discount
  rendering on each (`previewConfig.showProductX !== false`). Every
  `buildPortalConfig` `show*` boolean traced to a real consumer: `showLogo`
  gates the logo render in `CatalogPreviewSurface.tsx` (initially looked
  unused — a grep of `PublicCatalogPage.tsx`/`CatalogProductsSection.tsx`
  alone missed it; the actual gate lives in the shared preview surface
  those two pass `versionedBusinessLogo` into), `showCover` gates the hero
  background in `CatalogSecondaryTabs.tsx`, `showPhone`/`showEmail`/
  `showAddress` gate their contact-fact rows, `showAbout`/`showCatalog`/
  `showMembership`/`showFaq` gate their nav tabs, `showPrices` gates price
  display + add-to-bucket, `showGoogleMap` gates the map embed.
  `customer_portal_show_out_of_stock_products` is enforced server-side
  (not a frontend gate at all, correctly) — `portalVisibleProductFilter`
  in `routes/portal.ts` is threaded through `buildPortalMeta`/
  `buildPortalCatalog`/`loadPortalAiCatalog`/`buildPortalProductFilters`,
  so a merchant turning it off actually removes the rows from every
  server response, not just hides them client-side.
  `customer_portal_show_stock_status` confirmed via `shouldShowStockStatus`
  (`portalCatalogDisplay.ts`) plus direct `config.showStockStatus` checks
  gating both the status pills and the `stockState` query param
  server-side. `receipt_settings` permission: traced `getSessionUser`
  (`lib/auth.ts`) — it's a live `SELECT ... FROM user_sessions JOIN users
  JOIN roles` on every request, not a cached JWT/session-snapshot payload,
  so a role or permission change takes effect on the user's very next
  request, no stale snapshot possible. Same standing caveat as every other
  item in this file: this is a full code-path trace, not a live-browser
  click-through confirming pixels change — no live deploy from this
  sandbox to do that with.
- **Track B — Shared-component ripple audits** — [x] closed (part 52):
  group-thumbnail change, sticky wrapper, family-aware stock stats, and
  the `FilterMenu` first-open flash all audited/fixed, see Open above.
- **Track C — Cross-page ripple checks for mutating actions** (sequential
  per action, independent actions can parallelize) — still open: branch
  transfer (check source+dest stock, Products branch-filter view,
  Dashboard stat, POS availability, low-stock notification firing); full
  data reset (R2 actually empty, all pages show consistent zero-state);
  backup→restore onto a fresh bucket (images genuinely reappear, not just
  DB rows — first live confirmation of part 28's fix); CSV/ZIP import
  (Dashboard's recent-imports card, counts, notifications all reflect new
  rows immediately).
- **Track D — Per-page pass** (parallelizable) — per page: (1) every
  button's real network call + payload matches what it implies, confirmed
  by re-fetch not by trusting the toast, (2) Close/Cancel/Dismiss does
  only what it says, (3) real zero-state message, (4) boundary values
  (0-quantity, page-size cap, same-branch transfer, 0-item bulk-select),
  (5) resize/toolbar-overlap at in-between breakpoints, (6) no stray
  backdrop/scroll-lock after modal close. Priority order: Products →
  TransferModal → Branches → Backup/system settings → Portal editor + live
  portal → Dashboard → Inventory → Sales/Returns/Contacts. Still open.
- **Track E — Infra-dependent** (do last, needs live deploy/device) — still
  open: `wrangler tail` during a real transfer/reset/backup/import (watch
  for D1 write-contention and a free-plan CPU-limit trip); real-device
  responsive pass; concurrent-edit two-tab race on the same product/branch
  stock.
- **Track F — Manual-entry vs. import/bulk-action feature-parity audit**
  (parallelizable per entity). 5-step per entity: (1) list every
  creation/mutation path (manual Add/Edit, bulk/multi-select action, CSV/
  ZIP import incl. merge/replace-all), (2) list every field/behavior each
  path actually supports from the real handler, not the UI, (3) diff
  across paths — field, validation rule, side-effect, or edge case present
  on one and missing on another is a real gap, (4) for select-all/bulk
  specifically confirm it's scoped to the visible/filtered selection,
  0-selected is a clean no-op, and a partial mid-batch failure reports
  which rows failed, (5) confirm any fix on the pages that render the
  result too, not just at the write. Status per entity: **Products** [~]
  — real gap found part 62, SQL/source-text half only landed that session;
  `classifyProducts` itself never actually populated the fields, so the
  bug was still live until actually fixed part 68 (see History); two
  decisions still open (bulk-edit field scope,
  `image_gallery` import support — see Open above). **Product batches/
  lots** [x] — confirmed clean (part 62), matches the already-tracked
  batch-system open item. **Branch stock levels** [x] — closed (parts 62
  & 64), floor guard + notification-consistency both checked, see Open
  above. **Contacts/customers** [x] — closed clean (part 64), no gap.
  **Sales/returns line items** [x] — closed (parts 69–71): field-by-field
  diff done, `customer_id` resolution gap fixed part 69, and the
  remaining template-scope gap (discount/tax/total/paid/change/
  membership/delivery, plus `cashier_id`) closed part 70/71 by extending
  the CSV template and matching `routes/sales.ts`'s manual-checkout money
  math exactly.


## Decisions made

*Settled. Do not relitigate without new information.*

- [x] **`notifications_realert_minutes` mechanism**: client-side,
  localStorage, per-item last-seen timestamp (`NotificationCenter.tsx`'s
  `SEEN_ALERT_TIMES_KEY`) — same shape as the existing `seenSecurityIds`
  quiet-dot tracking, but a repeating timestamp instead of a one-way set
  since an item must re-count once its window elapses. No server-side
  dismissal table; matches how every other "seen" state in this component
  already works.
- [x] **`receipt_settings` permission** is `'settings'` (not super-admin-
  only), matching its sibling settings sub-pages.
- [x] **POS branch-tiebreaker**: alphabetically-first branch with stock >
  0, falling back to alphabetically-first branch overall, then `null`.
  `productGrouping.ts`'s `getPrimaryBranchLabel`. Treat as settled unless
  reported wrong in practice.
- [x] **Multi-select transfer/import grouping rule** (verified against
  actual code, not assumed): name+details match excl. branch → one row,
  branch-only difference; name matches but other details don't → child
  row of the same group; name doesn't match → always separate. True in
  import (`classifyProducts`), transfer identity-match
  (`findIdentityMatch`), and all list-page display (`productGrouping.ts`).
- [x] **Products import modes**: `merge` (default) matches the rule above
  and never removes anything; `replace_all` runs the same per-row match
  but then soft-deactivates (`is_active=0`) every active product this
  run's rows never touched, keyed off `updated_at < job.started_at`. A
  row an operator marks "skip" during review counts as untouched and gets
  deactivated too under `replace_all` — no separate "keep out of replace"
  signal exists today.


## Environment notes

*Standing, but environment-specific — re-check at the start of each session.*

**The user's local Windows checkout (`C:\Users\mrkl6\Downloads\business-os-v1`) can run
EVERYTHING** — `node_modules` installed for both projects, working `better-sqlite3`
native bindings, and real network access. Confirmed Part 338–339. The
"sandbox can't build" caveat in Parts 335–337 was specific to those sessions'
environment and does **not** apply here; do not repeat it as an excuse.

Full verification set, all of which really run locally:

```bash
cd cloudflare && npx tsc --noEmit
cd frontend  && npx tsc --noEmit
cd frontend  && npm run test:utils        # full chain, incl. check:source + verify:public-runtime
cd frontend  && npm run build             # real vite build, ~14s
for f in cloudflare/scripts/test-*.cjs; do node "$f"; done   # 38 scripts
```

To exercise the real app end to end (needed for any UI/permission claim):

```bash
cd cloudflare && npx wrangler d1 migrations apply business-os --local
cd cloudflare && npx wrangler dev --local --port 8787
cd frontend   && npm run dev              # proxies /api to :8787
```

Notes for that flow: non-admin accounts hit a device-approval gate
(`trusted_devices.status` must be `approved`); the app registers a service
worker, so unregister it and clear caches when testing code changes; and
permissions are read from the session at login, so change a role then log
out and back in rather than just reloading.

- `tsc --noEmit` (real project `node_modules`) is the standard
  verification step for both `frontend/` and `cloudflare/`.
- Frontend has ~110 `tests/*.test.ts` files runnable directly via `node`
  (native TS support), no build step needed.
- `cloudflare/scripts/test-*.cjs` (38 files) transpile the real source
  (not reimplement it) against small in-memory fakes for `env.DB`/
  `env.ASSETS` — the project's standard pattern for backend pure-logic
  regression tests.
- A first `npm install` in `cloudflare/` has occasionally completed
  without actually installing `@cloudflare/workers-types`, breaking both
  `tsc --noEmit` and any `test-*.cjs` that shells out to `tsc` directly —
  fix is `rm -rf node_modules && npm install` again; not a code
  regression when this happens.
- `cloudflare/scripts/harness/run_real_xlsx.cjs` runs the real
  `products-template-merged.xlsx` end to end (file not committed, must be
  supplied) — worth re-running after any future change to
  `classifyProducts`/`summarizeImportWarnings`.

---


## Connected services — measured Aug 26 2026 (Part 349)

*Every row below was probed live through its MCP connection, not read off a config
file. "Wired into the app" means the running Worker/frontend actually uses it.*

| Service | Reachable | Wired into the app | Measured state |
|---|---|---|---|
| **Cloudflare** | yes | **yes, fully** | D1 `business-os` = **185 MB of the 5 GB** free limit. R2 `business-os-assets` (the only bucket, and the only one `wrangler.toml` needs). KV `de5f3b41c7264e4582077176fd0c1fe8` titled `CACHE` — the exact id supplied, already bound. |
| **Cloudinary** | yes | **no** | Free plan, **completely unused — 0 storage, 0 transformations, 0 bandwidth**, 25 credits/month. Limits: image ≤10 MB, ≤25 M pixels. |
| **Resend** | yes | **partly** | One domain, `leangcosmetics.crane-qilin.ts.net`, status **`not_started`** — i.e. DNS never verified, so **nothing can actually send**. It is also a Tailscale `.ts.net` name, not `leangcosmetics.dpdns.org`. Compounding it, `RESEND_FROM_EMAIL` is missing from `wrangler.toml` entirely, and `lib/verification.ts:82` needs both it and the API key. Two independent blockers. |
| **Sentry** | yes | **no** | Org `ungsethypagna` exists with **zero projects**. Nothing in `cloudflare/src` or `frontend/src` references Sentry. |
| **Google Drive** | yes | **yes** | Already the backup sync target. |
| Firecrawl / Exa / Figma / Mobbin | yes | n/a | Development-time tools, not app runtime. |

### Cloudflare + Cloudinary: split, do not merge

The honest sizing, because the free tiers decide this:

- **R2 stays the store of record.** 10 GB and **zero egress**, and it is already the
  upload target. Cloudinary's free tier is **25 credits/month**, where one credit is
  roughly 1 GB of storage *or* 1 GB of bandwidth *or* 1,000 transformations. With up to
  3 images across ~6,700 products, using Cloudinary as primary storage would exhaust the
  plan on storage alone. It is not a storage substitute.
- **Cloudinary is worth exactly one thing here: it can do what the Worker cannot.**
  Measured earlier: the Worker has **no image processing at all**, which is why the
  300–350 KB backfill has no server-side path today. Cloudinary's `transform-asset`
  does quality-preserving resize and WebP/AVIF encode. Used *only* for the one-off
  backfill of existing MB-sized objects, the transformation cost is trivial —
  ~2,000 objects is ~2 credits.
- **New uploads should not touch Cloudinary.** Encoding WebP/AVIF at quality 80–85 in
  the browser is free, needs no service, keeps the 100%-free-egress property, and is
  the approach that actually fixes the root cause. Cloudinary would add a per-upload
  dependency and a metered cost for something the client can already do.

So: **client-side encode for the ongoing path, Cloudinary for the historical backfill,
R2 for storage.** That is the split, and it keeps everything inside free tiers.

### What needs an account change before it can work

These modify third-party accounts, so they are listed rather than done:

1. **Resend** — add and verify `leangcosmetics.dpdns.org` (the current domain is a
   Tailscale name and is unverified), then set `RESEND_FROM_EMAIL` in `wrangler.toml`.
   Until both are true, password-reset email silently does nothing.
2. **Sentry** — create a project under `ungsethypagna` and wire the SDK. Currently the
   only error signal is whatever reaches the browser console.

---

---


## Tests & Security

*Requested Part 355: a clear map of what is tested, the security posture, and the two
public surfaces. Everything here was run this session unless marked otherwise.*

### How this project is tested (two harnesses, run for real)

- **Backend — `cloudflare/scripts/test-*.cjs` (79 files, 79 pass).** Pure-logic harnesses
  that transpile the REAL source with `typescript` + a `better-sqlite3` shim (migrations
  applied), so they exercise actual route/lib code, not reimplementations. No single
  "run-all" script exists on purpose — they are swept individually so one failure cannot
  hide the rest (a chain stops at the first throw).
- **Frontend — `npm run test:utils` (green; all 120 test files wired and pass).** A hand-maintained `&&` chain of 120
  `tests/*.test.ts` run directly under Node, front-loaded with `typecheck`,
  `verify:public-runtime`, and `check:source`. `testChainCoverage.test.ts` fails if any
  `tests/*.test.ts` is not wired into the chain (it caught two unwired files this session);
  it cannot close the stop-at-first-failure half, so the chain is still read end-to-end.
- **`langKeyIntegrity.test.ts`** enforces en/km translation parity and flags the unsafe
  `t('key') || 'fallback'` idiom (t returns the key itself on a miss, so a missing key
  renders as raw text) — this caught a real POS message bug this session.

### Tests added / changed this session (Parts 354–369)

| Area | Test | Guards |
|---|---|---|
| D1 param cap (0.2) | `test-d1-bound-params-repro.cjs` | installs D1's real 100-param limit in the shim (better-sqlite3 allows 32k, which is why this reached prod) and fails if any file builds an `IN`-list without chunking |
| Products reset (0.1) | `test-reset-products-pure.cjs` | scoped backup covers exactly the tables the reset clears, across all 4 toggle combos |
| Import stock actions (§12) | `test-stock-action-resolver-pure.cjs` | 16 checks on DIRECT/RECONCILE deltas, sale grouping, cost/batch conflict gating |
| Unified stock intake (§12, Part 357) | `test-stock-action-import-pure.cjs` | exact 10 columns, strict numbers/dates, product ambiguity fail-closed, Shop/Warehouse resolution, bounded narrow D1 reads, direct/reconcile plans |
| Stock-action sealing/apply (§12, Part 358) | `test-stock-action-seal-pure.cjs`, `test-stock-action-commit-pure.cjs`, `test-stock-action-approval-pure.cjs` | cross-window conflict catch + retry de-dup; injected transaction failure rolls back ledger/batch/stock/movement; retry cannot double-add; stable product creation; three-permission/state/Confirm Action server gate |
| Grouped-sale writer + apply engine (§12, Part 359) | `test-stock-action-sale-commit-pure.cjs`, `test-stock-action-apply-pure.cjs` | writer: one receipt per group, FIFO across lots (explicit label reserved before FIFO), aggregate + batch oversell fail via transaction-enforced CHECK, injected mid-tx failure rolls back, retry de-dup, hard group-size bounds. Engine end-to-end (real in-memory SQLite): add / create / FIFO sale group; whole-job retry adds no second receipt; an oversell fails only its group while an independent add still applies; a sale group with an unresolved sibling line fails wholesale (never a partial receipt) |
| Import warning parity (regression) | `test-import-warning-detail-pure.cjs` | frontend `ImportReportModal` `SERIOUS_KINDS` must match backend `SERIOUS_IMPORT_WARNING_KINDS` — caught a gap where `stock_action_conflict` would have rendered under "Other warnings" and been missed |
| POS oversell strict (Part 360) | `test-sales-oversell-strict-pure.cjs` | migration 0058 rebuilds both stock tables with `CHECK(quantity >= 0)` and floors pre-existing negatives; a within-stock sale commits while an oversell aborts + fully rolls back (no clamp); a specific lot is guarded by its OWN stock not the product total; the route source ships plain subtraction (no `MAX(0)` clamp) and maps the abort to a 409 |
| Stock-action import UI wiring (§13, Part 361) | `stockActionImportModel.test.ts` | pure review logic (analyzing/needsConfirm/canConfirm, the confirm gate, errored-only still confirmable, all-skipped not); guards the whole chain — modal drives a `stock_actions` job with `confirm_stock_actions`, the wizard launches it, the transport forwards the flag, the backend allow-list admits the type |
| Stock-action full analyze/review gate (Part 362) | `test-stock-action-analyze-e2e.cjs`, `test-import-lifecycle-gate-pure.cjs`, `test-import-review-query-pure.cjs` | real ranged CSV → bounded materialization → two classify windows → persisted Screen 2 rows → cross-window seal; preview-only/cancel/lease/oversize guards; reviewed-source immutability; no retry approval bypass; parameterized D1 pagination/search/warning filters with literal wildcard handling |
| Contacts review + real product Screen 1 (Part 363) | `test-import-review-query-pure.cjs`, `contactImportPostStartFlow.test.ts`, `stockActionImportModel.test.ts` | bounded contact search/sort/filter + persisted merge decisions; wrapper cannot reintroduce fake template/upload handoff; real product/stock modals own mode/options/template/upload/images/information and image selection appears once |
| Contacts exact two-screen approval gate (Part 364) | `test-import-review-query-pure.cjs`, `contactImportPostStartFlow.test.ts` | SQLite proves only unresolved name/phone-conflict rows block; approval route fail-closes; phone acknowledgment persists; paginated Screen 2 owns Confirm and cannot advance through a separate Done step |
| Sales + Inventory authoritative Screen 2 (Part 365) | `csvImport.test.ts`, `inventoryImportWorker.test.ts`, `salesImportWorker.test.ts` | both modals remain open through server analysis, read bounded persisted review rows, guard duplicate confirmation, and notify the parent only on approve or explicit background handoff |
| Product conflict server gate (Part 367) | `test-import-review-query-pure.cjs`, `importJobApproveGate.test.ts` | D1 counts unresolved barcode/SKU/negative-stock rows across pages; approval fail-closes; persisted apply/skip choices survive review reads; the tracker cannot silently approve past the resolver |
| Product authoritative two-screen flow (Part 368) | `importJobApproveGate.test.ts`, `csvImport.test.ts`, `performanceLoadingUx.test.ts`, `productImportPlanner.test.ts`, `importModeDetectionWiring.test.ts` | local validation cannot advance to or serialize a shadow review; queued analyze opens persisted D1 Screen 2; serious warnings require a visible saved decision; Confirm/cancel/review-later are explicit and guarded; no duplicate synchronous preflight; image-only uses the same job review |
| Smart sales contract + atomic apply (Part 369) | `salesImportWorker.test.ts`, `test-sales-group-window-pure.cjs`, `test-import-engine-pure.cjs`, `test-sales-import-commit-pure.cjs` | one shared ordered template/export contract; first-row-only invoice/customer headers and cross-materialization inheritance; SQL/JS group parity; strict Cambodia 24-hour dates and invalid-date rejection; unique-name matching; COGS/discount/return snapshots; permission and export completeness guards; real 61-migration SQLite transaction proves deterministic parent linkage, full rollback on injected final-write failure, retry de-dup, return stock exactly once and the 50-line Free-plan cap |
| Logical Library rows (§15, Part 357) | `test-library-logical-assets-pure.cjs`, `mediaUploadHelpers.test.ts` | cover+gallery de-dup, unreferenced visibility, indexed path joins, logical pagination/search, independent selection keys, sanitized product-name downloads over one object |
| Image wiring (2.3) | `test-wire-images-gallery-pure.cjs` | a multi-photo product keeps ALL images via `syncProductImageGallery` (found a real one-image-survives bug) |
| Batch counts (§14) | `productBatches.test.ts` | Inventory + Products attach counts identically |
| Alignment (4.1/11.4) | `productsRowAlignment.test.ts` | the 6 `<col>` widths sum to 100%; category band spans image+name |
| Logo crop (16.2) | `logoImageStyle.test.ts` | preview == applied; transform-origin ties to the focus point; clamps |
| PWA / branding (16.1/11.14) | `brandIcons.test.ts`, `performanceLoadingUx.test.ts`, `adminShellMediaGuards.test.ts` | storefront serves STATIC Leang icon+manifest, never a blob or per-merchant build; the removed favicon machinery cannot return (doesNotMatch guards) |
| iPhone public-root branding (Part 366) | `brandIcons.test.ts`, icon generator `--check` | executes the real parser-time bootstrap: public production `/` selects Leang manifest/favicon/Apple title/versioned 180x180 touch icon, while admin/localhost/loopback retain Business OS; portal maskable files reproduce from source |
| Backup restore streaming (10.1) | `test-backup-restore-stream-pure.cjs` (12 checks) + `test-backup-pure.cjs` round-trip | reads the document one row at a time; identical events under per-char + 200 random chunkings; corrupt/truncated backup throws (never silently mis-restores); the round-trip now exercises the streaming path end to end |
| R2 lifecycle / retention | `test-backup-pure.cjs` (18 checks) | unfinished sets cannot evict either good backup; finalization leaves exactly two; missing assets fail after three attempts; a linked job moves running→completed instead of appearing stuck |
| Google Drive checkpoint | `test-google-drive-backup-pure.cjs` | skips unfinished R2, streams a trusted resumable session, paginates tagged files, deduplicates the same backup and prunes 10→7 without touching an unrelated file |
| Product image limit | `test-product-image-limit-pure.cjs` | normal=3/admin=5 at server and UI; no silent slice; an existing admin gallery is preserved while a new fourth normal-user path is refused |
| POS cost hidden (11.9) | `posCore.test.ts` | the option picker labels by barcode/selling price, never cost; a cost-only difference never surfaces a cost value on a pill |
| Stock-health colour (11.20/11.21) | `stockHealthSummary.test.ts` (5 checks) | one healthy/low/out→colour source; order, colours, single-source contract, count coercion |

### Security posture

- **AuthZ / permissions.** Route-level gating is server-side (`test-route-permissions-pure.cjs`,
  `test-action-overrides-pure.cjs`, `test-batches-permission-pure.cjs`); product reads are scoped
  by SURFACE so a `products_image_only` grant cannot reach POS. Per-action overrides only NARROW
  a tier, never widen — deliberate, so UI and API cannot disagree (7.1).
- **AuthN.** Login identifier + lockout are tested (`test-login-identifier-pure.cjs`,
  `test-login-lockout-pure.cjs`); sessions slide (`test-session-slide-pure.cjs`).
- **Input / injection.** All SQL is parameterized through `lib/db.ts`'s D1Compat (@name →
  positional); `inlineIntegerIds` throws on any non-safe-integer rather than interpolating.
  No string-built SQL values. Search/FTS paths are tested (`test-search-fts-pure.cjs`,
  `test-contacts-fts-pure.cjs`).
- **Offline / client hardening.** `offlineSecurityHardening.test.ts`,
  `storagePolicy.test.ts` — the offline queue and local mirror are covered.
- **Error reporting.** Sentry with PII scrubbing + dedupe (`test-error-reporting-pure.cjs`).
- **Secrets.** Cloudinary secret lives only in `.dev.vars` (gitignored, verified absent from
  git history), never in `wrangler.toml`. Rotation is a user action — see
  [Needs the user](#needs-the-user-not-code).
- **JavaScript specifics.** No `eval`/`Function` construction in app code. The storefront
  no longer builds a `blob:` manifest (16.1). `t()||fallback` misses are linted out. React
  escapes interpolated content by default; no `dangerouslySetInnerHTML` was added this session.

### Open ports / network surface

- **One Worker, one public origin per site.** No app-managed listening ports — Cloudflare
  Workers terminate HTTPS; there is no raw TCP/UDP socket the app opens. Local dev is
  `wrangler dev --local` (Miniflare) on localhost only.
- **Bindings, not ports:** D1 (SQLite), R2 (objects), KV (cache versions) are Worker bindings,
  reached over Cloudflare's internal RPC, not network ports. Cloudinary is an outbound HTTPS
  fallback with a signed URL.
- **`workers_dev`** was toggled on during the Aug-26 DNS outage to restore access, then off
  again by request; the switch + reasoning live in `wrangler.toml`.

### The two websites

| | Admin app | Public storefront |
|---|---|---|
| Origin | `admin.leangcosmetics.dpdns.org` (+ `localhost`) | `leangcosmetics.dpdns.org` |
| Mounted by | `index.tsx` → `AdminRoot` → `App.tsx` | `index.tsx` → `PublicCatalogRoot` → **`PublicCatalogPage.tsx`** |
| Brand | Business OS (static `/manifest.json`, `/favicon.ico`) | Leang Cosmetics (static `/portal-manifest.json`, Leang icons) |
| PWA install | static admin manifest | **static Leang manifest (Part 355)** — was a broken `blob:` before |
| Auth | staff sign-in, permission tiers | public catalog; guest/customer accounts still open (§5 / batch items) |
| Caching | app shell + route chunks | public storefront caching added earlier this session |

**Known follow-ups on the surfaces:** stale cache of embedded sites on the public site (6.3,
repro-then-scope); portal pagination counts unmerged rows so it promises empty pages (6.5).
The bounded-memory backup restore fix (10.1) is complete in Part 355 and awaits deploy.

---


## Shared single-source-of-truth helpers

*The user's standing rule, stated Part 354: "a calculation, conversion, change never hides,
… doesn't update 100% of the app pages … or data loss/orphaned/zombie/forgotten/corrupted
along the way." A number the user sees must be computed in ONE place that every page calls,
so pages cannot drift and a change lands everywhere at once.*

### Established (do not re-implement per page — import these)

| Helper | The one thing it owns | Callers |
|---|---|---|
| `cloudflare/src/lib/sqlBinding.ts` | D1's 100-bound-param limit + all `IN (...)` chunking (`chunkForBinding`, `selectInChunks`, `buildInClause`, `inlineIntegerIds`) | ~40 read/write sites; was the 0.2 outage |
| `cloudflare/src/lib/productBatches.ts::attachBatchCounts` | how a product's batch count is derived (active batches with non-zero branch stock) | Products list read, Inventory list read |
| `cloudflare/src/lib/backup.ts::writeBackupDocument` | the streaming backup writer | `createCloudflareBackup`, `createSectionBackup` (reset) |
| `frontend/src/components/catalog/logoImageStyle.ts::buildLogoImageStyle` | the logo crop/zoom/focus CSS | editor preview + live header (admin & storefront) |
| `frontend/src/components/inventory/stockHealthSummary.ts::buildStockHealthSegments` | the healthy/low/out → colour mapping | Inventory products card + Branches Items tile (11.20/11.21) |
| `frontend/src/components/products/…/productGrouping.ts` | how rows group by `name_key` and who the group lead is | Products list, group header, gallery union |

### The generalization the user asked for (candidates, not yet built)

The same "shared kernel + thin per-page callers" shape should cover every place a money or
stock number is computed more than once. Each of these is currently computed inline in
several components/routes and is a divergence risk:

- **Pricing resolution** — selling vs VIP vs damaged price, currency (USD/KHR) conversion,
  discount/fee application. Today POS, Sales, Returns, product detail, receipt, and the
  public portal each format price independently. Target: one `resolvePriceView(product, ctx)`
  + one `convertCurrency(amount, rate)` that all six import. (Guards the 11.24 class of bug —
  a field read/written in one place but not another.)
- **Stock math** — on-hand, reserved, available, low/out thresholds, per-branch vs total.
  Dashboard, Inventory, Branches, POS availability, and the stock-action resolver each derive
  these. Target: one `computeStockState(product, branch)` returning the labelled buckets, so
  the 5.5/11.20 colour rules and the 5.6/11.21 branch stats read the SAME numbers.
- **Sale/return totals** — line subtotal, discount, fee, tax, grand total, and the reverse
  for returns/replace (11.12/11.13). `test-sale-totals-pure.cjs` already pins the arithmetic;
  the kernel it tests should be the ONE function POS checkout, the receipt, Sales, and Returns
  all call.
- **Adjust / reconcile deltas** — `lib/stockActionResolver.ts` (§12) is already this shape for
  imports; the POS/manual adjust path should route through the same delta+batch logic instead
  of its own.

**Rule for new work:** before writing a calculation, grep for an existing helper; if two pages
will show the same number, extract the kernel FIRST and have both call it. A pure
`*-pure.cjs` / `*.test.ts` on the kernel is the proof it cannot silently diverge.

---

### Cross-cutting principle in force: ONE source of truth per calculation

The user's standing instruction — a calculation / conversion / change must never update
only some pages, or leave data orphaned/zombie/forgotten/corrupted. Shared helpers already
enforce this and are the pattern to extend (see [Shared single-source helpers](#shared-single-source-of-truth-helpers)):

- `lib/sqlBinding.ts` — the ONE place D1's 100-bound-param limit is written down; every
  `IN (...)` chunks through it.
- `lib/productBatches.ts::attachBatchCounts` — Inventory + Products read batch counts the
  same way, so the two pages cannot disagree.
- `catalog/logoImageStyle.ts::buildLogoImageStyle` — the editor preview and the live header
  render a logo identically, so the preview IS the applied result.

**Version control:** real git repo, pushed to `https://github.com/SethyPagna/business-os`
(branch `main`). Committed per feature/fix, not as checkpoint zips.

---

---


