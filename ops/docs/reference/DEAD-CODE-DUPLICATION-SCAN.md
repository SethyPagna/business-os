# Dead Code And Duplication Scan

Last updated: 2026-05-19

Phase 29 source-deletion rule: no tracked source file is deleted until `rg`
proves no live import/script/doc dependency and focused tests, build, and
affected live checks pass.

## Current Result

Phase 29 cleanup has now removed generated/runtime bulk plus obsolete tracked
compatibility wrapper source after reference scans proved the wrappers were no
longer active entrypoints. The latest organization audit reports zero remaining
compatibility wrappers.

The latest optimization passes also reduced duplicate documentation scan logic:
`generate-full-project-docs.js` and `generate-doc-reference.js` now use the
shared filesystem helper library for source traversal, path normalization,
reads, JSON parsing, line counts where needed, root file collection, and text
detection where needed.

The Phase 8.4 Playwright live-check files also now share
`ops/scripts/runtime/live-checks/live-check-utils.ts` for guarded JSON reads,
removing the repeated timeout/fetch/parse helper from the route-specific action
checks while keeping each check's assertions and button flows local.

The public Cloudflare portal check was hardened at the same time: it now
records/asserts the actual document CSP headers, so browser report-only CSP
console chatter can be ignored without weakening the security signal.

Move 152 has retired the old product import worker wrapper after the modal moved
to the typed worker URL. `BulkImportModal.tsx` now constructs the Vite module
worker from `productImportWorker.ts`, so the executable worker body and the
runtime entrypoint are the same typed file.

Move 153 keeps `frontend/src/components/receipt-settings/constants.js`
intentionally alive as a compatibility wrapper for receipt settings imports
and focused receipt tests. The executable constants now live in
`constants.ts`.

Move 154 keeps `frontend/src/components/contacts/customerMembershipNumber.js`
intentionally alive as a compatibility wrapper for contacts imports and tests.
The executable membership generator now lives in
`customerMembershipNumber.ts`.

Move 155 keeps `frontend/src/components/dashboard/charts/index.js`
intentionally alive as a compatibility wrapper for dashboard chart imports and
report-rendering imports. The executable chart barrel now lives in
`index.ts`.

Move 156 keeps `frontend/src/components/receipt-settings/template.js`
intentionally alive as a compatibility wrapper for receipt settings imports and
focused receipt tests. The executable receipt-template helper now lives in
`template.ts`.

Move 157 keeps `frontend/src/components/shared/navigationConfig.js`
intentionally alive as a compatibility wrapper for sidebar and settings imports
plus focused navigation tests. The executable navigation configuration now
lives in `navigationConfig.ts`.

Move 158 keeps `frontend/src/components/utils-settings/index.js` intentionally
alive as the folder-level compatibility wrapper for admin utility component
imports. The executable barrel now lives in `index.ts`.

Move 159 keeps `frontend/src/components/utils-settings/settingsConflict.js`
intentionally alive as the Settings page compatibility wrapper. The executable
stale-write conflict helper now lives in `settingsConflict.ts`.

Move 160 keeps `frontend/src/platform/storage/storagePolicy.mjs` intentionally
alive as the API/storage-policy compatibility wrapper. The executable live
mirror and cooldown policy now lives in `storagePolicy.ts`.

Move 161 keeps `frontend/src/components/contacts/contactImportWorker.mjs`
intentionally alive as the Vite worker wrapper. The contact-specific fallback
parser shim has been retired; the executable row-count worker lives in
`contactImportWorker.ts`, and the shared fallback parser lives in
`csvRowCounter.ts`.

Move 162 keeps `frontend/src/components/inventory/inventoryImportWorker.mjs`
intentionally alive as the Vite worker wrapper. The shared row-counter wrapper
has been retired after inventory, sales, contact, and focused tests moved to
`csvRowCounter.ts`.

Move 163 confirms the product import worker cluster is not dead code:
`BulkImportModal.tsx` constructs the Vite worker from `productImportWorker.ts`,
and `productImportPlanner.ts` remains the fallback parser used for Worker
startup, postMessage, timeout, and worker-error recovery.

