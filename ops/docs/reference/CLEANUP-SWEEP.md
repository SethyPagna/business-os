# Cleanup Sweep

Last updated: 2026-05-22

Current plan position: Phase 8.4 active; Phase 26 at fifty-one completed
moves; Phase 28 active; Phase 29 active as of Move 333.

## Cleanup Result

The first Phase 29 cleanup pass removed ignored/generated bulk while preserving
source files, secrets, env files, uploaded business data, and newest backup
packages.

Measured after cleanup:

| Area | Size after cleanup |
| --- | ---: |
| workspace visible directory total | about 605 MB |
| `ops` | about 60 MB |
| `ops/runtime` | about 58 MB |
| `frontend` | about 210 MB |
| `business-os-data` | about 204 MB |
| `backend` | about 117 MB |

Major removed/generated targets:

| Target | Approx bytes removed | Reason |
| --- | ---: | --- |
| `release` | about 360 MB | Generated release kit; rebuild with `run\build-release.bat` or `run\docker\release.bat`. |
| `ops/runtime/docker-disk-migration-20260514-085155` | 248,813,345 | Old generated Docker disk migration snapshot. |
| `ops/runtime/build` | 186,184,114 | Generated server executable; `clean-generated.ps1` already targets this folder. |
| `ops/scanbot-web-sdk-7.0.0` | about 112 MB | Ignored unpacked SDK copy; tracked runtime SDK remains under `frontend/public/scanbot-web-sdk`. |
| old `ops/runtime/docker-release/backups/*` | about 110 MB | Kept newest three Docker-release backup packages. |
| `ops/runtime/launch-assets` | 44,198,923 | Generated launch/demo media. |
| `ops/node_modules` | about 13 MB | Reinstallable dependencies. |
| `.playwright-cli`, `output`, root Vite logs | small | Generated local artifacts. |
| old prune JSON and temporary Khmer pass folders | about 2.6 MB | Stale generated runtime artifacts. |

The active `ops/runtime/logs/cloudflared.log` file was locked by the running
tunnel and was intentionally left in place.

Latest generated cleanup after Move 299:

| Target | Bytes removed | Reason |
| --- | ---: | --- |
| `release` | 378,826,787 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211604` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,828,323 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211616` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,828,835 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211626` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,829,347 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211637` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,827,811 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211650` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,827,299 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211702` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,828,835 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211714` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,828,835 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211728` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,828,323 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211739` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,831,395 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605211752` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,831,395 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605212132` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,829,859 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605212142` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,830,371 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605212159` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,829,859 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605212213` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,828,835 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605212223` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,830,883 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605220423` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,830,883 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605220432` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,831,907 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605220445` was built, started, health-checked, and live-tested before deletion. |
| `release` | 378,831,907 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605220501` was built, started, health-checked, live-tested after the public portal CSP-check hardening, and deleted. |
| `release` | 378,831,772 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605220519` was built, started, health-checked, live-tested, and deleted. |
| `release` | 378,830,748 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605220531` was built, started, health-checked, live-tested, and deleted. |
| `release` | 378,831,892 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605221311` was built, started, health-checked, live-tested, and deleted after hardening release-kit parent-directory copies. |
| `release` | 378,832,645 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605221346` was built, started, health-checked, live-tested, and deleted after hardening release-kit directory replacement. |
| `release` | 378,833,157 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605221357` was built, started, health-checked, live-tested, and deleted after the POS filter-count optimization. |
| `release` | 378,833,345 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605221451` was built, started, health-checked, live-tested, and deleted after the shared client API query-string helper and Docker temp-tar cleanup retry hardening. |
| `release` | 378,832,321 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605221508` was built, started, health-checked, live-tested, and deleted after the shared client API query-path helper optimization. |
| `release` | 378,833,345 | Generated Docker release kit produced by `run\docker\release.bat`; the Docker image `business-os:v6.0.0-202605221539` was built, started, health-checked, live-tested, and deleted after the single-pass product ID normalization optimization. |

Latest verification after cleanup passed on frontend hash `64cbdcafff51e14f`:

- broad local Phase 8.4 UI report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-22T08-00-44-220Z/report.json`
- public Cloudflare portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-22T08-03-45-663Z/report.json`.
  The portal renders customer content, loads 40 products, all portal API
  requests return 200, enforced CSP is present, and there are no relevant
  console or page errors.
- storage prune completed after Move 330 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed 463,269
  bytes of old runtime reports and reclaimed about 2.505 GB of Docker builder
  cache while preserving images and volumes.
- storage prune completed after Move 329 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed 463,168
  bytes of old runtime reports and reclaimed about 2.505 GB of Docker builder
  cache while preserving images and volumes.
- storage prune completed after Move 328 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed 0 bytes
  of old runtime reports and reclaimed 0 bytes of Docker builder cache while
  preserving images and volumes.
- storage prune completed after Move 327 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed 493,543
  bytes of old runtime reports and reclaimed about 2.505 GB of Docker builder
  cache while preserving images and volumes.
- storage prune completed after Move 326 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed 463,121
  bytes of old runtime reports and reclaimed about 2.541 GB of Docker builder
  cache while preserving images and volumes.
- storage prune completed after Move 325 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed 463,546
  bytes of old runtime reports and reclaimed about 2.541 GB of Docker builder
  cache while preserving images and volumes.
- storage prune completed after Move 324 with local backup retention and R2
  mirror retention reporting zero pending backup deletions; it removed
  12,745,798 bytes of old runtime reports, compacted 3,790 bytes from runtime
  logs, and reclaimed about 10.09 GB of Docker builder cache while preserving
  images and volumes.
- storage prune completed with local backup retention and R2 mirror retention
  reporting zero pending deletions.
- Recovery-report retention is now part of `prune-storage`: it keeps the latest
  five entries in `ops/runtime/recovery-reports` by default and prunes both
  generated folders and top-level generated files. The first live run removed
  `pre-khmer-repair-20260510-094931`,
  `pre_khmer_repair_20260510.sql`, and `20260510-055708`, freeing 3,442,375
  bytes.
- Runtime report retention ran again after the Cloudflare script regrouping and
  removed two old generated Phase 8.4 report folders, freeing 495,006 bytes.
- Runtime report retention ran again after the audit script regrouping and
  removed three old generated Phase 8.4 report folders, freeing 664,957 bytes.
  One empty failed public-check report directory from the pre-fix checker run
  was also removed after verifying it was empty and under `ops/runtime/reports`.
- Runtime report retention ran again after the compatibility-wrapper audit gate
  verification and removed one old generated Phase 8.4 report folder, freeing
  247,761 bytes while keeping the latest 20 report folders.
- Runtime report retention ran again after wrapper reference tracking and live
  verification, removing two old generated Phase 8.4 report folders and freeing
  454,306 bytes while keeping the latest 20 report folders.
- Runtime report retention ran again after wrapper deletion live verification,
  removing two old generated Phase 8.4 report folders and freeing 454,419 bytes
  while keeping the latest 20 report folders.
- Runtime report retention ran again after the live-check auth helper wrapper
  deletion and removed two old generated Phase 8.4 report folders, freeing
  454,631 bytes while keeping the latest 20 report folders.
- Runtime report retention ran from the grouped storage cleanup path after the
  storage wrapper deletion and removed two old generated Phase 8.4 report
  folders, freeing 454,033 bytes while keeping the latest 20 report folders.
- Runtime report retention ran after deleting the root documentation generator
  wrappers and removed two old generated Phase 8.4 report folders, freeing
  452,973 bytes while keeping the latest 20 report folders.
- Runtime report retention ran after the shared docs scan helper consolidation
  and removed two old generated Phase 8.4 report folders, freeing 206,647
  bytes while keeping the latest 20 report folders.
- Local organization backup retention kept the newest three
  `org_leangcosmetics` datasync packages and removed
  `datasync-2026-05-18T12-49-22-039Z`, freeing 39,541,976 bytes.
- Runtime report retention ran after the shared function-reference docs helper
  consolidation and removed two old generated Phase 8.4 report folders, freeing
  452,864 bytes while keeping the latest 20 report folders.
- Runtime report retention ran after the shared live-check JSON helper
  consolidation and removed three old generated Phase 8.4 report folders,
  freeing 698,765 bytes while keeping the latest 20 report folders.
- Runtime report retention ran after the public portal CSP-check hardening and
  removed three old generated Phase 8.4 report folders, freeing 659,250 bytes
  while keeping the latest 20 report folders.
- Runtime report retention ran after the shared console/status/modal live-check
  helper consolidation and removed four old generated Phase 8.4 report folders,
  freeing 904,965 bytes while keeping the latest 20 report folders.
- Runtime report retention ran after the post-build local/public Phase 8.4
  verification and removed two old generated Phase 8.4 report folders, freeing
  452,595 bytes while keeping the latest 20 report folders. This run used
  `--skip-remote`; the later 2026-05-20 prune run executed the remote path.
