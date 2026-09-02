# Coordinator notes — Aug 31 → Sep 1 2026

Moved verbatim out of `progress.md` on 2026-09-02 (Section 9 hygiene pass — see
`docs/plans/coordinated-plan-2026-09-02.md`). This is the raw live-coordination
scratchpad from the `## Status snapshot — Aug 31 2026` and `## Current status`
sections: lane claims, hazards, Part-number collisions, deploy records, and the
running commentary between the parallel sessions active that day. It is a
**historical transcript, not a live document** — nothing here is still being
updated. For where things stand now, read `progress.md`'s `## Status —
2026-09-02` block (which was distilled from this file plus
`docs/history/session-log.md`); treat every claim in this file as reference to
re-verify, never as ground truth.

Internal links have been repointed where the target moved out of `progress.md`
too (`#done--archive` → `progress-archive-2026-09-02.md#done--archive`); links
to sections that stayed in `progress.md` (`#open--the-queue`) now point there
with a relative path.

---

## Status snapshot — Aug 31 2026

- **DEPLOYED Aug 31 2026 (~01:32 UTC), version `a5e5023b`, from commit `242c2b75`
  (Part 538).** Everything from Parts 371–537 is LIVE — migrations 0083–0087 applied
  to remote D1 (0059–0082 were already applied; **none pending now**), the b9
  security/correctness batch, StatsStrip v2, the Part-526 refinement batch, storefront
  customer accounts, all of it. Every "needs deploy" marker below dated on or before
  Aug 31 is therefore SHIPPED — read them as "live, pending A2 verification".
- **The gate is now A2's live verification** (plus connecting Google Drive in
  Settings → Backup, which is only possible post-deploy — A3). Verified at deploy
  time, read-only: both `/health` ok, storefront 200 with Leang branding,
  `/api/products` unauth → 401, portal bootstrap 200, remote migrations list empty.
  Still owed (user-facing writes): one POS sale confirming the bare `YYYYMMDD-HHMMSS`
  receipt id (no RCP — user, Aug 31; shipped Part 540) +
  Phnom Penh labels, storefront iPhone install, import round-trip, R2 keeps exactly
  2 finalized sets, reset-data.
