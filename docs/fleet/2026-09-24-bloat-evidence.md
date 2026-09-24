# Business-OS maintainability sweep — bloat/dead-code evidence
HEAD a29fb3823 on claude/cloud-handoff-20260924-0unu3f, read-only. Method: module-reachability
BFS from real entry points, ts-prune (frontend + cloudflare tsconfigs), targeted grep
cross-checks against every deletion-risk surface named in the task (window.api proxy,
Web Workers, service worker, cloudflare routes, ops scripts, tests, docs). Every "search
miss" is labelled as such and kept separate from "proven dead" per instructions.

Legend: Confidence — HIGH (proven with a positive/negative reference sweep), MEDIUM
(strong signal, one plausible alternate explanation not fully ruled out), LOW (single
tool hit, not independently confirmed).

## 0. Tooling caveats that gate everything below (read first)

- **CF-1 / FE-1 — `frontend/src/api/methods.ts` and `frontend/src/web-api.ts` are `@ts-nocheck`
  behind dynamic `import()` + property access** (e.g. `const module = await
  loadActionHistoryTransport(); return module.getActionHistory(...)`). Because the module is
  typed `any`, ts-prune's reference tracking cannot connect `module.getActionHistory` back to
  the export. **389 of 1485** raw frontend "unused export" ts-prune hits are under
  `src/api/*Transport.ts` and are System-level false positives from this pattern, confirmed by
  reading `methods.ts`/`web-api.ts` and spot-checking `getAuditLogs`/`getActionHistoryDetails`.
  Treat every `*Transport.ts` ts-prune hit as **not applicable** unless independently grep-verified.
- **FE-2 — default exports consumed only via `React.lazy(() => import(...))`** are a second
  systematic ts-prune false-positive class (confirmed on `AdminRoot.tsx`, `PublicCatalogRoot.tsx`,
  both proven alive by the BFS graph below, yet flagged "default unused"). This app code-splits
  almost everything through `lazy`, so any "default (unused)" ts-prune hit needs a manual
  dynamic-import grep before it is trusted.
- **CF-2 — `cloudflare/scripts/test-*.cjs` (the pinned pure-function gate) sit outside
  `cloudflare/tsconfig.json`**, so ts-prune cannot see them as consumers. Spot-check found **40 of
  114** non-route cloudflare "unused export" hits are actually imported live by those pinned
  tests (e.g. `resolveActorUsername`, `allocateMembershipSequences`, `isLowStock`,
  `readFifoLotAvailability`). Not applicable unless the specific symbol is absent from
  `cloudflare/scripts/*.cjs` too.
- Neither ts-prune list is proof of anything by itself, in either package. Every item below that
  is marked "proven dead" was independently confirmed by a grep across the whole repo (src, tests,
  scripts, docs, migrations), not by ts-prune alone.

## 1. Dead frontend files (module-reachability BFS from `src/index.tsx`,
`src/AdminRoot.tsx`, `src/PublicCatalogRoot.tsx`, `src/public-runtime/service-worker.ts`)

653 source files under `frontend/src`; 639 reached by static `import`/`import()` resolution.
20 unreached — verified individually below (the BFS itself cannot see `new Worker(new
URL(...))`, non-bundled build-script entries, or ambient `.d.ts` files, so those needed a
second pass).