- Runtime report retention ran again after the final post-build broad Phase 8.4
  UI verification and removed one old generated Phase 8.4 public portal report
  folder, freeing 206,672 bytes while keeping the latest 20 report folders. This
  run also used `--skip-remote`; the later 2026-05-20 prune run executed the
  remote path.
- Phase 29 cleanup pass on 2026-05-19 removed two additional verified generated
  local artifacts after exact-path reference scans:
  `ops/.playwright-cli` (42,110 bytes) and
  `run/cv-render-check-word` (29,547 bytes). `.gitignore`, `.dockerignore`,
  and `ops/scripts/powershell/clean-generated.ps1` now cover these paths so
  future cleanup runs do not leave them behind or copy them into Docker build
  context.
- Phase 29 cleanup pass on 2026-05-20 removed the remaining generated root
  `output` folder after exact-path reference scans showed only ignore, cleanup,
  and verification coverage references. Deleted
  `C:\Users\user\Downloads\business-os\output`, freeing 870,964 bytes. The
  refreshed generated-bulk audit now reports `output` as absent.
- Move 295 tightened generated database cleanup and applied it to the live
  Docker Postgres dataset. `cleanup-test-data.mjs --all-qa` now includes
  `QA Deep Audit` selectors for products, text payloads, lookup names, and
  import-job JSON. The applied cleanup removed 20 generated QA sales,
  20 sale items, 140 inventory movements, 279 action-history rows, and
  279 audit-log rows. It removed zero products, product batches, branch stock,
  uploads/import directories, import jobs/files, categories, units, backup
  packages, secrets, or business uploads. The post-cleanup
  `--dry-run --fail-on-match` check found zero QA residue, dataset readiness
  stayed `loaded`, and comprehensive integrity passed.
- Move 296 updated post-live hygiene scheduling after a live parallel trial
  showed Docker `psql` contention. The hygiene gate now records
  `contention-safe-sequential-checks`, runs the generated cleanup postchecks,
  dataset readiness, and comprehensive integrity in a predictable order, and
  still fails on any QA residue, empty dataset, or integrity failure.
- Move 297 rebuilt and restarted the Docker runtime on
  `business-os:v6.0.0-202605211541` after bounding catalog screenshot
  FileReader work. The generated `release` kit was removed after the image was
  available and the app was restarted. Phase 8.4 live verification passed on
  frontend hash `06a20c2b662bb3e2`, and post-live hygiene still reports zero
  generated residue with dataset readiness `loaded`.
- Local retention cleanup on 2026-05-20 ran
  `npm.cmd --prefix ops run prune-storage -- --skip-remote` after the generated
  `output` cleanup. It removed four old Phase 8.4 report folders and freed
  817,705 bytes while preserving business data, uploads, secrets, newest backup
  packages, Docker volumes, and R2 remote storage.
- Move 182 keeps cleanup auditing cheaper: `generated-bulk-audit.mjs` now uses
  Node's recursive directory read as a fast path with the previous stack walker
  as fallback. This keeps exact byte/file counts while reducing repeated
  measurement overhead for generated folders in Phase 29 sweeps.
- Move 183 keeps the repeated cleanup/schema sweep faster without changing
  cleanup boundaries: `phase29-audit.mjs` now runs independent child checks in
  parallel and runs `organization-audit.mjs` afterward so docs/reference scans
  still see completed generated reports.
- Docker cleanup on 2026-05-19 removed one stopped container and safe builder
  cache only, freeing about 105 MB. Docker volumes were intentionally preserved
  because they contain Postgres, Redis, MinIO, and runtime state.
- `prune-storage` now supports `--docker-safe-prune` for the same safe Docker
  cleanup path. It records `docker system df`, runs only stopped-container and
  builder-cache prune commands, and never prunes images or volumes. Full
  automation enables it via `cleanup.dockerSafePrune`. The first live
  `prune-storage --skip-remote --docker-safe-prune` run after implementation
  reclaimed 0 bytes because the manual safe prune had already cleared available
  cache.
- `verify-docker-release` now enforces the cleanup guardrails: generated and
  runtime bulk must stay out of `.dockerignore`, the local
  `run/cv-render-check-word` artifact must stay ignored by git, full automation
  must keep passing `--docker-safe-prune`, and retention cleanup must not add
  Docker volume, image, or full-system prune commands.
- Move 96 makes that guardrail machine-readable through
  `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`. Phase 29 repeat audits now
  compare required release files, wrapper count, retired artifact absence,
  ignore coverage, Docker safe-prune coverage, unsafe-prune absence, and cleanup
  policy state across cycles.
- Move 97 makes the organization audit durable through
  `ops/docs/reference/ORGANIZATION-AUDIT.json`, so cleanup and folder-rewire
  candidates can use machine-readable large-file paths, largest areas, wrapper
  lists, and wrapper removal candidates.
- Move 98 adds those organization details to Phase 29 repeat consistency:
  scan roots, root files, large-file threshold, largest areas, large-file paths,
  wrapper files, broken wrapper files, and removable wrapper files must remain
  stable across cycles before cleanup or folder rewires proceed.
- Move 99 adds ranked performance rows to repeat consistency as well:
  `topSourceBySize`, `topSourceByLines`, and `topBuiltChunks` must stay stable
  before large-module, dead-code, or chunk cleanup work proceeds.
- Move 100 keeps `PHASE29-AUDIT.md` lightweight by rendering long repeat values
  as counts, SHA-256 digests, and previews while preserving exact evidence in
  `PHASE29-AUDIT.json`.
- Move 101 keeps repeat-audit console output lightweight too: child checks are
  captured for parsing but only concise status, duration, and report paths are
  printed unless `--verbose` is passed.
- Move 102 parallelizes generated-bulk target measurement and records the
  measurement mode in JSON, keeping cleanup evidence complete while reducing
  avoidable sequential waiting during repeated sweeps.
- Move 103 records ranked `largestProtectedTargets` and
  `largestCleanupTargets` rows in generated-bulk JSON and compares them during
  Phase 29 repeat runs, so cleanup work starts with the biggest safe candidates.
- Move 104 adds Phase 29 duration profiling so cleanup and audit optimization
  work can see total child-check time, per-check averages/max values, and the
  slowest individual runs before changing workflow strategy.
- Move 105 adds bounded parallel reads to organization audit so cleanup and
  folder evidence is collected faster while preserving deterministic scan
  output and Phase 29 drift checks.
- Move 106 adds `measureMs` and `slowestTargetMeasurements` to generated-bulk
  output so cleanup work can see which targets are most expensive to measure,
  without making variable disk timings part of the repeat drift contract.
- Move 107 adds bounded per-directory file-stat parallelism to generated-bulk
  measurement so exact cleanup byte counts remain intact while dependency
  folders avoid a fully sequential stat loop.
- Move 108 adds nested-target overlap reporting and adjusted non-overlap byte
  estimates, so cleanup planning can separate raw measured totals from child
  folders already included inside parent targets.
- Move 109 adds the language/runtime audit to Phase 29. Cleanup and rewire work
  now has a stable JSON view of TypeScript, Web Worker, and SQL/DuckDB
  candidates, plus explicit rejected Rust/Go/Python/WASM families, before any
  source deletion or conversion is attempted.
- Move 110 adds a conversion proof matrix to that audit. Cleanup work that
  overlaps language/runtime rewires now records required proof commands,
  rollback expectations, and first executable slices before source files are
  converted, merged, or deleted.
- Move 111 verifies the command-style proof gates in that matrix. Missing
  package scripts or local scripts now show up in `missingProofCommands` and
  fail Phase 29 before cleanup or conversion work proceeds.
- Move 112 verifies focused tests for the first conversion slices. Cleanup work
  now has `focusedTestCoverage` and `focusedTestCoverageGaps` evidence before
  deleting or moving helper, import, or backup code that conversion work depends
  on.
- Move 113 converts the CSV import helper to TypeScript while preserving a
  compatibility wrapper at the old `.js` path. Cleanup must keep that wrapper
  until `rg` proves all runtime and test imports have moved, and the language
  audit now checks the implementation, wrapper, and declaration support.
- Move 114 converts the formatter helper to TypeScript while preserving the
  old `.js` wrapper. Cleanup must treat both TypeScript conversion wrappers as
  live compatibility files until imports are intentionally migrated.
- Move 115 converts the grouped-record helper to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep that wrapper, plus
  `retired initials declaration shim`, until the component/test imports and typed boundary are
  intentionally migrated.
- Move 116 converts the initials helper to TypeScript while preserving the old
  `.mjs` wrapper. Cleanup must keep both `initials.ts` and `retired initials declaration shim`
  while converted TypeScript modules and legacy JavaScript imports share that
  public boundary.
- Move 117 converts the media upload helper to TypeScript while preserving the
  old `.js` wrapper. Cleanup must keep `mediaUpload.js` and
  `publicAssetUrls.d.ts` until catalog/settings/product imports and typed public
  asset boundaries are intentionally migrated.
- Move 118 converts the pricing helper to TypeScript while preserving the old
  `.js` wrapper. Cleanup must keep both `pricing.js` and `pricing.d.ts` until
  all JavaScript imports and converted TypeScript callers intentionally move to
  a new public boundary.
