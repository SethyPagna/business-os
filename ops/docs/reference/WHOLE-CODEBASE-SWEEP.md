# Whole-Codebase Sweep

Last updated: 2026-05-20

Current plan position: Phase 8.4 active; Phase 26 at fifty-one completed
organization/hardening moves; Phase 28 active; Phase 29 complete as of Move
207.

## Sweep Scope

Phase 29 coordinated repeated scans across:

- tracked source: `backend`, `frontend`, `ops`, `run`, root launch/config files;
- runtime and deployment surfaces: Docker compose files, PowerShell launchers,
  Cloudflare Tunnel/R2 scripts, release packaging, and run wrappers;
- data surfaces: Postgres schema, runtime DDL, backup schema, Dexie stores,
  Redis queues/cache, object-storage references, custom tables, and JSON/text
  payloads;
- code-flow surfaces: nested loops, repeated transforms, broad refreshes,
  API waterfalls, helper duplication, old wrappers, and oversized modules.

Generated/runtime bulk is measured but excluded from source parsing:
`node_modules`, `frontend/dist`, `ops/runtime`, `business-os-data`, generated
`release` kits, Playwright artifacts, logs, and generated reports.

Latest generated/runtime measurements from the 2026-05-20 generated-bulk
audit:

| Area | Size |
| --- | ---: |
| `business-os-data` | 203.82 MB |
| `frontend/node_modules` | 149.01 MB |
| `backend/node_modules` | 114.98 MB |
| `ops/runtime` | 40.75 MB |
| `frontend/dist` | 30.15 MB |
| root `node_modules` | 3.30 MB |
| `ops/.playwright-cli` | removed |
| `run/cv-render-check-word` | removed |

These numbers now come from
`ops/scripts/architecture/generated-bulk-audit.mjs`, which writes
`ops/docs/reference/GENERATED-BULK-AUDIT.md` and keeps generated/runtime bulk
measurement separate from source parsing.
Full automation runs the same audit during the test gate, so regular
check/test/release flows refresh the measurement and fail on ignore-coverage
drift before Docker release verification.
The audit also writes a JSON summary and honors
`cleanup.generatedBulkCandidateMaxBytes` from the automation policy. The
threshold applies only to non-protected cleanup candidates, keeping source and
generated-artifact pressure visible without blocking real business-data growth.
The same audit verifies cleanup-script coverage for every non-protected target,
and `clean-generated:preview` provides a no-delete rehearsal path for the
manual cleanup script.
`npm --prefix ops run phase29:audit` now runs generated-bulk, organization,
schema, and Docker release guardrail checks in one non-mutating loop and writes
`ops/docs/reference/PHASE29-AUDIT.md`.
Full automation uses that combined audit in its test gate, replacing separate
generated-bulk and Docker guardrail calls while adding organization and schema
coverage to the regular workflow.
The combined audit now also writes `ops/docs/reference/PHASE29-AUDIT.json` for
automation-friendly status, duration, command, and report-output tracking.
`npm --prefix ops run phase29:audit:repeat` runs the same non-mutating audit
for three cycles, satisfying the repeat-sweep protocol before deeper rewires.
The repeat loop now compares structured generated-bulk and organization fields
across cycles and fails if those fields drift between passes.

Docker read-only audit after cleanup:

| Docker area | Result |
| --- | --- |
| Images | 7 images, 5.65 GB total; current `business-os` release tags preserved. |
| Containers | 7 active containers; one stopped container removed. |
| Volumes | 8 local volumes, 6.28 GB total; preserved to avoid data loss. |
| Builder cache | Safe prune freed about 105 MB; remaining cache is not treated as source. |

Storage cleanup implementation now covers Docker-safe pruning as an optional
lane. The policy-backed automation clears only stopped containers and builder
cache; release images and data volumes remain outside automated prune scope.
Docker release verification now checks those boundaries directly, including
generated/runtime `.dockerignore` exclusions, the local generated-render
`.gitignore` rule, the policy-backed `--docker-safe-prune` wiring, and the
absence of Docker volume/image/full-system prune commands.
Generated-bulk auditing now checks ignore coverage for the same folders and
labels each target with preserve, retention, reinstallable, regenerable, or
safe-cleanup status.

## Tracked File Inventory

Current tracked file count: 476.

| Area | Tracked files | Notes |
| --- | ---: | --- |
| `frontend` | 253 | Largest source area; includes React app, tests, language packs, public scanner SDK assets. |
| `backend` | 135 | Express routes, services, schema, workers, tests. |
| `ops` | 62 | Automation, Docker, docs, policy, verification scripts. |
| `run` | 21 | Stable operator/support wrappers; keep paths stable. |
| root files | 5 | README, launcher, ignore/config files. |

Largest tracked source/hotspot areas by file count:

| Area | Files | Phase 29 action |
| --- | ---: | --- |
| `frontend/tests` | 53 | Keep; use to protect UI/helper rewires. |
| `backend/test` | 44 | Keep; use before backend/schema cleanup. |
| `backend/src` | 39 | Candidate for domain grouping only after route tests. |
| `frontend/src/utils` | 29 | Candidate for TypeScript helper conversion. |
| `backend/src/routes` | 23 | Candidate for service extraction and SQL/query inventory. |
| `frontend/src/components/products` | 20 | Already under Phase 26 split; continue one cluster at a time. |
| `ops/scripts/runtime` | 12 | Candidate for runtime subfolder consolidation. |

## First Findings

- `ops` source is not actually the size problem; ignored runtime/generated
  folders were. After cleanup, `ops` is about 60 MB, with tracked scripts/docs
  under 2 MB.
- The public `run` wrappers are intentionally stable and should not be merged
  away; they are the operator interface.
- `frontend/public/scanbot-web-sdk` is large but tracked and required by scanner
  flows. Do not delete unless scanner replacement is implemented and verified.
- The largest maintainable source modules remain `Inventory.tsx`,
  `importJobs.ts`, `CatalogPage.tsx`, `Dashboard.tsx`, `Products.tsx`,
  `products.ts`, `POS.tsx`, and `inventory.ts`.

## Repeat Loop

Run this sweep at least three times before deep rewires:

1. Inventory tracked source and generated bulk.
2. Update schema and relationship findings.
3. Check code-flow and loop hotspots.
4. Check dead-code and duplicate candidates.
5. Check folder/language candidates.
6. Update docs and generated references.
7. Re-run reference/path checks to catch contradictions.

Move 94 folds the performance/code-flow scan into the executable Phase 29
repeat audit. The scan now emits `ops/docs/reference/PERFORMANCE-SCAN.json`,
and `phase29:audit:repeat` compares source counts, total source bytes/lines,
largest source/chunk markers, and oversized source/chunk candidate lists across
cycles. That makes loop/function and large-module refactors measurable before
source moves, language conversions, or deletion work starts.

Move 95 gives the schema sweep the same machine-readable repeat check. The
schema audit now emits `ops/docs/reference/SCHEMA-AUDIT.json`, and
`phase29:audit:repeat` compares static table counts/names, runtime DDL
counts/names, latest Dexie store coverage, backup gap counts, relationship doc
gap counts, and schema entity lists across cycles. Schema rewires now have a
stable drift gate before migrations, relationship edits, or data-layer cleanup.

Move 96 gives the Docker release guardrail the same structured repeat check.
The verifier now emits `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`, and
`phase29:audit:repeat` compares required release files, wrappers, retired
artifact presence, ignore coverage, Docker safe-prune coverage, unsafe-prune
token absence, and automation policy state across cycles. Release and cleanup
rewires now have a deterministic guardrail baseline.

Move 97 persists the organization audit baseline as
`ops/docs/reference/ORGANIZATION-AUDIT.json`. The JSON records scanned file
counts, large-file counts, compatibility-wrapper counts, scan roots/files,
largest areas, large-file paths, and wrapper lists. Folder rewires now have a
durable machine-readable inventory artifact beside the Markdown report.

Move 98 extends the repeat gate to compare the full organization baseline:
scan roots, root files, large-file threshold, largest-area rows, large-file
paths, wrapper files, broken wrapper files, and removable wrapper files. Folder
cleanup and rewire decisions now fail fast if inventory evidence changes during
the three-pass sweep.

Move 99 persists ranked performance rows in `PERFORMANCE-SCAN.json`.
`phase29:audit:repeat` now compares `topSourceBySize`, `topSourceByLines`, and
`topBuiltChunks` across cycles, so large-module and chunk optimization
candidates are protected by the same drift gate as counts and oversized lists.

Move 100 keeps the same full drift evidence in `PHASE29-AUDIT.json` but
compresses long Markdown repeat values into item/key counts, SHA-256 digests,
and previews. The repeated sweep therefore stays readable and cheaper to review
while still preserving exact values for automation and forensic checks.

Move 101 makes the repeated sweep console concise too. Phase 29 now captures
child output for parsing but prints only pass/fail, duration, and report paths
unless `--verbose` is passed. This reduces noisy repeat-loop output without
removing the full generated JSON and Markdown evidence.

Move 102 parallelizes generated-bulk target measurement. Independent
generated/runtime/data targets are now walked with `Promise.all`, and the JSON
summary records `measurementMode: parallel-targets` plus
`measuredTargetsInParallel: true`. Phase 29 repeat compares those fields so the
faster measurement path stays part of the audit contract.

Move 103 persists ranked generated-bulk target rows. The audit now records
`largestProtectedTargets` and `largestCleanupTargets`, and Phase 29 repeat
compares those rows so cleanup planning can focus on the biggest safe
candidates while still watching protected data and runtime growth.

Move 104 adds duration profiling to Phase 29. The audit now writes a
`durationSummary` with total child-check time, per-check totals/averages/max
values, and ranked `slowestRuns`, and the Markdown report shows those tables.
Duration is kept as optimization evidence rather than drift-stable evidence
because local machine load can vary naturally.

Move 105 makes organization-audit source reads bounded-parallel. The scan root
walks now run in parallel and file reads use a deterministic concurrency cap of
24, with `fileReadMode` and `fileReadConcurrency` recorded in JSON and checked
by Phase 29 repeat.