| ID | Location | Evidence | Confidence | Why unnecessary/costly | Impact | Deletion risks | Verification needed |
|---|---|---|---|---|---|---|---|
| FE-D1 | `frontend/src/components/inventory/DualMoney.tsx` (15 lines) | BFS unreached; `grep -rn DualMoney frontend/src` and `frontend/tests` hit only the file's own definition; git-touched only once (May 28, 2026 TSX-conversion sweep), never since | HIGH — proven dead | Small presentational component, fully superseded (inventory rows format dual-money inline elsewhere); zero call sites, zero tests | Trivial (15 LOC) | None found: no dynamic import, no `window.api` link, no test references it | Delete, re-run `npm run build` + `npm run test:utils`; grep repo once more post-delete for `DualMoney` |
| FE-D2 | `frontend/src/components/shared/kit/KitGallery.tsx` (256 lines) | BFS unreached; task's own known lead confirmed — nothing imports it | HIGH — proven dead (pre-known) | Dev-only gallery of `StatStrip`/`TileGrid`/`HubTile` kit components; those three are otherwise live but ONLY reachable through this dead gallery besides their real call sites (checked: `HubTile.tsx`, `StatStrip.tsx`, `TileGrid.tsx` are separately imported live elsewhere — verify before deleting the gallery does not orphan them) | 256 LOC | None — a pure dev-preview screen with no route | Delete `KitGallery.tsx`; confirm `HubTile`/`StatStrip`/`TileGrid` still have real importers after (they do, per grep) |
| FE-D3 | `frontend/src/components/shared/PageSizeSelect.tsx` (256 lines) | BFS unreached; **multiple pinned tests assert it must NOT reappear** — `tests/storefrontPagerRow.test.ts:18` (`doesNotMatch(centered, /<PageSizeSelect/...)`), `tests/paginationRangeControl.test.ts:76` ("P10-20 removed the per-page dropdown from this branch entirely"); `tests/paginationRangeControl.test.ts:41,103-110` still reads the file's source text directly to pin its `buttonContent` API contract | HIGH — proven dead in production, but API-pinned by a test | Confirmed retired UI pattern (P10-20 removed the per-page-count control); component kept alive only by a test reading its source as text, not by any render call site | 256 LOC + one test file's worth of pinned assertions | The pinned test (`paginationRangeControl.test.ts`) will fail if the file is deleted without also removing/rewriting that test — this is a real coupling, not a false alarm | Decide: delete component AND retire its dedicated pin, or keep both as intentionally-preserved reference code. Do not delete the file alone |
| FE-D4 | `frontend/src/components/shifts/CurrentShiftSummary.tsx` (62 lines) | BFS unreached; 5 pinned tests assert its ABSENCE from Sales/Reports/Fees/Hub surfaces (`tests/salesPolishSurface.test.ts:86`, `tests/reportHubLayoutOrder.test.ts:26`, `tests/shiftManagement.test.ts:221,227`, `tests/statsStrip.test.ts:232`) in favor of `ShiftHistoryModal`/`ShiftReport` | HIGH — proven dead, superseded | Retired shift-overview block; replaced by selectable `ShiftReport` + `ShiftHistoryModal`/`ShiftHistoryPanel` everywhere it once appeared | 62 LOC | None found — negative-assertion tests exist specifically to prevent reintroduction, so deleting the file cannot break them | Delete; the 5 negative-assertion tests should still pass (they assert absence, not presence) |
| FE-D5 | `frontend/src/components/utils-settings/index.ts` (barrel, 7 lines) | BFS unreached; `grep -rn "from ['\"][./]*utils-settings['\"]"` across `frontend/src` → 0 hits | HIGH — proven dead | Re-export barrel for `AuditLog`/`Backup`/`Settings`/`ResetData`/`FactoryReset`/`FontFamilyPicker`/`OtpModal`; every one of those is imported by its own direct relative path elsewhere (`SettingsHubPage.tsx`, `Settings.tsx`, etc.) — the barrel itself is never the import path used | Trivial | None — the underlying components are all independently reachable and confirmed alive; deleting the barrel does not touch them | Delete barrel; run `tsc --noEmit` to confirm nothing resolves through it |
| FE-D6 | `frontend/src/utils/index.ts` (barrel, 5 lines) | BFS unreached; same barrel pattern — `fmtTime/fmtDate/fmtDateTime24/fmtShort/fmtCount`, `downloadCSV`, `todayStr/offsetDate/businessYear/businessMonth` all confirmed imported directly from their real modules (29/21/2 direct importers respectively) | HIGH — proven dead | Same as FE-D5 | Trivial | None | Delete; `tsc --noEmit` |
| FE-D7 | `frontend/src/__lightbox_test_entry.tsx` (28 lines) | BFS unreached; no corresponding `.html` entry exists (only `frontend/index.html`); only git touch was the Aug 25 2026 bulk sync commit | HIGH — proven dead | Manual dev scratch harness for `ImageGalleryLightbox`, never wired to any Vite entry or test | Trivial | None | Delete |
| FE-D8 | `frontend/src/api/returnsStatementTransport.ts` (77 lines) + `frontend/src/utils/returnsExportWindow.ts` | BFS unreached for the transport; **but** both are exercised by a real, substantial unit test (`tests/returnsStatementExport.test.ts`) exercising `returnsStatementParams`/`readCompleteReturnStatement`; file touched Sept 20 2026 (4 days before HEAD) with commit "Prepare annual Returns statement guards and actor-fenced traversal" | MEDIUM — **not dead, in-progress feature** | Built and tested, but no UI component calls `readCompleteReturnStatement` yet — a staged/half-shipped "annual Returns statement" export feature | N/A — do not delete | Deleting would destroy in-flight, actively-authored work with a real pinned test | Ask the owner/author whether the Returns-statement UI wiring is still coming before doing anything; re-check in a week |
| FE-D9 | `frontend/src/components/products/import/productReplaceImportPlan.ts` (149 lines) + its test `tests/productReplaceImportPlan.test.ts` | BFS unreached; `BulkImportModal.tsx` implements the same `replace_columns`/`replace_all` concept **inline**, sending `replace_columns` directly to the backend's `importEngine.ts`, never calling `planProductReplaceImport`/`analyzeProductImportRows`-based plan from this file | HIGH — proven dead, genuine parallel implementation | The file's own header comment argues explicitly against building a second copy of the matching logic ("exactly the kind of parallel implementation [the] golden rule exists to prevent") — yet the file itself is exactly that: a fully-built, fully-tested Replace-mode planner that was never wired into `BulkImportModal.tsx`, which shipped its own separate replace-mode flow instead | 149 LOC + 1 test file | None found in production; the pinned unit test exercises only this orphaned module, not the shipped path | Confirm with the import feature's author whether `productReplaceImportPlan.ts` was an abandoned first draft of Replace mode; if so, delete both the module and its test together |
| FE-D10 | `frontend/src/components/utils-settings/SaleIncidentRecovery.tsx` (107 lines) + `frontend/src/utils/saleIncidentRecovery.ts` (240 lines) | BFS unreached; `ResetData.tsx` (the actual repair-tools hub) imports `LegacySubtotalRepair`, `GeneralCustomerRepair`, `GeneralCustomerMembershipRepair`, `SaleNotPaidStockRecovery` — **but not `SaleIncidentRecovery`**; full backend counterpart exists and is routed (`cloudflare/src/routes/system.ts:860-1069` calling `cloudflare/src/lib/saleIncidentRecovery.ts` + `saleIncidentRecoveryV2.ts`); frontend commits as recent as Sept 22-23 2026 ("fix(settings): retain uncertain sale recovery replay", "feat(settings): add proven fourth sale recovery") | HIGH — confirmed unwired, NOT confirmed abandoned | A fully backend-complete, fully frontend-tested (`tests/saleIncidentRecovery.test.ts`, referenced by `tests/notPaidTerminology.test.ts:218`) 4th sale-recovery tool whose UI panel is simply never mounted anywhere a user can reach it — the wiring step into `ResetData.tsx`'s render tree appears to have been missed, one day before this HEAD | 347 LOC across 2 files, plus its Worker-side lib/route code stays reachable only via direct API calls, never via UI | **Do not delete.** This looks like an incomplete feature landing, not dead code — deleting would strand a working backend recovery path with no way for an admin to reach it | Ask the author (commits are by `ungsethypagna@gmail.com`, the current user) whether wiring into `ResetData.tsx` was intentionally deferred or simply missed; if missed, the fix is one `<SaleIncidentRecovery />` render line, not a deletion |
| FE-D11 | `frontend/src/public-runtime/runtime-noise-guard.ts`, `frontend/src/public-runtime/theme-bootstrap.ts` | BFS unreached from the `import`/`import()` graph, but confirmed alive: compiled separately by `ops/scripts/frontend/build-public-runtime-scripts.ts` into `public/*.js`, then inlined into `index.html` by the `inlinePublicRuntimeScripts` Vite plugin; also referenced from `service-worker.ts` (cache-list) and `runtimeErrorClassifier.ts` | N/A — **not dead**, BFS blind spot (separate build entry, not an ES import) | — | — | — | None — false alarm, documented here only so the "20 unreached" count is fully accounted for |
| FE-D12 | `frontend/src/components/contacts/contactImportWorker.ts`, `inventoryImportWorker.ts`, `productImportWorker.ts`, `salesImportWorker.ts`, `frontend/src/utils/csvExportWorker.ts` | BFS unreached, but confirmed alive: each is loaded via `new Worker(new URL('./xImportWorker.ts', import.meta.url), { type: 'module' })` from `ContactImportModal.tsx`, `InventoryImportModal.tsx`, `BulkImportModal.tsx`, `SalesImportModal.tsx`, `utils/csv.ts` respectively | N/A — **not dead**, BFS blind spot (Web Worker construction, not a static import) | — | — | — | None — false alarm, documented for completeness |
| FE-D13 | `frontend/src/types/lucide-react-icons.d.ts` | BFS unreached | N/A — **not dead** | Ambient module declaration (`declare module 'lucide-react/dist/esm/icons/*.js'`), does not need an explicit import to take effect | — | — | None |