- Move 119 converts the product grouping helper to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep both `productGrouping.ts` and
  `retired productGrouping declaration shim` until Products, Inventory, POS, and tests are
  intentionally moved to a different public grouping boundary.
- Move 120 converts the product display helper to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep `productDisplayHelpers.mjs` until
  the Products page and focused tests are intentionally moved to the `.ts`
  implementation path.
- Move 121 converts the product filter/export helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep
  `productFilterHelpers.mjs` and `retired groupedRecords declaration shim` until Products,
  product search pagination tests, and TypeScript component helpers are
  intentionally moved to a different public boundary.
- Move 122 converts the product menu helper to TypeScript while preserving the
  old `.mjs` wrapper. Cleanup must keep `productMenuHelpers.mjs` until the
  Products page, source-inspection pagination test, and focused menu helper
  tests intentionally move to the `.ts` implementation path.
- Move 123 converts the product write helper to TypeScript while preserving the
  old `.mjs` wrapper. Cleanup must keep `productWriteHelpers.mjs` and
  `retired productGalleryHelpers declaration shim` until Products, write helper tests, action
  stability tests, and typed product helper imports intentionally move to a new
  public boundary.
- Move 124 converts the product import planner to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep `productImportPlanner.mjs` until
  `BulkImportModal`, `productImportWorker.mjs`, and focused product import
  planner tests intentionally move to a new public boundary.
- Move 125 converts the action guard utility to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep `actionGuards.mjs` until the many
  component imports and source-inspection action stability tests intentionally
  move to a new public boundary.
- Move 126 converts the color contrast utility to TypeScript while preserving
  the old `.js` wrapper. Cleanup must keep `color.js` until Products and
  ProductDetailModal imports intentionally move to a new public boundary.
- Move 127 converts the dashboard date helper to TypeScript while preserving
  the old `.js` wrapper. Cleanup must keep `dateHelpers.js` until the utils
  barrel and Dashboard imports intentionally move to a new public boundary.
- Move 128 converts the client device metadata helper to TypeScript while
  preserving the old `.js` wrapper. Cleanup must keep `deviceInfo.js` until
  API, auth, POS, Sales, and app context imports intentionally move to a new
  public boundary.
- Move 129 converts the report export package helper to TypeScript while
  preserving the old `.js` wrapper. Cleanup must keep `exportPackage.js` until
  Dashboard, Inventory, and tests intentionally move to a new public boundary.
- Move 130 converts the shared history snapshot helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep `historyHelpers.mjs`
  until the many undo/redo imports intentionally move to a new public boundary.
- Move 131 converts the shared utility barrel to TypeScript while preserving
  the old `.js` wrapper. Cleanup must keep `index.js` until any stable utility
  entrypoint imports intentionally move to a new public boundary.
- Move 132 converts the permission parser utility to TypeScript while
  preserving the old `.js` wrapper. Cleanup must keep `permissions.js` until
  AppContext and tests intentionally move to a new public boundary or the
  wrapper audit proves it is unused.
- Move 133 converts the product batch preview utility to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep `productBatches.mjs`
  until Inventory and Products surfaces intentionally move to a new public
  boundary or the wrapper audit proves it is unused.
- Move 134 converts the script typography helper to TypeScript while
  preserving the old `.js` wrapper. Cleanup must keep `scriptTypography.js`
  until Catalog, POS, Products, and Inventory surfaces intentionally move to a
  new public boundary or the wrapper audit proves it is unused.
- Move 135 converts the settings refresh routing helper to TypeScript while
  preserving the old `.js` wrapper. Cleanup must keep `settingsRefresh.js`
  until API methods and tests intentionally move to a new public boundary or
  the wrapper audit proves it is unused; keep `appRefresh.d.ts` while
  `settingsRefresh.ts` imports the JavaScript app refresh helper.
- Move 136 converts the product page config constants to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep
  `productPageConfig.mjs` until Products imports intentionally move to a new
  public boundary or the wrapper audit proves it is unused.
- Move 137 converts the product gallery helper to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep `productGalleryHelpers.ts` and
  `retired productGalleryHelpers declaration shim` until Products, product write helpers, and
  focused tests intentionally move to a new public boundary or the wrapper
  audit proves they are unused.
- Move 138 converts the product group view helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep
  `productGroupViewHelpers.mjs` until Products and focused tests intentionally
  move to a new public boundary or the wrapper audit proves it is unused.
- Move 139 converts the product selection and pagination helper to TypeScript
  while preserving the old `.mjs` wrapper. Cleanup must keep
  `productSelectionHelpers.mjs` until Products, focused tests, and source
  checks intentionally move to a new public boundary or the wrapper audit
  proves it is unused.
- Move 140 converts the product history helper to TypeScript while preserving
  the old `.mjs` wrapper. Cleanup must keep `productHistoryHelpers.mjs` until
  Products and focused history tests intentionally move to a new public
  boundary or the wrapper audit proves it is unused.
- Move 141 converts the barcode image scanner helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep
  `barcodeImageScanner.mjs` until the scanner modal and focused scanner tests
  intentionally move to a new public boundary or the wrapper audit proves it is
  unused.
- Move 142 converts the barcode scanner presentation-state helper to TypeScript
  while preserving the old `.mjs` wrapper. Cleanup must keep
  `barcodeScannerState.mjs` until the scanner modal and focused scanner-state
  tests intentionally move to a new public boundary or the wrapper audit proves
  it is unused.
- Move 143 converts the concurrent bulk task helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep `bulkOps.mjs` until all
  bulk-action surfaces and focused tests intentionally move to a new public
  boundary or the wrapper audit proves it is unused.
- Move 144 converts the app shell helper to TypeScript and retires the old
  `.mjs` wrapper after `App.jsx`, `AppContext.jsx`, `index.jsx`, and focused
  tests moved to the TypeScript source. Cleanup should keep this pattern for
  future wrappers: update callers first, prove no first-party references remain,
  then delete the wrapper.
- Move 145 converts the portal catalog display helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep
  `portalCatalogDisplay.mjs` until catalog admin/public surfaces and focused
  tests intentionally move to a new public boundary or the wrapper audit proves
  it is unused.
- Move 146 converts the portal content i18n helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep `portalContentI18n.mjs`
  until catalog surfaces and focused portal i18n tests intentionally move to a
  new public boundary or the wrapper audit proves it is unused.
- Move 147 converts the portal editor utility helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep `portalEditorUtils.mjs`
  until `CatalogPage.jsx` and focused portal editor tests intentionally move to
  a new public boundary or the wrapper audit proves it is unused.
- Move 148 converts the portal language pack helper to TypeScript while
  preserving the old `.mjs` wrapper. Cleanup must keep
  `portalLanguagePacks.ts` and its typed declaration until catalog surfaces,
  portal i18n helpers, and focused portal vocabulary tests intentionally move
  to a new public boundary or the wrapper audit proves it is unused.
- Move 149 converts the contact option helper to TypeScript while preserving
  the old `.js` wrapper. Cleanup must keep `contactOptionUtils.js` until
  customer, supplier, delivery, POS, and focused pricing/contact tests
  intentionally move to a new public boundary or the wrapper audit proves it
  is unused.
- Move 150 converts the inventory movement group helper to TypeScript while
  preserving the old `.js` wrapper. Cleanup must keep `movementGroups.js` until
  `Inventory.jsx` and focused movement-group tests intentionally move to a new
  public boundary or the wrapper audit proves it is unused.
- Move 151 converts the POS core helper to TypeScript while preserving the old
  `.mjs` wrapper. Cleanup must keep `posCore.mjs` until `POS.jsx` and focused
  POS core tests intentionally move to a new public boundary or the wrapper
  audit proves it is unused.
- Move 152 converts the product import worker body to TypeScript while
  preserving `productImportWorker.mjs` as the Vite module-worker entrypoint.
  Cleanup must keep that wrapper until `BulkImportModal.jsx` and production
  build evidence prove a new worker URL is safe.
- Move 153 converts receipt settings constants to TypeScript while preserving
  `constants.js` as the receipt settings compatibility wrapper. Cleanup must
  keep that wrapper until receipt settings imports, template helpers, and
  focused receipt tests intentionally move to a new public boundary.
- Move 154 converts the customer membership number helper to TypeScript while
  preserving `customerMembershipNumber.js` as the contacts compatibility
  wrapper. Cleanup must keep that wrapper until contact forms, customer tabs,
  and focused source-scan tests intentionally move to a new public boundary.
- Move 155 converts the dashboard chart barrel to TypeScript while preserving
  `frontend/src/components/dashboard/charts/index.js` as the chart barrel
  compatibility wrapper. Cleanup must keep that wrapper until dashboard and
  export-report imports intentionally move to a new public boundary.
- Move 156 converts the receipt template helper to TypeScript while preserving
  `frontend/src/components/receipt-settings/template.js` as the receipt
  settings compatibility wrapper. Cleanup must keep that wrapper until receipt
  settings imports and focused receipt tests intentionally move to a new public
  boundary.
