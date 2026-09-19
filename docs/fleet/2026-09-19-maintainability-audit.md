# Maintainability review and Claude continuation — 19 September 2026

## Scope and truthful status

Reviewed continuation branch `codex/supplier-settlement-20260918` at `45a0831b`,
not the stale, dirty `business-os-v1/main` checkout. There are 867 tracked files
under frontend/src and cloudflare/src. This is a repository-wide structural
review with targeted reference tracing, not line-by-line certification of every
file or proof that every remaining route is used. No runtime code, dependency,
database record, migration, or deployment was changed by this review.

The latest recorded live release is `de8c72fa9514` (authentication/startup).
Current code adds the legacy account-key cleanup (`0e1b7407`) and browser
regressions (`45a0831b`). Its recorded browser result is 12 passed / 6 skipped,
with typecheck, i18n and production build passing. The skips cover two unresolved
logout/stale-read scenarios across three browser projects. This is NOT evidence
that every account-switch error is fixed. No deployment of this candidate is
confirmed. A fresh runtime-version request on 19 September was blocked by a
Cloudflare challenge; do not treat that response as an application failure or
as proof of a release version.

The four approved supplier invoice settlements are already recorded as applied
by migration 0183. Do not repeat them. Other historical data reconciliation and
physical 80 mm printer validation remain separate open work.

## Evidence and classification

Fresh read-only compiler probes:

```
frontend: node node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false
cloudflare: node node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false
```

Both returned exit 1 for unused declarations: **39 frontend / 4 backend**.
These are declarations, not 43 removable features. Unused exports require a
separate importer/entry-point audit; a locally unused value can still perform
necessary work in its initializer. The old handoff's “114 dead helpers” is a
historical candidate count, not a current deletion allowlist.

Impact estimates below describe source/query reduction, not measured bundle
or latency improvements. Tree shaking may already remove unused functions.

## Findings

### 1. P1 — Cleanup-budget tests can incorrectly report success

Evidence: frontend/tests/unusedLocalsBudget.test.ts:108 and
cloudflare/scripts/test-unused-locals-budget-pure.cjs:46 invoke the compiler,
then count only TS6133/TS6196 messages. Neither checks spawn errors, termination,
or unexpected diagnostics. A failed compiler launch can therefore look like
zero unused declarations. Count budgets also allow a new defect to replace an
old one without increasing the total.

Plan: share a small compiler-result parser; reject startup failures/signals and
unexpected diagnostics; include all relevant unused diagnostic codes; ratchet
an explicit file/symbol baseline downward, ultimately enabling compiler flags.
Add negative-control tests for missing executable and unexpected compiler error.
Impact: trustworthy cleanup gate, little runtime effect. Risk: compiler exit 1
is expected while known unused declarations remain, so do not simply require 0.

### 2. P1 — Dead handlers are kept alive by tests of source text

Evidence: unused `handleSave` at Products.tsx:2193; the actual form calls
`handleSaveWithGallery` at :5470. actionStability.test.ts:450 explicitly requires
the old function to remain findable. Unused `handleTransfer` at
branches/TransferModal.tsx:930 and two timeout constants at :43–44 are also
referenced by source-shape guards such as branchTransferReason.test.ts:103,161.

Plan: test the actual wired save and transfer commands, including duplicate
clicks, retry identity, failure and permission denial. Then remove dead handlers
and their exclusive dependencies. Do not remove transfer capability or its
shared planner. Impact: roughly a hundred-plus lines of misleading alternative
mutation code and fewer false coverage claims. Risk: deleting the only tested
path without testing its replacement conceals regressions.

### 3. P2 — Unused bootstrap component has a misleading comment and test

Evidence: AppContext.tsx:608 defines `LoadingScreen`, with no caller (compiler
confirmed). iosLayoutGuards.test.ts:424 still asserts its viewport string.

Plan: move the viewport behavior assertion to the real startup/recovery UI,
then delete the component. Impact: about a dozen source lines; no expected
runtime performance gain. Risk: retain the actual blocked-storage recovery and
root-error boundary, which are active safety mechanisms.

### 4. P1 — Redundant FIFO query before the authoritative transfer planner