**Dead-export spot-checks in live files (not whole dead files), via the ts-prune list filtered
for both false-positive classes above:**

| ID | Location | Evidence | Confidence | Notes |
|---|---|---|---|---|
| FE-D14 | `frontend/src/constants.ts:194` `isNetworkError` | `grep -rn "\bisNetworkError\b" frontend/src` → only its own definition | HIGH — proven dead | Safe to delete, single function |
| FE-D15 | `frontend/src/constants.ts:65` `WRITE_CHANNELS` | Same check → only its own definition | HIGH — proven dead | Safe to delete |
| FE-D16 | `frontend/src/constants.ts:52` `STOCK` | Same check → every other hit of the bare word "STOCK"/"stock" in the codebase is unrelated English prose in comments/strings, not this identifier | HIGH — proven dead | Safe to delete |
| FE-D17 | remaining ~180 non-default, non-`api/*Transport`, non-big-component-folder ts-prune hits under `src/app/`, `src/AppContext.tsx`, `src/api/query.ts`-adjacent files, etc. (see `src-unused-exports.txt` in the evidence dir) | ts-prune flag only; NOT individually re-verified given time budget | LOW — **search miss, not proof** | Needs the same per-symbol grep done for FE-D14-16 before any is treated as a deletion candidate. Explicitly not claimed dead. |