- Move 157 converts the shared navigation configuration to TypeScript while
  preserving `frontend/src/components/shared/navigationConfig.js` as the
  sidebar/settings compatibility wrapper. Cleanup must keep that wrapper until
  navigation imports and focused navigation tests intentionally move to a new
  public boundary.
- Move 158 converts the utils-settings barrel to TypeScript while preserving
  `frontend/src/components/utils-settings/index.js` as the folder-level
  compatibility wrapper. Cleanup must keep that wrapper until import/reference
  scans prove no consumer uses the barrel path.
- Move 159 converts the settings conflict helper to TypeScript while preserving
  `frontend/src/components/utils-settings/settingsConflict.js` as the Settings
  page compatibility wrapper. Cleanup must keep that wrapper until Settings
  imports and focused conflict tests intentionally move to the typed path.
- Move 160 converts the storage policy helper to TypeScript while preserving
  `frontend/src/platform/storage/storagePolicy.mjs` as the API/storage-policy
  compatibility wrapper. Cleanup must keep that wrapper until API imports and
  focused storage tests intentionally move to the typed path.
- Move 161 adds `frontend/src/components/contacts/contactImportWorker.mjs` as
  the stable Vite worker wrapper for `contactImportWorker.ts`. The
  contact-specific parser shim has been deleted after modal, worker, and tests
  moved to the shared typed CSV row counter.
- Move 162 adds `frontend/src/components/inventory/inventoryImportWorker.mjs`
  as the stable Vite worker wrapper for `inventoryImportWorker.ts`. The shared
  row-counter wrapper has been deleted after inventory, sales, contact, and
  focused tests moved to direct typed paths.
- Move 163 records the product import worker cluster as an active completed
  worker slice: `BulkImportModal.jsx` depends on `productImportWorker.mjs` for
  the Vite module-worker entrypoint, while `productImportPlanner.ts` remains
  the synchronous fallback/correctness oracle. Cleanup must keep both wrappers
  and the planner until worker and modal imports are intentionally rewired with
  a passing build and focused product import flow.
- Move 164 adds `frontend/src/components/sales/salesImportWorker.mjs` as the
  stable Vite worker wrapper for `salesImportWorker.ts`. Cleanup must keep this
  worker wrapper until bundler imports intentionally move to a different typed
  worker-entry strategy.
- Move 165 marks `frontend/src/components/shared/BackgroundImportTracker.jsx`
  as an intentional non-worker UI orchestration file. Cleanup and language
  conversion sweeps should keep it in the React path unless future evidence
  shows real browser CPU work beyond bounded polling and tiny list transforms.
- Move 166 adds `frontend/src/utils/csvExportWorker.mjs` as the stable Vite
  module-worker wrapper for `csvExportWorker.ts`. Cleanup must keep that
  wrapper and `frontend/src/utils/csv.js` until export package call sites move
  to another verified worker entrypoint with a passing build and export flow.
- Move 167 marks `frontend/src/utils/csvImport.ts` and its `csvImport.js`
  wrapper as intentionally live shared parser/fallback code. Cleanup should not
  delete that wrapper while product import planning, local DB compatibility, or
  worker fallback tests still import the `.js` boundary. Backend cleanup should
  also keep `backupPackages.js` in Node.js for now; the verified optimization is
  keyset pagination inside the existing runtime, not a language/runtime move.
- Move 168 marks `frontend/src/components/products/scanning/barcodeImageScanner.ts`
  and `BarcodeScannerModal.jsx` as intentionally main-browser scanner code, not
  cleanup or Worker-move targets. They depend on browser image/camera APIs and
  React permission UI. Cleanup should keep the `.mjs` scanner wrapper and
  scanner tests until a future scanner replacement proves equal browser support.
- Move 169 marks `ImageGalleryLightbox.jsx` and `importJobRefresh.js` as
  intentionally live main-thread UI/event code. Cleanup should keep the
  lightbox while Products, POS, and Catalog surfaces lazy-load it, and should
  keep the import refresh helper while `BackgroundImportTracker` dispatches
  `sync:update` events through it.
- The latest `npm.cmd --prefix ops run prune-storage` pass removed 10 old
  generated Phase 8.4 live-check report folders from `ops/runtime/reports`,
  clearing 2,066,948 bytes while preserving protected uploads, secrets, local
  backup roots, and remote R2 state.
- `npm.cmd --prefix ops run generated-bulk-audit` now writes
  `ops/docs/reference/GENERATED-BULK-AUDIT.md`. Latest run measured 15 known
  generated/runtime/data targets, found 8 existing targets, measured
  556.47 MB total, separated 259.04 MB protected data/runtime state from
  297.43 MB reinstallable/regenerable material, and reported zero ignore
  coverage gaps.
- Full automation now runs the generated-bulk audit during its test gate, after
  frontend build and before Docker release verification. That keeps cleanup
  drift visible in normal check/test/release runs while preserving the
  non-mutating audit boundary.
- The generated-bulk audit now also writes
  `ops/docs/reference/GENERATED-BULK-AUDIT.json` and reads the automation
  policy with `--policy`. The current policy caps non-protected cleanup
  candidates at 536,870,912 bytes; protected business data, uploads, and
  secrets are excluded from that threshold.
- `npm.cmd --prefix ops run clean-generated:preview` now rehearses the
  generated cleanup path without deleting anything. The generated-bulk audit
  checks that every non-protected cleanup candidate is represented in
  `clean-generated.ps1`; runtime logs are no longer part of broad generated
  cleanup because they can be active runtime files.
- `npm.cmd --prefix ops run phase29:audit` now runs the non-mutating repeated
  sweep loop for generated bulk, folder organization, schema coverage, and
  Docker release cleanup guardrails. Latest run passed 4 checks with 0
  failures and wrote `ops/docs/reference/PHASE29-AUDIT.md`.
- Full automation now calls the combined Phase 29 audit after frontend build,
  so regular check/test/release gates cover generated cleanup boundaries,
  organization drift, schema relationship coverage, and Docker cleanup
  guardrails through one maintained command.
- The Phase 29 audit now writes `ops/docs/reference/PHASE29-AUDIT.json` as a
  machine-readable result, including check status, duration, command, and
  report outputs.
- `npm.cmd --prefix ops run phase29:audit:repeat` now executes the three-pass
  non-mutating sweep loop. Latest run completed 3 cycles and 12 checks with 0
  failures.
- Repeat audit now compares generated-bulk cleanup candidate bytes, protected
  bytes, ignore gaps, cleanup coverage gaps, threshold state, and organization
  file/wrapper counts across cycles. The latest repeat run reported stable
  structured fields with no drift.
- `npm.cmd --prefix ops run prune-storage` later kept the newest local report
  and backup sets, ran the R2 retention path, and found no remote backup objects
  to delete under the newest-package policy.

## Preserved

- `business-os-data/uploads`
- `ops/runtime/secrets`
- runtime `.env` files
- `ops/runtime/docker-release/docker-release.env`
- newest three Docker-release backup packages
- `frontend/public/scanbot-web-sdk`
- all tracked source files
- Docker volumes and the current `business-os` release image tags

## Follow-Up

- Keep running `npm.cmd --prefix ops run prune-storage` before heavy live-test
  loops.
- The implementation lives at
  `ops/scripts/runtime/storage/prune-storage.mjs`; the old root runtime storage
  wrapper was deleted after commands and tests moved to the grouped
  implementation.
- Cloudflare/R2 runtime helpers live under
  `ops/scripts/runtime/cloudflare/`; the old root-level runtime helper paths are
  compatibility wrappers for older commands.
- Full-app and deep-live audit helpers live under
  `ops/scripts/runtime/audits/`; the old root-level runtime audit files are
  compatibility wrappers or re-export modules for older imports.
- Public URL, route-contract, and live smoke probes live under
  `ops/scripts/runtime/smoke/`; old root-level smoke script paths are
  compatibility wrappers.
- Ops verification implementations live under `ops/scripts/verification/`; old
  root-level `ops/scripts/verify-*.js` paths are compatibility wrappers.
- Documentation/reference generator implementations live under
  `ops/scripts/docs/`; old root-level generator script wrappers were removed
  after generated headers and inventories stopped advertising them.
- Deleted obsolete tracked helper `ops/scripts/sync-firebase-release-env.ps1`
  after reference scan proof showed no first-party callers remained.
- Organization audit now lists intentional compatibility wrappers and broken
  wrapper targets so cleanup can keep stable old commands without hiding drift.
- Organization audit now fails the command when a compatibility wrapper target
  is missing, after writing the report and printing every broken wrapper
  mapping.
- Organization audit now separates active wrapper references from generated
  reference mentions. Latest scan: 22 wrappers, zero broken targets, and 17
  wrappers with no active first-party callers; those can be considered for a
  later safe deletion slice after generated references are refreshed.