Move 164 keeps `frontend/src/components/sales/salesImportWorker.mjs`
intentionally alive as the Vite module-worker wrapper. The executable sales
row-count worker lives in `salesImportWorker.ts`, while the shared fallback
parser remains `csvRowCounter.ts`.

Move 165 keeps `frontend/src/components/shared/BackgroundImportTracker.tsx` in
the React UI path and records it as a rejected Web Worker candidate. The file
is not dead code and is not duplicate parsing logic; it owns bounded import-job
polling, completion refresh dispatch, and tracker action state.

Move 166 makes `frontend/src/utils/csvExportWorker.mjs` intentionally live as
the Vite wrapper for `csvExportWorker.ts`. The synchronous `buildZip()` path in
`csv.js` remains intentional fallback code for unsupported Worker/runtime error
cases and should not be removed as duplicate ZIP logic.

Move 167 records `frontend/src/utils/csvImport.ts` as intentional shared CSV
parser/fallback code, not duplicate worker work. Product import analysis uses
the parser inside `productImportWorker.ts`, contact/inventory/sales row counts
use focused row-counter workers, and the `.js` wrapper remains the stable
compatibility boundary for tests and legacy imports. `backupPackages.js` also
keeps its fallback `LIMIT/OFFSET` query intentionally so non-`id` tables can
still stream safely while `id` tables use the faster keyset path.

Move 168 records the product import caches in `backend/src/services/importJobs.js`
as intentional data-path state, not redundant maps. `productRowsByName` avoids
repeating the same product-name query for every row in a same-name import
family, `supplierMap` avoids repeated supplier existence checks, and
`rememberProductForImport()` keeps those caches aligned with products created
or updated during the job. The barcode image scanner files remain live browser
scanner code and should not be treated as dead Worker candidates.

Move 169 records `ImageGalleryLightbox.tsx` and `importJobRefresh.js` as live
UI/event helpers rather than Worker or deletion candidates. The lightbox is
shared by Products, POS, and Catalog image views; the import refresh helper is
the small channel mapper used by the background import tracker to dispatch
refresh events after completed jobs.

The same live-check helper now centralizes repeated console filtering,
observed-response status lookup, guarded read waits, and top-modal closing.
This leaves the individual action checks focused on route behavior instead of
copying the same Playwright plumbing.

Move 81 also centralized local console/page-error event attachment through
`attachConsoleCollector`; the public Cloudflare portal check remains separate
because it intentionally records all console messages for CSP diagnostics.

The generated-artifact cleanup workflow now also covers transient Playwright CLI
snapshots, root `output`, and the local `run/cv-render-check-word` render input
folder. These were deleted as generated local artifacts and added to ignore /
Docker-ignore rules so they do not re-enter source inventories or release build
contexts.

Storage retention now owns the safe Docker cleanup path as well. Instead of
manual Docker cleanup instructions drifting from automation, `prune-storage`
accepts `--docker-safe-prune` and full automation gates it through policy. This
keeps the workflow centralized while preserving the data-loss boundary: no
volume prune, image prune, or full system prune command is present.

The Docker release verifier now checks those same boundaries, so cleanup and
release work share one guardrail: generated folders stay out of build context,
the local render artifact stays ignored, and future retention changes fail if
they add volume, image, or full-system Docker prune commands.

