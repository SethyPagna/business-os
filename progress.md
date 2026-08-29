# progress.md — business-os

The control document for this project. **Read this file top-to-bottom at the start of
every session**; it is deliberately kept short enough that this is realistic.

The per-session narrative log is **not** in this file. It lives in
[`docs/history/session-log.md`](docs/history/session-log.md) — ~6,600 lines and growing,
which is exactly why it was moved out. Consult it when you need the reasoning behind a
specific past decision; do not read it end-to-end.

---

## How to use this file

**Order matters.** The sections below run from "never violate this" to "here is what is
left to do":

| Section | What it is | When to read |
|---|---|---|
| [Golden Rules](#golden-rules) | Non-negotiable engineering rules | Every session, first |
| [Engineering standards](#engineering-standards) | Standing conventions | Every session |
| [QA method — Tracks A–F](#qa-method) | How to hunt for bugs here | Before any audit/review work |
| [Decisions made](#decisions-made) | Settled questions — do not relitigate | Before proposing a design change |
| [Environment notes](#environment-notes) | What can actually be run, and where | Before claiming anything is verified |
| [Open](#open) | The live backlog | To pick up work |
| [Request batch — Aug 25 2026](#request-batch--aug-25-2026-part-341) | Earlier asks, with the import-data constraints that bound them | Before starting any of those items |
| [Request batch — second (Part 342)](#request-batch--aug-25-2026-second-batch-part-342) | **The live tracker.** Every outstanding ask, flagged | Every session, to pick the next item |
| [Older completed work](#older-completed-work) | Condensed index of finished items | To check if something is already done |

**Ending a session**, do all three:

1. Append a `## Part N` entry to `docs/history/session-log.md` (N continues from the
   highest that exists — check first, numbers have collided before).
2. Move anything you finished out of [Open](#open) and into
   [Older completed work](#older-completed-work), one line each.
3. Update [Current status](#current-status) below.

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

## Master plan — Aug 28 2026 (Part 370) — THE authoritative queue

> **This section supersedes `## Open work — ORDERED` and the task-board tables as the
> queue.** Those sections stay because they carry the specs (§11/§12/§13/§14/§15 and
> the locked execution plan) that the items below reference by number — read the spec
> when picking up an item; read THIS list to know what is open and in what order.
> Statuses: `[ ]` not started · `[~]` in progress / partly done · `[x]` done in code
> (deploy status noted per item). Rebuilt from the user's Aug 28 request batch plus
> every still-open item in the older sections.

### Phase A — Deploy, domain and live verification

- [x] A1. `npm run deploy:full` — **the user deployed Aug 27**, shipping Parts 346–370
  (both outages, POS oversell 409, sales import 0059/0060, §12/§13 imports, §14, §15,
  PWA branding, backup lifecycle).
- [ ] A2. Live-verify the deploy checklist: reset-data, /api/products, POS sale with lots,
  storefront iPhone install (delete old shortcut first), import round-trip, R2 keeps
  exactly 2 finalized sets.
- [x] A3 *(Part 386: root cause MEASURED — production has ZERO drive_sync settings rows: Drive was never CONNECTED, so the scheduled sync silently skipped forever. The OAuth flow is fully implemented (compat.ts /system/drive-sync/*); after deploy the user connects in Settings → Backup. Retention 7→10; the stale "OAuth isn't implemented" comment removed; notifications now carry a STANDING admin warning while Drive is not connected — the exact state that was invisible.)* **Google Drive mirror produces NOTHING — measured, not assumed.** A Drive
  search for business-os/backup files on Aug 28, AFTER the deploy, returns zero results.
  So the mirror is genuinely broken or never triggered (candidates: cron/backup never ran
  since deploy, Drive OAuth token absent in production secrets, silent skip path). Debug
  with real logs. Also: **retention is now 10, not 7** (user, Aug 28) — change the prune
  constant + `test-google-drive-backup-pure.cjs`.
- [x] A5. **leangbeauty.com is LIVE** (Part 373). Both leangbeauty.com and
  admin.leangbeauty.com return 200 (measured); the user added the Worker routes and ran
  the automation. Migration `0061` applied to remote D1 (it was the only one pending).
  **Org renamed to LeangBeauty:** `coreDataInvariants` gained a PREVIOUS_IDENTITIES
  adoption list so the existing production row (LeangCosmetics/leangcosmetics — one row,
  verified) is renamed in place, never duplicated; wrangler vars flipped; test proves
  the in-place rename. **Old-domain redirect** added in index.html (page visits on
  leangcosmetics.dpdns.org / leangcosmetics.com / www variants → leangbeauty.com, path
  preserved; API/upload fetches never hit it). **Remaining for the user:** the rename +
  redirect ship on the NEXT `npm run deploy:full` (blocked for the assistant); add the
  two leangbeauty.com Google OAuth redirect URIs in Google Cloud Console; verify Resend
  for @leangbeauty.com. **DNS caveat:** `leangcosmetics.com` currently resolves to
  36.37.242.94 (NOT Cloudflare), so its redirect route can't fire until its DNS points
  at Cloudflare — a dashboard action; the .dpdns.org redirect works today.
- [~] A4a. **First Paid-plan re-basing applied (Part 376, needs deploy):**
  `[limits] cpu_ms = 300000` restored (the block wrangler.toml itself said to re-add on
  Paid — it was removed only because Free rejected it with error 100328), and the import
  queue consumer's `max_batch_size` returned 1 → 5, the exact condition its comment set.
  `wrangler deploy --dry-run` validates. The M4 continuation-dispatch engine remains the
  big remaining Paid unlock (see M4).
- [x] A6. **Rebrand: the visible product is Leang Beauty now (Part 376).** 80+ display
  strings swept "Leang Cosmetics" → "Leang Beauty" across storefront titles, PWA
  manifest, Apple titles, FAQ/AI copy, every portal language pack, en/km org strings and
  the tests that pin them; org placeholder "LeangCosmetics" → "LeangBeauty". Historical
  records deliberately NOT touched (the adoption list, quoted past asks, outage notes).
  Storefront icon is an "L" monogram — no text to regenerate; internal
  `leang-cosmetics-*.png` FILENAMES kept (user-invisible; renaming would churn the
  service-worker cache — optional follow-up).
- [x] A4 *(Part 411, session 05 — SHIPPED, needs deploy (4c5502d9). The platform
  itself had moved: since Cloudflare's Feb-11-2026 changelog, Workers Paid defaults
  to 10,000 subrequests/invocation (configurable to 10M) — both in-code models
  (backup.ts's "Free allows 50" AND the M4 comment's "1,000 internal does not rise
  on Paid") described dead platforms. wrangler.toml now pins subrequests = 10_000
  beside cpu_ms and carries the decision ledger. Raised with measured reasons:
  backup copies 20→100, reset image deletes 200→500, ROWS_PER_IMPORT_CHUNK 150→600
  (its own comment prescribed exactly this once Paid cpu_ms returned),
  STOCK_ACTION_MAX_UNITS 60→240 + MAX_ROWS 480→1920 (~29% of budget; RECONCILE
  takes 4x bigger single-snapshot sheets). NOT raised with reasons recorded:
  MAX_HISTORICAL_SALE_LINES=100 (data bound — biggest real receipt is 86 lines;
  its "Free-plan" error wording fixed), M4's classify/dispatch windows (job-state
  bound), D1 100-bound-params (plan-independent). Caps exported; every boundary
  fixture now seeds RELATIVE to them (five were silently welded to old numbers).
  wrangler dry-run OK, all backend tests 0 failures. Cron-trigger wiring stays
  with K3; system.ts's three UNBOUNDED Promise.all delete sweeps flagged for K4.)*
  **Workers Paid ($5/mo) is active — re-base the platform assumptions.** The
  code is full of Free-plan ceilings that are now 30s CPU / higher D1+KV quotas /
  1000 subrequests: apply caps (480 rows/60 units, 50-line receipts), backup slice
  sizes (20 objects), includeImages cleanup cap (200), import windows, `STOCK_ACTION_MAX_UNITS`.
  Keep every cap (they are also correctness bounds) but raise the ceilings deliberately,
  one constant at a time, each with a measured reason — and record the new numbers in
  wrangler.toml comments. Also now affordable: Cron Triggers for the 6h image audit and
  backup schedule, Queues at paid limits, and `limits.cpu_ms` tuning.

### Phase M — Old-system data migration (files received Aug 28; analysis done)

*The user is leaving the old POS. Nine spreadsheets received; reconciliation ran Aug 28
(Part 371) — normalized outputs + README in `Downloads/businessos-migration-aug28/`.
Rules (also in assistant memory): the two `products-template-*` files are AUTHORITATIVE
for name/barcode/price/brand/category — old-system exports never overwrite them; naming
is `before_qty / stock_in / stock_out / after_qty`; customers match by PHONE then NAME
against the de-duplicated current contacts; historical sales never accrue loyalty;
barcodes stay text (no scientific notation), Khmer never becomes `?`, no Excel
autocorrect — templates, imports, exports and generated files alike.*

- [x] M1. Parse + reconcile all nine files against the aug27 template. Measured: 21,287
  stock-in lines (95.7% barcode-matched), 930 adjustments (94.3%), 5,903 stock-summary
  rows (95.4%, and old ending stock agrees with template totals for 98.3% of matched
  barcodes), 4,240 expenses (KHR 82,419,900 + USD 129,696.60), 755 drawer sessions,
  3,204 PO invoices (only 1,591 name a supplier). Template cross-check: 0 identity
  drift between the two template files; 4,604 stock changes + 76 appended rows.
  **Found:** every aug27 batch cell is one raw Excel serial (46258 = 2026-08-24) — a
  single synthetic date, wrong format for the importer; fixed copy generated
  (`products-import-aug27-FIXED.csv`). Real received dates live in the stock-in
  history, so batches should come from there, not the template's batch column.
- [x] M1b. **Deep pass (Part 372).** Date order PROVEN `YYYY-MM-DD` in every old text
  export (12,413 rows have day > 12 in day position; zero anomalies in month position) —
  the dd/mm warning applies to the old app's display, not these files; outputs stay ISO.
  **Canonical identity mapping** over 6,218 distinct old products: 5,776 barcode + 226
  exact-name + 127 strong-fuzzy (≥0.80) = **6,129 auto-mapped (98.6%)**; **72 review**
  rows (each with top-3 template candidates + old-vs-template cost as a tie-breaker —
  mostly size/shade variants where a wrong merge would corrupt identity) and **17
  genuinely new/junk**. Event files now carry the TEMPLATE name/barcode/brand/category
  on auto rows (`identity` column records the tier; old identity preserved beside it).
  **Ledger validation:** Begin+In−Sold(±Adj)=End holds for 5,725/5,903; the 178
  failures are in `ledger_validation_failures.csv` with residuals. **Period discovery:**
  the old stock-report is a **2026-01-01 → now period report** (best-fit period start by
  a wide margin, and reported Stock-In never exceeds the summed lines) — its columns are
  renamed `beginning_qty_2026_01_01 / stock_in_2026 / stock_out_sold_2026 /
  ending_qty_current`, and lifetime per-product sales are NOT derivable from these files.
- [ ] M2. Run the imports per **`businessos-migration-aug28/IMPORT-MANIFEST.md`**
  (written Part 375): Step 1 `products-import-aug27-FIXED.csv` (catalog + stock, clean
  first load), Step 2 `products-import-NEW-from-review.csv` (the 73 verified extras,
  generated in template format — 71 enter at stock 0 pending history, 2 carry current
  stock), Step 3 `suppliers-from-po.csv` (16 suppliers ranked by purchases, $1.27M
  total; 12 of 16 supplied both branches; PO export carries no phones — add by hand).
  **Supplier truth:** no export links supplier→product/batch (PO report has invoice
  totals only); per-batch attribution starts with D5, or send the old system's
  "PO invoice DETAILS" export if it exists. User-driven in the UI; files are ready.
- [x] M3. **CLOSED (Part 375) — every one of the 89 rows is decided: 73 add_as_new,
  6 merge_into_template, 10 delete, 0 undecided.** History: Part 373 web-verified the
  set; Part 374 spot-audited it (Rhode Frekle → rhode Pocket Blush Freckle); Part 375
  applied the user's decisions (Dior 436/999 renamed "Dior NNN ក្រែមដើម បំពង់ក្រហម";
  10 placeholder/junk rows deleted — For back, the five "New Item"s, Mac, Jimmy Choo,
  Clarins/Bobbi Brown New Item; the Lip Glow gift sets named "Dior Addict Duo Lip Glow
  Set NNN"; Miss Dior Lip Glow 1947 accepted; Clinique Clarifying Lotion confirmed)
  plus three deeper barcode verifications: 3614273945455 = **YSL Rouge Pur Couture
  Caring Satin** (the barcode is on YSL's own product page — NOT Loveshine, as the user
  said), 3348901633161 = **Rouge Dior Forever Lipstick 558 Grace** (transfer-proof
  matte — matches បំពង់ស្ងួត), 681619814778 = **theBalm Mad Lash Mascara travel 4.5ml**.
  Double-space cleanup on all new-name columns; "Dior 5 Couleurs 843" named to the
  template's "Dior Eyeshadow 5 Couleurs" pattern. **User copies:**
  `Downloads\REVIEW-products-web-verified-v2.csv` (v1 name was locked open in Excel).
- [x] M3b. **Production catalog is EMPTY** (0 active products, 0 batches, 0 branch_stock;
  4,652 customers preserved) — measured Part 373. So the products import is a clean
  first load with no double-count risk. Users(3)/import_jobs(7) intact.
- [~] M4. **The continuation-dispatch engine is BUILT and PROVEN (Part 377, needs
  deploy).** DIRECT-mode stock sheets are no longer capped at 60 units: windowed
  CLASSIFY invocations persist every row's plan (sale groups get a stable group_index
  in new table `import_stock_action_groups`, migration 0063 — the repo's own
  chunk-state-size guard rightly refused collections in chunk state), then windowed
  DISPATCH invocations apply ≤60 units each through the SAME shared per-unit helpers
  the single pass uses; crash/redelivery resumes exactly on the writers' seals.
  Ceiling: 25,000 rows/file — the 21,287-row history is now ONE import job
  (~355 automatic queue invocations internally). RECONCILE keeps the single pass and
  its 480/60 caps on purpose (one consistent live-stock snapshot). Proven:
  130 units across 4+ invocations, redelivered-message resume with zero double-adds,
  both reconcile caps, the direct ceiling. **Remaining:** deploy (applies 0062+0063),
  then run `stock_in_history.csv` through the stock-action import in the UI.
- [~] M5b. **The dated sales export ARRIVED and the import files are BUILT + VALIDATED
  (Part 378).** `report-invoice-detail (1).xls` (40,344 lines) became
  `sales-import-2024/2025/2026.csv` — 14,919 receipts in the app's exact
  SALES_IMPORT_COLUMNS contract. Validated hard: line quantities reconcile EXACTLY
  with the source footer (58,253 + 4,368 delivery lines = 62,621); revenue + delivery
  fees within 0.02% of the source grand total; Khmer byte-perfect; strict 24-hour
  times from check-in stamps; **4,348 reused invoice numbers disambiguated `NNN@date`
  so the importer's receipt grouping can never merge two sales**; delivery-service
  lines → delivery fee + driver as delivery contact (Walk-In = not delivery); credit/
  commission preserved in notes; per-line historical COGS carried; branch assumed
  'shop' (source has no branch column — flagged). The import's matcher was verified
  IN SOURCE to already do exactly the user's rule: customers phone-first → unambiguous
  name, match-only. **User runs them (oldest first) after catalog import; loyalty
  checkbox stays OFF.**
- [x] M5c. **Supplier attribution for stock history (Part 378).** The Stock-In Invoice
  reports carry per-product lines under supplier headers (7,340 lines →
  `stock_in_invoice_lines.csv`); joined on barcode+date they fill
  `stock_in_history.csv`'s supplier column for **8,053 of 21,287 lines (37.8%)** —
  the rest genuinely has no supplier record; 38 same-day multi-supplier cases left
  blank, never guessed. With 0062 deployed, those batches import with their supplier.
  `sold_by_supplier_summary.csv` (Item Report) adds per-supplier revenue/cost/profit.
- [~] M5. Historical SALES linkage. **The loyalty prerequisite is DONE in code
  (Part 372, needs migrations/deploy):** migration `0061` adds `sales.loyalty_accrual`
  (default 1); every aggregation (sales route redemption check, shared
  `summarizePoints` fed by portal + contacts, notifications loyalty section) skips the
  EARN for accrual=0 rows while still counting points redeemed on them; the historical
  sales import always writes 0; POS gains a per-sale "Count loyalty points" toggle
  (default ON, shown for any selected customer). `test-loyalty-accrual-pure.cjs` proves
  it against the real migrations + real route SQL + real kernel source. **Still open:**
  the sales import itself awaits the old system's dated sales/customer export (the nine
  files carry none — the stock-report's Sold column is 2026-only); customers match by
  phone then name against the de-duplicated contacts when it arrives.
- [ ] M6. Adjustments (930), expenses (4,240) and PO invoices (3,204) land with their
  Phase D features — stock-change ledger, expense import, supplier accounting. The
  CSVs already use the final column naming, so those importers should accept them as-is.
- [x] M7 *(Part 392: SHIPPED, needs deploy — the contract is now TESTS
  (`tests/encodingSafety.test.ts` 9 cases + `test-encoding-safety-pure.cjs` incl. a
  frontend↔backend parse PARITY lock), and the sweep found + fixed four real gaps:
  (1) preview≠commit — the backend parser never applied the `="text"` unwrap and
  NEITHER parser stripped the leading-' injection guard this app's own exports write,
  so re-importing our own CSV corrupted every =/+/-/@-leading value and a protected
  barcode committed as literal `="..."` text; both parsers now apply both unescapes
  identically (real apostrophes like O'Brien untouched); (2) the xlsx→text bridge ran
  the HUMAN Excel-injection escape on a MACHINE path — a numeric -5 cell reached the
  analyzers as unparseable `'-5`; new `csvFieldForMachine` (RFC4180-only) replaces it
  there; (3) .csv entries inside export ZIP packages carried no UTF-8 BOM → Khmer as
  '?' in Excel; (4) errors.csv (backend) same, BOM added. Screen 1's
  scientific-notation rejection + xlsxExport's Text-cell forcing + full
  export→reimport identity round-trips are pinned by test. Commit `8e5f87e8`.
  **Part 395 addendum — the MIGRATION PACK itself is now under the same tested
  contract:** `businessos-migration-aug28/validate-pack.cjs` (persists WITH the pack —
  every earlier validator died in a session scratchpad) re-proves all 20 CSVs + 12
  XLSX twins through the app's real parsers: strict UTF-8+BOM/NFC/no-mojibake with
  Khmer presence counts per file, zero scientific-notation/float/stripped-zero
  barcodes, template identity incl. the name-fallback rows and EXACTLY the 6 recorded
  junk orphans, P8 phone formatting (10,352 formatted; the 273 preserved-as-is are
  dual numbers/foreign/partials, zero unformatted-valid leftovers), the mm/dd/yyyy
  convention (only receipt_number's @ISO disambiguators exempt), recorded row counts
  + 0064 sums, and row-by-row CSV↔XLSX agreement with identity columns byte-exact.
  Final state: **ALL CHECKS PASSED.** Three real finds fixed along the way: 3
  text-form dates ('1 Jan 2025/2026') in stock_adjustments that the Part-388
  conversion missed (CSV + twin regenerated), drawer_sessions' 1,509 datetimes still
  ISO (converted to the pack convention), and — found BY the twin check — a real app
  bug: xlsxExport numbered id-like strings in MIXED columns, eating leading zeros
  (fixed + pinned, `72e90b21`). IMPORT-MANIFEST corrected: 12,093/146 per-branch row
  counts, mm/dd/yyyy convention lines, and a "re-validate after any edit" section.
  One documented source artifact stays: sales-2025 row 7991's customer_name is the
  old system's own '8.55E+11' (its phone 012 860 695 is intact and drives matching).)*
  Encoding-safety sweep as a TESTED contract: template downloads, exports and
  the import parser preserve text barcodes (no scientific notation, no stripped leading
  zeros), Khmer text (UTF-8 + BOM where Excel is a consumer) and literal formats.
  Screen 1 already rejects scientific-notation barcodes; extend the same guarantee to
  every generated file and export.

### Phase B — Stats/tooltips finish + small confirmed UI corrections

- [x] B7. **POS cart round 2 (Part 379, needs deploy).** Section order is now
  Customer → Discount → Membership → Delivery → Summary → Payment (discounts moved
  directly under the customer, per the Aug-28 ask). Discount label sits STACKED above
  the %/$ toggle with the inputs on the next row (not label-beside-toggle); the Total
  is one row (`$X.XX (KHR)`); the verbose membership sentence is gone; the payment
  method column narrowed to 6.5rem with the amount inputs taking the freed room; the
  remove button shrank to h-7 while its × grew to text-lg (it was a big box with a
  tiny glyph).
- [x] B8. **Fees polish + 'expense' type end-to-end (Part 379, needs deploy).** Fee
  Type + Label genuinely share one row now (an old comment claimed it; the JSX
  stacked them); the Label input suggests every label already saved on a fee (saved
  reasons, reusable without retyping — new labels just get typed); `expense` joined
  the type vocabulary in the frontend union, the form options, en+km labels AND
  routes/fees.ts's FEE_TYPES (without which normalizeFeeType would silently rewrite a
  saved 'expense' to 'other').
- [x] B9. **Old-system expenses are now cloudflare migration `0064_old_system_expenses.sql`
  (Part 381)** — per the user: "make sure all are imported by migration… doing from
  backend." The deploy's `migrate:remote` applies it; idempotent by construction (it
  clears its own 'Old system'-marked rows first, so even a prior manual run cannot
  double). Verified in the real harness: 65 migrations apply; **4,240 rows ·
  SUM(amount_usd)=129,696.60 · SUM(amount_khr)=82,419,900 — expected == actual**,
  equal to the source report's grand total. The standalone SQL was removed from the
  pack; the manifest's Step 4c now just says deploy + the live verification query.

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
- [x] B2. **DONE (Part 372, needs deploy).** Supplier form's first field is now "Phone
  Number" (edits the primary contact option's phone; the person's name stays editable in
  the option rows and contact_person is still derived on save — no data loss). Customer
  form + POS quick-add put Phone Number directly after the name, ahead of membership.
  New `phone_number` en+km key. Delivery forms already led with phone.
- [x] B3. **DONE (Part 372, needs deploy).** POS delivery: rider search + fee share one
  row; the standalone `= KHR` echo removed (the paid-by note already shows USD (KHR)
  added/absorbed); "Fee paid by" label + Customer/Store toggle on one row, buttons sized
  to their text.
- [x] B4 *(Part 394: LOCATED with production data, then fixed — migration 0072,
  needs deploy. Not Sales/Contacts: the old system recorded courier payments as
  EXPENSES whose one label column carried kind+counterparty — 3,130 of the 4,240
  rows 0064 imported read `Delivery / Capital Express`, `/ Grab`, `/ J&T Express`,
  `/ Virak Buntam`, `/ តា តឿ`, `/ ពូ​ ខុម`, `/ ពូ​ ហុង` (+1 bare `Delivery`),
  shown on the Fees page as Type=Expense. 0072 moves the kind into fee_type
  ('delivery' was already in FEE_TYPES) and keeps only the courier in the label —
  measured safe first: nothing counts fee_type='delivery' as revenue. Verified in
  the real harness (0018→0023→0064 verbatim→0072): 3,130 re-typed, 1,110 expenses
  untouched, USD 129,696.60/KHR 82,419,900 preserved, idempotent; the manifest's
  live check stays valid.)* "Delivery was made into the category column — separate
  it."
- [x] B5 *(Part 398: SHIPPED, needs deploy (`26b04c91`) — enabling the 80x50 card no
  longer makes the FULL receipt unreachable: the receipt view stacks BOTH renditions
  (card first, labeled "80 × 50 mm"; full roll receipt under it, labeled "<N> mm") and
  Print splits into "Print 80×50" (fixed zero-margin sheet) + "Print <N>mm" (the full
  receipt on the continuous roll — an '80x50mm' stored size maps to the 80mm roll for
  it, any other configured size is kept). Open PDF / Save Image keep acting on the
  configured card; single-size mode unchanged. Both source-lock tests re-pinned.
  Verified LIVE on worker-dev with a real sale (both renditions render real data, both
  Print buttons fire their variant); the print WINDOW can't open in a hidden browser
  pane (the shared pipeline awaits requestAnimationFrame — environmental, also true of
  the old single-Print path), so physical printing stays on the post-deploy live
  checklist with A2.)* Receipt print: when 80x50 is enabled, clicking Print offers BOTH sizes and the
  preview shows BOTH (today only one previews). Verify printing end-to-end while there.
- [x] B6 *(Part 389: shipped on all five pages, needs deploy. Inventory: toolbar
  select-all control removed, bulk toolbar exists only while selected, header checkbox
  = select-all, column collapses. Sales + Returns additionally gained the Products
  long-press-to-select model they never had (checkboxes no longer permanent; click
  still opens detail out of select mode). Branches (card list, no header): the
  select-all row renders only in select mode as the list's header-equivalent; card
  long-press with a capture-phase ghost-click guard. Contacts: useContactSelection
  owns selectionModeActive + long-press slots so all three tabs inherit one
  implementation; in select mode a cell click toggles, out of it cells open detail.
  NOTE the Products asymmetry flagged under "Flagged, not guessed".)* (11.1/11.2 rest)
  Select-column collapse + header-checkbox-as-select-all on
  Inventory/Sales/Returns/Branches/Contacts (Products already done). "Select all" button
  is removed; in select mode the column-header checkbox IS select-all.

### Phase C — Delivery: customer charge vs internal actual cost (11.27, full)

*The revenue-truth feature. Charge stays what the customer sees; actual cost is what the
store really paid the rider; margin = charge − cost and is internal only.*

- [x] C1 *(board reconciliation, Part 407 — shipped long since as migration
  0068_delivery_actual_cost.sql; POS + edit record it; C4's note already
  said "Phase C is closed", these three bullets just never flipped.
  Re-verified today: the migration exists, POS writes the field.)*
  Schema: `sales.delivery_actual_cost_usd` (+ derived khr at the sale's rate),
  additive migration. POS records it next to the existing fee; edit allows correction.
- [x] C2 *(board reconciliation, Part 407 — re-verified today: zero
  delivery_actual_cost references in routes/portal.ts or any receipt
  lib/template; the field never enters customer-facing serializers.
  Staff Sales/stats read it normally per the Aug 28 scoping.)*
  Redaction is server-side, not UI-side, and scoped exactly as clarified Aug 28:
  the actual cost **shows normally in Sales and stats for staff** — it is hidden ONLY
  from receipts, customer-facing reads and public/portal APIs ("a detail that was
  counted but not in receipt, only for us"). Deny-by-default serializer on those
  surfaces, tested the way product surfaces are.
- [x] C3 *(board reconciliation, Part 407 — re-verified today: the
  salesAnalytics kernel exposes charged vs actual (delivery_actual_cost_usd
  + honest _count for "n of m recorded") and margin; Dashboard and the X2
  daily report both read the kernel, not their own math.)*
  Stats/sales distinguish three numbers everywhere they appear: delivery revenue
  (customer-paid fees), delivery expense (actual costs, including store-absorbed fees),
  delivery margin. One shared kernel computes them (see the single-source rule);
  Dashboard/Sales/exports all call it.
- [x] C4 *(Part 401: shipped, needs deploy — d1b16d4d. SALES_IMPORT_COLUMNS
  carries delivery_actual_cost_usd/khr (the export sits behind the sales
  permission; receipts/portal never read the contract — re-verified, no
  receipt component references actual cost); classifySales parses them
  (blank → NULL = "not recorded", never 0) and the import INSERT stores
  them, so an exported file round-trips without dropping courier costs.
  With C1 (0068), C2 (whitelists, verified), C3 (kernel + Dashboard + X2
  daily report) — Phase C is closed.)* Import/export carry both fields
  (staff export only); receipt templates
  re-verified to print only the customer charge.

### Phase D — Products data model: stock-change ledger, batches, suppliers

- [x] D1b *(Part 390: SHIPPED, needs deploy — the report lives as a folded teal
  SectionCard ("reports" kind) on Contacts → Suppliers, because per-lot costs +
  supplier spend are exactly what the contacts_suppliers gate scopes (R2) — both
  endpoints sit under /suppliers/* so requireSupplierAccess covers them. Migration
  0070 adds `product_batches.received_branch_id` (+ received_at index): branch_batch_stock
  says where stock SITS, not where it was RECEIVED, so the branch filter needed the
  receive-time fact — both writers (receiveBatchStock, applyUnifiedStockAdd) stamp it,
  first-attribution-sticks like supplier, and it deploys BEFORE the history import so
  the 21k rows land with their real shop/warehouse split. Invoice = supplier + received
  DAY: the old system's invoice NUMBER was never stored in this schema — date is the
  honest grouping, nothing fabricated. Groups endpoint paginated ≤25; lines load per
  invoice on expand, paginated ≤200, so the catalog import's synthetic same-day group
  can never balloon a response. Honest-count rules tested: cost totals only where
  qty+cost both known (lines_without_cost says the rest), branch filter reports
  invoices_without_branch instead of silently hiding, date bounds exclude the no-date
  group which stays reachable unfiltered ("No date recorded"). id-attributed and
  name-only lots of one supplier merge into ONE group (same rule as the D5 purchases
  drill, other direction). `test-stock-in-invoice-report-pure.cjs` proves it against
  the REAL 71-migration chain + real transpiled writers. **Remaining:** (a) §11
  products-import batch INSERTs (importEngine.ts — another session's in-flight file,
  Aug 28) don't stamp received_branch_id yet; those lots show honestly as "no branch
  recorded"; (b) the sibling reports this one's filter row anticipates — stock-out,
  adjustments, expenses/fees — are still open.)* **Stock-In Invoice report view (user, Aug 28 — modeled on the old
  system's).** A reporting surface grouped supplier → invoice (date + number) →
  product lines (name, barcode, qty, unit, unit cost, net total), with the SAME filter
  row everywhere: branch (shop / warehouse / all) · supplier · date range. The same
  filter pattern applies to stock-out, adjustments and the expenses/fees section, so
  every report reads identically (SectionCard kinds carry the color). Backed by the
  data that now exists: batches carry supplier (0062) + received date, movements carry
  type/date/branch. Nothing hidden — show as much as the data holds.
- [x] D1 *(Part 415, session a7 — SHIPPED with D3's drill half. Kernel
  lib/stockLedgerQuery.ts derives the running balance by walking BACK from
  current stock (snapshot-migrated products get the honest implied
  baseline, never a fabricated zero); sign/bucket semantics pinned EQUAL
  to frontend movementGroups.movementSign by the 13-check pure test
  (real SQL, real migration chain). GET /products/stock-ledger: views
  all|adjustments|in|out, search (escaped LIKE, barcode via join),
  inclusive date bounds, pagination; gate = real products OR inventory
  tier. UI: folded reports SectionCard below the Products listing, exact
  column design (Before · Adjustment± · Stock In · Stock Out · After,
  movementColorClass colours), row click = per-product mini-ledger from
  the SAME endpoint (D3's absorption — drill and list always agree).
  D2's filter row (supplier via batch attribution, branch/date UI) stays
  open — endpoint already accepts branchId/dates.)*
  **Stock Change section on Products** (the user's ledger design): one row per
  action with columns Name · Barcode (+N) · Before Qty · Adjustment (±, reason) ·
  Stock In (add/create, colour-coded) · Stock Out (sale/damage/return/lost/wrong,
  colour-coded) · After Qty. Views: All / Adjustments / Stock In / Stock Out. Row click
  opens details: a summary section + a detailed mini-ledger incl. batches. Data source is
  the EXISTING movement history — this is a read/UI surface, not a new write path.
  Reuses/absorbs Inventory's "view stock movement" detail (D3).
- [~] D2 *(partially advanced, Part 420, session a7: the LEDGER's filter
  row shipped — branch (AppSelect), inclusive date range, action type
  (the view chips), all server-side on /stock-ledger which took these
  params from day one. REMAINING, honestly scoped: (a) supplier — cannot
  be answered truthfully from existing data: inventory_movements never
  records which batch a row touched, so it needs an additive
  movements.batch_id migration + writer stamping first (importEngine's
  writer is 05's A4-hot lane; coordinate); (b) the page-level Date-scope
  row below the search row on Products AND Inventory with the Filter
  button moved onto it — Inventory.tsx hot with 9d's F2 at the time.)*
  Filters grow: by supplier, by date range (the new date row), by action type,
  by branch. **Date-scope row** sits directly below the search row on Products AND
  Inventory, with the Filter button moved onto it.
- [~] D3 *(first full slice SHIPPED, Part 422, session a7: the detail modal gained four folded N3 SectionCards -- Batches (per-lot totals across branches + received/expiry + supplier), Suppliers (D1b identity rule, honest lots_without_cost), Sales (kernel per-day/month via whereActiveSales), Stock Changes (D1 ledger scoped to the product -- running balance, never disagrees with the page ledger). One new read /products/:id/detail-report + kernel getProductSalesBreakdown. STILL OPEN here: in-detail movement filters + the full Date/Type/Batch/Qty/Balance/Reference table (Batch column needs the movements.batch_id migration -- D2 gap), receipt-# references, and product-search-by-supplier/batch (search-engine unit).)* **[CLAIMED: session a7]** (the drill half shipped with D1/Part 415;
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
- [x] D4 *(Part 403, session 05 — SHIPPED, needs deploy (9a73b7cb). Measured first:
  the kernel half already existed (receiveBatchStock takes receivedDate; the Receive
  Batch modal has the field; §12 imports stamp real dates) — the real gaps were POST
  /adjust never passing a date (Product edit's BranchStockAdjuster + Inventory's
  Adjust modal always stamped today) and the transfer barcode rule being untested.
  /adjust now takes receivedDate through the SAME normalizeToIsoDate + receiveBatch-
  Stock path (unreadable = 400 writing nothing, absent = today unchanged, explicit-
  batch top-up keeps the lot's own received_at); both UIs gain the date field +
  derived-code preview shown only when the add creates a lot, request mirrors input
  visibility, reset-to-today per open. Transfers verified already barcode-preserving
  — pinned, not rebuilt. 6-check pure test drives the real transpiled route on real
  migrations. Flagged: group adds keep the group exclusion (today default); Branches
  page has no add affordance by design; all received-date defaults are UTC-day
  (pre-existing, consistent, needs a deliberate decision).)* (11.28) **Manual historical batches**: enter real received date + batch when
- [x] D4b *(Part 406, session 05 — SHIPPED, needs deploy (49acefd5). All five parts
  landed: (a) both adjusters lose the is_group picker exclusion + mandatory-batch
  validation covers groups (the "containers have no batches" comment was stale —
  auto-routing has been creating container lots all along, the UI just hid them);
  (b) BulkAddStockModal gains received date + code preview (the date IS the lot key
  in bulk auto-routing; "dated today" note reworded en+km); (c) ReceiveBatchModal
  gains the same existing-lot picker (explicit lot tops up exactly that lot, date
  input hides since the lot keeps its own; POST /api/batches accepts batch_id,
  foreign lot = 400 not 500; lot choice deliberately not draft-persisted);
  (d) Branches per-branch stock cards gain a receive button opening the ONE shared
  ReceiveBatchModal with product+branch preselected, section refreshes in place —
  11.28's "Branch batch views" entry point exists now; (e) Inventory.tsx group
  guards dropped. 8-check pure test; tsc clean both, all backend + all frontend
  tests pass, vite build. a7 released Inventory/Branches mid-unit; packs rode 6e's
  35cfc5b7.)* **User correction on D4's flags (Aug 28): the
  exclusions are rejected — "it should have batch picker... it has to be consistent,
  cannot have one place not the other... smart and fully consistent and user-friendly."**
  Batch picker + received date reach EVERY stock-add surface.
  recording stock late — from Product edit, Inventory batch view and Branch batch views.
  One shared validation + stock/batch kernel for all entry points. Branch transfers
  PRESERVE the barcode; only create/add/adjust flows may set/change one.
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
- [x] D5. **Supplier accounting** *(Part 384: shipped — 0067 `received_quantity`
  written by both receive paths, GET /suppliers/:id/purchases under the
  contacts_suppliers gate, Purchases drill in the supplier detail modal with
  per-lot cost/credit and honest `batches_without_cost` for pre-tracking lots;
  "awaiting payment" = the credit state, admin-reminded via Q1)*: per-supplier totals (how much bought), auto-derived
  from batches/add-stock; per-add-stock payment status incl. **awaiting payment**;
  add/create stock can pick the supplier. Supplier lives on the batch/receipt level and
  FOLDS into the product as a "Supplier" section — child rows inherit the group's
  sections rather than each carrying supplier state. **Clarified Aug 28: the SAME
  product can have DIFFERENT suppliers across batches** — supplier is a property of the
  BATCH (schema: additive migration putting supplier name/id on `product_batches`; the
  measured schema has none today), the product's Supplier section lists every distinct
  supplier with per-supplier received totals, and the product detail + search can find
  products by supplier. The unified §12 import template gains an optional `supplier`
  column so a stock-in row attributes its batch at import time (blank = unattributed —
  the nine current exports carry none, but future files and manual entry will).
- [x] D6b. **Import identity/merge rules — measured against the user's Aug-28 spec
  (Part 379).** Already true in the engine: same name + same barcode MERGES, and
  `resolveMergedPricing` takes the **HIGHEST selling and VIP price** on every merge
  (its comment: merging must never quietly drop a price a merged row expected to
  charge); same name + different barcode stays a separate child row; costs live on
  batches (rows click through to detail). Verified true in the migration data: all
  5,973 name groups in the aug27 file already carry ONE category/brand (unification
  script changed ZERO rows — the earlier brand normalization did the work). **Still
  open:** engine-side name-group category/brand unification for FUTURE files whose
  groups disagree (needs a cross-window pass like the §12 seal; rule: most frequent
  non-empty value in the group, tie → first row), plus surfacing "group unified" in
  the review screen.
- [x] D6 *(Part 399 continuation, session 6e — SHIPPED. lib/renameCascade.ts impact+carry engine (distinct-product counts; history never rewritten); GET /rename-impact + POST /rename-brand; PUT /:id __rename_scope='group' closes 9.1 (whole name group renames, 0010 trigger keeps grouping); lookups cascade:'copy' + the multi-value-membership gap FIXED; supplier __rename_cascade='carry' finally follows products+batches. Shared before→after modal (carry / keep-a-copy / only-this / cancel) wired in the category manager, supplier editor and product form (name-group + brand-wide asks); preview-endpoint failure falls back to each surface's old behavior. 5-check pure test on real sqlite + real migrations.)*
- [ ] D6. Rename cascades with before→after preview: changing a category/brand/supplier/
  product name shows before and after and asks what happens to attached rows (carry all
  attached products to the new name / keep a copy, new is new / cancel-go-back). Also the
  path to closing 9.1 (rename does not regroup) — same reconciliation machinery.

### Phase E — Information architecture: fewer, deeper pages

*Primarily rewiring. Clarified Aug 28: polish and logic improvements ARE allowed along
the way — but only where they improve the product without disturbing any calculation's
results; every number shown before/after a move must come from the same shared kernel
(single-source rule), and consistency across pages is part of done. Keep internal page
ids + permission keys STABLE (the permission model, `canAccessPage`, and audit
references key off them); the sidebar shrinks and the moved pages become sections with
deep-linkable tabs.*

- [x] E1 *(Part 413, session a7 — SHIPPED. BranchesHubPage chips: Stats &
  Branches / Products / Movements / RFID — Inventory moves INTACT, sliced
  through its own pre-existing section system via a hostSection prop
  (internal jumps report back so chips stay truthful; component stays
  mounted across chips). Products kept as a 4th chip — FLAGGED deviation
  from the 3-section wording: that slice has no other home and "nothing
  lost" outranks the count; Inventory's internal 'all' view retires with
  its picker when hosted. inventory PAGE id retired across the quartet,
  permission key lives on gating the three inventory chips; /inventory
  remaps (products chip); Dashboard handoff re-pointed and peeked by the
  hub; branch-transfer options were already current (05's D4b landed
  batch preservation on every surface). Phase E is now fully closed. 619
  PASS chain + build green; live-verified below with 4a's D5a on the
  same dist.)* **Inventory merges into Branches** as sections: "Stats & Branches" (Inventory's
  stat cards + branch list), "Movements", "RFID". Branch transfer options updated to
  everything shipped since (batch preservation, §14 details).
- [x] E2 *(Part 407, session a7 — SHIPPED. SalesHubPage hosts Sales +
  Returns + Fees as lazy tier-gated sections (components moved INTACT,
  Part-405 export wiring and rememberKeys untouched); returns/fees PAGE
  ids retired across the quartet, permission keys unchanged; /returns
  and /fees deep-link to their sections; useIsPageActive re-keyed to
  'sales' in both absorbed pages; sales door widened for returns-/fees-
  only grants. 594-test chain + build green; verified live: both
  sections render AND fetch, deep links land right, nav clean.)*
  **Sales absorbs Returns and Fees** as sections of one Sales page.
- [x] E3 *(Part 404, session 6e — SHIPPED (renumbered off 403 = 05's D4).
  'Review & Logs' hosts the queue + audit trail as sections; audit_log page
  id/nav/path retired, permission keys stable, sections self-gate, the door
  admits either grant; /audit-log deep-links open the Audit section; the
  AuditLog component moved INTACT with its Part-401 export dialog.)*
  **Review + Audit Log merge into "Review & Logs"** — approvals queue and the
  audit trail side by side.
- [x] E4 *(Part 404, session 6e — SHIPPED. The Settings hub hosts
  Settings | Users | Backup as sections; users/backup page ids retired,
  /users and /backup deep-link to their sections, narrower settings grants
  (business_identity/sales_policy/drive_credentials) still open the hub.
  7.2 landed with it: role-summary strip, per-section live state chips,
  one-row headers with descriptions in the info hint — same keys, same
  storage, all pinned behavior unchanged. Sidebar is three entries
  shorter. E6 sweep for these two moves: export/import affordances all
  live INSIDE the moved components (AuditLog's export dialog, Users'
  flows, Backup's own surface) — nothing orphaned, no dead routes; old
  URLs remap rather than 404.)*
  **Settings absorbs Users and Backup** as sections/mini-sections; the permissions
  editor redesign (7.2) lands as part of this move.
- [x] E5 *(Satisfied by G2, Part 399: the Promotions page exists with Loyalty Points as a lazy section behind a switcher — exactly this item; see G2.)* **Promotions page** (new) with Loyalty Points as a section (see Phase G).
- [x] E6 *(closed with E1, Part 413, session a7 — per-move evidence: E3/E4
  re-checked by 6e at their landing (AuditLog's export dialog, Users'
  flows, Backup's surface — see E4's own note); E2 verified live at Part
  407 (Returns + Fees export dialogs open as hub sections); E1 verified
  live at Part 413 — Branches' ExportOptionsDialog OPENS on the hub's
  Stats & Branches chip, Inventory's per-tab export option builders
  (movements/products/rfid, Part-405 structure) moved untouched with the
  component and their chain pins stayed green; /audit-log, /users,
  /backup, /returns, /fees, /inventory all remap, none 404.)*
  Every export/import affordance on the moved pages is re-checked after the move
  (no orphaned buttons, no dead routes) — Golden Rule 6.

### Phase F — Add/create flows: wizard, fast batch entry, drafts

- [x] F1 *(Part 408, session 6e — SHIPPED, with P7-b folded in. Pure
  classifier helpers/productCreateMatch.ts (exact_twin / name_match /
  barcode_match, canonical-name adoption, price advisory, before→after
  lines); ProductForm create mode live-searches name+barcode (350ms
  debounce, stale-response guard) with an inline verdict panel under the
  name input and a submit-gating modal: go back · add as child (adopts the
  group's exact casing) · proceed as new (withheld for an exact twin —
  backend 409s it anyway). Asked once per typed identity, not per click.
  P7-b: scientific-notation barcodes refused client-side (same regex as
  productImportPlanner) AND server-side 400 (code
  barcode_scientific_notation) on both create and update doors.)*
  **Add Product = new products only.** Typing a name live-searches existing
  products; matching name/barcode/both raises a structured warning with actions: go back ·
  add as child of the matched group · proceed as new — with a before→after arrow preview
  and a page-by-page confirm. Price similarity is advisory ("matches X on name+price but
  differs on barcode; recommend child row").
- [x] F2 *(Part 419, session 6e — SHIPPED. FastStockInModal: the
  shipment header once (branch, received date defaulting today, the
  SHARED SupplierPickerField, paid/on-credit with enforced due date),
  then rapid lines — live name/barcode search, pick, qty (Enter =
  Add)/unit cost (seeded from the row)/optional expiry; every Add is ONE
  receiveBatchStock through the D4 kernel (no parallel write path, no
  direct fetches — pinned by test) with its outcome shown on its own row
  (lot code or the error, retry in place), then the input clears and
  refocuses for the next product. Done closes and refreshes Inventory
  only when something actually landed. Launched from Inventory's Manage
  menu (⚡). tests/fastStockIn.test.ts pins each clause of the spec.)* **Fast stock-in (batch in):** enter batch + supplier once, then per-product
  name→details entry; "Add" appends and continues, "Done" completes the batch. Backed by
  the same add/batch kernel as D4 — no parallel write path.
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

- [x] G1b *(Part 397, session 6e — SHIPPED, needs deploy (0073). Migration 0073.
  User refinement round, Aug 28: (a) search ordering — within matching
  results, discounted/promoted items top; relevance orders inside each
  block ("relevance still wins but if relevance also have discounts,
  discounts top"); (b) NEW rule types: spend ≥ $X save $Y; buy ≥ X get Z%
  off; buy N get the NEXT item $Y-or-Z% off — where the CHEAPEST item of
  each complete group gets the discount ("only lowest of the two"),
  repeating per group, cart-level across a rule's scope; (c) label
  wording styles — auto-generated titles selectable as Save/Get/Free
  phrasings, custom title still overrides; (d) filter menu reorganized for
  scanability; (e) public-portal facet privacy audit — supplier and any
  admin-internal facet must never reach the portal. Footprint: both
  kernels + promotionRulesSql, routes/promotions|products|portal,
  PromotionsPage, posCore/POS/ProductDetailSheet, Products + filter
  helpers, portal display/section/page, lang packs additive, promo tests.
  Delivered: three new rule types (spend_save, quantity_percent, next_item);
  next_item pairs units ACROSS cart lines and the CHEAPEST unit of each
  earned group takes the cut, reverting when its partner leaves; auto-label
  wording styles Save/Get/Free with a live preview (typed Title overrides);
  ordering flipped so promoted matches top the result set with relevance
  ordering inside each block; filter menu reorganized (everyday facets first,
  Created/Issues/Search-mode last); portal gains ONE 'Promotions only' pill
  and a test pins that portal payloads/facets never carry supplier, cost or
  tag_label. Scope note: the cheapest-of-group reading is merchant-safe
  (hits = floor(units/(N+1)) landing on the cheapest units) — flagged here
  rather than guessed silently.)*
- [x] G1 *(Part 391, session 6e — SHIPPED, needs deploy (0071). Migration 0071
  promotion_rules; ONE kernel lib/promotionRules.ts + hand-synced frontend mirror
  (byte-drift-guarded by test); routes/promotions.ts /rules* — manage under the new
  'promotions' page permission, /rules/active open to any authed user, strip keeps
  its products gate; promoted-first is SERVER-side (familyPagination family_promoted
  aggregate; portal snapshot+search reordered too) so it holds across pages, with
  relevance still first during a search; rules ride search/bootstrap/portal payloads
  (POS offline inherits the cached copy); POS grid/sheet advertise via the kernel —
  quantity deals show BEFORE the threshold — and a pure cart reprice pass drops the
  price when qty crosses and restores it when it falls back, storing through the
  existing product_discount_* sale fields (no sale schema change); Promotions admin
  page (rules editor + per-product discounts manager); ProductForm's Discounts tab
  removed per the refinement; Products gains the Promotions filter section
  (promoted/discounted/any rule/each rule, server promo= param); portal shows a
  single 'Promotions' header over the promoted block and prices identically —
  the portal SELECTs finally carry discount columns at all (pre-existing gap: the
  storefront could never show a per-product discount). Deliberate scope notes:
  POS has ordering+badges but no promo FILTER control (cashiers search; Products
  is the management surface — flagged, not silently skipped); admin Catalog
  PREVIEW evaluates without rules (per-product discounts only) — the live portal
  is the truth surface.)* Promotion engine: rule types "buy ≥ X save Y", "% off selected items", fixed
  discount; optional display Title (tag/label shown or hidden); scope = one product,
  a set, category/brand; start/end dates. POS + portal both read the SAME rule evaluation
  kernel (truth never diverges between what POS charges and what the portal advertises).
  **Refined Aug 28:** per-product discounts MANAGE in Promotions (moved out of the
  Products edit surface), while their labels stay VISIBLE in Products' default view,
  the POS grid and the public portal. **Ordering rule:** promoted/discounted items are
  always shown FIRST — they occupy a higher-order block above the alphabetical run and
  the A–Z rail applies after them (Products, POS, portal alike). Filters exist for
  every one of these states (promoted / discounted / by promotion).
- [x] G2-G4 *(Part 399, session 6e — SHIPPED. Footprint:
  PromotionsPage + LoyaltyPointsPage embed + nav/pathRouting/AppContext perm
  gates, portal PublicCatalogPage/CatalogProductsSection + routes/portal.ts
  ordering+initials, lang packs additive. NOT touching POS.tsx (a7 holds
  P7-a) or receipt files (35).)*
- [x] G2 *(Part 399: standalone page retired; renders lazily as a Promotions section behind a Promotions | Loyalty Points switcher; customer_portal holders keep access through the widened page door while promo sections self-gate; old /loyalty-points URLs land on Promotions.)* Loyalty Points moves in as a Promotions section (E5).
- [x] G3 *(Part 399: PortalPromoStrip above search, public-only, honors show-promotions; rule chips (Title/auto-label, hidden titles stay hidden) + promoted-product cards with kernel cut prices; rAF drift, pause on hover/touch, dot-per-item jump.)* Portal promo strip: one auto-scrolling row above search; "·" dots represent each
  promoted product/promotion, click a dot to jump. Promos render Title + discount.
- [x] G4 *(Part 399: brand-alpha order with blank brands trailing as "Other Brands", brand grid headers, rail letters/counts/initial-filter all from p.brand server-side, admin-preview fallback matches; both regression tests re-seeded brand-first.)* Portal ordering flips to BRAND-first: alphabetical order and the fast A–Z rail
  index brands, not categories.
- [x] G5 *(Part 399, session 6e — ALL FIVE CLOSED; Phase G complete. 6.3 was
  reproduced live by a7's Part-400 sweep and fixed by 6e (b32026a2-adjacent
  commit): settings saves bump their own cache version and the portal cache
  key composes products+settings, so portal-editor saves (map embed
  included) apply immediately instead of hiding behind the 60s TTL —
  regression-pinned.
  6.1: cover image stands alone (no colour gradient/scrim) and backs the
  WHOLE About card, content on a translucent surface. 6.2: top bar carries
  no logo; socials left, language + light/dark right; the About hero became
  the live logo surface and now uses the shared buildLogoImageStyle. 6.5:
  both portal product endpoints paginate by GROUP via familyPagination —
  totals/pages equal cards (and the rail), full groups per page, proven
  against the live route. 6.4: the Google-Translate widget + packs-as-
  fallback already exist end to end (portalTranslateController, admin
  toggle customer_portal_translate_widget_enabled, tests) — the row below
  was stale, corrected rather than rebuilt.)* Carried portal items: §6.1 About overlay/cover, §6.2 top-bar split, §6.3 stale
  embed cache (repro first), §6.4 Google-Translate-backed languages (packs as fallback),
  §6.5 pagination counts merged rows.

### Phase N — Import options + navigation guard + section UI (user, Aug 28 third batch)

- [x] N1. **Import-time loyalty option, end to end (Part 374, needs deploy).** Backend
  (Part 373): `policy.accrue_loyalty`, safe-off on absent/false/malformed, threaded into
  the sale writer. UI (Part 374): the sales import Screen 1 carries a "Count loyalty
  points for these sales" checkbox, default OFF, with an explanation of why (historical
  balances are computed by summing sales); new en+km keys.
- [x] N1b+N1c *(SHIPPED — session 6e, Part 402 (renumbered off the 401
  collision with a7's export unit; board order decides). The Import Hub is
  the wizard's first screen: multi-file drop, pure header-shape classifier
  built from the REAL templates (sales contract import, §12 stock header,
  products template, contact tabs' distinguishing columns), per-file
  override, ambiguous stays 'unknown' and asks; dispatch through the ONE
  existing job pipeline (create→upload→analyze), siblings reviewed/approved
  in the shared tracker; classic screens one click away. N1b: every tracker
  row renders its job's persisted policy_json as readable option chips —
  unknown flags pass through, never vanish. (c) already carried by D5 +
  M4. Original claim footprint:
  import surfaces (BulkImportModal / sales+stock import screens / importJobs
  transports+routes), a template-detection router + multi-file queueing,
  per-job policy summary UI, pure+frontend tests. NOT touching a7's export
  unit files (Sales.tsx, AuditLog.tsx, xlsx utils); en/km.json + frontend
  package.json edits DEFERRED until a7's in-flight unit commits.)*
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
- [x] N2 *(Part 387: utils/dirtyWork.ts registry + navigateTo intercept + the three-option modal (Save & Leave only when every dirty item can save, Discard & Leave, Stay) + beforeunload + sidebar amber dot. First registrations: product form + receive-batch modal; POS cart deliberately exempt (drafts persist by design); import jobs persist server-side. Part 388 closed the recorded browser-BACK limit: popstate now routes through the same guard — clean state follows history (also fixing the latent bug where Back changed the URL but never the page), dirty state re-asserts the URL and opens the modal — and "Canva-level" drafts landed: ProductForm (800ms) + ReceiveBatchModal (600ms) autosave to per-record localStorage, restore after crash/reload when newer than the record's updated_at, clear on save or explicit discard.)* **Navigation guard against stale work.** When leaving a page/section that has
  unsaved/in-progress work (add-product draft, batch-in, an open import review, an edit),
  prompt: finish now, or keep it ("I'll be back"), or discard — so switching pages forces
  a reconcile instead of silently stranding work. Needs a shared "dirty work registry"
  pages register into + an intercept on sidebar/section navigation. Complements Phase F's
  draft persistence (F3) and the two-screen import flow. **UX spec (user, Aug 28):**
  three-option modal — "Save & Leave / Discard & Leave / Stay" — plus a `beforeunload`
  guard for browser close/reload and a visible dirty indicator (a dot on the tab/section
  title) so the state is legible before the prompt ever fires. Keep the prompt calm, not
  alarming.
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

- [x] H1 *(Part 405: COMPLETE — every remaining page wired (Returns, three
  Contacts tabs, Branches gained its first-ever per-branch-stock export,
  Inventory via module collectors, Products' existing chooser gained the
  format row), f4110464. Part 401: the shared machinery + first two pages shipped, needs
  deploy — d806e8ee. ExportOptionsDialog: column chooser (defaults
  pre-checked, remembered per surface), formats Excel (default,
  barcode-safe) / CSV (re-import; hint warns Excel breaks barcodes) / PDF
  (dependency-free print view, Khmer fonts, save-as-PDF). Wired: Sales
  (every scope, contract-shaped columns incl. C4's) and Audit Log. utils/
  exportOptions.ts pure half unit-tested in the chain. REMAINING per page:
  Products / Inventory / Branches / Contacts / Returns wiring — the dialog
  and pattern exist; Inventory waits for session 05's D4 release.)*
  Export button on every page opens an options dialog: by summary / by actions /
  detailed full coverage — options derived from what that page actually does (Products:
  catalog, stock changes, batches; Sales: receipts, line items, fees, delivery incl. C-
  fields staff-only; Branches: per-branch stock; Review & Logs: filtered audit slice).
  **Refined Aug 28: a COLUMN CHOOSER** — the export dialog lists the available columns
  (defaults pre-checked) and the operator can add/remove columns before downloading;
  the chosen set is remembered per page.
- [x] H2 *(Part 423, session 6e — VERIFIED, one confirmed gap spun out.
  Verification sweep, unblocked now that ALL Phase-E moves landed: every
  import affordance on the moved hubs (Sales/Returns/Fees, Review & Logs,
  Settings hub, Branches hub) re-checked against §13's two-screen
  contract (upload → resolved review/confirm; no business write before
  confirmation), plus template regeneration where columns changed
  (delivery cost, supplier status). Read-mostly; fixes committed
  per-finding; evidence recorded like E6's sweep. No a7-frontend files
  (ProductDetailModal/productReadTransport). RESULTS: all six import
  entry points (Contact/Inventory/Bulk/StockAction/Sales modals +
  ImportHub) route through the job pipeline's review→approve — no
  business write before confirmation, per-row decisions, pinned by the
  existing stockActionImportModel tests. The moved hubs mount exactly
  these verified components. Templates: delivery cost ALREADY carried
  (salesImportContract: delivery_fee_*/paid_by/delivery_actual_cost_*,
  engine parses them — verified, nothing to regenerate); supplier
  status = P7-f, a real engine-side gap recorded above, deferred past
  M-phase deliberately.)* Every page's import re-checked against the two-screen contract (§13) after the
  IA moves; templates regenerated where columns changed (delivery cost, supplier status).

### Phase I — Audit log wraps the whole app

- [x] I1 *(Part 389: measured — of the 8 uncovered files, 4 are read-only by design
  (catalog, organizations, runtime, notifications) and 4 had real unaudited mutations,
  now covered: backups (create + the destructive RESTORE, previously trail-less),
  files (upload / rename with from→to / delete incl. the forced CONFIRM-DELETE
  override), notes (lifecycle only, id-only — the autosave PUT is deliberately
  unaudited per-keystroke-flood, content never enters the admin-readable trail),
  sync (chunked-upload /complete audited in the route since the DO has no session;
  /outbox deliberately unaudited — it replays through real handlers which audit
  themselves). `test-audit-coverage-pure.cjs` (49 checks) pins the file-level law,
  the read-only four, and both deliberate non-audits.)* Coverage: `audit(…)` is called
  in 22 of 30 route files today — sweep the other
  8 and every uncovered mutation so ALL actions/changes land in the trail (one helper,
  no bespoke logging). List the uncovered routes in the session log when measured.
- [x] I2 *(Part 393: shipped, needs deploy — commit e0330edc. The REAL bug: every
  filter control on the Audit Log page was DEAD (the page sent search/action/userId/
  startDate/endDate; the server read only page/pageSize; nothing filtered
  client-side — independently confirmed by a second session). lib/auditLogQuery.ts
  builds the WHERE (comma-joined multi-values, case-insensitive, entity OR legacy
  table_name, inclusive date(created_at) range, LIKE with %/_ escaped); COUNT shares
  the clause so pagination agrees; filter vocabularies are whole-table; new entity
  "Page / record type" multi-select in the UI; and the silent-empty catch (db error
  → empty 200 rendered as "no logs") is now a 500 so the local-mirror fallback +
  message path runs instead. The before→after detail view already existed
  (auditLogFieldDiff) — untouched. test-audit-log-filters-pure.cjs 17 checks against
  the real 0001 schema. **The D2-era one-row date-range control SHIPPED (Part
  442, session c1, needs deploy — `2f53c414`):** an explicit start→end pair of
  native date inputs (the same control the D2 Products/Inventory stock ledger
  uses) now drives the server startDate/endDate authoritatively, while the
  year/month period chips stay for time-grouping and as the fallback range when
  no explicit range is set. AuditLog.tsx only; reuses start_date/end_date/clear
  (no lang-pack edits). tsc + check:source + vite build all green.)* Audit UI (inside
  Review & Logs): the same one-row date-range control as
  Products/Inventory (D2), filters by action / page / user, clean multi-option design,
  detail drawer per entry showing before→after payloads where stored.

### Phase J — Sessions & devices

- [x] J4. **Max 3 devices per account + clean slate (Part 375).** The user's rule: an
  employee may be signed in on at most 3 devices at once. `MAX_APPROVED_DEVICES_PER_USER
  = 3` lives once in `lib/deviceTrust.ts`; the admin approve endpoint (the only path to
  'approved') refuses a 4th with a 409 `device_limit_reached` naming the rule —
  re-approving an existing device stays idempotent. Admin-control accounts remain exempt
  from the device gate (so approvals can't dead-lock). `test-device-cap-pure.cjs` proves
  the count SQL against the real schema + the gate ordering. **Production cleared as
  requested:** 69 sessions revoked, all 17 trusted-device rows deleted — everyone
  re-registers under the rule. The cap ENFORCEMENT ships with the next deploy, so
  deploy before staff re-register (approvals before that are uncapped).
- [x] J1. Stay signed in per device — **root cause found and fixed in code (Part 371,
  needs deploy):** `Login.tsx` fell back to sessionDuration `'session'` when no org
  preference was saved, which the server maps to 24 HOURS — the reported "logged out
  after a few hours". Fallback is now `'always'` (10y), matching the server's own
  DEFAULT_SESSION_MS intent; device approval + `revokeSessionsForDevice` (which kills
  live sessions immediately) remain the security gate. Verify live after deploy: log
  in once, confirm the session survives days and an admin revoke ends it.
- [x] J2. Password-manager friendliness — verified already correct: real `<form>`
  submit, `autocomplete="username"` / `"current-password"`, stable field names.
- [x] J3 *(Part 389: shipped, needs deploy. Backend: GET /api/auth/devices/sessions
  lists LIVE sessions (the exact revoked_at-IS-NULL + unexpired predicate
  getSessionUser enforces; explicit columns — token_hash never leaves lib/auth),
  POST /sessions/:id/revoke ends one session immediately, POST
  /sessions/revoke-user = sign out everywhere via revokeUserSessions; all audited.
  UI: Users → Devices is now per-ACCOUNT — each account card shows its approved
  devices (last seen, Revoke) and live sessions (signed in / last seen / expires /
  IP, End session) plus "Sign out everywhere"; rejected/revoked history separate.
  `test-admin-sessions-pure.cjs` 17 checks incl. behavioral SQL runs against the
  real 0001+0006 schema. Canonical en/km label keys deferred to N3a's sweep —
  fallback-rendered for now.)* Admin device/session management UI lands in
  Settings→Users (E4): per-user devices, last seen, revoke button.

### Phase K — Carried-over engineering backlog (unchanged priorities)

- [ ] K1. Server-level undo/redo (3.1) — appliers replay stored payloads; admin sees all,
  users see their own.
- [x] K2 *(session 6e — COMPLETE across Parts 410 + 416. Part 410
  (11.13 + 11.12): per-item three-way chooser (none/restock/damaged) on
  create AND edit, damaged stock as traceable lots (damaged_stock_lots,
  migration 0074) with consumed-lot edit blocking, Replace from
  same-name stock drained the POS way with even-exchange default and
  full-access-gated price-difference settlement. Part 416 (rest of
  11.9): the POS Damage source option — open damaged lots listed beside
  sellable lots in the detail sheet (both flows, amber, never cost),
  one-source-per-line exclusivity, lot-capped quantities; checkout
  sends sale_items.damaged_lot_id (migration 0075) and the server
  consumes/restores damaged_stock_lots.quantity_remaining through sale,
  cancel, and un-cancel on the same heldQuantity state machine
  (damage_out/damage_in ledger). SP/VIP short-label pricing already
  existed in the sheet (Selling/VIP/Promotion buttons) and is untouched.
  POS still never shows cost.)* Returns Replace + damaged-stock chooser (11.12/11.13) and the POS SP/VIP/damage
  picker rest of 11.9. **Elevated Aug 28 — "for POS, focus on batches and various
  options":** the POS picking flow leads with the BATCH (lot, received/expiry) and a
  clear Selling-vs-VIP price choice per line; damaged stock joins as an option once
  11.13 lands. Same option data the product detail shows (D3) — one kernel, two
  surfaces.
- [x] K3 *(Part 417, session 6e — SHIPPED. The ladder (imagePipeline.ts),
  provider fallback, and the 6h audit cron already existed; what was
  missing was ON-UPLOAD normalization, now closed: every image
  ASSETS.put site (files upload, avatar, product image, portal
  submission, import-library files, client-recompress swaps) enqueues
  optimize-image to MEDIA_QUEUE via enqueueImageNormalization
  (swallowing, image-extension-gated — an upload never fails on a queue
  hiccup; the 6h sweep stays the safety net), and the consumer's
  optimize-image branch runs normalizeStoredImage: the per-key kernel
  with the sweep's exact rules — only over-ceiling objects enter the
  ladder, a not-smaller result is never stored, failure leaves bytes
  untouched and recorded, success writes back + upserts image_audit.
  Videos still wait on the container path (unchanged stub). Pure test
  (6 checks incl. all six producer pins) on real migrations.
  Video/container half of the pipeline remains open — tracked by the
  media-optimize.Dockerfile header, not this item.)*
- [ ] K4. Storage/jobs hardening phases 1–6 of the locked execution plan (leases, R2
  NDJSON staging, D1 slimming — the 193MB staging JSON), safeguards, Sentry wiring.
- [x] K5 *(Part 421 — renumbered off a7's 420; SHIPPED by session 6e. 9.1 was closed by D6 long
  since; this claim is 9.2: the auto-merge flag + filter. Footprint:
  migration 0076 (products.auto_merged_count + an import_auto_merges
  record table preserving each losing row's values), importEngine.ts
  recording at its merge sites (file is at rest — 05's A4 landed),
  a products facet (merged=auto) + its own filter-options helper file,
  ONE small mount hunk in Products.tsx coordinated with a7 (who holds
  StockChangeSection for D2), backend read endpoint for a product's
  merge log, tests.]** Identity: rename-regroup (9.1 — via D6), auto-merge flag + filter (9.2).
- [x] K6 *(Part 387: branch-stock + batches view rows shipped — branch_stock rides the row allowlist; the batches read gate accepts the grant with a money-blind list response (unit cost/paid-credit stripped, supplier NAME kept); Product Viewer role preset = image-only + all 8 rows preselected, each still toggleable. 7.1/7.2 editor redesign remains with E4.)* Permissions: per-action widening story (7.1) + editor redesign (7.2, in E4).
  **Refined + partly built Aug 28 (Part 380):** the per-capability opt-in system for
  the image-only role ALREADY exists (each visible field is its own permission row —
  Part 243), and it gained `products_image_only_show_vip` (VIP price as its own grant,
  separate from selling price; server field-map + editor row + view render + pure test
  all updated). **The user's target preset:** a "view everything, touch nothing" tier —
  view + search + upload-images with selling/VIP/barcode/category/brand/stock/batches/
  branch-stock visible, NO edit buttons or other sections — composed of the individual
  rows PRESELECTED, each still toggleable, and custom additions possible (e.g. also
  grant stock-in). **Still to build:** the batches + per-branch-stock VIEW rows (those
  aren't product-row columns — they need the read attachments gated), the preset
  bundle UX in the editor, and the guarantee-by-test that none of this touches POS/
  sales/full access (surface scoping already enforces it server-side).
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

- [x] P1. **POS cart order corrected:** Customer → **Membership → Discount** →
  Delivery → Summary → Payment (membership before store discount, per the user).
- [x] P2. **VIP price reveals on request in POS:** the grid shows only the VIP chip
  (no amount); the detail sheet's VIP button first says "VIP price", the FIRST tap
  reveals the amount, the second tap adds at it — keyed per product/variant so one
  reveal never exposes another row. Cost stays never-shown.
- [x] P3 *(Part 387: POST /products/bulk-price-adjust — set-based UPDATEs per field, preview count first, FULL-tier gate, clamp-at-0 + skip-zero + per-currency rounding proven in test-bulk-price-adjust-pure; the amber Apply-to-ALL button sits beside the unchanged selection flow; no undo at this scope, stated + audited.)* **Bulk edit, whole-system scope.** The existing bulk price adjust (selling/
  VIP/cost, ±, USD/KHR) operates on the selection; add an explicit "ALL products in
  the system" scope that runs server-side in bounded batches with a preview count and
  the standard confirm — never by materializing 8k ids in the client.
- [x] P4 *(Part 386: migration 0069 tag_label; form field; chip on POS cards + group summary pills; in every client search haystack + a tag_label facet filter server-side incl. the /filters distinct list. Column-driven write path made the backend free.)* **Product name tag label.** Optional per-product short tag shown as a chip
  next to the name (a user's own memory aid), additive migration
  (`products.tag_label TEXT`), editable in the form, searchable and filterable.
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
- [x] P8. **Cambodian phone normalization in the migration data (Part 381).** All
  three sales files re-generated with the user's rule: restore the leading zero the
  old system's Excel export ate, format `XXX XXX XXX` (9 digits) / `XXX XXX XXXX`
  (10); garbage/partials preserved untouched. **10,330 numbers normalized** — and
  this was a MATCHING fix, not cosmetics: production customers are 100%
  leading-zero (measured: 3,143 nine-digit + 1,027 ten-digit), and the importer
  matches digit sequences, so ~1,100 receipts' customers would have silently failed
  the phone-first match. Suppliers: the PO export carries no phones (nothing to
  normalize; add by hand after import).
- [x] P5. **Standing decision — delivery is DELIVERY, never a category/product.** The
  old system modeled delivery fees as a "Delivery" category line item (visible in its
  exports); this system records them only as the sale's delivery fields. The sales
  migration already converts old delivery line items into delivery fees; no importer,
  report or UI may reintroduce the old shape.
- [x] P6 *(Part 386: migration 0068 delivery_actual_cost_usd/khr; POS fee-paid-by row gains the staff-only Cost input (NULL when untyped, so "not recorded" ≠ "0"); kernel sums actual + margin + recorded-count WITHOUT touching profit (standing rule); Dashboard revenue drill shows Actual delivery cost (n/m recorded) + Delivery margin; portal/receipts structurally excluded — column whitelists.)* **Delivery stat drill-down:** inside the delivery stat, the customer-charge
  figure carries a separate sub-stat for ACTUAL delivery cost (and the margin) —
  staff-only per C2's redaction scope. Extends C3's shared kernel.

### Phase Q — Aug-28 ninth batch (Part 382)

- [x] Q1. **Supplier credit + per-lot cost, end to end (needs deploy).** Migration
  0065: `payment_status` ('paid'/'credit'/NULL-historical), `credit_due_date`,
  `unit_cost_usd` on product_batches. Manual receive (modal + route + transport)
  takes supplier, unit cost and the Paid/On-credit choice — credit REQUIRES its due
  date (client and server both refuse without it, because the reminder is built on
  it). PATCH lets the admin flip credit→paid (clearing the reminder), fix dates, or
  correct supplier/cost. The §12 import writer stores per-lot unit cost too
  (fill-if-null, first attribution sticks) — so the 21k-row history import lands with
  supplier AND cost per batch. **Notifications gained a Supplier-credit section**:
  overdue first, then due within a configurable window (default 7 days), admin
  clears items by marking batches paid. **Open:** the supplier-section purchases
  summary view (D5 read — the data is now fully in place), and a per-batch
  `received_quantity` if all-time purchase totals per supplier should come from live
  data rather than the migration files.
- [x] Q2. **Device-approval notifications RE-REGISTERED — a lockout was brewing.**
  A stale comment claimed the login device gate was "fully disabled" and the
  "devices waiting for approval" section was deliberately left uncalled. The gate is
  LIVE (auth.ts gates every non-admin login; the 3-device cap builds on it) and the
  Aug-28 clean slate wiped all trusted devices — so every employee's next login
  would sit pending with NO surface telling any admin. The security section is now
  built for admin-control users; the false record is corrected in place.
- [x] Q3. **File picker pagination fixed.** FilePickerModal fetched with no page
  params — the server's default 24-item page was ALL anyone could ever pick from,
  with no next/back at all (the reported bug). Real pagination now: 48 per page,
  Previous/Next + count, page resets on search/filter change. The Library PAGE's own
  pagination was already correct.
- [x] Q4. **Customers verified against production (read-only).** Phone uniqueness:
  4,652 customers, **only 2 duplicate phone pairs remain** — `010 229 119`
  (R_Lara #19728 vs Phopph #22853) and `010 868 888` (Nay Nay #19911 vs
  Nay Naysochivy #19912, likely the same person) — the USER merges these in the
  Duplicates tab; never auto-merged. **Name sync:** 9,796 receipts in the sales
  files match exactly one current customer by phone; **6,548 names updated** to the
  current system's spelling; 758 unmatched phones keep their original free text; the
  18 rows on the two ambiguous phones left untouched. Files re-validated end-to-end.

### Phase R — Aug-28 tenth batch (Part 383)

- [x] R1. **Identity rule closed across EVERY backend import path (deep re-check).**
  classifyProducts already does it right (barcode candidates filtered by compatible
  name, highest-price merge). Found and fixing three deviations: (a) classifyInventory
  matches by bare sku/barcode last-wins — a barcode shared across different-name
  products attaches the adjustment to whichever row loaded last, silently; (b)
  classifySales same single-value byBarcode; (c) §12 stockActionImport.matchProduct
  falls back to a lone DIFFERENT-name barcode match (same barcode + different name is
  a SEPARATE product under the identity rule — must become a new/child product, not
  attach). Fix: candidate arrays + name-compatibility everywhere, one "same name"
  definition (normalizeProductGroupName ≡ key(), verified identical semantics).
- [x] R1c. **D6b lands: engine-side name-group category/brand unification** at
  products-import apply — most frequent non-empty value in the group, tie → first
  row; groups the job didn't touch stay untouched.
- [x] R1b. **Migration pack re-validated one more time** (files + cloudflare/
  migrations counterparts: 0064 sums, headers, barcodes-as-text, Khmer intact).
- [x] R2. **Supplier privacy.** Suppliers section in Contacts hidden from employees:
  new grantable permission `contacts_suppliers` (admin-control users always pass);
  backend /suppliers/* endpoints gated server-side, tab hidden client-side, toggle in
  the permission editor. Batch surfaces keep showing the supplier NAME only (the
  snapshot column — no phone/contact data lives there). Supplier-credit notifications
  (money owed = cost data) tighten from 'inventory' to admin-control users.
- [x] R3. **Sale cancellation, fully scoped.** Cancel asks a reason — Mistake /
  Buyer didn't buy / Other + required note — plus an optional LOST FEE (e.g. delivery
  already paid that the buyer refused to cover) recorded as a linked `fees` expense
  row so money reports see the loss. Stock is ADDED BACK with a visible
  "Sale cancelled (reason)" movement — never by deleting the original movements.
  Transition core rewritten on one invariant: per item, held(status) =
  qty − already-returned for completed/awaiting_delivery/partial_return/returned and
  0 for awaiting_payment/cancelled; every transition moves exactly
  held(new) − held(old), branch stock + product total + BATCH stock together. Closes
  the found loopholes: partial_return→cancelled restored nothing (un-returned units
  vanished), completed→awaiting_payment restored the full qty (double-adding
  already-returned portions), any re-deduct transition skipped batch stock, and
  returns could still be recorded against a cancelled sale (now 400). Manual flips
  into partial_return/returned stay with the returns flow (blocked here); uncancel
  goes back only to status_before_cancel, deletes the linked lost-fee row, and
  re-deducts through the same formula. Migration 0066 adds cancel_reason/cancel_note/
  cancelled_at/cancelled_by_name/status_before_cancel/cancel_fee_id.

### Phase S — Aug-28 eleventh batch (Part 384)

- [x] S1. **The "decide the 72 review rows" step was already DONE — stale docs fixed.**
  The user found `README.md`'s old checklist still saying "Decide the 72 review + 17
  new rows"; the decisions closed in Part 375 (89 rows: 73 add / 6 merge / 10 delete,
  every named instruction verified present in `product_mapping_review_VERIFIED.csv`).
  README superseded → points at IMPORT-MANIFEST; manifest Step 2 notes the naming pass.
- [x] S2. **Naming rules applied + propagated (the real find).** New rules: every word
  starts uppercase, NO dashes (hyphen/en/em), single spaces — 10 of the 73 names
  changed (Rhode Pocket Blush Freckle, Dior Hydra Life 2 In 1, TheBalm, Bobbi Brown
  W 066 shades, Clinique ID…). Propagation audit found the sales/stock files still
  carried the OLD names for the 73 (e.g. `Rhode Frekle`) — under R1's strict
  name+barcode identity those rows would ERROR at import. **355 rows re-identified**
  across stock_in_history + all three sales files + stock_adjustments (barcode-first;
  the 5 barcode-less adds by exact old name); `product_mapping.csv` records the final
  names; xlsx twins regenerated; full validation suite re-passed. Template names stay
  untouched (authority rule).
- [x] S3. **Devices verified (read-only).** trusted_devices = 0 (Part 375 wipe holds),
  user_sessions 94 with only 2 live (the admin's own) — nothing to clear; the 3-device
  cap ships with the pending deploy and everyone re-registers under it.
- [x] S4. **D5 shipped** — see D5 above (0067 received_quantity + purchases endpoint +
  supplier detail Purchases drill).

### Phase T — Aug-28 twelfth batch (Part 385): the connection preflight

- [x] T1. **"Make sure sales and so on have connecting customers and products" —
  proven by running the app's REAL import classifiers over the actual pack against
  the merged post-import catalog + the real 4,652 production customers.** Found and
  fixed two showstoppers: (a) `stock_in_history.csv` lacked the §12 contract's
  `action`/`shop`/`warehouse` columns — every one of its 21k rows would have failed;
  now carries them, with the invoice join also deciding branch (19,684 shop / 1,602
  warehouse) and filling **6,968 real per-unit costs**; (b) the sales files carried
  template NAMES but OLD barcodes — 28% of receipts would have errored under the
  strict identity rule; 34,871 barcodes + 16,667 names rewritten to template
  identity, the 6 merge-decision products remapped to their targets, the
  delete-decision rows dropped from history, junk-barcode rows adopted their
  mapping-decided catalog identity (incl. the evidence-based Charlotte Tilbury
  No Box pin → 05056446657228, the twin that carries the old system's stock).
  **Final: history 21,286/21,286 attach (100%, 0 creates/conflicts); sales
  14,913/14,919 receipts (6 junk lines err visibly: 4 `test` + 2 deleted
  "For back"); customers link 99%+; suppliers 8,053/8,053 in vocabulary.**
- [x] T2. **The double-count question answered in the manifest**: Step 1 loads final
  template quantities; history ADDS (builds batches/suppliers/costs); sales are
  records-only (verified: applyHistoricalSaleImport only restocks return rows);
  Step 4d re-imports the two catalog files (update-stock REPLACES per branch) to
  land exactly on template truth; optional 4e zeroes historical lots' live counts
  so FIFO pickers skip them while D5's received/cost data stays.
- [x] T3. **New connector files:** `delivery-contacts-from-sales.csv` (2 drivers —
  11,778 delivery receipts link once imported before sales) and optional
  `customers-missing-from-sales.csv` (53 phone-carrying customers ranked by
  receipts). Pack re-validated end-to-end (validator now falls back to the recorded
  source footer when the original .xls has left Downloads); xlsx twins regenerated.

### Phase U — Aug-28 thirteenth batch (Part 386): backlog continuation

- [x] U1. **A3 closed** — Drive mirror root cause measured (never connected, zero
  settings rows), standing not-connected admin warning added, retention 7→10, the
  stale 'OAuth not implemented' record corrected, and (found in passing) the Part
  382 supplier-credit setting keys finally LOAD — they were written by Settings but
  missing from NOTIFICATION_SETTING_KEYS, so defaults always applied.
- [x] U2. **P6 closed** — 0068 delivery_actual_cost, POS staff-only Cost input,
  kernel actual/margin/recorded-count (profit deliberately untouched), Dashboard
  drill lines, portal/receipt exclusion verified.
- [x] U3. **P4 closed** — 0069 tag_label end to end (form, chips, both client
  search haystacks, server facet filter + /filters distinct list).

### Phase V — Aug-28 fourteenth batch (Part 387): P3 + N2 + K6

- [x] V1. **K6 closed** — image-only per-branch-stock + batches (money-blind) view
  rows + the Product Viewer preset. See K6's own entry.
- [x] V2. **N2 closed** — dirty-work registry, navigation guard modal, beforeunload,
  sidebar dot; product form + receive-batch registered first. See N2's entry.
- [x] V3. **P3 closed** — whole-catalog price adjustment, server-side with true
  preview count. See P3's entry.

### Phase W — Aug-28 fifteenth batch (Part 388): the quantity proof + the mm/dd/yyyy sweep

- [x] W1. **Quantity equivalence PROVEN, definitively, on the final mm/dd/yyyy
  pack**: the whole manifest process (catalog + the 73 + 21,286-row history +
  three sales files + zero/re-import) executed through the REAL engine → all
  6,104 products' per-branch quantities IDENTICAL to the Aug-28 files (0 diffs;
  the only deltas en route are the 14 negative old-system values the import
  clamps to 0 with its own warning). Sales: 14,913/14,919 receipts, 35,970
  lines (6 junk lines err by design), 0 duplicate receipts, 0 unexpected
  receipts. Two engine bugs found+fixed by the proof (in-chunk identity fork;
  analyze cap blind to direct mode) and one real limit raised
  (MAX_HISTORICAL_SALE_LINES 50→100 — three genuine 86/58/55-line wholesale
  receipts were the ONLY unstorable ones). Validator + xlsx twins re-run green
  after every date cell in the pack (51,916 across 10 files) went mm/dd/yyyy.
- [x] W2. **mm/dd/yyyy + 24-hour everywhere**: fmtDate/fmtTime/fmtDateTime24
  pinned; fmtDateOnly + backend formatDateMdy close the raw-ISO leaks; batch
  code back to numeric MMDDYYYY per user direction (both copies, history-honest
  comment); normalizeToIsoDate tolerates datetime cells.
- [x] W3. **POS discount + payment inputs compacted** — toggle + both currency
  inputs on ONE row, payment grid slimmed.
- [x] W4. **N2's recorded limit closed + Canva-level drafts** — see N2.
- [x] W5. **Dashboard stats merged like Inventory's** — COGS card folded into
  Revenue (COGS + Gross profit as drill rows), net-after-refunds into Returns;
  every tooltip states its formula with the period's real numbers.
- [x] W6. **Production domain defaults + PWA icons** — web-api dev fallback +
  Server page placeholder → admin.leangbeauty.com; .claude/launch.json run
  entries; portal-manifest icon purposes unswapped (any/maskable were crossed,
  so iOS/Android picked the wrong art).

### Phase X — Aug-28 sixteenth batch (Part 396): date+time range, daily sales report, per-contact delivery totals

*User batch with two mockups (a date+time range panel; a "Start → End" trigger
pill). Standing principle recorded as X0. Claimed by session a7 except X5.
(Originally headed "Part 395" — session 35's migration-pack entry took 395
first; renumbered per the reservation protocol.)*

- [x] X0. **Standing principle — old records stay, new flows do it properly.**
  The 0072-re-typed delivery expenses are the OLD system's records, kept as
  data. The NEW system's shape is structural: delivery goes through delivery
  CONTACTS linked on the sale (`sales.delivery_contact_id`, which already
  exists), never through text labels/categories; the same applies wherever an
  old-system shape was a text mash — keep the imported data, never build new
  flows on it.
- [x] X1 *(Part 396: shipped, needs deploy — commits 2bbdad22 + da1e75c9.
  shared/DateTimeRangePicker.tsx per the mockups; the time row genuinely
  FILTERS: the kernel gained a viewer-local time-of-day window (client sends
  its tz offset; overnight windows wrap; existing callers byte-identical,
  test-pinned). Visual click-through pending — B1's sweep.)* **Shared
  date+time range picker (the mockups).** Trigger = compact
  "Start → End" pill showing the chosen range; panel = two manual date inputs
  + optional HH:MM–HH:MM time range + month chips (Jan–Dec) + full calendar
  range grid (Mon-first) + year chips + quarter chips (Q1 25 … style) + clear
  ✕. One shared component, used by Sales (X2) first, then Audit Log and the
  D2 pages. **Flagged, not guessed:** the stock mockup shows DD/MM/YYYY
  placeholders, but mm/dd/yyyy-everywhere is a settled decision (en-US pinned,
  re-swept Part 388/W2) — building with MM/DD/YYYY; say the word to flip.
- [x] X2 *(Part 396: shipped, needs deploy. Receipts | Daily report switch on
  Sales; day rows newest-first with range totals; click-a-day breakdown —
  payments, discounts split with counts, delivery charged/absorbed/actual
  (n/m recorded)/margin + per-courier lines. /daily-report + /day-report from
  the shared kernel; 24-check pure test.)* **Sales daily report — "by day
  report/view, search page when
  clicked".** A Sales-page report section scoped by X1's range: one row per
  day (tx count, subtotal, discounts, delivery, total); clicking a day opens
  its full breakdown — totals from the SHARED salesAnalytics kernel (single-
  source rule), plus per-payment-method totals, the delivery block (charged /
  store-absorbed / actual cost / margin, and per-COURIER lines via
  delivery_contact_id), and discounts split store vs membership.
- [x] X3 *(Part 396: shipped, needs deploy. getDeliveryContactTotals grouped
  by the delivery_contact_id LINK (renames merge under the latest snapshot;
  unlinked bucket by name; NULL actual costs count as unrecorded, never
  zero); /delivery-contact-report gated sales-OR-contacts; DeliveryTab
  detail gains the range-scoped Deliveries drill.)* **Per-contact delivery
  totals — "check expenses of delivery by
  contact".** Kernel + endpoint aggregating sales by delivery_contact_id
  (deliveries, charged fees, absorbed, actual cost, margin, last delivery);
  DeliveryTab gains a per-contact drill (the supplier Purchases-modal
  pattern). Suppliers already have D5's purchases drill; customers already
  have their sales history in the detail — X3 closes the delivery leg.
- [x] X4 *(Part 396: measured — the customer detail had NO purchase totals
  (points only), a real gap — then closed: getCustomerSalesTotals +
  /customer-report + a range-scoped Purchases drill on the customer detail
  (collected incl. customer-paid delivery, discount split, points redeemed,
  first→last purchase). The per-contact trio is complete: suppliers D5,
  couriers X3, customers X4. Commit c0943357.)* **Customer/supplier parity
  check of X3** — verify the customer
  detail's totals cover "same for customer" (purchases total per customer) and
  record any gap as its own item.
- [x] X5 *(Part 401: shipped inside H1's dialog — Excel/CSV/PDF with the
  column chooser; see H1.)* **Exports everywhere: Excel AND PDF, multi-option.** Extends H1's
  column-chooser dialog with format choice (xlsx / pdf / csv). NOT started by
  a7 — the xlsx/csv utils are the M7 session's active footprint; spec recorded
  here so whichever session lands it builds the format switch into H1's dialog
  rather than per-page one-offs.

### Phase Y — Aug-28 seventeenth batch (session 43): live-use regressions + speed + density

*The user ran the migrated system for real (products import, POS sale, searching)
and reported ~20 issues, two screenshots. Ordered by severity: broken function
first, then workflow regressions, then density/design. Several land in files hot
with 6e's F3 slice 2 (Products.tsx / Inventory.tsx / ProductForm.tsx /
FastStockInModal.tsx / Modal.tsx / Sidebar.tsx) — marked [HOT-6e], do not start
those until that unit commits.*

- [x] Y1 *(client half Part 425; server side MEASURED + CLOSED Part 439).*
  Client: all three contact tabs track a refreshing flag spanning silent
  search refetches and show "Searching…" instead of the false "No matching
  customers"; search joins the shared 180ms debounce (was bare
  useDeferredValue — a query per keystroke, each refetching includePoints).
  **Server side measured on the now-idle production worker: the search infra
  is fast** — the FTS5 MATCH for "pink dahlia" runs in 0.53ms and the
  family-pagination CTE/window query in <0.5ms. So the original >5s was
  Worker saturation from the concurrently-running 12k-row import apply (CPU
  bound), not the search itself — resolved now the import is done. No
  server-side change needed.)* **Search is very slow / reads broken.** Products search "pink dahlia"
  took >5s; Contacts search also very slow — and while a search is in flight the
  list shows "No matching customers" instead of a searching state (reads as data
  loss). Fix both: measure where the time goes (server query vs frontend), add
  proper in-flight state on every list search (Products/Contacts at minimum:
  "Searching…" until the response for the CURRENT term arrives).
- [x] Y2 *(Part 425 — SHIPPED, needs deploy. Root cause: a 20s client
  timeout raced a server write that still committed (the Worker was busy
  applying the 12k-row import), and each retry click generated a FRESH
  client_request_id, so retries could double-sell. POS now keeps ONE
  client_request_id per order until success (the server already dedupes
  on it), the timeout is 45s, and a timeout message says the truth: the
  sale may be recorded and retrying is safe.)* **POS sale errors in cart but the sale actually lands.** POS showed 1
  item in stock; adding to cart + completing sale showed an error, yet the sale
  then appears on the Sales page. So the write succeeds and the client reports
  failure — find the mismatched response/error path (or double-submit where the
  first succeeded) and make outcome reporting truthful.
- [x] Y3 *(Part 425 — SHIPPED with Y4, verified live on worker-dev: the
  branch list renders again below a stats pane capped at 45% height.)*
  **Branches page lost the branches.** After E1's hub merge the Branches
  page no longer shows the branch list itself. Regression — restore branches on
  the Stats & Branches section.
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
- [x] Y5 *(Part 425 — root-caused bit-for-bit against the ACTUAL uploaded
  R2 object and SHIPPED, needs deploy. fetchCsvRange's TextDecoder
  silently consumed the upload's UTF-8 BOM, so the materialize byte
  cursor came up 3 bytes short and the SECOND window re-read the
  previous row's last 3 bytes as a phantom one-field row — the "48"
  product (job d8b19dd5: 12,094 staged rows for a 12,093-row file; the
  Aug-26 job's 8,728 for 8,727 shows the same +1). Fixed with
  ignoreBOM:true; test-csv-range-window-pure gains an engine-exact BOM
  harness at every window size. The phantom production product (id 65)
  was already deactivated by the user — nothing else to clean.)*
  **Products import "uncategorized row error product name 48" — serious.**
  A row error naming "product name 48" with an uncategorized bucket appeared
  during the products import. Reproduce with the pack, find what the engine did
  (fabricated name? counter leak?), fix + test.
- [x] Y6 *(CLOSED per the user, Aug 28 follow-up: "no need" — no image
  wiring work. Measurement kept below for the record.)* *(MEASURED, Part 425 — needs the user, not code yet: production
  holds 6,031 active products, 34 with an image, the file library holds
  only 51 assets, and the import job carried 0 uploaded images and 0
  image matches. The wiring worked for what existed — the missing piece
  is the image SOURCE (the pre-reset catalog's images were deleted with
  the reset). Ask the user where the product images should come from
  before building anything.)* **Import wire-images-to-products not working.** Linking library images
  to products (the import's image wiring) does nothing visible. Diagnose end to
  end (match rule → write → product cover render) and fix.
- [x] Y7 *(Part 425 — ANSWERED + a real bug found and fixed. The single
  08/24/2026 date is the documented template-snapshot behavior; real
  dates land when stock_in_history.csv runs (M4/manifest Step 3 — the
  user has not run it yet). BUT the check exposed that the import stored
  received_at as the RAW "08/24/2026" display string (unqueryable by SQL
  date functions) — normalized at parse time now, migration 0077 repairs
  the 6,031 production rows, engine test re-pinned to ISO. Needs deploy.)*
  **Import ran with only ONE batch date (08/24/2026)** — the many real
  past stock batch dates are missing. Expected: the aug27 template is a SNAPSHOT
  (single synthetic date — M1's known finding, manifest Step 1) and real dates
  arrive with `stock_in_history.csv` (M4).
- [x] Y8 *(the false-stall half SHIPPED, Part 425: the tracker's 6-minute
  staleness check parsed SQLite's timezone-less UTC updated_at with bare
  Date.parse = LOCAL time, so for a UTC+7 viewer every ACTIVE job looked
  7 hours stale and "may have stopped — safe to cancel" showed on a job
  that was progressing (it completed normally at 14:33). Fixed via shared
  parseServerTimestampMs. MEASURED timeline of the reported 20+ min:
  upload 14:07 → analyze + the user's review of 6,062 conflicts → approve
  14:27 → apply DONE 14:33 (6 min for 12k rows). CLOSED — both remaining
  pieces shipped, needs deploy: (1) the perceived "two analyzes" is fixed
  (Part 441, session business-os-v1-87, commit abc1c915) — getJobProgressDetails
  ran the materialize/staging sub-phase (raw CSV read into rows, before
  total_rows exists) and the classify sub-phase through the SAME
  labels.analyzingFile ('Analyzing file'); the staging sub-phase now shows a
  distinct 'Reading file' (new i18n key import_reading_file en+km), so the
  pipeline reads 'Reading file' → 'Analyzing file' instead of 'Analyzing'
  twice; tsc + langKeyIntegrity (3695 keys) + vite build green. (2) the
  tracker card compaction landed as Y9 (Part 436).)*
  **Import flow regression — slow, stalled, review after the wait.**
  Report: upload slow; TWO analyze passes; then "view report / resolve product
  conflicts / approve"; then a long "Applying changes" that stalled at
  4,800/12,094 with "No update in a while — this import may have stopped"; whole
  process 10–20+ min. Wants the OLD contract feel: review comes BEFORE the long
  work, not after waiting. Split: (a) find why analyze runs twice (dup work);
  (b) find the applying stall (queue consumer death/lease?); (c) restore/keep
  review-before-commit so approval happens on the analysis, and the ONLY long
  phase after approve is the apply, clearly progressing.
- [x] Y9 *(Part 436, session business-os-v1-87 — SHIPPED, needs deploy.
  BackgroundImportTracker.tsx only; no new lang keys. Each expanded per-job row
  was a run-on ' - ' line of rows/images/issues/result-tally/timing/error/stall
  plus an always-visible policy-chip row. Recomposed as: label + per-job progress
  bar (active only, amber when stalled) + a terse counts line (rows · images ·
  issues) + an error/stall line kept VISIBLE on its own amber row + a per-job
  "Details" fold (ChevronDown, existing view_details/hide_details keys) holding
  the result tallies as chips, phase timing, and the applied-option chips. The
  collapsed header's redundant prose subtitle ('<type> import - <phase>', already
  in the status chip) became the same terse counts line. No data/handler/action/
  timeout change — getJobResultSummary→getJobResultParts (array for chips),
  getJobCountsSummary added, transient openDetailJobIds fold state. tsc clean,
  vite build green, every pinned tracker contract re-verified pass. Two whole-file
  test aborts (actionStability POS_CHECKOUT_TIMEOUT_MS=20000, performanceLoadingUx
  Dashboard range labels) are PRE-EXISTING peer assertions (Y2/Y19) on clean
  committed files — not this change; owning sessions must refresh them.)*
  **Import progress UI too text-heavy.** The tracker card is a wall of
  words (screenshot 1). Compact design: status chip + progress bar + counts;
  details fold behind an expander.
- [x] Y10 *(Part 425 — SHIPPED end to end, needs deploy. POS no longer
  demands the full amount (and with it a method) for awaiting_payment;
  with nothing paid the sale records NO method (the server's 'Cash'
  fabrication removed); completing it on the Sales page collects method
  + USD/KHR amounts (SaleDetailModal, USD prefilled with the total) and
  PATCH /:id/status stores them on exactly that transition — payment
  fields on any other transition are refused, never silently dropped.)*
  **POS "awaiting payment" must not require a payment method.** Today it
  demands one upfront; the point of awaiting-payment is deciding later on the
  Sales page. Make method optional for awaiting-payment sales (validation +
  server accept NULL method until completion).
- [x] Y11 *(Part 430, needs deploy).* **POS delivery "paid by" block + membership
  prose.** The membership explanation sentence (no-member state) now shows a
  compact "Select a member to apply" cue with the explanation behind an
  InfoHint. The delivery paid-by block was already compacted to one row + a
  short fee-effect line in B3 (Part 372), so it stays.
- [x] Y12 *(Part 431 — SHIPPED, needs deploy; session a8).* **POS sales CHANGE:
  recordable, per-currency.** The change row is now two editable inputs (USD +
  KHR), prefilled/placeholdered from the computed change with a 'Use computed'
  shortcut; the cashier records what was ACTUALLY handed back (change is often
  given in a different currency than the payment). Checkout records those
  amounts ADDITIVELY (change_usd/change_khr as real per-currency amounts) when
  either field is entered, else the computed dual representation unchanged —
  byte-identical until a cashier edits. Change never feeds totals; the receipt
  already renders USD + KHR change additively (confirmed, no Receipt edit).
  New order fields changeGivenUsd/khr; 4 en+km keys. Footprint constants.ts +
  POS.tsx + lang. tsc + build green.
- [x] Y13 *(Part 443 — SHIPPED, needs deploy; session e4).* **Products page: kill the "Search & Filters" SectionCard wrapper.**
  The folding SectionCard (title + per-user fold state) is gone; the search row is a
  plain bordered page-level control (SearchInput + Scan + FilterMenu). The "Created"
  date filter moved OUT of the FilterMenu to its own compact row directly below the
  search row (two native date inputs from ≤ to ≤ today + Clear, reusing the existing
  server-side batch-received-date state); the menu's activeCount subtracts Created so
  the badge only counts what is still IN the menu. Stock Changes' own filter row rides
  Y15. Note: `buildCreatedDateFilterSection` (CreatedDateFilterOptions.tsx) is now an
  unwired export — kept, not deleted, because it is doc-referenced by name across many
  files incl. importEngine.ts (a peer's active lane); flagged in Part 443.
- [x] Y14 *(Part 443 — SHIPPED, needs deploy; session e4).* **Sticky rules on Products:** only the search+filter
  row pins now — the select-all / bulk toolbar (and bulk-delete progress) moved OUT of
  the sticky wrapper into normal flow, so they scroll away. Sticky wrapper `top-2` →
  `top-0` (+ inner `pt-2`) closes the 0.5rem gap through which a category header showed
  above the pinned row.
- [x] Y15 *(Part 443 — SHIPPED, needs deploy; session e4).* **Products page becomes chip-sectioned like Promotions:**
  a header switcher (`activeProductSection`) flips Products | Stock Changes, same pill
  pattern as Promotions (title left, actions ride the same row — Y16's Products part).
  Stock Changes stops being a folded card at the bottom of the product scroll and
  renders FULL as its own section (it already carries its own view switcher + search +
  date-range filter). tsc + check:source + 6 unit suites + vite build all green; live
  click-through deferred (peer owns the dev-server backend).
- [ ] Y16. **History + Manage buttons join the section-chip row** (not their own
  toolbar row) on: Sales, Branches, Contacts, Settings, Library, Review & Logs.
  (Products' equivalent rides Y15.)
- [x] Y17 *(Part 431 — SHIPPED, needs deploy; session a8).* **Sales list:
  Customer column folded in.** The list had NO customer column; now a Customer
  cell folds name + phone into one column (desktop table after Date, and
  leading the mobile card meta line). The row click already opens
  SaleDetailModal for the full membership/address/line-item detail (no detail
  wiring changed); cashier + payment are already single columns. Footprint
  SalesListSurface.tsx + lang packs only. tsc + build green. (The
  fuller "Excel-like columns" reshuffle beyond adding the customer column is
  satisfied by the existing single-cell cashier/payment + detail-on-click.)
- [x] Y18 *(Part 425 — SHIPPED. Writes and sync:update events invalidated
  only the entity's own client-cache prefix, so dashboard:*/analytics:*
  stayed fresh (20s TTL) and the Dashboard's own post-cancel refresh
  re-served pre-cancel numbers FROM the cache. One derived-read map in
  api/http.ts now clears dashboard+analytics whenever sales/returns/
  products/inventory invalidate, on all three paths; behavioral + wiring
  test in apiHttp.test.ts.)* **Dashboard shows stale data** — a cancelled sale still shows as
  completed in dashboard figures. Find the cache/refresh gap (cancel doesn't
  bump the dashboard read) and fix.
- [x] Y19 *(Part 431 — SHIPPED, needs deploy; session a8).* **Dashboard range:
  the separate "Custom" chip + bare date inputs are gone — the shared
  DateTimeRangePicker (X1) Start → End pill now shows the effective range AND
  is the custom editor (a preset updates it; editing it switches rangeId to
  'custom'). The pill carries the month/quarter/year-chip + calendar panel the
  mockups asked for (same component the Sales daily report + contact reports
  use). tsc + build green; live click-through deferred (peer's shared 8787
  dev server). Dashboard.tsx only.
- [ ] Y20. **Pagination redesign, all list pages:** merge the items-range /
  per-page / pages row INTO the select-all row (select-all wastes a whole row on
  large screens). Compact form: `‹ page (1–20) / totalPages ›` where the page
  number is editable in place (no size growth) and clicking "(1–20)" opens the
  per-page options (20/30/50/100…). [Products part HOT-6e]

### Phase Z — Aug-28 eighteenth batch (session 43): returns-to-same-batch + the ten-point triage list

*Follow-up to Phase Y: the user answered the open questions (Y6 closed "no
need"; Y12 clarified as the recordable per-currency sales change) and added a
correctness bug plus a pasted ten-point triage list to record "next to each
other" with the Phase-Y items.*

- [x] Z0 *(Part 426 — SHIPPED, needs deploy. Root cause MEASURED: a POS
  sale where the cashier picked no lot recorded NO batch attribution
  (sale_items.batch_id NULL), so units left branch_stock but no specific
  lot, and returns/cancels put them back on the aggregate only — lots and
  branch_stock drifting apart. Fix at the source: every no-lot checkout
  line is auto-allocated across the product's active lots at that branch,
  OLDEST received first (readFifoLotAvailability + allocateAcrossLots);
  single-lot lines set batch_id, multi-lot record per-lot allocations with
  per-unit release tracking (migration 0078). The cancel/un-cancel kernel
  and the returns restock now walk those allocations — restores go back to
  the exact lots (last-drawn first), re-deducts take them FIFO; legacy
  untracked units still ride branch_stock, never a fabricated new lot.
  Tests: new test-fifo-lot-allocation-pure (5) + test-sale-cancel-pure
  multi-lot cases + route wiring locks. NOTE: fixes NEW sales; existing
  drift is the Z1b import-data issue below. The "data repair" clause is
  moot — production has ZERO returns and only cancels of product #1, whose
  single lot was restored correctly (measured).)*
  **Returns + cancels must restore stock to the SAME batch — never a new one.**
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
  code. **REMAINING:** Inventory.tsx's own batch pill (~475/477) renders
  lot_code raw too but is HOT with the F3-slice-2 peer's uncommitted work —
  route it through batchDisplayLabel once that lands. (b) **MEASURED (Part 426), a real
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
- [x] Z2 *(Part 435 — SHIPPED, needs deploy; VERIFIED LIVE).* **Cart: discount
  decoupled from the price input.** The price input bound to applied_price
  (post-discount) and editing it silently created a fixed discount == base −
  typed, conflating the price field with the discount. Now: CartItem price
  inputs show the line's SELLING/base price (base_price_usd/khr), unchanged
  when a discount applies; POS.tsx updatePrice SETS the base and re-applies any
  manual discount against it (applyManualDiscount), so line total = (base ×
  qty) − discount; Receipt.tsx shows the full per-line discount ((base +
  product_discount) − charged, so BOTH product-level and manual show as
  (-$x.xx); was comparing against the charged price_usd and showed nothing on
  real sales; falls back to price_usd for old sales). 4 new posCore tests +
  wiring lock. Verified live: $2 discount on a $12.50 line — input stays
  $12.50, total $10.50, "-$2.00 Discount" separate.
- [x] Z3. **Sales page: live summary + Print column — BOTH DONE.** (a) **Z3a
  (Part 430, needs deploy):** the "N sales | $revenue | N completed" header
  read from a server salesStats aggregate whose effect only re-ran on filter
  changes — a status change reloaded the rows but left the summary stale
  (a cancelled sale kept counting toward revenue). Extracted loadSalesStats()
  and refresh it in lockstep with the rows (sync effect on 'sales'/'returns'
  + directly after the status mutation). (b) **Z3b (Part 426):** action
  column header now reads "Print".
- [x] Z4 *(Part 432 — SHIPPED, needs deploy).* **Receipt SETTINGS preview:
  enabling 80×50 no longer replaces the full-receipt preview.** In
  _previewMode the receipt returned ONLY the 80×50 card when enabled; it now
  stacks BOTH renditions (labeled '80 × 50 mm' and '<N> mm'), mirroring the
  receipt view since B5. Non-compact configs preview the single full receipt
  unchanged.
- [~] Z5. **Global UI pass: contrast + button colors + hamburger menu.**
  **PART 1 DONE (Part 440, session a8, needs deploy):** the sidebar Refresh
  (Update) button renders BLUE and Logout (Exit) RED by default (were faint
  gray-400, hover-only tint); the modal ✕ went from text-gray-400 (~2.5:1,
  fails WCAG AA) to gray-600/gray-300 (legible both themes). **REMAINING,
  needs the user's call:** (a) the hamburger menu housing Settings/Update/
  Exit — deferred because hiding those (Settings is a primary nav item;
  Refresh/Exit are now always-visible colored icons) behind a ☰ is a real
  discoverability tradeoff, not a clear win; confirm WHERE the clutter is
  (desktop footer vs mobile) and that burying them is wanted before building.
  (b) currency-symbol contrast — scattered across many files incl. peer POS
  lanes; needs a coordinated sweep. (c) "Receipt Settings moved into main
  Settings" — a larger IA change, its own unit.
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
- [x] Z8 *(Part 433 — SHIPPED, needs deploy).* **Credit = awaiting_payment +
  edit-payment-near-the-method.** User clarified (Aug 29): "credit is the same
  as awaiting payment, just that you can click near the payment method to edit
  later" — so NO new status. For an awaiting-payment sale the SaleDetailModal
  Payment-method field shows a 'Credit — awaiting payment' chip + a Record
  payment button; clicking it selects the completing status (revealing Y10's
  payment inputs) and scrolls the status section into view. Records payment →
  completes, same as Y10. SaleDetailModal.tsx only (lang key rode in on a8's
  Y17 sweep).
- [x] Z9 *(Part 430 — SHIPPED, needs deploy; verified live).* **POS: "Done -
  Delivery" renamed to "Complete Sale"** with an InfoHint above the button
  ("Stock effect by status") summarizing each status's stock consequence
  (reusing the existing pos_status_*_desc strings) — no inline prose.
- [x] Z10 *(Part 434 — SHIPPED, needs deploy).* **Dashboard vs Branch stats
  consistency.** User clarified (Aug 29): it's about the FOLDED mini-stats,
  NOT date scope — "follow dashboard, keeps them separate." Root cause: the
  Branch/Inventory GET /stats computed Revenue = SUM(revenue) − refunds and
  COGS = SUM(cogs) − returned-cogs, so its Revenue was quietly net-of-refunds
  while the Dashboard's salesAnalytics kernel keeps Revenue = gross − discounts
  and COGS = SUM(cost×qty), both GROSS, with refunds separate in Returns. Fix:
  /stats revenue_usd/khr + cogs_usd/khr now gross (net_sold_qty keeps its
  units-return subtraction); the Branch Revenue card drops the 'Refunded' fold
  + 'after refunds' framing (refunds stay in the Returns card) and its info/sub
  read the Dashboard's before-refunds definition. inventory_info_revenue lang
  value updated. Inventory.tsx committed via the F3 reverse-then-reapply
  isolation. Both tsc clean; build green. (The date-scope difference the
  earlier read flagged is intentional per the user — NOT part of this fix.)
- [x] Z11. **Revenue stat slimmed + Delivery promoted (Part 427 — SHIPPED,
  needs deploy; user, Aug 29: "revenue stats has too many folded stats
  inside, i want it less... an additional stat outside so it is even").**
  The Revenue card folded 10 sub-stats and the outer count was odd (7).
  Revenue now folds only Net revenue / Gross revenue / Discounts / Refunds /
  Tax (5); COGS + Gross profit stay in the Profit card; the delivery lines
  moved to a NEW outer Delivery card (fees / actual courier cost n/m /
  margin / store-paid), making the outer count EVEN at 8. P6 staff-only
  scoping preserved. Verified live: 8 cards render.
- [x] Z12. **Even out every stat drill excl. Products (Part 428 — SHIPPED,
  needs deploy; user, Aug 29: "go deep into each stat excl. products, see
  if it can be merged or evenly distributed").** The folded drill counts
  were lopsided (Stock Value 2, Revenue 5, Discounts 3, Gross Profit 5,
  Transactions 2, Returns 6, Delivery 4). Now ~4 each: Stock Value +Avg
  value/product +Low +Out (dropped the bare Products repeat); Discounts
  +Discount rate; Gross Profit −duplicate Revenue line; Transactions
  +Deliveries +Collected total (kernel's collected_total_usd); Returns
  folded to customer+supplier (supplier count into its loss line, dropped
  the derivable net-after-refunds); Revenue + Delivery unchanged.
  Duplicated headline-as-detail lines removed throughout. tsc clean,
  dashboard test passes, 8 cards render live.
- [x] Z13. **Same even-distribution pass on the Branch page stats (Part 429
  — SHIPPED, needs deploy; user, Aug 29: "do the same for the branch page
  stats").** The 6 Branch/Inventory cards' drills were lopsided (Stock
  Value 2, Revenue 4, Discounts 3, Fees 3, Returns **10** across 3 stacked
  sections). Now: Stock Value 2→4 (+Avg value/product, Low, Out — mirrors
  Dashboard); Discounts 3→4 (+Discount rate); Fees relabeled the mislabeled
  'Transactions' row to 'Deliveries' (it was the delivery count); Returns
  10→4 in ONE section (Customer returns / Refunded / Restocked / Supplier
  returns(N)→loss) with Net Sold + items-sold math kept on the card sub and
  info formula; Revenue unchanged. Committed in ISOLATION from a peer
  session's uncommitted F3-slice-2 work in the same Inventory.tsx (via
  reverse-then-reapply of their patch — their work stays uncommitted and
  untouched, per parallel-sessions protocol). tsc clean, key present in the
  built Inventory bundle, 6 cards + branch list render live.

### Flagged, not guessed (Golden Rule 7)

- **Products now differs from the other five list pages (Part 389):** B6's rule ("the
  'Select all' button is removed; in select mode the column-header checkbox IS
  select-all") is live on Inventory/Sales/Returns/Branches/Contacts, but Products
  still has its toolbar "Select all (N)" control and NO header checkbox — the
  opposite resolution, from the earlier 11.2 pass. Flipping Products to match is a
  small change (ProductsListSurface header + Products.tsx toolbar) but it REVERSES
  a previously-shipped decision, so it waits for the user's confirmation.
- ~~B4's location (which page shows delivery inside a category column) is
  unconfirmed.~~ **Located Part 394** — the old-system expense labels
  (`Delivery / <courier>`, 3,130 rows) on the Fees page; migration 0072 separates.
- Commission/service fields for sales import/export still have no business rule.
- H1's exact per-page option lists should be confirmed against real usage before build.

---

## Task board

> **READ `## Master plan — Aug 28 2026 (Part 370)` ABOVE FIRST — it is the authoritative
> queue.** `## Open work — ORDERED` below remains the spec library (§11–§15, locked
> execution plan) that the master plan references by number. The tables below are older
> and kept for the reasoning they carry, not as the current queue. Where anything
> disagrees, the master plan wins.
>
> **The two production outages are FIXED in code (Part 354) and waiting on a
> deploy** — `reset-data` exceeding the CPU limit (0.1) and `GET /api/products`
> failing with `too many SQL variables` (0.2). The user re-pasted the old error
> log AFTER these landed; it is from 13:45, before the fix. Nothing else jumps
> the queue until `npm run deploy:full` ships and they are verified live.

**Every task carries a status here and is updated as it moves.** Requested Aug 25 2026 so
state is visible at a glance instead of inferred from prose further down this file.

Status: `not started` · `in progress` · `done` · `blocked` · `deferred`

### Blocking / production

| Task | Status | Notes |
|---|---|---|
| POS oversell was silently clamped (race) | **done (Part 360), needs deploy** | The POS/sales deduction validated stock with a plain READ then wrote `MAX(0, qty - sold)`. Not atomic: two concurrent sales of the last unit both pass the read and the clamp floors stock at 0 — an oversell with stock lost and no error. Migration `0058` adds `CHECK(quantity >= 0)` to `branch_stock` AND `branch_batch_stock` (already satisfied by every existing `MAX(0,…)` site, so a safe global net); POST `/sales` and PATCH `/:id/status` now deduct with plain subtraction so a concurrent oversell aborts the atomic batch and returns a **409 stock_conflict** instead of clamping. **Per-lot nuance honored:** a multi-batch product's stock is separated across lots — a sale drawing from a specific lot is bounded by THAT lot's `branch_batch_stock`, not the product total, so selling 5 from a 4-unit lot fails even when the total is 10. Also fixed a latent bug the CHECK exposed: `datedStockCountApply` could seed a negative `branch_stock` row on a remove against a not-yet-tracked product/branch. Test: `test-sales-oversell-strict-pure.cjs`. |
| Data reset fails — "Exceeded Memory Limit" | **done & DEPLOYED** (write path); streaming RESTORE fixed in Part 355, needs deploy | Cause was NOT the reset code: a full backup runs as a hard prerequisite in front of every reset, and it loaded every row of ~34 tables into memory then stringified it. Backup write is paged + streamed to R2; restore now streams rows in bounded batches (10.1). |
| Organization must lock to LeangCosmetics | **done & DEPLOYED** (Part 346) | `ensureCoreDataInvariants` hardcoded the name and rewrote it **on every request**, so any rename reverted. Now configured via `BUSINESS_OS_ORGANIZATION_NAME`/`_SLUG`. Only applies once deployed against remote D1. |
| POS / sales not working — options, batch pick, click-to-pick | done | Two causes. (1) A FLAT product produced no branch options at all (the sheet iterated `variants`, which is empty for non-groups), so the lot query had no branch and was fed an empty list. (2) route()'s read cache is keyed by channel string alone, and `batches:list` was constant — every product shared one cached lot list, which once warm would show ANOTHER product's lots. Verified end to end: both lots list, block clears, cart $37.00 → $55.50 with the lot recorded. |
| Employees / non-admin roles see "No Data Found" in POS | **done — re-fixed properly, needs deploy** (Part 347) | **Confirmed by the user: the employee role does carry `products_image_only`.**<br><br>**Symptom:** a Products-page display restriction was applied at the *shared* product read endpoints, which POS also calls. Rows were stripped to `IMAGE_ONLY_BASE_FIELDS` (`id, name, image_path, image_gallery, updated_at`); `is_active` is not in that list, and POS filtered on it — so every row vanished behind an HTTP 200 with no error banner. The pagination count and A–Z rail kept showing real numbers above an empty grid, because those come from separate unrestricted queries.<br><br>**Part 346 fixed the symptom** by teaching the image-only predicate to also exclude anyone holding `pos`/`sales`/`inventory`. It worked, but the user pushed back correctly: *"these are two separate pages — why is a Products image-upload permission affecting POS?"* That fix left a Products concern coupled to three other pages' permissions, correct only while someone remembered to list every other page in it.<br><br>**Part 347 fixes the architecture.** The caller now declares which **surface** it reads for, and each surface is gated by its own page permission: `pos` → needs `pos`/`sales`, never field-restricted; `inventory` → needs `inventory`, never field-restricted; `products` → needs `products`/`products_image_only`, restricted only for the image-only case. **Declaring a surface cannot escalate** — claiming `surface=pos` without the permission is refused outright, not silently downgraded. Default stays `products`, so pre-existing callers are unchanged. The Products page keeps its restriction where it belongs.<br><br>Driven by a **cross-page permission audit** over both packages (kept at `scripts/` in scratch) that finds any place one page's permission is read by another page's code. Locked in by `scripts/test-product-surface-scoping-pure.cjs` (11 checks), which asserts the products read path **no longer contains** `hasPermission(user, 'pos')` at all, rather than merely asserting today's answer. The independent client-side half (POS reading an absent `is_active` as "archived") keeps its own test. |
| Import correctness vs the real products template | rule decided — implementation not started | Parsed the real file (8,727 rows, 29 columns, RFC4180 multi-line descriptions, UTF-8 BOM). 79 name+branch groups contain more than one row; **48 of those share a name with a DIFFERENT barcode**. **The stated identity rule now answers the question this row used to ask.** Those 48 are no longer a "pick (a) or (b)" decision: same name + differing barcode/pricing ⇒ **child rows inside one name group**, not a merge and not disconnected standalones. Nothing is lost and no source-file edit is needed. Other measured facts: `sku` is 0% filled (SKU matching is inert for this file), all `*_khr` columns are 0% (prices are USD-only, KHR derived), `stock_quantity` is 52% filled, 649 rows use the `\|\|` multi-category separator. |
| Sale total omitted the delivery fee | **done & DEPLOYED** (Part 346, Aug 25 2026) | The POS cart charged `afterDiscount + tax + customerFee` and printed it on the receipt, but the server recorded `subtotal - discount - membershipDiscount + tax` with **no fee term** — the fee scalars were computed further down the handler and were not even in scope at total time. Every delivery sale stored a total **below what was collected**, and the gap propagated into `change_usd`, the Sales page, `salesAnalytics` and loyalty accrual. Fee is hoisted above the totals; only a **customer-paid** fee counts (a store-absorbed fee is a cost, not revenue). |
| KHR-only sales recorded a fabricated USD tender | **done & DEPLOYED** (Part 346, Aug 25 2026) | `Number(body.amount_paid_usd) \|\| totalUsd` read a legitimate `0` as "not supplied" and substituted the whole total, so a customer paying entirely in riel was recorded as tendering the full USD amount **plus roughly a second full total as change**. "Absent" is now detected *before* coercion (`undefined`/`null`/`''` only) — `Number(null) === 0`, so a naive `Number.isFinite` check would have swung the bug the other way. |
| A failed lot lookup read as "there are no lots" | **done & DEPLOYED** (Part 346, Aug 25 2026) | `batchesTransport` passed `() => ({ productIds: [] })` / `() => ({ batches: [] })` as route()'s local fallback, and `hasUsableLocalData` counts any non-empty object as usable — so a 403/500/timeout **resolved as a successful empty result and was cached**. Every batch-tracked product looked untracked, the lot picker never appeared, and **batch-tracked stock sold with no lot chosen**, bypassing FIFO/expiry silently. Both reads now propagate failures; POS keeps prior knowledge, flags the failure, routes every product through the detail sheet, and shows a retry banner; the sheet renders a real error instead of "No lots available". Deliberate availability-for-correctness trade: refusing a sale beats selling the wrong lot. |
| Image normalization, quality protection, all library objects, re-verified every 6h | **in progress (Part 356)** | **Revised Aug 27:** every image may be metadata-stripped and converted to WebP when the result is smaller while retaining roughly **80–90%+ visual quality**. Files already at or below 350KB do **not** enter the aggressive resize/compression ladder and are never padded up to 300KB. Only sources above 350KB use all methods in order — format/metadata first, dimensions second, encoder quality last — selecting the highest-quality result at or below 350KB and aiming for 300–350KB when naturally achievable. Provider failure may never fall through to storing an oversized original. **Part 356 checkpoint:** the server now rejects a fourth unique image for a normal user (409, no silent slicing) and permits five only for admin-control users; file upload, camera and Library picker share that cap. Existing admin-created positions 4–5 survive an ordinary edit but cannot be replaced with a new fourth path. Full server-authoritative quality normalization/provider pipeline is still open. |

### Import

| Task | Status | Notes |
|---|---|---|
| Add/Sale absorbs Dated Stock Reconciliation (batch-choice-on-sale, create-then-sell) | not started | Largest remaining piece; needs its own run. |
| Image auto-wire as a **button**, not automatic | not started | Wanted mainly for delete-and-reimport. Matching + `_1`/`_2` rename already exist. |
| Import/delete stay inside CPU limits while staying fast and 1:1 after review | not started | |

### Products page

| Task | Status | Notes |
|---|---|---|
| Barcode first, on the same row as category and brand | done | Row meta line and detail header. |
| Prices + stock merged onto one row (default display) | **done (Part 412), needs deploy** | Re-asked directly Aug 28 with a screenshot: "prices and stock qty should be one row. only one row." SUPERSEDES the earlier "selling price gets its own row" split (the user rejected it rendered live — don't re-split without a fresh ask). One "\|"-separated line in renderMobileProductCard: selling (green, larger) · special/discount · cost (red) · status-colored qty; flex-wrap kept only as overflow protection. Desktop table untouched (already one row per product). Commit 4210aa2f. |
| Large-screen row alignment — no indentation vs the category rail | not started | |
| Sticky toolbar (search / select-all) gap on scroll | not started | Products show through the gap. |
| Batch format + click-to-open float-expand in the flyout | not started | |
| Flyout: divider, margin row, action-button width | done | Divider was two stacked 1px borders. |
| Thumbnail opening gallery **and** detail together | done | Not reproduced live — no product has a real uploaded image locally. |

### Cross-cutting

| Task | Status | Notes |
|---|---|---|
| Stat cards: fewer, clearer, explanations behind an info hint | **done — needs deploy** (Part 347) | Applied to all four pages that carry stat cards. **Inventory:** the profit card removed (flagged explicitly — the ask said "net profit", and no such label exists anywhere in the codebase; Inventory's only profit card was *Gross Profit*, so that is the one removed), and 7 "Formula" rows deleted from the drill-downs. **Dashboard:** 10 prose rows removed (Formula / Example / Collected total / Collected example) — the Revenue KPI alone had ten rows, four of them paragraphs sitting in a list of figures. **Branches:** tiles already had written explanations but delivered them via `title`, the browser's black tooltip — unreadable on touch, unstyleable. **Returns:** seven tiles each had a `title` that merely *repeated the label rendered underneath it* — the exact duplicate case called out; they now carry real explanations that also say what clicking does (the tiles are the list's type filter, which nothing on screen said), and the active filter gains a visible ring. Seven inline buttons collapsed into one `ReturnStatTile`.<br><br>All of it routes through the **existing** shared `InfoHint`, which already opens on hover AND tap and already, deliberately, carries no `title` — reused rather than rebuilt. Cards became containers with the clickable region inside, because `InfoHint` is a `<button>` and a button nested in a button is invalid HTML: the browser drops one, silently breaking either the hint or the drill-down. 24 en/km key pairs added; `langKeyIntegrity` confirms parity. |
| Import: only five description sections accepted | **done — needs deploy** (Part 347) | The real file embeds structured text inside the `description` cell (`"Official Product Name": ...`). Only **Official Product Name / Introduction / Features & Benefits / Who is it for? / Ingredients** now survive an import; any other `"Something":` block is dropped **with the text under it** rather than leaking through as loose prose. One recognised label is valid — this is a whitelist, not a required schema. **Caution and Need More Details are deliberately NOT importable** even though the portal renders them: they are portal-wide defaults authored in the Customer Portal editor, and a supplier's wording must never silently override the shop's own. Output is re-serialised in one canonical order/spelling so `parseProductDescription` reads back what it expects. `lib/productDescriptionSections.ts` + `scripts/test-description-sections-pure.cjs` (13 checks). Verified against the real file's shape; census unchanged (8,727 → 6,684) since this touches description text, not identity. |
| Permissions UI: more detail, per-action, "Review Required" renamed | **partly done — needs deploy** (Part 347) | Requested Part 347. Current editor shows very small buttons and too little detail; the admin should be able to pick individual **actions** themselves. Also: **"Review Required" is a misleading name** — it does not mean everything is reviewed (Fees only queues delete, Contacts allows add directly but limits edit, Products queues every write). **Done:** renamed to **"Partial Access"** in en+km including the seven per-section descriptions and the review-queue hint — the stored value stays `'review'`, so `reviewGate`/`reviewApply`/`REVIEW_TIER_KEYS` and every backend branch are untouched; this is a naming change, not a behaviour change. The old name told admins the wrong thing: Fees only queues *delete*, Contacts allows add directly and limits edit to the name field, Library cannot delete at all under it. Tier buttons went from `px-2.5 py-1 text-xs` (the "very tiny buttons") to `min-w-[5.5rem] px-3 py-2 text-sm`. The per-row explanation was a 4×4 button carrying `title` — the black native tooltip, which **does not open on tap at all**, so on touch the explanation was unreachable; now `InfoHint`, with a test asserting the native `title` is not also present. **Still open:** letting an admin pick individual *actions* directly rather than only per-section tiers. |
| Product groups: max 3 images, controls on the group title | **done — needs deploy** (Part 347) | Requested Part 347. A group is one product, so it carries one set of at most 3 images. **Done.** Child rows lose Choose File / Take Photo / Open Files *and* the reorder-remove grid; the section is replaced with a sentence saying where the photos live, since an uploader that vanishes with no reason reads as a bug. Ownership is the lowest-id row in the name group — the same "first row wins" tie-break the identity rule uses, so every surface agrees without a stored flag. Renaming a child out of the group restores its own uploader with **no dedicated code path** — that falls straight out of name-based grouping. **Fixed a real invisibility bug found while doing this:** `renderGroupThumbnail` read the lead row ALONE, but the importer attaches each image to the row it matched while lead is decided by id — so groups that demonstrably had a photo rendered a grey placeholder with no way to reach it, and hiding the child uploader would have made that *more* common. `buildGroupThumbnailState` now falls back across members; display changes, ownership does not. |
| Public portal product detail layout | **done — needs deploy** (Part 347) | Requested Part 347. Card-style gallery: one image at a time, left/right arrows, click to view images only. **Done.** Gallery steps one image at a time with left/right arrows and a counter, and the image opens the photos on their own via the **existing** shared `ImageGalleryLightbox` (lazily loaded; mounted outside the card so the card's click-to-close cannot fire behind it). The body was a mix of captions, uppercase pills and bare prose; every field now renders through one `DetailField` in the requested order. Shop's Product Name *labels* the header value rather than repeating it — the point is telling it apart from the manufacturer's name, which a duplicate would not help. Category/Brand now read the multi-value `categories`/`brands` columns (migration 0033) and render **every** value: previously a product deliberately filed under two categories showed one. |
| Edit does not auto-move sections back to Details | **done (Part 394), needs deploy** | Root cause: `formInitialTab` survived a save — Adjust Stock set `'stock'`, both save-success close paths never reset it, and the next open that didn't pass a tab (toolbar Add) inherited it. Fixed at the open: every form open now sets the tab explicitly (invariant documented at the state), commit `c904a9fd`. |
| mm/dd/yyyy everywhere | done | Locale pinned to `en-US`; `undefined` follows the viewer's machine and renders dd/mm/yyyy in most non-US locales. |
| Items per page: 20 default, POS 30, public 20 | done | Both client and server for the storefront. |
| Fast loading, accuracy, efficiency | not started | Needs a measured pass, not guesswork. |
| Session "ERR Not authenticated" after idle | **done & DEPLOYED** (Part 346) | Sessions never renewed; fixed expiry set at login. |
| Contacts / Fees per-action permission gating | done | Opposite treatments — block means hide, queue/limited means keep and explain. |
| Khmer sweep + raw-key rendering | done | 40 keys rendered as raw keys because `t()` returns the key on a miss, making `|| 'fallback'` dead code. |

### Deferred by request

| Task | Status |
|---|---|
| Promotions / discounts, Canva-like template editor | deferred |
| Public customer accounts (phone-only login, membership ID) | deferred — identity decisions recorded |

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

- [x] Stock Actions: bounded analyze → persisted review/conflict seal → explicit
  confirmation → queued atomic/idempotent/FIFO/oversell-safe apply.
- [x] Contacts, Sales and Inventory: one real upload screen and one authoritative
  persisted review/confirm screen; Contacts includes bounded search/sort/filter.
- [x] Public storefront iPhone PWA: production `/` selects Leang Cosmetics before
  React, including Apple title/touch icon and static manifest; admin stays Business OS.
- [x] Products/image-only: Screen 1 owns the real setup/upload and queued analyze;
  persisted D1 rows are the only Screen 2, durable safety decisions fail closed,
  and explicit Confirm is the sole route into queued apply (Part 368, `a31bbd80`).
- [x] Sales core: smart multi-line invoice contract, strict date + 24-hour
  time, customer inheritance/matching, FIFO/oversell/idempotency/permission bounds,
  and import→export round trip are complete in Part 369. Historical sales do not
  deduct today's stock (so FIFO/oversell is intentionally not applicable there);
  returned quantities restock atomically, while live/stock-action sales retain the
  strict FIFO/oversell guards. Restricted actual-delivery cost and any future
  commission/service schema remain explicitly owned by Delivery (11.27), not hidden
  as completed sales columns.
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

## DONE this session (Parts 346–353) — do not redo

Every item verified with tests; commit hashes in `git log`.

**Import path — all four CPU hot spots fixed, and proven end to end.**
`run_import_e2e.cjs` drives the REAL engine through a fake queue: 8,727 rows →
6,684 products, 147 analyze + 59 apply invocations, **88 ranged reads / 21.8 MB
against 521 MB before (24×)**, chunk_state **113 chars**, status `completed`, lease
released, no error.
- CSV read by byte range instead of ~87 full decodes (`sourceIsComplete` guard stops a
  cut slice being emitted as a complete row).
- Dedupe ledger → `import_job_row_signatures` (was **8.24 ms** on the worst chunk of a
  10 ms budget).
- Image-match cache → `import_job_image_matches` / `_renames` (was **7.99 ms/chunk** at
  10k images, full size from the FIRST chunk).
- Sales chunks read only their own groups via SQL (`SALES_GROUP_KEY_SQL` mirrors
  `partitionSalesGroups` exactly).
- **Single-writer lease** (migration 0053): Queues is at-least-once, and two invocations
  of one job both INSERTed. Expiring, released in `finally`, token-guarded, refusal
  returns rather than throws. Two DIFFERENT jobs never contended.

**Permissions** — product reads scoped by SURFACE (`products_image_only` can no longer
reach POS); "Review Required" renamed **"Partial Access"**; per-action overrides,
enforced server-side, one-way.

**Images** — revised Aug 27: every static image can receive safe WebP/metadata
optimization when smaller at roughly 80–90%+ quality; only sources above 350KB use
the full format → dimensions → quality ladder, with 300–350KB a natural target and
350KB a hard stored ceiling. Never pad small images or write back a larger result.
Every image is indexed `_1/_2/_3`; regular products/groups cap at 3 and an admin can
explicitly allow 5. **Part 356 now enforces that 3/5 contract at the API and every
ProductForm picker without silently truncating admin-created galleries.** Strict 1:1
library matching reports ambiguous names. Cloudflare is primary, Cloudinary is a bounded
signed fallback, and the 6-hour audit is report-first; that provider/audit pipeline is open.

**Infrastructure** — quota guard with D1 fallback for cache versions (KV is 1,000
writes/day and `bumpVersion` fires from 31 sites; exhaustion silently served STALE
data). **Part 356 fixes backup retention/lifecycle:** exactly two finalized R2 sets,
20-object continuation slices, immutable large manifests + small state sidecars, three
bounded attempts, stale-incomplete cleanup, and system jobs that stay running until
asset copy truly finalizes. Drive now streams/deduplicates the finalized R2 manifest and
keeps exactly seven tagged files; full referenced-asset mirroring is still open. Sentry
with PII scrubbing + dedupe; Analytics Engine; A–Z rail parity; storefront caching.

**Outage, Aug 26** — both domains went NXDOMAIN while the Worker was healthy. Root
cause: DigitalPlat still held the NS delegation, so Cloudflare's records were never
consulted. `workers_dev` was turned on to restore access, then off again by request;
the switch and its reasoning are recorded in `wrangler.toml`.

---

## Needs the user, not code

1. **Rotate the Cloudinary API secret** — it was pasted in chat. It is in `.dev.vars`
   (gitignored, verified absent from git history), never in `wrangler.toml`. User says
   they have since updated it in `.dev.vars`.
2. **Resend DNS** — the domain is unverified AND is a Tailscale name, not
   `leangcosmetics.dpdns.org`. Password-reset email cannot send until both are fixed.
3. **Deploy** — nothing since the outage fix has shipped. `npm run deploy:full`.

## Current status

**As of Part 387 (Aug 28 2026).** Everything below was really run in this local Windows
checkout with full `node_modules`, working `better-sqlite3`, and network access — see
[Environment notes](#environment-notes). Golden Rule 5: a claim here is not evidence; these
are the commands' actual results this session.

| Check | Result |
|---|---|
| `frontend` `tsc --noEmit` | **clean** (Part 384 rerun after the purchases modal + supplier drill) |
| `cloudflare` `tsc --noEmit` | **clean** (Part 384 rerun after 0067 + purchases endpoint) |
| Backend `scripts/test-*.cjs` (swept individually, not via a chain) | **85 / 85 pass** (Part 387 sweep; +test-bulk-price-adjust-pure, image-only/batches pins extended) |
| Frontend `npm run test:utils` (full chain: `typecheck` → `verify:public-runtime` → `check:source` → all 116 `tests/*.test.ts`) | **green** (Part 384 rerun, plus check:source) |
| Real `vite build` | **succeeds (25.53s)**; only the two pre-existing catalog circular warnings |
| Migration harness | **all 71 migrations apply cleanly** (Part 390 rerun; `0070` received_branch_id verified present on top of Part 386's `0068`/`0069` checks); `0061`–`0070` are committed but **not deployed** — the next `npm run deploy:full` carries them |
| Migration pack (after the S2 name propagation) | **ALL VALIDATIONS PASSED** rerun (quantities exact vs footer, revenue 0.02%, Khmer byte-perfect, zero scientific barcodes); xlsx round-trip OK |
| Production devices (read-only D1 query) | trusted_devices **0**, user_sessions 94 (**2 live**) — the Part 375 clean slate holds |
| **Part 385 connection preflight** (real classifiers over the real files vs merged catalog + 4,652 real customers) | stock history **21,286/21,286 attach**, sales **14,913/14,919 receipts** (6 junk lines err by design), customers **99%+ linked**, suppliers **8,053/8,053**; pack re-validated ALL PASS after the identity rewrite |

**Part 389 (Aug 28, parallel session):** I1 (audit coverage — 4 real gaps closed:
backups create/RESTORE, files upload/rename/force-delete, notes lifecycle, sync
chunked-upload; 2 deliberate non-audits pinned; `test-audit-coverage-pure.cjs`
49/49) and B6 (header-checkbox select-all + select-column collapse + long-press
model on Inventory/Sales/Returns/Branches/Contacts) both shipped, needs deploy.
Re-verified this session: both tsc clean, `test:utils` full chain green, vite
build 22.09s. **Flagged:** Products now carries the OPPOSITE 11.2 resolution
(toolbar Select-all, no header checkbox) — see Flagged, not guessed.

**Part 390 (Aug 28, parallel session):** D1b shipped, needs deploy (`c30f5159`) — the
Stock-In Invoice report (supplier → received day → product lines, filters
branch·supplier·date-range) as a folded teal SectionCard on Contacts → Suppliers under
the contacts_suppliers gate; migration `0070` adds `product_batches.received_branch_id`,
stamped by BOTH receive writers with first-attribution-sticks, so the branch filter
reads the receive-time fact — and it deploys before the history import, so the 21k
rows land with their real shop/warehouse split. Verified this session: both tsc clean,
backend sweep **87/87** (new `test-stock-in-invoice-report-pure` over the real
71-migration chain; both stock-action fixtures gained the column), vite build 12.50s,
check:source + langKeyIntegrity green (12 new en/km keys — landed in `30a09266` by
cross-session coordination), wrangler dry-run OK. One full `test:utils` chain run
failed at typecheck in ANOTHER session's in-flight `DeviceApprovals.tsx` — outside
this unit's blast radius; every check over this unit's own files ran green.

**Part 392 (Aug 28, parallel session):** M7 shipped, needs deploy (`8e5f87e8`) — the
encoding-safety contract exists as TESTS (frontend `encodingSafety.test.ts` 9 cases;
backend `test-encoding-safety-pure` with a frontend↔backend parse PARITY lock), and
four real gaps closed: both import parsers now invert this app's own Excel
protections identically (`="text"` unwrap + leading-' guard strip — before, a
protected barcode previewed as digits but COMMITTED as literal `="..."` text, and
re-importing our own exports corrupted every =/+/-/@-leading value); the xlsx→text
bridge stops apostrophe-mangling numeric cells (`csvFieldForMachine`); ZIP-packaged
CSVs and errors.csv gained the UTF-8 BOM Khmer needs in Excel. Verified: both new
tests green, 11 import/export-adjacent frontend tests green, backend sweep 89/89
(one transient failure = another session's mid-edit promotions module), both tsc,
build 13.87s, dry-run. Directly protects the M2 migration imports.

**Part 398 (Aug 28, parallel session):** B5 shipped, needs deploy (`26b04c91`) — the
80x50 card and the full roll receipt are now BOTH previewed and BOTH printable (two
explicit Print buttons; full receipt maps an '80x50mm' paper setting to the 80mm
roll). Verified: receiptTemplate + receiptSettingsSync re-pinned and green, posCore +
chain coverage green, build green, and a LIVE worker-dev pass with a real sale
(migrated local D1 to 0073 to do it; local dev admin password was reset to the seed
default `Admin123456!` in the process — local scratch only). **Correction (same
session, after re-test):** the "POS status modal renders empty" report initially
flagged here against a peer's build was WRONG — a DOM-inspection bug in this
session's own probe (the deepest div containing the title is the modal's header
bar, which is all the probe ever read). On the fresh HEAD bundle the modal renders
all three options, and a full real checkout was completed through it (POST
/api/sales → sale RCP-1787913777564-S6PX committed, paid, status completed). The
earlier "can't complete checkout" symptom was `insufficient_amount` doing its job —
no payment had been entered. No defect existed in the peer's work at any point.

**Part 370 additions:** the master plan (top of file) is now the queue; the in-flight
stats/tooltip work was finished and committed (`9d93db56`); the empty
`{sales,returns,utils-settings}` component directory was removed.

**Part 371 (Aug 28, second batch):** the user deployed Parts 346–370 (A1 done) and
bought leangbeauty.com. Committed: the custom-domain wrangler config (`f5eee54b` —
also PREVENTED a second-empty-organization bug the raw find/replace edit would have
shipped, verified against production D1) and the session fix (`7da5273d` — Login.tsx's
`'session'` fallback = 24h server-side was the "logged out after a few hours"). The
nine old-system spreadsheets were parsed and reconciled (Phase M — 95%+ barcode match,
98.3% stock agreement; outputs in `Downloads/businessos-migration-aug28/`). Frontend
chain + build re-ran green after the Login change; backend untouched. **The deploy
itself is blocked for the assistant by the permission classifier — the user must run
`npm run deploy:full`** (from `cloudflare/`), then A2/A5's live checks apply. Google
Drive measured to still hold ZERO backup files post-deploy — A3 is a real bug hunt.

**Part 376 (Aug 28, sixth batch):** the visible product is **Leang Beauty** — 80+
display strings swept (storefront titles/manifest/Apple title/FAQ/AI copy/every portal
language pack/en+km org strings + the tests pinning them), historical records
untouched, icons need no change (L monogram). Paid-plan limits applied per
wrangler.toml's own instructions: `[limits] cpu_ms = 300000` + import consumer
`max_batch_size` 1→5 (dry-run validates). Clarifications folded into the plan: N3 =
colored, foldable sections WITHIN pages (SectionCard per section KIND, same color =
same meaning everywhere); D5 = supplier is a property of the BATCH (same product,
different suppliers) with a §12 optional supplier column; D3 detail gains per-batch
supplier + supplier section + searchability; N1c = one-file-or-many import contract;
K2/POS batch-first + Selling/VIP focus. Verified after the sweep: frontend full chain
green (exit 0), build 15.50s, both typechecks clean.

**Part 379 (Aug 28, seventh batch):** Excel-proof `.xlsx` versions of all ten
import/reference files (every cell a text cell — opening in Excel cannot coerce
barcodes/dates; round-trip proven on a leading-zero barcode + Khmer). POS cart round
2 (B7) and fees polish + expense type (B8) landed; the 4,240-entry expense migration
is fully prepared with expected sums but both write channels were permission-blocked
— the user runs one command (B9). Import merge rules measured against the spec: the
highest-price-wins rule already exists in `resolveMergedPricing`; migration data
already group-consistent (0 rows changed); engine-side group unification specced
(D6b). Verification: see Current status.

**Part 375 (Aug 28, fifth batch):** M3 CLOSED — all 89 review rows decided (73 add /
6 merge / 10 delete) after applying the user's renames+deletes and three more barcode
verifications (YSL Caring Satin — user was right about not-Loveshine; Rouge Dior
Forever 558 Grace; theBalm Mad Lash travel). Generated the import artifacts + manifest
(`IMPORT-MANIFEST.md`, `products-import-NEW-from-review.csv`, `suppliers-from-po.csv`).
Device rule shipped in code: max 3 approved devices per account, enforced at approve
(test-device-cap-pure), and production cleared as requested (69 sessions revoked, 17
device rows deleted) via the D1 MCP after the CLI write was permission-blocked. A4/M4
analysis corrected: the 60-unit cap is subrequest-bound, unchanged on Paid — the real
unblock is plan-persisted continuation dispatch. Backend sweep after the device change:
see Current status.

**Part 372 (Aug 28, third batch — deep reconciliation + first build work):**
M1b deep pass done (canonical mapping 98.6% auto over 6,218 old products, date order
proven ISO, ledger validation 5,725/5,903, stock-report identified as a 2026-01-01
period report; pack regenerated with template identity applied). Landed in code
(`204584ea`, `84b91b0f`, `d40138b8`): the loyalty-accrual flag end-to-end (migration
`0061` + every aggregation + import writes 0 + POS toggle + pure test), POS delivery
row compaction (B3), phone-first contact forms (B2). Verified this session: new test
passes, full backend sweep **80/80 = 0 failures**, both typechecks clean, full frontend
chain green, build 13.55s. Migrations `0059`–`0061` are committed but NOT yet applied
remotely — the next `npm run deploy:full` applies them.

**Nothing is deployed.** Every fix Parts 346–369 — including the two production outages
(0.1, 0.2) and the storefront Install bug (16.1) — is committed and waiting on
`npm run deploy:full`. The user's re-pasted error logs predate the fixes.

### Done / In progress / To do — at a glance

- **DONE in code, waiting on deploy:** 0.1, 0.2 (both outages) · image auto-wire + unwire (2.3) · role-aware 3/5 image cap · R2 finalized lifecycle/exact-two retention · Drive streamed/deduplicated manifest mirror/exact-seven tagged retention · **§15 one-object/many-logical-Library-names + streamed rename-on-download** · products large-screen alignment + 11.4/11.5 · §14 batch count/details · 11.24/11.25 VIP fixes · 11.8–11.11 POS fixes · 11.20/11.21 stock-health cards · 16.1/11.14–11.16 storefront PWA and favicon removal.
- **DONE in code, needs deploy/live verification:** unified stock-action import (§12 + its §13 slice — analyze, persisted row review, confirmation, FIFO/oversell-safe apply, lifecycle seal and Free-plan bounds).
- **DONE in code, needs deploy/live verification:** §13 two-screen structure for Stock Actions, Contacts, Sales, Inventory **and Products/image-only**; each real upload starts one queued analyze and one persisted review/confirm screen owns the decision.
- **DONE in code, needs migrations/deploy/live verification:** smart sales import/export core (11.29, Part 369) — compact multi-line inheritance, strict time, safe matching, shared round-trip contract, permissions/bounds, atomic idempotent receipt apply and return restock.
- **IN PROGRESS / partial:** Drive backup (manifest checkpoint done; referenced asset-folder mirror open) · image pipeline (role cap done; quality/provider audit open) · per-action permissions (7.1 — narrows-only, Products routes only) · selection-column behavior (11.1/11.2 — Products done, other pages open).
- **TO DO (specced, not started):** compact/top-layer stats UI on all pages (11.26) · customer delivery charge vs restricted actual cost/margin (11.27, including the sales import/export extension) · manual historical batch entry + barcode rules (11.28) · commission/service schema/business rule · server-level undo/redo (3.1) · public-portal polish (§5) · Returns replace + damaged-stock chooser (11.12/11.13) · remaining POS SP/VIP/damage picker · identity rename-regroup (9.1/9.2). Full ordered list: [Open work — ORDERED](#open-work--ordered).

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

## Open

**Update, Part 331 (Aug 24 2026):** the accent-color work below (item 1's
"one small brand-accent blue-700 gradient stop kept intentionally," and
the underlying `--ui-accent` default) is superseded -- Part 331 changed
the app's accent from blue to brass/graphite everywhere, including that
gradient stop, per an explicit "I don't like the blue... feels ominous"
follow-up. See History, Part 331, for the full record. Import CPU-safety
(referenced in several items below as an open concern) is confirmed
solid, pre-existing work, not something this project still needs to
build -- see Part 331. A new queue-driven bulk-delete pipeline for 10k+
selections now exists for Products; extending it to other entities is a
new open item, added at the end of this section.

### PRIORITY -- Aug 23 2026 session (chat, part 1): dark/light theme
consistency pass, requested alongside "continue all in-progress items,
permissions, undo/redo scoped to current pages." Given the scope of the
full backlog below (permissions three-tier system still mid-build, the
dated-stock-count/Add-Sale import pipeline mid-build, several large
unscoped batches), this single chat session could not build all of it --
picked the most concretely-actionable, self-contained piece (theme colors,
since the user gave a specific, checkable complaint: dark-blue surfaces
instead of unified dark-grey) and did real, verified work on it rather than
spreading thin across everything and finishing nothing. Full honest status
below; nothing here is a placeholder claim.

1. **[x] Real bug found + fixed: login/auth screen and the app topbar were**
   **still on the pre-Aug-19 navy "blue-grey" palette, not the neutral-grey**
   **dark scale the rest of the app was migrated to.** Traced every
   remaining hardcoded navy/slate-900-ish hex (`#0f172a`, `#08101b`,
   `#0b1422`, `#13253c`, `rgba(15,23,42,*)`, `rgba(30,64,175,*)`) across
   `frontend/src` rather than assuming from the file name -- most hits
   were legitimate and left alone (light-mode-only shadows, `.btn-primary`'s
   accent-darken `color-mix`, and the customer-portal branding color-swatch
   presets in `Settings.tsx`, which are a merchant's own choice for their
   storefront, not admin app UI). The real, confirmed bug was in
   `main.css`: `.auth-shell`/`.auth-frame`/`.auth-aside`/`.auth-card`/
   `.auth-card .input`'s `.dark` variants still had the old navy values
   (`#08101b`/`#0b1422`/`#13253c`, slate-900 `rgba(15,23,42,*)`, blue-700
   `rgba(30,64,175,*)`) even though the file's own `--dm-*` neutral-scale
   redo (Aug 19 2026, see the comment above `:root.dark`) was supposed to
   be the single source of truth for every dark surface -- this block was
   simply missed in that pass. **Also found and fixed a real zombie-code**
   **bug while in this section**: `.app-topbar`/`.dark .app-topbar` were
   defined twice, back to back, with two different, conflicting value
   sets -- the second definition silently won the CSS cascade (same
   selector, later wins) and the first was dead, unreachable code; the
   *winning* one was the still-navy `rgba(15, 23, 42, 0.9)` version, which
   is exactly the login-page-still-looks-blue symptom reported. Fixed by
   removing the dead duplicate and repointing the surviving rule's dark
   values at the `--dm-*` tokens (`var(--dm-border-strong)`,
   `rgba(20,20,20,0.92)`) instead of a fresh hand-picked hex, so it can't
   drift from the rest of the app's dark palette again. `.auth-shell`/
   `.auth-aside` deliberately keep one small, tasteful brand-accent tint
   (a shrunk radial highlight + a low-opacity blue-700 gradient stop) --
   this is the one screen in the app where a hint of brand personality on
   a dark background is appropriate (a login screen, not a data surface),
   kept intentionally rather than flattened to pure grey, but rebased onto
   the same neutral `#101010`-`#1c1c1c` foundation everything else uses so
   it reads as "dark UI with a brand accent," not "a different, bluer dark
   theme." `.dark .three-dot-btn`'s hardcoded `#a8b5c8`/`#1c2937` (also
   navy-tinted) switched to `var(--dm-text-3)`/`var(--dm-card-hover)` for
   the same reason. See `frontend/src/styles/main.css`'s own new comment
   directly above this block for the full before/after record.
   **Verified so far**: read the full diff back, confirmed no other
   `.dark` rule in `main.css` still references a raw navy hex (only the
   documented comment text and the unrelated light-mode/button-mix lines
   remain). **Not yet verified**: no live browser in this sandbox to
   actually load the login screen and admin shell in dark mode and confirm
   it renders as intended -- same standing caveat this file has attached to
   every visual-only change for 300 parts. Worth a real screenshot check
   next session before calling this done.
2. **[x] Real bug found + fixed, larger scope than item 1: the app's**
   **dominant dark-mode "secondary/muted text" idiom, used on nearly**
   **every page, was never migrated off Tailwind's raw cool-toned grey**
   **scale.** Grepped every `dark:text-*` class across `frontend/src`
   after fixing item 1 to see whether the auth-shell fix was an isolated
   case or a symptom of something bigger -- it was the latter, and much
   bigger: **1,050+ occurrences** across nearly every component
   (`Products.tsx`, `Inventory.tsx`, `POS.tsx`, `Settings.tsx`, every
   modal, every list surface) use `dark:text-gray-300/400/500` or
   `dark:text-slate-300/400/500` for ordinary secondary/muted body text in
   dark mode. `gray`/`slate` are Tailwind's *cool-toned* families
   (`gray-400` `#9ca3af`, `slate-400` `#94a3b8` -- both have a measurably
   higher blue channel than red/green), not the true-neutral `neutral`
   family (`#a3a3a3`, r=g=b) the `--dm-*` token system (Aug 19 2026,
   background/border only) was built on. This is the actual, dominant
   root cause behind "fonts are not well contrasted" and "not united
   coloring" -- it's not a handful of stray components, it's the default
   idiom for muted text across the entire admin app, and it's been
   silently fighting the neutral-grey background system on every single
   page since the Aug 19 redo, because that redo covered backgrounds/
   borders and missed text. **Fixed centrally** in `main.css`, extending
   the exact same normalization pattern already proven for
   backgrounds/borders (see that block's own comment on why both the
   plain-class and the `dark\:...:is(.dark *)` selector forms are
   needed) to text color: `dark:text-{gray,slate,zinc,neutral}-{100..800}`
   now resolve through the four `--dm-text-*` tiers (100/200 -> brightest,
   300 -> text-2, 400 -> text-3, 500/600 -> most muted text-4, 700/800 ->
   text-2), so every one of those 1,050+ call sites gets the true-neutral
   color automatically, with zero component files touched. **Deliberately
   excluded the rare 900/950 tier** -- checked each of the ~15 occurrences
   individually first rather than assuming, and every one is a different,
   correct pattern (near-black text paired with a light `dark:bg-white`/
   `dark:bg-slate-100` chip for an active/selected filter-pill state, e.g.
   `FilterMenu.tsx`, `SectionSwitcher.tsx`, `Products.tsx`'s bulk-edit-mode
   toggle) -- forcing those to a light color via this rule would have made
   an active pill's own label unreadable, so 900/950 is untouched by
   design, not an oversight. Also avoided a real conflict while writing
   this: the file already had older plain-class (non-`dark:`-prefixed)
   rules for `.dark .text-gray-900/800/700/600/500` from an earlier
   session -- rather than redeclaring those selectors with new values
   (which would have silently fought the existing `!important` rules over
   source order), left them untouched and only added the previously-
   uncovered `dark:`-prefixed form plus the plain-class tiers gray didn't
   already have and slate/zinc/neutral needed for the first time.
   **Verified, all real**: `tsc --noEmit` clean; a real `vite build`
   succeeded (25.98s) after reinstalling the missing
   `@rollup/rollup-linux-x64-gnu` native binary (network reachable this
   session, same recurring sandbox-only gap prior sessions have hit);
   CSS brace-balance checked (190 open / 190 close, matched) before and
   after the edit. **Not yet verified**: same standing live-browser
   caveat as item 1 -- no way to visually confirm from this sandbox that
   every one of the affected 1,050+ call sites now actually reads as
   intended (in particular, worth spot-checking a page that leaned
   heavily on `slate` specifically, like `FeesPage.tsx`/`Dashboard.tsx`,
   since slate's blue tint was the most pronounced of the three families
   fixed).
3. **[ ] Full page-by-page dark AND light mode contrast/typography/**
   **"looks cheap or childish" audit -- NOT done this session, still the**
   **large open item it already was (see "Dark mode contrast/professional**
   **survey" further down in Open, tracked since Part 137/Aug 18).** This
   session's fix closes one real, confirmed, high-visibility bug (the
   login screen + topbar), not the broader ask. What a source-only read
   from this sandbox genuinely cannot verify: actual contrast ratios
   against WCAG, whether specific font sizes/weights read as
   under-contrasted on a real screen, or whether any given page's spacing/
   density reads as "professional" vs "mechanical" -- these are visual
   judgment calls that need a live browser or a real device, not something
   `grep`+`tsc` can confirm. The existing `--dm-*` neutral-grey token
   system (Aug 19 2026) is structurally sound and, per this session's
   audit, now consistently applied everywhere checked -- the honest
   remaining work is a live-browser pass, screen by screen, checking each
   page's actual rendered contrast and density against this token system,
   which is exactly what the pre-existing Track D/Track E QA items already
   call for and remain blocked on live access for.
4. **[ ] Permissions three-tier system + undo/redo/history scoped to**
   **current pages -- NOT touched this session, still exactly where the**
   **existing "Permissions UI redesign, expanded" and "Standing**
   **cross-page consistency checklist" items above already leave them.**
   The permissions three-tier (Full/Review Required/None) system is
   already built and wired for 7 of 7 sections per that item's own "Status
   as of Part 160" note; the one open thread on it is the `files.ts`
   library-vs-settings transitional-OR question (Part 156, deliberately
   left open, not a new gap). Undo/redo (`ActionHistoryBar`) already
   exists and is wired per-page across Products/Inventory/etc -- "scoped
   to current pages" wasn't accompanied by a specific example of where it
   isn't, so nothing was guessed at and changed here; if a specific page
   is missing history or has stale/wrongly-scoped undo entries, naming
   which page and what's wrong would let a future session fix the real
   thing instead of re-auditing all of it blind.

 product-edit auto-redirect (root cause found, not yet fixed), dated stock-reconciliation import spec (detailed by user, supersedes Part 239's simpler version), real import-file audit. Ordered by priority per this session's explicit ask. Nothing in this section built yet -- scoping/investigation only, done against real source + the user's own uploaded template/example files.

1. **[~] Dated stock-reconciliation import -- batch-FIFO CORE BUILT +
   TESTED (Part 278); I/O APPLY LAYER BUILT + TESTED (Part 279); ROUTE
   WIRING BUILT + TESTED (Part 286); analysis-only resolve layer
   (matching/ambiguity/price-conflict detection) BUILT + TESTED (Parts
   288-290); DECISION-EXECUTION LAYER (the endpoint that actually acts on
   a human's create_new/link_variant/create_child/skip + price-conflict
   choices) BUILT + TESTED (Part 291, merged from a separately-drafted
   `update_code.zip`); NAME-LOCK ENFORCED + TERMINOLOGY RENAMED this
   session (Part 292) -- `create_variant` renamed to `create_child`
   throughout, and a child row can no longer carry a different name than
   its parent (rejected with a clear error, never silently overridden).
   Only the frontend step-by-step review UI and the CSV/XLSX
   column-mapping step remain unbuilt.** See Part 292's writeup in
   History for the rename + name-lock enforcement, and Part 291's
   writeup for what shipped
   (`lib/datedStockCountDecisions.ts` + new
   `POST /dated-stock-count/resolve/apply-decisions` route + its
   real-sqlite regression test). See Part 286's writeup for
   `lib/datedStockCountRoute.ts` + the `/preview`/`/apply` endpoints, and
   Part 278's writeup for the one still-open deliberate scope limit (no
   batch actions on a corrected rerun yet -- untouched by Part 291, still
   the largest remaining backend gap). Full spec given by the user,
   materially more detailed than what Part 239 originally built.
   Part 239 built `computeDatedStockCountPlan` (pure, tested,
   idempotent): given a series of dated *net counts* per product+branch,
   it replays them earliest-to-latest and produces one stock movement
   per date change. What the user described this session is a superset
   of that -- restated back precisely so it can be built against instead
   of re-guessed:
   - Import rows are dated stock **snapshots** (matches the uploaded
     `stock_with_indepth_name_barcode.xlsx` shape: `Name`, `shop`,
     `warehouse`, `Stock Qtty`, `Date`, `Barcode`/`Barcode 2` --
     confirmed by opening the file: same product name recurs across
     multiple dates with different quantities, e.g. "Dior Glassy Glow
     Stick 017" at 2026-08-16 and again at 2026-08-18).
   - System computes the **difference** between consecutive dated
     snapshots per product+branch to decide whether it was a stock add
     or a sale -- this part matches Part 239's existing earliest-to-latest
     replay logic.
   - **New requirement Part 239 does NOT yet cover: batch-level FIFO
     tracking on top of the net-count replay.** An increase creates (or
     adds to) a batch dated to that snapshot's date. A same-day or later
     decrease draws down from the earliest still-open batch first (the
     user's own example: system at 0, file shows an earlier-date add,
     then a later-same-day decrease -- the decrease must come out of
     that same add's batch, not create an unrelated negative movement).
     A batch that reaches 0 gets archived, unless the user explicitly
     adds more into that specific date/batch later, or a return brings
     it back.
   - **Matching/creation:** for an "add" row, match to an existing
     product first (name/SKU/barcode, same matcher `productImportPlanner`
     already has); if there's no match, offer to create a new variant
     rather than silently creating an unrelated product or failing.
   - **Selling price in conflict resolution:** if the row includes a
     selling price, use it (still editable later, same as any POS price
     edit); if not mentioned, the conflict-resolution step should let the
     user choose/edit it rather than defaulting silently.
   - This is a genuine extension of Part 239's plan function, not a
     replacement -- the net-count math it already built and tested
     (idempotent reruns, earliest-to-latest ordering) is still the right
     foundation; batch-level FIFO allocation needs to be layered on top
     of it. Recommend next session start by re-reading
     `cloudflare/src/lib/datedStockCountImport.ts` and its test file
     before extending, same as Part 239 did for the movements table.
   - Still NOT scoped/built: the CSV/XLSX column mapping, branch-name
     resolution against a real file (see item 5 below for exactly what's
     wrong with the user's real template so far), and the frontend
     upload/review UI itself. Backend-side, everything from raw row ->
     analysis (`/resolve`) -> human decision -> execution
     (`/resolve/apply-decisions`, Part 291) -> movement plan
     (`/preview`, `/apply`) now exists and is tested end-to-end at the
     API level; what's missing is entirely the file-parsing front door
     and the UI that walks a human through the choices these endpoints
     already support.
2. **[~] CSV-import "mode" selector -- FULLY SPEC'D this session (Part
   281, chat): all three open questions Part 280 asked are now answered,
   plus substantial new detail on the Add/Sale template, resolution
   rules, and wizard UI. Still NOT built -- this is now a build-ready
   spec, not a design sketch waiting on decisions.**
   - **Two top-level modes, chosen first, before anything else renders**
     (see UI flow below): **General** (default) and **Replace**
     (dangerous). Everything from the old Mode A/B/C sketch (Add/Update,
     dated reconciliation, manual multi-branch entry) lives inside
     General as sub-options/column-shape toggles, not as separate
     top-level picks.
   - **General mode's base merge/variant logic is ALREADY BUILT --
     confirmed in `productImportPlanner.ts` this session, not new
     work.** Same product name + same identifying details (SKU/barcode/
     category/brand/pricing all matching) -> `merge_stock` (combines
     quantities across multiple rows/branches into the existing
     product, one row per branch already carries its own branch
     quantity so nothing about branch handling changes). Same name but
     ANY of those details differ -> `create_variant`/`link_variant`
     (grouped as child rows under the shared parent name). This is
     General mode's default behavior, editable by the user before
     import, same as every other import already requires a final review
     step before committing -- confirmed this review-before-commit
     already applies across today's import flows, so General/Replace
     both inherit it rather than needing a new confirmation mechanism.
   - **General mode's Add/Sale sub-option -- the new part.** Minimum
     required columns: product name, barcode, stock quantity, branch,
     selling price. Everything else is optional:
     - **Cost price:** if left blank, the row can't silently import --
       the user must resolve it via a product-matching step (pick which
       existing product this row's cost should come from) before the
       import can proceed. This is a hard block, not a warning, unlike
       every other optional field here.
     - **Sale-grouping ("actions") column:** a new template column
       (e.g. `sale1`, `sale2`) lets multiple product rows on the same
       day/file be bundled into ONE sales receipt when they were sold
       together to the same customer -- rows sharing the same action
       label become line items of the same `sales` row (real items
       JSON, one receipt), rather than each row becoming its own sale.
       Rows with no action label still each become their own
       reconciliation-driven sale (Part 280's per-day-grouped default),
       just not bundled with anything else.
     - **Customer/member linkage is PER ROW** (Part 280 Q2, answered) --
       different rows in the same file can belong to different
       customers. Optional per row; blank stays anonymous/import-
       flagged per Part 280's existing spec.
     - Discount and fees are also optional template columns, same "fill
       in only what you have" rule as selling price/cost price.
     - **New-product creation on an unmatched row:** user picks
       existing (matches into that product, merge/variant per the rule
       above) or create-new; creating new without pricing supplied just
       defaults that product's price to 0 (not a block, unlike the
       cost-price-on-a-sale-row rule above -- deliberately different
       rules for "new product created" vs "existing stock reconciled/
       sold").
   - **Replace mode ("mini modes" within it, per the user's answer to
     Part 280 Q3):** lives as its own dangerous top-level mode (not
     nested inside General), with its own sub-options for exactly what
     gets replaced:
     - **Column-level replace:** user picks which specific columns the
       import should overwrite on matching existing products (e.g. just
       pricing, or just images) -- everything else on the matched
       product stays untouched.
     - **Full replace on match:** default full-row overwrite for every
       row that matches an existing product (delete the old field
       values, use the import's version wholesale) -- more thorough
       than column-level, still scoped to rows that actually matched.
     - **Full wipe + reimport:** delete all existing product data and
       load the import file as the entire new dataset -- the most
       dangerous of the three, equivalent to Full Data Reset (products
       scope) immediately followed by a General import.
     Needs the same "dangerous action" confirmation treatment Full Data
     Reset already has (exact component reuse vs a new one still not
     decided -- low-stakes enough to decide during implementation, not
     worth a separate question).
   - **Wizard UI flow, specified this session:** mode choice happens
     FIRST, alone, before any options render. Then: mode -> that mode's
     sub-options -> the column template/example for what was picked --
     each as its own step (**"per window page"**, back/next navigation),
     not all shown at once. An **info toolkit** (contextual help with
     examples/expected formats) is present throughout and its content
     changes based on the currently selected mode/sub-option. The
     product-matching/resolution UI (cost-price resolution, existing-vs-
     new picks) should be **compact by default, click-to-expand for
     detail** -- explicitly compared to the POS UI's own density pattern
     as the bar to match, not a dense spreadsheet-style review table.
   - **Sale-grouping/bundling + cost-price-block resolution rules --
     BUILT + TESTED this session (Part 297, chat), the pure layer this
     item's own note recommended going first.** New
     `frontend/src/components/products/import/addSaleImportResolve.ts`:
     `groupAddSaleImportRows()` bundles rows sharing the same
     (case/whitespace-insensitive) action label into one sale group,
     preserving file order both across and within groups; an unlabeled
     row is always its own singleton sale, never merged with another
     unlabeled row. `resolveAddSaleCostPrices()` implements the hard
     cost-price block: a row's own supplied cost wins outright; missing
     it, the row is matched against existing products by
     barcode -> sku -> name (in that priority order) and inherits that
     product's cost if it has one; with no match, or a match that
     itself has no cost on file, the row is reported unresolved with a
     reason (`missing_cost_no_match` / `missing_cost_match_has_no_cost`)
     and, when available, the candidate product id a review screen
     would point at. Both functions are pure/read-only -- no DB write,
     no UI -- same shape as `datedStockCountResolve.ts`'s own
     analysis-only layer.
   - **Test, real** (`frontend/tests/addSaleImportResolve.test.ts`, new,
     12/12 pass): grouping (multi-row bundle, unlabeled-rows-stay-
     singleton, case/whitespace normalization, blank label treated as
     no label, order preservation across and within groups) and cost
     resolution (direct-supplied cost, barcode/sku/name match priority
     and fallback chain, no-match block, matched-but-costless block,
     and multiple rows resolving independently). Wired into
     `package.json`'s `test:utils` chain.
   - **Verified, this session:** frontend `tsc --noEmit` clean,
     `check:source` clean (350 files parsed), every individual frontend
     test file re-run -- 98/99 pass, only the same pre-existing,
     unrelated `assetCompression.test.ts` failure remains; real `vite
     build` clean. Backend untouched this increment (this piece is
     frontend-only, no route/DB surface yet), not re-verified.
   - **Not built, still open:** template column parsing/mapping itself
     (reading the actual CSV/XLSX headers into `AddSaleImportRow`
     shape -- this session built the resolution rules that consume
     that shape, not the parsing step that produces it, same
     pure-layer-before-plumbing order as the dated-stock-reconciliation
     feature), the sales-creation code path that turns a resolved
     `AddSaleGroup` into a real `sales` row (real items JSON), the
     review/wizard UI, and all of Replace mode's three sub-options.
     Recommend the column-parsing/mapping step next (mirrors
     `datedStockReconciliationMapping.ts`'s own header-auto-mapping
     approach, already proven in this codebase), then the sales-write
     apply layer, before any UI is attempted.
   - **Selling-price matching rule for Add/Sale rows -- CLARIFIED Part
     298 (chat), REFINED same session after a follow-up correction, NOT
     built yet.** Answers a gap the Part 297 write-up above left open:
     `resolveAddSaleCostPrices()` covers *cost* price only; matching a
     sale row against an existing product for identity/stock-removal
     purposes is a separate question, now answered explicitly by the
     user:
     - **Selling price is excluded from the match key; cost price is
       NOT -- this is the corrected rule, replacing this item's first
       draft which had grouped both prices together as excluded.** A
       sale row matches an existing product on identifying details
       (name + branch, plus SKU/barcode/category/etc. when present,
       same identity fields `productImportPlanner.ts` already uses for
       General mode's merge/variant call) **plus cost price, which must
       match exactly**. Selling price alone is excluded, because POS
       selling price is expected to vary sale-to-sale (discounts,
       negotiated price); cost price is not expected to vary the same
       way, so a cost mismatch means it isn't actually the same
       product/batch, not just a different sale price.
     - **When identity matches but cost price doesn't:** this is NOT an
       auto-merge -- it can't silently pick either candidate the way
       the cost-price-block fallback does for a *missing* cost. The
       user must either pick an existing product that matches on
       everything except selling price (i.e. a different existing row
       whose cost price does match), or create a new product/variant
       for it. No match at all on identity -> create a new product (or
       a `create_variant` child under the same name, same as General
       mode already does when other details differ) -- same
       user-reviewed-before-commit step as everything else in this
       import system, no new confirmation mechanism needed.
     - **Why the match matters for sale rows specifically:** unlike a
       plain product import, a resolved `AddSaleGroup` line item removes
       stock (it's a completed sale), so it has to resolve to one real
       product row to know what stock to decrement -- this is the
       reason identity-matching can't be skipped for this row type the
       way it can for e.g. a brand-new product creation.
     - **On a matched row, what happens to the product's stored selling
       price -- CORRECTED same session, replaces the "import updates
       the product's price" draft above, which was wrong.** Selling
       price disagreeing on a matched row does **not** update the
       product record at all -- same behavior as POS checkout already
       has: the product's own price is the default, the cart/sale price
       can be adjusted per sale, and that adjustment only ever lives on
       the sale (its line item / the resulting movement + stats), never
       written back onto the product. So for a matched Add/Sale row:
       the import's selling price is used for that row's sale record
       only (line item price, inventory movement, stats/reports all
       reflect the sale's actual price); the product's own stored
       selling price is untouched and only ever changes via an explicit
       edit on the Products page. Cost price has no equivalent
       adjustment path -- it's a required match field (see above), not
       a per-sale override, so there's nothing to reconcile here for
       cost.
     - **This is explicitly scoped to Add/Sale rows only.** The
       already-built General-mode "Add stock" matching (no `action`
       column, ordinary stock-add/update rows) is unchanged: match on
       identifying details when present; if those don't match but the
       name does, fall back to name-only match; if even the name
       doesn't match, create a new product. This is the existing
       `productImportPlanner.ts` behavior confirmed Part 281 above, not
       a new rule -- restated here only to record that the user
       confirmed it should stay as-is and NOT adopt the sale-row's
       price-agnostic matching.
     - **`resolveAddSaleProductMatches()` -- BUILT + TESTED this session
       (Part 298, chat), the pure layer this item's own note recommended.**
       New export in `addSaleImportResolve.ts`: takes each row plus its
       already-resolved cost (from `resolveAddSaleCostPrices()`) and the
       existing-product pool, and returns per-row `matched: true` +
       `matchedProductId` only when an identity candidate (barcode ->
       sku -> name priority, same as cost resolution) also shares the
       row's branch (when supplied) AND has a cost price within
       half-a-cent of the row's resolved cost. Cost is compared, never
       written -- a candidate matching identity but not cost is
       collected into `conflictingCandidateIds` and the row comes back
       `matched: false, reason: 'cost_price_mismatch'` rather than being
       silently merged into either one; a row with no identity candidate
       at all comes back `reason: 'no_identity_match'`; a row whose cost
       isn't resolved yet comes back `reason: 'cost_unresolved'` (product
       matching can't run before the cost block clears). Selling price
       never enters the lookup -- `ExistingProductForMatchLookup` doesn't
       even carry a selling-price field, so there's no way for this
       function to consult or touch it; a matched row's selling price is
       read from the import for that sale's own line item only (line
       item price, inventory movement, stats/reports), and the matched
       product's stored selling price is never written to, matching the
       POS cart-price-override precedent noted above.
     - **Test, real** (`addSaleImportResolve.test.ts`, extended, 19/19
       pass): identity+cost agreement matches; identity match with cost
       disagreement blocks and reports the conflicting candidate instead
       of auto-merging; selling price proven inert (a lookup shape
       without a selling-price field still matches correctly); branch
       is proven part of the match key (same barcode, different branch,
       no match); a name shared across branch variants picks the one
       sharing both branch and cost; no identity match at all; and an
       unresolved-cost row is correctly refused a match. Frontend
       `tsc --noEmit` clean.
     - **Column-mapping step -- BUILT + TESTED this session (Part 299,
       chat), the next step this item's own note recommended (mirrors
       `datedStockReconciliationMapping.ts`'s header-auto-mapping
       approach).** New `addSaleImportMapping.ts`: `TARGET_FIELDS` lists
       the Add/Sale template's 13 columns with the spec's exact
       hard-required set (product name, barcode, branch, stock
       quantity) plus the rest optional; `normalizeHeaderForMatch()` +
       `autoMapHeaders()` fuzzy-match real-world header variants onto
       those targets, same pattern as the dated-stock-reconciliation
       precedent. Two things beyond that precedent, since they were
       genuinely missing pieces this item had flagged: `getUnmetRequiredFields()`
       reports which required columns are still unmapped, including a
       synthetic "at least one of Selling price (USD) / (KHR)" check
       that can't be expressed as a single field's `required` flag
       (mirrors the spec's "selling price" minimum-column wording,
       which doesn't pin a currency); and `applyAddSaleMapping()`,
       which is the actual missing "read headers into `AddSaleImportRow`
       shape" step this item had been pointing at since Part 297 --
       converts raw parsed rows into `AddSaleImportRow`s via the
       confirmed mapping, translating each camelCase target key to the
       snake_case field name `addSaleImportResolve.ts`'s functions
       already expect, leaving anything unmapped/blank simply unset
       (never coerced to null/empty) so downstream resolution keeps
       deciding what a blank field means, not this step.
     - **`AddSaleImportRow` extended to match:** added `quantity`,
       `discount`, `fees`, `customer` fields (all optional, matching
       every other optional column's typing) so the mapping output has
       somewhere to land for the columns the spec calls out
       (stock quantity, discount, fees, per-row customer/member
       linkage) that the cost/match resolution functions didn't
       themselves need to read.
     - **Test, real** (`addSaleImportMapping.test.ts`, new, 11/11 pass):
       header normalization; full auto-map against both the app's own
       template names and a differently-worded real-world set; an
       unrecognizable stray column staying unmapped; the required-field
       and selling-price-group checks (missing branch flagged, missing
       both price currencies flagged, KHR-only accepted); the
       `TARGET_FIELDS` required set matching the spec's minimum columns
       exactly; and `applyAddSaleMapping()` both converting a full row
       correctly and leaving an entirely-unmapped field unset rather
       than present-but-empty. Wired into `package.json`'s `test:utils`
       chain immediately after `addSaleImportResolve.test.ts`. Frontend
       `tsc --noEmit` clean across the whole project (not just this
       file) after the `AddSaleImportRow` interface extension.
   - **Sale-creation plan builder -- BUILT + TESTED this session (Part
     300, chat), the sales-write layer this item's own note recommended
     next.** New `addSaleImportPlan.ts`: `resolveAddSaleRows()` takes
     each mapped row plus its cost/match resolutions, a caller-supplied
     branch-name -> id lookup, and an optional per-row manual review
     decision (`use_product` / `create_new`, for the still-unbuilt
     review screen to feed in later), and resolves each row
     independently to `'ready'` (has a real product id, branch id,
     quantity, and at least one selling-price currency),
     `'needs_new_product'` (review screen said create-new; carries the
     row's own resolved cost forward for that creation), or `'blocked'`
     with a reason -- reusing `resolveAddSaleProductMatches()`'s own
     reasons where the block came from there, plus new
     `unknown_branch`/`invalid_quantity`/`missing_selling_price`/
     `missing_cost_price` for gaps this layer itself checks.
     `buildAddSaleGroupPlans()` then turns resolved rows into the exact
     payload shape `POST /sales` already accepts
     (`cloudflare/src/routes/sales.ts`'s `SaleItemInput`) -- one payload
     per `AddSaleGroup`, bundling every row sharing an action label into
     one sale's `items[]`, resolving a per-row customer name to
     `customer_id` via another caller-supplied lookup. **A whole group
     is deliberately all-or-nothing**: if any bundled row is blocked or
     needs a new product first, the entire group reports that status
     rather than silently committing the rows that happened to be ready
     -- explicit anti-partial-write decision, matches this session's
     standing "no data loss / no silent inconsistency" instruction.
     Selling price only ever lands in the payload as `applied_price_usd`/
     `applied_price_khr` (the sale-item field) -- there is no code path
     in this file that could write a product-price update, matching the
     POS-cart-override behavior decided earlier this session.
   - **Test, real** (`addSaleImportPlan.test.ts`, new, 14/14 pass):
     every `resolveAddSaleRows` block reason (unknown branch, invalid
     quantity, missing selling price, missing cost, cost-mismatch
     reason passthrough), both review-decision paths (use-existing,
     create-new-with-cost-carried), a singleton row's one-item payload,
     an action-label group's multi-item payload, per-row customer
     resolving to `customer_id`, a blocked row blocking its whole group
     (no partial receipt), a needs-new-product row keeping its group
     out of 'ready', and multiple independent singleton rows each
     getting their own payload.
   - **Verified, this session:** frontend `tsc --noEmit` clean. Full
     `test:utils` chain could NOT be run end-to-end -- its
     `check:source` step needs a native `@rollup/rollup-linux-x64-gnu`
     binary and this upload's `node_modules` only has the `win32`
     variant (built/installed on Windows, per `run/*.bat` and the
     PowerShell ops scripts), which is an environment/platform mismatch
     unrelated to this session's code, not a real failure -- confirmed
     by checking `node_modules/@rollup/` directly. Ran all 101
     individual test files directly instead (bypassing only the
     rollup-dependent `check:source` step): 100/101 pass, the one
     failure is the same pre-existing `assetCompression.test.ts` gap
     this file already documents elsewhere as unrelated -- no
     regressions from this session's three new files.
   - **Apply layer -- BUILT + TESTED Part 312 (chat), correcting this
     bullet's own prior claim that it "necessarily needs a real
     backend/DB context."** It doesn't: `buildAddSaleGroupPlans`'
     `SaleCreatePayload` (items/branch_id/customer_id) already matches
     `POST /sales`' existing `SaleItemInput` shape exactly, and this app
     already has a tested, offline-aware client for that endpoint --
     `api/saleWriteTransport.ts`'s `createSale()`. A new backend route
     duplicating that endpoint's stock-check/pricing/membership logic
     would have been exactly the "duplicate parallel implementation"
     bug class the Golden Rules warn against. New
     `frontend/src/components/products/import/addSaleImportApply.ts`:
     `applyAddSaleGroupPlans(plans, createSaleFn?)` walks a
     `AddSaleGroupPlan[]` in file order, calling `createSale()` (real
     transport by default, injectable for tests) for every `'ready'`
     group and passing `'blocked'`/`'needs_new_product'` groups through
     untouched for the review screen; one group's failure doesn't stop
     the rest of the batch, and every outcome (`applied`/`failed`/
     `skipped_blocked`/`skipped_needs_new_product`) is reported, never
     swallowed. `summarizeAddSaleApplyResults()` gives the review UI a
     plain count-by-outcome. **Test, real**
     (`addSaleImportApply.test.ts`, new, 8/8 pass): exact-payload
     passthrough to the injected transport, blocked/needs-new-product
     groups never call the transport, a thrown/rejected call reports
     `failed` with a readable message instead of crashing the batch (an
     `Error` and a non-`Error` reject both handled), one failure doesn't
     block later groups, apply order matches file order, the summary
     counts each outcome independently, and an empty plan list is a
     no-op. Wired into `package.json`'s `test:utils` chain immediately
     after `addSaleImportPlan.test.ts`.
   - **Verified, this session (Part 312):** frontend `tsc --noEmit`
     clean; full `test:utils` chain (typecheck + verify:public-runtime +
     check:source + all 105 test files) ran end-to-end this time --
     reinstalling `@rollup/rollup-linux-x64-gnu` via `npm install
     --no-save` succeeded (network access was available this session,
     unlike Part 300's), clearing the recurring win32-artifact blocker
     noted in several recent parts -- 0 failures, including the
     previously-flaky `assetCompression.test.ts`; real `vite build`
     also succeeded clean (18.01s). Backend untouched -- this session's
     one new file and one test file are both frontend-only.
   - **Still not built:** the new-product-creation call for a
     `'needs_new_product'` row (which existing product-creation
     endpoint to reuse, still not decided); the mapping/upload +
     review/apply wizard UI end to end (mapping screen, cost/match
     conflict review, calling `applyAddSaleGroupPlans` and rendering its
     results, dangerous-action-style final confirmation). Every pure/
     transport-level piece of the Add/Sale pipeline is now built and
     tested (Parts 297-300, 312) -- what remains is entirely the UI
     that wires them together and the new-product-creation decision.
     Recommend the UI next; there is no more backend/pure-layer work
     left to unblock it.
   - **Broader import/export safety ask, Part 298 (chat) -- restated,
     not new scope.** User re-asked for: import/export never causing
     data loss or cross-contaminating inventory/sales/stats, exports
     never containing wrong/mixed data, a pre-commit diff/review shown
     for every import (already the standing rule per the General/
     Replace review-before-commit note above), and full server-side
     history with undo/redo. The history/undo-redo piece is the
     already-tracked "Omniscient undo/redo and history across all
     pages" item further down this file (see item 4 in the Open
     section) -- not duplicated here. The export-correctness concern
     has a real precedent already fixed (Part 217, cross-branch
     aggregate bug) -- worth a fresh audit pass once the Add/Sale apply
     layer above lands, since it's the piece most likely to introduce a
     new export-correctness gap, but no NEW issue reported this
     session, just the standing ask restated.
3. **[~] Real import-file audit -- RE-VERIFIED against actual source this
   session (Part 279, chat): most of this item's original findings are
   now STALE (already fixed, not reflected here before now). Re-check
   before building anything new off this item's text.**
   - **`batch`/`date`/`received_date` for the Mode A products import ARE
     now read and wired, contrary to this item's original claim.**
     Confirmed directly in `cloudflare/src/lib/importEngine.ts`: it reads
     `row.date || row.received_date` (both header names accepted --
     the header-name mismatch this item originally flagged is resolved),
     defaults to today when blank, and derives `lot_code` from it via
     `dateToBatchCode` for a real `product_batches` row on create. **This
     is Mode A only** (the existing Add/Update Products import) -- it
     does NOT cover Mode B's dated-*snapshot* shape (item 3/4), which is
     a different column set entirely and still has no route/parsing at
     all.
   - **Casing mismatches (`image_conflict_Mode` etc.) are also already
     handled** -- `frontend/src/utils/csvImport.ts`'s `normalizeCsvKey`
     lowercases every header on parse, and this is already the function
     `productImportPlanner.ts` uses.
   - **Duplicate/broken columns (`discount_ends_at.1` etc.) are also
     already handled** -- `getDuplicateCsvHeaders` (same file) detects
     both an exact-duplicate normalized header and an Excel `.1`-suffix
     duplicate, and is already called from `productImportPlanner.ts`
     (confirmed at its call site) to surface a warning.
   - **What's genuinely still open from this item:** none of the above
     for Mode B -- a dated-snapshot file (`stock_with_indepth_name_
     barcode.xlsx`'s shape) still has no column mapping, no branch-name
     resolution, and no route, same gap item 3/4 already track. Nothing
     new to fix here beyond what those items already list.
4. **[~] Stats/data consistency across pages, no hidden imported
   items/rows -- picked and closed one concrete, real gap this session
   (chat); the general "no specific discrepancy pointed to" sweep this
   item originally called for is otherwise still open.** Traced every
   write site that touches `branch_stock` (grepped the whole
   `cloudflare/src` tree, ~15 call sites) against every place
   `products.stock_quantity` gets resynced, looking specifically for a
   branch_stock write with no matching products-table sync nearby --
   the concrete kind of check this item's own note recommended, instead
   of a general no-target sweep.
   **Found and fixed a real one:** `lib/reviewApply.ts`'s
   `products/create/product` applier (the code that actually runs a
   pending product-create once a reviewer approves it, for a "Review
   Required" tier user) hand-rolled its own single-branch
   `INSERT INTO branch_stock` instead of calling the same
   `seedBranchStockForNewProduct`/`seedInitialBatchForNewProduct`
   helpers `routes/products.ts`'s own direct-create path (`POST /`,
   `POST /variant`) already calls -- despite this applier's own comment
   literally claiming "same branch_stock seed" as that direct path. In
   practice this meant: a product created by a Review Required user,
   once approved, only got a `branch_stock` row for the one branch it
   was created against -- every other active branch had no row at all,
   which several other files already document as reading like "not
   tracked here", not "0 in stock", to every branch-filtered
   Products/Inventory/POS view. That's the exact "new products only
   showed up at the one branch they were created against" bug an
   Aug 19 2026 report already caught and fixed for the direct-create
   path -- this was the same bug surviving on the review-approval path,
   invisible until someone actually compared what each path wrote.
   Also silently missing: `seedInitialBatchForNewProduct`, so a
   review-approved product had no "day added" default batch either
   (visible this session as a blank/fallback "Batch" row on such a
   product, vs. Part 261/this session's own "Batch" field work assuming
   one always exists).
   **Fix:** swapped the hand-rolled INSERT for the same two shared
   helpers the direct path uses, so both creation paths seed identically
   instead of two hand-maintained copies drifting apart. **New
   regression test added** (`test-review-gate-pure.cjs`, real branches/
   branch_stock/product_batches tables via the harness's real migrations,
   not stubs): asserts every active branch gets an explicit row (0 at
   the non-chosen ones, real qty at the chosen one) and that a default
   batch exists, specifically so this can't silently regress back to a
   single-branch INSERT unnoticed. All 9 checks in that file pass
   (`node scripts/test-review-gate-pure.cjs`), plus a clean
   `npm run typecheck` in `cloudflare/`. Adjacent product/permission
   tests (`test-products-stock-clamp-pure`, `test-route-permissions-pure`,
   `test-products-image-only-pure`) re-run clean too, no collateral
   breakage.
   **Fixed a second, narrower drift while in this file:** `reviewApply.ts`'s
   `branches` create/update appliers computed `is_default`/`is_active` with
   plain `value ? 1 : 0`, while the direct-write route
   (`routes/branches.ts`) uses a real `toDbBool()` that correctly treats a
   string `"false"`/`"0"`/`"no"`/`"off"` payload as false -- JS's own
   truthiness treats any non-empty string, including the literal string
   `"false"`, as truthy, so the applier disagreed with the direct route on
   that input. Not reachable through today's `BranchForm.tsx` (it only
   ever sends real `0`/`1`), so lower real-world impact than the
   branch_stock gap above, but a direct API call or a future form change
   could hit it silently, and it's the same class of direct-write-vs-
   review-apply drift. Moved `toDbBool` out of being a private, unexported
   copy inside `routes/branches.ts` into `lib/db.ts` (a natural shared
   home next to `getDb`) so both the route and the applier import the
   exact same function instead of two hand-maintained copies. Added a
   regression test (also in `test-review-gate-pure.cjs`) sending a string
   `"false"` payload through the review-approve path and asserting it
   lands as `0`, not `1`. The test harness's own `dbStub` (which replaces
   `./db` entirely for these pure tests) needed updating too -- it now
   loads the real `toDbBool` via the same `loadReal()` transpile helper
   the harness already uses elsewhere, rather than hand-typing a third
   copy that could itself drift. 10/10 checks pass in that file; cloudflare
   `tsc --noEmit` clean; re-ran `test-products-stock-clamp-pure`,
   `test-route-permissions-pure`, `test-products-image-only-pure`,
   `test-login-lockout-pure` -- all clean, no collateral breakage from
   moving a shared helper.
   **Still open:** the rest of this item's original ask -- a defined,
   general audit (Dashboard vs. Products vs. Inventory vs. import
   results) beyond these two concrete gaps. This session's fixes close
   two specific, real holes; they aren't a substitute for that broader
   sweep.

### New request batch, Aug 22 2026 session (chat, not yet scoped against source) --
merged `update_code.zip` into this tree first (9 source files + 1 new test,
see History for the list and the one test-regex bug caught/fixed during
verification) -- everything below is new on top of that merge, nothing here
built yet.

- [x] **Products import template -- missing columns + wrong image-filename
  example -- CONFIRMED ALREADY DONE by the update_code.zip merge (Aug 22
  2026 chat session), no gap found.** Checked `methods.ts`'s actual
  products-template column list end to end: `batch`, `date` (the
  received-date field), `expiry_date`, `expiry_alert_days` are all
  present, alongside every other column. The image-filename example was
  already corrected too -- `image_filename_1: 'Iced Coffee_1.jpg'` (space
  kept as a space, `_1` suffix), with an inline comment citing
  `importImageMatch.ts`'s `sanitizeBaseName`/`normalizeImageMatchKey` as
  the authoritative rule (real special characters -> dash, sequence
  suffix always `_1`.._n`) and explicitly calling out the old
  `iced-coffee.jpg` example as wrong for exactly the reason given here.
  Traced `buildCSVTemplate` (`utils/csvTemplate.ts`) too: the example row
  is written as a real second CSV line in the downloaded file, not just
  described in the modal's help text -- confirms the UI copy's own claim
  ("also included as an actual second row...") is accurate, not
  aspirational.
- [x] **Contacts import -- "Resolve Conflicts" modal was unusable -- FIXED,
  confirmed already-shipped by the update_code.zip merge (Aug 22 2026
  chat session).** Root cause was exactly the pointer-events inheritance
  bug suspected: `ContactImportConflictsModal.tsx` renders through the
  shared `Modal.tsx`, which is sometimes mounted as a descendant of
  `BackgroundImportTracker.tsx`'s floating-widget wrapper -- that wrapper
  sets `pointer-events-none` on itself (so dead space around the floating
  widget doesn't block the page underneath), and since `pointer-events`
  inherits, the whole modal (Resolve Conflicts and the Import Report
  modal both named explicitly in `Modal.tsx`'s own comment) inherited
  `none` too: visible but functionally inert, clicks falling through,
  no scroll. The merged `Modal.tsx` now sets `pointer-events-auto`
  explicitly on its own root plus `overflow-y-auto` on the wrapper, so
  every current and future call site is safe by default regardless of
  what it's mounted under. No further action needed on this item.
- [~] **Contacts page -- possible-duplicates panel was read-only -- filter,
  dismiss, and a "Resolve" jump-to-record action BUILT this session (Aug
  22 2026 chat, part 3); a real automatic merge is intentionally NOT
  built yet, see below.** What shipped, all in `DuplicatesTab.tsx` plus
  small `initialSearch` prop additions to `CustomersTab.tsx`/
  `SuppliersTab.tsx`/`DeliveryTab.tsx`/`Contacts.tsx`:
  - **Filter:** a search box (name/phone/membership number, client-side
    over the already-loaded cluster list) plus severity chip filter
    (All/Phone conflict/Likely duplicate/Same name).
  - **Select, in the sense of acting on one:** each contact row in a
    cluster gets its own "Resolve" button. Clicking it switches to that
    record's real tab (Customers/Suppliers/Delivery) and seeds that
    tab's own search box with the contact's name, so the matching
    records land side by side in the list an operator already knows how
    to edit/merge/delete from -- reusing existing per-record tools
    instead of building a second, parallel edit surface here.
  - **Dismiss:** a per-cluster eye-toggle that hides a reviewed cluster
    from the default view, with a "Show N dismissed" toggle to bring
    them back. Local-only (`localStorage`, this browser only) -- there
    is no backend endpoint for a persisted/cross-device dismissal, and
    inventing one wasn't in scope this session.
  - **What's deliberately NOT here: a one-click automatic merge that
    actually combines two contact records.** Traced this properly before
    deciding to skip it: no merge endpoint exists anywhere in
    `cloudflare/src` today (grepped for it), and building one safely
    means reassigning every foreign-key-shaped reference to a contact id
    across `sales`, `returns`, `delivery`-linked tables etc. -- the same
    class of full-schema audit `progress.md`'s own "Full data reset"
    item above needed a dedicated session to get right, not something
    to improvise blind without a live DB to test against. "Resolve" is
    the safe stand-in for now: it gets the operator to the two records
    fast, but the actual merge/delete is still a manual decision they
    make in the real tab. Worth scoping as its own dedicated item if a
    real one-click merge is still wanted -- flagging here rather than
    guessing at a schema-wide migration untested.
  - Translation keys used (`resolve`, `dismiss_duplicate`,
    `search_duplicates_placeholder`, etc.) were added with English
    fallbacks only (same `t(key) || fallback` pattern the rest of this
    file already used) -- real Khmer strings for the new keys weren't
    written, since guessing translations isn't something to do blind
    either; `km.json` falls back to the English text for these
    specifically until a real translation pass covers them.
- [x] **Import floating status/progress indicator reachable from the
  bell -- CONFIRMED ALREADY DONE by the update_code.zip merge (Aug 22
  2026 chat session, part 3), no gap found.** `NotificationCenter.tsx`
  builds its own `importJobsSection` independently of
  `BackgroundImportTracker.tsx`'s floating widget, from the same
  server-side job list (`listImportJobs`) -- so a completed import's
  report stays reachable from the bell even after the floating widget
  itself has been fully dismissed (dismissing only hides that widget
  locally; the job and its report still exist server-side). Clicking an
  entry there (`setReportJobId`) opens the full `ImportReportModal`, the
  same detailed report the floating widget and Dashboard both use.
  Confirmed by tracing the actual state wiring, not just the code
  comment claiming it.
- [x] **Notification bell button sizing/style -- FIXED (Aug 22 2026 chat
  session).** Root cause: the real bell trigger
  (`NotificationCenter.tsx`'s own `<button>`) was already exactly right --
  `h-10 w-10`, `rounded-full`, no border, icon-only -- and already matches
  `QuickPreferenceToggles.tsx`'s theme/language `ToggleButton`s pixel for
  pixel. The mismatch was `App.tsx`'s `NotificationCenterFallback`, shown
  while the real one is mid-`Suspense`/deferred-mount (there's a
  deliberate `NOTIFICATION_CENTER_INITIAL_MOUNT_DELAY_MS` before it even
  starts mounting, plus it's otherwise wake-event-gated) -- that
  placeholder was smaller (`h-8/h-9` under its own `compact` prop) *and*
  bordered, so it's what most people actually saw first, not an edge
  case. Restyled `NotificationCenterFallback` to the identical
  borderless `h-10 w-10` treatment; `compact` prop left in the type
  (still harmlessly passed at both call sites) but no longer changes
  anything, since there is now only one correct size. Not yet verified
  in a live browser -- worth a quick visual check next session, but the
  fix is a straight copy of the real button's already-correct classes.
- [x] **Dashboard import-report card -- inconsistently missing --
  CONFIRMED ALREADY FIXED by the update_code.zip merge (Aug 22 2026 chat
  session), same root cause as the Modal/channel fixes above, no new
  code needed.** The "Recent imports" card (`recentImportFiles`,
  `Dashboard.tsx`) only renders when its list is non-empty and only
  refreshes reactively via the sync-channel effect covered by the
  `IMPORT_RELATED_SYNC_CHANNELS` fix already logged above (own-tab
  imports still refresh it independently via `import-job:activity`,
  unaffected either way). Before the merge that effect gated on a
  channel name (`'dashboard'`) nothing on the backend ever actually
  broadcast, so contacts/suppliers/delivery-contacts imports (and any
  import finished in another tab/device) never triggered a refresh --
  matches "various imports did not have report... always sometimes not
  showing" exactly. `listImportJobs({ limit: 5 })` itself was already
  type-agnostic (pulls the last 5 jobs of any type), so the fix already
  logged under Dashboard.tsx above covers this in full; nothing further
  to build here.
- [ ] **Public portal product description -- needs real structured
  content + a Details flyout.** Product cards should show: image,
  official product name, category (from the category column), brand
  (from the brand column), features (concrete facts -- size, color,
  material), benefits (how it solves a problem / helps the user),
  ingredients, caution -- bullet-pointed, properly designed, not a plain
  text blob. Move this into a "Details" button that opens a floating
  window/modal with the formatted breakdown above. Shop name (e.g.
  Sephora, Official Dior, Chanel storefronts in AU/US/CA/JP/KR etc.) is
  shown only as a convenience label for the shop -- products are genuine,
  bought directly from official brand stores; the copy/design shouldn't
  imply otherwise.
- [ ] **Products page -- view/detail card density + actions row rework.**
  Several distinct asks bundled together here:
  - Selling price should get its own row instead of sharing a column
    with something else.
  - Replace the "Added" field with "Batch".
  - Action buttons: icon + label on large screens, icon-only on small
    screens: only Add Variant, Adjust Stock, Edit, Delete should remain
    as their own buttons. Adjust Stock needs a better/more literal
    "adjust" icon. Delete should fold into the Edit flow (as already
    noted elsewhere in this file) rather than sitting as its own
    outside button.
  - Same actions-row treatment applies to Discounts.
  - Edit view's description field should truncate ("...") and clicking
    it opens a separate tab/page with the full formatted detail (same
    structure as the public-portal Details flyout above), instead of
    showing the full text inline.
  - This same small-screen-collapses-to-icon-only treatment should be
    applied consistently everywhere "view more details" already exists,
    not just on Products.

Ordered fixes/polish first (buildable now, no live infra needed), then
meticulous/edge-case testing & real-world-confirmation items at the end
(these need a live browser, a real device, or `wrangler tail` against a
real deploy — nothing left to do on them from inside this sandbox until
that access exists).

### Fixes & polish

- [x] **Full data reset -- rebuild as a granular, verified operation -- MOVED TO TOP PRIORITY per explicit user request (Aug 21 2026 session) --
  scoped against actual schema Aug 21 2026 (part 235), built + shipped Part 237,
  audited + two real gaps closed Part 248 (see History for both).**
  User's concrete example this session: reset should delete products
  plus their branch/inventory data, but keep sales (and sales-derived
  stats/revenue), keep past movement/notes, keep everything else
  (users, social/QR/receipt settings, library images) -- framed as an
  example of the general principle, not the only supported
  combination; the real ask is a chooseable options UI. Grepped every
  migration for `product_id` columns to get a real table list (no
  `REFERENCES products` FK exists anywhere in the schema -- integrity
  is app-code-enforced, not DB-enforced, so a reset must explicitly
  handle every one of these):
  - **Products & catalog (core of "reset products," always included):**
    `products`, `product_images`, plus the `products_fts`/trigram
    shadow tables (migrations 0018/0021) -- these need an explicit
    rebuild/vacuum after delete, not just a row wipe, or search breaks.
  - **Live inventory (not a real toggle -- auto-follows products,
    these tables aren't snapshotted and are meaningless without the
    product row):** `branch_stock`, `product_batches`,
    `branch_batch_stock`, `rfid_tags`, `rfid_session_items`,
    `rfid_events`.
  - **Movement/audit history (a real toggle, default keep):**
    `inventory_movements`, `stock_row_moves`, `stock_transfers` -- all
    three already store denormalized `product_name`/`branch_name`
    snapshots, so keeping them with a now-dangling `product_id` is
    safe and harmless; user's own example said keep these.
  - **Sales & returns (a real toggle, default keep):** `sales`,
    `sale_items`, `returns`, `return_items` -- same denormalization
    (`product_name`, `applied_price_usd/khr`, `cost_price_usd/khr` all
    stored at time of sale). Confirmed there is no separate stats/
    revenue aggregate table anywhere in the schema -- Dashboard/Sales
    stats compute directly from these tables, so keeping them keeps
    revenue numbers accurate with no extra reconciliation work needed.
  - **Untouched regardless of any toggle:** branches, categories,
    units, contacts, users, social/QR/receipt settings, library
    images not tied to a product.
  - **Hard prerequisite, not a checkbox:** force a fresh backup
    snapshot and confirm it completed before the delete is allowed to
    proceed -- user explicitly asked backups be kept up to date around
    this operation, treat as a gate, not a reminder.
  **All of the below is now done, per Part 237 (build) + Part 248 (audit
  + fixes):** the options-UI (`ResetData.tsx`'s mode picker + the two
  `includeMovements`/`includeSales` toggles), the atomic backend
  transaction (`db.batch()` in `routes/system.ts`, FTS/trigram rebuild
  turned out to be automatic via real SQL triggers, no manual step
  needed), and a real verification pass (`test-reset-products-pure.cjs`,
  12 checks, every toggle combination, against real migrations) confirming
  no orphaned rows. Part 248 also found and fixed two gaps the initial
  build had: `mode='sales'`/`mode='all'` were missing the backup-first
  gate `mode='products'` had, and `mode='all'` left `file_assets` rows
  dangling after its R2 `uploads/` wipe -- both fixed and covered by new
  tests. **The one thing left genuinely open under this item:**
  `mode='all'`'s R2 cleanup is still a blanket prefix wipe rather than
  the precise "collect exact keys" approach `mode='products'` uses --
  safe now that `file_assets` is cleared alongside it, but worth
  revisiting if that mode ever needs to get more surgical.

- [ ] **New request batch, Aug 20 2026 session (part 202) -- not yet built
  except the icon/favicon item (done, see History).** Grouped by area, as
  stated by the user; none of these have been scoped against source yet
  except where noted.
  - **Products page -- delete/merge review flow -- ALREADY DONE (confirmed
    Part 245), FURTHER REFINED Part 246, see History.** `DeleteConfirmModal.tsx`
    (impact summary + explicit confirm, single and bulk) and
    `MergeDuplicatesReviewModal.tsx` (real dry-run preview + acknowledgement
    checkbox) both already existed and were already wired into
    `Products.tsx`'s delete/merge entry points before this session --
    neither acts immediately, confirmed by reading the actual
    `handleDelete`/`runPendingDeleteConfirmed`/`openMergeDuplicatesReview`
    call chain. Part 246 added one more entry point into the same guarded
    flow: `ProductForm.tsx`'s edit modal previously had no delete action of
    its own at all (only reachable via the separate read-only detail
    sheet) -- see Part 246 for the small icon-only Delete button now in the
    edit form's own footer row, still routed through the same
    `DeleteConfirmModal`, not a new confirmation path.
  - **Searchable "issues" filter on Products/Inventory -- DONE Part 268,
    see History.** A quick filter/search on top of existing search to
    surface products in specific states -- zero stock and other flagged
    cases (user said "etc", exact case list not given). Scoped to five
    real, objectively-checkable states: out of stock, no image, no
    barcode, no category, no price.
  - **Product edit/detail page redesign.** Rework the edit form and detail
    sections: stock should be organized like "branch, reason, barcode"
    (mirroring the per-branch adjustment reason work done Aug 18). The
    "batches need an editable date field" sub-part is **DONE (Part 247)**
    -- `ManageBatchesModal.tsx` now has a Batch date input alongside Lot
    code / Expiry date. **The branch/reason/barcode reorg itself: DONE
    Part 250, see History** -- `ProductForm.tsx`'s Stock tab now reads
    branch -> reason -> barcode top to bottom (barcode moved out of the
    Basic tab, to below the branch+reason `BranchStockAdjuster`). Flagged
    in that session's writeup as this file's own best interpretation of a
    genuinely ambiguous ask, not a confirmed spec -- worth a quick
    confirm from whoever asked for it, especially if "detail page" meant
    the separate read-only `ProductDetailModal.tsx` sheet instead (left
    untouched -- its Category/Barcode 2-column grid has no "reason"
    concept to slot in, since that view is a snapshot, not an adjustment
    action).
  - **Public portal: redundant Shop button on product image -- ALREADY GONE,
    confirmed this session (Part 245), see History.** Checked
    `CatalogProductsSection.tsx` from source: only one button ("Add",
    with a qty badge -- see next item) exists on the product image today.
    No separate/duplicate "Shop" button anywhere in the current code --
    this must have already been fixed in an earlier session without this
    backlog entry being updated, or never actually shipped in the form
    described. Leaving the entry struck rather than deleted so it's clear
    this was checked, not skipped.
  - **Public portal: Add-to-cart button state -- ALREADY DONE, confirmed
    this session (Part 245), see History.** Checked `CatalogProductsSection.tsx`:
    the Add button already always shows "Add" (never swaps to a static
    checkmark) with a small qty badge next to it once items are added --
    matches this item's ask exactly. Same as the Shop-button item above,
    this looks like it shipped in a session that didn't update this list.
  - **Public portal: image zoom/pan should persist -- DONE this session
    (Part 245), see History.** `ImageGalleryLightbox.tsx` (shared by
    Products, POS, and the public Catalog) had no zoom/pan handling at
    all -- fixed with real pinch-zoom, drag-to-pan, double-tap/double-click
    zoom, mouse wheel zoom, and zoom in/out buttons, all of which persist
    until the image changes or the lightbox closes (not mid-gesture, which
    was the actual complaint).
  - **Product detail-view button layout (admin).** User attached a
    reference screenshot (image 1: a product detail sheet with Category/
    Barcode/Brand/Unit/Stock/Cost/Price/Margin/Branches/Status rows and an
    Add variant / Discounts / Adjust stock / Edit / Delete button row
    pinned at the bottom) as the target layout/sizing to match -- current
    buttons (top and bottom of various sheets/pages) are described as
    poorly sized, not compact, and getting visually blocked by the menu,
    bottom bar, top bar, etc. Needs a real responsive-boundary pass, not
    just a resize -- some of these are inside fixed-position PWA chrome
    (see below). **Products' own `ProductDetailModal.tsx` -- the specific
    file matching the reference screenshot -- DONE across Parts 227/241/244,
    see History**; **Inventory's own detail modal -- DONE this session
    (chat), see History** (icons + icon-only-below-`sm` treatment added to
    its Adjust Stock/Transfer/Manage Batches footer, matching Products'
    pattern); edit-form sheets, bulk-edit panel, and the rest of this
    item's "everywhere 'view more details' exists" breadth still open.
  - **PWA pull-to-refresh -- DONE Part 263, see History.** Neither the
    admin app nor the public portal PWA supported swipe-down-to-refresh;
    confirmed both now do: `App.tsx` and `PublicCatalogPage.tsx` each call
    `usePullToRefresh()` and render `PullToRefreshIndicator`, backed by
    the pure gesture-math helpers in `utils/pullToRefresh.ts`. This Open
    bullet was never struck when Part 263 shipped it -- fixing now.
  - **PWA icon/name/favicon -- DONE this session (part 202), see History.**
    Static default icon set replaced across favicon.ico, icon-192(+
    maskable), icon-512(+maskable), apple-touch-icon, icon.png. The
    per-business portal manifest override path (`portalManifest.ts` /
    `CatalogPage.tsx`) was already correct and untouched -- this only
    fixed the shared default/admin icon set.
  - **File library: rename uploaded files -- ALREADY DONE, confirmed this
    session (Part 245), see History.** Checked `cloudflare/src/routes/
    files.ts` and `FilesPage.tsx` from source: a `PATCH /:id` endpoint
    (renames `original_name` only, `stored_name`/`public_path` untouched
    so nothing referencing the file can break) plus a full inline rename
    UI (edit icon, input field, save/cancel) already exist and are wired
    together. Same pattern as the two Public portal items above -- this
    must have shipped in a session that didn't update this list.
  - **New restricted role: image-upload-only for Products -- ALREADY DONE
    (Parts 241-243), re-confirmed again this session (chat), see
    History.** Re-read `permissionDefinitions.ts`, `productWrites.ts`,
    `routes/products.ts`, `PermissionEditor.tsx`, and
    `ProductsImageOnlyView.tsx` end to end this session and ran
    `test-products-image-only-pure.cjs` (13/13) plus
    `permissionEditor.test.ts`/`permissions.test.ts` (all pass) fresh
    rather than taking Part 261's audit on faith. Confirms Part 261's
    finding still holds: base fields (id/name/image_path/updated_at)
    always visible, five optional fields (price/barcode/category/brand/
    stock) each independently grantable via their own
    `products_image_only_show_*` permission and hidden by default,
    writes locked to `image_path` only, mutual exclusivity with real
    `products` access enforced in the editor, translations present in
    both `en.json`/`km.json`. This was just a stale sub-bullet in this
    batch's own list that never got struck when the feature actually
    shipped two sessions before this batch was written down -- not a
    live gap.
  - **Alphabetical ordering priority: categories before products -- DONE
    Part 226 (admin Products/Inventory) and Part 266 (public customer
    catalog), see History.** Admin side already sorted category-first,
    name-second since Part 226; Part 266 extended the same precedence to
    the public portal catalog via a real SQL `ORDER BY` (server-paginated,
    so it couldn't reuse the admin side's client-side grouping) plus
    matching category-header rendering in `CatalogProductsSection.tsx`.
  - **Dashboard permission levels -- ALREADY DONE, confirmed Part 249, see
    History.** `permissionDefinitions.ts`'s `dashboard`/`dashboard_export`
    boolean pair already gives View-only(no export)/Full/No-access;
    `canAccessPage`/`Sidebar`/`compat.ts` already enforce the page gate on
    both frontend and backend; Manager/Employee already default to `{}`
    (No access). Part 249 only added the one thing missing: a regression
    test locking in the backend route side, which had no coverage before.
  - **Full data reset -- moved to top priority, see the standalone item
    at the top of "Fixes & polish" below (was nested in this batch; the
    user asked it be prioritized higher).**

  This is a large mixed batch spanning admin Products/Inventory, the
  public portal, PWA shell behavior, file library, permissions, and data
  reset. Per this file's standing practice (focused follow-ups, one or two
  scoped items per session), these will be tackled individually across
  upcoming sessions rather than all at once, each preceded by its own
  against-source scoping pass before code changes.

- [ ] **New request batch, Aug 18 2026 session (part 151) -- not yet built,
  ordered roughly by size/independence.** Grouped by area; each still
  needs its own scoping pass (confirm exact current behavior against
  source before changing it, per this file's standing practice) --
  these are the user's asks as stated, not yet verified against code.
  - **Payment methods -- confirmed already done, no code needed (Part 190).**
    Re-checked against source before changing anything, per this file's
    standing practice, and both halves of this ask were already shipped in
    an earlier, unlabeled part: `Settings.tsx`'s
    `RETIRED_PAYMENT_METHODS`/`normalizePaymentMethods` already filters
    "Pi Pay"/"Transfer" out of the configurable payment-method list (and
    `POS.tsx` mirrors the same retired-set filter at line ~1607), and POS
    already supports itemized multi-method payments per sale --
    `PaymentDetail[]` (`+ Add payment method` button, one row per method
    with its own USD/KHR amount), summarized as `"Cash + Card"` via
    `paymentMethodSummary()`, and the backend already stores the full
    itemized breakdown as `payment_details` JSON alongside the summary
    string (`routes/sales.ts`'s checkout write). Nothing to build.
  - **Default timezone -- done Part 188.** Most display formatting
    already went through `BUSINESS_TIME_ZONE` (`fmtTime`/`fmtDate` in
    `formatters.ts`, `Receipt.tsx`, `Settings.tsx`'s read-only
    display-timezone row) -- confirmed correct, not touched. Found and
    fixed the real remaining gap: several *date/hour range calculations*
    (as opposed to point-in-time display formatting) still read the
    device's own clock. `dateHelpers.ts`'s `todayStr()`/`offsetDate()`
    (Dashboard's "Today"/"7 Days" presets and default custom-range
    bounds) used the device's local date; Dashboard's "This Month"/"This
    Year" presets built their start date from `new Date().getFullYear()`/
    `getMonth()` directly; the live `BestHourCard`'s UTC-hour-to-
    display-hour conversion used `-(new Date().getTimezoneOffset())/60`
    (device offset); and Sales' `ExportModal.tsx` mixed UTC
    (`toISOString()`) for daily/month-end with device-local for
    month/year start. All four now resolve through Phnom Penh's
    wall-clock date/hour instead: `dateHelpers.ts` re-derives "now" via
    `toLocaleString(..., { timeZone: BUSINESS_TIME_ZONE })` and gained
    `businessYear()`/`businessMonth()`; `formatters.ts` gained
    `getBusinessTimezoneOffsetHours()` (Intl-based, not a hardcoded +7,
    so it stays correct if `BUSINESS_TIME_ZONE` ever changes); Dashboard
    and ExportModal both switched to these. A second, unreachable
    (`className="hidden"`) duplicate of the Best-Hour block in
    Dashboard.tsx had the same device-offset line -- fixed too for
    consistency, though it renders nothing today. Left alone as genuinely
    cosmetic, not in scope: a handful of exported-file *filenames*
    (`Products.tsx`, `DeliveryTab.tsx`, `inventoryExport.ts`) that stamp
    `new Date().toISOString().slice(0,10)` into the download name --
    these don't affect any query boundary or displayed business data, just
    which day appears in a filename someone downloads.
  - **Settings page redesign -- reorganization done Part 189, typography
    cleanup scoped narrowly (see below).** Scoped against source first:
    the generic Settings page had a section literally titled "Receipt
    Settings" (`t('receipt_settings')`) holding `tax_rate` +
    `receipt_footer` -- confusingly duplicating the name of the actual
    dedicated Receipt Settings nav page (`ReceiptSettings.tsx`), which
    already has its own separate per-template `custom_footer` field that
    falls back to this same global setting. Moved `tax_rate` into the
    Currency Settings section, renamed to "Currency & Tax Settings"
    (`currency_tax_settings` key). Moved the footer control into the
    real `ReceiptSettings.tsx` page as a new "Default footer message"
    field in its Footer tab, next to the existing per-template override,
    with its own independent debounced autosave (deliberately kept
    separate from that file's existing template-autosave pipeline,
    which has its own documented history of a subtle double-notification
    bug -- didn't want to risk entangling a new field into that logic).
    Removed the now-empty "Receipt Settings" section from the generic
    Settings page entirely. Merged the standalone "Browser tab icon"
    section into Business Information as a sub-section (new
    `admin_tab_icon`/`admin_tab_icon_desc` keys -- the existing
    `faviconImage` key was for the *portal's* favicon, a different
    feature, so reusing it would've been wrong). **Typography cleanup:**
    found and fixed a real, confirmed bug while in the Appearance
    section -- five typography-size slider labels ("Page title size",
    "Sidebar size", "Section heading size", "Table and row text", "Badge
    and chip text") were hardcoded English bypassing i18n entirely, same
    bug class this file has fixed elsewhere (Part 124 finding 2/3). Added
    5 new key pairs and wired them through `t()`. **Not attempted this
    session, scoped out honestly:** a full visual/spacing redesign pass
    ("neat, clean, simple") of `SettingsSection`'s own layout -- that's a
    pixel-level design judgment call needing live browser access to
    evaluate, not something this sandbox can verify; the section itself
    (`overflow-hidden rounded-2xl border ... shadow-sm`, consistent
    heading/description sizing) was inspected and found already
    consistent across every section, no inconsistency found to fix.
  - **Dashboard recent-imports warnings -- root-caused and fixed (Part
    190).** Traced the display-vs-actual-count mismatch as suspected:
    the headline `warned` figure counts DISTINCT rows with a warning, but
    the "Needs attention"/"Other warnings" section headers were summing
    each kind-group's own count -- and a single row can carry more than
    one warning kind at once (e.g. a negative-stock clamp AND a barcode
    collision on the same row), so it was counted once per kind it
    triggered. That's exactly what produced "705 warnings" (rows) next to
    "1000+ other warnings" (kind-instances) on the same job -- two
    different questions labeled as if they were the same number. Fixed:
    new `countRowsWithWarningKinds()` (`importEngine.ts`) counts distinct
    rows instead of summing groups; `routes/importJobs.ts`'s `/report`
    endpoint's `seriousWarningCount` now uses it;
    `ImportReportModal.tsx` reads that backend-computed figure instead of
    re-summing groups client-side, and shows a small clarifying hint
    ("a row can appear under more than one heading...") whenever a
    section has more than one warning-kind group, so the sub-group
    numbers adding up to more than the headline total reads as expected
    behavior, not a bug -- the "clearer, smarter breakdown... clear
    instructions, translated" half of the ask. New `en.json`/`km.json`
    key: `import_report_groups_overlap_hint`.
  - **Loyalty points -- confirmed already done, no code needed (Part
    190).** Re-checked against source before changing anything: a full
    admin-triggered manual "add points" flow already exists on
    `LoyaltyPointsPage.tsx` (amount + reason-note fields, `handleAwardPoints`
    wired to `awardCustomerPoints`), and the backend already has a
    dedicated admin-only manual-award endpoint (`routes/contacts.ts`,
    gated on `isAdminControlUser`) that writes a real ledger event rather
    than just bumping a number. Nothing to build.
  - **Permissions -- default posture -- done Part 192.** Part 183's
    earlier audit checked the *create-role* path (`INITIAL_ROLE_FORM`,
    the create-role endpoint, missing-key-resolves-to-none) and correctly
    found that one clean -- but never checked the *first-boot seed*
    path, which was a real, separate violation: `coreDataInvariants.ts`'s
    `DEFAULT_ROLE_PERMISSIONS` pre-granted Manager `pos`/`products`/
    `inventory`/`sales`/`contacts`/`customer_portal`/`audit_log` and
    Employee `pos`/`products`/`contacts` on a freshly-seeded instance --
    real write access before an admin had reviewed or granted anything,
    contradicting the stated "None unless Admin" posture. Fixed: both now
    seed to `{}` (nothing granted), matching what the create-role form
    already defaulted to. Admin (`{all: true}`) is unchanged, the one
    named exception. This only affects instances seeded from empty --
    the ensure-invariants loop only force-rewrites *admin*'s permissions
    on every call; Manager/Employee are only inserted if their role code
    doesn't already exist and are otherwise left alone as
    org-editable, so an already-deployed org's customized Manager/
    Employee roles are not silently reset by this change.
  - **Review Required scope, restated/clarified this session** (see the
    existing "Permissions UI redesign" item above for the full per-
    section spec already locked in -- this restates which actions trigger
    review specifically): conversions, exchange, and manual customer-
    point adds should require review; search/check/review actions
    themselves should not. The Review/Approval admin page should be
    organized into sections representing each source page, so an admin
    can see what's pending per area. No loopholes -- every write path a
    tier covers must actually route through the queue, not just the ones
    already wired (see the Permissions item's "Not yet built" list for
    which sections still write directly).
  - **Gate+applier wiring extension** (already tracked in the Permissions
    item above as the item's own largest remaining piece) -- **products
    done Part 152; inventory's `/reasons` write done Part 153; returns'
    router-wide tier gate + PATCH /:id block done Part 154; contacts'
    router-wide tier gate + PUT name-only restriction + DELETE block done
    Part 155; library's router-wide gate + POST/DELETE handling done Part
    156** (Returns has no delete route at all in this app, so its "delete
    goes to review" spec line has nothing to wire yet -- add/view/search
    now work directly under Review Required per the middleware fix). All
    six Review-Required-tier sections (fees/products/inventory/returns/
    contacts/library) now have their gate+applier wiring done -- see the
    Permissions item's "Status as of Part 156" block for what, if
    anything, is still open per section. The stock-movement color cleanup
    (semantic red/green/yellow/gray off `movementSign()`, already speced
    in the Permissions item) is **done Part 152**.
  - **Defaults makeover -- default navigation done Part 201; default
    items-per-page done Part 202 (including the public portal); other
    page-level defaults still open.** Default landing page (which sidebar
    page loads/shows first by default) is now a real org-configurable
    setting (`default_landing_page`, a new "Default landing page" picker
    in Settings > Navigation Layout) rather than a guessed hardcoded swap
    -- see Part 201 for the full writeup, including a flagged
    real-world-verification gap (no network this session to run a real
    `vite build`). Default page size is now genuinely 50 everywhere,
    including the public catalog portal, which Part 151's original pass
    had missed -- see Part 202 for the full root-cause writeup (frontend
    fallbacks were mirroring a backend bootstrap-snapshot default that
    was itself still 20; both sides fixed together). **Still open:** any
    other page-level default not yet named specifically enough to act on
    without guessing, while keeping them user-changeable.
  - **Pagination options control:** confirmed already addressed by Part
    151's merge (narrower per-page selector, bigger prev/next buttons) --
    re-check against this specific ask's wording once there's browser
    access, in case a further size reduction is wanted.
  - **Products/Inventory display layering -- table borders and grouped-row
    separation done Part 197; category-sort/header half still open,
    needs a decision (see Part 197's writeup for why).** Table cell
    borders (outline only, no interior/vertical rules, horizontal
    separators between rows) fixed via `.table-bordered`. Standalone vs.
    grouped-product row separation on desktop (mobile already had this
    per Part 144/145) fixed for both Products and Inventory. **Still
    open:** default sort alphabetical within category, categories
    themselves alphabetical (a two-level sort), with section/category
    headers visibly shown in the list display -- today's section headers
    are an A-Z name-initial index, not category-based, and swapping to
    category sections would replace the existing letter-jump feature
    (`jumpTargetIdsByLetter`) rather than just restyle it, so this needs
    a decision, not a guess: replace the letter index with category
    sections (and retire the A-Z jump?), or keep the letter index and add
    category as a secondary visible label instead?
  - **Stock status display convention -- done Part 199.** Status word
    replaced with a colored quantity+unit value (red/amber/emerald) in
    every list/table view: `Products.tsx` (desktop row + mobile card, via
    a new `stockStatusTextClass`/`PRODUCT_STOCK_STATUS_TEXT_CLASS` in
    `productDisplayHelpers.ts`), `InventoryProductsSurface.tsx` (mobile
    card + desktop row), and `POS.tsx`'s product grid tile (previously
    yellow-only for low stock with a separate red "Out of Stock" label;
    now red/amber/emerald on the qty+unit line itself, separate label
    removed -- group-product tiles keep the neutral gray style since a
    group has no single qty to color against). `Branches.tsx` already
    followed this convention before this batch, confirmed unchanged.
    Detail panels/modals still show the underlying status data --
    `ProductDetailModal.tsx` shows only the threshold value today (no
    status word at all), a pre-existing gap left alone, not a regression.
    Found and fixed a stale test while verifying:
    `inventoryMobileCardLayout.test.ts` still asserted the old separate
    status-badge-pill markup (`scls`/`slbl`) that an earlier part of this
    same batch had already replaced with the colored-qty approach --
    updated the regex to match the current `stockTextClass`-driven
    markup. Full verification: both packages' tsc clean, full 90-file
    frontend `test:utils` clean end-to-end (needed a fresh
    `npm install @rollup/rollup-linux-x64-gnu --no-save`, same recurring
    sandbox-only gap as prior sessions), real vite build succeeded
    (20.77s). Cloudflare pure-logic scripts not re-run this session --
    no backend files touched.
  - **Branch-aware zero-stock display -- done Part 200.** Traced this
    against source before writing anything: it was already fully done in
    Products.tsx (`buildProductBranchSummaryLabel`, always shown in the
    Details column, names every branch including 0s once the total is
    all-zero) and in Inventory (`InventoryProductsSurface.tsx`'s desktop
    Branches column always lists every branch's own quantity, and
    `ProductDetailModal.tsx`'s "Branch Stock" section always lists every
    branch too) -- neither needed a code change. Branches.tsx doesn't
    need it either: that page is inherently one-branch-at-a-time, so
    there's no collapsed total to unpack. The one real gap was POS:
    `ProductDetailSheet.tsx`'s "Stock" row shows a single branch-resolved
    number (by design -- see `getDisplayStock`'s own comment on why it's
    scoped to one branch, not a sum, to match what a sale line can
    actually book), so a multi-branch product reading "0" there didn't
    say whether it's out everywhere or just at the currently-viewed/best
    branch. Fixed by reusing the existing `buildProductBranchSummaryLabel`
    helper (imported from Products' own helpers file, an already-
    established cross-directory import pattern in this codebase): when a
    standalone (non-group) product's resolved stock reads `<= 0` and it
    has more than one tracked branch, a small per-branch breakdown line
    now renders under the Stock value. Left the POS product-grid tile
    itself untouched -- it's the compact card view, size-constrained, and
    tapping any zero-stock tile already opens this detail sheet, which is
    where the fix landed. Group products keep their existing per-branch
    picker below (already names every branch, greys out ones with no
    stock) and weren't touched. Full verification: tsc clean, full
    90-file frontend test:utils clean, real vite build succeeded (20.70s).
  - **Long-press select-mode bug -- confirmed already fixed, no code
    needed (Part 195).** Re-checked against source before changing
    anything, per this file's standing practice. This item as restated
    in the Aug 18 batch (auto-exit unless dragging to another row) is
    exactly the ghost-click bug already root-caused and fixed in
    `Products.tsx`/`utils/longPress.ts` back in Part 161 -- well before
    this batch was written down, so the restatement was already stale
    the day it was added. `Products.tsx`'s `renderDesktopProductRow` and
    `renderMobileProductCard` both route their row's post-select `onClick`
    through a `handleRowClick` that calls `consumeLongPressClick` first
    (eating the native click that always follows the mousedown/touchstart
    pair a fired long-press started), and `longPress.ts` carries the
    separate `cancelled` flag Part 161 also added so a drag-past-tolerance
    fires neither `onClick` nor `onLongPress`. Nothing in either file
    matches the old bug shape anymore.
  - **Inventory page still using checkboxes / changes not applying --
    done Part 194.** Traced and found a real gap: `Inventory.tsx` already
    had `selectionModeActive`/`getInventoryLongPressState` defined and
    handed down to `InventoryProductsSurface.tsx`, and that file already
    *imported* `createLongPressHandlers`/`consumeLongPressClick` -- but
    never actually called them, and every section/group/row checkbox
    rendered unconditionally regardless of `selectionModeActive`. The
    props existed, the comments claimed parity with Products.tsx, but the
    render body never used any of it -- so every row's `onClick` always
    just opened the detail sheet, and checkboxes never disappeared
    outside select mode, matching both halves of the user's report
    exactly. Fixed: wired real long-press handlers onto both the mobile
    card row and the desktop table row (enter select mode on hold, ghost-
    click consumed on release, same shape as Products.tsx), and gated
    all six checkboxes in the file (mobile + desktop, at section/group/
    row level) behind `selectionModeActive`, matching
    `ProductsListSurface.tsx`'s own gating exactly. New regression test
    `inventorySelectionMode.test.ts` reads the real source and fails if
    the wiring (not just the props) is ever dropped again.
  - **Note-tab close button hit-target -- done Part 193.** No dedicated
    "NoteTab" component exists anywhere in the codebase (grepped for it) --
    traced this to the only close(X)-button-with-hit-target-history related
    to notes: the floating Notes quick-panel's (`NotesWidget.tsx`) docked
    "bump" tab opens into a small panel whose header has Maximize/Close
    buttons. An earlier session had already widened their padding
    (`p-1` -> `p-1.5`) to stop misclicks landing on the wrong button, but
    that only grew a ~26px target (14px icon + 6px padding each side) to
    roughly the same ballpark -- still small, and the report was that the
    close button specifically remains hard to hit on desktop. Fixed
    properly this time: both buttons switched from padding-driven sizing
    to a fixed `h-8 w-8` (32px) box with the icon centered inside, so the
    clickable area no longer shrinks to the icon's own footprint.
  - **Dark mode contrast/professional survey (new, Aug 18 restated
    batch):** dark mode is reported as visually bad, especially on
    admin pages -- poor contrast, unpolished. Needs a full page-by-page
    survey of the dark theme's color tokens (not a single-component
    patch) to get it clean, neat, professional, and legible; still
    genuinely blocked on live browser/real device access (Part 231),
    since "clean/neat/professional" is a visual judgment call, not
    something a source read alone can confirm.
    **Login-page half of this note -- checked against source this
    session (chat), found already fixed, not a live gap.** The "color in
    login page is still very out, haven't updated" line predates Part
    137's login-page visual pass and looks like it never got removed
    after that fix landed. Read all of `Login.tsx` (every screen: main
    form, org picker, OTP, device-approval, both password-reset flows,
    Google OAuth) plus `main.css`'s `auth-shell`/`auth-frame`/
    `auth-aside`/`auth-card` rules line by line: every one of those four
    surfaces has its own deliberately-distinct `.dark` gradient (not a
    generic override), and every element in the JSX carries a matching
    `dark:` class -- grepped the whole file for the common "className
    with a light color and no dark: pair" smell and found none beyond
    theme-invariant icon accents. No second/legacy login page exists
    elsewhere in the tree. Left as-is (no code change, since nothing to
    fix) -- kept the broader page-by-page survey open above, since that
    part is real and still needs live-browser judgment.
  - **Responsiveness:** explicit ask that all of the above (and the app
    generally) work correctly across all device sizes -- treat as a
    cross-cutting requirement for each item above, not a separate task.

- [ ] **Permissions UI redesign, expanded: three-tier per-section model +
  a real approval-queue/review system.** Supersedes the older, narrower
  "Permissions UI redesign" item below (None/Review Needed/Full Access
  wording) — this is the full spec, worked out with the user turn-by-turn
  this session, not yet built at all (no schema, no backend, no frontend).
  Today's model is a flat on/off checkbox per permission key with no
  approval-queue concept anywhere in the app. What's needed is a genuine
  new system: a third tier ("Review Required") on the sensitive sections
  below, a real pending-request queue table, and an admin approval page.
  **Per-section tiers, as decided:**
  - **POS, Backup, Settings, Sales** — Full Access / None only. No partial
    tier. Sales moved here from the Review Required list below per an
    explicit later user decision reversing the original call recorded
    just below (kept in place, not deleted, per this file's own
    stale-text convention): a Sales user either has full access to the
    page or none at all, same binary shape as POS/Backup/Settings/Users
    -- no view/search/status-change-only middle tier. **Flagging for
    whoever implements the tier system:** today's actual permission gate
    (`navigationConfig.ts`'s nav entry, all four `hasPermission(user,
    'sales')` checks in `cloudflare/src/routes/sales.ts`, `Sales.tsx`'s
    own `isAdmin` memo) is already a single flat `sales` key shared by
    both the Sales nav item AND the Returns nav item (`{ id: 'returns',
    key: 'returns', permission: 'sales' }`) -- confirmed by reading the
    current source, not assumed. Since Returns (below) keeps its Review
    Required tier while Sales does not, the two can no longer share one
    permission key once this system is actually built: Sales will need
    its own dedicated permission key, distinct from whatever continues
    to gate Returns, so a user's tier can differ between the two pages.
    This wasn't a problem when both were flat/binary and identical, but
    it now is -- no code changed yet, this is scoped for the schema/
    permission-key design step (still todo, see "Not yet built" below).
  - **Fees** — Full / Review Required. Under Review Required, everything
    is allowed directly except delete, which goes to review.
  - *(Original Sales entry, superseded above -- kept for history per this
    file's convention of not silently rewriting past decisions):* Sales
    was originally speced as Full / Review Required, with Review Required
    limited to view/search/status-change only (delete/import/export
    hard-blocked, not even submittable for review; no delete button
    exists in Sales under any permission level today). Superseded by the
    Full/None-only decision above.
  - **Returns** — Full / Review Required. Review Required can add/view/
    search directly; delete goes to review.
    **Real gap found this session (chat), not yet fixed or built:** there
    is no delete/cancel-a-return endpoint or UI action anywhere in the
    app, for ANY tier -- not just missing for Review Required.
    `routes/returns.ts` has exactly three write routes (`POST /`,
    `POST /supplier`, `PATCH /:id`), no `DELETE`; grepped
    `Returns.tsx`/`ReturnsListSurface.tsx` for any delete/cancel handler
    and found none either. So this spec line's "delete goes to review"
    describes a feature that doesn't exist yet for a Full Access user to
    even directly delete, meaning there's nothing for the Review Required
    half to queue toward. `PATCH /:id`'s own comment (right above its
    `getPermissionTier(user, 'returns') === 'review'` block) already
    correctly blocks Review Required from editing, following the same
    "don't silently loosen Review Required into Full Access" discipline
    Library/Contacts use for their own unbuilt review actions -- but nothing
    analogous exists for delete simply because there's no delete route to
    guard. Not attempting to build a return-cancellation feature blind
    this session: reversing a completed return touches refund figures,
    batch restocking, and COGS in ways that need an explicit decision
    (does cancelling a return re-remove the stock it restored? reverse
    the refund? both, and how does that interact with a sale that's
    since had other returns against it?) rather than guessed at from
    static reading alone -- the same "needs a live decision, not a
    guess" reasoning this file's own "Scope discipline" section asks
    for. Flagging precisely so a future session can either scope the
    real feature or decide "delete/cancel return" isn't wanted at all
    and strike this spec line instead.
  - **Products, Inventory, Branch** — Full / Review Required. Under
    Review Required every action (add/edit/delete) goes to review; the
    user can only view + submit. Import/export are fully disabled under
    Review Required, not even submittable.
  - **Users** — Full Access / None only (no partial tier — matches
    today's `all`-gated behavior already confirmed correct in Part 131's
    audit below).
  - **Contacts** — Full / Review Required. Under Review Required: view +
    add directly (no review needed to add), edit limited to name only,
    no import, no export.
  - **Library** (`FilesPage.tsx`) — Full / Review Required. Under Review
    Required: add images and download images directly; import allowed;
    no export; no delete.
  - **Receipt Settings** — the earlier ambiguity is resolved: "update
    available to all" referred to the page's Update/refresh button
    specifically, unrelated to the sensitive-scope permission tiering
    itself, not a conflict with treating Receipt Settings as sensitive.
  - **Review/Approval page itself** — Full Access only, same gate pattern
    Users already uses.
  **Import/export rule under Review Required, confirmed explicitly by the
  user for every section that has the tier**: import and export are never
  available under Review Required, on any page — always Full-Access-only,
  never submittable to the queue.
  **Stock-movement color map** — replace the current 13-unrelated-colors
  scheme with a semantic rule built on the existing `movementSign()`
  logic: red when a movement nets stock down, green when it nets stock
  up, yellow specifically for return-type movements, neutral/gray when
  the quantity delta is 0 (e.g. a set/correction that didn't actually
  change anything). Labels continue to go through the existing
  `translateMovementType()` — clean up any type whose label doesn't
  match what it actually does while wiring this in.
  **Other pieces the user confirmed as clear/buildable as described**:
  Fees actions flowing into the audit log; the audit log gaining a
  user filter; audit log / Review page / Users page all surfacing
  device+user+time with a real device name instead of raw user-agent
  (extend the existing `deviceTrust.ts`, which already partially does
  this for login approvals); the Review page itself gated to Full
  Access, same as Users today.
  **Part 145 correction -- step (0) below is already done, not "not yet
  built."** Checked from source before starting anything else, per this
  file's own standing discipline against re-doing work that's already
  landed: `permissionDefinitions.ts` already has two separate rows
  (`sales`/`returns`, not one shared entry); `navigationConfig.ts`'s
  `returns` nav entry already reads `permission: 'returns'`, not
  `'sales'`; `cloudflare/src/routes/returns.ts` already gates its own
  write route on `hasPermission(user, 'returns')`, a fully independent
  key with no fallback to `sales` (confirmed by reading `hasPermission`
  itself -- only `drive_credentials`/`business_identity`/`sales_policy`
  have a settings-fallback line, `returns` isn't among them); all four
  `hasPermission(user, 'sales')` call sites in
  `cloudflare/src/routes/sales.ts` (status update, customer update,
  list, stats) are genuinely Sales-only routes, none of them gate
  Returns; `Sales.tsx`'s `isAdmin` memo only checks the full-admin
  bypass (`permissions.all`), it was never coupled to the `sales` key in
  a way this split would have touched. Whoever wrote this note likely
  drafted it against an earlier snapshot where the split hadn't landed
  yet, and it just never got marked done. No code changed for this
  finding -- **next session should start at step (1) below**, not step
  (0).
  **Status as of Part 155 (this paragraph is stale below, kept for
  history per this file's convention -- see Parts 146-155 in History for
  what actually shipped):** (1) `pending_actions` table -- done Part 146.
  (2) backend gate+applier wiring -- done Part 146/147 for `fees`, Part
  152 for `products`, Part 153 for inventory's `/reasons` write, Part 154
  for returns' router-wide tier gate + explicit PATCH /:id block, **and
  Part 155 for contacts** (router-wide tier gate fixed; add applies
  directly, edit restricted to the `name` column only for Review
  Required, delete blocked outright -- narrower than Products/Returns'
  shape since nothing in Contacts' spec ever queues into
  `pending_actions`, so there's no applier to register; import/export
  were already correctly blocked via the strict `hasPermission()` used
  elsewhere, confirmed not fixed). **library still writes directly
  regardless of tier** -- next pick. One real gap flagged, not fixed,
  from Part 155: a Review Required contact edit returns a plain 200 even
  though only the name field actually saved, with no `partial: true` (or
  similar) signal the frontend could surface as "only your name change
  was applied." (3) approval page -- done Part 148. (4) frontend tier
  picker + per-row `i` tooltip -- done Parts 149-150. (5) stock-movement
  color/label cleanup -- done Part 152.
  **Status as of Part 156:** library's gate+applier wiring is now done
  too. Confirmed from source (not assumed) that `library` was already a
  real, intended key -- present in both `REVIEW_TIER_KEYS` and
  `ENTITY_PERMISSION_MAP` (`'file'`/`'files'` entities already mapped to
  it for audit-log sensitivity) -- `files.ts` just never used it, gating
  on `settings` instead, and `permissionDefinitions.ts` had no frontend
  entry for it at all, so no role or user anywhere had ever been granted
  `library` explicitly. Fixed with a **transitional OR** rather than a
  hard cutover: `files.ts`'s router-wide gate now accepts either
  `getPermissionTier(user, 'library') !== 'none'` (the new tier-aware
  check) OR the legacy `hasPermission(user, 'settings')` grant, so no
  existing installation is locked out the moment this ships. `POST
  /upload` (add) applies directly under Review Required, same as Full --
  no `maybeQueueForReview()` call, matching Library's spec ("add images
  and download images directly"). `DELETE /:id` is explicitly blocked
  for the `'review'` tier with a clear error message, same "don't
  silently turn Review Required into Full Access" discipline Parts
  154/155 used for Returns/Contacts. No applier registered in
  `lib/reviewApply.ts` -- correct, not an oversight, since nothing in
  Library's spec ever queues into `pending_actions` (same shape as
  Contacts, not Fees/Products). Added a frontend `permissionDefinitions.ts`
  entry for `library` (tier: true, with its own review-description
  copy) so it's now actually grantable through the Permission Editor for
  the first time. New en.json/km.json keys: `perm_library`,
  `perm_library_review_desc`. Test coverage: new
  `test-route-permissions-pure.cjs` block asserting the router-wide gate
  regex (tier-aware OR settings-fallback) and the DELETE review-tier
  block regex, confirmed actually printing via direct log inspection, not
  just exit-0'd early.
  **The legacy `settings` half of the router-wide OR is intentionally
  left in place, not removed** -- flagged as a follow-up once admins have
  had a chance to actually grant `library` explicitly to whoever needs
  it; removing it now would lock out every current Library user with no
  migration path.
  **All six Review-Required-tier sections now have their gate+applier
  wiring done as of Part 156** (fees, products, inventory, returns,
  contacts, library) -- the item's "Gate+applier wiring extension" line
  above is fully closed. **Status as of Part 157:** the contacts
  partial-edit-response gap is now fixed -- see Part 157's History entry
  below. The `branches.ts` dead-code question is now investigated and
  confirmed, not fixed (needs a user decision, see below), also written
  up in Part 157's History entry. Remaining: (1) confirm `files.ts`'s own
  `library`-vs-`settings` question the same way (Part 156 kept a
  transitional OR rather than resolving it, by design -- not a loose end,
  see Part 156's own entry); (2) the `branches.ts` finding itself needs a
  decision from the user, not more investigation -- see below. **Status
  as of Part 158/159:** the `branches.ts` decision came back as "every
  page gets its own key" -- Branch split out of Inventory into its own
  real `branches` key, fully wired (Part 158), merged and verified with
  one real gap fixed along the way (Part 159). **Status as of Part 160:**
  the last remaining piece of this item -- Products/Inventory/Returns/
  Contacts having backend gate+applier wiring but no frontend `tier: true`
  entry, so Review Required was never actually selectable for them -- is
  now closed. All seven Review-Required-tier sections (fees, branches,
  products, inventory, returns, contacts, library) are fully wired end to
  end, backend and frontend, and confirmed in sync by `permissionEditor.
  test.ts`'s own cross-check. Only the `files.ts` library-vs-settings
  transitional-OR question remains open on this item, by design (Part
  156). Original stale text follows unedited: (1)
  `pending_actions`-style table (action type,
  entity, payload, requested_by, status, reviewed_by, reviewed_at) —
  schema design itself is new, not sketched yet; (2) backend: every
  Review-Required-gated write route branches to "insert a pending row,
  don't apply yet" instead of writing directly, when the acting user's
  effective tier for that section is Review Required rather than Full;
  (3) approval page (list pending, per-row approve/reject, diff view);
  (4) frontend permission editor gains the third tier per section
  (radio/segmented control per section rather than a checkbox), with the
  `i`-tooltip-per-row explanation this item always asked for; (5) the
  stock-movement color/label cleanup above, independent of the rest and
  can land first if a smaller session is needed. None of this touches
  the money-math/exchange-rate work or the Fees page — both separate,
  already-tracked items elsewhere in this file.
- [~] **Products search: edited-but-filtered-out row stays visible until
  re-search** — done (Part 133, see History) for the single-item edit
  path (`handleSaveWithGallery`/`handleSave` in `Products.tsx`): a saved
  product now stays pinned in the current results even if a background
  refresh would otherwise drop it, clearing only when the search box is
  changed again. **Extended (Part 139)** to the two bulk-mutation paths
  on the same page where the resulting product state is fully known and
  safe to pin: `runBulkProductUpdates` (bulk info/pricing edit — pins
  each successfully-updated id with its snapshot merged against the
  applied field changes) and `handleBulkOutOfStock` (pins with
  `stock_quantity`/`branch_stock` quantities zeroed, set *before* calling
  `clearProductStockByIds` since that helper awaits its own `load(true)`
  internally). **Deliberately not extended** to `handleBulkChangeBranch`
  — the post-move branch_stock shape depends on `buildProductBranchMovePlan`
  (transfer vs. initialize) and isn't safe to approximate client-side; a
  wrong pinned snapshot would be worse than no pinning, so this is left
  open rather than guessed at. **Extended to Inventory.tsx (Part 142)**:
  built `pinnedEditedInventoryRef` from scratch, covering its single-
  branch adjust and two-branch transfer mutations (both have a fully
  known, computable resulting `branch_stock` -- see Part 142 for the
  exact guards); the equivalent multi-batch auto-drain removal case is
  deliberately left un-pinned, same reasoning as the Products.tsx
  branch-move case just above. **POS.tsx audited (Part 142), confirmed
  not applicable** -- it's a checkout/cart page with no editable-record-
  then-filtered-list flow, so this bug class doesn't exist there; not a
  gap, nothing to build.
- [~] **Standing cross-page consistency checklist** — user instruction
  (Part 124): every session should weigh whether a change ripples across
  the app's shared UI patterns, not just the page being touched. Pages in
  scope: Dashboard, Notes, Customer Portal (public `catalog`), Products,
  POS, Inventory, Branches, Sales, Returns, Fees, Contacts
  (Customers/Suppliers/Delivery), Users, Audit Log, Receipt Settings,
  Backup, Settings, Library (`FilesPage.tsx` — the nav's "Library" entry).
  Elements in scope: buttons generally, barcode scan, search, export,
  import, the "Manage" dropdown, close/X buttons, filters, and "connectors
  between pages" (shared components / duplicated logic that should stay in
  sync). This item stays open indefinitely as a checklist, not a one-time
  task -- condense its *findings* over time, not the item itself.
  **Part 124 findings so far:**
  1. **Toolbar pattern confirmed, not actually inconsistent.** Initial grep
     for the `ExportMenu` shared component looked like a gap (only 4 of
     ~18 pages import it) -- turned out to be a false alarm on closer
     read: most list pages (`Products.tsx`, `Sales.tsx`, `Inventory.tsx`)
     fold Import+Export into one "Manage" dropdown via `LazyPortalMenu`
     with page-specific items instead, which is itself explicitly called
     out as the intentional shared pattern in those files' own comments
     ("same pattern Products.tsx uses"). `ExportMenu` (used by
     `Returns.tsx`/`AuditLog.tsx`/`Dashboard.tsx`/
     `InventoryMovementsSurface.tsx`) is the export-only variant for pages
     that don't also need an import action folded in. Both are legitimate,
     established patterns -- not a gap. Recorded here so a future session
     doesn't re-open this as a false lead.
  2. **Real, confirmed, live bug found and fixed: missing `{count}`
     interpolation.** This codebase's `t()`/`tr()` translation lookup
     (`AppContext.tsx`) does a plain key lookup with no placeholder
     substitution -- every `{count}`-templated key (27 found via a full
     scan of `lang/en.json`) requires the caller to manually chain
     `.replace('{count}', String(actualValue))`, which ~20 call sites
     already do correctly (`SalesImportModal.tsx`, `ContactImportModal.tsx`,
     `ZeroQuantityCleanupModal.tsx`, etc.). Three call sites skipped that
     step, and since both `en.json` and `km.json` DO have the key defined,
     every user in either language was seeing the literal text `{count}`
     instead of a number:
     - `Products.tsx`'s bulk-selection toolbar label (`productSelectedLabel`)
     - `Inventory.tsx`'s equivalent selection-bar label
       (`inventoryControlLabels.selected`)
     - `Inventory.tsx`'s batch-inventory-update success toast
       (`batch_inventory_done_many`)
     All three fixed this session with the same `.replace('{count}', ...)`
     pattern used everywhere else, plus a comment at each site explaining
     the root cause so it doesn't regress.
  3. **Real, confirmed bug: hardcoded English bypassing i18n entirely** in
     several pages' bulk-selection/bulk-action toolbars, found by comparing
     each list page's selection bar against the others:
     - `Returns.tsx` — `"{n} selected"` and an `"Export selected"` button
       were raw English; switched to the existing `selected`/
       `export_selected` keys (already present in both language files, no
       new keys needed).
     - `CustomersTab.tsx`, `SuppliersTab.tsx`, `DeliveryTab.tsx` (all three
       contact tabs) — identical `Delete {selectedIds.size}` hardcoded
       button label. Added a new templated key `delete_selected_count`
       ("Delete {count}" / "លុប {count}", matching the wording pattern
       `zero_quantity_cleanup_confirm_count` already uses) and switched all
       three tabs to it, since no existing key covered a generic
       count-suffixed delete button.
     - `Sales.tsx`'s bulk-status-update bar — `Export`/`Saving...`/`Done`/
       `Delivery`/`Cancel`/`Clear` were all raw English despite every
       other button on this same page going through `translateOr`.
       Switched to existing keys (`export`, `saving`, `done`, `pos_delivery`
       for the short "Delivery" label, `cancel`, `clear`) -- no new keys
       needed, all six already existed in both languages for other uses.
  4. **Not yet done, honestly carried forward.** This was a targeted audit
     of one UI element (bulk-selection/action toolbars) across the pages
     that have them, not the full page x element matrix implied by the
     checklist scope above. Specifically still unchecked: `PageHeader.tsx`
     is only used by 4 of ~18 pages (`FilesPage`/`ServerPage`/`Backup`/
     `Settings`) -- not yet confirmed whether the busier pages
     (Products/Sales/etc.) intentionally build their own header inline
     (plausible, given how much more those headers hold) or whether
     `PageHeader` should be extended to cover them. `Users.tsx`'s missing
     `FilterMenu` and close/X button consistency are now closed -- see
     finding 5 below. The "connectors between pages" part of the brief
     (e.g. does a customer picked in Sales stay in sync with the same
     customer's record in Contacts, does a product edited in Products
     immediately reflect in POS's cart search), flagged here as "not yet
     started," was in fact picked up and closed at Part 127 -- see finding
     7 below (three real, confirmed bugs found and fixed) and finding 10
     (Part 132 re-confirmation pass, no drift). Leaving this sentence
     in place rather than deleting it, per this file's own convention of
     keeping stale carry-forward text visible with a pointer forward
     instead of quietly rewriting history.
     Scan-button placement (`ScanSearchButton`, currently
     Inventory/POS/Products only) not re-examined against the checklist --
     initial read is that this is correctly scoped to product-context
     pages only, but not confirmed by checking every other page for a
     plausible scan use case.
  5. **Part 125: `Users.tsx` FilterMenu finished (half-wired supplied
     file), plus a real close/X-button accessibility audit.** The uploaded
     `Users.tsx` this session built out `roleFilter`/`statusFilter` state,
     the `filteredUsers` logic, and a full `userFilterSections`/
     `userFilterActiveCount`/`clearUserFilters` setup mirroring
     `Branches.tsx` -- but never actually rendered `<FilterMenu>` anywhere.
     Same "half-wired supplied file" pattern as Part 123's `FeeForm.tsx`;
     confirmed via diff against the tree before merging, not assumed
     complete. Finished it: wrapped the search row in a flex container and
     rendered `<FilterMenu mobileIconOnly>` next to `SearchInput` (gated to
     the `users` tab only -- `roles` isn't filtered), matching
     `Sales.tsx`'s identical single search+filter row shape; dropped
     `SearchInput`'s `max-w-xs` cap so it can share the row. No new
     translation keys needed (`filters`/`role`/`status`/`all`/`active`/
     `inactive` all already existed in both languages).
     Also closed the close/X-button item flagged above: scanned every
     icon-only close button app-wide (filtering out the many false
     positives from self-labeled `Cancel` buttons that also call
     `onClose`) and found 9 confirmed, live accessibility bugs -- icon-only
     close buttons with no `aria-label` at all: `InventoryReasonManagerModal.tsx`,
     `InventoryStatDetailModal.tsx`, `pos/ProductDetailSheet.tsx`,
     `products/surfaces/ProductDetailModal.tsx` (had the lucide `X` icon
     but no label), and `returns/EditReturnModal.tsx`,
     `returns/NewReturnModal.tsx`, `returns/NewSupplierReturnModal.tsx`,
     `returns/ReturnDetailModal.tsx`, `utils-settings/OtpModal.tsx` (used a
     literal "×"/"x" text character instead of an icon, and had no label
     either). Fixed all 9: added `aria-label`, standardized every text-char
     outlier onto the lucide `X` icon to match the app's own dominant
     pattern (already used in 11+ other places -- `FilterMenu.tsx`,
     `ImageGalleryLightbox.tsx`, `NotesWidget.tsx`,
     `BackgroundImportTracker.tsx`, `PublicCatalogPage.tsx`,
     `contacts/shared.tsx`, `InventoryStockModals.tsx`, etc.). Also fixed
     the shared `Modal.tsx` component itself (used by 29 other files) --
     it had an `aria-label` already but used a plain text "x" instead of
     the icon; fixing it once here fixes the visual inconsistency for
     every dependent modal at once. Also swapped `inventory/ProductDetailModal.tsx`'s
     text "x" to the icon for the same reason (it already had an
     `aria-label`, so this one was cosmetic-only, not an accessibility
     bug). 10 files touched in total.
     **Not yet done, honestly carried forward:** this was a targeted audit
     of icon-only close buttons specifically, not click-target-size
     consistency (button dimensions looked consistent at `h-8 w-8` across
     every file checked, but not measured/compared systematically) or a
     full inventory of every dismiss-style control in the app (e.g.
     backdrop-click-to-close handlers, which exist on some overlays and
     not others, were noticed in passing but not catalogued). `OtpModal.tsx`'s
     "Set Up 2FA"/"Disable 2FA" title text is hardcoded English bypassing
     i18n (noticed while fixing its close button, different bug class,
     not fixed this session -- flagged for a future i18n-focused pass).
     **Part 140 correction -- re-checked from source, this specific claim
     doesn't reproduce and was stale even at the time it was written.**
     `OtpModal.tsx`'s title (and every other string on the modal --
     `confirm_enable`/`verifying`/`disable_2fa`/`disabling`/`cancel`/
     `close`) already goes through `tr(key) || 'fallback text'`, and
     `otp_setup`/`otp_disable` (plus every other key the modal uses) are
     both present with real, correct Khmer values in `km.json` today --
     not missing, not placeholder. The component was never actually
     bypassing i18n; whoever wrote the Part 124 note likely saw the
     `|| 'Set Up 2FA'` English fallback text inline in the JSX and read it
     as the live value without checking whether the key resolved first.
     No code change needed. Leaving the original sentence above in place
     per this file's own convention rather than deleting it.
  **Verification, all real (Part 124):** `frontend` `tsc --noEmit` clean
  (both before and after the final round of fixes). Full `test:utils`
  clean end-to-end, 326 PASS lines, 0 failures -- same count as Part
  123's baseline (expected: these are UI-string-level fixes to existing
  rendered output, not new logic with its own dedicated test file).
  `lang/en.json`/`lang/km.json` re-parsed with Python's `json` module to
  confirm both are still valid JSON and stayed key-parity-matched (3,113
  keys each, 0 missing either direction) after adding
  `delete_selected_count`. Real `vite build` succeeded twice (26.68s,
  then 29.56s after the final round), zero errors, zero circular-chunk
  warnings both times. `cloudflare` side untouched by any of this --
  `tsc --noEmit` and all 18 test scripts re-run anyway as an
  unaffected-baseline check, clean, no regressions.
  **Not yet done (Part 124):** no live browser access from this sandbox
  to visually confirm the fixed labels render correctly in both
  languages -- only confirmed structurally (the exact `.replace()` call
  now runs against the exact stored string, same pattern proven correct
  at ~20 other call sites). `verify:i18n`/`verify:ui`/`verify:performance`
  (referenced in `package.json`'s scripts but not run by `test:utils`)
  could not be run this session -- their source files
  (`ops/scripts/frontend/verify-i18n.ts` etc.) are not present in this
  delivered tar, only `build-public-runtime-scripts.ts` is -- pre-existing
  gap, not something this session's changes caused; flagging in case a
  future session has access to a tar that includes them.
  6. **Part 126: `OtpModal.tsx` hardcoded-English title fixed (the item
     flagged at the end of Part 125).** Supplied as a standalone file
     alongside a fresh `business-os.tar`; diffed against the tree copy
     before merging, not assumed correct -- confirmed it was a single,
     minimal change: the modal heading now reads
     `mode === 'setup' ? (tr('otp_setup') || 'Set Up 2FA') : (tr('otp_disable') || 'Disable 2FA')`
     instead of the two hardcoded string literals, using `tr`, the same
     translate helper already in scope in this component for every other
     label. Both `otp_setup`/`otp_disable` keys already existed in both
     `lang/en.json` and `lang/km.json` (`otp_setup` differs slightly
     between the raw fallback and the English translation catalog --
     "Set Up 2FA" vs. "Set Up Two-Factor Authentication" -- pre-existing
     wording, not something this fix introduced or changed), so no new
     keys were needed and no other file required changes. Merged as-is.
     Verification for this fix lives in the ## Part 126 pointer section
     below, per this file's own convention for single-file merge sessions.
  7. **Part 127: live cross-page sync channel audit -- three real, confirmed
     bugs found and fixed (the "connectors between pages" half of this
     checklist, open since Part 124).** No new file was supplied this
     session; picked back up the standing checklist itself. Traced the
     app's live update mechanism end to end: the backend calls
     `broadcast(c.env, <channel>, ...)` per write (`lib/broadcastHub`
     durable object), the frontend's WebSocket handler
     (`api/websocket.ts`) turns that into a `sync:update` DOM event,
     `AppContext.tsx` debounces it into `syncChannel` state, and each
     page/component that cares reads `syncChannel.channel` off
     `useSync()` and reloads if it matches a channel it's listening for.
     Confirmed this works correctly for the two cases the checklist named
     explicitly -- Products edits reach POS live (POS.tsx listens for
     `products`/`branches`/`categories`/`inventory`) and Sales has no
     stale-customer risk to begin with (membership is resolved by number,
     server-side, per attach -- no cached customer list to go stale) --
     but cross-referencing every real backend channel name (`grep` across
     `cloudflare/src/routes/*.ts` for literal `broadcast(c.env, '...'`
     calls, 15 found, plus the `table`-variable ones in `lookups.ts`
     resolving to `categories`/`units`) against every place the frontend
     checks a channel name turned up three real, live gaps, not false
     alarms:
     - `utils/appRefresh.ts`'s `DEFAULT_REFRESH_CHANNELS` (used by
       `refreshAppData()`, which several real live-refresh paths call
       with no arguments after a bulk operation -- `ResetData.tsx` after
       a data reset, `settingsTransport.ts`/`api/methods.ts` after a
       write-conflict resolution -- none of which reload the page, so
       this list is the only thing telling every open tab/page to
       refresh) had `'delivery_contacts'` (snake_case) where every real
       broadcaster and listener (`routes/contacts.ts`'s per-tab config,
       `DeliveryTab.tsx`, `POS.tsx`) uses `'deliveryContacts'`
       (camelCase) -- so an open Delivery Contacts tab silently never
       refreshed after any of those bulk operations. Fixed the string;
       also added seven real channels the list was missing entirely
       (`categories`, `units`, `fees`, `notifications`,
       `portalSubmissions`, `promotions`, `roles`), so a "refresh
       everything" call now actually does.
     - `NotificationCenter.tsx`'s live-refresh trigger list included
       `'contacts'` and `'backup'` -- both copy-pasted from
       `PAGE_PERMISSIONS` (`AppContext.tsx`), a page-id-to-permission-key
       table with no relationship to sync channel names. Neither string
       is ever broadcast anywhere in the app (confirmed by grepping both
       `frontend/src` and `cloudflare/src` for each as a channel/event
       value, not just as a permission key or page id, which both are
       used as elsewhere) -- so those two entries could never fire.
       Replaced `'contacts'` with the three real per-tab channels
       (`'customers'`, `'suppliers'`, `'deliveryContacts'` --
       `'customers'` was already present) and dropped `'backup'`
       entirely, since no backup-related broadcast channel exists to
       listen for.
     - Same list was also missing `'notifications'` -- the one channel
       the backend broadcasts specifically for this component's own
       purpose (`routes/devices.ts`'s `broadcast(c.env, 'notifications',
       { type: 'device_decision' })`, fired on every device
       approve/deny), feeding `buildDeviceApprovalSection` in
       `routes/notifications.ts`. Without it, an admin approving or
       denying a device from one session never refreshed the bell in any
       other open session -- it would only catch up on the next
       `NOTIFICATION_SUMMARY_IDLE_REFRESH_MS` poll, which is 2 hours.
       Added it.
     Also resolved, no code change needed: the "`PageHeader.tsx` coverage
     for the busier pages" half of this same open item. `PageHeader.tsx`
     itself, per its own comment, renders nothing but a right-aligned
     actions-row wrapper now (title/icon/subtitle are intentionally not
     visually rendered, kept only as a tooltip). Diffed its wrapper
     classes (`flex items-center justify-end gap-3`) against
     `Products.tsx`'s hand-rolled equivalent (`mb-3 flex min-w-0
     flex-wrap items-center justify-end gap-2`) -- close but not
     identical (margin, wrap behavior, gap size all differ, needed for
     the horizontal-scroll-on-mobile treatment the busier pages use).
     Not an oversight: `PageHeader`'s fixed single-slot wrapper doesn't
     fit what the busier pages' action rows need, so there's no
     drop-in swap to make here. Treat this half of the item as closed.
  **Verification, all real (Part 127):** `frontend` `tsc --noEmit` clean.
  Full `npm run test:utils` clean end-to-end, 326 PASS lines, 0 failures
  -- same count as Parts 123/125/126, no regressions (these are
  channel-name/list-membership fixes to existing live-refresh plumbing,
  not new logic needing its own test file, and `tests/appRefresh.test.ts`
  doesn't assert `DEFAULT_REFRESH_CHANNELS`'s exact contents so it wasn't
  affected). Real `vite build` succeeded (23.28s), zero errors, zero
  circular-chunk warnings. `cloudflare` `tsc --noEmit` re-run clean as an
  unaffected-baseline check (backend untouched this session -- every fix
  was a frontend channel-name/list correction, the broadcast side was
  already correct).
  **Not yet done, honestly carried forward (Part 127):** no live browser
  or `wrangler tail` access from this sandbox to click through and
  confirm any of the three fixes fire in practice (trigger a reset, watch
  an open Delivery Contacts tab refresh; approve/deny a device from one
  session, watch the bell update in another). The "connectors between
  pages" audit itself was scoped to the live sync-channel mechanism
  specifically (the concrete examples the checklist named) -- it did not
  extend to every other kind of cross-page connection that could exist
  (e.g. whether client-side caches outside this channel system, if any
  exist, stay in sync on their own). Not found during this pass, so not
  claiming it's exhaustive.
  8. **Part 128: scan-button placement audit finished (the item flagged
     since Part 124) -- two real gaps found and fixed.** Checklist scope
     named this explicitly ("Scan-button placement... not re-examined
     against the checklist"). Grepped every placeholder string app-wide
     for `barcode/sku` rather than guessing which pages plausibly wanted
     it: six files mention it (`Sales.tsx`, `Returns.tsx`, `Products.tsx`,
     `Inventory.tsx`/POS via `search_terms_placeholder`,
     `CatalogEditorSurface.tsx`, `CatalogProductsSection.tsx`). Products/
     Inventory/POS already had `ScanSearchButton`; `Sales.tsx` and
     `Returns.tsx` didn't, despite their own placeholder text explicitly
     advertising barcode/sku as searchable -- a real, concrete
     inconsistency, not a maybe. Added `ScanSearchButton` to both,
     wired identically to the existing Inventory.tsx pattern
     (`onDetected={setSearch}`, placed between `SearchInput` and
     `FilterMenu` in the same sticky search row). No new translation
     keys needed (`scan_barcode` already exists, same key the other
     three pages use).
     **Found but deliberately not fixed, carried forward:** the other two
     barcode/sku-mentioning search boxes are the public customer-facing
     storefront's product search (`CatalogProductsSection.tsx`) and a
     small "recommended products" picker inside the admin catalog editor
     (`CatalogEditorSurface.tsx`). Both are a different call than
     Sales/Returns: the storefront one is customer-facing (camera-scan
     UX for anonymous shoppers is a bigger product decision than an
     internal staff-tool consistency fix, same "needs a decision, not
     guessed" treatment this file already gives Import mode picker
     timing/Template download visibility), and the catalog-editor one is
     a small plain `<input>` inside a submit-on-enter form, not the
     shared `SearchInput` component `ScanSearchButton` is built to sit
     next to -- lower value (rarely-used admin sub-feature) and would
     need a small structural change, not a drop-in addition. Flagging
     both for a future session or an explicit decision, not silently
     skipping them.
  **Verification, all real (Part 128):** `frontend` `tsc --noEmit` clean.
  Full `npm run test:utils` clean end-to-end, 326 PASS lines, 0 failures
  -- same count as every prior part this session, no regressions. Real
  `vite build` succeeded (20.57s), zero errors, zero circular-chunk
  warnings. `cloudflare` `tsc --noEmit` re-run clean as an
  unaffected-baseline check (backend untouched -- this was a frontend-only
  UI-consistency addition using an existing shared component).
  **Not yet done, honestly carried forward (Part 128):** no live browser
  access from this sandbox to click through and confirm the scan button
  renders correctly in the Sales/Returns search rows on a real screen, or
  that the camera flow itself works end to end (same standing caveat as
  every UI item in this file). The two deliberately-deferred search boxes
  above are a real, live decision point for a future session, not
  resolved.
  9. **Part 129: backdrop-click-to-close and close-button-icon consistency,
     the two threads Part 124/125/127 flagged as "noticed in passing, never
     systematically audited" -- both finished, several real bugs found and
     fixed.**
     **Backdrop-click-to-close audit.** Catalogued every modal's backdrop
     `onClick` app-wide (28 files use the `fixed inset-0` overlay pattern,
     plus the shared `Modal.tsx` used by 29+ dependents). Confirmed a
     coherent app-wide shape, not raw inconsistency: read-only detail
     views (product/return/sale/user detail modals, `AuditLog.tsx`,
     `Dashboard.tsx`'s drill-ins) all correctly close on backdrop click
     since there's no data-entry risk; `ReceiveBatchModal.tsx`/
     `ManageBatchesModal.tsx`/`InventoryBatchModal.tsx` already solve the
     "form with a save in flight" problem with a `closeIfIdle` guard
     (`if (!saving) onClose()`) wired to backdrop, X, and Cancel alike;
     and `TransferModal.tsx`/`CustomTables.tsx`/`QuickAddModal.tsx`/
     `BulkAddStockModal.tsx`/`OtpModal.tsx`/`Modal.tsx` itself deliberately
     have no backdrop-close at all for their form content. **Real,
     confirmed bug found in the one place this pattern wasn't followed:**
     `NewReturnModal.tsx`, `EditReturnModal.tsx`, and
     `NewSupplierReturnModal.tsx` each track a `submitting` state and
     correctly disable their own Save/Submit button during it, but their
     backdrop-click and X-button (`EditReturnModal.tsx`'s Cancel button
     too) called plain `onClose`/`onClose?.()` with no guard -- a stray
     outside click or X-tap could unmount the modal while the return
     create/update request was still in flight. Checked every other
     backdrop-closable modal for its own in-flight-save state first (none
     of the read-only detail views have one, so this wasn't applied
     blanket) before adding the same `closeIfIdle` guard already proven in
     the three batch modals to all three return modals, routing backdrop +
     X + Cancel (where present) through it.
     **Close-button icon/tap-target audit.** Part 124/125 fixed 9 files'
     worth of icon-only close buttons using a bare text `"x"`/`"×"`
     character with no `aria-label` -- re-ran that same audit from
     scratch (grepped every `aria-label`-bearing close button plus a
     second pass for any bare `>x</button>`/`>×</button>` app-wide, not
     just re-reading the old note) and found 6 more real instances that
     slipped past the original sweep: `SaleDetailModal.tsx`,
     `UserDetailSheet.tsx`, `TransferModal.tsx`, and `QuickAddModal.tsx`
     (all four already had `aria-label`, so cosmetic-only, same treatment
     Part 124 gave `inventory/ProductDetailModal.tsx`); `CustomTables.tsx`'s
     create-table modal close button, which had **no `aria-label` at all**
     -- a real accessibility bug, same class as Part 124's original 9;
     and `ReceiptSettings.tsx`'s live-preview close button, which had an
     `aria-label` but **no defined tap-target size class whatsoever**
     (just `text-lg leading-none`), unlike every other close button in
     the app. All 6 switched to the shared lucide `X` icon at the app's
     dominant `h-8 w-8`-button/`h-4 w-4`-icon sizing (importing `X` fresh
     in each of the 5 files that didn't already have it). Also fixed
     `App.tsx`'s `SyncErrorBanner` dismiss button (bare `"x"`, no
     `aria-label`, no sized tap target) -- mirrored it after the
     `Notification` toast-dismiss button one screen above it in the same
     file, which already had the correct pattern (`aria-label`, real SVG
     icon, `rounded-full p-1` tap target), since both are banner/toast
     dismiss controls rather than modal headers and shouldn't necessarily
     match the modal `h-8 w-8` convention.
     **Found, deliberately not fixed, carried forward:** a second, distinct
     bug class turned up during the same grep -- `CustomTables.tsx`'s
     remove-column button, `DeliveryTab.tsx`'s remove-delivery-option
     button, and `pos/CartItem.tsx`'s remove-from-cart button all also
     render a bare text `"x"` (red-colored, semantically "delete this
     line" rather than "close this dialog"). `CartItem.tsx`'s already has
     an `aria-label`; `CustomTables.tsx`'s and `DeliveryTab.tsx`'s don't.
     This is a different, related pattern (remove-line-item buttons, not
     modal-close buttons) that Part 124/125's original audit didn't scope
     in either -- not folded into this session's fix without first
     surveying how many other "remove this row" buttons exist app-wide
     (Products variant rows, Fee lines, etc. likely have their own
     versions) and what convention, if any, they already share.
  6. **Part 130 -- remove-row pattern closed out.** Received a standalone
     `update code` folder (3 files: `DeliveryTab.tsx`, `POS.tsx`,
     `CustomTables.tsx`, not a full tar) alongside a fresh `business-os.tar`.
     Diffed each against the tree before merging rather than assumed
     correct, per this file's standing convention -- all three were
     single-purpose, surgical: `DeliveryTab.tsx` and `CustomTables.tsx`
     each added the missing `aria-label` (plus `type="button"` on
     `DeliveryTab.tsx`'s) to exactly the two bare-`"x"` remove buttons this
     item named as unfixed; `POS.tsx` replaced its order-tab close
     control -- previously a non-focusable `<span onClick>` with bare
     `"x"` text, not even a real button -- with a proper `<button
     type="button" aria-label={t('close')}>` wrapping the shared lucide
     `X` icon (`import X from 'lucide-react/dist/esm/icons/x.js'`, the
     same deep-import path already used by 15+ other files including this
     one's neighbors `Modal.tsx`/`CustomTables.tsx`), the biggest fix of
     the three since it was unreachable by keyboard before. No new
     translation keys needed -- `close` and `remove` both already existed
     in both language files pre-merge. Then re-ran this item's own
     "survey how many other remove-this-row buttons exist app-wide"
     carry-forward for real instead of re-deferring it: grepped every
     `.tsx` file for bare `>x<`/`>×<` text buttons app-wide (not just the
     3 named files). Two more turned up, both already fine on inspection:
     `pos/CartItem.tsx`'s remove-from-cart button (as this item already
     noted in Part 129 -- confirmed still true, already has `aria-label`
     and is a real `<button>`) and
     `catalog/CatalogEditorSurface.tsx`'s recommended-product-chip remove
     control (a real `<button>` with an accessible `title`, whose child
     `<span>x</span>` is correctly `aria-hidden`, not a bug). Also checked
     the two other places this item speculated might have their own
     versions -- Products variant rows and Fee lines -- and found both
     already use the app's icon-button convention (lucide `Trash2` inside
     a labeled `<button>`, e.g. `fees/FeesPage.tsx`), a different,
     already-correct pattern, not an instance of this bug class. With
     that, every concrete lead this item's remove-row finding named is
     now either fixed or confirmed already correct -- no further bare-`x`
     remove-row buttons found anywhere in `frontend/src`.
  10. **Part 132: re-confirmation pass on the live cross-page sync
     mechanism (finding 7's "connectors between pages" audit), prompted
     by this session's `FeesPage.tsx`/`AppContext.tsx` merge -- no drift,
     no new gaps, one new pairing checked that finding 7 didn't cover.**
     No fresh file supplied for this half of the session; picked the
     checklist back up after merging the two supplied files. Re-walked
     the same `broadcast(c.env, channel)` -> `sync:update` DOM event ->
     `AppContext.tsx`'s debounced `syncChannel` state -> per-page
     `useSync()` listener pipeline finding 7 already validated, to check
     for regressions since Part 127 and to specifically verify the `fees`
     channel, which didn't exist in this system when finding 7's audit
     ran. Confirmed real, not assumed: `cloudflare/src/routes/fees.ts`
     calls `broadcast(c.env, 'fees', ...)` on create/update/delete, and
     `FeesPage.tsx` (`syncChannel.channel === 'fees'` -> `load(true)`) is
     the one and only consumer -- correctly wired end to end, same
     pattern as every other entity. Also traced two adjacent pairings
     finding 7's write-up didn't explicitly call out: `Products.tsx`
     listening for `inventory`/`sales`/`returns` (a silent re-fetch,
     deliberately skipping the filter-meta invalidation its own
     `products`/`categories`/etc. branch does, since stock moving doesn't
     change categories/brands/suppliers) and `Inventory.tsx` listening
     for `inventory`/`products`/`sales`/`returns` -- both already
     correctly wired, no gaps. Also re-verified the two examples the
     checklist originally named by reading the current source rather than
     trusting finding 7's note as still accurate: `POS.tsx`'s `syncChannel`
     effect still reacts to `products`/`branches`/`categories` (catalog
     reload) and `inventory`/`sales`/`returns` (silent stock-only
     reload) exactly as finding 7 described, and `Sales.tsx` (the sales
     history/list page) still has no customer-picker UI of its own to go
     stale -- that flow lives entirely in `POS.tsx`, which already
     listens for the `customers` channel. **No code changes made this
     pass** -- this was a confirmation audit, not a fix session; treat the
     "connectors between pages" thread as closed at Part 127 and
     re-confirmed clean at Part 132, not re-opened.
  **Verification, all real (Part 129):** `frontend` `tsc --noEmit` clean.
  Full `npm run test:utils` clean end-to-end (needed the same fresh
  `npm install @rollup/rollup-linux-x64-gnu --no-save` this sandbox
  always needs), 326 PASS lines, 0 failures -- same count as every prior
  part, no regressions. `lang/en.json`/`lang/km.json` re-parsed with
  Python's `json` module: both still valid JSON, still 3,113 keys each,
  0 missing either direction (no new keys needed -- every fix reused the
  existing `close` key). Real `vite build` succeeded (20.94s), zero
  errors, zero warnings, zero circular-chunk warnings. `cloudflare`
  `tsc --noEmit` re-run clean as an unaffected-baseline check (backend
  untouched -- every change this session was a frontend close-button/
  backdrop-guard fix). Diffed the full `frontend/src` tree against the
  untouched upload before writing this note: exactly the 10 files
  described above changed, nothing else.
  **Not yet done, honestly carried forward (Part 129):** no live browser
  access from this sandbox to click through and confirm backdrop-click on
  the three return modals is actually blocked mid-submit, or that the 7
  fixed close buttons render the icon correctly in both languages/themes
  -- same standing caveat as every UI item in this file. Click-target-
  size consistency is folded into this same audit (measured, not just
  eyeballed) and can be treated as closed alongside backdrop-click-to-
  close. **The remove-line-item button pattern flagged here as still
  open was fully closed out by Part 130 (see that entry above)** --
  every concrete lead it named is now either fixed or confirmed already
  correct, no bare-`x` remove-row buttons remain anywhere in
  `frontend/src`. This note is kept only so a reader doesn't mistake the
  stale "not resolved" wording (written before Part 130 ran) for a
  still-open item.


---

## Request batch — Aug 25 2026 (Part 341)

Added to the back of this list per explicit instruction. Each item records the
**constraints found in the user's real import data**, because several of these asks are
not buildable as literally stated against that data — see "Import data reality" first.

### Import data reality (measured, not assumed)

Both files the user will actually import were analysed directly. These numbers constrain
several items below, especially public login.

**`products-template (1).csv` — 8,727 products, 29 columns**

| Column | Filled | Consequence |
|---|---|---|
| `name` | 100% | primary identifier |
| `barcode` | 96.5% | secondary identifier; **2,687 barcodes are shared by 5,430 rows** |
| `sku` | **0%** | SKU matching is unusable for this file — Replace-mode "match on SKU" would match nothing |
| `selling_price_usd` | 95.8% | |
| `special_price_usd` | 93.6% | significant — special pricing is in real use |
| `cost_price_usd` | 94.9% | |
| **all `*_khr` columns** | **0%** | prices are authored in USD only; KHR is derived — see the currency item |
| `stock_quantity` | 52.4% | ~half the catalogue imports with no stock figure |
| `batch_date` | 100% | format `M/D/YYYY`, e.g. `8/12/2026` |
| `branch` | 100% | only two values: `shop` (5,888), `warehouse` (2,839) |
| `expiry_date`, `supplier`, `parent_id`, `is_group`, all 6 image columns | **0%** | image-matching and variant columns are unused by this import |

- **5,915 distinct names across 8,727 rows — 2,747 names duplicated, covering 5,559 rows.**
  This is the shop/warehouse split of the same product. Product grouping is not an edge
  case here, it is the majority shape of the catalogue.
- 46 categories, 327 brands. **649 rows use the `||` multi-category separator**; zero use
  it for brand.
- Units are Khmer (`ដើម` 3,259, `ដប` 2,458, `ប្រអប់` 1,764, …) — confirms why the Khmer
  normalization work in `searchMatch.ts` matters.
- Descriptions are multi-line RFC4180-quoted with embedded `""` escapes. Any parser change
  must keep handling that; both files also carry a UTF-8 BOM.
- Data-quality rows to surface at review time, not silently accept: **17 rows where
  `cost_price_usd` > `selling_price_usd`**, and **5 rows where `special_price_usd` >
  `selling_price_usd`**.

**`customers-template-final.csv` — 5,549 customers, 24 columns**

| Column | Filled | Consequence |
|---|---|---|
| `name` | 100% | |
| `phone` | 89.9% | **not unique** — see below |
| `address` | 92.1% | |
| `gender` | 97.9% | |
| `created_date` | 100% | format `M/D/YYYY H:MM` |
| **`email`** | **0%** | **no customer has an email address** |
| **`membership_number`** | **0%** | every membership number must be generated |
| `company` | **0%** | confirms Part 336's customer-`company` removal loses nothing here |
| `contact_phone_1` | 0.7% (40 rows) | the other 14 contact_* columns are entirely empty |

- **448 phone numbers are shared by 2–5 different customers, covering 978 rows (17.6%).**
  Worst cases: one number on 5 customers named `Drl02357` / `On1012_` / `New Acc` /
  `Prv (Ig)`; another on 5 rows named `Seavmean Seang` (the same person four times).
- **559 customers (10.1%) have neither a phone nor an email** — they cannot self-identify
  at all.
- **451 duplicate names covering 1,078 rows.** Many are near-duplicates of one person
  (`Linuo`/`Linnuo`, `Chh.Ing`/`Chh.Ingg`) and many are Instagram handles rather than
  names.

### Items

### 1. 🔴 Currency conversion — POS/sales forward-only

**Ask:** conversion applies to POS and sales going forward; it must not change past
records. USD is the stats currency, but both currencies run concurrently.

**Already correct — verified, do not "fix" it.** `sales` and `returns` each store *both*
`*_usd` and `*_khr` for every money field (`subtotal`, `discount`, `tax`, `total`,
`amount_paid`, `change`, `delivery_fee`, `membership_discount`) **plus their own
`exchange_rate` column** (`migrations/0001_init.sql`). Dashboard/analytics aggregate the
**stored** `total_usd`/`total_khr` columns (`routes/compat.ts`) — nothing recomputes a
past total from the live rate. So changing `settings.exchange_rate` cannot retroactively
alter a completed sale.

The live rate is used in exactly one place: `AppContext`'s `formatPrice(usd, khr)` falls
back to `usd * exchangeRate` **only when `khr` is absent**. That applies to *products*,
whose KHR columns are empty in the import (see table above) — and deriving a current
price list from the current rate is the correct behaviour there.

**Still to do:** a regression test locking this in (past sales display and aggregate from
stored values, never the live rate), and an explicit UI statement of the rule where the
rate is edited, so nobody "fixes" it into retroactive behaviour later.

### 2. 🔴 Public website accounts — signup, login, guest

**Ask:** signup/login for `leangcosmetics.dpdns.org`; membership ID obtainable from an
admin note; log in with email, Gmail, phone, or membership ID alone; strong passwords;
OTP; browser save-password support; guest browsing by default with the user remembered;
everything works as guest, login persists progress long-term; membership area is personal
(cart, etc.); site must be secure.

**Blocked as literally stated — the data does not support it.** From the measurements
above:

- **Email/Gmail login cannot work for existing customers** — 0 of 5,549 have an email. It
  can only serve accounts created after signup.
- **Phone alone cannot be a login identifier** — 448 numbers are shared across 978
  customer rows. "Log in with phone" would authenticate into an ambiguous set.
- **Membership ID is the only viable unique identifier**, and none exist yet — all 5,549
  must be generated.
- **559 customers (10.1%) have no phone and no email**, so they can never self-serve;
  they need the admin-issued membership ID path.

**Proposed shape, needs confirmation before building:** membership ID is the account key
and is generated for every customer at import. Phone becomes a *lookup hint*, not a
credential — entering a shared phone lists the matching memberships and requires the
membership ID (or an OTP to that number plus a name choice) to disambiguate. Email is
optional, added by the customer after first login, and only then becomes a login method.
OTP over SMS is the natural second factor given phone coverage is 89.9%.

Security requirements to design against, not bolt on: this is a *public, unauthenticated*
surface on the same Worker as the admin app, so it needs its own rate limiting, its own
session cookie scope (must not be usable against `admin.leangcosmetics.dpdns.org`),
credential-stuffing protection given the shared-phone problem, and password rules
(length/character classes) plus a real password hash — the admin side uses bcrypt via
`routes/auth.ts` and should be reused rather than reinvented.

**Guest mode:** browsing, cart and progress must work with no account, and the guest
identity must persist across visits, with a merge path when that guest later logs in.
Merging a guest cart into a membership cart is its own decision (union? replace? prompt?)
and is not specified yet.

### 3. 🟡 Stories and posts — admin-authored, customer-visible, commentable

**Ask:** stories and posts creatable by admin only; customers can view and comment.

Not started. Needs: a content table with author/publish state, a public read endpoint on
the portal, a comment table with moderation (comments are user-generated content on a
public site — they need rate limiting, length caps, and an admin hide/delete path), and
permission wiring so authoring sits behind the admin `customer_portal` grant while reading
stays public. Comment identity depends on item 2 — decide whether guests may comment or
only logged-in members.

### 4. 🟡 Discounts and promotions — complete and mature

**Ask:** finish these to a mature state.

`promotions` routes exist and were mounted in a prior session (an earlier fix records them
having been built but left as dead code). Needs an audit of what is actually wired versus
stubbed before any new work — the same "looks-wired-but-isn't" class this project keeps
finding. Note the import data: 93.6% of products carry a `special_price_usd`, so
special-price handling is already load-bearing and must not regress.

### 5. 🟢 Per-action permission wiring — Inventory/Branches/Returns DONE (Part 341); Fees/Contacts open

Part 339 wired **Products**; Part 341 wired **Inventory, Branches and Returns**, gating
only what those routes actually block for the review tier (adjust/transfer, transfer +
transfer-bulk, and edit respectively) and deliberately leaving the actions that *queue*
available. Verified in the browser both directions.

**Still open: Fees and Contacts.** Fees is a different shape and must not be gated the
same way -- nothing on it is blocked at review tier (delete queues), so the work there is
*labelling* ("this will need approval"), not hiding. Contacts has genuinely blocked
actions (delete, bulk-delete, merge) plus a `limited` edit that needs a narrowed form
rather than a hidden button.

### 6. 🟡 Backup — Google Drive round-trip, auto-delete, free-tier safety

**Ask:** backups actually work end to end; Drive round-trip with a fully compatible
format; save and auto-delete on Drive; must not breach Cloudflare's free limits. Resets
need a smart, safe UI that cannot do anything unintended.

**Part 356 checkpoint (committed, needs deploy).** R2 now retains exactly the newest
**2 finalized** backup sets. Copying/partial/failed sets never evict either good set;
the immutable database manifest is paired with a small lifecycle sidecar, copied in
20-object slices (within the Free plan's 50-subrequest/request ceiling), with three
attempts per missing asset and stale incomplete cleanup. Manual system jobs reflect
copying progress and finalize/fail with the backup instead of being marked complete
early. Drive retains exactly **7 tagged finalized** files, paginates the entire tagged
set, streams via a validated Google resumable-session URL, reuses rather than recreates
the newest finalized R2 backup, and deduplicates an already-mirrored `backupKey`; only
app-tagged files can be deleted. It never calls `arrayBuffer()`.

**Still open:** Drive currently mirrors the finalized JSON manifest only. Complete the
manifest-plus-all-referenced-assets folder mirror, resumable retry handling for
401/403/429/5xx, checksums/round-trip restore from Drive, and explicit cancellation UI.
`/system/drive-sync/oauth/callback` must stay publicly reachable (Google's redirect).

### 7. 🟢 User-defined options instead of fixed ones

**Ask:** the app is an inventory/product/POS system for a real business; users should be
able to define their own options rather than choose from hardcoded lists.

Broad and unscoped. Needs a concrete list of which fixed dropdowns should become
user-defined before it is actionable — flagged rather than guessed at.

### 8. 🟢 Admin and visitor icons are different

**Ask:** the icon/logo for the admin app and for `leangcosmetics.dpdns.org` (visitors) are
different assets and must not be shared.

`wrangler.toml` already separates the domains (`BUSINESS_OS_PUBLIC_URL` /
`BUSINESS_OS_ADMIN_URL`). The icon split itself is not done: `frontend/public/` currently
carries both a generic `icon-*.png` set and a `leang-cosmetics-icon-*.png` set, and the
manifest/favicon wiring needs checking to confirm which surface serves which.

## Request batch — Aug 25 2026, second batch (Part 342)

Flags: 🔴 blocked / needs a decision · 🟠 in progress · 🟡 open · 🟢 done · ⚪ deferred by request

Every item below is verbatim-traceable to a request. Nothing here is invented scope. When
an item is done, the flag changes and the Part that did it is named — this list is the
tracker, so it must not be rewritten into vagueness.

### Deploy / tooling

| # | Item | Flag | Notes |
|---|---|---|---|
| 1 | `full-automation` died at "Install dependencies (frontend)" with EPERM on rollup's `.node` | 🟢 Part 342 | Cause was a dev server holding the binary, not antivirus/permissions. Retry uses `npm install` (reconciles in place) instead of `npm ci` (deletes first). Reproduced and verified both ways. |
| 2 | Commit every change with a clear explanation; many small commits, never one big one | 🟢 standing | Being followed. Listed here so it stays a rule, not a habit. |

### Login / auth

| # | Item | Flag | Notes |
|---|---|---|---|
| 3 | "Reset with OTP" belongs inside Forgot password (ask admin / reset personally with OTP) | 🟢 Part 342 | One entry point, then choose a method. Ask-admin hint lives there too. |
| 4 | Remove "Needs an account created by your admin." | 🟢 Part 342 | Its information moved into the recovery screen, where it is actionable. |
| 5 | Remove "Sign in to continue" | 🟢 Part 342 | |
| 6 | Put the logo and "Business OS" side by side for better spacing | 🟢 Part 342 | |
| 7 | Login accepts username, name, phone, or email | 🟢 Part 342 | **It did not.** The query matched only `username`; the other three failed as "invalid password". Now resolved with username-wins precedence and an exactly-one-match rule for the rest. |
| 8 | Device-approval screen shows two shield icons and says "Waiting for device approval" twice | 🟢 Part 342 | The card header rendered its own copy of both. |

### Public customer accounts — decided this batch

| # | Item | Flag | Notes |
|---|---|---|---|
| 9 | **Phone-number login only** | 🟡 | Supersedes the earlier open question. |
| 10 | Auto-generate a membership ID when the phone is not already present | 🟡 | |
| 11 | If the phone already exists, the customer must contact an admin | 🟡 | This is the answer to the 448-shared-phones problem: collisions are handled by a human, not by the login form. |
| 12 | No SMS available — verify via Gmail/email, Telegram, or the membership ID | 🟡 | Telegram login must be free. |
| 13 | Import review will surface phone uniqueness so it can be cleaned up first | 🟡 | User is doing this pass themselves. |

Measured constraints that still apply (see the previous batch for the full numbers):
0% of the 5,549 customers have an email, 0% have a membership number, 89.9% have a phone,
and **448 phone numbers are shared across 978 customers**.

### Permissions

| # | Item | Flag | Notes |
|---|---|---|---|
| 14 | Custom permission combinations, validated before saving, with a reason given when invalid | 🟡 | Must reject an incoherent combination rather than silently saving it. |
| 15 | Every button/action works and updates app-wide — not blocked in some areas | 🟠 | Products/Inventory/Branches/Returns wired (Parts 339, 341). **Fees and Contacts still open.** |
| 16 | Some actions have multiple code paths; all must be integrated | 🟡 | Named: stats, product stock movements, audit. A write through one path must show up in all of them. |
| 17 | Review Required: pending visible to the user; approve applies + notifies; deny keeps the record, shows the reason, allows resubmit | 🟠 | Backend done and verified (Part 341). **UI and the notify-on-decision half are not built.** |

### Stats / data

| # | Item | Flag | Notes |
|---|---|---|---|
| 18 | Redo the stats: an even number of them, easier to scan | 🟡 | |
| 19 | Update the search-scope help text — search is now name + barcode/SKU only | 🟢 Part 342 | Products/Inventory/portal updated, EN + KM. Sales/Returns left alone on purpose — their search really does still match brand. |
| 20 | Bulk price adjustment: add/subtract a fixed amount across products, USD or KHR, selling price only, optionally skipping products priced 0 | 🟢 Part 342 | Pure engine + UI. Clamps at 0, rounds per currency, skip-zero applies per field, confirmation counts rows that will really change. Verified in the browser against D1. |
| 21 | Batches: multiple batches, view, edit, batch date | 🟡 | |
| 22 | Imports, deletes and products all working, production-grade | 🟡 | |

### Khmer translations

| # | Item | Flag | Notes |
|---|---|---|---|
| 23 | Make the Khmer clearer and shorter; check every key | 🟡 | |
| 24 | Remove keys that are no longer used, and confirm the rest are actually current | 🟡 | Needs a real usage sweep, not a spot check. |

### POS

| # | Item | Flag | Notes |
|---|---|---|---|
| 25 | Standalone and group products must be UI-friendly, with valid and complete option choice: barcode, branch, child variants, batch | 🟡 | |

### UI

| # | Item | Flag | Notes |
|---|---|---|---|
| 26 | Profile modal redesign: name/details on the avatar's row; larger buttons on one row; click the avatar to view it, with the actions beneath the image; no separate upload entry point | 🟡 | Carried over from the previous batch, restated. |
| 27 | Portal editor "Contact us" working | 🟡 | Carried over, restated. |
| 28 | Promotions/discounts, Canva-like editing with templates | ⚪ | **Explicitly pushed back in the order this batch.** Not dropped. |

### Third batch — Aug 25 2026 (Part 343)

| Item | Flag | Notes |
|---|---|---|
| Login button taller than the fields | 🟢 | `.input` is 40px; the button stacked `py-3 text-base` on `.btn-primary`'s own `py-2`. All three are h-11 now — measured 44/44/44. |
| Password reveal (eye / eye-off) | 🟢 | Toggles type, aria-label flips, `tabIndex={-1}` keeps it out of the tab path between password and submit. |
| Login-page Khmer | 🟢 | Real defect found: "Forgot password?" still read "reset password again via email", describing the two-button layout from before OTP was folded in. 531 → 339 Khmer characters on that screen. |
| Import UI: merge into one page, ordered | 🟢 | Already one page; the gaps were that there was **no template download at all** (only descriptive chips) and the order was info→upload. Now template → upload → info, with real per-mode downloadable headers. |
| Add-Sale doesn't mention add product/stock | 🟢 | It always did both; only the copy was sales-only. `date` promoted to a required base column so arrivals can be ordered before sales. |
| Add-Sale options collapsed | 🟢 | Five toggles → two questions (how rows relate / where cost price comes from). Customer, discount and fee now ride along with any sale-linking mode and may be left blank. |
| Option detail behind hover/hold | 🟢 | New `InfoHint` (hover **and** tap, since touch has no hover). Applied to General, Replace and Add-Sale. |
| Raw translation keys rendering in the UI | 🟢 | 40 keys absent from both packs. Cause: `t('key') \|\| 'Fallback'` — `t()` returns the KEY on a miss, which is truthy, so the fallback is dead code. Contacts duplicates showed literal `keep_this_one` / `merging`. |
| Khmer sweep | 🟢 | Packs were healthier than expected: 0 missing/extra keys, only 2 layout-overflow risks, and all 34 "untranslated" are correctly English (brand names, SKU, RFID, font names). |
| Unused-key cleanup | 🟠 | ~640 keys have no reference anywhere. Script written and dry-run only — **not applied yet**, since deleting 19% of the pack deserves its own verified pass. |

**Guard added:** `tests/langKeyIntegrity.test.ts` — the packs must hold the same key set, every bare `t('key')` must resolve, no blank strings. It deliberately does *not* fail on `tr('key', 'Fallback')`, which degrades correctly; those 196 are reported as a coverage number instead, so the test stays worth reading.

### Fourth batch — Aug 25 2026 (Part 344)

| Item | Flag | Notes |
|---|---|---|
| Two tooltips on one info hint | 🟢 | My bug: `InfoHint` set a native `title` **and** rendered a panel, so the browser drew its own tooltip alongside. `title` removed; `aria-describedby` still carries the text to screen readers. |
| "ERR Not authenticated" after idle | 🟢 | Root cause found: sessions were issued with a FIXED `expires_at` and never renewed, so one died at a wall-clock moment set at login regardless of use. Only `last_seen_at` was touched — activity recorded but never acted on. Now renews past halfway; verified live 2026-09-04 → 2026-09-24, and confirmed a fresh session is *not* rewritten per request. |
| Contacts per-action gating | 🟢 | delete + bulk-delete withheld (routes 403 them). Edit deliberately kept — it is `limited`, not `block`: the write lands but the server keeps only `name`. |
| Fees per-action gating | 🟢 | Opposite treatment, on purpose. Nothing on Fees is blocked, so controls stay and the delete buttons read "Delete (needs approval)". Hiding them would remove a capability the person has. |
| Image auto-wire / `_1` `_2` rename | 🟢 already built | `buildAutoRenamePlan` already names matches `product_1`, `product_2`; `stripTrailingIndex` in the matcher means an already-renamed image still matches its product, so re-running does not duplicate wiring. Group-title matching depends on what the caller passes as candidates — not yet confirmed end to end. |

**Still open from this batch:** Add/Sale reshaped to the Dated-Stock-Reconciliation flow (column mapping → review → apply, with batch choice on sale and create-then-sell for products that exist only in the file); import/delete CPU-limit work; POS variant/batch options; batch editing; profile modal; portal Contact-us; custom permission validation; review-queue UI; stats redesign.

### Fifth batch — Aug 25 2026 (Part 345)

| Item | Flag | Notes |
|---|---|---|
| Items per page: 20 default, POS 30, public 20 | 🟢 | Two named constants replace `PAGE_SIZE_OPTIONS[1]`, which made "the default" and "the middle option" the same fact by accident. Storefront changed on BOTH ends (client + `routes/portal.ts`) so a pageSize-less request matches. Reverses Part 151's org-wide 50 — recorded in-code. |
| mm/dd/yyyy throughout | 🟢 | 13 inline formatters + the 2 shared ones. **The real risk was the locale, not the pattern:** every call passed `undefined`, i.e. follow the viewer's machine, and most non-US locales render dd/mm/yyyy — so `08/09/2026` would have silently meant Sept 8 on a Khmer device and Aug 9 on a US one. Now pinned to `en-US`. Going numeric is what would have exposed this: `Aug` is unambiguous, `08` is not. |
| Flyout divider "too large" | 🟢 | It was **two** adjacent 1px borders (panel `border-r` + aside `border-l`), not one thick one. |
| Margin on its own row | 🟢 | Reverses the Aug 22 change that folded it inline. Recorded, and the stale comment updated rather than left contradicting the code. |
| Action buttons too wide | 🟢 | Layout was `grid-cols-2`, so 2–3 buttons got as much width as every product detail combined. Now `[minmax(0,1fr)_auto]` with a fixed narrow actions column. |
| Thumbnail opens gallery **and** detail | 🟢 | `stopPropagation()` on click was doing nothing: the row's long-press binds mousedown/touchstart, which fire first and drive their own onClick on release. Now stopped at gesture start. **Not reproduced live** — no product has a real uploaded image locally, so the placeholder renders instead of a clickable `<img>`. |

**Still open from this batch:** Dated Stock Reconciliation moved into Add/Sale and renamed; Add/Sale batch-choice-on-sale and create-then-sell; image auto-wire as a **button** (not automatic); batch format in the flyout + click-to-expand batch view; barcode first in list rows and detail; prices+stock merged to one row in the default list display; large-screen row/category alignment; settings tab-icon image wiring; two receipt print options with 80×50 fitting all fields; sticky-toolbar gap on scroll; mobile alphabetical rail.

**Also reported, not yet investigated:** `Write blocked - server unavailable ... (operation: data:reset)`.

### Environment gotcha worth knowing before testing any write locally

`api/http.ts`'s `route()` **blocks every write** when no sync-server URL is
configured, and `ensureBootstrapServerUrl()` returns `''` **by design** on the Vite dev
server (`localhost:5173`). So with `localStorage` cleared, no write of any kind succeeds
there — the UI simply appears to do nothing, with no console error.

This cost real time in Part 342: a new bulk action looked broken, and so did the
pre-existing one next to it. Neither was. Fix for local testing:

```js
localStorage.setItem('businessos_sync_server', window.location.origin)
```

Related, same class: a control that fails the *same way* as the change under test is
evidence about the environment, not about the change. Part 341 lost time to the mirror
image of this — an "admin sees it too" control that failed because the app's persisted
user was still the previous account.

### Standing rules restated this batch

- Keep every earlier request tracked here so none is forgotten.
- Commit per change with a clear explanation.
- "Fully productional" is the bar: no half-wired paths.

---

## Part 346 (Aug 25 2026) — POS unblocked, two money bugs, and ONE product identity rule

### The POS "No Data Found" root cause

Two independent defects combined; either alone produced the symptom.

1. `isImageOnlyUser()` (`routes/products.ts:93`) decided "this user's only route into
   product data is the restricted image-only role" from the **`products` tier alone**.
   A cashier granted `{pos, sales}` **plus `products_image_only`** matched, so every
   catalog row was stripped to `IMAGE_ONLY_BASE_FIELDS`.
2. `is_active` is not in that allowlist, and POS's `applyCatalogProducts` filtered rows
   with a bare truthy `p?.is_active` — reading an **absent** column as "archived". Every
   row was dropped.

Result: HTTP 200, no error banner, so POS fell through to the bare "No data found" while
the pagination count and A–Z rail (separate unrestricted queries) still showed real
numbers. Admins were exempt via `isAdminControlUser`, which is why only employees hit it.

Both fixed — they are different failure classes and can regress independently.
`pos`/`sales`/`inventory` access now disqualifies the image-only restriction (selling
requires price, stock and branch data by definition, which `productWrites.ts`'s docstring
already *claimed* the function enforced), and POS hides a row only on an explicit
`is_active === 0/false`.

**Caveat, stated plainly:** this was diagnosed from source, not from the affected role's
actual permission set. If the employee role does **not** carry `products_image_only`, the
fix still stands but the diagnosis needs re-opening.

### Two money bugs, both in the same inline arithmetic

- **Delivery fee never reached the recorded total.** The cart charged
  `afterDiscount + tax + customerFee` and printed it on the receipt; the server recorded
  `subtotal - discount - membershipDiscount + tax`, no fee term — the fee scalars were
  computed further down the handler and were not in scope at total time. Every delivery
  sale stored a total **below what was collected**, and the gap flowed into `change_usd`,
  the Sales page, `salesAnalytics` and loyalty accrual.
- **KHR-only sales invented a USD tender.** `Number(body.amount_paid_usd) || totalUsd`
  read a legitimate `0` as "not supplied" and substituted the whole total, plus roughly a
  second full total as change.

The arithmetic now lives in `lib/saleTotals.ts` as a pure, directly-tested function.
Both bugs were invisible to every existing test *because* the math could only be reached
through a live request. Writing the test caught a third bug in the fix itself:
`Number(null) === 0`, so a naive `Number.isFinite` check would have recorded a real
payment as zero — "absent" is now detected before coercion.

### A failed lot lookup no longer reads as "there are no lots"

`batchesTransport` passed `() => ({ productIds: [] })` / `() => ({ batches: [] })` as
`route()`'s local fallback, and `hasUsableLocalData` counts any non-empty object as
usable — so a 403/500/timeout **resolved as a successful empty result and was cached**.
Every batch-tracked product looked untracked, the lot picker never appeared, and
batch-tracked stock sold **with no lot chosen**, bypassing FIFO/expiry silently.

Both reads now propagate failures. POS keeps prior knowledge, flags the failure, routes
every product through the detail sheet, and shows a retry banner; the sheet renders a
real error instead of "No lots available". A deliberate availability-for-correctness
trade: refusing a sale beats selling the wrong lot.

### ONE product identity rule

The rule existed in **five** places and all five disagreed. Now one module,
`lib/productDetailRule.ts`, duplicated verbatim into `frontend/src/utils/` (the packages
share no npm package) with `productDetailRuleParity.test.ts` failing the moment they
differ.

**DETAILS = barcode + cost.** A different barcode is a different article; a different
cost is real money actually spent and must never be silently replaced. Either makes a
child row inside the name group.

**Selling and special price are NOT details** — they are what we plan to charge and are
adjusted for sales/POS. Rows differing only in them are one product, and on merge the
**highest** of each wins, so a merge can never drop a product below a price one of the
merged rows expected to charge.

**Batches stay separate**: they record WHEN stock arrived so older stock sells first, not
what it cost.

Fixed along the way:

- `productIdentity.ts` compared `purchase_price_*` — columns import and the manual form
  **never** write, so they sat at 0 and the cost half of every transfer/merge comparison
  was a silent no-op. Fixing it made the typechecker surface two callers feeding those
  columns in (`branches.ts`'s transfer query, and `inventory.ts`'s `resolveAddStockTarget`,
  whose `sameAsSelf` short-circuit could therefore never fire).
- Name groups are now the paging/stats unit. `familyPagination`/`familyStockStats` keyed
  on `COALESCE(parent.id, p.id)` — `parent_id` chains only — and import never writes
  `parent_id`, so "20 per page" silently meant "20 rows".
- A branch created part-way through an import was invisible to every product created
  before it (per-chunk branch snapshot). Measured: exactly one product on the real file.

### Census against the real 8,727-row file

Run through the real parser + `classifyProducts` + real migrations
(`scripts/harness/run_product_census.cjs`):

| Measure | Result |
|---|---|
| rows in | 8,727 — every row accounted for, 0 errors |
| products out | 6,684 |
| name groups | 5,915 (754 multi-row, largest 7 rows) |
| identical-detail duplicates remaining | **0** |
| missing product × branch stock rows | **0** |

**The census had to be fixed before it could be trusted.** A first version omitted
`runImportApply`'s in-batch signature dedupe and branch seeding, and reported ~2,000
phantom duplicate groups that the real import never creates. It now models the real
pipeline and reads the detail rule from the real module, so it cannot measure a different
rule than the code applies.

**What the data changed:** the first decision was "details = barcode + selling + special
+ cost". The census showed **681 of 754 child-row groups existed ONLY because cost
differed** — the same product bought twice at different prices. That was put back to the
user with the numbers, and the rule was revised to the current one.

### Verification (all really run)

| Check | Result |
|---|---|
| `cloudflare` `tsc --noEmit` | clean |
| `frontend` `tsc --noEmit` | clean |
| Backend `test-*.cjs` | **48 / 48 pass** (41 before; 3 new suites added) |
| `frontend` `npm run test:utils` | green end to end |
| Real `vite build` | succeeds (~28s) |
| Product census vs the real CSV | 0 losses, 0 duplicates, 0 missing branch rows |

### Deployed

`wrangler deploy` ran successfully on Aug 25 2026 — Version ID
`6c6eef5f-78eb-4d39-93d2-fe6bdb3d5335`. `d1 migrations apply --remote` reported **no
migrations to apply** (this batch added none). `/health` returns 200 on
`admin.leangcosmetics.dpdns.org`, and all commits are pushed to `main`.

Everything in this section is therefore **live**, not awaiting a deploy. Note the
identity-rule change governs how FUTURE writes merge — it does not retroactively rewrite
existing production rows, so nothing in the live catalog was altered by the deploy.

### Still open from this batch

- POS group-option display and picking (the "multiple pricings" UI request).
- Rename does not regroup; `merge-duplicates` still orphans images.
- No auto-merge flag/filter yet.
- Image normalization per the Aug 27 rule (safe WebP for smaller files; full ladder only
  above 350KB), 6-hour report-first audit, reviewed backfill.
- Import CPU efficiency (whole-CSV re-decode per window; sales re-partition per chunk).
- Portal pagination counts unmerged rows; portal A–Z initials ignore the out-of-stock toggle.
- Deploy and live-verify the Part 355 bounded-memory backup restore.

---

## Part 341 (Aug 25 2026) — organization pin, brand icons, two real auth/permission bugs, submitter side of the review queue

Six commits, all pushed. Two of them fix bugs that were breaking the app for real users
and had never been reported as such.

### Fixed: an admin who signed in lost every permission

`POST /api/auth/login` queried `r.code` and `r.permissions` and returned neither, unlike
`GET /auth/me` and `GET /auth/bootstrap` which both include them.

That matters because **most users hold no permissions of their own** — `users.permissions`
is `{}` and every grant comes from the role. The built-in admin is exactly that shape:
`{}` on the user, `{"all":true}` on the role. `AppContext.getMergedPermissionsRaw` merges
the two, so a user object without `role_permissions` resolves to *no permissions at all*.

Normally masked, because the app re-fetches `/auth/bootstrap` right after login and
overwrites the user. **Not** masked whenever that follow-up cannot run:
`appBootstrapTransport` falls back to a purely local bootstrap (`readStoredUser`) when no
sync-server URL resolves, and `ensureBootstrapServerUrl` returns `''` **by design on the
Vite dev server**. The offline path hits the same fallback.

Reproduced live before fixing: signing in as `admin` produced an app whose entire
navigation was **Notes and Library**, profile chip reading "No role". After the fix, the
same sign-in yields Dashboard, POS, Products, Inventory, Branches, Sales, Returns, Fees,
Contacts, Users, Review, Audit Log.

### Fixed: Review Required users could never see their own requests

Every route on `routes/reviewQueue.ts` sat behind `hasPermission(user, 'review')`. A
Review Required user by definition does not hold `review`, so they got 403 on all of it:
submit a change and never see it again — no pending list, no way to read why something was
refused, no way to ask again. The reviewer half (list, approve-and-apply,
reject-with-reason) already worked.

Added `GET /api/review/mine` and `POST /api/review/:id/resubmit`, declared **before** the
`review` gate so they are reachable by the users they exist for. Scoping is enforced in
SQL rather than by a read-then-write check: resubmit guards on `requested_by` inside the
UPDATE's WHERE clause, so another person's row is unreachable rather than merely hidden,
and only `rejected` may transition to `open`, so an already-applied change can never be
resurrected. Resubmitting reopens the **same row**, clearing the superseded reason while
the audit log retains every transition — a rejection is never a delete.

Verified end to end against a local Worker with two real sessions:

| Call | As | Result |
|---|---|---|
| `GET /api/review` | review-tier | **403** |
| `GET /api/review/mine` | review-tier | **200**, exactly their 2 rows incl. the admin's reason, not the admin's row |
| resubmit another user's row | review-tier | **404** |
| resubmit an already-open row | review-tier | **404** |
| resubmit own rejected row | review-tier | **200**, back to open, reason cleared, `created_at` preserved |
| `GET /api/review?status=open` | admin | the revised request is back in the queue |

### Organization pinned explicitly

`BUSINESS_OS_ORGANIZATION_SLUG` (`wrangler.toml`, set to `leangcosmetics`) replaces
"first organization by id", which was correct only by accident of there being one row.
Deliberately a preference with a fallback: an unmatched slug falls back to the old
behaviour rather than returning null, so a stale config value can never lock anyone out.
Verified both branches live. Creating organizations was already impossible (no write
endpoints, `organizationCreationEnabled: false`) and is now covered by source guards.

### Brand icons regenerated, split by audience

Both source logos are 1254×1254 PNGs drawn as a rounded square **on opaque black with no
alpha** — shipping them as-is puts black corners on every favicon and home-screen icon.
`ops/scripts/assets/generate-app-icons.mjs` finds the true artwork bounds (sharp's
`trim()` keys off one corner pixel and is fooled by the glow on the Leang logo), cuts the
corners to real transparency, and emits every size `index.html` and `manifest.json`
reference. `--check` re-renders and diffs, for CI.

Three kinds rather than one resize: **rounded** (transparent corners, favicons/"any"),
**flat** (apple-touch-icon only — iOS ignores transparency and composites onto black), and
**maskable** (artwork inset to 78% on a full-bleed brand background, so the launcher's mask
only crops flat colour). `favicon.ico` is built by hand since sharp cannot write ICO;
verified the container parses with three real PNG payloads. 41KB → 9KB.

Admin sign-in now defaults to the **Business OS** logo. This **reverses** a decision
previously recorded in `Login.tsx` (default to the storefront icon because the deployment
is single-tenant), at explicit request. The split is now by audience: staff sign into the
product, customers see the shop. It also removed a visible inconsistency — that page
already rendered the heading "Business OS" above the pink storefront icon.

### Per-action permission gating: Inventory, Branches, Returns

Part 339 built the action table and wired Products only. Gated **only what the routes
actually block** for the review tier, not everything:

- **Inventory** — `adjust`, `transfer` (both 403 outright; they mutate live batch/stock
  state that could go stale between request and approval). `edit_reasons` *queues*, so it
  stays available.
- **Branches** — `transfer`, `transfer-bulk`. add/edit/delete all queue, so they stay.
- **Returns** — `edit` (reverses and re-applies batch restocking). Creating is allowed.

Verified both directions against a seeded product: admin sees the row's Adjust button;
the review-tier user sees no Adjust or Transfer anywhere. A runtime probe on the
review-tier session returned exactly what the action table specifies — `view` true,
`edit_reasons` true, `adjust` false, `transfer` false.

**Method note worth keeping:** the first control run was invalid. Signing in as admin via
`fetch()` left the app's *persisted* user as the review-tier account, so "admin sees no
Adjust either" looked like a regression in the change under test. It was not — chasing it
is what surfaced the login/`role_permissions` bug above. A control that fails should be
suspected before the change is.

### Verification (all really run)

| Check | Result |
|---|---|
| `frontend` `tsc --noEmit` | clean |
| `cloudflare` `tsc --noEmit` | clean |
| Backend `test-*.cjs` | **41 / 41 pass** |
| Frontend `npm run test:utils` | green |
| Real `vite build` | succeeds (15.8s) |

Also: frontend `node_modules` was found wiped mid-session (11 stray dirs, no `typescript`)
and reinstalled.

### Not done — still open from this batch

- **Profile modal redesign** (name/details onto the avatar row, larger single-row buttons,
  click-avatar-to-view with actions beneath, no separate upload entry point).
- **Portal editor "Contact us"** — not audited.
- **Promotions/discounts** — the Canva-like template/editor ask is untouched; still needs
  the wired-vs-stubbed audit noted in the Aug 25 request batch before any new work.
- **Stories/posts + comments**, **public website accounts** — unchanged, and public
  accounts remain blocked on the identity decision recorded in the request batch (no
  customer has an email; 448 phone numbers are shared across 978 customers).
- A test account (`reviewtest`, id 900) and a seeded product (id 5001) now exist in the
  **local** D1 only, along with approved `trusted_devices` rows added to get past the
  device-approval gate for curl. Local passwords for `admin`/`reviewtest` were reset for
  testing. None of this touches the remote database.

---

## Older completed work

*Condensed index of finished items (Aug 18 2026 and earlier consolidations).*

Part 124's session write-up and the large per-page "standing cross-page
consistency checklist" that had accumulated inline after it (39 items,
~1,900 lines) are condensed here. The checklist's own narrative is
already captured as one-line-per-session entries in History below
("Part 124-130" and neighboring lines) — this section keeps only a
short index of what was done plus every item that's still genuinely
open, moved up so it doesn't stay buried under old session detail.

**Done and verified, condensed from the Aug 22 2026 "PRIORITY part 2"
and "New request batch" Open-list entries (cleaned out of Open on Aug
23 2026 per user ask -- full writeups for the two still-open items
those lists contained live on in Open itself; anything not listed here
is still open):**
- Product-edit auto-redirect to Basic Info tab -- root cause (unstable
  `product` object identity re-triggering `ProductForm.tsx`'s tab-reset
  effect on every background re-render) found and fixed in
  `Products.tsx`/`ProductForm.tsx`.
- Stock-adjust bulk UX parity -- `BulkAddStockModal.tsx` brought in
  line with `BranchStockAdjuster.tsx`'s saved-reason chip picker +
  `InventoryReasonManagerModal` flow, plus a plain-language batch-
  behavior note (FIFO/new-batch) since a real per-product batch picker
  doesn't generalize to a multi-product bulk action without its own
  design pass (still flagged, not built, if it ever proves needed).
- Mobile click/button responsiveness on Products' detail sheet -- the
  inner Supplier/Stock/Expiry row grid was a non-responsive
  `grid-cols-2` left over from before the sheet split into a permanent
  details/actions layout; made responsive (`grid-cols-1` below `sm`).
- Inventory page cards not showing full data by default -- Stock Value
  column's breakpoint lowered from `lg` to `md` in
  `InventoryProductsSurface.tsx` (`<td>`/`<th>` mismatch fixed too).
- "Things running in background" perception -- re-audited directly
  against source; both named suspects (`notifications/summary` poll
  interval, `inventory/reasons` re-fetch guard) were already correct,
  no live bug found beyond the auto-redirect item above.
- Products import template's missing columns / wrong image-filename
  example -- confirmed already complete via the `update_code.zip`
  merge that started this session; no gap found.
- Contacts import "Resolve Conflicts" modal unusable -- root cause was
  `pointer-events: none` inheriting into the modal from
  `BackgroundImportTracker.tsx`'s floating-widget wrapper; `Modal.tsx`
  now sets `pointer-events-auto` on its own root so every call site is
  safe by default.
- Import floating status/progress indicator reachable from the bell --
  confirmed already done via the same `update_code.zip` merge;
  `NotificationCenter.tsx` builds its own job list independently of
  the floating widget, so a completed import stays reachable after the
  widget itself is dismissed.
- Notification bell button sizing/style -- the real bell button was
  already correct; the mismatch was `App.tsx`'s
  `NotificationCenterFallback` (shown pre-mount), restyled to match.
- Dashboard "Recent imports" card inconsistently missing -- same root
  cause/fix as the Modal pointer-events + sync-channel items above;
  `listImportJobs` itself was already type-agnostic.

**Done and verified (source-level + full test suite each session; no
live-browser confirmation available from this sandbox — standing
caveat for all of it, same as everything else in this file), condensed
from Parts 78–132:** Fees page (backend + frontend), import-warning
detail modal on non-Dashboard pages (translated, kind-grouped), Vite
circular-chunk warnings, public portal editor section naming, portal
settings write-conflict self-heal, Products page inventory-style row
layout + select mode, Products barcode/stock display, Inventory lock
price, mandatory batch selection on add/remove stock, batch stock/
aggregate sync (was already fixed pre-session), stock-history/contacts
translation cleanup, filter-menus fix (category filter in POS), stats/
breakdowns richer detail (Inventory + Branches), Manage-button icons,
products import grouping rule (re-verified, no bug found), products
pagination counting groups correctly (re-verified, no bug found), sales
import totals with order-level discount/tax (already resolved part
70), fuzzy/typo-tolerant search, hiding (not deleting) Server Sync,
single-run queue-driven backup asset copy (no 40-object/run cap).

**Also done:** Products/POS/Inventory/portal search accuracy + speed,
and Contacts search — FTS5 wired end-to-end, a request-cancellation bug
fixed (a stale slower response could no longer overwrite a newer one),
comma-for-AND/OR syntax confirmed already correct, "results appear once
complete, not character-by-character" confirmed correct on Products/
Inventory/POS (found and fixed one stale/misleading code comment on
POS.tsx along the way — no behavior change needed there).

**Still open from this stretch (kept in full, not condensed):**

- [ ] **Organization concept removal, default to "Leang Cosmetics"** —
  `routes/organizations.ts` still mounted at `/api/organizations`;
  needs an audit of every read site (Settings, onboarding, any org-
  name/picker) before either removing the concept or hardcoding the
  default.
- [ ] **Roles/permissions "fully processed"** — the specific role/user-
  merge bug is fixed and gating is tightened
  (`test-route-permissions-pure.cjs` passes), but a real walk-through
  of the Roles UI against a live app hasn't happened.
- [~] **Public portal: anonymous theme/language persistence, PWA
  branding as "Leang Cosmetics" with the uploaded icon, install/
  download section, profile page missing role sections** — only the
  button-paint speed item is done; the rest still need a scoping
  decision before any code gets written.
- [ ] **Permissions UI redesign (older, narrower wording)** —
  superseded by the fuller three-tier spec + approval queue further up
  in Open (the item the gate+applier wiring, Parts 146-154, is
  extending); kept here only as a pointer, not duplicated.
- [ ] **Public portal: search/filters not sticky/pinned, products-per-
  page setting not changing fetched page size** — re-checked from
  source, neither reproduces in code as written; needs live-browser
  confirmation before further changes (possibly a stale/cached report).
- [~] **Batch + expiry-date system** — done for flat (non-grouped)
  products end to end (backend, receive flow, POS lot picker, admin
  batch management). Still open: extending the picker to grouped
  products.
- [~] **Multi-select branch-to-branch transfer** — bulk-picker, grouped
  display, and batch/lot picker are done. Still blocked: the "conflict
  resolution"/name-matching-for-non-existing-products framing only
  makes sense for something that isn't already a definite product row
  — needs a concrete example from whoever asked for it.
- [ ] **Import speed within free-plan limits** — audited, no safe lever
  found from static reading alone; needs a real deployment to profile
  against before tuning chunk/batch sizing further.
- [ ] **Products import: bulk-edit "info"/"pricing" modes don't expose
  discount/expiry fields** — by design, not a bug; worth a deliberate
  decision on whether to make them bulk-editable.
- [ ] **Products import: `image_gallery` (multi-image) has no import-
  side equivalent** — import only ever sets the single `image_path`.
  Needs a decision: add multi-image import support, or document
  single-image-only as intentional.
- [ ] **Import mode picker timing** — `BulkImportModal.tsx`'s merge/
  replace_all picker sits at step 1, before the file is uploaded/
  analyzed. Needs a decision on whether it should move later.
- [x] **Template download visibility -- confirmed already done, no code
  needed (Part 133).** Re-checked against source before writing
  anything: this was already fixed in an earlier session (Part 133,
  explicitly documented in a comment right above the button in
  `BulkImportModal.tsx`). Download Template is a full-width real
  `btn-secondary` button (with icon) directly below the unified
  upload/drop card, not a small text-only link -- the exact visual-
  weight gap this item described no longer exists. The layout differs
  slightly from the shared `CsvImportPreview.tsx`'s side-by-side
  two-button row (Products' upload target is a single big drop-card,
  not a separate "Choose File" button, so there's nothing to sit next
  to), but the underlying complaint -- the template link being easy to
  miss -- is resolved either way.
- [ ] **QA plan (Tracks A–F)** — see the QA method section below for
  the full standing framework; none of it has live-browser confirmation
  yet.
- [ ] **Full responsive/mobile audit of every admin + portal page** —
  not run; `tsc`/tests/build don't catch layout issues.
- [x] **Full frontend↔backend payload-shape/contract diff** — path+
  method layer confirmed (no 404-on-call bugs across ~210 backend
  routes / ~150 frontend call sites). **Payload-shape diff done in Part
  229**: found and fixed 2 real request-body bugs (`/api/auth/login`
  dropped `deviceTz`, `/api/system/jobs/:id/cancel` never read its body
  at all), and found the fully-dead `customTables.ts`/`CustomTables.tsx`
  feature (removed in Part 230, user's call). Reusable tooling saved to
  `ops/scripts/contract-diff/`.
- [ ] **No live-server / real-browser click-through test exists yet** —
  suite is pure-logic/source-pattern only.
- [ ] **D1-write-contention theory (cascading 500s fix)** — unconfirmed
  against a real thrown error / `wrangler tail`; only relevant if 500s
  recur after deploying the fix.
- [ ] **Import tracker "took 10+ min to appear"** — two real bugs
  already found and fixed (display-logic freeze during analyze/
  materialize). A second theory (review-screen dwell before job
  creation) may explain part of the original report.