Move 106 adds per-target timing to generated-bulk measurement. Every target
record now includes `measureMs`, and the summary includes
`slowestTargetMeasurements`, so future cleanup/resource work can target the
folders that actually cost the most to measure without treating variable disk
timing as a repeat-drift failure.

Move 107 speeds up the exact generated-bulk byte count itself by using bounded
per-directory file-stat parallelism. The audit records `fileStatMode:
bounded-per-directory` and `fileStatConcurrency: 32`, and Phase 29 repeat
checks those fields while still comparing exact byte totals.

Move 108 adds overlap-aware generated-bulk totals. The audit now reports nested
target overlaps and adjusted non-overlap estimates, so the sweep can distinguish
raw repeated measurements from a cleaner size planning view without breaking
the existing raw-total contract.

Move 109 adds the missing executable language/runtime pass. The new
`language-runtime-audit` command writes Markdown and JSON evidence for language
counts, TypeScript helper candidates, Web Worker candidates, SQL/DuckDB
data-path candidates, runtime policy, and explicitly rejected Rust/Go/Python/WASM
families. Phase 29 repeat now compares those fields before any conversion work
can proceed.

Move 110 adds the proof layer on top of that candidate map. The audit now emits
`verificationMatrix` and `firstExecutableSlices`, so each conversion track has
required commands, rollback expectations, and a narrow first target before any
runtime or language change is attempted.

Move 111 verifies that the command-style proof gates still exist. The language
runtime audit now records `proofCommandCoverage` and `missingProofCommands`,
resolving package scripts and local script files while keeping manual proof
items explicit for the implementing slice.

Move 112 adds focused test coverage checks for the first executable conversion
slices. The audit now records `focusedTestCoverage` and
`focusedTestCoverageGaps`, so a conversion candidate cannot remain first in
line if its candidate file or focused tests disappear.

Move 113 completes the first narrow TypeScript conversion. `csvImport.ts` now
owns the implementation, `csvImport.js` stays as a compatibility wrapper for
existing imports, and `pricing.d.ts` provides the typed boundary to the existing
pricing helper. The language audit records this under
`convertedTypeScriptSlices` and verifies the wrapper/declaration support.

Move 114 completes the second narrow TypeScript conversion. `formatters.ts`
owns the shared date/time/count formatter implementation, `formatters.js`
remains as a compatibility wrapper, and `formatters.test.ts` is now part of
the frontend utility suite. The language audit now lists both completed
TypeScript slices.

Move 115 completes the grouped-record TypeScript conversion. `groupedRecords.ts`
now owns the shared time/alphabet grouping implementation, `groupedRecords.ts`
stays as the compatibility wrapper for existing imports, and `retired initials declaration shim`
documents the typed boundary to the remaining `initials.ts` helper. The slice
also removes duplicated unused Khmer initial-order constants from
`groupedRecords`.

Move 116 completes the initials TypeScript conversion. `initials.ts` now owns
Latin, numeric, symbol, and Khmer initial classification plus aggregation,
`initials.ts` remains as the stable import wrapper, and
`initials.test.mjs` directly covers the helper instead of relying only on
grouped-record/product-grouping callers.

Move 117 completes the media upload TypeScript conversion. `mediaUpload.ts`
now owns upload-state reduction, temporary preview sanitization, and media
cache-busting, while `mediaUpload.js` remains as the compatibility wrapper.
The helper test is now part of `frontend` `test:utils`, and explicit media
cache versions replace an existing `v` parameter instead of adding a duplicate.

Move 118 completes the pricing TypeScript conversion. `pricing.ts` now owns
price normalization, formatting, discount activity checks, and applied
promotion-price calculation, while `pricing.js` remains as the compatibility
wrapper for POS, products, catalog, inventory, app context, CSV import, and
tests.

Move 119 completes the product grouping TypeScript conversion.
`productGrouping.ts` now owns product family root resolution, same-name option
grouping, variant ordering, stock/price rollups, and initial-letter sections,
while `productGrouping.ts` remains as the compatibility wrapper for Products,
Inventory, POS, and existing focused tests. `retired productGrouping declaration shim` preserves a
typed public boundary for converted TypeScript callers.

Move 120 completes the product display helper TypeScript conversion.
`productDisplayHelpers.ts` now owns branch display labels, stock-status
classification, product row summary state, brand option merging, and lookup map
construction, while `productDisplayHelpers.mjs` remains as the compatibility
wrapper for Products and focused tests. `frontend/tsconfig.json` now includes
product helper `.ts` files so this component-helper conversion is part of the
normal typecheck gate.

Move 121 completes the product filter/export helper TypeScript conversion.
`productFilterHelpers.ts` now owns product search terms, branch quantity lookup,
page filtering, and export-row construction, while `productFilterHelpers.mjs`
remains as the compatibility wrapper for Products and focused tests. The slice
also adds `retired groupedRecords declaration shim` so TypeScript component helpers can consume
the grouped-record wrapper with typecheck coverage intact.