Generated/runtime bulk measurement now has a dedicated architecture audit
instead of living only in prose. The audit labels bulky folders as protected,
retention-managed, reinstallable, regenerable, or safe cleanup, which keeps
future deletion decisions separate from source dead-code decisions.
Full automation now executes that audit in the normal test gate, making the
cleanup inventory repeatable without merging it into source dead-code scans.
The audit now writes a JSON summary and enforces a policy cap on
non-protected cleanup candidates, which gives future source-cleanup work a
machine-readable bulk signal without treating business data as dead code.
It also verifies `clean-generated.ps1` coverage for each non-protected bulk
target, so generated-artifact cleanup remains separate from tracked source
deletion and can be previewed before use.
The Phase 29 one-command audit bundles generated-bulk, organization, schema,
and Docker release guardrail checks, giving dead-code and cleanup work a quick
repeat pass before any tracked source deletion or folder move.
Full automation now uses that combined audit instead of direct one-off
generated-bulk and Docker release verifier calls, reducing workflow drift while
adding schema and organization checks to the regular gate.
The audit also writes a JSON summary, so future dead-code or cleanup tooling can
read pass/fail state and report paths without scraping the Markdown report.
The repeat script runs the same audit for three cycles, giving risky cleanup,
folder, schema, and language-conversion candidates a repeatable preflight.
It now compares structured fields between cycles, so repeat passes catch
generated-bulk or organization drift instead of only checking whether each
command exits successfully.
Move 94 adds the performance/code-flow scan to that repeat loop. The scan now
writes a JSON baseline for source counts, built asset counts, largest source
and chunk markers, plus oversized source/chunk candidate lists. The repeat gate
compares those fields across cycles, which gives dead-code, loop/function,
large-module, and language-conversion candidates a stable source-size baseline
before any tracked source deletion or risky rewrite.
Move 95 adds the same structured repeat baseline for schema work. The schema
audit now writes a JSON summary, and Phase 29 repeat runs compare static table
names/counts, runtime DDL counts, Dexie store coverage, relationship coverage,
and backup-gap fields. That keeps dead-code or route cleanup from accidentally
changing schema coverage signals without being noticed.
Move 96 does the same for Docker release cleanup guardrails. The Docker verifier
now writes a JSON summary, and Phase 29 repeat runs compare release file
coverage, wrapper counts, retired artifact absence, ignore coverage, safe-prune
coverage, unsafe-prune absence, and cleanup policy state before release or
cleanup rewires proceed.
Move 97 persists the organization audit as JSON too. Future dead-code or folder
cleanup decisions can read large-file paths, largest areas, wrapper lists, and
wrapper removal candidates from `ops/docs/reference/ORGANIZATION-AUDIT.json`
instead of scraping the Markdown report.
Move 98 promotes those organization details into the repeat gate. Phase 29 now
compares scan roots, root files, large-file threshold, largest-area rows,
large-file paths, wrapper files, broken wrapper files, and removable wrapper
files across cycles, so dead-code and folder cleanup evidence cannot silently
drift during a repeated sweep.
Move 99 adds ranked performance rows to the same repeat check. The performance
JSON now includes top source files by size, top source files by line count, and
top built chunks, and Phase 29 compares those rows across cycles before
large-module or chunk cleanup work proceeds.

Move 100 keeps the Markdown repeat report compact by summarizing long arrays
with counts, SHA-256 digests, and previews. Dead-code and duplication evidence
still remains exact in `ops/docs/reference/PHASE29-AUDIT.json`, but the human
report no longer grows sharply when file lists or ranked candidates are added.

Move 101 keeps repeated sweep terminal output compact as well. Phase 29 now
prints concise child-check status lines by default and reserves full child
stdout/stderr streaming for `--verbose`, so dead-code and optimization sweeps
stay easier to read while still writing complete generated evidence.

Move 102 makes the generated-bulk portion of the sweep work smarter by
measuring independent targets in parallel and recording that mode in JSON. The
dead-code and cleanup loop keeps the same evidence, but it no longer has to
walk every generated/runtime/data target strictly one after another.

Move 103 adds ranked generated-bulk target rows for the same reason the
performance scan keeps ranked source rows. Cleanup and duplication work can now
see the biggest protected targets and cleanup candidates directly in JSON, and
Phase 29 repeat catches drift in those rankings.

Move 104 adds duration profiling to the repeated sweep. `PHASE29-AUDIT.json`
now includes total child-check time, per-check totals/averages/max values, and
ranked slowest runs so optimization work can focus on real bottlenecks instead
of broad rewrites.