## 2. Dead Worker code (cloudflare)

All 27 route modules are mounted in `cloudflare/src/index.ts:489-522` — no orphaned
`app.route()` registration found. Individual-endpoint-level dead-code check was not
exhaustive (see Limitations); one concrete, fully-verified case:

| ID | Location | Evidence | Confidence | Why unnecessary/costly | Impact | Deletion risks | Verification |
|---|---|---|---|---|---|---|---|
| CF-D1 | `frontend/src/api/reportsTransport.ts:11-14` `getBusinessSummary()` calling `GET /api/reports/business-summary` | `grep -rn "getBusinessSummary("` in `frontend/src` → only its own definition, zero callers; `grep -n "app.get('/business-summary"` in `cloudflare/src/routes/reports.ts` → 0 matches (only `/business-summary/${kind}` at line 513, and `/overview`, `/periods`, `/grouped`) | HIGH — proven dead AND broken (calls a route that does not exist) | Confirms the task's known lead exactly: dead frontend function whose one and only backend target route was never implemented (only the `/sales`, `/returns`, `/expenses` sub-paths exist) | 1 function, ~4 lines | None — zero callers means no runtime path depends on it | Delete `getBusinessSummary` from `reportsTransport.ts`; no route change needed since the backend never had it |
| CF-D2 | `cloudflare/src/lib/branchRoles.ts` `branchCanBeTransferSource`/`branchCanBeTransferDestination`, `cloudflare/src/lib/phone.ts` `samePhone`, `cloudflare/src/lib/promotionRules.ts` `activeRulesForProduct`, `cloudflare/src/lib/cache.ts` `getOrSetJson`/`versionedKey` (only referenced from a design doc, `docs/fleet/2026-09-08-cloudflare-architecture-plan.md:1466`, not from code) | ts-prune hit, confirmed zero references anywhere in `cloudflare/src`, `cloudflare/scripts/*.cjs`, `ops/scripts`, or `docs` (except the one doc mention for `getOrSetJson`) | MEDIUM — search-confirmed absent, but not deep-traced against Worker cron/Queue/Durable-Object dynamic dispatch | Small exported helpers with no import anywhere found | <10 LOC each | Cron (`cloudflare/src/queue.ts`) and Durable Objects were grep-checked, not fully traced line-by-line; low but nonzero risk of a call built by string/property dispatch this grep can't see | Re-grep with `\bsymbol\b` immediately before deleting; run `cloudflare` `npx tsc --noEmit` + the pinned `test-*.cjs` sweep after |
| CF-D3 | Remaining ~30 of the 35 non-route, non-script-consumed ts-prune hits in `cloudflare/src/lib/*` (full list in `cf-remaining.txt`) | ts-prune flag only, spot-checked 5/35 (CF-D2 above) | LOW — **search miss, not proof** | Not individually verified given budget | — | — | Needs the same per-symbol grep as CF-D2 before treating any as a deletion candidate |
| CF-D4 | Duplicate logic: `cloudflare/src/lib/membershipNumber.ts`'s `isHouseMembershipNumber` (flagged unused inside `cloudflare/src`) is **mirrored, not imported**, by `ops/scripts/migration/list-non-house-membership-numbers.mjs:70` (comment there: "Mirrors cloudflare/src/lib/membershipNumber.ts's isHouseMembershipNumber") | Read both files; the ops copy is a hand-kept duplicate, not a shared import | HIGH | Two independently-maintained implementations of the same house-membership-number predicate; if one changes format rules the other silently drifts | Correctness/drift risk more than size | The ops copy is pinned by `ops/scripts/migration/test-list-non-house-membership-numbers-pure.cjs` — do not just delete either side | Recommend the ops script import the shared implementation (needs a build step check — ops scripts run standalone with `node`, not through the Wrangler bundle) rather than deleting the cloudflare export outright |