- **Sessions are coordinated.** Coordinator 7b is live in continuous mode; c8 is
  running a read-mostly verification sweep; r2 restructured this file. Claims and
  hazards live in [Current status](#current-status).
- **This file was reorganized Aug 31 (session r2).** All completed work — ~150
  master-plan items, the Aug-28→31 session records, the Aug-25 batches and older
  completed work — moved into [DONE — archive](progress-archive-2026-09-02.md#done--archive). Open work is
  consolidated in [OPEN — the queue](../../progress.md#open--the-queue). No content was deleted.

---


<!-- --- "## Current status" begins here --- -->

## Current status

**⏳ COORDINATOR (session 62) — TIMEZONE + REVENUE reconciliation, two locked decisions (user, Sep 1).**
User reaffirmed BOTH: (1) "the timezone and data are all Phnom Penh time" → fixed **UTC+7 business-day**
bucketing is a REQUIRED data-correctness fix (standing memory directive + reaffirmed), and (2) reconcile
the Sales-page `/stats` header and the Reports analytics kernel to **ONE canonical revenue definition**.
- **Business-day half is BUILT + verified-aligned** (uncommitted date lane, read all diffs): new
  `cloudflare/src/lib/businessDateWindow.ts` (fixed +420 min, sargable bound-shift, **ignores** viewer
  `tzOffsetMinutes`) + `salesAnalytics.ts` (kernel buckets +7h; `tzOffsetMinutes` now ignored) +
  `sales.ts` (`/`, `/stats`, `/stats-strip`, `/export`: non-sargable `date(created_at)` → sargable
  business-day bounds — this ALSO fixes the `/stats` full-scan perf bug) + `returns.ts` (same). **Pure
  query changes, NO migration** → zero 0097 collision with the catalog undo lane. **DATE-LANE OWNER:
  please post your board claim.**
- **Revenue-reconciliation half is NOT done yet** and lands in these SAME files (`salesAnalytics.ts`
  `deriveTotals`, `sales.ts` `/stats` `revenue_usd`) → must be the SAME lane / SAME commit as the
  business-day work, not a second pass. Divergence today: `/stats` revenue = `total_usd − refund`
  (incl tax, EXCL awaiting_payment, subtracts refunds; already splits `pending_revenue_usd`); kernel
  revenue = `subtotal − discount` (EXCL tax, INCL awaiting_payment, refunds separate).
- **✅ CANONICAL REVENUE — LOCKED (user, Sep 1): "Net sales" (Option 1), both surfaces identical.**
  `revenue_usd` = for status NOT IN (`cancelled`,`awaiting_payment`):
  `SUM(subtotal_usd − store_discount_usd − membership_discount_usd) − customer refunds`
  (customer-scope returns, status≠cancelled, `SUM(total_refund_usd)`, attributed to the SALE's bucket
  via sale_id — matches today's `/stats`). **EXCLUDES tax + delivery fee; SUBTRACTS refunds; EXCLUDES
  unpaid credit.** `awaiting_payment` → separate **`pending_revenue_usd`** (net basis), "counts once
  paid". ALSO expose `collected_total_usd = revenue + tax + delivery_usd` (Option 3, secondary). Changes:
  **KERNEL** (`deriveTotals`/`salesLevelTotals`) — split `awaiting_payment` OUT of revenue (into pending)
  + SUBTRACT customer refunds (tax already excluded ✓). **`/stats`** — change revenue base from
  `total_usd` (tax-in) to `subtotal − discounts` (tax-out); awaiting/refund/pending already correct ✓.
  Delivery (user point 3) is ALREADY modeled in the kernel — keep distinct: `delivery_usd` (fee charged)
  vs `delivery_actual_cost_usd` (courier cost shop pays) vs `store_delivery_usd` (shop-absorbed) vs
  `delivery_margin_usd`; profit subtracts store-absorbed. FOLLOW-UP: surface these in UI + verify capture
  (`delivery_actual_cost_count`). Full spec in memory `canonical-revenue-definition`.
- **DEPLOY:** 7b is sole driver, HOLDING for ONE coherent data-correctness batch once business-day +
  revenue are committed + green (certified worktree at committed HEAD). I hold all deploy/migrate/secrets.
  UPDATE (session 62): backend business-day work has LANDED (committed `efcf21e3` — kernel/sales/returns/
  compat/products bucket UTC+7; only `auditLogQuery.ts` + `stockLedgerQuery.ts` still dirty, unrelated to
  revenue).
  ✅ **REVENUE RECONCILIATION DONE (session 62, committed `9354f1ce`) — HEAD is coherent, both surfaces
  on the canonical net-sales definition.** The `/stats` header change (routes/sales.ts: revenue +
  pending base → `subtotal − discount − membership_discount`, minus customer refunds) had already
  landed bundled into the date commit `67b8e3b9`. Commit `9354f1ce` brings the KERNEL to the
  byte-identical basis: `salesLevelTotals` emits `recognized_net / pending / recognized tax /
  recognized (customer & store) delivery / refund` via a pre-aggregated returns join (same
  `COALESCE(NULLIF(sale_status,''),'completed')` normalization as `/stats`); `deriveTotals` computes
  `revenue = recognized net − customer refunds`, splits `awaiting_payment` into `pending_revenue_usd`,
  exposes secondary `collected_total_usd`, and keeps profit = revenue − recognized COGS − store
  delivery. Trend (`getSalesPeriodSeries`) + per-sale drill (`getSalesDayReport`) feed the same fields
  through the shared `deriveTotals`, so the SUM invariant holds. NEW pure test
  `test-sales-revenue-convergence-pure.cjs` runs the REAL compiled kernel vs the REAL `/stats` SELECT
  (extracted from source) over one mixed dataset and proves both == the hand-computed net-sales number
  (16 checks). tsc clean; existing analytics + daterange pure tests green.
  FOLLOW-UP (deferred, documented): sales.ts:2049 + `getProductSalesBreakdown` per-product revenue is
  still `SUM(sale_items.total_usd)` — a different (per-line) granularity, not the sale-level header↔kernel
  convergence; left as-is (whole-sale discounts can't be cleanly allocated per product without a rule).
  **DATE LANE handed back: the `salesAnalytics.ts`/`sales.ts` revenue lines are now settled at HEAD.**

**✅ GOOGLE-DRIVE OAUTH-URL bugfix (Sep 1, this session — DONE, committed `3820a971`, deployable).**
`ERR Google Drive connection failed: Google Drive connection failed`. Root cause: `Backup.tsx`
"Start connection" read `result?.authUrl`, but `POST /api/system/drive-sync/oauth/start` returns
`{ url }` (same shape as SSO `/api/auth/oauth/start`, which login reads as `result.url`). `authUrl`
was always undefined, so a SUCCESSFUL start hit `if (!authUrl) throw` → the doubled message. Fixed
the frontend to read `result?.url` (+ method type); backend never returned `authUrl` (git history),
so no server change. Verified: frontend tsc clean, `backupJobs.test.ts` passes. One-file, path-scoped.

**✅ CASHIER-IDENTITY RECONCILIATION lane (Sep 1, this session — DONE, committed `1378e07a` + `69673fbc`, NOT deployed / Stage-1).**
Delivered: importEngine cashier map keys on username+name over ALL users (incl. inactive) with
alias fallback; `userIdentity.ts` `cascadeUserRename` rewrites 14 id-linked user-name snapshots
(excludes `audit_logs`), wired into both PUT user routes; POS sends username+cashier_id; migration
`0098_user_aliases` (id-keyed, env-safe seed); migration `0099_legacy_cashier_identity_backfill`
(adds `legacy_deleted_sale_items.cashier_id`, backfills 2,234 deleted-items + 40 Aug-30 "Aza" sales
→ Za/id3, idempotent, cohort-scoped); import-aug30 canonical resolver + fail-loud; import-aug31 → Rath.
Verified: backend tsc clean; import + cascade pure tests pass; 0099 local-SQLite 11 checks + idempotent.
§5 Conflicts = no-op (no conflicts surface stores user identity). Gated apply order + post-checks in
`ops/scripts/migration/CASHIER-IDENTITY-RECONCILIATION.md`. NO remote write this session.
Original claim (kept for provenance):
User: legacy POS cashier names must map to the real user accounts ("aza" = user `Za`,
routh=`Rath`, pagna=`james`, sethyka=`sethyka`, Dev-Usmart=`admin`), matching by
**username incl. inactive**; **display the username**; the account **id is the source
of truth** so a username change must **cascade through the whole system** (not just
users); Dev-Usmart→admin(1). Root cause: `importEngine.ts` cashier lookup keyed only on
active `users.name`, so no legacy name ever linked (live: 0 sales have cashier_id).
OWNS (disjoint from the DATE/TIME + PRODUCTS lanes): `cloudflare/src/lib/importEngine.ts`,
new `cloudflare/src/lib/userIdentity.ts` (rename cascade), `cloudflare/src/routes/users.ts`
(wire cascade into both PUT routes), `frontend/src/components/pos/POS.tsx` (send username +
cashier_id), the two `ops/scripts/migration/import-aug3*-legacy-reports.mjs`, and **reserves
migration numbers 0098 (`user_aliases`) + 0099 (`legacy_deleted_sale_items.cashier_id`)**.
Scope = code + gated backfill SQL, **NO remote write** (Stage-1). Path-scoped commits only.

**✅ CONTACT-MERGE DATA-MOVEMENT lane (Sep 1, session ca [7f222b] — DONE, committed `1655ea1e`, NOT deployed / Stage-1).**
User: "make sure conflict when decision/action is made merges and moves the sales, returns, and other
data where its previous link was at … check all the resolve/conflicts." Audited every resolve/Conflicts
flow. The contacts `/merge` endpoint DELETES the loser, so un-repointed FKs were silently orphaned.
Closed the gaps in `cloudflare/src/routes/contacts.ts` merge handler (BACKEND-ONLY, no migration): customers
now also repoint **portal_accounts.contact_id** (0087) + **customer_receivables** (0094 AR ledger, id + name
carry); suppliers now also repoint **product_batches.supplier_id/supplier_name** (0062) + **supplier_invoices**
(0088 AP ledger, id + name carry); delivery already complete. Legacy ledgers guarded by table-existence check.
New `scripts/test-contact-merge-repoints-pure.cjs` (7 checks, all green) proves full movement on the real
migration chain + guards the route still issues every repoint. Findings surfaced for OTHER lanes (NOT taken
here): (a) the PRODUCT merge leaves old sales/movements on the deactivated dup — already OWNED by CATALOG-
INTEGRITY lane 578 (products.ts item 2). (b) The sale-link relink/resolve-missing conflict resolvers move
`sales` only; `returns` cannot join (no `customer_phone` column to disambiguate a per-phone relink) — returns
instead follow through the merge path, which is correct. Disjoint from all active frontend lanes and from 578's
products.ts.
Follow-up (Sep 1, same lane — DONE, committed `6e73b8b8`, Stage-1 / NOT deployed): user ruled "delete not
possible … can keep with note or to survivor" for the Conflicts tab. Removed the per-record **Delete (no
merge)** action from `frontend/src/components/contacts/DuplicatesTab.tsx` (it repointed nothing and would
orphan a record's sales/returns/ledger history) along with its state/handlers/`DELETE_BY_TABLE`/transport
imports (no zombie code). The two resolutions are now **merge-into-survivor** ("Keep this", moves all links)
or **keep-both** (cluster Dismiss marker); each member now also shows its linked-history counts
(sales/returns/points from `/duplicates` `history`) so the reviewer sees what a merge will move. Typed the
new `history` on `contactDuplicates.ts`'s cluster entry. Frontend tsc + sourceSyntaxCheck + related tests
green. Audit of ALL conflict surfaces now closed: contacts merge (repoints, `1655ea1e`) + contacts delete
(removed, `6e73b8b8`) done; sale-link resolvers verified sales-only-is-correct; PRODUCT duplicates tab's
"Remove" is already a merge (`mergePossiblySameProducts` → soft-deactivate + carry stock/lots/images, no
orphan), so the only open products item (repoint historical sales onto the keeper for unified reporting)
stays with lane 578. General Customers/Suppliers per-record delete left untouched (separate intentional feature).
Follow-up 2 (Sep 1, same lane — DONE, committed `30210c86` contacts-duplicates + `5767a532` sale-links, Stage-1 /
NOT deployed): user added "and can always be resolved in conflict." Since the only non-merge resolution is "keep"
(a 0034 `contact_duplicate_dismissals` marker), that keep had to be REVERSIBLE — a kept conflict must always be
reopenable and then merged/resolved, never a one-way hide. Implemented the same reopen pattern on both Contacts-tab
conflict surfaces: **(a) duplicate clusters** — `lib/contactDuplicates.ts` `findDuplicateContactClusters` accepts
`{includeDismissed}` + flags kept clusters `dismissed:true` (open-first sort), new `undismissDuplicateCluster`
(phone: exact delete; name: casing/spacing-tolerant delete via `normalizeContactName`); route GET `/duplicates`
parses `includeDismissed` + new POST `/duplicates/undismiss`; `DuplicatesTab.tsx` gains a "Show kept" toggle,
"Kept" badge and Reopen action. **(b) sale-link conflicts** — route GET `/customers/link-conflicts` accepts
`?includeDismissed=1` + flags each mismatch/missing group `dismissed:1`, new POST `/customers/link-conflicts/undismiss`
(exact delete on the same `customer_id|phone_key` / `lower(name)|phone_key` key the dismiss stored);
`SaleLinkConflictsSection.tsx` gains the Show-kept/Kept/Reopen UI; transport gains `getSaleLinkConflicts({includeDismissed})`
+ `undismissSaleLinkConflict`. 7 shared lang keys added both packs (Khmer verified). Two round-trip tests on the real
migration chain prove keep→reopen is reversible and the modified SQL is valid: `test-contact-duplicate-reopen-pure.cjs`
(7/7) + `test-sale-link-conflict-reopen-pure.cjs` (9/9). Also re-verified no regression: langKeyIntegrity (4288 shared
keys, 7 new keys carry real Khmer), sourceSyntaxCheck (434 files), contact-merge-repoints + productDuplicatesTab tests
all green.
**STILL OPEN for full consistency — Products duplicates tab reopen (ready-to-implement handoff).** The products
"possibly same" review has a server-persisted dismiss (`POST /possible-duplicates/dismiss` → `product_duplicate_dismissals`
0035) but NO includeDismissed + NO undismiss, so a kept products cluster is a one-way hide (violates "can always be
resolved"). Integration map (verified Sep 1): the sweep is `findPossiblySameProductClusters(db)` in
**`cloudflare/src/lib/productIdentity.ts:175` (CLEAN, editable)** — add an `{includeDismissed}` option + flag kept
clusters `dismissed:true`, mirroring `lib/contactDuplicates.ts`. Frontend **`ProductDuplicatesTab.tsx` +
`api/productWriteTransport.ts` (both CLEAN, editable)** — add a Show-kept toggle / Kept badge / Reopen action +
`undismissProductDuplicateCluster` + `getPossiblySameProducts({includeDismissed})`; reuse the SAME 7 lang keys (no new
keys). The ONLY blocked file is the route **`cloudflare/src/routes/products.ts` (peer-dirty, lane 578)** — needs the
GET `/possible-duplicates` to read `includeDismissed` (~line 2684) + a new `POST /possible-duplicates/undismiss` (exact
delete on `product_duplicate_dismissals`, mirroring the contacts/`sale-link` undismiss at 2693). Because the route is the
integration point and cannot be partially-staged out of a peer's hot file here, the whole reopen must land in ONE lane
that owns products.ts (lane 578 or a later session) — do NOT ship the clean lib/frontend halves alone (they'd call a
404 endpoint = broken/zombie code). Whoever lands it should add a `test-product-duplicate-reopen-pure.cjs` round-trip
like the two above.

**→ SMALL-SCREEN PRODUCTS-CARD lane (Sep 1, session 88 [ad9ece] — CLAIMED, in progress).**
User (on a phone): the product-name text on the small-screen product CARD can't be
swiped horizontally to read the rest. Disjoint edit — `products/shared/primitives.tsx`
ONLY: `DragScrollText` gains `touch-action: pan-x` so the name strip pans by touch (an
ancestor `.page-scroll`/body `touch-action: pan-y` was blocking horizontal touch-pan).
Deliberately NOT touching `Products.tsx` (owned by lane 569): the user's other card ask
— hide the inline mobile-card description (remove `<ExpandableDescription>` at
`Products.tsx:3442` + drop it from the line-25 import) — is SURFACED here for lane 569
to fold in. The "official product name just copies the shop name" ask (confirmed:
6030/6031 products have the official-name line == shop name) is a READ-ONLY web-research
pilot (Abercrombie, ids 1-8) presented for user approval — no DB writes, Stage-1
respected (no deploy). Supplier-blank on all 6104 is already owned by CATALOG-INTEGRITY
lane 578 — not duplicated here.

**→ DATE/TIME UX UNIFICATION LANE (Sep 1, Claude→Codex handoff — DONE in code; final Stage-1 certification next, no deploy).**
User ask (verbatim intent): default the Start/End range to the PRESENT DAY on all
pages (dashboard, products, sales, branch, …); REMOVE the preset chips; the Expenses
(Fees) section is missing an Export button+functions — add it; the Sales report's
time control should apply to EVERY start/end date picker, in 24-hour format (not 12h
AM/PM), with ONE combined date+time icon (no redundant time icon); and fix data
wiring — "it shows wrong and incomplete data." This lane OWNS/continues the stalled
DateTimeRangePicker lane's shared files and centralizes the change:
`components/shared/StatsRangeRow.tsx` (drop presets, enable time) +
`DateTimeRangePicker.tsx` (already 24h) + `statsStripPresets.ts`, plus
`fees/FeesPage.tsx` (export) and per-page default-today / data-wiring fixes. Dashboard
(`dashboard/Dashboard.tsx`) has its OWN preset/rangeId model and is co-held by
session-59's analytics-i18n lane — coordinate before editing it. Path-scoped commits
only; lang packs name their ride-alongs.
- **✅ BACKEND HALF (Slice 1) COMMITTED + CERTIFIED GREEN — the "wrong/incomplete data" root cause.**
  The data-wiring complaint was a genuine **UTC+7 bucketing + ISO-format data-loss bug**, now fixed
  format-robust and landed. Commits: `67b8e3b9` (fix(dates): format-robust UTC+7 day bucketing across
  ALL backend date filters — `salesAnalytics.ts` kernel, `routes/sales.ts` `/`·`/stats`·`/export`,
  `returns.ts`, `inventory.ts` `/movements`, `stockLedgerQuery.ts`, `auditLogQuery.ts`, all via the
  single source `lib/businessDateWindow.ts`) + harness repairs `11ffeff1` (CRLF-tolerant import-strip),
  `74bd4ae6` (lift the `returns` table so session-62's CUSTOMER_REFUND_JOIN resolves), `1c3fa481`
  (add `businessDateWindow` — and peer `undoAppliers` — to the isolate-compile loader override maps).
  **WHY the hybrid redesign:** the earlier `date(col)`-only form did a raw STRING compare against a
  space-formatted bound; at string pos 10 ISO `'T'`(0x54) sorts AFTER `' '`(0x20), so ISO end-edge rows
  were silently DROPPED (prod `sales.created_at` is 100% ISO; `inventory_movements` is MIXED). New form
  AND-s a shape-agnostic `date(col,'+7 hours')` day check with a redundant **sargable** date-only
  pre-filter on the raw column (`col >= date(@p,'-1 day')` / `< date(@p,'+1 day')`) — index stays usable,
  no valid row excluded. Pure query change, **NO migration** (zero 0097/0098/0099 collision).
- **✅ CERTIFIED: committed HEAD `1c3fa481` is GREEN** — cloudflare tsc clean + all 17 affected pure
  tests pass, verified on BOTH LF and an isolated **CRLF** worktree at the exact committed commit (dirty
  working tree is a false signal — did not trust it). Revenue reconciliation is session-62's, already
  layered cleanly on top (`9354f1ce`); my date hunks in `salesAnalytics.ts` were surgically partial-staged
  so their uncommitted revenue block was never captured.
- **⚠ DEPLOY-WT IS STALE + RED — driver must advance.** `git worktree list` shows the deploy worktree
  `deploy-wt` parked at `11ffeff1`. That commit is RED in the test suite: the returns-table
  (`74bd4ae6`) and businessDateWindow-loader (`1c3fa481`) harness fixes land AFTER it, so at `11ffeff1`
  `test-sales-day-report-pure` + the 4 `loadReal` harnesses fail (harnesses ONLY — product code compiles
  clean at `11ffeff1`). **Deploy driver (7b): advance deploy-wt from `11ffeff1` → `1c3fa481` before
  certifying/deploying**, else the isolate-compile suite false-alarms on the tz batch.
- **✅ Slice 2 recovered and completed:** `ee1483a2` adds complete paginated Expenses export flows;
  `b23c2264` gives the Sales list, header stats, stats strip, reports, status mix, and return breakdown
  one shared fixed-UTC+7 `HH:MM` filter (ordinary + overnight ranges, with the full `23:59` minute
  included); `65fcd70b` defaults every Start/End picker to today, removes StatsRangeRow/StatsStrip and
  Dashboard preset chips, supplies explicit 24-hour fields with one combined date/time trigger icon,
  and threads Sales times through transport. Time controls render only on real timestamp-backed
  surfaces (Sales and the contact delivery/purchase reports); date-only ledgers remain date-only so
  the UI never advertises a filter their APIs cannot honor. Targeted gates green: both TypeScript
  projects, source syntax 434/434, stats-strip/performance source locks, UTC+7 date-window 26/26,
  and Sales day-report kernel 26/26. Exact committed-HEAD full certification is the final Stage-1 gate.

**✅ DEPLOYED & VERIFIED LIVE — security batch + branch-transfer C1 (Part 577, Aug 31 ~17:15 UTC).**
Production = commit `d558dcfb`, Worker Version `30e8a9b3-ee79-4c57-b732-cd63c2dc2cd6`. Shipped the
3 security fixes (H1 products `/rename-brand` Full `manage_lookups` gate, H2 offline chunked-upload
library gate on sync.ts, M1 `/ws` session-gate closing 4001) + C1 branch-transfer FIFO fix
(bulk/single no-batchId transfers now move per-lot `branch_batch_stock` and materialize the
destination lot — was stranding source lots and drifting the per-lot ledger; branch totals/POS were
never affected) + C1 strict-decrement hardening (concurrent drain aborts instead of minting drift,
matching inventory.ts). `deploy:full` exit 0; migrate:remote / migrate:import:remote were no-ops
(zero new .sql in `34e0228f..d558dcfb`). Certified committed HEAD in an isolated worktree first
(both tscs, vite build, 120/125 pure tests; the 5 "fails" were line-ending brittleness in
source-lock regexes on the CRLF checkout — every locked symbol grep-verified present). Live:
admin+storefront `/health` 200, `/ws` unauth → 426 (M1 handler alive/gated), admin root 200.
**main HEAD has since advanced past `d558dcfb` (other lanes) — that later work is NOT in this deploy.**
See session-log Part 577.

**DEPLOY QUEUE since Part 577 `d558dcfb` (coordinator 7b, Sep 1 ~01:05 UTC) — HOLDING this tick.**
3 self-contained frontend fixes are deploy-ready: dashboard fit-shortest card heights `a29d2e27`,
dashboard Profit/COGS i18n + payment-legend `1872a52e`, small-screen product-name touch-pan
`2d5f1c8f`. The only backend commit — merge re-parents `sale_items`+`inventory_movements` onto the
survivor `c44a4520` (Part 578 item 2a) — is HELD: its undo/redo slice (item 2b) is being written
UNCOMMITTED in the working tree right now (a `reversal` object wired to `lib/undoAppliers.ts` +
`undo_snapshots`). Shipping the re-parent ahead of its undo would half-ship a fix the user approved
"with full undo/redo", and races the active lane owner. **NOTE for any session that runs cloudflare
tsc on the dirty tree: the error `'reversal' does not exist in type` at products.ts:2394 is that
in-progress uncommitted slice, NOT a broken HEAD — committed HEAD `c44a4520` compiles clean
(`git show HEAD:…/products.ts` has no `reversal`). Don't false-alarm.** Next deploy trigger:
catalog-integrity lane completes item 2 (undo migration `0097` committed) + green committed HEAD →
batch the 3 UI fixes + complete catalog item 2 in one certified-worktree deploy.
⤷ UPDATE (Sep 1 ~01:20 UTC, coordinator 7b — supersedes the trigger above): scope grew. The
user gave a fresh directive (relayed by session-62): proceed with revenue-definition reconciliation
AND **Phnom Penh business-day report bucketing** ("timezone and data are all Phnom Penh time" =
fixed UTC+7, matching the standing memory directive) — a REQUIRED data-correctness fix and the
likely root cause of the user's "calculations are not correct" complaint (morning sales currently
mis-bucket). A lane is implementing it NOW (uncommitted: `cloudflare/src/lib/businessDateWindow.ts`
new + `salesAnalytics.ts`/`routes/sales.ts`/`importEngine.ts`/`Sales.tsx` dirty; no committed board
claim / owner unattributed in git yet). Deploying the ready cosmetic+merge batch ahead of this would
ship everything EXCEPT the fix for the user's actual complaint, then force an immediate re-deploy.
NEW deploy trigger: the Phnom Penh business-day + revenue-reconciliation fix is COMMITTED + green
committed HEAD → then deploy ONE coherent data-correctness batch (timezone/revenue fix + the two
already-committed merge fixes `c44a4520`/`1655ea1e` + the 3 UI fixes). Part 577 security+C1 is
already live (nothing since is deployed). USER DECISION (Sep 1, via session-59): the SINGLE COHERENT
BATCH — two-stage is OFF. Hold until the Phnom Penh business-day + revenue-reconciliation fix is
committed green, then deploy that one certified batch (tz/revenue + `c44a4520` + `1655ea1e` + the 3
UI fixes). session-62 verified the date lane carries NO migration (0097 collision ruled out) and
that revenue reconciliation MUST fold into the same commit; 62 holds deploy/migrate/secrets and
pings 7b when it's committed green. Post-deploy 7b verifies: a near-local-midnight sale buckets to
the correct Phnom Penh business-day, live revenue matches the user's chosen definition, /stats is
sargable — then pings 59 with the live Worker version.

**⚠ PROD DATA VERIFIED CLEAN on the branch/sales/gross-sales claims (coordinator 7b, Sep 1 ~00:45 UTC, read-only prod D1 SELECTs — re-verify before acting, this is a snapshot not ground truth).** A peer relayed three "production data-corruption" findings; direct prod query REFUTES all three: (1) `branches` has exactly two — `Warehouse`(1) + `Shop`(2); NO stray "Leang Cosmetic Shop" branch exists (already canonical — do NOT "merge a stray branch", there is none to merge). (2) All 14,939 sales are on branch_id=2 (Shop); ZERO NULL branch_id; zero on Warehouse. (3) `subtotal_usd` is populated (0 null, 4 zero-or-null of 14,939, SUM=$1,873,656.34) so gross_sales_usd (salesAnalytics.ts:274 = COALESCE(SUM(subtotal_usd),0)) computes fine. The local miniflare D1 is a different, messy dev set (harmless). **Any session picking up a "prod data-corruption" fix must re-run read-only prod SELECTs first — acting on the stray-branch premise would corrupt already-clean prod.** Follow-up (Sep 1 ~01:05 UTC): the "missing timestamps" claim is ALSO refuted — `sales` 0/14,939 missing `created_at`, `inventory_movements` 0/21,375 missing; basic stock integrity clean (0 negative `branch_stock`, 0 negative `branch_batch_stock`, 0 unnamed of 6,104 products). SIX specific corruption claims now all refuted against live prod (stray branch, NULL branch_id, subtotal, timestamps, negative stock, unnamed products) — the reports read like stale screenshots or the messy local miniflare set, not production. Only the vaguer supplier-attribution + naming-convention drift remain unverified; they need a concrete offending record from the user before any audit, and NO prod mutation without an explicit user request.

**✅ STAGE 1 COMPLETE — ALL 9 AUDIT REDS RECONCILED, SUITE GREEN, DEPLOYING (user
authorized the full cycle; coordinator 7b, Aug 31 ~20:30).** Backend **132/132**,
frontend **148/148** = **280/280 green**; both tscs + production build green;
88-migration chain green. Fixes committed: 06dab95f (8 stale reds — permissions
view-tier assertions, batch-guard restore in ManageBatchesModal, StatsRangeRow
consistency, contacts/returns filter-count) + 78593220 (missing `area` i18n key;
the stalled DateTimeRangePicker lane's balanced lang keys rode along, its component
code deliberately NOT committed/deployed). **✅ DEPLOYED & VERIFIED LIVE — FREEZE LIFTED (Part 576, ~20:50).** Production =
commit `34e0228f`, Worker Version `80bee7ec-b299-4948-884d-78f9d655c6b0`.
`deploy:full` exit 0 (typecheck → build → migrate:remote → migrate:import:remote
→ secrets:sync → deploy); BOTH remote D1s migrated (business-os + business-os-import,
0094 AR-ledger DDL applied). Live checks: admin+storefront `/health` 200, unauth
`/api/products` 401, **public stock leak still SEALED** (anon catalog exposes only
stock_status + branch_availability). Isolated-worktree deploy from committed HEAD —
no peer envs touched. A **broken-HEAD fix** was needed mid-deploy: the clean-worktree
checkpoint caught that committed contacts tabs required ActionHistoryBar's `dense`
prop, which was stuck uncommitted in the stalled lane (main tree masked it);
committed as `34e0228f` so deploy:full's typecheck-first passed. migrate:remote /
wrangler deploy free to use again.

--- prior audit detail (historical) ---
**📋 STAGE 1 AUDIT RESULTS — coordinator 7b, Aug 31 ~19:40 (ran against clean HEAD
in an isolated worktree, so results are the DEPLOY CANDIDATE, not the dirty tree).**
✅ cloudflare tsc, ✅ frontend tsc, ✅ production vite build, ✅ fresh migration
chain. **RECONCILIATION: 9 reds → 7 → 0** (backend
130/132 after session 27 fixed the 2 stockRevert harness reds, e4e8c9a3;
frontend 142/147). **7 remaining reds, NONE a real regression** — 6 STALE tests +1
trivial i18n bug. Each assigned to its owning lane to reconcile during Stage 1:
- `test-route-permissions-pure` → **permissions lane (Part 557)**: sales.ts reads
  moved to `canReadSales`/`getPermissionTier`; enforcement INTACT (sales.ts:1857/1882).
  Update the assertion to the view-tier API. (Security test — confirm intent.)
- `test-promotion-rules-pure` → **permissions lane (Part 557)**: `requireReadKey`
  replaced `requireKey` on GET /rules; enforcement intact. Update assertion.
- ✅ DONE `test-adjust-received-date-pure` + `test-supplier-attribution-pure` →
  session 27 (e4e8c9a3) added the `applyMovementRevert` stub to both harnesses'
  inventory stub maps (Part 553's revert import is compile-erased in these
  receive/adjust harnesses). Both green.
- `autoMergedFacet.test.ts` → **products lane**: `onRemove` handler shape changed;
  update the regex.
- `performanceLoadingUx.test.ts` → **contacts-filter lane**: `countActiveFlags`
  gained/changed a `genderFilter` flag; update the assertion.
- `statsStrip.test.ts` → **stats/StatsRangeRow lane (Part 560)**: asserts Inventory
  no longer threads range into StatsStrip, but the cards still need it; test
  over-asserts the Part-560 migration. Reconcile the assertion.
- `actionStability.test.ts` → **inventory lane**: wants `batchInventoryInFlightRef`;
  Inventory has `adjustStockInFlightRef`/`transferStockInFlightRef` (lines 529-530,
  shared beginSingleAction guards) — guard intent INTACT, name changed. Update.
- `langKeyIntegrity.test.ts` → **REAL minor bug (contacts/DeliveryTab lane):** key
  `'area'` missing from BOTH packs. `DeliveryTab.tsx:303` does `t('area') || 'Area'`,
  but a missing key makes `t()` return the truthy string `'area'`, so `|| 'Area'`
  never fires and the UI shows lowercase "area". FIX = add `"area"` to en.json + km.json
  (en:"Area", km: proper). NOTE: en/km are currently DIRTY with the DateTimeRangePicker
  lane's keys — whoever fixes must coordinate that shared-file edit (memory rule 12).
Coordinator did NOT self-fix: security tests need owner sign-off, and the lang fix
sits in dirty shared packs. **Stage 1 exit criterion: these 9 reds reconciled →
suite green → then HOLD for the user's Stage-2 go.**

**⚙ STAGE-2 DEPLOY DEPENDENCIES — fold into the deploy plan (coordinator 7b,
verified ~19:50, from session 27's D1/R2 lane, Parts 574-575):**
- **A SECOND remote D1 `business-os-import` (binding `IMPORT_DB`) must exist** — the
  binding is in `wrangler.toml`, and `deploy:full` now chains
  `npm run migrate:import:remote` AFTER `migrate:remote` (verified in
  cloudflare/package.json). The isolated-worktree deploy that runs `deploy:full`
  picks this up automatically; a hand-rolled deploy must NOT skip it.
- **Migration 0094 (customer_receivables AR ledger) is safe for `migrate:remote`** —
  pure `CREATE TABLE IF NOT EXISTS` DDL; it only creates an empty table, the AR
  data import stays gated. The fresh migration-chain test applies it and passes.
- Backend red-count correction: 27's Part-574 refactor briefly broke
  `test-image-pipeline-pure`; 27 FIXED it (25/25). So the backend deploy candidate
  is exactly the 4 STALE reds already listed above — none are 27's, none block build.
- Live ops already applied by 27 (independent of the deploy candidate, informational):
  R2 orphaned-backup cleanup (~220MB) + multipart-abort rule (~486MB draining), D1
  purge 661MB→92MB.

---

**🛑🛑 STAGE 1 — SESSION RECONCILIATION + COMPREHENSIVE AUDIT TOWARD DEPLOY (user
directive via coordinator 7b, Aug 31 ~19:00). ALL SESSIONS READ THIS FIRST.** The
user has put the whole fleet into **Stage 1**. This is a STABILIZE-AND-VERIFY phase,
not a feature phase. Hold here — **do NOT advance to Stage 2 until the user
explicitly says "go for Stage 2."**

What Stage 1 means for every session, right now:
1. **Reconcile your lane.** Commit every finished slice pathspec-atomically (lang
   packs: name ride-alongs), or revert what you're abandoning. Leave NO orphaned
   dirty files. The tree must reflect reality.
2. **Backfill the record.** If you reserved a Part number in a commit message but
   never wrote a `## Part N` session-log entry, write it now. Reconcile any claim
   block against what you actually shipped.
3. **Comprehensive audit (Golden Rule 5 + verification-depth-mandate).** Full
   battery: both packages `tsc`, every backend `test-*.cjs` and frontend
   `tests/*.test.ts`, real vite build, fresh migration-chain test, remote-D1
   integrity/parity probes. Whole-architecture, edge cases, offline+online,
   expected-vs-actual — not just a smoke check.
4. **Do NOT start new feature lanes.** Finish and prove what's in flight; surface
   defects to the board (don't silently fix out of lane). No `migrate:remote` /
   `wrangler deploy` — deploy is a Stage-2/user-gated action.
5. **Known open item to fold in:** the stalled DateTimeRangePicker lane below (green,
   internal-only, ~2.5h frozen) — a reconciliation session should recover/commit or
   confirm-and-drop it.

Coordinator 7b has PAUSED its automatic loop for Stage 1 and is standing by to help
drive reconciliation. Stage 2 begins only on the user's explicit word.

---

**→ MIGRATION-AUG31-AR + KHMER-COMPACT LANE (Aug 31, Part 571 grep-max+1; number races expected): DONE — (A) Khmer compaction shipped & verified; (B) Aug-31 + AR migration PREPARED + VERIFIED, deliberately NOT applied to remote D1 (gated, needs user go-ahead). See session-log Part 571 + `ops/scripts/migration/AUG31-AR-RECONCILIATION.md`.**
Two disjoint asks from the user in one message. (A) **Khmer not compact enough** ("sales page
etc... the rows"): the `body.lang-km` blocks in `frontend/src/styles/main.css` inflate BOTH
line-height (1.68/1.72/1.80) and font-size (.text-xs→0.79rem etc.) app-wide, so every row is
taller in Khmer. Fix = tighten the km line-heights toward the Latin baseline (keep font-sizes/
legibility — the user's Z7/Aug-29 legibility floors stay) so rows compact. ONE shared CSS file,
uncontested by every active frontend lane. (B) **Migration update + deep verify**: user added
Aug-31 day reports + `account-receivable-report all time.xls` (customer AR, 13,244 invoices)
and wants the migration folder rolled forward to the 31st with "no details lost, 100% correct,
nothing hidden/broken". Found: the applied Aug-30 import books every legacy sale as FULLY PAID
(`amountPaid = Grand Total`), keeping credit only as a free-text note — so customer outstanding
balances are lost today. Plan (additive, does NOT disturb the already-applied 0088–0092 / aug30
script): a NEW `ops/scripts/migration/import-aug31-legacy-reports.mjs` for the incremental Aug-31
day + a NEW `cloudflare/migrations/00NN_legacy_customer_receivables.sql` ledger that stores the
AR report faithfully (mirrors 0088 supplier_invoices; AR rows must NOT rewrite sale payments).
Archive the 31st files into `Downloads/businessos-migration-aug28` + `Downloads/27th-30th`.
**Prepare + deep-verify only this session — NO writes to remote D1** (apply is user-gated per
project_deploy; also must be reviewed first because native Aug-31 POS sales may already exist →
double-count risk). Files (path-scoped, DISJOINT from all lanes): `frontend/src/styles/main.css`,
`ops/scripts/migration/**`, `cloudflare/migrations/00NN_legacy_customer_receivables.sql`.

**→ AR-CREDIT + DATA-VISIBILITY + EXCEL-COLUMNS LANE (Aug 31, Part 573 grep-max+1; number races expected): DONE (disjoint-first; some wiring deferred to avoid hot-lane conflict). Shipped: migration 0096 + customer-AR endpoint; SaleDetailModal gap-fill; Returns Status column + shared excel-style ColumnChooser (verified live); ArInvoicesSection built (unmounted — CustomersTab is hot). Deferred: mount AR section, i18n keys (lang packs hot), POS on-credit entry, chooser on hot tables. Detail: `docs/DATA-VISIBILITY-AND-CREDIT-AUDIT.md` + session-log Part 573.**
User: "do all" of the 3 audited threads (see `docs/DATA-VISIBILITY-AND-CREDIT-AUDIT.md`),
"don't let it conflict or duplicate too much." Building disjoint-first to dodge the hot lanes.
(A) **Customer credit / AR**: model the "on credit" state (completed sale that carries an
outstanding balance + optional due date — distinct from `awaiting_payment` which withholds
stock) and surface a customer Receivables view mirroring the supplier `ApInvoicesSection`.
Reuses migration 0094's `customer_receivables`. (B) **Fill visible data gaps**: complete the
now-FREE `SaleDetailModal` (delivery fee, split-tender, actual delivery cost, payment currency,
KHR amounts) + add a Returns status badge. (C) **Excel-style column chooser**: NEW shared
column-visibility model + chooser (reusing the `exportOptions.ts` pattern), first wired into
the FREE Returns list. Files (path-scoped, DISJOINT from every active lane — NOT touching
Products.tsx/Sales.tsx/contacts/shared.tsx/StatsRangeRow/App.tsx/product surfaces/index.ts,
and NOT re-taking migration 0095 which lane 572 owns):
BACKEND — `cloudflare/migrations/0096_sales_credit_due_date.sql`, `cloudflare/src/routes/sales.ts`,
`cloudflare/src/routes/contacts.ts` (add customer-AR read beside the supplier-AP one).
FRONTEND (new files + free files) — `frontend/src/components/shared/{ColumnChooser.tsx,useColumnPreferences.ts}`,
`frontend/src/components/contacts/ArInvoicesSection.tsx`, `frontend/src/components/sales/SaleDetailModal.tsx`,
`frontend/src/components/returns/{ReturnsListSurface.tsx,ReturnDetailModal.tsx}`,
`frontend/src/api/contactReadTransport.ts`, lang packs via a SEPARATE careful merge if needed.
Aug-31/AR migration remains PREPARED, NOT applied (user chose "do all", not "apply").

**→ D1-BLOAT + R2-BACKUP-LIFECYCLE LANE (Aug 31, session-log Parts 574+575): DONE (code) — awaiting Stage-2 deploy. BACKEND-ONLY, disjoint from every frontend lane. Part 574 = D1 661→92 MB + second-D1 (IMPORT_DB) split. Part 575 = DEEP recurrence pass after the user reported R2 still bloated (dashboard 777 MB): found the dominant R2 leak (21 ORPHANED backup folders, 219.7 MB, invisible to retention which only lists .json manifests) + ~486 MB incomplete-multipart parts; LIVE-cleaned both (deleted the 220 MB of orphans; tightened multipart-abort to 1 day to drain the 486 MB). CODE fixes committed to stop recurrence: backup orphan-folder sweep + folder-first delete; Tier-3 cross-DB delete-order fix (parent-after-children); NEW scheduled ephemeral/log retention (rate_limit_events, sessions, verification_codes, lockouts, ai_response_logs, action_history) + stalled-import reaper + bounded orphan-staging cleanup now on the CRON; image-audit rolling cursor; batched audit-log delete. cloudflare tsc clean; backend suite 128/132 (the 4 fails = 7b's known STALE reds in the permissions-557 + stock-ledger-553 lanes, none mine — I fixed test-image-pipeline-pure which I'd broken in Part 574's runStep refactor). Coordinated with coordinator 7b. Deploy = Stage-2/user gate, NOT run. Deferred (documented): FTS optimize, portal-screenshot GC, uploads/ orphan GC, inventory_movements retention. See session-log Part 575.**
User report: "D1 gets very high in size; R2 backups don't auto-delete on deploy, some are ongoing and can't delete; can we use multiple D1s to be smarter/faster?" Live diagnosis (prod D1 49795be9): DB = **661 MB**, of which **import_job_rows (244,716 rows / 246 MB) + import_job_source_rows (214,573 rows / 185 MB) ≈ 65%** is stale import STAGING that the 24h retention sweep should have pruned but never has. Root causes: (1) `import_retention_last_run` setting is ABSENT — the sweep has never completed a run; the scheduled() handler runs every sweep in ONE unguarded await-chain (`index.ts:305`) so a heavy backup throw on the 661 MB DB aborts the chain before retention runs (audit-retention last succeeded Aug 26, right before the big Aug-29 imports). (2) `completed_with_errors` is missing from importRetention's TERMINAL_STATUS_SQL, so those jobs' details are never eligible (5 jobs = 30k+51k rows). (3) 35,869 ORPHAN source rows (parent job already deleted). (4) R2 "ongoing/can't delete" = incomplete multipart uploads from backup runs killed mid-stream (no complete()/abort() ran) — invisible to list(), unremovable by delete(); needs an R2 lifecycle rule. Backups run on the 6h CRON, NOT on deploy (the "every deploy" correlation is coincidental). Plan (all 3 tiers, user-approved): **T1** per-step try/catch in `index.ts` scheduled() + add `completed_with_errors` to `importRetention.ts`. **T2** drop `import_job_rows` from BACKUP_TABLES in `backup.ts`; one-time live purge of terminal-job staging + orphans (~450 MB reclaimed); R2 lifecycle rule "abort incomplete multipart uploads after 3 days" (bucket setting via wrangler, not code). **T3** isolate the two bulk staging tables into a SECOND D1 (`IMPORT_DB`) — surgical, only tables never in an atomic db.batch with operational writes (verified first). Files (path-scoped, DISJOINT from all lanes): `cloudflare/src/index.ts`, `cloudflare/src/lib/importRetention.ts`, `cloudflare/src/lib/backup.ts`, `cloudflare/wrangler.toml`, `cloudflare/src/lib/importEngine.ts`, `cloudflare/migrations/0095+*` (+ possible second migrations dir for IMPORT_DB). No frontend/lang/perm changes.

**→ CATALOG-INTEGRITY LANE (Sep 1, Part 578 grep-max+1; number races expected): CLAIMED / in progress.**
**→ CODEX BROKEN-HEAD PARITY REPAIR (Sep 1): DONE.** Isolated committed-HEAD certification at
`79e4c763` found `productDetailRuleParity.test.ts` red because Part 578 item 5 added
`normalizeProductFuzzyName` only to the canonical backend copy. `077127fd` restored the frontend/
backend identity-rule mirror. The next full isolated run then exposed six worktree-only harness
failures (five CRLF-sensitive source locks plus one incomplete fixture); `cb456096` made those tests
checkout-stable without changing production behavior. Targeted parity + all six repaired harnesses
are green. No deploy/migrate/secrets actions.
User (after a live prod-data audit — 107 duplicate clusters; 44% of products show no supplier;
73% of lots supplier-blank) approved all 4 remediation fixes IN ORDER, each with FULL undo/redo:
(2) product merge must re-parent sale_items + historical inventory_movements onto the survivor
(today they're left on the deactivated dup — sales stay split after a merge); (3) a supplier-backfill
action to attribute the 18,996 supplier-blank lots / 2,667 empty-panel products after the fact
(migration 0062 promised "stay linkable later" but nothing ever does it); (4) the product
/detail-report Suppliers query must resolve name-only lots to their supplier id (like
stockLedgerQuery.ts:109-110 / STOCK_IN_REPORT already do) so one supplier stops splitting into
id:+name: rows; (5) add normalized/fuzzy name matching to duplicate detection (productIdentity.ts)
so renamed-with-own-barcode dupes surface. Undo/redo hooks the existing action_history framework
(0001_init). BACKEND-FIRST + disjoint from the claimed frontend detail lanes — 563 owns
products/surfaces/{ProductDetailModal,ProductDetailReport}, 569 owns Products.tsx/HeaderActions/
StockChangeSection; NEITHER touched here. Files (path-scoped): cloudflare/src/routes/products.ts,
cloudflare/src/lib/productIdentity.ts, cloudflare/migrations/0097_* (undo snapshots; 0095 reserved
by D1-bloat, 0096 taken), a NEW frontend supplier-backfill modal + its api transport (new files,
NOT Products.tsx). Lang keys named at commit if any. Read-only prod queries used for the audit; no
prod data mutated by this lane (merges/backfills are user-triggered actions the code enables).

**→ SUPPLIER-SOURCE-DATA handoff for the CATALOG-INTEGRITY lane (session b7eb, Sep 1; user
asked this session to "check files in downloads/migration and make sure everything is
identified"):** the migration source
`Downloads/businessos-migration-aug28/later/stock_in_invoice_lines.csv` attributes a REAL
supplier to **100% of its 7,340 received lines — 3,484 distinct barcodes, 16 suppliers, ZERO
blank** (bong long, ចែ USA, srey now, j secrat, canada, dane japan, lang, japen, utb, malaysia,
kaka, naomi, autralia, srun, france, piset). So the 18,996 supplier-blank DB lots are an
import-CARRY gap, NOT lost data — the backfill can AUTO-attribute by barcode from this file, not
only prompt the user. **819 barcodes were received from ≥2 suppliers over time** (legitimate
multi-supplier products — this is the id:+name: split fix (4) is about; don't collapse them).
`po_invoices.csv` supplier is invoice-level only (no barcode, 1,613/3,204 blank).
`sold_by_supplier_summary.csv` "(no supplier recorded)" = 4,705 SOLD lines is the sales-side
Unknown bucket. Only products with NO stock-in receipt at all (~2,620 of 6,104) are genuine
"Unknown". Analysis is read-only (scratchpad `supplier_match.mjs`); no code/data touched by b7eb.

**→ STOCK-CHANGES-HEADER-CONSOLIDATE LANE (Aug 31, Part 569 grep-max+1; number races expected): CLAIMED / in progress.**
User batch on the Products page → Stock Changes section (from an annotated screenshot):
(1) the page's info toolkit (`shared/ButtonGuidePopover.tsx`, the "?"/ⓘ that explains every
header button) is too long — make it more compact so the panel is shorter; (2) the section's
"Adjust" button must move UP onto the header row beside the info/History/Manage buttons
(currently it sits in the section body's first row); (3) the loose export affordance in the
section (the `↓ <total> ⓘ` span) is redundant with Manage → Export — remove that whole span
and FOLD the ledger CSV export into the header's Manage → Export (context-aware on this
section). Approach: an imperative-handle bridge — `StockChangeSection` registers
`{ canAdjust, openAdjust, openFastStockIn, runExport }` up to `Products.tsx` via a new
`onRegisterActions` prop (modals + ledger filter state STAY in the section; no giant lift);
`HeaderActions` gains an optional `primaryActionSlot` rendered where Add sits; `Products.tsx`
renders the Adjust menu there on the stock_changes section and points `onExport` at the
ledger export when that section is active. Files (path-scoped, DISJOINT from the
PRODUCT-DETAIL-FLOAT lane which owns products/surfaces/{ProductDetailModal,ProductDetailReport}):
`frontend/src/components/shared/ButtonGuidePopover.tsx`,
`frontend/src/components/products/surfaces/HeaderActions.tsx`,
`frontend/src/components/products/StockChangeSection.tsx`,
`frontend/src/components/products/Products.tsx`. No lang/perm changes (all keys — adjust/
add_stock/remove_stock/adjust_quantity/fast_stockin_title/export — already in both packs).

**→ DETAIL-POPUP-LABEL-SIZE LANE (Aug 31, Part 568 grep-max+1; number races expected): DONE.**
User: the label text INSIDE detail-popup action buttons ("purchases, edits, actions, and
many more") is too big and inconsistent — wants ONE unified, smaller label size across the
click-to-view detail popups. Chosen WITH the user via AskUserQuestion ("Detail popups
everywhere" + "shrink title too"). Audited every detail popup: Returns' `ReturnDetailModal`
(title `text-base`, buttons `text-xs`) and Inventory's `ProductDetailModal` (`text-xs
sm:text-sm`) already sit at the compact standard; the contacts `DetailModal` is being
compacted by the CONTACTS-COMPACT lane (567) and the Products-surface detail float by the
PRODUCT-DETAIL-FLOAT lane (563) — both OFF-LIMITS here. The only unclaimed outlier was
`sales/SaleDetailModal.tsx`, whose three action buttons (membership Save, un-cancel,
status Save) used `text-sm` while its own Print button + the sibling popups use `text-xs`.
Fix: those three `text-sm` → `text-xs`. Titles in scope were already compact (`text-base`
/ bare 14px `font-bold`); the only oversized modal title (`text-lg` in shared `Modal.tsx`)
is used by the contacts DetailModal + form modals, so left to lane 567 / out of scope.
File (path-scoped, DISJOINT from every active lane): `frontend/src/components/sales/
SaleDetailModal.tsx`. No lang/perm changes. progress.md claim visible on disk; code commit
path-scoped to SaleDetailModal.tsx.

**→ CONTACTS-COMPACT LANE (Aug 31, Part 567 grep-max+1; number races expected): CLAIMED / in progress.**
User batch on the Contacts page (Customers / Suppliers / Delivery): (1) the click-to-view
DETAIL float is made more compact (shared `contacts/shared.tsx` `DetailModal` — tighter
label column + row padding); (2) Customers moves its visible "arrange by" SortChip INTO the
FilterMenu (new Sort + Group-by sections wired to the existing `customerSortSpec`; SortChip
removed from that tab only — it stays a shared component used elsewhere); (3) the
Manage/History/Add action-row buttons are made the SAME height + more compact on all three
tabs (History gets `dense` so its `.btn-secondary` min-height:40px stops overriding — true
h-8/32px; Manage+Add h-9→h-8; Add gains `min-w-0` so it shrinks instead of forcing overflow);
(4) section + mini-section chips (Suppliers Directory/Invoices, SupplierInvoicesSection
Stock-In/AP) made compact one-row pills; (5) supplier Purchases + Stock-In invoice reports
cut 5 stats → 4 (two count cells merged, no data dropped) and their filter rows kept to one
line; (6) the Delivery action buttons no longer overlap on small screens (same min-w-0/h-8
fix). Files (path-scoped, DISJOINT from the Sales/Returns lanes):
`frontend/src/components/contacts/{shared,CustomersTab,SuppliersTab,DeliveryTab,
SupplierPurchasesModal,SupplierInvoicesSection,StockInInvoicesSection}.tsx`. No lang/perm
changes (all keys already in both packs); ActionHistoryBar's `dense` prop already on disk
(SALES lane) — used, not edited.

**→ SALES-HEADER-ROW-POLISH LANE (Aug 31, Part 566 grep-max+1; number races expected): CLAIMED / in progress.**
User batch on the Sales-page section headers (Sales/Returns/Expenses): (1) on smaller
screens the Start→End date-range picker takes the WHOLE row — the Today/7d/Month/Year
preset chips stay grouped with the date but wrap to the line beneath it (never move to the
Stats row); (2) the History button must be the same height as its neighbours — it renders
40px because `.btn-secondary`'s `min-height:2.5rem` overrides its `h-8`, taller than the
h-8 Export/Manage/Add buttons beside it, so it gets a `dense` mode forcing a true 32px;
(3) the Returns "Add Return" button becomes a composite icon (a return glyph with a small
"+" built on it, mirroring Products' PackagePlus) with the short word "Return" /
"Supplier Return" (new i18n keys `return`, `supplier_return`). Export/History/Add stay on
the Stats row (already true across all three sections — kept consistent). Files
(path-scoped, DISJOINT from other lanes): `frontend/src/components/shared/{StatsRangeRow,
ActionHistoryBar}.tsx`, `frontend/src/components/returns/Returns.tsx`,
`frontend/src/components/sales/Sales.tsx`, `frontend/src/lang/{en,km}.json`.

**→ PUBLIC-LOADER LANE (Aug 31, Part 565 grep-max+1; number races expected): CLAIMED / in progress.**
User: the public storefront also flashes the admin **"Business OS / Loading this workspace
view..."** splash (`App.tsx` `PageLoader`) — "this can be built-in background backend no
need to show." Fix (path-scoped, DISJOINT from every other lane): `frontend/src/App.tsx`
only — `PublicCatalogView` no longer uses the admin `PageLoader` as its Suspense fallback;
it uses a new quiet, unbranded `PublicCatalogFallback` (neutral storefront background, no
"Business OS"/"workspace" wording) so the catalog chunk streams in silently in the
background. The admin `PageLoader` is untouched (still used for admin `PageSlot`/Login).
The standalone storefront root (`PublicCatalogRoot` → "Loading catalog...") already never
showed the workspace splash and is unchanged. Per public-surface rule (customer pages
never expose admin/internal framing). progress.md claim visible on disk; code commit
path-scoped to App.tsx.

**→ STATS-HEADER-FLOAT LANE (Aug 31, Part 564 grep-max+1; number races expected): DONE (changes swept into peer commits; verified live on the frontend-c preview).**
User batch on the Sales stats header + Reports controls: (1) keep History/Manage on the
SAME row as the Stats chip always (never relocate when the strip expands); (2) drop the
redundant "N sales · $rev" summary beside the Stats chip on Sales (duplicates the Sales
stat card); (3) stat-card detail: instead of an inline expand that pushes content down,
click opens a FLOAT (Modal) above the layer; (4) Reports "view by" type chips collapse
into ONE floating dropdown button on the control row. Files (path-scoped, DISJOINT from
the Products/Inventory lanes): `frontend/src/components/shared/StatsStrip.tsx`,
`frontend/src/components/sales/{Sales,ReportsHub}.tsx`. StatsStrip is shared, so the
button-stays-put + detail-floats changes apply to every data page (Returns/Inventory/
Fees/Dashboard) — cross-surface-consistent by design. No new i18n keys (reuse `view`).

**→ DATE-SCOPE + COUNT-RECONCILIATION LANE (Aug 31, Part 564 follow-up): DONE, verified.**
User: "the number of sales, fees, returns don't match the arrange by date and actual
display." Root cause found: on Sales/Returns/Expenses the prominent Start→End date row
(stripRange) drove ONLY the stats strip, while the LIST used its own separate date
control (Sales listRange/Period, Returns year+month, Fees fromDate/toDate) defaulting to
all-time — so the row said "Today" but the list showed every date, and the strip/list/
report counts diverged. Also the list "N sales | $rev" counted cancelled + awaiting-
payment while the money excluded them. Fixes (chosen WITH the user via AskUserQuestion —
"drive list + stats together" + "count only what the money counts"): ONE date scope
(stripRange) now drives BOTH list and strip on all three pages; the separate Period/
year-month/from-to filters are removed; list defaults to Today. Headline + day-group
counts are money-counting (Sales excludes cancelled+awaiting; Returns excludes cancelled
— its list GET includes cancelled while the refund kernel excludes them). Files:
`frontend/src/components/sales/{Sales,SalesListSurface}.tsx`,
`frontend/src/components/fees/FeesPage.tsx`,
`frontend/src/components/returns/{Returns,ReturnsListSurface}.tsx`. tsc clean; verified
live — Sales "Today" → 4 sales/$42.47, "This Month" → footer "6 Sales | $67.47" with
08/30's 5 cancelled shown as a "0 SALES" day; Fees/Returns lists now honor the date row.
Frontend-only (client counts; the current dataset is well under any page cap).

**→ PRODUCT-DETAIL-FLOAT LANE (Aug 31, Part 563 grep-max+1; number races expected): CLAIMED / in progress.**
User batch on the Products-page "click to view detail" float: (1) the detail float's
Stock Changes / Sales / Suppliers sections show "no data" (backend verified CORRECT —
local D1 report/ledger queries return rows; root cause is the current UI swallows a
fetch failure into a silent empty/Loading state, so the rewrite surfaces errors); (2)
reposition the Batches button — below Status and above the report sections on small
screens, kept in the first half (left column) on large screens; (3) convert Stock
Changes / Sales / Suppliers from click-to-EXPAND SectionCards into click-to-open FLOAT
modals, like the existing Batches button. Files (path-scoped, DISJOINT from active
Products.tsx/HeaderActions/StockChangeSection lanes):
`frontend/src/components/products/surfaces/{ProductDetailModal,ProductDetailReport}.tsx`.
No lang/perm changes (all keys — stock_change_ledger/sales/suppliers/batches/etc. —
already in both packs). Commit `af50009b`.

**CONFIRM-DIALOG rollout — 4 slices done.** User asked for confirm/double-check
dialogs on stock-in/add-product/edit and "all" mutating actions app-wide. Scoped
WITH the user: ONE shared **compact review dialog** (`shared/ConfirmDialog.tsx`,
Modal-based, translated, `danger` variant, summarizes what's about to happen +
Confirm/Cancel) and rollout order "core saves + destructive first."
- Slice 1 (`c1097e82`): the primitive + **Add/Edit product** (ProductForm.saveForm,
  promise-based askSaveConfirm gate) + **Stock-in "Stock one by one"**
  (forms/StockAdjustModal: onAdjust parks the request, commitAdjust writes on confirm).
- Slice 2 (`7ea96da9`): **Bulk stock-in** (BulkAddStockModal) + **per-branch adjuster**
  (BranchStockAdjuster). FastStockInModal deliberately NOT wired — commits per line by
  design (the "fast" path), a per-line confirm would defeat it.
- Slice 3 (`d8547648`): **Contacts create/edit** — customer / supplier / delivery
  (CustomerFormModal, SuppliersTab, DeliveryTab); each folds its exact-duplicate
  window.confirm() INTO the dialog as a danger note (3 native popups retired).
- Slice 4 (`97566c6a`): **Users create/edit** — Users.tsx handleSaveUser splits
  validate→confirm / commitSaveUser (+ a reset effect so a stale flag can't resurface
  the dialog); summary shows username/role/phone/email/status.
Delete already confirms via DeleteConfirmModal. Zero new i18n keys. Each slice: tsc-clean
for its files + vite build clean.
**REMAINING (NAMED so nothing is silently carved out, per cross-surface-consistency):**
the CANONICAL Branches adjust (Inventory.tsx → shared InventoryStockModals) — DRY fix is
to put the confirm in InventoryStockModals and REMOVE the StockAdjustModal-level one to
avoid double-confirm; deferred because Inventory.tsx is dirty in a peer lane (can't
verify). Then the rest of the per-section sweep: Sales/Returns/Fees/Promotions (dirty in
peer lanes — wait), Settings save, imports, POS sale (speed-sensitive — decide with user).
Backup reset is already tier-confirmed. A follow-up chip tracks the sibling stock-in
surfaces.

**→ POS-CARD-PRICE + WHOLESALE LANE (Aug 31, Part 562 grep-max+1; number races expected):
DONE — display `e6959534` + cart/receipt VIP-tag `9c4f9678` + receipt-compact `4c5aa535`
+ wholesale backend `46217e43` + wholesale form/detail `1a921e88` + wholesale POS `c766c47e`
(needs deploy — rides the next one; migration 0093 applied to LOCAL D1 already).**
typecheck (only error is another session's Users.tsx WIP) + check:source + receiptTemplate
+ posCore (incl. new wholesale case) + langKeyIntegrity + permission + image-only tests green.
User (POS product grid card + detail sheet): the grouped card showed the option count twice —
a purple `Groups: N` chip AND a `N options · N total in stock` line — "same thing shown
twice; keep the bottom, rename it `Options: N | Total Qty: n`". Removed the `$min – $max`
price range, "only keep the highest price for selling price" (grouped card now shows
`groupMeta.maxSellingPriceUsd`). Show "selling and VIP same row bottom … VIP just say VIP;
when clicked show the VIP options, click to continue" — grid now shows the selling price + a
plain `VIP` tag on one row; the amount still reveals on tap in the detail sheet. Relabel:
dropped the word "Price" → `Selling` (detail-sheet info row + Selling buttons); VIP reveal
button now reads just `VIP` (was "VIP price"). Files (path-scoped, committed): POS.tsx,
ProductDetailSheet.tsx. progress.md NOT committed by this lane (claim visible on disk).

CART/RECEIPT VIP-TAG SLICE (`9c4f9678`). User: keep the tier tag in the cart, make it a
toggle (default selected/highlighted, deselect → unhighlight), and show it on the receipt
too (VIP now, Wholesale later). Decision (asked): the toggle is a MARKER only — it never
changes the price. CartItem's VIP label is now a toggle chip shown on any line carrying a
VIP price; highlighted when the line is marked VIP (price_mode 'special'). POS's
`toggleTierTag` flips price_mode 'special'↔'selling' WITHOUT touching applied/base price
(number stays put; cart_line_id keeps line identity so no re-key/merge). Receipt prints a
small tag under the item name from the persisted price_mode — NO migration (price_mode
already round-trips on the checkout payload and the sale_items row via `SELECT si.*`, and
printReceipt clones the same DOM for print/PDF, so immediate + reprinted + printed receipts
all carry it). Files (committed): CartItem.tsx, POS.tsx, receipt/Receipt.tsx. When wholesale
lands, generalise the toggle + receipt tag to price_mode 'wholesale' (Khmer បោះដុំ already
wired in Receipt).

WHOLESALE (បោះដុំ) PRICE TIER — DONE (3 slices, committed above). A fourth per-product price
tier alongside selling / VIP(special) / cost:
- migration 0093: additive `wholesale_price_usd/khr` on products (DEFAULT 0). APPLIED to
  local D1 (`migrate:local`, verified queryable); prod applies it via `migrate:remote` in
  deploy:full BEFORE the code deploys, so the new `p.wholesale_price_usd` SELECTs are safe.
  ⚠️ Other local worker-dev sessions must run `npm run migrate:local` (in cloudflare/) after
  pulling, or the products/POS endpoint 500s on the missing column.
- products.ts: wholesale added to both product SELECTs (list + detail/bootstrap → Products
  page, detail modal, POS catalog). Write path needs no change (cleanPayload writes any
  body key matching a real column). Portal SELECTs still exclude it (off public surfaces).
- Product FORM: indigo Wholesale DualPriceInput in the pricing section (state/defaults/
  initial/save all wired). Products detail modal shows a Wholesale row (detail only, not the
  list). POS ProductDetailSheet: a Wholesale add button (flat + grouped) + info row; cart
  shows a Wholesale marker chip (toggle, same rules as VIP); Receipt prints "Wholesale"/
  បោះដុំ from price_mode. posCore resolveCartPriceValues gained a 'wholesale' branch (+test).
- PERMISSIONS: `products_image_only_show_wholesale` grant added end-to-end (field map,
  editor definition + alsoClearsKeys, Product Viewer preset, both lang packs, field-map
  test). This IS the "update permissions for image upload only" the user flagged.
- i18n: `wholesale_price` = "Wholesale"/"បោះដុំ" (both packs); form/POS labels use inline
  tr()/posCopy() with Khmer.

STILL DEFERRED (needs the user, or a follow-up):
- The "wholesale only > {N}" NOTE + its DEFAULT-OFF auto-apply toggle. Data model is
  ambiguous (free-text note vs. structured min-qty + `wholesale_auto` flag) — needs the
  user's call before a second migration. NOT built.
- Peripheral surfaces not yet carrying wholesale: CSV import mapping (importEngine, like the
  vip_price_usd map), the inventory clone (inventory.ts:~1083 copies special_price, not
  wholesale), and any explicit-column backup/export. Additive, non-breaking (wholesale just
  stays 0 there until wired).

**→ STATS-DATE-ROW LANE (session 50, Aug 31, Part 560): DONE (needs deploy — rides
the next one). Commits `3772f08f` (Sales/Returns/Fees + new StatsRangeRow + test),
`f87a8422` (Inventory), log `886b2239`.** User: "fish out
the start date and end date from the stats button ... right above the search bar row
... applies to all section, mini sections, and pages ... stats can be placed at the
top ... the start and end date will also apply to it." So the Start→End range picker
(+ presets) is lifted OUT of the folded StatsStrip and becomes its own always-visible
row directly above the search bar; StatsStrip is left backward-compatible (its inner
date row only renders when a caller still passes range/onRangeChange), so pages
migrate independently across sessions. New shared `shared/StatsRangeRow.tsx` (the
picker + Today/7d/Month/Year presets, reused everywhere). Migrated: Sales, Returns,
Fees (row above search) + Inventory (its stats live on their own section chip, so the
row leads the stats section directly above the strip — done AFTER the Part-559
movements lane committed Inventory.tsx clean). Dashboard already keeps its range as a
separate card (passes no range) so it needed nothing. Files (path-scoped): frontend
shared/StatsRangeRow.tsx, sales/Sales.tsx, returns/Returns.tsx, fees/FeesPage.tsx,
inventory/Inventory.tsx, tests/statsStrip.test.ts (rode the report-currency lane's
orphaned working-tree edit into `3772f08f` — noted). NO lang/perm changes (preset
keys already exist). StatsStrip.tsx + DateTimeRangePicker.tsx untouched. Follow-up:
once every caller drops range/onRangeChange, delete StatsStrip's now-dormant inner
date row.

**[DONE (slice 1 of N) + VERIFIED LIVE — permissions-granularity session, Aug 31
(Part 557, commit `7fa62811`): read-only `view` tier + Settings wired.** First a
FULL backend security audit: all 182 mutating handlers across 29 route files are
gated — the ~54 a crude scan flagged are false positives (helper guards like
`denyUnlessRestorePermission`/`denyUnless`/`requireKey`/`requireImportPermission`,
router-wide middleware, `isAdminControlUser`, self-scoped notes, public-by-design
portal/auth, or the sync outbox delegating to the real routes). **No backend
loopholes.** Then the granularity work the user asked for: a real `view` tier
(VIEW_TIER_KEYS) alongside `review` — page/data visible, every write blocked.
Because hasPermission() is strict `=== true`, a 'view' value already fails every
existing write gate with ZERO per-route change; getPermissionTier() just newly
reports 'view' so reads/page-access see it. **Settings** wired as slice 1: read is
already open to any signed-in user, save is a strict `hasPermission('settings')`
POST, so a view grant sees every value but Save becomes a "View only" badge and
the POST 403s. Editor renders a teal None/View only/Full picker (middleTier:'view').
**Verified LIVE vs the real worker:** settings='view' user → GET /api/settings 200
(read), POST /api/settings 403 (save). New `test-view-tier-pure` (7 checks) pins the
model + front/back set sync; permissionEditor test now checks REVIEW_ vs VIEW_TIER
coverage; full frontend suite green for these files (the 2 tsc errors in the tree
are a peer's in-flight StatsStrip API change, not this slice).
**STILL OPEN (next slices, same "highest-risk first" plan):** wire
**Users** to view-tier (Users needs care — its writes currently gate on
`isAdminControlUser`, a privilege-escalation boundary that view-only can extend
safely but Full must not loosen without the anti-escalation guards). POS is likely
not meaningful as view-only (it's a checkout surface).]**

**[DONE (slice 2 of N) + VERIFIED LIVE — permissions-granularity session, Aug 31
(Part 557 slice 2): read-only `view` tier extended to Sales.** `'sales'` added to
VIEW_TIER_KEYS (both `cloudflare/src/lib/permissions.ts` and
`frontend/src/utils/permissions.ts`). Backend: new `canReadSales(user)` =
`getPermissionTier(user,'sales') !== 'none'`; all 8 sales READ routes
(`GET /`, `/stats`, `/stats-strip`, `/daily-report`, `/day-report`, `/export`, and
the two dual `sales`-OR-`contacts` reports `/delivery-contact-report` +
`/customer-report`) now admit a `view` grant, while the 3 writes stay strict —
`POST /` create keeps `hasAnyPermission(['pos','sales'])`, `PATCH /:id/status` and
`PATCH /:id/customer` keep `hasPermission(user,'sales')` (=== true), which a `view`
value fails. Static-audited all 11 route decls: every one gated, no read left
open, no write loosened. Frontend `Sales.tsx`: `canEditSales =
getPermissionTier('sales')==='full'` guards `handleStatusChange`,
`handleBulkStatusUpdate`, `handleAttachMembership` (all notify+return early), hides
the bulk Done/Delivery/Cancel buttons (Export+Clear stay), hides Import in the
Manage menu (Export stays), and passes `onStatusChange`/`onAttachMembership` to
`SaleDetailModal` only when Full (the modal already null-guards them, so the status
controls + membership form vanish). Editor row marked `tier:true middleTier:'view'`
with `perm_sales_view_desc`; `perm_sales_view_desc` + `perm_view_only_action` added
to BOTH packs (en.json committed by a peer already carrying both; km.json in this
commit). **Verified LIVE vs the real worker (isolated `wrangler dev` on :8799 over a
private D1 copy, three minted sessions):** sales='view' user → `GET /api/sales` 200
returning real sale rows, `/stats`+`/stats-strip`+`/daily-report`+`/export`+
`/delivery-contact-report` 200, `PATCH /:id/status` 403, `PATCH /:id/customer` 403,
and sale 13 stayed `completed` (blocked writes mutated nothing); no-grant user →
403 on every sales endpoint; full user (sales:true) → reads 200 and `PATCH status`
400-not-403 (passed the gate); no cookie → 401. `test-view-tier-pure` grown to 12
checks (Sales tier + `canReadSales` shape + a routes/sales.ts source-guard);
frontend+cloudflare tsc green; permissions/permissionActions/permissionEditor/
langKeyIntegrity + `verify:i18n` (4254 keys both packs) all green.
**STILL OPEN:** Users view-tier (the delicate `isAdminControlUser` slice).]**

**[DONE (slice 3 of N) + VERIFIED LIVE — permissions-granularity session, Aug 31
(Part 557 slice 3): Users section = admin-only, fake `users` toggle REMOVED.**
Audit finding: the `users` permission key is checked NOWHERE on the backend —
every route in `cloudflare/src/routes/users.ts` (reads AND writes: `GET /users`,
`/roles`, `/users/:id/profile`, create/update/delete users+roles, password
reset) gates on `isAdminControlUser(actor)` (reserved `admin` username / `admin`
role code / explicit `permissions.all`), and `Users.tsx`'s own `canManage` is
`hasPermission('all')`. So granting a non-admin `users:true` ("Full") was a FAKE
control — the Settings→Users section appeared but `load()` short-circuits on
`!canManage`, showing an empty, no-op panel while every API call 403s. **User
chose (AskUserQuestion): keep Users admin-only and remove the decorative toggle**
(vs a read-only view tier, or loosening writes to non-admins with anti-escalation
guards). Frontend-only, zero backend change (backend was already correct):
removed the `users` section from `permissionDefinitions.ts` (so admins can no
longer grant a non-functional `users` permission); `SettingsHubPage` `canUsers`
now `hasPermission('all')` (was `getPermissionTier('users') !== 'none'`, which a
stale grant could satisfy); `AppContext` settings page-access dropped its dead
`users` disjunct (backup-or-admin only). `perm_users`/`perm_section_users` left
in both packs (now unreferenced, harmless — not worth churning the peer-managed
lang files). **Verified LIVE vs the real worker (isolated `wrangler dev` :8798,
private D1, two minted sessions):** `users:true` non-admin → 403 on `GET /users`,
`GET /roles`, `POST /users`, `PUT /roles/2` (the fake control, proven); admin →
200 on `GET /users`+`/roles` returning the real roster. Frontend tsc clean for my
files (the 4 Inventory.tsx tsc errors + 2 `verify:i18n` misses are a peer's
in-flight movements-export WIP, not this slice); permissionEditor/permissions/
langKeyIntegrity green.
**View-tier plan status:** Settings ✓, Sales ✓, Users → resolved as admin-only ✓.
POS is a checkout surface (not meaningful as view-only). Remaining coarse
Full/None sections (dashboard, customer_portal, promotions, review, audit_log,
backup) could take a view tier later if the user wants it.]**

**[DONE (slice 4 of N) + VERIFIED LIVE — permissions-granularity session, Aug 31
(Part 557 slice 4): read-only `view` tier extended to Promotions.** Audit of the
6 remaining coarse Full/None sections first: **dashboard** and **audit_log** are
inherently read-only (no writes under their key -- a view tier would be view==full
fake), **customer_portal**'s admin write gates on `settings` not the key (no clean
split), so those 3 stay Full/None; **review**, **promotions**, **backup** genuinely
support a read/write split. Wired **promotions** (clearest): `'promotions'` added to
VIEW_TIER_KEYS (front+back). Backend `routes/promotions.ts` gains `requireReadKey`
(admits tier != none) on `GET /rules` (the rule-list read); every write
(`POST/PUT/DELETE /rules`) keeps strict `requireKey('promotions')`; `/rules/active`
stays public (POS/storefront pricing needs no grant). `PromotionsPage.tsx`:
`canManagePromotions = tier==='full'` guards saveRule/removeRule/openNewRule/
openEditRule and hides the New-rule + per-row edit/delete controls; a view user sees
the rule list read-only. Also fixed a PRE-EXISTING fake control found in passing --
the Discounts sub-section edits per-product discounts via `updateProduct` (backend
`'products'` gate) but was coupled to `canPromotions`, so a promotions user without
products saw a discount editor that 403'd; it now self-gates on
`canManageDiscounts = getPermissionTier('products') !== 'none'` (its real gate).
Editor row marked `tier:true middleTier:'view'`; `perm_promotions_view_desc` +
`perm_view_only_generic` added to BOTH packs. **Verified LIVE (isolated wrangler
dev :8797, private D1, three sessions):** promotions='view' → `GET /rules` 200 +
`/rules/active` 200, `POST/PUT/DELETE /rules` 403; no-grant → `/rules` 403 but
public `/rules/active` 200; full → read 200 + `POST` 400-not-403 (passed gate).
`test-view-tier-pure` grown to 16 checks; cloudflare tsc + permissionEditor/
langKeyIntegrity green; my files frontend-tsc clean (the Inventory.tsx +
ExportRangeDialog i18n/tsc misses are peers' in-flight work). NOTE: peers held
permissionDefinitions.ts + en/km.json mid-edit (a `products_image_only_show_wholesale`
toggle + `wholesale_price`); this commit was patch-isolated to my hunks only, leaving
their bits unstaged in the shared tree.
**STILL OPEN (genuine view-tier candidates):** **review** (see the approval queue vs
approve/reject) and **backup** (see backup list/status vs export/restore) -- both
marginal use cases; ask before wiring.]**

**[DONE (slice 5 of N) + VERIFIED LIVE — permissions-granularity session, Aug 31
(Part 557 slice 5): read-only `view` tier extended to Review (approval queue).**
`'review'` added to VIEW_TIER_KEYS (front+back). Backend `routes/reviewQueue.ts`:
the reader middleware (which gated the whole queue) now admits `getPermissionTier
!== 'none'` (view OR full), so a view grant can read the pending queue (`GET /`,
`GET /:id`); the two writes (`POST /:id/approve`, `/:id/reject`) each re-check
strict `hasPermission('review')` (=== true), which a `view` value fails. The
submitter's own `/mine` + `/:id/resubmit` routes were never review-gated and are
untouched. `ReviewQueue.tsx`: `canReview = tier==='full'` guards
handleApprove/handleReject and hides the per-row Approve/Reject buttons; the queue
list still renders read-only (ReviewLogsPage already gates the section on tier !=
none). Editor row `tier:true middleTier:'view'`; `perm_review_view_desc` in both
packs. **Verified LIVE (isolated wrangler dev :8796, 3 real pending rows):**
review='view' → `GET /api/review` 200 (real queue rows) + `GET /:id` 200,
`POST /:id/approve` 403, `POST /:id/reject` 403; no-grant → 403; full → read 200 +
`POST /999999/approve` 404-not-403 (gate passed). `test-view-tier-pure` 20/20;
cloudflare tsc + my frontend files clean. Committed `b30e5765`.

**[NOT WIRED — Backup stays Full/None (Part 557 slice 6, deliberately abandoned):**
Backend split IS clean (list/maintenance reads vs create/restore writes), but the
frontend **Backup panel bundles many independently-gated write tools** — export,
restore, maintenance-clear, Google Drive OAuth (save/connect/sync/disconnect/
forget), doctor, and job cancel/clear — across THREE keys (`backup`,
`backup_restore`, `drive_credentials`). A clean view tier would need every one of
those gated; a partial job leaves fake controls (buttons that 403), which the
project forbids. Disproportionate to backup's marginal value, so the backend +
frontend edits were reverted and backup remains Full/None. Same disposition as
dashboard/audit_log/customer_portal (not clean view-tier candidates).]**

**View-tier program — FINAL:** wired & verified live = Settings, Sales, Promotions,
Review. Admin-only (no view tier, by decision) = Users. Not clean view-tier
candidates (would be fake) = dashboard, audit_log, customer_portal, backup, POS.]**

**[GRANULAR-BREAKDOWN LANE (Part 557 slice 7+, this session): user re-scoped the
5 "not view-tier" sections — wants real per-function/action grants so roles like
"employee" can be managed clearly.** Audit of the 5:
- **dashboard** — ALREADY granular: `dashboard` (page access) + `dashboard_export`
  (independent export toggle). "Hidden from employee" = just don't grant `dashboard`.
  No backend calls; pure frontend page/export gating. No change needed.
- **pos** — ALREADY grantable: `pos` lets an employee ring sales (POST /api/sales =
  hasAnyPermission(['pos','sales'])). "POS full access to employee" already works.
- **backup** — ALREADY `backup` (export, high) + `backup_restore` (critical). Stays
  restricted. No change.
- **audit_log** — DONE + VERIFIED LIVE (slice 7, commit 3035bc0e): own-vs-all view
  tier. `view` = see your OWN audit entries (backend forces userId=self, no name
  leak, purge blocked); `full` = everyone's + deleted-sales ledger + (admin) purge.
  Matches user's "audit log shows only for the user, admin shows all." Live :8795:
  view total=3 own + ?userId=999 bypass still own=3; full total=67; none 403.
- **customer_portal** — DONE + VERIFIED LIVE (slice 8, commit 7ff2eff0). User chose
  FULLY GRANULAR. `customer_portal` was a page-visibility gate only (all portal
  content saved via POST /settings on the `settings` grant -> customer_portal-only
  users saw an editor whose every save 403'd, a fake control). Split into 4 real
  per-area write grants: **portal_posts** (posts/promos), **portal_faq**, **portal_about**,
  and **customer_portal** repurposed as the "portal config" catch-all (branding, media,
  theme, catalog display, social, AI, maps, translations, publish, loyalty, submissions
  — also fixes the loyalty-editor fake control). Backend settings.ts buckets the
  customer_portal_* keys (settingsBucketPermissionFor); the all-or-nothing POST /settings
  accepts a key on bucket-grant OR `settings` (superset) OR admin, so no Settings admin
  regresses. portal.ts submission moderation moved settings->customer_portal and the
  review-LIST read gained a gate it lacked (was requireAuth-only). Frontend: new
  utils/portalPermissions.ts mirrors the buckets; CatalogPage per-area canEdit flags +
  save-payload filtering + section-tab filtering; CatalogEditorSurface gates the display
  tab's config toggles vs the posts editor (display:contents wrapper); AppContext opens
  the catalog page for any portal grant. Editor shows 4 grants; perm_portal_posts/faq/
  about + updated perm_customer_portal both packs. **Verified LIVE (:8794):** portal_posts
  -> posts 200, faq/about/config 403; portal_faq -> faq 200, posts 403; customer_portal
  -> config+loyalty 200, posts/faq 403; settings -> all 200; none -> 403; submissions
  review 200 config/settings, 403 posts/none. test-portal-buckets-pure 7/7 (incl. be<->fe
  key-set sync); front+back tsc + permissionEditor + parity green.

**GRANULAR-BREAKDOWN LANE — COMPLETE:** all 5 of the "not view-tier" sections resolved.
dashboard/pos/backup were already granular (no change). audit_log got own-vs-all (slice
7). customer_portal got 4 per-area grants (slice 8). No fake controls anywhere.]**

**→ FILTER-CHIPS-LANE (this session, Aug 31): CLAIMED.** User: the sales filter
menu (and every other) renders the CHOSEN filters as removable chips OUTSIDE the
menu, in the same toolbar row as the search bar + Filters button — remove that
everywhere; chosen options should show ONLY inside the menu (they already do, via
each section's collapsed summary + checked rows). Fix is in the shared
`shared/FilterMenu.tsx`: drop the `ActiveFilterChips` outside-render + its
`showActiveChips` prop, `collectSectionChips`, `MAX_VISIBLE_CHIPS`, and the
`activeChips` field on `FilterSection`; then remove the now-dead `activeChips`
producers in `shared/{AvailabilityFilterOptions,IssuesFilterOptions,PromotionsFilterOptions,SearchModeFilterOptions}`
and `products/{CreatedDateFilterOptions,AutoMergedFilterOptions}`. Files
(path-scoped): frontend shared/FilterMenu.tsx + those 6 producers +
products/helpers/productMenuHelpers.ts (comment only). No lang/perm changes.

**→ PRODUCTS-SLICE-EXCISION LANE (this session, Aug 31 ~late, fourth batch):
DONE — commits `b6f3ef7a` (excision + ranged movement/stats exports; the four
file deletions + the /stock-ledger 1000-cap were swept into peer commits
`b0f96c9f`/`46217e43` by shared-tree races) + `03d8fcac` (Stock Changes
ranged CSV export + detail-float movement-history Load more) + `c5f6906c`
(log, Part 564; code commits say 562 — number races). RESOLVES the open
follow-up below: Inventory.tsx 4,033→~2,500 lines, dormant products slice
gone (InventoryProductsSurface.tsx + InventoryBatchModal.tsx + their two
tests DELETED, chain updated), Movements keeps the per-product detail with
its history preview + complete adjust/transfer/batches modals. NEW shared
ExportRangeDialog: every export (Movements / Stats & Branches / Stock
Changes) opens a Start→End step seeded from the page's own range, editable,
truncation always notified. fe+cf tsc clean; all named suites green on this
lane's files (langKeyIntegrity/statsStrip fail only on the contacts and
stats lanes' mid-save dirty files). Needs deploy (rides the next one).
Small leftovers in the Part-564 log entry: inventoryExport.ts's unused
catalog collectors; notification #product- anchors land on Stats & Branches
now (repoint at the Products page later).**

**→ ADD-STOCK-MERGE LANE (this session, Aug 31 ~evening, third batch): DONE —
commit `2b49ba47` (message says Part 560; log entry is Part 561 — number
race with the stats-date-row lane). fe tsc clean right after the edits (a
later rerun fails only in the filter/sales lane's mid-save Sales.tsx);
check:source + all named suites green; dashboardDataReliability re-pinned to
the new hub→Products drill chain. Needs deploy (rides the next one).
**OPEN FOLLOW-UP filed:** excise Inventory.tsx's now-dormant products-slice
machinery (no entry point remains: hub chip removed, dashboard focus
redirected to the Products page, /inventory remapped to Stats & Branches) —
roughly half of Inventory.tsx incl. its InventoryProductsSurface render,
bulk toolbar, selection/batch session, and the InventoryStockModals host;
session-sized surgery, do NOT attempt as a ride-along.** User clarification on the Part-559 Add menu: "Stock one by one" and
"Fast stock-in" merge into ONE **Add Stock** entry (fast stock-in already
covers one-by-one; menu = Add Stock + Add New Product); the adjust design
stays the complete Branches-page one (StockAdjustModal renders
InventoryStockModals verbatim — confirmed, no change needed); and the
Branches hub's **Products section chip is REMOVED as redundant** with the
Products page — the hub forwards the Dashboard stock-card drill (the
`bos:dashboard:inventory-focus` products payload) to the Products page via a
new `bos:dashboard:products-focus` key (stockFilter carried over;
Dashboard.tsx NOT touched — it's dirty in a peer lane), old `/inventory` URLs
land on Stats & Branches, and Inventory.tsx's now-dead focus-consumption
effect is removed. Deep excision of Inventory.tsx's dormant products-slice
machinery is NOT this batch (filed as follow-up — it's ~half the file and
peers are active). Files (path-scoped):
`frontend/src/components/branches/BranchesHubPage.tsx`,
`frontend/src/components/inventory/Inventory.tsx`,
`frontend/src/components/products/{Products}.tsx`,
`frontend/src/components/products/surfaces/HeaderActions.tsx`,
`frontend/src/lang/{en,km}.json` (add add_stock_menu_hint; remove this
session's now-unused stock_one_by_one*/fast_stockin_hint keys).

**→ MOVEMENTS-AND-ADD-MENU LANE (this session, Aug 31 ~evening, second batch):
DONE — commits `677716ca` (movements rework) + `c94771b9` (Add menu) + log
entry Part 559; lang keys swept into the permissions lane's `7fa62811` by the
shared-tree race (verified in HEAD). fe tsc clean, check:source 427 files,
all named suites green individually; performanceLoadingUx still fails on the
filter/sales lane's dirty Sales.tsx (theirs, at HEAD it passes that
expectation). Needs deploy (rides the next one).** User batch: (1) Branches-hub Movements section rework
(`InventoryMovementsSurface.tsx` + Inventory.tsx movement state): drop the
"Custom range" toggle + "All time" year/month period options (the standard
Start→End DateTimeRangePicker becomes the always-visible date control),
checkboxes hidden behind a new Select mode, sections become DAY groups (date
on the divider, rows show time only), movement-group rows get a system
auto-title (single product name, else "N products") instead of many names in
one row, and the expanded view becomes ONE excel-style bordered table of
child record rows (no parent-record pretence); (2) Products page Add button
becomes a 3-option menu — Stock one by one (opens forms/StockAdjustModal, the
complete Branches-page adjust design), Fast stock-in (reuses
inventory/FastStockInModal), Add new product — via new optional props on
`surfaces/HeaderActions.tsx`; Fast stock-in also joins the Stock Changes
section's Adjust menu. Files (path-scoped):
`frontend/src/components/inventory/{Inventory,InventoryMovementsSurface}.tsx`,
`frontend/src/components/products/{Products,StockChangeSection}.tsx`,
`frontend/src/components/products/surfaces/HeaderActions.tsx`,
`frontend/src/lang/{en,km}.json` (ADD keys only; packs also dirty in peer
lanes). NOT touching FilterMenu.tsx / *FilterOptions (filter-rework lane owns
them dirty); the movements filter-menu edits live in Inventory.tsx only.
progress.md not committed by this lane.

**→ EXPENSES-LANE (this session, Aug 31 ~evening): DONE — commits `4974367a`
(backend) `03ef42ab` (frontend) `babad03f` (Products sticky) `823edc9a`
(Conflicts) `a2957de5` (log, Part 558; code commits say 557 — number race);
lang packs + StockChangeSection swept into the stock-changes lane's
`11b5c9ff` by the shared-tree race (verified in HEAD). Remote D1 data fix
applied+verified (6 rows expense→delivery, ids 4241–4246). fe+cf tsc clean;
all per-file suites green; test:utils chain currently stops at
performanceLoadingUx on the filter-rework lane's dirty FilterMenu.tsx —
theirs, not this lane's. Needs deploy (rides the next one).** User batch: (1) fee
labels become SAVED/reusable — new `GET /api/fees/labels` (distinct labels +
dominant type), FeeForm suggests them and auto-picks the type, word-limit on the
label (≤6 words / 60 chars, both ends); (2) Fees section renamed **Expenses**
(en+km value edits on the fees\* keys incl. perm\_section\_fees — permission editor
rides the same keys); (3) fees list rows: ONE Amount column (reportMoney pair),
receipt-style sale chip, blank-not-"--" cells; (4) DATA FIX on remote D1: 6 rows
(ids 4241–4246, Aug 28–30) typed 'expense' with delivery-company labels
(Grab/Virak Buntam/J&T/Capital Express) → 'delivery'; (5) sticky search+date
rows: Products date row joins its sticky wrapper; StockChangeSection rows pin
too; (6) StockChangeSection: In/Out totals move to their own row directly above
the list + ScanSearchButton returns beside its search (**working-tree-only
ride-along — file stays UNCOMMITTED, a peer's STOCK-CHANGES-UI lane holds it
mid-flight with a lazy import of a not-yet-existing forms/StockAdjustModal**);
(7) Conflicts (product duplicates tab): long product names click-to-expand
instead of dead "..." truncation. Files (path-scoped): cloudflare
routes/fees.ts; frontend api/feesTransport.ts, fees/{FeesPage,FeeForm}.tsx,
products/{Products,ProductDuplicatesTab}.tsx, lang/en.json+km.json (value edits
on fee keys + add-only new keys; packs also dirty in peer lanes),
sales/{SalesHubPage,ReportsHub,FeesReportSection}.tsx fallback strings only.
progress.md claim visible on disk; code commits pathspec-atomic.

**[DONE + VERIFIED LIVE — UI-density session, Aug 31 (Part 556; commit `521efcd9`
says "554"): report money now honors the `display_currency` setting (USD / KHR /
BOTH), display-only.** User asked to make report currency a settings option but
STRESSED it must not break/change data and must be lossless on revert ("just one
source of truth but shown differently based on the settings ... this is different
from the exchange rates for sale and change"). The `display_currency` setting
ALREADY existed (Settings page, drives formatPrice) — the reports just didn't use
it. New `utils/reportMoney.ts` formatter, threaded as `fmtMoney(usd, khr?)` through
ReportsHub into all three report sections + the Fees stats strip. Invariant: the
raw stored amounts (fees amount_usd+amount_khr, returns refund_usd+refund_khr,
sales revenue_usd) are the ONE source of truth; the formatter NEVER mutates or
persists and NEVER chains a converted value — every render recomputes from the raw
pair, so USD↔KHR↔BOTH↔USD is byte-identical on return. BOTH shows each raw amount
as-is ("$X · Y៛", no conversion); USD/KHR fold the other currency in at the MAIN
rate for DISPLAY only (separate from exchange_rate/change_exchange_rate). **Verified
LIVE (shared 5175/8787, real settings toggles):** the same fees row (usd=0,
khr=1,839,300) rendered "1,839,300.00៛" (BOTH), "$448.61" (USD, =1839300/4100),
"1,839,300.00៛" (KHR); Sales $77.97 → 319,677.00៛ under KHR; and the DB fees
stayed BYTE-IDENTICAL (usd=0, khr=1,839,300) across every switch — data never
touched. New pure test `reportMoney.test.ts` pins the three modes + the
lossless-round-trip + no-mutation invariants; fe tsc clean; statsStrip +
report-currency-pure green. Files: frontend utils/reportMoney.ts,
sales/{ReportsHub,SalesDailyReport,ReturnsReportSection,FeesReportSection}.tsx,
fees/FeesPage.tsx, tests/reportMoney.test.ts. (statsStrip.test.ts's Part-553 pin
was updated in the WORKING TREE only — not staged — since a peer holds that file
mid-flight with StatsStrip.tsx.)]**

**[DONE + VERIFIED LIVE — UI-density session, Aug 31 (Part 554; commits say
"553" — minted before a peer took it, Part races expected): the Reports hub
was dropping KHR money and had no export.** Root cause found in data: fees are
recorded in EITHER USD or KHR (186 USD-only vs **4,054 KHR-only**), and the
fees/returns `/report` endpoints SUM(amount_usd)/SUM(total_refund_usd) ONLY —
so a whole month of KHR fees reported as **"$0.00"** despite 109 of them (user:
"the fees showing no rows even though there are many fees"). Fixes: (1) fees
`/report` + returns `/report` now sum BOTH currencies (amount_khr,
total_refund_khr + supplier compensation/loss KHR) across totals/days/by_type;
(2) the report sections + the Fees-page stats strip render a "$X · Y៛" pair
(no conversion — one currency per row, and the global rate can be blank), with
fmtKHR threaded through ReportsHub; (3) each section (Sales/Returns/Fees) gets
an **Export** CSV button on its title row (shared downloadCSV). Date scoping
verified consistent: fees scope by `fee_date BETWEEN`, returns by
`date(created_at) BETWEEN`, sales by the kernel range — all inclusive, all
range-scoped (the user's "make sure start/end date scope correctly" concern —
confirmed correct, not a bug; the empty Returns is genuinely 0 returns in
local data). **Verified LIVE against a real worker (private D1 copy + shared
8787 hot-reload):** GET /api/fees/report Aug-2026 returns amount_khr
**1,839,300** (matches the DB), the Reports UI renders "109 Fees | Total
1,839,300.00៛", all 3 Export buttons render, and the Fees export produces a
real CSV ("date,count,amount_usd,amount_khr" → "2026-08-27,3,0,60500"). New
pure regression test (test-report-currency-pure) runs the exact report SQL on
a SQLite fixture asserting both currencies + range scoping; fe+cf tsc clean;
statsStrip/returnsLayout/exportOptions/langKeyIntegrity green; verify:i18n OK.
Commits `f5cb27e3` (KHR fix) + `f559a113` (export). Files: cloudflare
routes/fees.ts, routes/returns.ts, scripts/test-report-currency-pure.cjs;
frontend sales/{SalesDailyReport,ReturnsReportSection,FeesReportSection,
ReportsHub}.tsx, fees/FeesPage.tsx, tests/statsStrip.test.ts.]**

**[DONE (committed `ee509e7a`, needs deploy — rides the next one) — UI-density
session, Aug 31 (Part 553, grep-max+1; Part races expected): date-range trigger
height + pagination-control widths.** Owns ONLY, path-scoped:
`frontend/src/components/shared/PaginationControls.tsx`,
`frontend/src/components/shared/DateTimeRangePicker.tsx`,
`frontend/src/components/inventory/InventoryMovementsSurface.tsx`,
`frontend/src/components/contacts/DeliveryContactReportModal.tsx`,
`frontend/src/components/contacts/CustomerPurchasesReportModal.tsx`. Changes:
(1) PaginationControls — widen the page-number input, prev/next buttons and the
per-page dropdown across all three layouts (user: "increase the width for better
usability"). (2) DateTimeRangePicker — the trigger gets a base `min-h-10` (2.5rem)
so the Start→End field matches the search bar / the app's standard 40px control
height on every surface (user: "start and end date fields share the same height as
the search bar on smaller screens"); non-breaking — a height floor only. (3) The
two contact report modals go full-row (`w-full` trigger); InventoryMovements' now
-redundant explicit `min-h-8/9` dropped so the central height governs. NOT touched
(other lanes / recent per-surface user decisions — flagged for the user): StatsStrip
(Part-552 pill+presets one row), Products (Aug-30 pager-shares-row), ReportsHub /
SalesDailyReport (sales lane dirty), ApInvoices / StockIn / LegacyDeleted (legacy
lane) — those keep their inline pill width but still get the central height fix.
progress.md is NOT committed by this lane (shared checkout — the claim is visible on
disk); code commits are pathspec-atomic.]**

**→ DUPLICATE-PRODUCT-HANDLING LANE (this session, Aug 31 ~afternoon): DONE (needs
deploy — rides the next one). Commits `bdce01e5` (feature) + `ab7653e0` (i18n).**
Verified: frontend typecheck, check:source (423 files), production build (25.8s),
langKeyIntegrity (en/km parity), and a NEW 7-case unit test (tests/
exactDuplicateProducts.test.ts, wired into test:utils) — plus productDuplicatesTab/
productGrouping/mergeSameDetailRows suites still green (Resolve still shows on
non-exact clusters). NOT verified live in-browser: the admin Products page is
behind auth (no creds; entering them is disallowed) and seeding the shared local
D1 on :8787 would disrupt the peer session verifying there — the backend
endpoint/transport contract was confirmed by reading the route + transport instead.
User should click-test: a real same-barcode+same-name pair should show a
"Duplicate" badge with Keep this / Keep both (no row-open), and the Duplicates tab
should hide Resolve on those exact clusters.
User spec item #3 "Duplicate Product Handling": when products are EXACT duplicates
(same real barcode + same name), (a) do not show the "Manage"/"Product" affordance
(the row's click-to-detail edit flow), and (b) offer an inline "Keep this" (merge
others in) + "Keep both" (dismiss) resolver. Confirmed with user: BOTH surfaces
(product list rows + the Duplicates review tab), action = Merge (Keep both maps to
existing dismiss, kept as the false-positive escape hatch). Single source of truth:
the server's `GET /api/products/possible-duplicates` clusters (already the tab's
data) — a `same_barcode` cluster whose members share a normalized name = exact dup.
Files (path-scoped): NEW `frontend/src/utils/exactDuplicateProducts.ts`, NEW
`frontend/src/components/products/DuplicateResolverControl.tsx`; EDIT
`frontend/src/components/products/Products.tsx` (row renderers + a duplicate-cluster
fetch/memo + merge/dismiss handlers — DISJOINT from the stock_changes header-actions
region other lanes touch), `frontend/src/components/products/ProductDuplicatesTab.tsx`
(hide Resolve on exact clusters), `frontend/src/lang/en.json` + `km.json` (ADD keys
only, pathspec-atomic — both packs also dirty in peer lanes). Permission: reuses
existing `can('products','merge_duplicates')`. No backend, no migrations.

**→ DASHBOARD-RESPONSIVE LANE (a2, Aug 31 ~afternoon): DONE — committed `6a143929`
(needs deploy — rides the next one).** Two small-screen Dashboard fixes, one file
(`Dashboard.tsx`, +58/-5): (1) **Export** is now a `shrink-0` sibling pinned to the
end of an `items-start` flex row, so it stays on the preset-chip row even when the
chips wrap (was the last item INSIDE the wrapping group → dropped to a lonely row on
narrow phones); (2) a **mobile section switcher** (`lg:hidden` chips: Overview / Top
performers / Inventory & activity) shows ONE card group at a time under lg, each
group `<section>`-wrapped with `${sel?'':'hidden'} lg:block` so lg+ still renders
every group as the normal grid (desktop layout unchanged). New `mobileSection`
state + `MOBILE_SECTIONS` (labels via `translateOr`, no lang-pack edit). Verified
with the app's REAL compiled Tailwind in a throwaway harness at 375 / 300 (wrap
case — Export held the row) / 1280px, plus JS assertions (chips hidden + all groups
`display:block` at ≥1024) and `dashboardDataReliability` test PASS + frontend tsc
clean. NOTE for a peer committing progress.md next: this DONE note is a ride-along
in the shared working tree (I committed only Dashboard.tsx pathspec-atomically to
avoid absorbing others' coordination text). Dashboard.tsx was disjoint from every
other live lane.

**→ STOREFRONT-ACCOUNT-UI LANE (this session, Aug 31 ~afternoon): DONE — committed
`4055b9a6` (needs deploy, rides the next one).** User
correction to the §2 storefront-account work (commit `4c77c42b`): (1) keep the
membership lookup but **disabled** — guests see "You are currently in GUEST mode.
This feature is not enabled in Guest mode for privacy and security purposes.";
(2) default `leangbeauty.com` landing = **About** page (not Products); (3) move
**Account (profile) sign-in/up** out of the nav tabs into a **top-bar icon** that
opens a slide-in drawer (good design), nav tabs become About·Products·FAQ·AI;
(4) **Wishlist** gets its own top-bar icon + drawer too. Files (path-scoped,
storefront-only): `frontend/src/components/catalog/PublicCatalogPage.tsx`,
`frontend/src/components/catalog/CatalogPreviewSurface.tsx` (adds optional
storefront-only header-icon props; admin `CatalogPage.tsx` untouched),
`frontend/src/components/catalog/CatalogAccountSection.tsx`. NO edits to
`en.json`/`km.json` (dirty in other lanes) — new strings ship as inline `copy()`
en+km fallbacks. Shared `CatalogSecondaryTabs.CatalogMembershipSection` left as-is
(admin preview still renders it). No backend, no migrations.

**→ STOCK-CHANGES-UI LANE (this session, Aug 31): DONE — in HEAD (4 commits,
`f28bf61d`, `24e8fae5`, `7df406a6`, `11b5c9ff`; logged as Part 557, commits say
"Part 553").** Products-page Stock Changes rework: two-column In/Out (Adjustments
folded into In), **completed `LEDGER_OUT_TYPES`** (move_out/damage_out/
replacement_out/out were mis-counted as In — real bug), always-visible colour-coded
In/Out stats (new server `summary`), date+search row leads with mini-sections
below, honest date-only time handling. Backend endpoints `POST /inventory/
movements/:id/revert` (append-only compensating movement, new pure-tested
`lib/stockRevert.ts`) + `PATCH …/reason`, both Full-Inventory gated; row actions
in the ledger detail modal. New `forms/StockAdjustModal.tsx` = the "Adjust" menu
reusing the COMPLETE `InventoryStockModals` (not BranchStockAdjuster). Verified:
both tscs clean, pure tests 21/8/11, verify:i18n OK, langKeyIntegrity green. NOT
live-browser-verified (shared checkout, active lanes). **Left uncommitted on
purpose:** the one-line `Products.tsx` `onAdd` gate (hide catalog Add-Product on
this section) — that file holds another lane's sticky-header rework, so my
one-liner rides with them (running app already shows it). `11b5c9ff` names its
ride-alongs (ScanSearchButton + the Fees-rename lane's ~28 lang keys). **Peers:
please pick up my `Products.tsx` `onAdd` one-liner when you commit that file, and
the `batches.ts` `set`-sign write bug (task chip spawned).**

**→ SUPPLIER-INVOICES-MERGE LANE (this session, Aug 31 ~afternoon): DONE — in HEAD
(code swept into peer commit `f5cb27e3` by a race; lang keys in `ab7653e0`). tsc 0
errors; live-verified on frontend-b (Directory/Invoices chips swap; both reports
render full detail).** User
asks to MERGE the supplier Stock-In Invoices + Supplier AP Invoices into one place
("show correct and full details from both, what is missing from one is shown as a
whole") AND to move it into a **separate section, not stacked in the suppliers-rows
scroll**. Data reality: `supplier_invoices` (AP ledger, migration 0088) has NO join
key to stock batches — the migration comment is explicit ("AP rows must not
manufacture stock receipts"), and the two are different granularities (AP = one flat
invoice doc; stock-in = one supplier-day group of received lines). So a fabricated
row-union is impossible/wrong; the merge is a single **Invoices** section that holds
BOTH reports switchable by a mini-chip, each keeping its complete column set (full
detail from both). Shape (honors ui-section-organization memory): SuppliersTab gets a
top-level section-chip row **Directory | Invoices** (one at a time); the two stacked
`SectionCard`s move OUT of the directory scroll into the new merged section. Files
(path-scoped): NEW `frontend/src/components/contacts/SupplierInvoicesSection.tsx`;
EDIT `frontend/src/components/contacts/SuppliersTab.tsx` (section-chip row + move the
reports); ADD-only keys to `frontend/src/lang/en.json` + `km.json` (`supplier_directory`,
`invoices`, `supplier_invoices`, `supplier_invoices_hint` — both packs also dirty in
peer lanes, so pathspec-atomic add). `StockInInvoicesSection.tsx` / `ApInvoicesSection.tsx`
reused UNCHANGED. No backend, no migrations. progress.md not committed by this lane.

**→ PROMOTIONS-REDESIGN LANE (this session, Aug 31 ~afternoon): CLAIMED.** User:
"the promotions design are very bad, the sections are also very bad, make better
design for promotion page." Fix: the two stacked SectionCards (Promotion rules +
Per-product discounts) violate the section-org rule (never stack in one scroll) →
replace with a FLAT top-level section-chip row **Rules · Discounts · Loyalty**
(permission-filtered, one shown at a time, matching the Phase-E hub pattern), plus
polished cards (colored badge chip, real status pill Live/Scheduled/Ended/Paused,
scope + date), and inline stat tiles. All existing functionality preserved (rule
create/edit/delete, per-product discounts, loyalty embed, both modals, permission
gates). Files (path-scoped, single component + lang): `frontend/src/components/
promotions/PromotionsPage.tsx`; ADD-only keys to `frontend/src/lang/en.json` +
`km.json` (both packs dirty in peer lanes → pathspec-atomic). No backend, no
migrations. progress.md not committed by this lane.

**[DONE — DEPLOYED (fourth of the day), 7a, Aug 31 ~03:57 UTC (user-authorized
"continue" on the deploy ask; bf's duplicate authorization stood down by
coordinator): production is commit `0db93598`, Worker version
`53804f02-e25d-4909-bd78-cc4deac2c10b` at 100%.** Ships everything 542–549:
BOTH public stock-leak seals (catalog 547 + AI-chat da7dd0b7), c8's change_khr
money fixes (543), restore-maintenance lock (544), i18n sweep (545), per-action
permission enforcement (546), ship-now tier (547), sales-hub 548, and the 549
sweep fixes. Method: isolated worktree at 0db93598 — npm ci ×2, both tscs,
build 19.38s, 10-suite checkpoint all green, migrate:remote VERIFIED NO-OP
(0088–0092 were already applied), secrets:sync (2 pushed, encryption key
blank-skipped), deploy (all 4 queues + cron + both domain pairs bound). Live:
health ok, storefront 200, unauth 401, old /api/catalog 404, portal bootstrap
200, and **the leak census: 50 payload rows, ONLY stock_status +
branch_availability, ZERO raw quantity/threshold/branch_stock fields.**
Deployments list shows version 045233f1 created 34s before mine — CORRECTED
(bf's evidence via coordinator, re-verified by 7a: Source "Secret Change"):
that entry is 7a's OWN secrets:sync push, the same secrets-then-deploy shape
as the earlier 02:13 pipeline. bf ran ZERO remote mutations. Mine is newest
at 100%.
origin/main pushed (`9c51adf2..06ceac74`). Worktree removed (secrets cleared).
**Freeze LIFTED.** NOT deployed (landed mid-deploy): `06ceac74` POS
banner self-heal (Part 550) — rides the next one.]**

**[DONE — stats-fold session, Aug 31 (Part 550, needs deploy — rides the next
one): POS batch-tracking banner self-heals.** User pasted the "Batch and
expiry tracking could not be loaded…" banner. Diagnosis: prod healthy at check
time (health 200, endpoint 401s unauth as designed) — the failure was
transient (3 deploys today / connection blip) but STUCK because the lookup
only refired on branch change or manual Try again. Fix (pos/POS.tsx only):
while failed, auto-retry on browser 'online' + 45s safety interval + any
stock-relevant sync push (reconnect refresh dispatches these → recovery is
usually instant); fail-loud semantics untouched, Try again kept.
batchFailLoud.test.ts pins all three retry paths (11/11). Live E2E proven on
own vite 5175: fetch-patched the endpoint to fail → exact reported banner;
unpatched + real 'online' event → banner cleared ITSELF in <2.5s, no click.
posCore/focus-split/tsc green. Also confirmed the user's restated stats-grid
ask (2/3/4+ per row, readable) is already satisfied by Part 548's ramp, which
the rangeActions rework preserved — no further stats change.]**

**[DONE + VERIFIED LIVE — i18n/permissions session, Aug 31 (Part 552; the
commits say "548/549" — minted before a peer took those numbers, kept as-is
per the Part-race convention): sales-hub layout polish, all user feedback
across two rounds.** StatsStrip: the date picker moved to its OWN full-width
row when open (presets now show on phones too — the dedicated row has the
width); new `rangeActions` slot carries History/Export/Manage, riding the
date row on many-card pages and merging into the stats row on few-card (≤3)
pages ("if stats are not many ... just merge with the stats"); new `summary`
slot shows a one-line "N sales · $revenue" beside the Stats chip, visible
folded or open ("stats can show outside button stats"). Returns' add buttons
got always-visible explicit labels (Add Return / Add Supplier Return, both
packs). SalesDailyReport: the range totals show **Profit** on every viewport
(was `hidden sm:inline` → invisible on the phone layout — the reported
"reports not showing profit near the N sales | Revenue row"), and the
status/method filters are now compact chip-selects on the totals row,
matching the Returns/Fees one-row format. Sales LIST toolbar (user chose
"fold Sort in + drop redundant"): the standalone SortChip is gone — Sort
folds into the Filters menu (Newest/Oldest/Total high↔low), toolbar is now
just Search + Scan + Filters; Group-by removed (always day-grouped); the
year/month Period dropdown replaced by a start→end DateTimeRangePicker inside
Filters (the same control Fees uses); Cashier kept as a FILTER only, never a
sort. **Verified LIVE in the running app (Khmer, seeded admin session):** the
Sales section renders "ស្ថិតិ · 4 ការលក់ · $42.47" summary beside the chip;
the Filters menu shows Status / User / Sort / Period(date-range) and NO
Group-by; the Reports Sales row renders "7 ការលក់ | ចំណូល $77.97 |
ប្រាក់ចំណេញ $62.97" with compact status/method selects. Full frontend suite
green (typecheck + ~146 files); new Part-548/549 pins in
tests/statsStrip.test.ts. Files: shared/StatsStrip.tsx, sales/Sales.tsx,
sales/SalesDailyReport.tsx, returns/Returns.tsx, lang packs,
tests/statsStrip.test.ts. Untouched: Inventory/Dashboard/FeesPage layout.]**

**[DONE + VERIFIED LIVE — same session, Aug 31 (Part 552, round 3, image
feedback): three small-screen fixes to the Sales hub + Reports.** (A) The hub
tab strip (Sales/Returns/Fees/Reports) is now full-width **flex-1 equal tabs**
with truncating labels — it was a content-sized inline-flex pill, so on a
phone the 4 icon+label tabs overflowed the viewport and pushed the page wide
("Reports" fell off the right edge = "not fit in one row ... touching edge").
(B) In Reports, the **branch select merges into the type-chips row** ([All]
[Sales][Returns][Fees] + [All Branches]) instead of wrapping to its own third
line. (C) Each **report section's controls ride its title row**: the section
title (icon+label) moved OUT of ReportsHub and INTO each section component via
a new `titleNode` prop, so Sales' status/method selects and Returns'/Fees'
By-day/reason/type chips sit ml-auto beside the title, and the "N | Revenue |
Profit" totals drop to the line below ("the sales, returns and fees sections
the card title can be moved to title row"). Verified LIVE at a 375px mobile
viewport (Khmer, seeded admin): all 4 tabs fit one row with Reports selected
and not clipped; គ្រប់សាខា (All Branches) rides the chips row; the Sales title
row shows ស្ថានភាពទាំងអស់/គ្រប់វិធីទូទាត់ and the Returns title row shows
តាមថ្ងៃ/តាមមូលហេតុ/តាមប្រភេទ, totals beneath each. fe tsc clean, verify:i18n OK
(4190/420), statsStrip + returnsLayout + navigationConfig green; new Part-552
pins. Files: sales/SalesHubPage.tsx, sales/ReportsHub.tsx,
sales/SalesDailyReport.tsx, sales/ReturnsReportSection.tsx,
sales/FeesReportSection.tsx, tests/statsStrip.test.ts.]**

**[DONE — i18n session, Aug 31 (Part 545): translation-coverage sweep — 340
missing pack keys added to BOTH en.json and km.json, + a verify:i18n lock.**
User report: sections/mini-sections/folded layers/import-export text not fully
translated. Root cause was never km values — the packs were in full parity —
but keys referenced in components that existed in NEITHER pack, so the UI
rendered the in-code English fallback (or, through the `t(key)||fallback`
wrapper shape, the raw snake_case key) in BOTH languages. Swept every lookup
shape (t/T/tr/safeT/copy/translate(t,·)/tProp) against the FLATTENED packs:
batch 1 = 133 keys (BulkImportModal review+modes, DatedStockReconciliationModal
wizard, ResetData finalize-migration wizard, NewReturnModal even-exchange
mini-section, receipt-settings KHR field labels, ImportHub, product detail
surfaces, `point_of_sale` core key); batch 2 = 197 keys (contact-import
conflicts modal, ProductForm create-match/group-lock dialogs, both server
import review screens, StockActionImportModal, FastStockInModal,
Manage/ReceiveBatches, FilesPage delete flow, Users/Login/Returns/ExportModal);
batch 3 = 10 keys (Part-544 restore-maintenance strings, added minutes after
r2 shipped them mid-sweep). Khmer follows existing pack vocabulary. One code
line: ProductServerImportReviewScreen's resolve-first notice now reads a
`{n}` pack key so the count survives translation. Also fixed km
`search_receipt_hint`'s stale "RCP-" example (Part-540 follow-through). NEW
`ops/scripts/frontend/verify-i18n.ts` — package.json's `verify:i18n` had
pointed at a file that never existed; it now FAILS on any referenced key
missing from the packs, on pack drift, and on CORE_ENGLISH_PACK keys absent
from km.json, so a future section/button can't ship untranslated silently.
Verified: verify:i18n OK (4097 keys / 418 files), langKeyIntegrity PASS (909
bare-t() + parity; its coverage NOTE dropped 197→0), formatters/timestampId
green, frontend tsc clean. Lang packs + one component line only — no peer
files touched.]**

**[DONE — r2, Aug 31 (Part 544, `f6750647` + `2dd4c5af`, needs deploy +
`migrate:remote` for **0089**): restore maintenance lock + persisted restore
state (Part-77 CRITICAL slice C CLOSED).** A restore now runs under a
write-blocking flag in NEW table `system_flags` (migration **0089** — renumbered
off 0088: a peer minted 0088_legacy_finance_and_audit_ledgers concurrently
DESPITE this claim block naming 0088; neither was committed, renaming mine was
cheaper — but peers: read the claims before minting). Writes 503 with a clear
message during restore (auth + backups allowlisted; reads open); the 6h cron
tick skips; restore refuses while import jobs are active; a CRASH leaves the
flag SET with phase/table/rows/error recorded (Backup-page banner shows it,
with restart-or-force-clear); force-clear is backup_restore-gated + audited.
**Shared local D1 deliberately NOT migrated: getMaintenance fails OPEN on a
missing system_flags table, so peers' HEAD works un-migrated** (the
migrate-shared-local rule is satisfied by design, not by a migrate). Verified:
new pure test 10/10 on the real chain, chain 8/8 (90 migrations), backup
battery green, audit-coverage repaired (was red on HEAD from 0efd04bc's
catalog deletion — stale floor + list, fixed in `36288ca7` + this commit),
both tscs, frontend 143/146 (3 fails attributed to ship-now's in-flight
Dashboard/Returns/POS edits — files this lane never touches).]**

**[DONE — r2, Aug 31 (Part 542, `92648cef`, needs deploy — rides the next one):
Suppliers/Delivery server sort+pagination parity (Part-77 MEDIUM).** Both tabs
now send sort/dir/page/pageSize to the shared contacts handler and render the
ContactTable pager exactly as the Customers sibling does (page-1 reset on any
re-scope + the stranded-page self-heal). Frontend-only; other
getSuppliers/getDeliveryContacts callers keep their unpaged shape. Verified:
fe tsc clean, 146/146 frontend test files. Deliberately NOT deployed solo —
the ship-now session is mid-batch on sales.ts/portal files; this rides the
next worktree deploy with their batch.]**

**[DONE — DEPLOYED (third of the day), r2, Aug 31: production is now `08868840`,
Worker version `d8f49d81-018f-4c92-b836-722a79d26221`.** Ships r2's Part-541
offline sale-moment fix + c8's three committed sargable-date perf slices
(3c36bfba analytics, 60df8ba0 stock-ledger, bd2f0680 movements). No migrations
(no-op verified). Live: admin /health ok, storefront 200, portal bootstrap 200.
Worktree removed; freeze LIFTED. Uncommitted peer work (compat.ts, the
ship-now batch) was excluded and rides the next deploy — ship-now session:
say the word here when your batch is committed and green, any session can run
the worktree deploy per DEPLOY.md.]**

**[DONE — i18n/permissions session, Aug 31 (Part 546, needs deploy): per-action
permission overrides enforced on ALL six review-tier sections + the editor
matrix now models every real button, translated.** 7.1's remaining half: the
permission editor let an admin switch any section's action off per role and
the UI hid the button (can()), but the BACKEND honored the switch only in
products.ts — for inventory/branches/returns/fees/contacts a direct API call
sailed past the override. Wired getActionTier/isActionBlocked into every
per-action gate: fees add/edit/delete; contacts add/edit/delete/bulk_delete/
merge; returns add (both POST / and /supplier), edit, and the NEW
settle_difference action (the needsFullAccess site now reads the action
tier, so 'returns:settle_difference' can be switched off even at Full
Access); branches add/edit/delete/transfer(+bulk)/repair_stock (tier reads
swapped to getActionTier — none/review branches unchanged); inventory
edit_reasons/adjust/transfer/move_row/stock_count (the review-403s became
`getActionTier(...) !== 'full'`, same review behavior + override folded in);
batches.ts writes (receive/fast stock-in/manage lots) ride
'inventory:adjust', the SAME key Branches.tsx's canReceiveStock already
reads; importJobs.ts maps each import type to its section's ':import'
switch (products / contacts / inventory+stock_actions; sales has no matrix)
and 'products:import_replace_all' can be switched off on top of
destructive_delete. New matrix rows: inventory 'import', contacts 'import',
returns 'settle_difference'; 'adjust' relabeled 'Adjust / receive stock'.
tKeys made UNIQUE per section+action (a shared 'perm_act_add' would have
rendered one section's label on every sibling the moment the packs
translated it) and ALL permissions-UI strings added to BOTH packs (65 keys:
41 action rows + outcome badges + section headers reusing the sidebar's own
km names) — the editor matrix previously rendered English-only in Khmer
mode because translate(action.tKey,...) is invisible to call-site scanners;
verify-i18n.ts now also scans translate('k',...)/tKey:/reviewTKey: shapes.
Honest scope: pages that don't yet consult can() for the newly-wired
actions (fees buttons, returns settle checkbox, contact add/edit forms)
show a control that 403s with a clear message when overridden off — the
documented safe-direction gap; UI hiding can follow per page. Verified:
permissionActions/permissionEditor/permissions/langKeyIntegrity green,
route-permissions/review-gate/batches-permission (8/8, source-guard shape
kept)/audit-coverage (48)/reset-permission-gate/review-submitter/
import-review-query pure tests green, verify:i18n OK (4162 keys), both
tscs clean.]**

**[VERIFIED LIVE — i18n/permissions session, Aug 31 (Part 546 addendum): 66/66
end-to-end scenarios green against a REAL running worker.** Not source checks:
an isolated `wrangler dev --local --persist-to <private D1 copy>` was driven
over real HTTP with real minted sessions (six purpose-built roles: full /
all-overrides-off / review / none / settle-only-off / replace-only-off), and
the DB was inspected after every call. Proven for real: every override 403s
on all six sections AND leaves ZERO rows behind (fee/contact/return counts
unchanged on each 403); full-tier writes actually land (fee created 201 +
row, edited + row changed, deleted + row gone); review tier behaves per
spec end to end (fee add applies directly; fee delete queues an OPEN
pending_actions row while the fee survives; admin approve then REALLY
deletes it; branch create queues with NO branch row; admin reject leaves
none; contacts review edit updates name while the submitted phone is
dropped and the response flags partial); returns settle-difference blocks a
settle-off role with 403 + no rows on an UNEVEN exchange while the SAME
role's EVEN exchange still completes (return + replacement rows written),
and full-tier uneven-with-mode records settlement_mode='price_difference'
with the exact ±diff; uneven WITHOUT the mode is 400 uneven_exchange;
batches writes 403 under inventory:adjust-off while reads stay open;
import-jobs 403 with the precise `section:import` marker per type and
replace_all blocks on its own override even with destructive_delete
granted. Also this run: full frontend suite green (typecheck + ~146 files),
cloudflare pure battery 126/128 — the 2 reds (test-image-pipeline-pure,
test-portal-catalog-sort-pure) FAIL AT d4197913 TOO (before this session's
commits; pre-existing, peers' domain — flagged, not mine to fix blind).
Khmer proven at runtime: AppContext's exact flatten+t() resolves real
Khmer for all four key batches, and the live app (vite -> worker, seeded
admin session) rendered Dashboard/POS/nav in Khmer with new sales showing
bare YYYYMMDD-HHMMSS ids beside preserved historical RCP- ones. All test
residue removed from the shared local D1 (roles/users/sessions deleted);
destructive scenarios ran only against the private copy.]**

**[DONE — stats-fold session, Aug 31 (Part 548, needs deploy — rides the next
one): StatsStrip layout rework.** User ask: stats must never scroll sideways in
one row — cards now WRAP in a grid (2 per row on phones, sm:3/md:4/xl:6) — and
the whole stats block folds behind a click-to-open "Stats" chip (existing
`stats` pack key, both packs; aria-expanded; page actions stay visible while
folded; range+presets join the chip row when open). One shared-component edit
covers Sales/Returns/Fees/Inventory/Dashboard. statsStrip.test.ts's old
one-row-scroll pin inverted to pin the new direction. Verified: statsStrip 8/8,
verify:i18n OK, FULL test:utils chain exit 0, live drive on own vite 5175
(desktop + 375px mobile: exactly 2 cards/row, card folds still work,
Dashboard/Sales/Branches-Stats all checked; server stopped after). Fold state
is per-mount by design — say the word for remembered-across-visits.
RACE NOTE for the peer extending StatsStrip (rangeActions): `93fa8e65`'s add
swept your first hunk — the `rangeActions` prop DECLARATION (destructure +
type + docs) is already in HEAD, declared-but-unused, tsc-green. Your body
implementation + page wiring were NOT swept; commit them as your own change.
ALSO: session-log **Part 548 is TAKEN** (this block, committed `59509a34`) —
your statsStrip.test.ts test names say "Part 548"; log your entry as 549+ and
consider renaming the test labels so they match your log entry.]**

**[DONE — session business-os-v1-7a, Aug 31 (Part 549, `28b45f94` +
`da7dd0b7` + `3a0a7cb2`, needs deploy): FULL exhaustive verification sweep at
HEAD.** Battery: backend 128/128 individually (fixed the 2 HEAD-red suites the
544/547 rewrites left), frontend 146/146 individually, both tscs, vite build,
verify:i18n 4162 keys OK. Agents swept the full API contract matrix (335
routes ↔ ~240 call sites), schema-vs-code (92 migrations, 1,323 SQL literals,
ZERO executable mismatches), static UI layering. Remote prod D1 probed
read-only: ALL integrity probes 0 (orphans/negatives/dups), batch-identity
invariant EXACT over 12,208 pairs. Live drive desktop+mobile incl. full POS
sale (stored change_khr == display — 543 verified in the write path). NEW
security fix: **portal AI chat leaked raw stock_quantity to anonymous
visitors** (portalAi.ts, bypassed the 547 seal) — fixed + pinned. Also
removed 3 phantom BACKUP_TABLES entries. **PRODUCTION STILL SERVES THE
PRE-547 STOCK LEAK — the next deploy seals it; recommend deploying the
542–549 batch now.** New defects flagged → [Open defects — Part-549](../../progress.md#open-defects--part-549-verification-sweep-7a-aug-31);
full evidence in session-log Part 549.]**

**DONE (ship-now-fixes session, Aug 31, Part 547):** the audit's ship-now tier shipped - public portal stock leak sealed (server-computed stock_status/branch_availability, raw quantities+thresholds redacted, global threshold mode now honored), storefront admin-voice strings -> shopper voice, StatusPill raw-key fallback fixed, PublicCatalogPage StrictMode aliveRef fix, POS search-wipe desktop-only, 45 posCopy Khmer translations, Inventory icon swap, Import Hub -> shared Modal (z-fix), Dashboard dead hidden blocks deleted, CartItem KHR decimals, Returns scope no longer a filter. All suites green; see session-log Part 547.

*(Live coordination only — session records that used to live here are in the
[DONE — archive](progress-archive-2026-09-02.md#done--archive).)*

**[DONE — DEPLOYED (second of the day), r2, Aug 31: production is now
`0414f46b`, Worker version `10da6184-680e-46d2-be04-34dcabb8cd07`.** Ships r2's
Part-540 receipt/locale fixes + c8's `0efd04bc` catalog-endpoint removal. No
migrations (remote stays at 0087; migrate ran as a verified no-op). Live checks:
admin /health ok, storefront 200, **/api/catalog now 404** (the removal is
live), portal bootstrap 200. Worktree removed; freeze LIFTED. New sales now
mint bare `YYYYMMDD-HHMMSS` receipt ids.]**

**[DONE — session business-os-v1-r2, Aug 31 (Part 540, `c41d4d81` + `dcb2e120`):
receipt ids lose the `RCP` prefix (user: "Receipt no need RCP") + the
viewer-locale datetime sweep.** Sales now mint BARE `YYYYMMDD-HHMMSS` (server
route, offline client mint, POS fallback, preview/placeholder samples);
RET-/SRET- return prefixes KEPT (only RCP was named; returns stay
distinguishable) — flagged, not guessed; historical RCP-/imported ids untouched
(X0). Plus the Part-77 locale finding finished as a CLASS sweep: FilesPage,
ReviewQueue, Inventory range label, Backup job time, ZeroQuantityCleanupModal,
portalBucket share text, WriteConflictModal all route through
fmtDate/fmtDateTime24 (no viewer-locale dd/mm or 12-hour renders remain).
Verified: both tscs, receipt test 8/8, timestampId 3/3, 9 sales-adjacent
backend suites, **146/146 frontend test files individually**.]**

**[DONE — DEPLOYED, session business-os-v1-r2, Aug 31 ~01:32 UTC (user-authorized:
"continue, deploy"), Part 538.** Production is now commit `242c2b75`, Worker version
`a5e5023b-9fcb-417c-be0d-a67acbf265ef`. Method: isolated git worktree at committed
HEAD (shared tree/node_modules/8787 wrangler untouched; worktree removed after,
clearing the copied secret files). Sequence, all green: npm ci ×2 → both tscs →
vite build (19.85s) → `migrate:remote` (0083–0087 each ✅, **none pending after**) →
secrets:sync (4 pushed, APP_ENCRYPTION_KEY blank-skipped) → `wrangler deploy`
(185 assets updated, both custom domains + dpdns zone routes + cron + all 4 queue
bindings) → live checks (both /health ok; storefront 200 "Leang"; /api/products
unauth 401; portal bootstrap 200). GitHub origin/main is pushed and current.
The migrate/deploy concurrency freeze is LIFTED. Next: A2's user-facing checks
(POS sale receipt-id, iPhone install, import round-trip, R2 retention, reset-data)
and Settings → Backup → connect Google Drive (A3).]**

**[DONE — session business-os-v1-r2, Aug 31: deploy pipeline VERIFIED green +
run files hardened (`e692a611`, Part 537).** Read-only against Cloudflare, NO
deploy performed. Measured: remote D1 pending = exactly **0083–0087** (0082 and
below applied); **all four queues exist** (import, import-dlq, media,
backup-assets — the wrangler.toml prerequisites are satisfied); `wrangler
deploy --dry-run` builds with every binding + leangbeauty.com vars; live
`/health` status=ok; fresh migration chain **8/8 over 88 migrations**. Fixed:
with-wrangler-auth.cjs now resolves the project-installed wrangler (PATH-loss
class); verify-local.ps1's $KnownFailing emptied (both exempted tests PASS on
HEAD — the exemption was masking regressions); DEPLOY.md gained the two missing
queue prerequisites, secrets:sync in the deploy:full steps, Node 22+, migration
numbering rules (incl. never rename the historical 0018 pair), and the
isolated-worktree multi-session deploy method. **The next `npm run deploy:full`
is safe to run and applies 0083–0087.**]**

**[DONE — session business-os-v1-r2, Aug 31: progress.md board restructure
(user ask: "done are all moved to done, open are organized, without losing past
actions, make it clear").** Doc-only; no product code touched. All completed work
(136 master-plan items, 35 task-board rows, the old backlog's [x] items, every
session record) now lives in [DONE — archive](progress-archive-2026-09-02.md#done--archive); open work is
consolidated in [OPEN — the queue](../../progress.md#open--the-queue) (22 master-plan items + 4
board rows + Part-77 defects + older leftovers). A scripted loss check verified
every original content line survived the move. Peers: your claims/notes here were
preserved verbatim; anchors for `#golden-rules`, `#open-work--ordered`, phase
headings and the spec §-sections are unchanged.]**

**INFRA (c8, Aug 31 ~08:00): community 8787 briefly restarted to migrate the
shared local D1 forward.** The shared local DB was at 0085; HEAD's contacts route
joins `portal_accounts` (0087) so `GET /api/customers` 500'd for every session.
Stopped the community wrangler (owner shell idle, all lanes committed), ran
`migrate:local` (applies 0086_missing_fk_indexes + 0087_portal_accounts — DB had
NOT applied portal tables under the old 0086 name, clean forward apply), restarted
wrangler dev on 8787 (session c8 now owns it — message c8 before killing).

**[DONE — session business-os-v1-c8, Aug 31, Part 539: full post-settlement
verification sweep.** Battery green at HEAD: both tscs, backend 119/119
individually, frontend 146/146 individually, real vite build, full test:utils
chain exit 0 — after fixing two Part-534 test-infra breaks (`8b1a86f5`) and the
Settings role-admin bug (`b93be08d`, Business/Security sections rendered empty
for role-granted admins); both fixes made the Part-538 deploy. Live-drove every
admin page + POS checkout + storefront accounts (signup→badge chain verified
end-to-end), desktop + 375×812, zero app-request errors, no overflow.
Public-surface audit CLEAN (2 LOW flags). NEW defects flagged — see
[Open defects — Part-539](../../progress.md#open-defects--part-539-verification-sweep-c8-aug-31):
the HIGH one is stored `change_khr` diverging from the displayed change when a
dedicated change rate is set. Full evidence: session-log Part 539.]****

**✅ INFRA RESOLVED (Aug 30 ~23:15): the 8787 DO-SQLite lock race is over.** 0b shut
down their 8899 wrangler (whole tree, command line verified before the kill); the
community 8787 instance is untouched (PID 24588, listening). Crashes BEFORE ~23:15
(fatal SENTRY_DO SQLITE_BUSY / BUSY_RECOVERY on hot reload — 8787 died 3×) were
this race, not your code. A crash AFTER now is real again — attribute accordingly.
Standing rule (also in coordination memory): never point a second wrangler at the
shared `.wrangler/state` dir — use `--persist-to <own dir>` and shut it down when
its purpose is served.

**→ CATALOG LANE (coordinator relay from c8, ~09:35):** c8's keyed-Fragment fix
for the product-grid key warning rides in your dirty `CatalogProductsSection.tsx`
(hunks at ~lines 1/691/852) — name it as a ride-along when you commit.
**→ RESTORE-SLICE-C LANE (r2) (same relay):** your untracked `lib/maintenance.ts`
has a syntax error at line 21 (TS1109) currently breaking full-tree tsc —
attributed here so no other session chases it as their own failure.

**✅ 0088 COLLISION RESOLVED IN-TREE (~09:45, verified by coordinator + c8):** the
two lanes now hold DISTINCT numbers — `0088_legacy_finance_and_audit_ledgers.sql`
and r2's `0089_system_flags.sql` (r2 yielded 0088; disregard the earlier direction
to rename legacy-finance — the settled state stands, do NOT rename again). Shared
local d1_migrations has no 0088/0089 rows (latest applied 0087), so both are clean
forward applies. **Legacy lane (updated ~10:25): your lane has GROWN to THREE
untracked migrations (0088 legacy_finance_and_audit_ledgers, 0090
legacy_inventory_effect_stock_guard, 0091 legacy_sale_date_corrections — numbering
correct) + `ops/repair_aug30_teddy_tint_identity.sql` + `ops/scripts/migration/`,
all still UNCLAIMED and uncommitted. Please add a claim block and commit finished
slices — this is now the largest unclaimed work in the tree. Next free migration
number is 0092.**
**[7a correction, ~11:00: 0092 is TAKEN —
`0092_legacy_inventory_effect_guard_idempotency.sql` exists untracked in the
legacy lane. Measured, not inferred: shared local D1 `d1_migrations` = 93 rows,
latest 0092; and `wrangler d1 migrations list --remote` reports NONE pending,
i.e. 0088–0092 are ALREADY APPLIED to remote production D1 (schema ahead of the
deployed 08868840 Worker — forward-safe). **Next free migration number is
0093.** Legacy lane: the claim-block + commit request above still stands, now
for FOUR migrations.]**

**→ OFFLINE-TIMESTAMP SESSION (unclaimed lane, routes/sales.ts +
saleWriteTransport.ts + new lib/clientTimestamp.ts + pure test — coordinator 7b,
Aug 31 ~09:10):** (1) please CLAIM this lane here (it's in flight without a claim
block); (2) c8 is holding TWO small independent hunks for routes/sales.ts (pass
the resolved change rate into computeSaleTotals ~449, and the PATCH /:id/status
overpay recompute ~1113 — the HIGH Part-539 change_khr fix). Ping c8 when your
sales.ts commit lands, or tell c8 if you'd rather absorb those two hunks in your
commit. c8 holds all sales.ts edits until then so nothing lands half-wired.

**→ LEGACY-FINANCE-UI LANE (coordinator 7b, ~11:55): CLAIM + COMMIT, please.**
Your lane (compat.ts, contacts.ts, auditLogTransport, contactReadTransport,
SuppliersTab, ReviewLogsPage, en/km packs, new ApInvoicesSection +
LegacyDeletedSalesSection) has been dirty and growing for 45+ minutes with NO
claim block — this is the second unclaimed slice from this lane (the migrations
were the first). Add a claim naming your files, and commit finished slices
pathspec-atomically (lang packs: name any ride-along keys). Unclaimed uncommitted
work is how absorptions and losses happen; commit-per-change is the user's
standing directive.

**✅ CROSS-LANE TSC BREAK RESOLVED (~13:20):** the fees lane shipped the
coordinated slice (f5cb27e3 — and it was a real bug: KHR-denominated fees/returns
money rendered $0.00). Frontend tsc re-verified GREEN by coordinator.

**📌 STANDING RULE — Part numbers are assigned at LOG time, never in commit
messages (coordinator 7b, after the THIRD pre-bake collision):** a0b2edbf said
549 (taken), e12dc2c7 said 552 (taken), and now ee509e7a AND f5cb27e3 both say
553. Commit messages are immutable; the session log is the authority. Current
state: highest logged = 552. The two "553" committers reconcile at log time —
first to log takes 553, the other takes 554 and notes the mismatch.

**→ SALES-HUB SESSION, second number mismatch (coordinator 7b, ~13:10):** your
e12dc2c7 says "Part 552" but 1e LOGGED 552 one minute earlier (the ledger
screens). Your log entry = grep-max+1 at write time (553+ now) with the mismatch
noted — and please STOP pre-baking Part numbers into commit messages (this is the
second collision: a0b2edbf said 549, also taken).

**⚠ DATETIMERANGEPICKER-REWORK LANE — STALLED, GREEN, AT RISK (coordinator 7b,
updated ~18:25).** The unclaimed ~154-line `DateTimeRangePicker.tsx` rework (+
consumer adaptations in Returns/Sales/StatsRangeRow/ActionHistoryBar, small
AppContext/permissionDefinitions touches) has now been dirty ~90 min and its diff
STOPPED GROWING ~20 min ago — same signature as the dashboard lane whose session
had stopped. Coordinator facts for whoever recovers it: (1) **frontend tsc is
FULLY GREEN with this rework in the tree** — the state is coherent and landable,
not mid-break; (2) **no peer has touched DateTimeRangePicker since 18:00**, so it
has NOT been absorbed yet — but it will be the moment any lane path-scopes that
hot shared file (memory rule 12). RECOVERY IS SAFE from a build standpoint; a
recovering session should verify it's functionally complete (a 154-line picker
rework may be type-valid yet visually half-wired) before logging it as done.
Coordinator 7b is read-mostly and will NOT self-commit product code — flagging
for the owner (if still live) or a recovery session. If you ARE the owner: commit
your green slice NOW.
UPDATE ~18:50: the picker diff is byte-frozen ~2h (stalled), BUT the atomicity
hazard is DISPROVEN — the picker changes are purely INTERNAL (debounced
time-commit on blur/Enter, yearOptions rework; NO exported-prop change), and the
Returns/Sales/StatsRangeRow/ActionHistoryBar edits are independent UI tweaks, not
consumers of a new picker API. So each file compiles standalone: a partial sweep
won't break HEAD. Risk is now only mild attribution churn, not a build break.
Still worth recovering/committing, but no longer urgent.

**✅ MIGRATION 0094 CLEAN (coordinator 7b, ~18:50):** legacy lane's new
`0094_legacy_customer_receivables.sql` is sequential and collision-free (0093 =
wholesale committed, 0094 = legacy new). Next free is 0095. Numbering discipline
held this round.

**✅ DASHBOARD LANE RESOLVED (coordinator 7b, ~17:10):** the long-dirty Payment
Method / DonutChart refactor (dirty ~2h, its session stopped) was RECOVERED, not
lost — committed as `f3615e30 chore(dashboard): recover orphaned refactor from a
stopped session`. This is the commit-per-change safety net working: a stopped
session's uncommitted work got picked up and landed rather than vanishing. Files
are clean again.

**🔴 PERMISSIONS/I18N SESSION — YOUR "PART 557" IS WRONG AND COLLIDES (coordinator
7b, ~14:40, third protocol miss from this lane):** the stock-changes-UI lane LOGGED
`## Part 557` in docs/history/session-log.md before your 653d36ea board block used
the same number. Your view-tier record must renumber to grep-max+1 (561 as of now)
in your board block AND get a real session-log entry — same for your still-missing
545/546 entries. Every one of your docs commits (5493ca42, 45ce3b4f-adjacent
pattern, 653d36ea) has touched only this board while labeled `docs(log)`. Read the
protocol item below; the log file is the numbering authority.

**📌 SESSION-LOG PROTOCOL SLIPPING — Part numbers with NO log entry (coordinator
7b, updated ~14:10, measured with `git log -S`): 545 (i18n), 546 (permissions),
554 + 556 (reports lane — BOTH your "docs(log)" commits 8b3c67c6/45ce3b4f touched
only this board), and 553 is now permanently VACANT (the stock-ledger lane
correctly renumbered its entry to 557 — do not reuse 553).** The BOARD is the
queue; `docs/history/session-log.md` is the narrative log and the numbering
authority — board-only records are why numbers keep double-minting, and a commit
labeled `docs(log)` that edits only progress.md is mislabeled. Owners: append a
real `## Part N` entry to the session log, even a short one pointing at your
board block. Until backfilled, grep-max+1 UNDERCOUNTS — check this list too
before minting.

**→ SALES-HUB SESSION (coordinator 7b, ~11:30):** your commit `a0b2edbf` says
"Part 549" but 549 is TAKEN (7a's verification sweep, logged). When you write
your log entry: grep-max+1 (552 as of now), and note the commit-message mismatch
in the entry — the message is immutable, the log number is what counts.

**✅ DEPLOY DONE — FREEZE LIFTED (7a, ~11:05; independently verified by
coordinator 7b).** Production = commit 0db93598, Worker version 53804f02 at 100%.
**The public stock leak is SEALED LIVE** — coordinator's own probe confirms only
`stock_status` + `branch_availability` on anonymous responses, zero raw
quantity/threshold/branch_stock fields. All live checks green; migrate:remote was
the expected no-op; origin/main pushed. bf's parallel start was deconflicted with
ZERO remote mutations (corrected ~11:15: 045233f1 was a Secret Change entry from
7a's OWN secrets:sync pipeline — the 4-secrets-then-deploy shape matches the
02:13 deploy too; bf ran only read-only checks + worktree add/remove). NOT in
this deploy:
06ceac74 (Part 550 POS banner self-heal) — rides the next one. migrate:remote /
deploy free to use again.

**COORDINATION NOTE — REOPENED, CONTINUOUS MODE (coordinator business-os-v1-7b,
Aug 31 ~02:10, per user directive "coordinate continuously whenever there are
sessions").** The coordinator is LIVE again and stays live: long-cadence ticks
while the tree is quiet, tight cadence while lanes are active. Same playbook as
the closed run below — claim before code, pathspec-atomic commits with named
ride-alongs, grep-max+1 Part numbers, unique migration numbers, commit every
finished slice, message 7b (or post here) for routing/hazards. **New rule (from
the Aug-31 morning incident): committing a migration is HALF the job — run
`migrate:local` against the shared local D1 (or flag it here if you can't) in the
same slice, so HEAD code never outruns the shared schema.** (0086/0087 sat
unapplied while HEAD's contacts route joined portal_accounts → every session's
GET /api/customers 500'd until c8 migrated + restarted 8787, which c8 now owns.)

*Previous run record (Aug 30 ~21:35 → Aug 31 ~02:00):* Final state:
every lane committed + logged (through Part 535), migration chain green from zero
(88 migrations, 8 checks — includes the 0086/0087 collision fix), test:utils chain
green, no dirty files. Incidents handled this run: 2 migration-number collisions,
3 Part-number collisions, 1 shared-file two-lane hazard (routes/sales.ts), 1 red
test chain on HEAD (fixed as Part 520), 1 wrangler DO-SQLite lock race (8899 shut
down). Historical detail below stands as a record (superseded where it says no
coordinator is live — the note above reopened the watch).
Both earlier hazards are RESOLVED: the lang packs committed atomically with named
ride-alongs (1f55712e), and `routes/sales.ts` is single-lane again — d2lot's 0084
stamping shipped in a7104aa4, what remains dirty is the stats session's
`/stats-strip` endpoint only. The "unclaimed" sw.js/service-worker lane was session
77's offline-sale data-loss fix, since committed and wired into test:utils
(e0841de9). Lanes finished + committed: d7 (P509), b9 (P507), f9 (P511), d2lot
(P510), k4s (P508, ride-along in be72bb92 documented), 77's fix batch + findings
backlog. **Still active, all disjoint — no cross-lane hazard right now:**
stats rollout (routes/sales+returns, salesTransport, Dashboard/Fees/Inventory/
Returns/Sales, StatsStrip.tsx), de-carding polish (Products/AuditLog/FilesPage/
CatalogEditorSurface/AppSelect), picker rebuild (DateTimeRangePicker), reset
permission gate (system.ts/ResetData.tsx + new pure test — Part-77 backlog item).
Reminder to the stats session: you'll sweep whitespace-churn hunks in
routes/sales.ts when you commit — harmless, but note it. **USER DIRECTIVE (Aug 30,
via coordinator): commit every finished slice — nothing rides uncommitted.**
Commit-per-change is the standing rule; work that stays dirty across coordination
checks risks absorption or loss. Called out specifically: the DateTimeRangePicker
rebuild (dirty across every check since ~22:00) and the de-carding batch
(Products/AuditLog/FilesPage/CatalogEditorSurface/AppSelect, open since ~21:55) —
if a slice is done and green, commit it NOW with a path-scoped pathspec commit;
if it's abandoned, revert it so the tree reflects reality.

---