Move 105 applies that profiling insight to the second-costliest sweep: the
organization audit now reads files through a bounded parallel queue while
preserving deterministic ordering. This keeps folder/dead-code evidence faster
without changing which source files are scanned.

Move 106 adds per-target timings to generated-bulk evidence. The audit now
records `measureMs` and `slowestTargetMeasurements`, giving future cleanup and
dead-code work a better view of which generated/runtime/data folders are most
expensive to measure.

Move 107 reduces that measurement cost without weakening the evidence:
generated-bulk now stats files with bounded per-directory parallelism, keeping
exact byte totals while making large dependency-folder scans less sequential.

Move 108 adds overlap evidence to the generated-bulk scan. Nested targets are
reported separately from raw totals, making cleanup and duplication analysis
less likely to overestimate storage impact when a protected child folder is
also included inside a protected parent folder.

Move 109 turns the language/runtime policy into an executable audit. The new
report separates measurable TypeScript, Web Worker, and SQL/DuckDB candidates
from rejected Rust/Go/Python/WASM runtime families, so future dead-code and
rewire work can justify conversions with stable evidence instead of adding
runtime complexity just to reduce file count.

Move 110 adds conversion proof requirements to that same audit. Future
dead-code, duplicate-helper, or runtime-split work now has to pass the
track-specific proof matrix and keep a rollback path, which prevents cleanup
from turning into unmeasured language churn.

Move 111 checks that those proof commands are still real. Package-script and
local-script proof rows are resolved by the audit, and stale command gates fail
Phase 29 before source cleanup or language conversion starts.

Move 112 ties first conversion candidates to focused tests. The audit now fails
when a first-slice candidate or its focused test files disappear, which keeps
dead-code cleanup from removing the exact tests needed for safe rewires.

Move 113 converts the CSV import helper without deleting the old import path.
The `.js` file is now an intentional thin compatibility wrapper over the
TypeScript implementation, and the language audit ignores that wrapper as a
future conversion candidate while still checking it exists.

Move 114 converts the shared formatter helper the same way. The wrapper is
intentional compatibility, not removable duplicate code, until reference scans
show every legacy import has moved.

Move 115 converts the grouped-record helper to TypeScript and removes its
duplicated unused Khmer initial-order constants. `groupedRecords.ts` remains
an intentional compatibility wrapper until component and test imports are
migrated deliberately.

Move 116 converts the initials helper to TypeScript while preserving
`initials.ts` as an intentional compatibility wrapper. `retired initials declaration shim` is
live declaration support for converted TypeScript callers, not dead generated
noise.

Move 117 converts the media upload helper to TypeScript while preserving
`mediaUpload.js` as an intentional compatibility wrapper. The newly wired
`mediaUploadHelpers.test.ts` prevents cache-busting and reducer behavior from
being treated as untested duplicate utility code.

Move 118 converts the pricing helper to TypeScript while preserving
`pricing.js` as an intentional compatibility wrapper. `pricing.d.ts` remains
live declaration support for TypeScript modules that import the stable wrapper.

Move 119 converts the product grouping helper to TypeScript while preserving
`productGrouping.ts` as an intentional compatibility wrapper. The conversion
also removes unused Khmer-order constants from that module because initials and
Khmer sorting are now owned by the shared `initials` helper.

Move 120 converts the product display helper to TypeScript while preserving
`productDisplayHelpers.mjs` as an intentional compatibility wrapper. The
conversion keeps display-state construction centralized and makes future
duplicate row-status helpers easier to catch through typecheck.

Move 121 converts the product filter/export helper to TypeScript while
preserving `productFilterHelpers.mjs` as an intentional compatibility wrapper.
The typed implementation keeps product filtering and export-row formatting in
one checked helper, reducing the risk of duplicate filter predicates drifting
between Products and tests.

Move 122 converts the product menu helper to TypeScript while preserving
`productMenuHelpers.mjs` as an intentional compatibility wrapper. The typed
implementation keeps filter-section and export-menu construction in one checked
module and avoids duplicating menu toggle logic in Products.