**Not checked**: per-route-handler dead branches, unused query params, and Durable Object
method surfaces (`syncUploadSession.ts` etc.) beyond the grep above — flagged as a
Limitation, not asserted clean.

## 3. Unused dependencies

| Package.json | Result |
|---|---|
| `frontend/package.json` `dependencies` | **None unused.** All 11 (`@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@fontsource/noto-sans-khmer`, `@zxing/browser`, `@zxing/library`, `dexie`, `html2canvas`, `lucide-react`, `qrcode`, `react`, `react-dom`, `xlsx`) confirmed used, mostly via dynamic `import()` (ffmpeg, html2canvas, qrcode, zxing) or CSS import (`@fontsource/.../*.css` in `src/index.tsx:4-6`). `@zxing/library` has **zero direct imports** but is a required `peerDependency` of `@zxing/browser` (`node_modules/@zxing/browser/package.json`) — correctly declared, not removable. |
| `cloudflare/package.json` `dependencies` | **None unused.** `bcryptjs` (6 references) and `hono` (83 references) both live. |
| devDependencies (both packages) | Excluded per task scope (build tooling: vite, typescript, wrangler, playwright, tailwind, etc.) |

## 4. Orphan i18n keys (`verify:i18n` reports 990, threshold 100)

Reproduced the checker's own `orphanPackKeys` logic standalone (permissive: a key counts as
"referenced" if its exact text appears anywhere inside ANY quote — single, double, or
backtick — in any `.ts`/`.tsx` file under `frontend/src`, outside the 7 hand-enumerated
`DYNAMIC_KEY_PREFIX_FAMILIES` in `ops/scripts/frontend/i18nPackChecks.ts`). Full 990-key list
saved to `orphan-keys.txt` in the evidence dir; bucketed by prefix.

| ID | Family / sample | Evidence | Classification | Notes |
|---|---|---|---|---|
| I18N-1 | `perm_section_*_desc` (10 keys: `perm_section_admin_desc`, `perm_section_full_access_desc`, etc.) | `PermissionEditor.tsx:333`: `` translate(`${section.tKey}_desc`, section.description) `` — a genuine dynamic key built from a runtime `tKey` field plus a `_desc` **suffix** | **Dynamic — false positive in the checker itself**, not a removal candidate | `DYNAMIC_KEY_PREFIX_FAMILIES` only models fixed *prefixes*; it has no concept of a suffix appended to a *runtime-chosen* base (`section.tKey`), so this whole family will always misreport as orphaned until the checker is extended. Recommend widening the checker, not touching these keys. |
| I18N-2 | `sale_customer_*` (19 keys: `sale_customer_profile_permission`, `sale_customer_membership_permission`, `sale_customer_general_scope`, `sale_customer_name_exists`, etc.) | `grep -rn` for each exact key string across `frontend/src`, `frontend/tests`, `cloudflare`, `ops`, `docs` → **zero hits anywhere**, not even in a test fixture or a template-literal prefix | HIGH confidence **likely safe to remove from both packs** | No dynamic-prefix shape found either (no `` `sale_customer_${x}` `` anywhere) — looks like leftover keys from a customer-assignment-permission design that shipped under different key names |
| I18N-3 | `rpt_*` (29 keys: `rpt_pending_cogs`, `rpt_compare`, `rpt_hint_pending_profit`, etc.) | Same sweep: zero literal call sites; `rpt_pending_cogs` appears **only** as a list entry in `frontend/tests/notPaidTerminology.test.ts:31` (a lang-consistency fixture list, not a call site) | MEDIUM — likely dead in production, but referenced by name in one test fixture | Before deleting, check whether `notPaidTerminology.test.ts`'s list is itself stale or still asserting something meaningful about these keys |
| I18N-4 | `confirm_delete_{branch,branches_count,customer,customers,delivery,delivery_count,role,row,supplier,suppliers}` (10 keys) | Zero literal hits anywhere; sibling key `confirm_delete_import` (not in the orphan list) **is** live at `BulkImportModal.tsx:1660`, confirming the pattern itself is real elsewhere but these 10 specific variants are not wired to any current delete-confirmation call site | HIGH confidence **likely safe to remove**, pending a check that the corresponding delete flows don't use inline English strings instead of a pack key (would make deletion correct) or a differently-spelled key (would mean a live typo bug instead) | Recommend checking `Branches.tsx`, customer/supplier/delivery delete handlers for their actual `window.confirm(...)` text before deleting |
| I18N-5 | `branch_stat_*` (7), `email_sender_*` (6), `export_filtered_*` (9), `identity_history_*` (6), `scanner_step_*` (7) | Same zero-hit sweep across all listed surfaces | MEDIUM — likely safe to remove | Not traced against Telegram bot message templates or backup/email code specifically for `email_sender_*`; recommend one more grep pass scoped to `cloudflare/src/lib/googleDrive.ts`/`telegram.ts`/notification code before deleting, since those are the plausible dynamic producers of "email sender" copy |
| I18N-6 | Remaining ~890 of the 990 | Not individually sample-checked | LOW — **search miss, not proof**, per the checker's own comment in `i18nPackChecks.ts` ("most of them behind wrapper functions ... treating this list as ground truth for deletion would be its own bloat") | Any bulk deletion pass should re-derive the list after fixing I18N-1's suffix-family gap first, since that will shrink the false-positive share |