- Deleted those 17 generated-reference-only compatibility wrappers after
  confirming there were no active first-party callers. Grouped implementations
  remain in the owned runtime and verification folders. Tracked source
  duplicate/compatibility code removed: 180,586 bytes. Generated references were
  refreshed afterward; latest organization audit reports 5 remaining wrappers,
  zero broken targets, and zero wrapper-removal candidates.
- Wrapper reference scanning now includes backend and frontend tests after
  backend verification caught stale test references to deleted wrapper paths.
- Deleted `ops/scripts/runtime/audit-auth.ts` after live-check imports were
  rewired to `ops/scripts/runtime/audits/audit-auth.ts` and the organization
  audit reported zero active references to the wrapper.
- Deleted the old root runtime storage cleanup wrapper after `ops/package.json`,
  full automation, and backend retention tests used the grouped
  `ops/scripts/runtime/storage/prune-storage.mjs` implementation directly.
- Deleted the three old root documentation generator wrappers after the
  generator stopped advertising them and the reference inventory stopped
  including them as source files.
- Consolidated duplicate documentation scan helper logic by moving full-project
  documentation generation onto the shared `ops/scripts/lib/fs-utils.js`
  traversal, read, JSON, line-count, root-file, and text-detection helpers.
- Consolidated the function/reference documentation generator onto the same
  shared filesystem helper library, removing its second local recursive file
  walker, root file collector, path formatter, UTF-8 reader, and JSON reader.
- Consolidated the Phase 8.4 Playwright live-check JSON reader into
  `ops/scripts/runtime/live-checks/live-check-utils.mjs`, removing repeated
  timeout/fetch/JSON helper code from the route-specific action-check scripts.
- Hardened the public Cloudflare portal live check so it records and asserts
  the main response CSP header, verifies no report-only CSP header is present,
  and only filters browser report-only CSP console chatter after the concrete
  page, API, product-rendering, CSP, and page-error checks are clean.
- Consolidated repeated Phase 8.4 live-check console filtering, observed
  response status lookup, guarded read waits, and top-modal closing into
  `ops/scripts/runtime/live-checks/live-check-utils.mjs`.
- Consolidated local Phase 8.4 live-check console/page-error event wiring into
  `attachConsoleCollector`; the public Cloudflare portal check keeps its
  custom all-console capture for CSP diagnostics.
- Docker-release backup naming support is now handled by the standard backup
  retention path: timestamped folders like `20260509-065427` are recognized only
  under `ops/runtime/docker-release/backups`.
- Move 170 is a code-path cleanup rather than file deletion: schema audit
  primary-key fallback logic now uses one parsed ALTER TABLE map instead of
  rebuilding and running a table-specific full-DDL regex for every table.
- Move 171 is a data-path cleanup rather than file deletion: import-job list
  permission filtering now happens in the SQL-backed service query instead of
  fetching, decorating, and discarding rows at the route layer.
- Move 172 is verification-code cleanup rather than file deletion: backup
  reliability source checks now run through a manifest and grouped needle
  loops, replacing the repeated one-off assertion chain.
- Move 173 is workflow cleanup rather than file deletion: canonical schema DDL
  is now excluded from the generic language/runtime queue and kept under the
  stricter schema migration protocol.
- Move 174 is request-path cleanup rather than file deletion: RFID stock apply
  now reuses prepared statements across confirmed product rows instead of
  preparing product, stock, movement, and session update statements inside the
  loop.
- Move 175 is route-level duplication cleanup rather than file deletion: portal
  catalog image, branch-stock, gallery, and highlight payload assembly now uses
  shared route-local helpers for both full and paged catalog responses.
- Move 176 is loop cleanup rather than file deletion: image-only product bulk
  import now builds one product-name lookup map before the image loop instead
  of scanning all active products for every uploaded image.
- Move 177 is request-path cleanup rather than file deletion: sale creation now
  reuses prepared inventory-movement and timestamp-update statements across
  sold item allocations in one transaction.
- Move 178 is system-route loop cleanup rather than file deletion:
  `writeSystemSettings()` now reuses a prepared settings delete statement for
  null-valued entries instead of preparing the same DELETE inside the loop.
- Move 179 is audit-queue cleanup rather than file deletion:
  `ops/scripts/architecture/language-runtime-audit.mjs` now rejects itself from
  the SQL/DuckDB conversion queue, removing a self-referential false positive
  from repeated Phase 29 sweeps while preserving the Node.js audit runner.
- Move 184 is report-regeneration cleanup rather than file deletion:
  `ops/scripts/docs/performance-scan.js` now preserves the bounded Phase 29
  manual-notes block across repeated performance scan regeneration, preventing
  the audit loop from erasing recent cleanup and optimization status.
- Move 185 is repeat-audit guard cleanup rather than file deletion:
  `ops/scripts/architecture/phase29-audit.mjs` now compares the preserved
  performance-note fields across repeat cycles so the audit catches future
  generated-report note loss as drift.
- Move 186 is scan-workflow cleanup rather than file deletion:
  `ops/scripts/docs/performance-scan.js` now uses bounded parallel source
  reads and chunk stats instead of sequential synchronous file reads, reducing
  repeated Phase 29 audit overhead without deleting or moving source files.
- Move 187 is duplicate-loop cleanup rather than file deletion:
  `ops/scripts/lib/fs-utils.js` now owns the bounded `mapLimit()` worker helper
  used by generated-bulk, organization, and performance scan scripts, removing
  local duplicate worker-loop implementations.
- Move 188 is duplicate-path-helper cleanup rather than file deletion:
  architecture audit scripts now reuse `toPosix` from
  `ops/scripts/lib/fs-utils.js` as their path normalizer instead of carrying
  local `normalizePath` implementations.
- Move 189 is audit-read-loop cleanup rather than file deletion:
  `language-runtime-audit.mjs` now reads scanned source files through the
  shared bounded worker helper instead of an unbounded `Promise.all(files.map)`
  pass.
- Move 190 is audit-helper cleanup rather than file deletion:
  `organization-audit.mjs`, `language-runtime-audit.mjs`, and
  `phase29-audit.mjs` now reuse the shared `pathExists()` helper from
  `ops/scripts/lib/fs-utils.js` instead of maintaining local `fs.access()`
  wrappers.
- Move 191 is generated-bulk scan cleanup rather than file deletion:
  `generated-bulk-audit.mjs` now measures cleanup targets with bounded
  concurrency, keeping large generated/runtime folder scans from launching every
  target measurement at once.
- Move 192 is organization-scan cleanup rather than file deletion:
  `organization-audit.mjs` now bounds scan-root walking and root-config checks
  with shared `mapLimit()` workers, keeping repeated folder inventory sweeps
  resource-friendly.
- Move 193 is language/runtime scan cleanup rather than file deletion:
  `language-runtime-audit.mjs` now bounds scan-root discovery and proof-matrix
  existence checks with shared `mapLimit()` workers, keeping repeated language
  and conversion-readiness sweeps from launching broad unbounded path checks.
- Move 194 is Phase 29 orchestration cleanup rather than file deletion:
  `phase29-audit.mjs` now bounds independent child-check fan-out with shared
  `mapLimit()` workers, reducing repeated audit resource spikes while
  preserving the reference-writers-first ordering.
- Move 195 is report-helper cleanup rather than file deletion:
  architecture audits now share report formatting through
  `ops/scripts/lib/report-utils.js`, removing local duplicate `markdownTable()`
  implementations from the repeated audit scripts.
- Move 196 is report-helper cleanup rather than file deletion:
  generated-bulk byte-size formatting now uses shared `formatBytes()` from
  `ops/scripts/lib/report-utils.js` instead of a local duplicate.
- Move 197 is filesystem-helper cleanup rather than file deletion:
  generated-bulk policy and ignore-file reads now use shared async read helpers
  from `ops/scripts/lib/fs-utils.js` instead of local wrappers.
- Move 198 is verification-helper cleanup rather than file deletion:
  hardening policy verification now uses shared synchronous read helpers from
  `ops/scripts/lib/fs-utils.js` instead of local JSON/text wrappers, and the
  policy now references the grouped Cloudflare verifier paths while allowing
  non-ignored pending source files during safe move verification.
- Move 199 is runtime-report helper cleanup rather than file deletion:
  runtime audit HTML now uses shared `formatBytes()` from
  `ops/scripts/lib/report-utils.js` instead of a local duplicate.
- Move 200 is verification-helper cleanup rather than file deletion:
  runtime dependency verification now uses shared `readJson()` from
  `ops/scripts/lib/fs-utils.js` instead of a local JSON reader.
- Move 201 is frontend-verifier helper cleanup rather than file deletion:
  UI verification now uses shared `readJson()` and `readUtf8()` helpers from
  `ops/scripts/lib/fs-utils.js` instead of local file readers.
- Move 202 is architecture-audit helper cleanup rather than file deletion:
  language/runtime audit manifest reads now use shared `readJsonAsync()` from
  `ops/scripts/lib/fs-utils.js` instead of a local async JSON helper.
- Move 203 is Cloudflare-verifier helper cleanup rather than file deletion:
  Cloudflare automation policy, token, and allowed-email reads now use shared
  filesystem helpers instead of local JSON/text wrappers.