Move 123 converts the product write helper to TypeScript while preserving
`productWriteHelpers.mjs` as an intentional compatibility wrapper. The typed
implementation keeps product write, restore, branch adjustment, transfer, and
bulk update payload logic in one checked module, making duplicated stock/write
payload construction easier to catch before it reaches Products.

Move 124 converts the product import planner to TypeScript and retires the old
compatibility wrapper. The typed implementation keeps CSV normalization,
identifier conflict decisions, same-name grouping, and blocking import issue
handling in one checked module, making duplicate import-analysis branches easier
to catch before they drift.

Move 125 converts the action guard utility to TypeScript while preserving
`actionGuards.mjs` as an intentional compatibility wrapper. The typed
implementation keeps single, named, and keyed action guard behavior in one
checked module, reducing the risk of duplicate same-tick guard helpers
spreading across forms and page actions.

Move 126 converts the color contrast utility to TypeScript while preserving
`color.js` as an intentional compatibility wrapper. The typed implementation
keeps hex normalization and contrast calculation in one checked module, making
future duplicated chip text-color helpers easier to spot.

Move 127 converts the dashboard date helper to TypeScript while preserving
`dateHelpers.js` as an intentional compatibility wrapper. This removes another
wrapper-only implementation candidate from the active utility backlog and adds
focused date offset coverage.

Move 128 converts the client device metadata helper to TypeScript while
preserving `deviceInfo.js` as an intentional compatibility wrapper. Browser/OS
name detection and client header construction now live in one checked module,
reducing the chance of duplicate device metadata helpers across API flows.

Move 129 converts the report export package helper to TypeScript while
preserving `exportPackage.js` as an intentional compatibility wrapper. Report
manifest rows and package-file assembly now have a typed boundary, making
future duplicate export packaging helpers easier to spot.

Move 130 converts the shared history snapshot helper to TypeScript while
preserving `historyHelpers.mjs` as an intentional compatibility wrapper.
Snapshot cloning, result-id extraction, and created-snapshot resolution now
have one checked boundary for undo/redo workflows.

Move 131 converts the shared utility barrel to TypeScript while preserving
`index.js` as an intentional compatibility wrapper. Re-export ownership for
formatters, CSV downloads, and local date helpers is now tracked by typecheck.

Move 132 converts the permission parser utility to TypeScript while preserving
`permissions.js` as an intentional compatibility wrapper. Permission payload
normalization now has one typed object-shape guard instead of relying on
callers to handle string, null, and array edge cases.

Move 133 converts the product batch preview utility to TypeScript while
preserving `productBatches.mjs` as an intentional compatibility wrapper. Batch
visibility and preview count logic now lives behind one typed helper shared by
Inventory and Products instead of being duplicated in card/detail surfaces.

Move 134 converts the script typography helper to TypeScript while preserving
`scriptTypography.js` as an intentional compatibility wrapper. Khmer script
detection, `khmer-text` class merging, and `lang="km"` prop generation now have
one typed helper shared by Catalog, POS, Products, and Inventory.

Move 135 converts the settings refresh routing helper to TypeScript while
preserving `settingsRefresh.js` as an intentional compatibility wrapper.
Settings-to-refresh-channel routing now has one typed rule table, with
`appRefresh.d.ts` documenting the normalization boundary shared with
`appRefresh.js`.

Move 136 converts the product page config constants to TypeScript while
preserving `productPageConfig.mjs` as an intentional compatibility wrapper.
Product page timeout constants and month options now live in one typed config,
with source-inspection tests reading the implementation instead of the wrapper.

Move 137 converts the product gallery helper to TypeScript while preserving
`productGalleryHelpers.ts` as an intentional compatibility wrapper. Gallery
normalization, thumbnail state, public URL resolution, and lightbox clamping now
live in one typed helper used by Products and product write payload builders.

Move 138 converts the product group view helper to TypeScript while preserving
`productGroupViewHelpers.mjs` as an intentional compatibility wrapper. Product
group price-label and summary-parts rendering now live in one typed helper
instead of leaking formatter/translator assumptions into the Products surface.