## 5. Duplicate logic

| ID | Location | Evidence | Confidence | Notes |
|---|---|---|---|---|
| DUP-1 | Export UI: `frontend/src/components/shared/ExportOptionsDialog.tsx` (canonical, reused by Sales/Fees/AuditLog/DeliveryTab/CustomersTab/SuppliersTab/Inventory/Returns/Branches — 9 consumers) vs `frontend/src/components/sales/ExportModal.tsx` (Sales-only, period-preset + summary-preview export flow) — **both are mounted in the same `Sales.tsx`** (`lazyRetry` imports at lines 53/55, rendered at 2774/3048) | Read both files; `ExportModal.tsx` implements daily/monthly/yearly/custom period export with a live summary preview — materially different from `ExportOptionsDialog`'s generic column-picker CSV export, not a byte-for-byte duplicate | MEDIUM | Not proven to be pure duplication — could be legitimate feature differentiation (quick CSV vs. period statement). Flagged because the same page exposes two "export sales" entry points to the user; worth a product decision, not a blind merge |
| DUP-2 | `frontend/src/components/shared/ExportChoiceDialog.tsx` (wraps `ExportOptionsDialog`, Dashboard-only) + `frontend/src/components/dashboard/dashboardExport.ts`/`exportReports.tsx`/`exportPackage.ts` | Read files; Dashboard's export produces a richer multi-sheet workbook with embedded chart images — genuinely different requirements from the generic CSV path | LOW — legitimate differentiation, not flagged as duplicate | Included only because the task named it as a candidate; evidence does not support merging |
| DUP-3 | Underlying export utilities (`utils/xlsxExport.ts`, `utils/exportOptions.ts`) ARE properly shared — used by `ExportOptionsDialog`, `Products.tsx`, `dashboardExport.ts`, `spreadsheetImport.ts`, `Sales.tsx`, `ReturnsReport.tsx` | Import-count check | — | Correctly shared; not a finding, stated to avoid overclaiming duplication across the whole export surface |
| DUP-4 | Fuzzy-search fallback: `cloudflare/src/lib/searchMatch.ts`'s own header (lines 25-53) correctly states `runFuzzyFallbackMatch` is called **only** by `portal.ts` (storefront) since products.ts/inventory.ts moved to FTS5 — but the SAME FILE, at lines 608-616 (next to the function's own definition), says "Every server-paginated search route (products.ts, inventory.ts, portal.ts) now calls this the same way" | `grep -n "runFuzzyFallbackMatch" cloudflare/src/routes/*.ts` → only `portal.ts` imports/calls it; `grep -n fuzzy cloudflare/src/routes/products.ts cloudflare/src/routes/inventory.ts` → no fuzzy-fallback call in either | HIGH — proven internally contradictory comment, and confirms a real behavior gap | Not just doc rot: product/inventory admin search genuinely lacks the typo-tolerant fallback the public storefront has, despite two separate comments (this one and `portal.ts:2121-2123`) both asserting parity | Fix the stale comment block at `searchMatch.ts:608-616`; separately decide (product call) whether products.ts/inventory.ts should regain a fuzzy fallback or the comment should just stop claiming they have one |
| DUP-5 | `cloudflare/src/lib/membershipNumber.ts`'s `isHouseMembershipNumber` vs `ops/scripts/migration/list-non-house-membership-numbers.mjs`'s hand-mirrored copy (see CF-D4) | See CF-D4 | HIGH | Real duplicate logic across a package boundary the task asked to cover (`ops/scripts/`) |