Evidence: routes/inventory.ts:2388 reads lots and allocates them only to compute
unused `movementBatchId` at :2392. It then invokes planTransferOperation at
:2395. lib/transferOperation.ts:75–84 performs its own batched availability read
and allocation. lib/productBatches.ts:866 confirms the first read is a SELECT.

Plan: remove the preliminary read/allocation and its unused import bindings;
retain shared planner validation, atomic batch, idempotency, audits and rollback.
Impact: **one fewer lot SELECT per affected transfer**, plus one fewer allocation.
Risk: test selected-lot, FIFO, mixed-lot, insufficient-stock and retry scenarios;
do not substitute an earlier stale snapshot for the planner's current read.

### 5. P2 — Supplier section rows are constructed but never supplied to the table

Evidence: SuppliersTab.tsx:617 flattens sections into plain suppliers;
:621 constructs `displayRows` with section markers; :1271 passes only
`visibleSuppliers` to ContactTable. renderRow's section branch at :1286 expects
markers that this input does not contain. Compiler confirms displayRows unused.

Plan: decide explicitly whether supplier grouping/collapse remains intended.
If yes, wire section rows while preserving selection/export of supplier records;
if not, retire section construction, unreachable rendering and controls together.
Impact: removes wasted memo work and an entire contradictory rendering path.
Risk: not safe to label the whole feature unwanted merely because it is unwired;
desktop/mobile selection, pagination and accessibility need parity tests.

### 6. P2 — Obsolete Settings image-upload entry points

Evidence: utils-settings/Settings.tsx:863 `cancelImageUpload` and :870
`uploadImageSetting` have no callers (compiler confirmed). The latter owns file
picker, preview URL, controller, progress and upload flow. Some associated state
still controls loading/Save UI, so deletion must trace beyond the two functions.

Plan: trace the current image/settings UI, remove only the obsolete upload flow
and exclusively owned state, and test active branding/receipt image editing.
Impact: dozens of lines and unnecessary state machinery; bundle benefit unmeasured.
Risk: do not remove generic upload transport or cancellation used elsewhere.

### 7. P2 — Import-review subsystem contains a disconnected cluster

Evidence: BulkImportModal.tsx has compiler-confirmed unused renderConflictRow
(:2256), renderConflictFilterChip (:2238), bulk decision handlers (:2182–2209),
undo/collapse/selection helpers and summary values. These are one connected
feature cluster, not independent trivial deletions. productImportPlanner tests
include source-shape checks of this modal.

Plan: map the active server-job review flow against the old client conflict UI;
prove cancellation, image/identifier decisions and undo remain supported before
retiring the old cluster. Impact: potentially hundreds of lines and less state
churn. Risk: high if import semantics or user decisions are silently removed.

### 8. P2 — Accepted-but-ignored filter/menu parameters obscure contracts

Evidence: productFilterHelpers.ts:96,98 destructures unused groupFilter and
parentProductIds; :162–182 explains why filtering must stay server-side over the
full catalog. productMenuHelpers.ts:322–340 has unused sort/supplier plumbing;
POS FilterPanel.tsx:72 accepts unused suppliers.

Plan: remove obsolete internal parameter plumbing and update callers/types.
Do NOT re-enable filtering over a single downloaded page just to use variables.
Impact: clearer server/client responsibilities and fewer apparent controls that
do nothing. Risk: group/search/stock filters can hide valid products if applied
twice; test matching records outside page one.

### 9. P3 — Small confirmed backend dead declarations

Evidence: returns.ts:90 unused ReplacementCustomerStateConflictError;
salesAnalytics.ts:1706 unused recognizedStoreDeliveryUsd;
products.ts:3561 unused ids destructuring binding.

Plan: remove the unused class/local/binding after reference tests; keep the
underlying conflict enforcement, accounting fields and reparentedByTable data.
Impact: approximately 15 lines, mostly readability. Risk: deleting the whole
snapshot field/column rather than a local binding would harm merge recovery or
historical accounting. Investigate an unwired error path before treating the
unused class as proof that customer conflicts need no enforcement.

### 10. P2 — Repeated contact loading state machines

Evidence: CustomersTab.tsx:320,634; SuppliersTab.tsx:498,747;
DeliveryTab.tsx:496,749 repeat request IDs, promise dedupe, watchdogs, paging and
stale-result protection.