- Move 204 is backup-verifier helper cleanup rather than file deletion:
  backup reliability source reads now use shared `readUtf8()` instead of a
  local root-relative `fs.readFileSync()` wrapper.
- Move 205 is Docker-release verifier helper cleanup rather than file deletion:
  Docker release guardrail source/config reads now use shared `readUtf8()`
  instead of a local tolerant file-read wrapper.
- Move 206 is secret-hygiene verifier helper cleanup rather than file deletion:
  tracked source reads now use shared `readUtf8()` after the existing size guard
  instead of a direct `fs.readFileSync()` call.
- Move 207 is scale-service verifier helper cleanup and Phase 29 closure:
  scale Compose reads now use shared `readUtf8()` after the existing
  file-existence check. Phase 29 cleanup and optimization work is closed with
  generated references as evidence; remaining source deletion or folder/schema
  rewires stay gated by reference proof and tests.
- Move 247 is test-data residue cleanup:
  `cleanup-test-data.mjs` broadened the generated verification selector from
  only `QA Audit` to `QA Audit`, `QA Smoke`, and `QA Action History`, including
  generated smoke import folders. The live cleanup pass removed old smoke
  residue from sale/return/import/action-history paths and the follow-up
  postchecks reported zero remaining QA/smoke/action-history matches.
- Move 248 is storage-retention safety cleanup:
  `prune-storage.mjs` now refuses preview-named reports without `--dry-run`,
  and `prune-storage:preview` gives operators a non-mutating retention review
  command. A retention apply pass reclaimed old generated runtime report bulk
  while preserving backups, uploads, secrets, and business data.
- Move 249 is cleanup guardrail wiring:
  Docker release verification now exposes `previewScriptDryRun` and
  `previewNameRequiresDryRun`, so Phase 29 repeat can catch a stale preview
  command or a low-level prune safety regression.
- Move 250 is lookup-residue cleanup:
  new live-smoke products and imported smoke CSV rows use the unique `QA Smoke`
  prefix for category and brand metadata, and `cleanup-test-data.mjs` now counts
  and removes empty QA-prefixed category/unit lookup rows. This keeps future
  smoke/import checks from leaving hidden lookup residue after product cleanup.
- Move 251 is action-history verifier cleanup hardening:
  the standalone undo/redo live verifier now runs an immediate dry-run
  `--fail-on-match` postcheck for its own `QA Action History` prefix after
  apply cleanup. It writes a latest cleanup-postcheck report so interrupted or
  partial undo/redo cleanup is visible before broader automation continues.
- Move 252 is relationship cleanup evidence:
  comprehensive backend integrity now writes a non-mutating JSON report for FK
  candidate orphan checks. The latest live report records cleanup backlog rather
  than deleting data: 22 over-return sale/product pairs, 700 product-batch
  product orphans, 4 branch-batch branch orphans, 22 return-item product
  orphans, 4 inventory-movement branch orphans, and 20 stock-transfer product
  orphans. These are cleanup/relink decisions, not safe automatic deletion.
- Move 253 is bounded cleanup sample evidence:
  the comprehensive integrity report now includes capped samples for
  over-return rows and each relationship orphan bucket. This gives future
  cleanup/relink work representative row shapes without dumping whole business
  tables or deleting imported history.
- Move 254 is cleanup backlog classification:
  comprehensive integrity now reports generated-like versus unclassified counts
  for cleanup buckets. Current live data is generated-like for the over-return,
  branch-batch, return-item, inventory-movement, and stock-transfer buckets, but
  product-batch product orphans remain mixed with 397 unclassified rows, so they
  stay blocked on explicit relink/archive policy.
- Move 255 is exact cleanup-candidate evidence:
  comprehensive integrity now includes bounded `candidateIds` for generated-like
  and unclassified rows in every cleanup bucket. This creates reviewable row
  handles for future rehearsed cleanup without broad table dumps or mutation.
- Move 256 is guarded cleanup execution wiring:
  `ops/scripts/runtime/storage/cleanup-integrity-backlog.mjs` previews or
  applies cleanup for generated-like integrity residue only. The preview before
  backup/start saw generated-like candidates, a Docker-compatible backup was
  created at `ops/runtime/docker-release/backups/20260521-053131`, and the
  later apply deleted zero rows because the active release database no longer
  had orphan/over-return backlog. The post-clean comprehensive integrity report
  passed with zero relationship orphan rows and zero cleanup classifications.
  The cleanup rule remains: no unclassified imported business history is deleted
  automatically.
- Move 257 is live generated-QA cleanup execution:
  after creating the backup package, the broad QA cleanup apply removed the
  remaining generated verification rows from the active release database. The
  delete report is in
  `ops/runtime/reports/cleanup-test-data-all-qa-apply-latest.json`; it removed
  8 products, 14 batches, 8 branch-stock rows, 2 sales, 2 returns, 17 inventory
  movements, 2 import jobs, 6 action-history rows, 3 audit-log rows, and the
  related allocation/lookup residue. Broad QA, `QA Smoke`, and
  `QA Action History` dry-run postchecks now show zero matches. Current live
  business-table counts for products, sales, returns, batches, branch stock,
  movements, and transfers are zero, so the next production step is restore or
  re-import from a verified business source rather than further cleanup.
- Move 258 is empty-dataset visibility:
  comprehensive integrity reports now include `datasetSummary` with core table
  counts and an `empty`/`loaded` status. The latest report marks the active
  runtime as `empty` for transactional business data after generated QA cleanup,
  while keeping action-history and audit-log counts visible.
- Move 259 is standalone readiness gating:
  `ops/scripts/runtime/storage/dataset-readiness.mjs` writes the same core
  table-count signal to `ops/runtime/reports/dataset-readiness-latest.json`.
  The normal command is informational; `dataset-readiness:loaded` uses
  `--fail-if-empty` and currently fails as expected because the cleaned runtime
  has no transactional business rows.
- Move 260 is restore-candidate discovery:
  `ops/scripts/runtime/storage/restore-candidates.mjs` scans local backup roots
  without mutating Docker or Postgres. It validates `manifest.json`,
  `postgres.sql`, and `objects-manifest.jsonl`, counts key business-table rows
  from SQL COPY blocks, and recommends the largest valid loaded package. The
  current recommended restore candidate is
  `ops/runtime/docker-release/backups/20260509-065427` with 22,050 business
  rows. The newest backup `20260521-053131` remains visible but is only a small
  QA cleanup-era package with 55 business rows.
- Move 261 is restore rehearsal:
  `ops/scripts/runtime/storage/restore-rehearsal.mjs` restored the recommended
  `20260509-065427` package into a temporary Postgres database, compared restored
  counts to SQL COPY counts, and dropped the temp database. Products `5559`,
  product batches `6226`, branch stock `5574`, sales `111`, sale items `112`,
  returns `103`, return items `103`, inventory movements `4163`, and stock
  transfers `99` all matched exactly.
- Move 262 is live restore plus post-restore cleanup:
  before restoring, a safety backup was created at
  `ops/runtime/docker-release/backups/20260521-060128`. The rehearsed
  `20260509-065427` package was then restored into the live Docker runtime. The
  app initially failed because release metadata referenced an unavailable old
  image and the restored database role password no longer matched the current
  runtime environment. The image pointer was updated to the local
  `business-os:v6.0.0-202605151537` image, the role password was repaired
  without logging the secret, and the containers restarted healthy. Cleanup then
  removed 2,368 restored QA rows, plus 397 detached high-id product batches and
  606 dependent branch-batch stock rows. Postchecks now show zero broad QA,
  `QA Smoke`, `QA Action History`, and generated-integrity matches. The active
  dataset is loaded with 5,539 products, 5,491 batches, 5,539 branch-stock rows,
  29 sales, 29 sale items, and 3,941 inventory movements, and comprehensive
  integrity passes.
- Move 263 is release/runtime convergence:
  a new Docker image, `business-os:v6.0.0-202605210625`, was built from the
  current source and started successfully. This removed stale packaged behavior
  from the May 15 image while preserving the restored Postgres dataset. The
  final broad UI live check passed all exercised buttons/actions/loaders,
  including the sales export preview that had failed on the stale image. The
  public Cloudflare portal check passed with the copied upload assets resolving
  as HTTP 200, and the latest dataset-readiness gate remains `loaded`.
- Move 264 is generated release-kit cleanup:
  after the rebuilt image was verified live, the ignored/regenerable `release`
  folder was deleted to keep Phase 29 cleanup candidates below policy. Bytes
  removed: 378,813,449. The live Docker image, restored Postgres volume, local
  uploads, latest backups, and runtime secrets were preserved.
- Move 265 is the reusable post-live hygiene gate:
  `npm.cmd --prefix ops run live-hygiene:check` now runs the broad QA,
  `QA Smoke`, and `QA Action History` residue postchecks, fails if generated
  integrity cleanup still matches rows, requires the dataset to be `loaded`,
  and runs comprehensive backend integrity by default. Future broad UI, smoke,
  public portal, and undo/redo test sessions should finish with this one gate.