## 6. Legacy paths

| ID | Location | Evidence | Confidence | Notes |
|---|---|---|---|---|
| LEG-1 | `cloudflare/src/lib/searchMatch.ts:608-616` | See DUP-4 | HIGH | Stale comment, confirmed |
| LEG-2 | `cloudflare/src/routes/portal.ts:2121-2123` ("JS fuzzy ... see ... products.ts's/inventory.ts's identical block") | Same grep as DUP-4: no such block exists in either file | HIGH | Task's exact known lead, confirmed at line 2121 (task said "~2118"; the comment block starts 2121, three lines off) |
| LEG-3 | `frontend/src/api/reportsTransport.ts:11-14` `getBusinessSummary` | See CF-D1 | HIGH | Task's exact known lead, confirmed |
| LEG-4 | `frontend/src/components/shared/kit/KitGallery.tsx` | See FE-D2 | HIGH | Task's exact known lead, confirmed |
| LEG-5 | Generic `legacy`/`deprecated`/`obsolete` comment sweep | 258 hits / 83 files in `cloudflare/src`, 171 hits / 89 files in `frontend/src` | LOW — **not classified individually, volume too large for this budget** | Spot-reading shows most are legitimate: `LegacySubtotalRepair.tsx`, `legacySubtotalRepairTransport.ts`, `LegacyDeletedSalesSection.tsx` are actively-used features named "legacy" because they operate ON legacy/historical data, not because the code itself is deprecated. Do not bulk-delete anything matching `/legacy/i` without reading each hit — the word is a domain term here, not a deprecation marker in most cases. |
| LEG-6 | Stronger-signal sweep (`no longer used`, `dead code`, `unused function`, `can be removed`, `TODO.*remove`, `FIXME`) | 25 hits total across both packages (full list in `legacy-signals.txt`) | Mixed | Most are: (a) already-fixed historical bug narration kept as comments (e.g. `cloudflare/src/routes/compat.ts:54` documents a fixed Hono wildcard-matching bug, guards already corrected — not a current finding), (b) `window.confirm('Remove this...')` UI copy (false hits on the word "remove"), (c) genuine self-documented already-resolved dead code (`PublicCatalogPage.tsx:1381`, `Dashboard.tsx:1343`, `BulkImportModal.tsx:1242`, `ExportFieldsModal.tsx:111`, `zipReader.ts:15` all describe dead code that was **already removed** in a prior session, per their own past-tense wording) — no new action needed on any of the 25 |

## 7. Repo bloat