Move 122 completes the product menu helper TypeScript conversion.
`productMenuHelpers.ts` now owns export menu item construction, supplier option
normalization, active-filter counting, and filter-section assembly, while
`productMenuHelpers.mjs` remains as the compatibility wrapper for Products and
focused tests. The source-inspection product search pagination test now reads
the `.ts` implementation so wrapper files stay thin.

Move 123 completes the product write helper TypeScript conversion.
`productWriteHelpers.ts` now owns write payloads, restore branch/parent
planning, stock adjustment deltas, transfer payloads, bulk update summaries,
and bulk info/pricing updates, while `productWriteHelpers.mjs` remains as the
compatibility wrapper for Products and focused tests. The slice also adds
`retired productGalleryHelpers declaration shim` so the typed helper can keep using the existing
gallery helper boundary.

Move 124 completes the product import planner TypeScript conversion.
`productImportPlanner.ts` now owns CSV product import row normalization,
identifier conflict analysis, same-name family grouping, blocking
barcode/encoding issue checks, and summary counts. The former planner wrapper
has been retired; `BulkImportModal`, the product import worker, and focused
tests read the typed planner directly.

Move 125 completes the action guard utility TypeScript conversion.
`actionGuards.ts` now owns same-tick single-action, named-action, and
keyed-action guard helpers, while `actionGuards.mjs` remains as the
compatibility wrapper for component imports and source-inspection tests.

Move 126 completes the color contrast utility TypeScript conversion.
`color.ts` now owns hex normalization, relative luminance, and contrasting text
color selection, while `color.js` remains as the compatibility wrapper for
Products and ProductDetailModal imports.

Move 127 completes the dashboard date helper TypeScript conversion.
`dateHelpers.ts` now owns local `todayStr` and `offsetDate` formatting, while
`dateHelpers.js` remains as the compatibility wrapper for the utils barrel and
Dashboard import. A focused date helper test covers local `YYYY-MM-DD` output
and positive/negative day offsets.

Move 128 completes the client device metadata TypeScript conversion.
`deviceInfo.ts` now owns browser/OS detection and client meta header
construction, while `deviceInfo.js` remains as the compatibility wrapper for
API, auth, POS, Sales, and app context imports. The helper reads
`globalThis.navigator` to keep non-browser test/runtime callers safe.

Move 129 completes the report export package TypeScript conversion.
`exportPackage.ts` now owns report manifest normalization and report package
file assembly, while `exportPackage.js` remains as the compatibility wrapper
for Dashboard, Inventory, and tests. `csv.d.ts` documents the CSV helper
boundary used by this typed module.

Move 130 completes the history snapshot helper TypeScript conversion.
`historyHelpers.ts` now owns action-history snapshot cloning, result-id
extraction, and created-snapshot resolution, while `historyHelpers.mjs`
remains as the compatibility wrapper for the existing undo/redo imports across
products, contacts, inventory, branches, users, files, custom tables, and
returns.

Move 131 completes the shared utility barrel TypeScript conversion.
`index.ts` now owns formatter, CSV download, and local date helper re-exports,
while `index.js` remains as the compatibility wrapper for the stable utility
entrypoint.

Move 132 completes the permission parser utility TypeScript conversion.
`permissions.ts` now owns permission-map parsing with an explicit
`Record<string, unknown>` boundary, while `permissions.js` remains as the
compatibility wrapper for AppContext and permission tests. The helper keeps
malformed, missing, and array payloads out of the permission map surface while
preserving object identity for already-normalized maps.

Move 133 completes the product batch preview utility TypeScript conversion.
`productBatches.ts` now owns visible-batch filtering and preview counts for
Inventory and Products surfaces, while `productBatches.mjs` remains as the
compatibility wrapper. Focused tests cover all-branch totals, branch-specific
stock totals, invalid batch payloads, and preview overflow counts.

Move 134 completes the script typography helper TypeScript conversion.
`scriptTypography.ts` now owns Khmer script detection and text prop generation,
while `scriptTypography.js` remains as the compatibility wrapper for Catalog,
POS, Products, and Inventory surfaces. Focused tests cover Khmer-range
detection, `khmer-text` class merging, non-Khmer passthrough, and `lang="km"`
props.

Move 135 completes the settings refresh routing helper TypeScript conversion.
`settingsRefresh.ts` now owns settings-to-refresh-channel mapping, while
`settingsRefresh.js` remains as the compatibility wrapper for API methods and
tests. `appRefresh.d.ts` documents the app refresh utility boundary used by
this typed module, and focused tests protect setting-rule routing plus app
refresh channel normalization.

Move 136 completes the product page config constants TypeScript conversion.
`productPageConfig.ts` now owns product timeout constants and created-month
options, while `productPageConfig.mjs` remains as the compatibility wrapper for
the Products surface. Source-inspection tests read the typed implementation so
action stability and loading timeout contracts stay anchored to one config.