- Move 266 is the ordered live-suite wrapper:
  `npm.cmd --prefix ops run phase84:live-suite` runs the broad UI check, public
  Cloudflare portal check, and post-live hygiene gate in sequence. The default
  suite records the intended cleanup-safe workflow, while skip flags allow a
  focused rerun without changing the underlying checks.
- Move 267 keeps that suite readable:
  successful child steps now store report paths and compact summaries instead
  of large nested stdout blocks. Green hygiene runs show the loaded dataset
  state and generated-integrity match count directly.
- Move 268 adds generated-bulk disposition totals:
  cleanup evidence now rolls up measured bytes, files, folders, and target
  counts by disposition. This makes it clear which bulk is preserved business
  data, retention-managed runtime state, reinstallable dependencies,
  regenerable build output, or safe cleanup material.
- Move 269 promotes schema primary-key gaps:
  `SCHEMA-AUDIT.md` now has an explicit primary-key gap section, and the JSON
  summary exposes the gap count/tables/details for Phase 29 repeat checks.
  Current gaps are `import_jobs` and `settings`; they are tracked as migration
  candidates, not cleanup/deletion targets.
- Move 270 adds the read-only PK preflight:
  `schema-pk-preflight` checks `import_jobs.id` and `settings.key` for nulls,
  duplicate groups, current PK state, and unique indexes before any DDL is
  attempted. The latest runtime report shows both tables are data-ready, but
  migration remains gated by backup, rollback SQL, tests, and restore rehearsal.
- Move 272 removes the regenerated Docker release kit after live verification:
  the current source was rebuilt into `business-os:v6.0.0-202605211016`,
  restarted, and verified by the full Phase 8.4 live suite plus public
  Cloudflare portal and post-live hygiene checks. After confirming the image was
  running, the ignored/regenerable `release` folder was deleted again. Bytes
  removed: 378,824,942. Docker image layers, Postgres/Redis volumes, uploads,
  runtime secrets, and local backup packages were preserved.
- Move 273 preserves data before schema hardening and cleans generated output:
  a Docker-compatible backup was created at
  `ops/runtime/docker-release/backups/20260521-103142` before applying primary
  keys to `import_jobs.id` and `settings.key`. After the rebuilt runtime passed
  strict preflight and the full Phase 8.4 live suite, the regenerated
  `release` folder was deleted again. Bytes removed: 378,824,942. The backup,
  Docker image, Postgres/Redis volumes, uploads, runtime secrets, and retained
  R2/local backup packages were preserved.
- Move 274 applies retention after the fresh loaded backup:
  `prune-storage` kept `20260521-103142`, `20260521-060128`, and
  `20260521-053131`, then removed old local package `20260509-065427`. It also
  pruned two older Phase 8.4 report folders. Local backup/report bytes removed:
  5,971,653. R2 kept the latest remote package and had no stale objects to
  delete. Docker-safe prune reclaimed 2.503 GB of builder cache while preserving
  images, volumes, uploads, secrets, and retained backups.
- Move 276 removes the regenerated release kit after catalog-bundle deploy:
  `business-os:v6.0.0-202605211053` was verified by the full Phase 8.4 live
  suite, public Cloudflare portal check, and post-live hygiene gate. The
  ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,825,966. Running image, volumes, uploads, secrets, and retained backups
  were preserved.
- Move 277 is a no-deletion performance cleanup:
  the frontend settings loader no longer performs a redundant
  `/api/settings/meta` request because `/api/settings` already returns
  `updatedAt`. This reduces repeated bootstrap/refresh work without touching
  source organization, business data, uploads, secrets, backups, volumes, or
  generated cleanup targets.
- Move 278 removes the regenerated release kit after settings-waterfall deploy:
  `business-os:v6.0.0-202605211116` was verified by the full Phase 8.4 live
  suite, public Cloudflare portal check, and post-live hygiene gate. The
  ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,825,966. Running image, volumes, uploads, secrets, and retained backups
  were preserved.
- Move 279 applies the regular retention policy after that deploy:
  four older Phase 8.4 report folders were pruned for 702,494 local bytes. R2
  kept the latest remote backup package and deleted no stale objects. Docker
  cleanup reclaimed 2.754 GB of builder cache while leaving images, volumes,
  uploads, secrets, and retained backups untouched.
- Move 281 removes the regenerated release kit after backend-cache deploy:
  `business-os:v6.0.0-202605211130` was verified by the full Phase 8.4 live
  suite, public Cloudflare portal check, and post-live hygiene gate. The
  ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,825,966. Running image, volumes, uploads, secrets, and retained backups
  were preserved.
- Move 282 applies the regular retention policy after that deploy:
  two older Phase 8.4 report folders were pruned for 362,565 local bytes. R2
  kept the latest remote backup package and deleted no stale objects. Docker
  cleanup reclaimed 2.503 GB of builder cache while leaving images, volumes,
  uploads, secrets, and retained backups untouched.
- Move 284 removes the regenerated release kit after the additional
  metadata-cache deploy:
  `business-os:v6.0.0-202605211148` was verified by the full Phase 8.4 live
  suite, public Cloudflare portal check, and post-live hygiene gate. The
  ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,825,966. Running image, volumes, uploads, secrets, and retained backups
  were preserved.
- Move 285 applies the regular retention policy after that deploy:
  two older Phase 8.4 report folders were pruned for 450,818 local bytes. R2
  kept the latest remote backup package and deleted no stale objects. Docker
  cleanup reclaimed 2.503 GB of builder cache while leaving images, volumes,
  uploads, secrets, and retained backups untouched.