Move 139 converts the product selection and pagination helper to TypeScript
while preserving `productSelectionHelpers.mjs` as an intentional compatibility
wrapper. Selection id coercion, pagination summary construction, selected-row
filtering, parent-id sets, product-id maps, and letter jump targets now live in
one typed helper used by Products and focused tests.

Move 140 converts the product history helper to TypeScript while preserving
`productHistoryHelpers.mjs` as an intentional compatibility wrapper.
Deleted-product restore ordering and request-id generation now live in one
typed helper used by Products and focused history tests.

Move 141 converts the barcode image scanner helper to TypeScript and no
`.mjs` scanner compatibility wrapper remains.
Native barcode detection, zxing fallback loading, image loading, and scanner
test doubles now share one typed helper boundary.

Move 142 converts the barcode scanner presentation-state helper to TypeScript
and no `.mjs` scanner compatibility wrapper remains. Camera permission/status
branching and scanner state-kind outputs now
share one typed helper boundary.

Move 143 converts the concurrent bulk task helper to TypeScript while
preserving `bulkOps.mjs` as an intentional compatibility wrapper. Shared
product, inventory, branch, contact, and sales bulk-action flows now use one
typed concurrency/result contract.

Move 144 converts the app shell helper to TypeScript and now retires the
temporary app-shell `.mjs` compatibility wrapper. Route classification,
mounted-page limits, warmup gating, and notification metadata stay centralized
in the TypeScript source instead of duplicating shell logic across startup and
React entrypoints.

Move 145 converts the portal catalog display helper to TypeScript while
preserving `portalCatalogDisplay.mjs` as an intentional compatibility wrapper.
Customer portal grid classes, branch matching, promotion display, price
presentation, and badge ranking stay centralized instead of duplicating display
rules across catalog surfaces.

Move 146 converts the portal content i18n helper to TypeScript while
preserving `portalContentI18n.mjs` as an intentional compatibility wrapper.
Translation normalization, config/product localization, FAQ fallback, and
protected public-copy terms stay centralized instead of duplicating portal
language behavior across editor and public surfaces.

Move 147 converts the portal editor utility helper to TypeScript while
preserving `portalEditorUtils.mjs` as an intentional compatibility wrapper.
About-block normalization, promotion-item normalization, list reordering, and
Google Maps embed URL normalization stay centralized instead of duplicating
editor sanitation behavior inside `CatalogPage.tsx`.

Move 148 converts the portal language pack helper to TypeScript while
preserving `portalLanguagePacks.ts` as an intentional compatibility wrapper.
First-party language options, normalization, membership checks, and translated
text lookup stay centralized instead of duplicating public portal language
behavior across `CatalogPage.tsx` and portal i18n helpers.

Move 149 converts the contact option helper to TypeScript while preserving
`contactOptionUtils.js` as an intentional compatibility wrapper. Contact
option creation, stored JSON parsing, import-row parsing, summaries, and
primary option selection stay centralized instead of duplicating customer,
supplier, and delivery contact cleanup logic.

Move 150 converts the inventory movement group helper to TypeScript while
preserving `movementGroups.js` as an intentional compatibility wrapper.
Timestamp normalization, movement grouping, transfer display totals,
pagination, and search haystacks stay centralized instead of duplicating
movement aggregation logic inside `Inventory.tsx`.

Move 151 converts the POS core helper to TypeScript while preserving
`posCore.mjs` as an intentional compatibility wrapper. Product grouping,
variant choice lookup, cart pricing, cart line identity, and branch-aware line
matching stay centralized instead of duplicating checkout logic inside
`POS.tsx`.

## Candidate Areas