Move 137 completes the product gallery helper TypeScript conversion.
`productGalleryHelpers.ts` now owns gallery normalization, thumbnail state,
public image URL resolution, lightbox input fallback, and lightbox index
clamping, while `productGalleryHelpers.ts` remains as the compatibility
wrapper for Products, typed write helpers, and focused tests.

Move 138 completes the product group view helper TypeScript conversion.
`productGroupViewHelpers.ts` now owns product group price labels and summary
parts, while `productGroupViewHelpers.mjs` remains as the compatibility wrapper
for Products and focused tests. The typed helper makes formatter, translator,
and group summary inputs explicit.

Move 139 completes the product selection and pagination helper TypeScript
conversion. `productSelectionHelpers.ts` now owns visible id extraction,
product id maps, parent id sets, selected visible ids, pagination state,
selected rows, letter jump targets, and selection-scope predicates, while
`productSelectionHelpers.mjs` remains as the compatibility wrapper for Products
and focused tests.

Move 140 completes the product history helper TypeScript conversion.
`productHistoryHelpers.ts` now owns deleted-product restore ordering and
request-id generation, while `productHistoryHelpers.mjs` remains as the
compatibility wrapper for Products and focused history tests. The typed helper
keeps parent-first restore ordering explicit without moving the public import
path.

Move 141 completes the barcode image scanner helper TypeScript conversion.
`barcodeImageScanner.ts` now owns image data URL loading, browser image loading,
native `BarcodeDetector` detection, and zxing fallback decoding. No `.mjs`
scanner compatibility wrapper remains.

Move 142 completes the barcode scanner presentation-state helper TypeScript
conversion. `barcodeScannerState.ts` now owns camera permission/status mapping,
labels, retry visibility, empty-state messaging, and scanner state kinds. No
`.mjs` scanner compatibility wrapper remains.

Move 143 completes the concurrent bulk task helper TypeScript conversion.
`bulkOps.ts` now owns concurrency bounds, ordered result placement, success and
failure buckets, and per-item error capture, while `bulkOps.mjs` remains as the
compatibility wrapper for product, inventory, branch, contact, and sales
bulk-action surfaces.

Move 144 completes the app shell helper TypeScript conversion.
`appShellUtils.ts` now owns route normalization, admin/public path
classification, mounted-page limits, warmup gating, and notification display
metadata. The temporary app-shell `.mjs` compatibility wrapper is retired
because the React shell and focused app-shell tests now import the TypeScript
source directly.

Move 145 completes the portal catalog display helper TypeScript conversion.
`portalCatalogDisplay.ts` now owns customer portal grid classes, branch
matching, promotion display, price presentation, and highlight-badge ranking,
while `portalCatalogDisplay.mjs` remains as the compatibility wrapper for
catalog admin/public surfaces.

Move 146 completes the portal content i18n helper TypeScript conversion.
`portalContentI18n.ts` now owns portal translation normalization, config
localization, FAQ exact/vocabulary fallback, protected public-copy terms, and
product localization, while `portalContentI18n.mjs` remains as the
compatibility wrapper for catalog surfaces and focused portal i18n tests.

Move 147 completes the portal editor utility helper TypeScript conversion.
`portalEditorUtils.ts` now owns about-block and promotion-item normalization,
list reordering, and Google Maps embed URL normalization, while
`portalEditorUtils.mjs` remains as the compatibility wrapper for `CatalogPage`
and focused portal editor tests.

Move 148 completes the portal language pack helper TypeScript conversion.
`portalLanguagePacks.ts` now owns first-party language options, language
normalization, language membership checks, and translated text lookup, while
`portalLanguagePacks.ts` remains as the compatibility wrapper for catalog
surfaces and focused portal vocabulary tests. `retired portalLanguagePacks declaration shim`
remains as the small declaration shim for TypeScript imports through that
stable `.mjs` boundary.

Move 149 completes the contact option helper TypeScript conversion.
`contactOptionUtils.ts` now owns contact-option creation, stored JSON parsing,
import-row parsing, summaries, and primary option selection for customer,
supplier, and delivery contact surfaces. `contactOptionUtils.js` remains as the
compatibility wrapper, and unknown CSV/JSON values are normalized before they
reach contact forms.

Move 150 completes the inventory movement group helper TypeScript conversion.
`movementGroups.ts` now owns timestamp normalization, inventory movement
grouping, signed/display totals, expanded-group pagination, and search
haystacks, while `movementGroups.js` remains as the compatibility wrapper for
inventory surfaces and focused movement tests.

Move 151 completes the POS core helper TypeScript conversion. `posCore.ts`
now owns product lookup maps, variant children, grouped POS cards, variant
choices, cart pricing, cart line IDs, and cart-line matching, while
`posCore.mjs` remains as the compatibility wrapper for POS surfaces and
focused POS tests.

Move 152 completes the product import worker TypeScript conversion.
`productImportWorker.ts` now owns worker-side message narrowing and
progress/result/error posts and is now the stable Vite module-worker entrypoint
used by the bulk import modal.

Move 153 completes the receipt settings constants TypeScript conversion.
`constants.ts` now owns the receipt default template and translated field
metadata, while `constants.js` remains as the compatibility wrapper for receipt
settings surfaces and focused receipt tests.