Plan: extract a narrow, account-aware paged-read hook with injected fetcher and
labels, not one universal contacts component. Keep domain writes and permission
rules separate. Impact: fewer places to repair stale-response and loading bugs;
query-count reduction requires measurement and is not assumed.
Risk: sharing cache keys or mutable state across entities/accounts reproduces
the very isolation bugs being fixed. Test account change during an in-flight read.

### 11. P2 — Oversized orchestration files make local changes non-local

Measured nonblank lines: backend products route 8,358; importEngine 6,388;
sales route 6,079; frontend Products 5,425; POS 4,207; CatalogPage 3,421;
salesAnalytics 3,005. Size is not proof of dead code, but these files combine
multiple independently changeable responsibilities.

Plan: extract tested operations in small batches: identity/merge, lot movement,
sale amendment/settlement, import planning, read query builders, and view models.
Keep route authorization/transaction boundaries explicit. Use the existing
transferOperation planner as a pattern rather than inventing a new framework.
Impact: high maintainability; no guaranteed speed-up from moving code alone.
Risk: a wholesale rewrite could split atomic writes or drift financial formulas.

### 12. P2 — Handoff history and cleanup comments are not a reliable current inventory

Evidence: shared main progress starts with September 10 notes, while continuation
contains September 18 releases; CLAUDE_HANDOFF has multiple historical “LATEST”
paragraphs. unusedLocalsBudget comments still discuss already-retired preload
code. Existing migration/repair scripts and evidence may have no code imports
but remain operationally necessary.

Plan: maintain one current status manifest (source SHA, deployed SHA/version,
migration tail, open blockers) with historical entries beneath it. Index one-off
repair scripts with purpose, supersession, prerequisites and replay safety.
Archive rather than delete recovery evidence. Impact: less duplicated work and
lower risk of deploying stale branches or re-running data repairs.
Risk: older logs are audit/recovery evidence, not disposable application bloat.

## Dependencies, routes and abandoned-file limits

No blanket dependency removal is justified. Direct consumers confirmed:
`html2canvas` in utils/printReceipt.ts:941; `qrcode` in
components/receipt/ReceiptQrCodes.tsx:22 and OtpModal; `xlsx` in spreadsheetImport
and xlsxExport; `dexie` in api/localDb.ts:11; `@ffmpeg/ffmpeg` in
utils/videoCompression.ts:100; `@zxing/browser` in scanning code. They are not
dead merely because their features are lazy-loaded. Review package declarations
separately from transitive packages and runtime-copied WASM assets.

The Worker entry contains 34 route mounts. No route is certified removable by
this review. Whole-file abandonment needs an import graph including dynamic
imports, config, tests, generated runtime scripts, operator commands and external
API clients. Earlier custom-tables and Capacitor removals are already guarded
by deadFeatureRetirement.test.ts; do not report them as newly found open work.

## Safe cleanup sequence

1. Harden the diagnostic gate and replace tests tied to dead handlers. Pin an
   explicit candidate list, not the historical 114 count. No production writes.
2. Remove proven dead locals/components and the redundant FIFO read in small
   commits. Run focused behavioral tests, types, i18n and production builds.
3. Resolve disconnected features (supplier sections/import review) against the
   requested capabilities. Restore or retire explicitly, with responsive tests.
4. Consolidate contact read lifecycle and pure financial/stock helpers only with
   before/after behavior, query-count and accounting parity evidence.
5. Re-run broad frontend and Worker suites; preserve known native-runner failure
   evidence rather than suppressing it. Verify built online/offline startup,
   account handover and permission variants. Deploy as a separate authorized
   implementation checkpoint, with rollback provenance and live smoke.

## Never delete based only on no text references

- Mounted API routes: external clients, scheduled jobs, sync and older clients
  may call them without a frontend literal. Trace index.ts mounts and contracts.
- Append-only D1 migrations, repair preimages, audit/undo links and legacy money
  snapshots. Old data still needs readers; old naming is not proof of disuse.
- Idempotency records, account fences, pending financial requests, recovery and
  offline compatibility. Apparent redundant guards may protect different races.
- CSS-selected/generated assets, dynamic imports, Worker bindings, free/paid
  deployment configurations, scripts invoked by operators or CI.
- Translation keys: dynamic lookup can defeat literal-reference searches.

Do not guess customer genders, merge identities or rewrite historical totals as
part of code cleanup. Those require their existing evidence-based data workflow.