| Area | Reason to inspect | Required proof before deletion or merge |
| --- | --- | --- |
| `ops/scripts/runtime` | Many audit/check scripts with overlapping setup/report behavior. | Shared helper extraction or folder move plus `rg` old-path scan and live-check pass. |
| `ops/scripts/powershell` | Runtime/release orchestration overlaps in setup/start/release flows. | Preserve `run` wrappers; verify `run\verify-local.bat` and Docker doctor paths. |
| `frontend/src/components/inventory/Inventory.tsx` | Large component and likely repeated transforms. | Helper extraction tests and Inventory Playwright checks. |
| `backend/src/services/importJobs.js` | Large import pipeline with queue, CSV, image, and policy branches. | Import tests plus live import smoke. |
| `frontend/src/components/catalog/CatalogPage.tsx` | Large mixed admin/public/editor surface. | Catalog helper tests plus public portal check. |
| `frontend/src/api/methods.js` | Large API method registry. | API contract/source tests and app bootstrap check. |
| `backend/src/routes/products.js` and `backend/src/routes/inventory.js` | Query-heavy route files. | Route contract tests, schema audit, product/inventory live checks. |

## Duplicate Pattern Watchlist

- repeated timeout/guard wrappers that can be centralized without hiding labels;
- repeated product/branch/inventory map construction loops;
- route SQL that repeats filtering/sorting fragments;
- Move 171 keeps import-job permission filtering in one service query path
  instead of doing a second route-level discard pass after decoration.
- import-job status/progress normalization duplicated across UI and backend;
- generated reference scripts that scan similar file sets but emit different
  reports. The first helper consolidation moved common filesystem traversal and
  read behavior into `ops/scripts/lib/fs-utils.js`, and the function-reference
  generator now uses the same helper library. Move 170 also removed a repeated
  per-table whole-schema primary-key fallback scan from the schema-audit
  generator by precomputing ALTER TABLE primary-key constraints once.
- Move 172 removed repeated one-off `requireText`/`forbidText` calls from the
  backup reliability verifier by grouping guard strings under a source manifest.
- Move 173 prevents the canonical schema dump from repeating as a generic
  language/runtime candidate; DDL optimization is tracked by the schema
  migration backlog instead.
- Move 174 removes repeated RFID stock-apply statement setup from the
  confirmed-product loop in `backend/src/routes/inventory.js`; the loop now
  reuses request-scoped prepared statements for branch/product/stock/movement
  and session updates.
- Move 175 removes duplicate portal catalog product payload assembly from
  `backend/src/routes/portal.js`; full catalog and paged search now share the
  same asset materialization and payload decoration helpers.
- Move 176 removes the repeated active-product scan from image-only bulk import
  in `backend/src/routes/products.js`; uploaded filenames now match through one
  prebuilt normalized-name map.
- Move 177 removes repeated sale creation movement statement setup from
  `backend/src/routes/sales.js`; sold item allocations now reuse the same
  request-scoped movement insert and timestamp-update statements.
- Move 178 removes repeated settings delete statement setup from
  `backend/src/routes/system/index.js`; null-valued settings now use the same
  prepared delete statement inside `writeSystemSettings()`.
- Move 179 removes a duplicate audit pathway from the language/runtime queue:
  `ops/scripts/architecture/language-runtime-audit.mjs` no longer appears as a
  SQL/DuckDB candidate simply because it stores the report labels and completed
  optimization metadata used to generate Phase 29 references.
- Phase 8.4 live-check scripts share JSON reads, console filtering, response
  status waits, modal-close helpers, and local console collector wiring; next
  runtime-check cleanup candidates are repeated response observer and
  report-writing shapes.

## Language Candidates

- TypeScript: pure frontend helpers with existing tests.
- SQL/DuckDB: heavy import validation, report generation, and backup integrity
  comparisons.
- Web Workers: browser CSV parsing, scanner/image preprocessing, and expensive
  local transforms.
- PowerShell: keep Windows runtime orchestration.
- Rust/Go/Python/WASM: no current candidate is approved; require benchmark and
  release packaging proof first.
- Docker/runtime: keep shell and PowerShell orchestration for Windows operator
  flows; prefer Docker build-cache/container pruning over image or volume pruning
  so release images and data volumes stay intact.