Move 154 completes the customer membership number TypeScript conversion.
`customerMembershipNumber.ts` now owns the `LCMN` membership generator and
explicit entropy-length constant, while `customerMembershipNumber.js` remains
as the stable compatibility wrapper for contacts surfaces and focused tests.

Move 155 completes the dashboard chart barrel TypeScript conversion.
`index.ts` now owns the chart exports, `index.js` remains as the stable
compatibility wrapper for dashboard and report-rendering imports, and
`frontend/src/types/jsx-modules.d.ts` records the checked JSX module boundary
until the visual chart components move in separate slices.

Move 156 completes the receipt template helper TypeScript conversion.
`template.ts` now owns receipt-template parsing and serialization with an
`unknown` input boundary, while `template.js` remains as the stable
compatibility wrapper for receipt settings surfaces and focused receipt tests.

Move 157 completes the shared navigation configuration TypeScript conversion.
`navigationConfig.ts` now owns the navigation item registry, mobile pinned
defaults, stored-setting parser, and saved-order helper, while
`navigationConfig.js` remains as the stable compatibility wrapper for sidebar
and settings imports.

Move 158 completes the utils-settings barrel TypeScript conversion.
`index.ts` now owns the admin utility component re-export boundary, while
`index.js` remains as the stable compatibility wrapper for folder-level
imports. JSX declaration support remains centralized in
`frontend/src/types/jsx-modules.d.ts`.

Move 159 completes the settings conflict helper TypeScript conversion.
`settingsConflict.ts` now owns stale-write conflict state building and
field-diff rows with an `unknown` input boundary, while `settingsConflict.js`
remains as the stable compatibility wrapper for Settings page imports and
focused conflict tests.

Move 160 completes the storage policy helper TypeScript conversion.
`storagePolicy.ts` now owns live-server mirror protection, notification missing
summary TTL, Drive sync cooldown constants, strongest-number selection, and
cooldown checks, while `storagePolicy.mjs` remains as the stable compatibility
wrapper for API methods and focused storage-policy tests.

Move 161 completes the first Web Worker extraction slice. Contact import row
count analysis now runs through `contactImportWorker.ts` when Worker support is
available, falls back to the shared `csvRowCounter.ts` parser when it is not,
and keeps the server-side background import job upload/start flow unchanged.

Move 162 completes the inventory import Web Worker extraction slice. Inventory
row-count analysis now runs through `inventoryImportWorker.ts`, falls back to
the shared `csvRowCounter.ts` parser, and keeps the background import job
upload/start flow unchanged.

Move 163 hardens the product import worker loop rather than adding a duplicate
worker. `BulkImportModal.tsx` now routes Worker unsupported, worker startup
failure, postMessage failure, worker error, and 60 second timeout cases through
the existing `productImportPlanner.ts` parser fallback. The Phase 29 language
audit records `BulkImportModal.tsx`, `productImportWorker.ts`, and
`productImportPlanner.ts` as one completed Web
Worker slice, so later worker candidates advance to the next import or media
hot path.

Move 164 completes the sales import Web Worker row-count slice.
`SalesImportModal.tsx` now analyzes CSV row counts through
`salesImportWorker.ts` when Worker support is available and falls back to the shared
`csvRowCounter.ts` parser when the worker path fails. This keeps sales import
preview counts consistent with inventory/contact quoted multiline CSV handling
without changing the server-side import job pathway.

Move 165 rejects `frontend/src/components/shared/BackgroundImportTracker.tsx`
as a Web Worker extraction target. The file is bounded import-job polling and
UI action orchestration, not browser CPU/file/media work, so the language audit
now records it in `rejectedWebWorkerCandidates` and removes it from ranked
worker candidates. The next worker candidate is `frontend/src/utils/csv.js`;
the next data-path candidate remains `backend/src/services/backupPackages.js`.

Move 166 completes the CSV/ZIP export worker slice.
`frontend/src/utils/csvExportWorker.ts` owns worker-side ZIP blob creation,
`csvExportWorker.mjs` is the Vite module-worker wrapper, and
`frontend/src/utils/csv.js` keeps `buildZip()` as fallback while exposing
`buildZipInWorker()` and `downloadZipFilesAsync()`. Dashboard, Inventory, and
Contacts package exports now use the worker-backed path; Contacts all-export
also benefits from row-descriptor normalization into actual CSV contents.

Move 167 completes the first backend backup data-path optimization.
`backend/src/services/backupPackages.js` now streams backup table pages with
keyset pagination on `id` where possible and retains `LIMIT ? OFFSET ?` as the
fallback for compatibility. This reduces wasted database work on large tables
without changing package files, streamed checksums, restore metadata, local
retention, or remote mirror behavior. The language/runtime audit also records
`frontend/src/utils/csvImport.ts` as an intentional shared parser/fallback, not
a new standalone Worker slice, because the heavy product/contact/inventory/
sales import surfaces already run through focused workers.