| ID | Location | Evidence | Confidence | Notes |
|---|---|---|---|---|
| BLOAT-1 | `frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/*.wasm` (3 files, ~26 MB total: `ScanbotSDK.Asm-simd.wasm` 8.99 MB, `ScanbotSDK.Asm-simd-threads.wasm` 8.94 MB, `ScanbotSDK.Asm.wasm` 8.39 MB) + `ScanbotSDK.ui2.min.js` (1.03 MB) | `git ls-files \| du -b` top-30; confirmed actively imported by `frontend/src/components/products/scanning/scanbotScanner.ts` and `BarcodeScannerModal.tsx` | HIGH usage confirmed — **not dead**, but is the single largest repo-size contributor by far (~27 MB of a 68.8 MB tracked tree) | Not a deletion candidate; flagged purely as a repo-size fact. Worth an owner conversation about serving this from R2/a CDN rather than the git tree, since it triples the checkout size for a vendor asset that never changes per-commit — but that is an infra decision, not cleanup |
| BLOAT-2 | `outputs/` (36 tracked files, 532 KB: `outputs/checkout-cleanup-20260919/*`, `outputs/device-tier-audit-20260919/*`, `outputs/takeover-20260909/sale-item-currency-deploy.log`) | `git ls-files outputs \| wc -l`; `du -sh outputs` | HIGH — genuinely historical working files, small in size | `docs/AI_COUNCIL_REVIEW.md`'s own "Laptop checkout cleanup" section explicitly treats this class of directory as protected evidence, not casual bloat — "GitHub contains committed/pushed material... not necessarily... unique commits" language applies. **Do not delete without the checklist in that doc** (exact resolved paths, unique-commit check, active-claim check) | Not actionable as a cleanup item without following that protocol |
| BLOAT-3 | `originaloutputs/` | `find . -maxdepth 1 -iname "originaloutputs*"` → no match | — | Task-mentioned directory does not exist in this checkout — reporting as "not found," not "clean," since it may exist in a different worktree/branch not checked here |
| BLOAT-4 | CHECKPOINT files | `git ls-files \| grep -i checkpoint` → only `docs/fleet/2026-09-20-checkpoint-release.md` and two Playwright spec files (`admin-range-checkpoint.spec.ts`, `shift-checkpoint.spec.ts`) named "checkpoint" as a domain term, not a generated-artifact pattern | LOW signal | No generated CHECKPOINT-style dump files found tracked in git |
| BLOAT-5 | `frontend/e2e-report/` | `git ls-files \| grep -c "^frontend/e2e-report/"` → 0 | — | Confirmed NOT tracked (already gitignored) — no action needed |
| BLOAT-6 | Large non-vendor tracked files: `docs/history/session-log.md` (1.43 MB), `progress.md` (1.36 MB), `frontend/icon logo images/*.png` (~2.4 MB combined), `frontend/src/lang/km.json` (833 KB), `cloudflare/src/routes/products.ts` (517 KB / one file) | `git ls-files \| du -b \| sort -rn` top 30 | — | `session-log.md`/`progress.md` are the project's explicitly-designated live ledgers (per CLAUDE.md) — large by design, not bloat. `products.ts` at 517 KB in one file is a maintainability smell (very large route module) but is a structure/refactor concern, not dead code, and out of scope for a deletion-candidate list |
| BLOAT-7 | Duplicate/superseded docs under `docs/fleet/` (51 files, 1.3 MB) | Not content-diffed against each other — out of budget | Not determined | Flagged as a coverage gap, not a finding: could not confirm or rule out duplicate audit docs without reading all 51 |

## Coverage and limitations (explicit)

- **Frontend module graph**: built by a custom static-import BFS (not Rollup/esbuild metafile —
  network-installed `ts-prune` worked, but a full Vite/Rollup build metafile was not generated
  in this pass to save time). The BFS does **not** follow `new Worker(new URL(...))` or
  build-script-only entries; both blind spots were found and manually resolved (FE-D11, FE-D12).
  No other blind spots were tested for (e.g., string-concatenated dynamic `import()` paths, if
  any exist, would not be caught either way).
- **`ts-prune` reliability**: two systemic false-positive classes identified and quantified
  (dynamic-import-behind-`any` in `methods.ts`/`web-api.ts`, and `React.lazy` default-export
  consumption). Neither package's raw ts-prune list should be trusted without the per-symbol grep
  demonstrated above. I did that grep for ~15% of flagged non-default exports; the rest are
  reported as "search miss," explicitly not "proven dead."
- **Cloudflare route-internals**: verified that all route files are mounted; did **not**
  exhaustively check every individual handler/branch/query-param inside each of the 27 route
  files for a frontend caller — that would require enumerating every `apiFetch` call site against
  every route method+path pair, which was out of budget. Durable Objects (`syncUploadSession.ts`)
  and `cloudflare/src/queue.ts` cron/dispatch code were grep-checked for the specific symbols in
  CF-D2/CF-D3 only, not audited wholesale.
- **i18n**: sample-checked ~90 of 990 orphan keys across 6 prefix families; the remaining ~890
  are unclassified (I18N-6). Did not check Telegram bot templates or email templates in
  `cloudflare/src` for key names beyond the specific I18N-5 note.
- **Legacy-comment sweep**: found and read the two specific known leads (searchMatch.ts,
  portal.ts) in full; the broader 429-hit `/legacy|deprecated|obsolete/i` sweep was bucketed but
  not read line-by-line — LEG-5 explicitly flags this as unclassified volume, not a clean bill of
  health.
- **Repo bloat**: `git ls-files | du` top 30 reviewed; did not walk `.git` pack/history size
  (e.g., large blobs since removed from HEAD but still in history) — that needs `git rev-list`
  + `git cat-file` object-size analysis, not attempted here.
- **Did not run**: `npm run test:utils`, `npm run build`, `cloudflare npx tsc --noEmit`, or any
  `cloudflare/scripts/test-*.cjs` — this was a read-only evidence sweep per the task; verification
  commands are listed per-finding as "needed," not executed.