- Move 309 removes the regenerated release kit after the product-history
  indexing deploy:
  `business-os:v6.0.0-202605212046` was verified by local health
  (`frontend.hash` `fa530d31a2b66e16`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,830,883. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 310 removes the regenerated release kit after the inventory-transfer
  indexing deploy:
  `business-os:v6.0.0-202605212100` was verified by local health
  (`frontend.hash` `2b81b234c068e391`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,830,371. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 311 removes the regenerated release kit after the inventory return-stat
  loop cleanup deploy:
  `business-os:v6.0.0-202605212111` was verified by local health
  (`frontend.hash` `f303212d6278ce34`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,827,299. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 312 removes the regenerated release kit after the inventory adjustment
  branch-stock indexing deploy:
  `business-os:v6.0.0-202605212121` was verified by local health
  (`frontend.hash` `58c00cd31a7c07f3`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,832,419. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 313 removes the regenerated release kit after the Inventory visible-stat
  accumulator deploy:
  `business-os:v6.0.0-202605212132` was verified by local health
  (`frontend.hash` `c9c3c15773b7cda2`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,831,395. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 314 removes the regenerated release kit after the backend active-branch
  index deploy:
  `business-os:v6.0.0-202605212142` was verified by local health
  (`frontend.hash` `c9c3c15773b7cda2`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,829,859. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 315 removes the regenerated release kit after the product-import branch
  index deploy:
  `business-os:v6.0.0-202605212159` was verified by local health
  (`frontend.hash` `c9c3c15773b7cda2`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,830,371. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 316 removes the regenerated release kit after the bulk product-import
  conflict-summary accumulator deploy:
  `business-os:v6.0.0-202605212213` was verified by local health
  (`frontend.hash` `5491c62d8618068f`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,829,859. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 317 removes the regenerated release kit after the Inventory visible-ID
  selection deploy:
  `business-os:v6.0.0-202605212223` was verified by local health
  (`frontend.hash` `c3c33e2a0a058c67`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,828,835. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 318 removes the regenerated release kit after the Inventory
  selection-scope normalization deploy:
  `business-os:v6.0.0-202605220423` was verified by local health
  (`frontend.hash` `7e0eccda420138a6`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,830,883. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 319 removes the regenerated release kit after the Inventory active-filter
  count allocation deploy:
  `business-os:v6.0.0-202605220432` was verified by local health
  (`frontend.hash` `73cb2a03c79f7dc4`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,830,883. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 320 removes the regenerated release kit after the Inventory selection
  helper reuse deploy:
  `business-os:v6.0.0-202605220445` was verified by local health
  (`frontend.hash` `d96661cc55cac960`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,831,907. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 321 removes the regenerated release kit after the Inventory
  destination-selector option-renderer deploy:
  `business-os:v6.0.0-202605220501` was verified by local health
  (`frontend.hash` `f6dbafd6af3271f1`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,831,907. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 322 hardens the public Cloudflare portal CSP check after an intermittent
  Cloudflare Page Shield script-monitor report-only header blocked the first
  live-suite attempt. The source change is in the local ops checker and does
  not require a new runtime image; the already-built
  `business-os:v6.0.0-202605220501` release passed the rerun live suite before
  the generated release kit was deleted.
- Move 323 removes the regenerated release kit after the Sales selection and
  filter-count helper deploy:
  `business-os:v6.0.0-202605220519` was verified by local health
  (`frontend.hash` `063b68bf77b348d2`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,831,772. Running image,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 324 removes the regenerated release kit after the Returns selection and
  single-pass stats deploy:
  `business-os:v6.0.0-202605220531` was verified by local health
  (`frontend.hash` `751161b640a9b535`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,830,748. `prune-storage`
  also removed 12,745,798 bytes of old runtime reports, compacted 3,790 bytes
  of runtime logs, and reclaimed about 10.09 GB of Docker builder cache while
  preserving running images, Postgres/Redis volumes, uploads, runtime secrets,
  retained backup packages, and the latest R2 mirror package.
- Move 325 removes the regenerated release kit after the Audit Log selection
  helper deploy and Docker release-kit parent-directory hardening:
  the first release attempt built image `business-os:v6.0.0-202605221301` but
  failed while copying `ops\docker\compose.release.yml` into a missing generated
  kit parent directory. `docker-release.ps1` now uses
  `Copy-FileEnsuringParent()`, and the Docker release verifier guards that
  copy path. The rerun built `business-os:v6.0.0-202605221311`, verified local
  health (`frontend.hash` `1aca0755a45fa843`), the full Phase 8.4 live suite,
  public Cloudflare portal check, and post-live hygiene gate. The
  ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,831,892. `prune-storage` also removed 463,546 bytes of old runtime
  reports and reclaimed about 2.541 GB of Docker builder cache while preserving
  running images, Postgres/Redis volumes, uploads, runtime secrets, retained
  backup packages, and the latest R2 mirror package.
- Move 326 removes the regenerated release kit after the Contacts
  bulk-selection helper deploy and Docker release-kit replacement hardening:
  the first release rerun built `business-os:v6.0.0-202605221336` but Windows
  intermittently refused to remove the non-empty generated
  `release\business-os\run\docker` directory before rewriting the kit.
  `docker-release.ps1` now removes generated release directories through a
  release-root-guarded retry helper, and the Docker release verifier guards
  that path. The rerun built `business-os:v6.0.0-202605221346`, verified local
  health (`frontend.hash` `b187417af1957467`), the full Phase 8.4 live suite,
  public Cloudflare portal check, and post-live hygiene gate. The
  ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,832,645. `prune-storage` also removed 463,121 bytes of old runtime
  reports and reclaimed about 2.541 GB of Docker builder cache while preserving
  running images, Postgres/Redis volumes, uploads, runtime secrets, retained
  backup packages, and the latest R2 mirror package.
- Move 327 removes the regenerated release kit after the POS filter-panel
  active-count deploy:
  `business-os:v6.0.0-202605221357` was verified by local health
  (`frontend.hash` `4886bf621dee0a67`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,833,157.
  `prune-storage` also removed 493,543 bytes of old runtime reports and
  reclaimed about 2.505 GB of Docker builder cache while preserving running
  images, Postgres/Redis volumes, uploads, runtime secrets, retained backup
  packages, and the latest R2 mirror package.
- Move 328 removes the regenerated release kit after the shared client API
  query-string helper deploy and Docker release temp-tar cleanup hardening:
  the first release attempt timed out before a visible kit was left behind, and
  the next release built `business-os:v6.0.0-202605221449` but hit a Windows
  file-lock race while removing a generated `.tmp-business-os-image.tar*` file.
  `docker-release.ps1` now retries child-file removal before final directory
  removal, and the Docker release verifier guards that retry policy. The rerun
  built `business-os:v6.0.0-202605221451`, verified local health
  (`frontend.hash` `91dd734d23af8946`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,833,345.
  `prune-storage` found no stale reports, backups, R2 objects, stopped
  containers, or builder cache to remove, while preserving running images,
  Postgres/Redis volumes, uploads, runtime secrets, retained backup packages,
  and the latest R2 mirror package.
- Move 329 removes the regenerated release kit after the shared client API
  query-path helper deploy:
  `business-os:v6.0.0-202605221508` was verified by local health
  (`frontend.hash` `fc2071c92dda9e91`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,832,321.
  `prune-storage` also removed 463,168 bytes of old runtime reports and
  reclaimed about 2.505 GB of Docker builder cache while preserving running
  images, Postgres/Redis volumes, uploads, runtime secrets, retained backup
  packages, and the latest R2 mirror package.
- Move 330 removes the regenerated release kit after the single-pass product ID
  normalization deploy:
  `business-os:v6.0.0-202605221539` was verified by local health
  (`frontend.hash` `64cbdcafff51e14f`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. The ignored/regenerable
  `release` folder was then deleted. Bytes removed: 378,833,345.
  `prune-storage` also removed 463,269 bytes of old runtime reports and
  reclaimed about 2.505 GB of Docker builder cache while preserving running
  images, Postgres/Redis volumes, uploads, runtime secrets, retained backup
  packages, and the latest R2 mirror package.
- Move 331 removes the regenerated release kit after the actor-query/cache
  cleanup helper deploy:
  `business-os:v6.0.0-202605222034` was verified by local health
  (`frontend.hash` `9e6d70ad6ccec2ed`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. Live reports:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-22T12-55-38-783Z/report.json`
  and
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-22T12-58-36-136Z/report.json`.
  The ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,836,417. `prune-storage` also removed 463,217 bytes of old runtime
  reports and reclaimed about 2.505 GB of Docker builder cache while preserving
  running images, Postgres/Redis volumes, uploads, runtime secrets, retained
  backup packages, and the latest R2 mirror package.
- Move 332 removes the regenerated release kit after the local mirror
  table-cleanup loop deploy:
  `business-os:v6.0.0-202605222104` was verified by local health
  (`frontend.hash` `fe43651279ece53a`), the full Phase 8.4 live suite, public
  Cloudflare portal check, and post-live hygiene gate. Live reports:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-22T13-25-24-841Z/report.json`
  and
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-22T13-28-18-382Z/report.json`.
  The ignored/regenerable `release` folder was then deleted. Bytes removed:
  378,833,857. `prune-storage` also removed 463,200 bytes of old runtime
  reports and reclaimed about 2.505 GB of Docker builder cache while preserving
  running images, Postgres/Redis volumes, uploads, runtime secrets, retained
  backup packages, and the latest R2 mirror package.
- Move 333 is a documentation-only Rust rewrite assessment:
  no generated release kit was produced and no runtime/generated files were
  deleted. The assessment explicitly defers a full Rust rewrite until benchmark,
  packaging, rollback, and data-safety proof exists for a narrow module.
- Move 334 is a UI/runtime cleanup slice:
  page information was moved to title hover text on Branches, Audit Log,
  Receipt Settings, Backup, Settings, Library, and Sync Server, and the visible
  info buttons/description rows were removed. Docker release worker defaults
  were reduced to one import worker and one media worker; the local release env
  was updated and Compose removed the extra managed worker containers on
  restart. No business data, uploads, secrets, Postgres/Redis volumes, or
  retained backup packages were deleted.
- Move 334 postcheck storage prune removed nine old Phase 8.4 report folders
  and one older Khmer recovery report, freeing 4,782,048 local bytes. Remote R2
  retention kept the latest package (`datasync-2026-05-26T03-13-03-348Z`) and
  deleted no remote objects. Docker cleanup removed no running/stopped
  containers and reclaimed about 21.13 GB of builder cache while preserving
  images, volumes, uploads, runtime secrets, and retained backup packages.
- The first Move 334 Phase 29 repeat gate caught generated cleanup candidates
  above the 512 MB policy threshold because the regenerated `release` kit was
  present after the Docker rebuild. The ignored/regenerable `release` folder was
  deleted after an absolute-path safety check. Bytes removed: 378,835,701.
- Move 335 removes the regenerated release kit after the Products/POS
  mid-width layout deploy:
  `business-os:v6.0.0-202605261501` was verified by local health
  (`frontend.hash` `486b71a2a8211b90`), clean Playwright Products/POS checks at
  810 px and 1180 px, public/admin Cloudflare health checks, and `/public`.
  The ignored/regenerable `release` folder was then deleted after an
  absolute-path safety check. Bytes removed: 378,838,897. Running Docker images,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 336 removes the regenerated release kit after the POS mobile-card
  responsive breakpoint deploy:
  `business-os:v6.0.0-202605261656` was verified by local health and focused
  Playwright POS checks at 360, 390, 430, 640, and 760 px widths. The
  ignored/regenerable `release` folder was deleted after an absolute-path
  safety check. Bytes removed: 378,837,873. Running Docker images,
  Postgres/Redis volumes, uploads, runtime secrets, and retained backup
  packages were preserved.
- Move 337 removes obsolete Docker app versions and reproducible builder cache:
  `business-os:v6.0.0-202605261501` and
  `business-os:v6.0.0-202605260636` were removed only after confirming the
  running containers and `business-os:latest` use
  `business-os:v6.0.0-202605261656`. Docker builder cache was pruned, reclaiming
  4.082 GB. `docker system df` after cleanup reports Images 3.057 GB, Build
  Cache 1.518 GB, Containers 35.99 MB, and Local Volumes 431.1 MB. Volumes were
  intentionally preserved because they can contain database/runtime data.
- Source deletions remain deferred until a reference scan and tests prove they
  are safe.