Move 168 completes the first import-job data-path optimization.
`backend/src/services/importJobs.ts` now caches product rows by normalized name
inside the product import context and caches supplier lookups for the same job.
`rememberProductForImport()` keeps the product cache current when an import row
creates or updates a product, so repeated same-name variant and merge rows do
less database work while preserving row decisions and import job state. The
barcode photo scanner helper and scanner modal are also recorded as rejected
standalone Worker targets because they depend on DOM image loading, camera
permissions, video refs, native `BarcodeDetector`, zxing browser controls, and
React UI state.

Move 169 clears the remaining false-positive Web Worker candidates from the
current audit ranking. `ImageGalleryLightbox.tsx` is presentation and keyboard
navigation around already-rendered browser images. `importJobRefresh.js` is a
small import-completion channel mapper plus `window.dispatchEvent` helper. Both
stay on the main browser path so future worker work targets actual transferable
CPU, parser, image preprocessing, scanner-engine, or media workloads.

Move 170 completes the schema-audit parser optimization. The generated schema
audit now pre-parses `ALTER TABLE ... PRIMARY KEY` constraints into a map before
walking `CREATE TABLE` bodies, so primary-key fallback lookup is constant-time
per table instead of rescanning the full canonical DDL for every table. The
Markdown and JSON report contracts stay unchanged.

Move 171 completes the import-job list route data-path optimization. The route
now calculates the user's permitted import domains once and passes those types
to `listImportJobs()`, where the SQL query filters with `type IN (...)` before
job reconciliation and decoration. The public permission result is unchanged;
the backend simply does less discarded work.

Move 172 completes the backup reliability verifier consolidation. The verifier
now reads its source files through one manifest and applies grouped
required/forbidden guard strings through `checkNeedles()`. Streaming backup,
Drive resumable uploads, cancellable system jobs, Backup UI controls, offline
pause gates, and automation wiring stay covered with less duplicated script
structure.

Move 173 records `backend/src/db/postgresSchema.sql` as a rejected language/
runtime data-path candidate. The canonical DDL remains governed by the schema
relationship and migration protocol, so future primary-key, index, JSONB, and
foreign-key changes require backup, restore rehearsal, orphan checks, rollback
SQL, schema audit, and relationship-doc updates instead of entering the generic
conversion queue.

Move 174 completes the next SQL/data-path slice in
`backend/src/routes/inventory.ts`. The RFID stock-apply route now prepares
branch, product, branch-stock, movement, product-summary, and session-finalize
statements once per request and reuses them across confirmed product rows. The
route stays in Node.js because it coordinates request validation, audit, and
stock recalculation side effects, but the avoidable per-row statement setup is
gone.

Move 175 completes the next portal route data-flow slice in
`backend/src/routes/portal.ts`. Full catalog and paged catalog search responses
now share `getPortalProductAssets()` and `buildPortalProductPayload()` for
image gallery, branch-stock, fallback image, and highlight badge assembly,
removing two parallel materialization blocks while preserving the public
payload shape.

Move 176 completes the next product route data-path slice in
`backend/src/routes/products.ts`. Image-only bulk import now builds a normalized
active-product name map once, then matches each uploaded filename with a direct
lookup. This removes the repeated all-product scan from the image loop while
preserving the same filename-to-product name matching rule.

Move 177 completes the next sales route data-path slice in
`backend/src/routes/sales.ts`. Sale creation now prepares the inventory
movement insert and optional movement-created-at update once per transaction
and reuses them across sold item allocations. This leaves batch allocation,
stock movement, audit, and imported timestamp semantics intact while removing
per-item statement setup.

Move 178 completes the next system route data-path slice in
`backend/src/routes/system/index.ts`. `writeSystemSettings()` now prepares the
settings delete statement once beside the settings upsert statement, so removing
null-valued settings inside the transaction no longer rebuilds the same DELETE
statement for each entry.

Move 179 closes the final self-referential SQL/DuckDB candidate in
`ops/scripts/architecture/language-runtime-audit.mjs`. The script now records
itself as a rejected data-path conversion candidate because it is the Phase 29
meta-audit/report generator, not a runtime query/import hot path.

Move 180 records the authenticated Dashboard startup optimization as the next
Phase 29 performance slice. The accepted rewire keeps route chunks cold until
intent, moves non-critical sync/notification/import/offline work behind
delays, removes local DB/local mirror imports from bootstrap fallback, and
keeps Dashboard on the narrow data transport plus on-demand export helpers.
The Docker-served Playwright trace on hash `9b132859aa24909c` is the proof
gate: 12 JavaScript chunks and 3 app data/auth API calls in the first 12
seconds, plus 3 expected health probes, down from the earlier 34 chunks and 5
app data/auth API calls, with no failed responses or relevant console
messages.

Move 181 records the health-probe dedupe slice. The accepted rewire keeps
health awareness in the TypeScript HTTP runtime, adds in-flight/fresh result
reuse, and has AppContext consume the shared result instead of raw-fetching
`/health` during sync URL discovery. The Docker-served Playwright proof on hash
`f29e8401e596bf6c` shows one health probe in the first 12 seconds instead of
three, while preserving the same Dashboard data/API success and clean console
profile.

Move 182 records the Dashboard startup data-combination slice. The accepted
rewire keeps Node/Express as the runtime, reuses the existing cached Dashboard
summary and analytics builders, adds `/api/dashboard/startup` for first paint,
and leaves `/api/dashboard` plus `/api/analytics` as compatible refresh
endpoints. The Docker-served Playwright proof on hash `435e572a3d2acfaf`
shows one startup data call instead of separate summary and analytics calls;
the `7 Days` interaction then makes exactly one analytics request and no
summary refetch.

Move 183 records the bootstrap health-prime slice. The accepted rewire keeps
health/version awareness in the TypeScript HTTP runtime and extends the
authenticated bootstrap payload with served frontend runtime metadata, allowing
the browser to seed the shared health result without an immediate `/health`
request. The delayed scheduled health probe remains as the recovery path for
offline, focus, visibility, or failed-bootstrap cases. The Docker-served
Playwright proof on hash `09107596d6229a5a` shows two initial Dashboard app
responses, `/api/auth/bootstrap` and `/api/dashboard/startup`, with zero
startup `/health`, zero initial legacy dashboard/analytics split calls, and a
`7 Days` range interaction that still makes exactly one analytics request and
no summary refetch.

Move 184 records the Dashboard chart-code split. The accepted rewire stays in
React/TypeScript, replaces the eager dashboard chart barrel import with direct
visible chart imports, and moves the inactive volume/transactions `BarChart`
branch behind `React.lazy`/`Suspense`. The Docker-served Playwright proof on
hash `9ee8a8bbcfeb8deb` shows the first Dashboard render still loads the
visible payment donut, but does not request or modulepreload `BarChart`; build
output split `BarChart` into a 3.33 kB lazy chunk and reduced the first-paint
chart chunk to 7.56 kB.

Move 185 records the shared-control startup split. The accepted rewire keeps
React/TypeScript and Vite, but narrows the fallback `app-shared` ownership by
splitting route-demand shared controls (`PaginationControls`,
`ActionHistoryBar`, `FilterMenu`, `SectionSwitcher`, `PageHeader`, and
`Modal`) into focused chunks before the generic shared fallback. The
Docker-served Playwright proof on hash `453778909dc40f11` shows `app-shared`
at 73,051 decoded bytes, with none of the split shared-control chunks
requested or modulepreloaded on Dashboard first paint. Startup app API traffic
remained `/api/auth/bootstrap` and `/api/dashboard/startup`, and the `7 Days`
interaction still made exactly one analytics request.

Move 186 records the Dashboard export menu intent-load split. The accepted
rewire keeps React/TypeScript and avoids a second-click UX by rendering the
button immediately, preloading `PortalMenu` on pointer/focus intent, and using
`defaultOpen` when the first click triggers the dynamic import. Vite emits the
portal positioning/menu code as `shared-portal-menu`, a 4.10 kB deferred
chunk. The Docker-served Playwright proof on hash `23fd366cede8b3c4` shows
`app-shared` at 69,332 decoded bytes, no `shared-portal-menu` startup request
or modulepreload, and a direct `Export` click that loads the portal chunk at
HTTP 200 and opens the menu.

Move 187 records the focused Lucide shell-icon chunk split. The accepted
rewire keeps React/TypeScript and Vite, converts runtime Lucide imports to
direct icon-module imports, and documents those modules through
`frontend/src/types/lucide-react-icons.d.ts`. Vite now assigns only
shell/Login/sidebar icons to `app-shell-icons`, avoiding a broad Lucide vendor
chunk and avoiding route-chunk ownership of startup icons. The Docker-served
Playwright proof on hash `ab7ff057cc20cdd9` shows startup at 13 JavaScript
files, 620,625 decoded bytes, and 189,316 transfer bytes, with no catalog,
notification-center, background-import-tracker, file-picker, media-upload,
portal-menu, vendor-zxing, or `vendor-lucide` startup chunks. The same proof
kept `/api/auth/bootstrap`, `/api/dashboard/startup`, and the `7 Days`
analytics refresh healthy, and still loaded `shared-portal-menu` on demand
after clicking `Export`.

Move 188 records the signed-out Login/auth-icon boundary split. The accepted
rewire keeps React/TypeScript and Vite, but moves `Login` behind a lazy
unauthenticated branch and adds an explicit `auth-login` chunk for Login plus
auth-only Lucide icons. This reduces authenticated startup without changing
the login contract, and it avoids the earlier accidental catalog ownership for
some auth icons. The Docker-served Playwright proof on hash
`80aceec796128140` shows authenticated Dashboard startup at 13 JavaScript
files, 587,317 decoded bytes, and 181,800 transfer bytes, with no
`auth-login`, catalog, notification-center, background-import-tracker,
file-picker, media-upload, portal-menu, vendor-zxing, or vendor-lucide
startup chunks or modulepreloads. The signed-out `/login` proof loads
`auth-login-SHSYT-QZ.js` on demand and no longer loads catalog/file-picker/
media/ZXing extras.
