# Performance Scan

Auto-generated performance scan for source size/complexity and built frontend chunks.

## Latest Manual Note

- Move 893 release `business-os:v6.0.0-202606102330-move893` is live with
  frontend hash `f1e735074a86dda8` and source hash `e5d243e151a194e4`.
- Slow-load watchdogs no longer end real page loading in Products, Inventory,
  Sales, Returns, Branches, Users, Audit Log, or contact tabs. They can show a
  slow-load warning, but the UI does not switch to empty/zero-state rendering
  until the actual request finishes.
- Public portal startup no longer statically imports the admin `app-auth`
  chunk. Vite's generic modulepreload injection is disabled, the virtual
  preload helper is pinned to the neutral `vendor` chunk, and the existing
  route-aware preload plugin remains responsible for page-specific preloads.
- Local Playwright route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-10T13-33-38-974Z.json`:
  Products 409 ms, Inventory 315 ms, Sales 343 ms, Returns 260 ms, Contacts
  276 ms, Branches 368 ms, Users 315 ms, and Audit Log 367 ms, zero failed
  requests/errors.
- Local Playwright LCP trace
  `ops/runtime/reports/lcp-route-trace-2026-06-10T13-33-38-825Z.json`:
  Products 752 ms, Inventory 440 ms, Sales 112 ms, Returns 328 ms, Contacts
  168 ms, Branches 428 ms, Users 352 ms, Audit Log 108 ms, and Public Catalog
  392 ms, zero failed requests/errors.
- Public portal LCP trace
  `ops/runtime/reports/lcp-route-trace-2026-06-10T13-34-15-883Z.json`:
  Public Catalog 2.004 s, zero failed requests/errors, improved from the
  earlier 4.912 s trace and now below the 2.5 s target.
- Public admin traces completed with zero failed requests/errors:
  `ops/runtime/reports/route-load-trace-2026-06-10T13-34-19-457Z.json`
  measured ready at 2.560-4.142 s, and
  `ops/runtime/reports/lcp-route-trace-2026-06-10T13-35-09-532Z.json`
  measured Sales/Contacts/Audit Log near 1 s while Products, Inventory,
  Returns, Branches, and Users remained above target at 3.472-4.836 s.
- The next target is route-specific public-admin above-the-fold payload and
  Cloudflare document/API latency reduction, while keeping the no-fake-loading
  watchdog policy and public portal under 2.5 s.

## 1. Scope

- Frontend source: `frontend/src`
- Backend source: `backend/src`
- Project scripts: `ops/scripts`
- Project root run/config files
- Built chunks: `frontend/dist/assets` (if present)

## 2. Largest Source Files (by size)

| File | Size (KB) | Lines |
|---|---:|---:|
| `frontend/src/lang/km.json` | 246.7 | 2730 |
| `frontend/src/components/inventory/Inventory.tsx` | 159.8 | 3454 |
| `backend/src/services/importJobs.ts` | 157.1 | 3880 |
| `frontend/src/components/catalog/CatalogPage.tsx` | 152.5 | 3498 |
| `frontend/src/lang/en.json` | 134.5 | 2721 |
| `frontend/src/components/products/Products.tsx` | 119.6 | 2589 |
| `frontend/src/components/pos/POS.tsx` | 114.8 | 2362 |
| `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 104.9 | 1555 |
| `backend/src/routes/products.ts` | 101.8 | 2297 |
| `frontend/src/components/products/import/BulkImportModal.tsx` | 101.2 | 2170 |
| `frontend/src/components/dashboard/Dashboard.tsx` | 100.4 | 1958 |
| `frontend/src/components/utils-settings/Settings.tsx` | 88.1 | 1911 |
| `backend/src/routes/inventory.ts` | 86.1 | 1952 |
| `frontend/src/components/utils-settings/Backup.tsx` | 80.1 | 1775 |
| `frontend/src/AppContext.tsx` | 76.0 | 1915 |
| `frontend/src/App.tsx` | 74.4 | 1966 |
| `ops/scripts/architecture/language-runtime-audit.ts` | 71.6 | 1666 |
| `frontend/src/components/users/UserProfileModal.tsx` | 68.2 | 1326 |
| `backend/src/routes/system/index.ts` | 65.6 | 1674 |
| `backend/src/routes/sales.ts` | 65.2 | 1591 |
| `frontend/src/components/catalog/portalLanguagePacks.ts` | 62.5 | 1349 |
| `frontend/src/components/utils-settings/AuditLog.tsx` | 60.5 | 1322 |
| `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` | 59.2 | 1116 |
| `backend/src/services/googleDriveSync/index.ts` | 57.8 | 1564 |
| `frontend/src/components/users/Users.tsx` | 57.5 | 1245 |

## 3. Largest Source Files (by lines)

| File | Lines | Size (KB) |
|---|---:|---:|
| `backend/src/services/importJobs.ts` | 3880 | 157.1 |
| `frontend/src/components/catalog/CatalogPage.tsx` | 3498 | 152.5 |
| `frontend/src/components/inventory/Inventory.tsx` | 3454 | 159.8 |
| `frontend/src/lang/km.json` | 2730 | 246.7 |
| `frontend/src/lang/en.json` | 2721 | 134.5 |
| `frontend/src/components/products/Products.tsx` | 2589 | 119.6 |
| `frontend/src/components/pos/POS.tsx` | 2362 | 114.8 |
| `backend/src/routes/products.ts` | 2297 | 101.8 |
| `frontend/src/components/products/import/BulkImportModal.tsx` | 2170 | 101.2 |
| `frontend/src/App.tsx` | 1966 | 74.4 |
| `frontend/src/components/dashboard/Dashboard.tsx` | 1958 | 100.4 |
| `backend/src/routes/inventory.ts` | 1952 | 86.1 |
| `frontend/src/AppContext.tsx` | 1915 | 76.0 |
| `frontend/src/components/utils-settings/Settings.tsx` | 1911 | 88.1 |
| `frontend/src/components/utils-settings/Backup.tsx` | 1775 | 80.1 |
| `backend/src/routes/system/index.ts` | 1674 | 65.6 |
| `ops/scripts/architecture/language-runtime-audit.ts` | 1666 | 71.6 |
| `backend/src/routes/sales.ts` | 1591 | 65.2 |
| `backend/src/services/googleDriveSync/index.ts` | 1564 | 57.8 |
| `frontend/src/components/catalog/CatalogEditorSurface.tsx` | 1555 | 104.9 |
| `ops/scripts/runtime/audits/deep-live-audit.ts` | 1463 | 55.3 |
| `backend/src/routes/portal.ts` | 1428 | 52.3 |
| `frontend/src/components/catalog/portalLanguagePacks.ts` | 1349 | 62.5 |
| `backend/src/fileAssets.ts` | 1336 | 46.3 |
| `frontend/src/web-api.ts` | 1328 | 52.2 |

## 4. Largest Built Chunks

| Asset | Size (KB) |
|---|---:|
| `frontend/dist/assets/vendor-zxing-BxcS2Ffh.js` | 436.2 |
| `frontend/dist/assets/lang-km-c87vG7oG.js` | 282.5 |
| `frontend/dist/assets/vendor-react-DKmwvaIJ.js` | 207.2 |
| `frontend/dist/assets/lang-en-DND0-37b.js` | 169.8 |
| `frontend/dist/assets/index-CW_jNXiu.css` | 155.4 |
| `frontend/dist/assets/catalog-BslwWpOK.js` | 104.5 |
| `frontend/dist/assets/Products-CVOvHkZb.js` | 85.9 |
| `frontend/dist/assets/Inventory-DMHR7CKq.js` | 83.3 |
| `frontend/dist/assets/catalog-editor-CxwUJJtX.js` | 74.2 |
| `frontend/dist/assets/vendor-dexie-2jmnBxhj.js` | 72.5 |
| `frontend/dist/assets/BulkImportModal-DJl__C-q.js` | 68.0 |
| `frontend/dist/assets/POS-CP00i9F1.js` | 65.0 |
| `frontend/dist/assets/AdminRoot-BmAghdYF.js` | 64.6 |
| `frontend/dist/assets/Dashboard-DctFleqO.js` | 62.6 |
| `frontend/dist/assets/Settings-DFpYlHqj.js` | 54.9 |
| `frontend/dist/assets/portal-language-packs-DGxmKkW_.js` | 52.1 |
| `frontend/dist/assets/Backup-BrIU9QiG.js` | 51.3 |
| `frontend/dist/assets/dashboard-charts-CCbMJTEp.js` | 47.9 |
| `frontend/dist/assets/user-profile-modal-B6eB_Lvd.js` | 43.9 |
| `frontend/dist/assets/ReceiptSettings-IQLkdtyL.js` | 40.3 |
| `frontend/dist/assets/portal-content-i18n-BJnSIXBN.js` | 38.5 |
| `frontend/dist/assets/catalog-secondary-tabs-D1T5rqcX.js` | 37.2 |
| `frontend/dist/assets/Sales-CfcDQDBu.js` | 36.7 |
| `frontend/dist/assets/ProductForm-CCA35wiX.js` | 35.8 |
| `frontend/dist/assets/AuditLog-DRLVtWb8.js` | 35.5 |

## 5. Notes

- Large source files are candidates for modular split by domain responsibility.
- Large JS chunks are candidates for lazy-loading or manual chunk strategy refinement.
- Maintain functional parity first; apply incremental performance changes with build validation.
<!-- phase29-manual-notes:start -->
- Move 873 makes Product and Inventory read transports live-server-first.
  Product search/bootstrap/filter/lookup usage and Inventory search/bootstrap
  now defer cache writes for 10 seconds and lazy-load `api-local-cache` only
  for cache writes or failed live fallbacks. Local production chunk proof
  showed `Products-*` and `Inventory-*` contain no `api-local-cache`,
  `lazyLocalDb`, `queryCache`, or `localMirrors`; `product-read-api` is about
  2.62 kB and `inventory-api` is about 2.14 kB. Docker image
  `business-os:v6.0.0-202606101610-move873` is live with frontend hash
  `291cb07b12cdf13b` and source hash `6d8391289817d4a2`. Public Cloudflare
  Playwright trace
  `ops/runtime/reports/route-load-trace-2026-06-09T20-57-37-630Z.json`
  measured Products 4.762 s, Inventory 3.111 s, POS 4.712 s, Files 3.632 s,
  Branches 3.555 s, and Audit Log 2.781 s with zero failed requests and zero
  page/console errors. Product and Inventory no longer load `api-local-cache`
  in first paint; the next performance target is the live
  `/api/products/search` and `/api/products/bootstrap` path, which dominates
  Product/POS timing.
- Move 872 removes product-only first-paint leakage from Audit Log and
  Library/Files. Generic local fallback/cache helpers (`lazyLocalDb`,
  `localMirrors`, `queryCache`, and `expectedUpdatedAt`) now build into
  `api-local-cache`; `lookupTransport` builds into `lookup-api`;
  `frontend/src/utils/pricing.ts` builds into `app-shared`; and Audit
  Log/Files route preload lists no longer include `product-shared`. Late admin
  route-entry warmup was narrowed to avoid importing the next unrelated page
  during current-page first paint. Local chunk proof showed `AuditLog-*`,
  `FilesPage-*`, and `app-shared-*` contain no `product-shared` or
  `product-read-api`, and the product-read chunk shrank to about 1.56 kB.
  Docker image `business-os:v6.0.0-202606101550-move872` is live with frontend
  hash `1df23f1eac671f2f` and source hash `6d8391289817d4a2`. Cloudflare
  Playwright proof `ops/runtime/reports/route-load-trace-2026-06-09T20-40-13-816Z.json`
  measured Audit Log at 2.440 s ready with zero failures/errors; comparison
  trace `ops/runtime/reports/route-load-trace-2026-06-09T20-41-04-387Z.json`
  measured Products 2.549 s, Inventory 8.367 s, POS 2.664 s, Files 3.381 s,
  and Branches 3.849 s with zero failures/errors. Inventory/Product variance
  remains the next performance target.
- Move 871 gates the admin auth bootstrap preload to authenticated admin
  shells only. This removes anonymous `/login` and public-shell
  `/api/auth/bootstrap` preload noise while preserving one credentialed
  preload for direct authenticated admin visits. Final Docker image
  `business-os:v6.0.0-202606101430-move871` is live with frontend hash
  `69e2e819e937bff6` and source hash `c923862d80ad7213`; startup warmup
  completed with zero failures and 299 HIT targets. Header proof confirmed
  `/branches` and `/audit-log` emit exactly one auth-bootstrap preload, while
  `/login` and `/public` emit none. Cloudflare Playwright trace
  `ops/runtime/reports/route-load-trace-2026-06-09T20-03-59-485Z.json`
  measured Products 2.423 s, Inventory 2.944 s, POS 2.814 s, Files 3.224 s,
  Branches 2.552 s, and Audit Log 3.322 s with zero failures/errors. A
  route-specific data API preload experiment was tested and removed because
  it regressed route-ready timing; the next real bottleneck is the client
  dependency path that still pulls `product-read-api`/language chunks into
  some non-product first paints.
- Move 870 removes the Branches and Audit Log late-chunk waterfalls found by
  the broad admin route sweep. The sweep measured Branches 6.197 s and Audit
  Log 6.012 s; warm focused repeats still measured Branches 3.047 s and Audit
  Log 3.925 s. Branches now preloads `route-sync-utils`,
  `settings-refresh`, `shared-ui`, `shared-lazy-portal-menu`, `app-shared`,
  and `product-shared` alongside its branch/product/action-history chunks.
  Audit Log now preloads `audit-log-api`, `refresh-cw`, `monitor-smartphone`,
  `route-sync-utils`, `settings-refresh`, `shared-ui`,
  `shared-lazy-portal-menu`, `app-shared`, `product-shared`, and `lang-en`.
  Cloudflare startup warmup now includes `/audit-log` and those dependency
  names in the bounded graph filter. Docker image
  `business-os:v6.0.0-202606101345-move870` is live with frontend hash
  `69e2e819e937bff6` and source hash `c30255d0546aaee2`. Startup warmup
  completed with zero failures, 298 HIT, and 1 MISS target. Cloudflare
  Playwright route-load proof:
  `ops/runtime/reports/route-load-trace-2026-06-09T19-35-23-028Z.json`
  measured Branches 1.971 s and Audit Log 2.315 s with zero failures/errors.
  Comparison trace
  `ops/runtime/reports/route-load-trace-2026-06-09T19-35-23-925Z.json`
  measured Dashboard 2.358 s, Branches 2.938 s, Audit Log 1.826 s,
  Receipt Settings 2.264 s, and Loyalty Points 2.069 s.
- Move 869 removes the Users late-chunk waterfall found after the Library
  fix. The previous comparison trace measured Users at 3.739 s ready because
  `user-admin-api`, `user-read-api`, `user-permission-definitions`,
  `shared-action-history`, `shared-formatters`, `shared-modal`,
  `shared-portal-menu`, `shared-lazy-portal-menu`, `route-sync-utils`,
  `app-shared`, and `product-shared` arrived after the `Users` route chunk.
  The backend SPA preload hints now include those first-window dependencies
  for `/users`, and Cloudflare startup warmup includes `/users` plus the
  matching dependency names in its bounded graph filter. Docker image
  `business-os:v6.0.0-202606101330-move869` is live with frontend hash
  `69e2e819e937bff6` and source hash `0eeb7ba4c6f551d5`. Startup warmup
  `ops/runtime/docker-release/cloudflare-startup-warmup.json` completed with
  zero failures, 258 HIT, and 4 MISS targets. Cloudflare Playwright route-load
  proof: `ops/runtime/reports/route-load-trace-2026-06-09T19-23-22-588Z.json`
  measured Users at 2.311 s with zero failures/errors; repeat comparison
  `ops/runtime/reports/route-load-trace-2026-06-09T19-24-07-717Z.json`
  measured Users 2.257 s and Audit Log 2.106 s.
- Move 868 removes the Library/Files late-chunk stall found by the next broad
  live Cloudflare sweep. The failing sample was not an API failure: `/files`
  reached 21.527 s ready while waiting for late-discovered first-screen helper
  chunks. Backend SPA preload hints now include the Library route's direct
  first-window chunk set (`FilesPage`, `file-api`, `ai-api`,
  `multipart-headers-api`, `route-sync-utils`, `settings-refresh`, `shared-ui`,
  `shared-action-history`, `shared-page-header`, `product-shared`, and
  `app-shared`), and Cloudflare startup warmup now includes `/files` plus those
  dependency names in the bounded graph filter. Docker image
  `business-os:v6.0.0-202606101315-move868` is live with frontend hash
  `69e2e819e937bff6` and source hash `a560821a401e12c5`. Startup warmup
  `ops/runtime/docker-release/cloudflare-startup-warmup.json` completed with
  zero failures and 210 HIT targets. Library/Files Playwright route-load proof:
  `ops/runtime/reports/route-load-trace-2026-06-09T19-12-04-740Z.json`
  measured 2.731 s ready with zero failures/errors; repeat
  `ops/runtime/reports/route-load-trace-2026-06-09T19-12-33-074Z.json`
  measured 3.336 s. Direct authenticated `/api/files` was 17 ms local and
  448 ms remote, confirming the remaining variance is Cloudflare/static-asset
  delivery rather than backend query work.
- Move 867 makes remote startup warmup match real route entrypoints instead of
  warming only `/public` and `/`. The backend SPA shell now emits route-specific
  first-window modulepreloads for Products, Inventory, POS, Branches, and public
  catalog child chunks, including `vendor-dexie`, `csv-utils`, `shared-ui`, and
  `shared-lazy-portal-menu`. `warm-cloudflare-startup-assets.ts` now warms
  admin route surfaces (`/`, `/products`, `/inventory`, `/pos`, `/branches`),
  reads HTTP `Link` headers, follows a bounded first-window JS dependency
  graph from fetched chunks, retries transient asset fetches, and warms surfaces
  in parallel. `docker-release.ps1` now waits briefly for the Cloudflare tunnel
  before invoking warmup. Docker image
  `business-os:v6.0.0-202606101245-move867` is live with frontend hash
  `69e2e819e937bff6` and source hash `a6cad3993925bc87`. Startup warmup
  `ops/runtime/docker-release/cloudflare-startup-warmup.json` completed with
  zero failures. Live Cloudflare Playwright route-load proof:
  `ops/runtime/reports/route-load-trace-2026-06-09T18-47-53-060Z.json`
  measured Products 2.310 s, Inventory 2.424 s, POS 2.610 s, Branches
  2.187 s, with zero failures/errors. Repeat focused traces measured POS
  2.274 s and public catalog 2.163 s:
  `ops/runtime/reports/route-load-trace-2026-06-09T18-48-19-607Z.json` and
  `ops/runtime/reports/route-load-trace-2026-06-09T18-48-19-940Z.json`.
- Move 865 aligns public portal HTTP startup preloads with the real Vite
  public graph and adds origin-side public HTML/cache proof. The backend now
  emits short bounded cache headers for public SPA HTML, CSS preload headers,
  exact public modulepreloads (`index`, `vendor-react`, the tiny `vendor`,
  `app-routing`, `PublicCatalogRoot`, `app-portal`, `app-shell`, catalog
  public chunks, and `route-sync-utils`), and one targeted
  `noto-sans-khmer-khmer-600` font preload. The chunk resolver now guards
  `vendor` against `vendor-react`, `vendor-dexie`, and `vendor-zxing`, so the
  scanner bundle is not accidentally preloaded into the customer portal.
  Docker image `business-os:v6.0.0-202606100105-perf874` is live with frontend
  hash `e356e456847a8801` and source hash `7a298b93f135e813`. Local LCP proof:
  `ops/runtime/reports/lcp-route-trace-2026-06-09T16-46-24-461Z.json` passed
  at 404 ms LCP, 200 ms FCP, 373 ms ready, 19 requests, zero failures/errors.
  Public proof after Cloudflare warmup
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-09T16-52-13-223Z.json`
  passed 13 targets with zero failures; public route-load
  `ops/runtime/reports/route-load-trace-2026-06-09T16-49-09-779Z.json` passed
  at 2.068 s ready, `api=0`, zero failures/errors; public LCP
  `ops/runtime/reports/lcp-route-trace-2026-06-09T16-52-41-462Z.json` passed
  at 1.812 s LCP, 1.412 s FCP, 1.763 s ready, zero failures/errors. Cloudflare
  HTML remains `CF-Cache-Status: DYNAMIC` because the existing API token lacks
  `Zone.Cache Rules: Edit`; `verify-cloudflare-automation.ts` now reports that
  permission gap non-fatally and contains a public-only cache eligibility rule
  for `/public` and `/customer-portal`.
- Move 863 adds a guarded Cloudflare Tunnel watchdog at
  `ops/scripts/runtime/cloudflare/cloudflare-tunnel-watchdog.ts` plus
  `npm --prefix ops run cloudflare:tunnel-watchdog`. It probes local health
  and public/admin remote health, restarts only `business-os-cloudflared-1`
  when local is healthy and remote probes show transient tunnel statuses, then
  optionally warms startup assets. Dry-run and apply proofs both passed; the
  apply run skipped restart because all probes were 200 and warmed startup
  assets successfully. Remote route trace
  `ops/runtime/reports/route-load-trace-2026-06-09T09-37-18-029Z.json`
  passed with zero failures/errors; Cloudflare warmup
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-09T09-37-19-741Z.json`
  saw 12 HIT / 1 DYNAMIC and zero failures.
- Move 862 removes real double-load overhead from Products, Inventory, and
  Audit Log. Products no longer waits an extra animation frame after fetched
  rows arrive, and Inventory/Audit Log no longer hold fetched rows behind
  requestAnimationFrame reveal overlays. The public catalog route now uses a
  dedicated `PublicCatalogPage.tsx` controller and `catalog-public` chunk, with
  `CatalogProductsSection` lazy-loaded behind the first shell. Local
  route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-09T09-09-18-084Z.json` passed
  with zero failures/errors and measured public catalog 155 ms, Dashboard
  177 ms, Products 197 ms, Inventory 271 ms, POS 254 ms, Returns 202 ms,
  Files 195 ms, and Audit Log 881 ms. Remote public Playwright rendered real
  `5539 result(s)` data on both public hosts with zero horizontal overflow.
  Remaining LCP/route latency risk is Cloudflare Tunnel/static script delivery:
  hashed assets are correctly immutable and turn into Cloudflare HITs after
  warmup, but tunnel logs still show intermittent edge connectivity failures.
- Move 861 adds bounded public cache headers to customer-safe portal read
  endpoints instead of faking faster loading in the UI. `/api/portal/config`,
  `/api/portal/bootstrap`, `/api/portal/catalog/meta`,
  `/api/portal/catalog/products`, and
  `/api/portal/catalog/products/search` now emit
  `public, max-age=20, stale-while-revalidate=120` with
  `Vary: Accept-Encoding`; AI chat, submissions, membership, reviews, and
  write/private paths remain uncached. Live Playwright proved local/admin
  Cloudflare/public Cloudflare all rendered real `5539 result(s)` data, and
  the route trace measured public catalog at 153 ms with zero failed requests.
  Next real performance targets are splitting public-only `CatalogPage` code,
  trimming shared CSS, and reducing Docker release build base-layer fetch time.
- Move 178 reduces `writeSystemSettings()` transaction-loop overhead by
  preparing the settings delete statement once beside the upsert statement.
- Move 179 leaves `language-runtime-audit.mjs` in Node.js and rejects it from
  the SQL/DuckDB queue because the remaining signal was self-referential report
  metadata, not a runtime data-processing hot path.
- Move 180 removed the generated root `output` folder after exact-path
  reference checks, freeing 870,964 bytes without touching business data,
  uploads, secrets, dependencies, or source files.
- Move 181 ran local retention cleanup and removed four old Phase 8.4 report
  folders, freeing 817,705 bytes while preserving remote R2 state for the later
  Phase 28 prune pass.
- Move 182 speeds up `generated-bulk-audit.mjs` with a recursive directory
  read fast path and the previous stack walker as fallback, preserving exact
  byte/file counts while reducing repeated Phase 29 audit overhead.
- Move 183 reduces Phase 29 orchestration wall time by running independent
  reference-producing child checks in parallel, then running organization audit
  after the generated reports are complete.
- Move 184 makes `performance-scan.js` preserve this manual Phase 29 notes
  block across regeneration, so repeat audit runs no longer erase recent
  performance, cleanup, and orchestration status.
- Move 185 teaches `phase29-audit.mjs` to compare `manualNotesPreserved` and
  `manualNotesLines` across repeated performance scan cycles, so note loss now
  shows as repeat-consistency drift.
- Move 186 switches `performance-scan.js` source reads and built-chunk stats to
  bounded parallel worker pools, while Phase 29 repeat consistency guards the
  new scanner mode and concurrency settings.
- Move 187 centralizes the bounded `mapLimit()` worker-loop helper in
  `ops/scripts/lib/fs-utils.js` and reuses it from generated-bulk,
  organization, and performance scan scripts.
- Move 188 reuses `toPosix` from `ops/scripts/lib/fs-utils.js` as the shared
  architecture-audit path normalizer instead of maintaining local
  `normalizePath` helpers.
- Move 189 switches `language-runtime-audit.mjs` source reads to the shared
  bounded `mapLimit()` helper and adds read-mode/concurrency fields to Phase 29
  repeat consistency.
- Move 190 centralizes audit existence checks in `ops/scripts/lib/fs-utils.js`
  with a shared `pathExists()` helper used by organization, language/runtime,
  and Phase 29 audit scripts.
- Move 191 bounds generated-bulk cleanup target measurement with shared
  `mapLimit()` and records `targetMeasureConcurrency` for repeat consistency.
- Move 192 bounds organization-audit scan-root discovery with shared
  `mapLimit()` and records `rootWalkMode`/`rootWalkConcurrency` for repeat
  consistency.
- Move 193 bounds language/runtime scan-root and proof-matrix checks with
  shared `mapLimit()` and records root-walk plus matrix-check concurrency for
  repeat consistency.
- Move 194 bounds Phase 29 child-check fan-out with shared `mapLimit()` and
  records `parallelCheckConcurrency` in the generated Phase 29 summary.
- Move 195 moves architecture audit report formatting helpers into
  `ops/scripts/lib/report-utils.js`, reducing duplicate report code while
  preserving the generated references.
- Move 196 moves generated-bulk byte-size formatting into
  `ops/scripts/lib/report-utils.js` so cleanup-size reporting shares the same
  formatting utility layer.
- Move 197 moves generated-bulk async text/JSON reads into
  `ops/scripts/lib/fs-utils.js`, reducing local filesystem wrapper duplication.
- Move 198 moves hardening policy verification text/JSON reads onto
  `ops/scripts/lib/fs-utils.js`, removing another duplicate synchronous
  verifier helper path and correcting the policy's grouped Cloudflare verifier
  paths. It also lets non-ignored pending source files satisfy the policy while
  a grouped script move is still unstaged.
- Move 199 moves runtime audit HTML byte formatting onto
  `ops/scripts/lib/report-utils.js`, keeping runtime and Phase 29 byte-size
  reporting on the same helper.
- Move 200 moves runtime dependency package/lockfile JSON reads onto
  `ops/scripts/lib/fs-utils.js`, reducing duplicate verifier helper code.
- Move 201 moves frontend UI verifier text/JSON reads onto
  `ops/scripts/lib/fs-utils.js`, reducing duplicate file-reader code in the UI
  verification path.
- Move 202 moves language/runtime audit package manifest reads onto
  `ops/scripts/lib/fs-utils.js`, removing a local async JSON reader from the
  Phase 29 audit path.
- Move 203 moves Cloudflare automation policy/token/email file reads onto
  `ops/scripts/lib/fs-utils.js`, reducing duplicate verifier file-read code
  while preserving local API request logic.
- Move 204 moves backup reliability verifier source reads onto
  `ops/scripts/lib/fs-utils.js`, reducing duplicate verifier file-read code
  while preserving the existing source manifest.
- Move 205 moves Docker release guardrail source/config reads onto
  `ops/scripts/lib/fs-utils.js`, reducing duplicate verifier file-read code
  while preserving Docker guardrail output.
- Move 206 moves secret hygiene tracked-file reads onto
  `ops/scripts/lib/fs-utils.js`, reducing duplicate verifier file-read code
  while preserving the large-file skip guard.
- Move 207 moves scale-service Compose reads onto
  `ops/scripts/lib/fs-utils.js` and closes Phase 29. Remaining performance,
  schema, folder, cleanup, and language/runtime candidates are follow-on slices
  that require generated-reference proof and the relevant tests.
- Move 208 fills final frontend i18n verification gaps so the dashboard,
  contacts, import tracker, and settings labels no longer fall back at runtime.
- Move 209 fixes scale-runtime R2 wiring and verifies the Cloudflare API
  object-store fallback when direct S3-compatible credentials are unauthorized.
- Move 210 rejects `ops/scripts/lib/report-utils.js` as a language/runtime
  false-positive, leaving zero remaining conversion candidates.
- Move 211 reconciles roadmap status so Phase 28 remains active, Phase 29 is
  closed, and R2 prune is recorded as executed with no remote backup deletions.
- Move 212 reconciles cleanup references with the latest public portal and R2
  verification, replacing the old Page Shield/CSP blocker with the later pass.
- Move 213 refreshes the preserved performance-scan move trail so future scans
  retain the current optimization record without reviving stale R2/public
  portal follow-ups.
- Move 214 refreshes `WHOLE-CODEBASE-SWEEP.md` with the latest generated-bulk
  size checkpoint from the 2026-05-20 audit.
- Move 215 strengthens `verify-runtime-deps.js` so `run/verify-local.bat`
  checks the stale-bundle protection chain: Vite build metadata, service-worker
  build-hash cache keys, frontend mismatch dispatch, AppContext listener,
  backend runtime version route, backend frontend-metadata reads, and existing
  frontend performance build-metadata verification.
- Move 216 adds `post-start-diagnostics.mjs` and wires it into
  `start-runtime.ps1` plus Docker release health checks so every successful
  startup can leave a structured JSON checklist for local health, runtime
  version, build manifest, service worker, and public/admin health.
- Move 217 wires the same post-start diagnostics into `run/verify-local.bat`
  with `--skip-if-unavailable`, so local verification records a passed or
  skipped startup checklist without requiring a running app on cold workspaces.
- Move 218 adds `postStartDiagnosticsCoverage` to the Docker release guardrail
  JSON and Phase 29 repeat consistency so release/start/local diagnostics
  wiring and required probes become machine-checkable.
- Move 219 adds `RUNTIME-DEPS-GUARDRAIL.json` and runs it from Phase 29 so
  package parity, scanner dependency coverage, forbidden legacy config
  absence, and stale-bundle runtime-version wiring are repeat-checked.
- Move 220 adds `localVerificationCoverage` to the same runtime dependency
  guardrail JSON so Phase 29 repeat checks the `run/verify-local.bat` lanes for
  runtime, Docker, secret, route-contract, post-start, frontend, backend, and
  integrity verification coverage.
- Move 221 cleans up the local verifier progress labels into `preflight`,
  `frontend`, and `backend` groups so long verification runs are easier to
  triage without changing the underlying command order.
- Move 222 adds `progressLabelCoverage` to the runtime dependency guardrail so
  Phase 29 repeat checks the grouped local verifier labels and rejects stale
  single-fraction labels.
- Move 223 makes `localVerificationCoverage` a hard source gate in
  `verify-runtime-deps.js`, so missing local verifier lanes now fail with an
  exact missing coverage path instead of only appearing as JSON evidence.
- Move 224 adds `dependencyTopology` to the generated-bulk audit and deletes
  the orphan root `node_modules` folder after proving root `package.json` has no
  install dependencies. Frontend/backend dependency trees stay separate because
  their lockfiles, native packages, build tools, and Docker packaging needs
  differ. Bytes removed: 3.30 MB.
- Move 225 adds byte accounting to `clean-generated.ps1`, so cleanup previews
  and actual deletion runs list each exact target size plus total bytes that
  would be removed or were removed.
- Move 226 moves duplicated run-file npm freshness checks into
  `ops/scripts/powershell/npm-install-mode.ps1`, so setup and local verification
  share one skip/install decision path.
- Move 227 aligns the ignored local root `package.json` to `6.0.0` and adds
  `versionConsistency` to the runtime dependency guardrail so backend,
  frontend, ops, and lockfile app versions are checked together.
- Move 228 adds `cloudflareRuntimeCoverage` to the Docker release guardrail so
  Phase 29 repeat checks the token rotation, origin switching, Access/WAF, R2,
  runtime-only secret paths, long Access session, and retention cleanup wiring.
- Move 229 runs bounded Cloudflare/runtime retention cleanup, removing two old
  public-portal report folders from `ops/runtime/reports` and freeing 416,466
  bytes while preserving secrets, uploads, images, volumes, and latest backups.
- Move 230 updates runtime report retention to include generated files and
  folders together, then removes three older Cloudflare report folders and four
  stale standalone screenshots from `ops/runtime/reports`, freeing 1,199,593
  bytes while preserving protected runtime and business data.
- Move 231 adds generated runtime log compaction to `prune-storage.mjs`,
  keeping the newest tail of oversized `.log` files under `ops/runtime/logs`
  and `ops/runtime/pm2`; the first 1 MiB-cap run compacted four logs and freed
  12,381,136 bytes while preserving log paths for runtime tools.
- Move 232 centralizes cleanup defaults in
  `ops/automation/business-os-automation.json`; `prune-storage.mjs` now accepts
  `--policy`, and `full-automation.ps1` passes that policy path instead of
  duplicating retention values in PowerShell.
- Move 233 adds `--output` to `prune-storage.mjs` and has full automation write
  `ops/runtime/reports/prune-storage-latest.json`, a generated current cleanup
  ledger for report retention, backup retention, R2 status, log compaction, and
  Docker-safe prune planning.
- Move 234 adds machine-readable guardrail fields for that ledger inside
  `cloudflareRuntimeCoverage`, so Phase 29 repeat checks output support,
  automation wiring, and ignored-runtime report placement.
- Move 235 adds `cleanup-test-data.mjs`, removes accumulated `QA Audit ...`
  smoke data from live Postgres after a local dump, deletes matching generated
  full-audit import directories, wires full-app audits to clean up in `finally`,
  and verifies action-history undo/redo live before removing that QA row.
- Move 236 adds `testDataCleanupCoverage` to the Docker release guardrail and
  Phase 29 repeat comparison, making the cleanup script, package entry, dry-run
  default, explicit apply gate, bounded selectors, dependent-row cleanup, import
  file cleanup, output reports, and full-app audit `finally` cleanup
  machine-checkable.
- Move 237 makes `live-smoke.mjs` clean up its own `QA Smoke ...` prefix in
  `finally` and extends prefix cleanup to generated import paths, preventing
  ordinary smoke runs from leaving product/sale/return/history/import residue.
- Move 238 adds `--fail-on-match` cleanup postchecks plus
  `cleanup-test-data:check` and `cleanup-test-data:check-smoke`; full automation
  now fails if QA/smoke leftovers remain after verification and writes latest
  runtime-only postcheck ledgers.
- Move 239 adds `action-history:check`, a live API verifier for server-side
  action-history create, undo, redo, payload round-trip, final status, and
  self-cleanup before the no-leftover postchecks run.
- Move 240 adds Postgres action-history read indexes on
  `(scope, updated_at DESC, id DESC)` and
  `(scope, created_by_id, updated_at DESC, id DESC)`, matching the history bar
  and admin user-filter queries instead of relying on the broader created-time
  index.
- Move 241 adds unique `user_sessions(token_hash)` indexing after live duplicate
  verification, hardening direct cookie-session lookup and preventing duplicate
  token rows from degrading auth correctness.
- Move 242 makes auth security-flow verification deterministic and self-cleaning
  by serializing the mutable cases, using a disposable user, and deleting its
  session, verification, audit, and user rows after the Docker runtime check.
- Move 243 updates schema-audit runtime DDL parsing so unique indexes are counted
  and compared by Phase 29 repeat, closing the blind spot that previously hid
  `CREATE UNIQUE INDEX IF NOT EXISTS` statements from the runtime index count.
- Move 244 adds unique partial idempotency indexes for non-empty
  `client_request_id` values in `sales`, `returns`, and `products` after live
  duplicate checks returned zero conflicts.
- Move 245 adds parent-first detail-read indexes for sale items, return items,
  product images, import job files, and import job errors, matching common
  detail hydration, gallery ordering, import review, and cleanup paths.
- Move 246 makes RFID event dedupe authoritative with a unique partial
  `rfid_events(dedupe_key)` index and conflict-ignore inserts, while preserving
  repeated tag read counts through `rfid_session_items`.
- Move 247 broadens cleanup postchecks so interrupted `QA Smoke` and
  `QA Action History` verification runs are caught by default, including
  smoke-generated import folders and undo/redo action-history residue.
- Move 248 adds a non-destructive `prune-storage:preview` command and makes
  `prune-storage.mjs` reject preview-named output files unless `--dry-run` is
  present, preventing accidental report/backup pruning during review.
- Move 249 adds machine-readable Docker guardrail fields for the preview path:
  `previewScriptDryRun` and `previewNameRequiresDryRun` are now part of
  `cloudflareRuntimeCoverage`, so Phase 29 repeat catches preview safety drift.
- Move 250 makes live-smoke lookup residue prefix-scoped: new smoke products
  and imported smoke CSV rows use the unique `QA Smoke ...` seed for category
  and brand fields, while cleanup postchecks now count empty QA-prefixed
  category/unit lookup rows.
- Move 251 adds an immediate action-history cleanup postcheck: the undo/redo
  verifier now runs dry-run `--fail-on-match` for its exact prefix after apply
  cleanup and writes a latest postcheck report.
- Move 252 adds comprehensive relationship-orphan reporting to backend
  integrity verification. The non-mutating report gives the schema/FK cleanup
  lane exact counts before any constraint validation or automated row cleanup is
  attempted.
- Move 253 adds bounded samples to that integrity report, giving cleanup/relink
  planning concrete row examples while keeping report size predictable.
- Move 254 adds generated-like cleanup classification to the integrity report,
  separating safe-looking generated residue candidates from unclassified rows
  that still need review.
- Move 255 adds bounded cleanup candidate ID lists to the integrity report so
  future cleanup/relink work can target exact rows after backup rehearsal.
- Move 271 adds intent-based route chunk warmup: the sidebar now publishes a
  shared navigation-intent event on pointer, focus, and touch, while the app
  shell imports only the intended page chunk with debounce, idle scheduling,
  slow/save-data guards, and a 7 s timeout. This improves second-page load
  responsiveness without broadening startup prefetch pressure.
- Move 275 removes redundant full app language JSON imports from the catalog
  route. `CatalogPage.tsx` now uses `portalLanguagePacks` and existing local
  fallbacks for public/editor copy, and performance guards block direct
  `../../lang/en.json` or `../../lang/km.json` imports from that route.
- Move 277 removes the redundant `/api/settings/meta` request from the
  frontend `getSettings()` path. `/api/settings` already returns `updatedAt`,
  so startup and settings refreshes now keep local conflict metadata current
  with one authenticated API read instead of a settings-plus-meta waterfall.
- Move 280 caches the backend `settings.updated_at` metadata probe so settings
  reads and writes no longer hit `information_schema.columns` on every request.
  The fallback for older schemas remains, but the common Postgres path avoids a
  repeated schema lookup during app bootstrap and settings refreshes.
- Move 283 extends that metadata-cache pattern to branch transfers, inventory
  transfers, and product import brand-setting writes. These paths now cache
  stable schema-shape probes for transfer note columns and settings
  `updated_at` support instead of repeating `information_schema.columns` reads
  during common write flows.
- Move 286 applies the same cache pattern to custom-table managed-column
  checks. Row writes now reuse table/column metadata after the first probe and
  refresh the cache when managed custom tables or `updated_at` columns are
  created, removing repeated schema lookups from custom-table edit flows.
- Move 289 consolidates the route-local metadata caches into
  `backend/src/schemaMetadata.ts`, so settings, product imports, branch and
  inventory transfers, and custom tables share one bounded process cache while
  preserving each route's ordered fallback choices.
- Move 293 adds a route-contract guard that scans production route files and
  fails if a route reintroduces a direct `information_schema.columns` query.
  The shared schema metadata helper remains the single route-layer pathway for
  stable column-shape checks.
- Move 294 batches the comprehensive integrity verifier's FK orphan counts into
  one generated `UNION ALL` query, reducing Docker `psql` round-trips from one
  per FK candidate to one count query plus bounded sample queries only when
  orphans exist.
- Move 296 keeps post-live hygiene resource-aware: a live fully parallel trial
  increased wall time because multiple Docker `psql` checks contended for the
  same runtime, so the final scheduler records
  `contention-safe-sequential-checks` and runs the independent hygiene tasks in
  a predictable low-contention order.
- Move 297 bounds catalog portal submission image reads. The catalog page now
  reads at most eight screenshots, only reads the remaining paste slots, and
  runs FileReader work with `CATALOG_IMAGE_READ_CONCURRENCY = 2` instead of an
  eager `Promise.all(files.map(...readAsDataURL...))` over every selected file.
- Move 298 bounds receipt export asset inlining. Receipt image/style URL
  conversion now uses `mapReceiptAssets()` with
  `RECEIPT_ASSET_INLINE_CONCURRENCY = 3`, avoiding eager
  `Promise.all(images.map(...))` and `Promise.all(nodes.map(...))` work before
  printable receipt rendering.
- Move 299 makes Phase 29 repeat sweeps contention-safe. The runner now keeps
  Markdown/JSON reference writers sequential, runs only the small Docker/runtime
  guardrails in bounded parallel, and then scans organization state after the
  reference tree has settled. This keeps repeat verification stable on Windows
  while preserving useful concurrency where it does not lock shared reports.
- Move 300 bounds offline file-sync failure writes. The browser bootstrap now
  uses `mapOfflineFileChunkStatusUpdates()` with
  `OFFLINE_FILE_CHUNK_STATUS_WRITE_CONCURRENCY = 3` when marking chunk rows
  failed or pending after an offline file replay error, replacing an unbounded
  `Promise.all(rows.map(...offline_file_chunks.update...))` burst.
- Move 301 bounds lookup snapshot name scans. Product category/unit/brand
  lookup undo snapshots now use `mapLookupNames()` with
  `LOOKUP_PRODUCT_NAME_CONCURRENCY = 2`; each lookup name still pages in order,
  while independent names can scan concurrently instead of blocking the whole
  merge serially.
- Move 302 bounds stale app-shell cache deletion. Chunk recovery reloads now
  clear old `business-os-app-shell-*` and `business-os-static-*` cache entries
  through `deleteStaleShellCaches()` with
  `STALE_SHELL_CACHE_DELETE_CONCURRENCY = 2`, avoiding an unbounded browser
  cache deletion burst during recovery.
- Move 303 bounds full runtime-reset cleanup. `resetClientRuntimeState()` now
  clears service workers and Business OS browser caches through
  `mapRuntimeCleanup()` with `RUNTIME_CLEANUP_CONCURRENCY = 2`, so manual or
  runtime mismatch recovery avoids broad unregister/delete fan-out while still
  treating individual cleanup failures as non-fatal.
- Move 304 serializes runtime cache prefix invalidation. Backend writes now
  invalidate affected Redis cache namespaces through `deletePrefixesInOrder()`
  instead of parallel `SCAN`/`DEL` prefix walks, reducing cache-layer contention
  during product, inventory, sales, return, settings, or customer write bursts.
- Move 305 indexes lookup-manager bulk delete snapshots. Category and unit
  managers now build `categoriesById` / `unitsById` maps once per render and
  use them for delete snapshots, replacing repeated `ids.map(...find(...))`
  scans during bulk cleanup with a linear indexed path.
- Move 306 indexes brand lookup bulk delete impact. Brand cleanup now builds
  `brandsByLookup` once per render and uses it for selected-brand usage counts,
  avoiding repeated full-list filtering before delete confirmation.
- Move 307 indexes POS cart product and branch lookups. POS cart quantity
  updates, branch changes, and detail actions now resolve products through the
  existing `productsById` map, and branch error copy resolves branch names
  through `branchesById`, reducing repeated array scans in the checkout path.
- Move 308 indexes inventory branch labels and product summary lookups.
  Inventory now builds `branchesById` / `summaryById` maps and uses them for
  RFID labels, export branch metadata, branch comparison rows, adjustment
  snapshots, adjustment headers, and movement product detail opening.
- Move 309 indexes product page branch moves and fresh history snapshots.
  Products now resolves bulk branch-change targets through `branchesById` and
  indexes freshly fetched save/variant snapshots before creating undo history.
- Move 310 indexes inventory transfer branch defaults. Inventory now validates
  transfer source/destination branches through `branchesById` and precomputes
  `defaultTransferDestinationBySourceId` once per branch list so single and
  batch transfer drafts avoid repeated branch scans.
- Move 311 makes inventory return stats single-pass. The secondary inventory
  stats refresh now aggregates customer returns, supplier returns, refunds,
  restock count, and returned item quantities in one pass over loaded returns
  instead of filtering and reducing the same list several times.
- Move 312 indexes inventory adjustment branch stock per submit. Adjustment
  submit now builds `selectedBranchStockById` once from the selected product and
  reuses the resolved row for undo quantity capture and remove-stock validation
  instead of scanning branch stock twice.
- Move 313 makes Inventory visible stats single-pass. The Inventory page now
  builds one `visibleInventoryStats` accumulator over `filteredSummary` and
  reuses it for stock-value, stock-state, sold, revenue, COGS, and discount
  fallbacks instead of reducing or filtering the same visible product list for
  each stat tile.
- Move 314 indexes backend inventory active branches per request. Inventory
  adjustment and row-move routes now build one `activeBranchIndex` map from the
  active-branch query and reuse it for default-branch and branch-name
  resolution, replacing repeated `activeBranches.find(...)` scans during stock
  write pathways.
- Move 315 indexes product-import branches by normalized name per job. Product
  import context now builds `branchesByName` once from active branches and keeps
  it updated when an import creates a new branch, so row-level branch resolution
  no longer scans `ctx.activeBranches` for every imported stock row.
- Move 316 makes bulk product-import conflict summaries single-pass. The import
  review modal now builds all conflict group counts in one `conflictGroups`
  accumulator loop instead of filtering the same conflict list separately for
  same-name, identifier, barcode, SKU, pricing, existing, variant, merge, and
  override counts.
- Move 317 precomputes Inventory visible product IDs. Inventory now builds one
  memoized `visibleInventoryProductIds` list and reuses it for selection
  cleanup, select-all, and visible-list signatures instead of rebuilding the
  same numeric ID list in each selection pathway.
- Move 318 centralizes Inventory selection-scope ID normalization. Inventory
  section/group selection checks and toggles now share one `normalizeFiniteIds()`
  helper, replacing repeated `ids.map(...).filter(...)` normalization in the
  checkbox workflow.
- Move 319 removes Inventory active-filter count allocations. Inventory filter
  badge counts now share `countActiveFlags()` for RFID, movement, and product
  modes instead of allocating short arrays only to call
  `.filter(Boolean).length`.
- Move 320 reuses Inventory selection helpers for partial counts and retries.
  Inventory now shares `normalizeFiniteIdsFrom()` and `countSelectedIds()` for
  section/group selection, partial checkbox counts, and batch failure recovery,
  removing the remaining filtered selected-ID allocation in that workflow.
- Move 321 removes Inventory destination-selector filter allocations. Inventory
  now shares `renderDestinationProductOptions()` for the single move modal and
  batch move lines, skipping the current product inline while mapping options
  instead of allocating `summary.filter(...).map(...)` arrays during render.
- Move 322 hardens the public Cloudflare portal live check for intermittent
  Cloudflare Page Shield script-monitor report-only CSP injection. The checker
  still fails app-origin report-only CSP regressions, but recognizes
  Cloudflare's non-blocking `cdn-cgi/script_monitor` diagnostics when the
  enforced app CSP, portal rendering, API statuses, console checks, and page
  error checks are clean.
- Move 323 reuses Sales selection and filter-count helpers. Sales now
  precomputes visible sale IDs once, reuses normalized IDs for grouped
  selection checks/toggles, counts partial selections with a direct loop, and
  counts active filters without allocating a temporary boolean array.
- Move 324 reuses Returns selection helpers and aggregates return stats in one
  pass. Returns now precomputes visible return IDs once, normalizes grouped
  selection scopes through shared helpers, counts active filters without a
  temporary boolean array, and splits customer/supplier rows plus all summary
  totals in one loop over the filtered return list.
- Move 325 reuses Audit Log selection and filter-count helpers. Audit Log now
  precomputes visible log IDs once, normalizes section/group selection IDs
  through shared helpers, counts partial selections with a direct loop, and
  counts active filters without allocating a temporary boolean array.
- Move 326 shares Contacts bulk-selection helpers. Customer, supplier, and
  delivery contact tabs now count active filters through `countActiveFlags()`
  and build bulk-delete snapshots through `buildSelectedSnapshots()`, replacing
  repeated boolean-array allocations and selected-id `Array.includes` scans
  with direct loops and Set membership.
- Move 326 also hardens Docker release kit replacement. Generated release
  directories are now removed through a release-root-guarded retry helper,
  preventing an intermittent Windows non-empty directory failure from wasting a
  completed image build and keeping the release pathway stable.
- Move 327 removes the POS filter-panel active-count allocation. The POS filter
  panel now counts active category, brand, branch, stock, group, and supplier
  filters through a direct `countActiveFlags()` loop instead of allocating a
  temporary boolean array and calling `.filter(Boolean).length` during render.
- Move 328 centralizes client API query-string construction. Product,
  inventory, import-job, contact, file, audit-log, sales, returns, RFID, and
  portal catalog reads now share `buildQueryString()` instead of repeatedly
  allocating filtered `Object.entries()` arrays before constructing
  `URLSearchParams`; sales/returns pathways that intentionally keep empty query
  values pass `skipEmpty: false`.
- Move 328 also hardens Docker release cleanup for generated image tarball
  locks. `Remove-ReleaseDirectory()` now retries child-file removal before the
  final generated-kit directory removal, preventing stale temp tar files from
  wasting a completed image build during repeated release cycles.
- Move 329 centralizes client API query-path assembly. Product, inventory,
  portal catalog, import-job, file, action-history, RFID, sales, analytics,
  contact, audit-log, return, and export reads now use `appendQuery()` for
  optional query suffixes instead of repeating `q ? ... : ''` URL assembly
  around every `apiFetch` call.
- Move 330 makes product ID lookup normalization single-pass. `getProductsByIds`
  now validates, dedupes, limits, and returns IDs through
  `normalizePositiveUniqueIds()` instead of allocating intermediate map/filter
  arrays before building the paged product search request.
- Move 331 makes actor query and cache cleanup helpers direct-loop based.
  `appendActorQuery()` now iterates extra-query keys without
  `Object.entries().forEach()` and caches `query.toString()` once, while
  `clearCachedQueryResults()` normalizes prefixes and scans query-cache rows
  with direct loops instead of chained map/filter passes.
- Move 332 makes local mirror table cleanup direct-loop based.
  `clearLocalMirrorTables()` now normalizes/dedupes requested Dexie table names
  and resolves table objects with direct loops instead of spread `Set` plus
  chained map/filter passes.
- Move 333 records the Rust deep-rewrite assessment. The current recommendation
  is no full Rust rewrite yet; use Rust only for narrow, pure, CPU-bound spikes
  after SQL/DuckDB, Web Workers, Node streaming, and existing native packages
  fail a measured target.
- Move 338 optimizes the schema primary-key preflight query. The preflight now
  materializes table metrics, duplicate-key counts, and unique-index names once
  in shared CTEs before building the JSON report, replacing repeated count and
  index subqueries while preserving the exact output shape.
- Move 339 reuses Products positive-ID normalization. Product selection helpers
  now build visible IDs, product ID maps, parent ID sets, and bulk action redo
  IDs with direct loops/shared normalization instead of repeated map/filter
  chains in the Products page.
- Move 340 tightens POS core helpers. Product lookup construction now skips
  invalid IDs in a direct loop, and visible POS card construction pushes valid
  cards directly instead of building then filtering a temporary mapped array.
- Move 341 removes import-service normalization allocation chains. Import job
  type filters, duplicate-group counts, incoming image-list parsing, settings
  option parsing, and cancel-wait job IDs now use direct loops/dedupe sets
  rather than chained map/filter or Array.from/filter paths.
- Move 342 reuses product-route ID/token normalization. Product image maps,
  search include/term/id filters, branch-stock hydration, lookup replacement,
  and inline import image-list parsing now use shared direct-loop helpers
  instead of repeated map/filter/dedupe chains.
- Move 343 reuses settings conflict attempted-payload construction. The shared
  API settings save path now builds attempted values through one helper and
  shared metadata-key set instead of reconstructing an inline
  Object.entries/filter chain on each conflict response.
- Move 344 tightens shared API query and import image upload loops.
  `buildQueryString()` now uses direct key iteration, and import image upload
  file/relative-path collection uses direct loops instead of filter/forEach
  allocation chains.
- Move 345 tightens shared API upload, offline queue, and return conflict
  loops. XHR upload headers now use direct key iteration, offline sale retry
  eligibility is collected in one pass, and return conflict item snapshots use
  a reusable direct-loop helper.
- Move 346 centralizes shared API sync-update and mirror serialization loops.
  Queue discard/offline-sale refresh events now use named channel lists through
  `dispatchSyncUpdates()`, pending sync previews use a bounded serializer, and
  local mirror rows clone through a direct loop.
- Move 347 reuses backend inventory reason and search normalization loops.
  Saved inventory reasons now share one direct-loop cleaner/deduper, and
  inventory search terms use a bounded direct-loop splitter instead of
  map/filter/slice chains.
- Move 348 makes backend inventory product hydration single-pass. Branch-stock
  JSON parsing and product ID collection now happen in one direct loop before
  batch rows are attached, replacing the previous map/map/forEach sequence.
- Move 349 consolidates backend stock-adjustment allocation movement loops.
  Remove-stock and set-stock reductions now share
  `appendAllocationMovementEntries()`, and movement insertion uses a direct
  loop instead of callback iteration.
- Move 350 tightens backend inventory transfer insertion loops. Transfer batch
  allocation cloning and paired movement writes now use direct loops, and
  dynamic transfer insert SQL uses one helper for quoted columns/placeholders.
- Move 351 tightens backend inventory row-move movement construction. Source
  and destination allocation movement rows now use direct loops with
  precomputed unit-cost fallbacks instead of recomputing the same cost
  expressions inside callback blocks.
- Move 352 tightens backend RFID inventory transaction loops. RFID event
  recording now uses one direct transaction loop instead of map/filter, and
  RFID apply precomputes purchase-price movement totals inside a direct
  present-row loop.
- Move 353 tightens backend inventory product list assembly. Family root ID
  collection, family/base row merging, hydrated response sanitization, and
  brand filter extraction now use direct loops instead of allocation-heavy
  array chains.
- Move 354 completes the obvious backend inventory route array-chain cleanup.
  Product-filter search clauses, movement-search clauses, and summary
  branch-stock parsing now use direct loops while preserving SQL fragments and
  response payloads.
- Move 355 tightens shared backend product image and branch-stock helper loops.
  Branch-stock seeding, image gallery persistence, image-map loading, and
  gallery attachment now use direct loops while preserving gallery order and
  payload shape.
- Move 356 tightens backend product lookup metadata assembly. Brand option
  parsing, lookup usage entry construction, sample collection, and
  brand/category/unit row preparation now use direct loops while preserving
  sorting and payload shape.
- Move 357 tightens backend product search filter and branch-stock attachment
  loops. Product ID/search bindings, metadata distinct values, branch-stock SQL
  placeholders, branch grouping, and payload attachment now use direct loops
  while preserving search behavior and response shape.
- Move 358 tightens backend product family expansion and search response
  assembly. Family source filtering, bounded bind-list construction, expanded
  row parsing/deduping, paged row parsing, batch ID collection, and batch
  payload attachment now use direct loops while preserving include behavior and
  payload shape.
- Move 359 tightens backend product lookup replacement and legacy list response
  assembly. Lookup replacement placeholders, legacy product row parsing, batch
  ID collection, and final product/batch payload assembly now use direct loops
  while preserving SQL, audit, gallery, and response behavior.
- Move 360 tightens backend product edit stock adjustment movement loops.
  Manual stock reduction allocations and inventory movement inserts now use
  direct loops with precomputed product/cost values while preserving stock,
  batch, audit, and movement behavior.
- Move 361 applies guarded Phase 29 runtime cleanup. The storage prune removed
  three old Phase 8.4 runtime report folders, freeing 703,101 bytes, after QA
  data and generated integrity backlog dry-run checks showed zero matches.
  Docker safe-prune ran only for stopped containers and builder cache.
- Move 362 tightens the legacy backend product bulk-import setup path. Image
  payload byte counting, image-only product matching, and category/unit/brand
  import lookup maps now use direct loops while preserving import limits,
  lookup normalization, SQL, and response payloads.
- Move 363 tightens the rest of the obvious legacy product bulk-import
  callback chains. Batch reset ID/placeholder construction, CSV image
  reference parsing, gallery loading, resolved image collection, branch-stock
  seeding, and brand cleanup now use direct loops while preserving stock,
  gallery, brand, audit, and response behavior.
- Move 364 tightens the product import signature and sales checkout hot path.
  Product import signatures, active branch context, normalized sale items,
  sale branch summaries, checkout product metadata lookup, batch migration,
  and sale allocation/movement writes now use direct loops while preserving
  checkout validation, stock deduction, batch allocation, and response behavior.
- Move 365 tightens the backend sales status-transition and list-response hot
  paths. Status-driven stock deduction/restoration allocation writes,
  inventory movement writes, sales search token parsing, and `/api/sales`
  payload assembly now use direct loops while preserving stock, search, audit,
  and response behavior.
- Move 366 tightens the backend sales export/report path. Export row
  hydration, COGS calculation, completed-sale accounting totals, sales-detail
  payload construction, CSV rows, and CSV summary lines now use direct loops
  while preserving export period logic, accounting math, CSV escaping, and
  JSON response fields.
- Move 367 tightens the backend returns stock-flow path. Return search/items
  payloads, customer and supplier product lookup maps, supplier total-cost
  accumulation, allocation movement writes, edit reversal/restock loops, and
  sale return-status recalculation now use direct loops while preserving
  return validation, stock semantics, audit/history, and response behavior.
- Move 368 tightens the backend custom-table dynamic SQL path. Table name
  humanization, schema normalization, custom-table payloads, DDL columns,
  insert columns/placeholders/values, and update set/value lists now use direct
  loops while preserving custom-table naming, SQL shape, metadata caching,
  conflict checks, audit, and response behavior.
- Move 369 tightens the backend settings save path. Brand option
  normalization, brand color map cleanup, settings snapshot assembly,
  attempted settings extraction, normalization/upsert, and audit key reporting
  now use direct loops and one shared metadata-key set while preserving
  conflict handling, text integrity checks, storage reconcile scheduling, and
  response behavior.
- Move 370 tightens the owned Google OAuth and integration doctor origin
  checklist path. Origin normalization, Google login callback URI construction,
  and verified release-backup directory discovery now use direct loops and one
  shared callback-path helper while preserving login origins, redirect URI
  lists, Drive checklist output, secret redaction, and restore-needed checks.
- Move 371 tightens the public catalog product payload path. Product ID
  collection, image placeholder construction, image grouping, and catalog
  payload assembly now use direct loops and small named helpers while
  preserving product ordering, gallery caps, fallback images, branch-stock
  parsing, public allowlisting, and response shape.
- Move 372 tightens action history and user list response projection. The
  action-history serializer and user-list sanitizer now run through named
  direct-loop helpers while preserving ownership filters, sensitive-history
  checks, permission merge behavior, admin flags, role-system flags, and
  response payload shapes.
- Move 373 tightens notification summary assembly. Notification setting
  placeholders, settings maps, inventory alert item construction, expiry alert
  item/count construction, and unread count summing now use direct loops and
  named helpers while preserving notification semantics, payload shape, and
  existing summary separator text.
- Move 374 tightens notification loyalty assembly. Loyalty aggregate rows now
  build customer maps with direct loops, threshold matching computes balances
  inside one direct loop, and the capped 50-item payload uses a bounded direct
  loop while preserving point policy math, balance sorting, threshold behavior,
  and response fields.
- Move 375 tightens notification sales and portal item construction.
  Awaiting-payment, awaiting-delivery, and pending portal submission
  notification item payloads now use direct-loop helpers while preserving
  counts, labels, platform-aware metadata, summary text, and response fields.
- Move 376 completes the notification summary separator cleanup. Inventory,
  expiry, and sales summaries now share one direct-loop join helper and one
  separator constant, and sales/portal metadata use that same separator while
  preserving counts, labels, summary parameters, permission gates, SQL, and
  response fields.
- Move 377 tightens the portal AI request path. Token parsing, visitor
  timestamp pruning, candidate filtering/scoring, prompt candidate-line
  assembly, assistant recommendation normalization, provider usage summaries,
  max-input calculation, and failover provider selection now use named
  direct-loop helpers while preserving provider priority/cooldown behavior,
  prompt ordering, recommendation caps, citation caps, scoring rules, rate
  limits, and response fields.
- Move 378 tightens Google Drive sync version-retention selection. Version row
  normalization and date-expired selection now use direct-loop helpers while
  preserving timestamp-first retention behavior, version-number fallback
  behavior, sort order, default retention days, and returned item shape.
- Move 379 tightens the main Google Drive sync service. Settings reads/writes,
  sync-entry maps, multi-hash streaming, fetch error detail joining, snapshot
  directory sorting, duplicate sibling filtering, live path collection, and
  stale mapping selection now use named direct-loop helpers while preserving
  configuration behavior, resumable upload hashing, duplicate cleanup,
  delete-missing order, folder sort order, error message shape, and database
  writes.
- Move 380 tightens backup package retention and listing. Cache cloning,
  writable waiter notifications, object manifests, local backup directory
  discovery, retention planning, kept-ID summaries, remote delete-key
  collection, remote removal summaries, local version listing, R2 object
  aggregation, and final version sorting now use named direct-loop helpers
  while preserving retention order, local/R2 pruning behavior, bytes-removed
  totals, reusable metadata, object manifest shape, and version listing shape.
- Move 381 tightens the AI provider gateway and settings route. Supported-model
  normalization, Google request content construction, Google response text
  joining, provider-list serialization, and AI response-log serialization now
  use named direct-loop helpers while preserving provider metadata defaults,
  endpoint safety checks, Google role mapping, response text separators,
  provider list ordering, response log fields, and route payload shapes.
- Move 382 tightens backend branch stock integrity and transfer helpers.
  Stock-integrity preview payloads, total quantity calculation, repair stock
  updates, touched-product recalculation, and dynamic transfer insert SQL now
  use direct-loop helpers while preserving preview-token input order, default
  branch repair behavior, transfer column order, movement writes, audit
  payloads, broadcasts, and response shapes.
- Move 383 tightens runtime catalog-integrity diagnostics. Product field
  counting, suspicious product sampling, and brand-option suspicious-text
  sampling now use direct-loop helpers while preserving runtime payloads,
  suspicious-field counters, sample limits, scanner status, permission gates,
  and response fields.
- Move 384 tightens offline sync outbox normalization and digest helpers.
  Stable payload stringification now uses explicit ordered loops for arrays
  and sorted object keys, and outbox operation normalization uses one
  direct-loop helper while preserving payload digest semantics, operation
  metadata, replay gates, chunked file sync behavior, and response fields.
- Move 385 converts the import-job refresh helper to TypeScript with a
  compatibility wrapper. The typed implementation preserves refresh channel
  ordering, terminal-status transition checks, and `sync:update` event payloads
  while keeping the existing `.js` import path stable; the language-runtime
  audit now records this as a completed TypeScript slice and still rejects
  Worker/Python/Rust-style rewrites for the main-thread event boundary.
- Move 386 clears stale host Node background processes and adds a guarded
  cleanup helper. The sweep stopped 25 non-Business-OS `node.exe` processes
  from old external Next servers, a temporary runner, and duplicated Codex
  Xcode helper pairs, freeing about 953.4 MB of working set while leaving the
  Docker app stack untouched. `clear-stale-node-processes.ps1` now provides
  preview/apply cleanup and protects the Business OS workspace by default.
- Move 387 tightens stale Node cleanup reporting. The helper now excludes its
  own PowerShell/npm launcher ancestry from external Node counts, so preview
  runs do not report the short-lived npm process as leftover background work.
- Move 388 tightens auth bootstrap settings snapshot assembly. The auth route
  now builds the settings map with a direct loop while preserving the settings
  query, sanitized settings payload, bootstrap response shape, session
  behavior, and existing OAuth callback path.
- Move 389 tightens contacts point-policy settings assembly. The contacts route
  now builds the point-policy settings map with a direct loop while preserving
  point-basis defaults, USD/KHR point calculations, customer point summaries,
  and the existing customer points pagination path.
- Move 390 tightens customer portal config normalization. FAQ items now stop
  at the accepted 24 public entries without a map/filter/slice chain, portal
  translations and recommended-product IDs use direct loops, and the portal
  settings map uses direct row iteration while preserving public config output,
  membership lookup behavior, and catalog payloads.
- Move 391 tightens customer portal product asset and payload materialization.
  Portal product ID collection, SQL placeholder generation, image and branch
  stock maps, and final payload list decoration now use named direct-loop
  helpers while preserving full-list and paged catalog product payloads.
- Move 392 tightens customer portal loyalty point summarization. Portal sales,
  returns, and approved share submissions now feed earned, deducted, redeemed,
  and rewarded totals through one direct pass per list instead of
  filter/reduce callback chains, preserving all point and redemption math.
- Move 393 tightens customer portal catalog search/filter parsing. Term
  splitting, filter splitting, branch ID parsing, named placeholder
  construction, brand/category filters, and stock-state normalization now use
  direct-loop helpers while preserving public catalog query behavior.
- Move 394 tightens customer portal catalog metadata assembly. Distinct
  brand/category extraction, product-brand rows, persisted brand-option
  normalization, and merged brand de-duplication now use direct-loop helpers
  while preserving category, branch, brand, and initials metadata output.
- Move 395 tightens customer portal membership lookup and submission review
  response shaping. Clause wrapping, screenshot JSON normalization, review row
  shaping, and membership sales/return/discount totals now use shared
  direct-loop helpers instead of callback chains and repeated reductions.
- Move 396 tightens customer portal screenshot and AI citation collection.
  Screenshot sanitization now stops at the existing eight-entry cap during a
  direct pass, and AI recommendation citation flattening now uses a direct
  nested-loop helper while preserving media safety and AI log payloads.
- Move 397 tightens customer portal product signal ranking. Rank map
  construction, sale/return metric ingestion, net signal rows, new-arrival
  ranks, and recommended-product ranks now use named direct-loop helpers while
  preserving catalog badge rank ordering and payload fields.
- Move 398 tightens import job route wrapper loops. Permission checks,
  permitted import type collection, job file response serialization, and
  multi-image upload persistence now use named direct-loop helpers while
  preserving import type ordering, response fields, relative-path fallbacks, and
  audit payload behavior.
- Move 399 tightens import job service list/update loops. Import job listing
  now uses reusable placeholder and row decoration helpers, and import job patch
  updates now collect allowed fields, assignments, and named SQL params in a
  direct pass while preserving filtering, payload decoration, and update
  semantics.
- Move 400 tightens import image-reference and product-gallery loops. Incoming
  image reference collection, gallery de-duplication, gallery row insertion,
  and current-gallery loading now use direct bounded loops while preserving
  upload path normalization, first-image previews, duplicate suppression, and
  the five-image cap.
- Move 401 tightens import product review grouping loops. Duplicate-name
  review groups now share direct-loop helpers for set ingestion, set
  serialization, subgroup finalization, and group sorting while preserving row
  ordering, field/issue payloads, existing matches, row summaries, and
  suggested actions.
- Move 402 tightens import review decision and label loops. Identifier checks,
  product/contact label building, generic empty-row detection, decision field
  copying, field override copying, and product signature serialization now use
  named direct-loop helpers while preserving payload order, override semantics,
  copied keys, and signature string format.
- Move 403 tightens import review count and group-decision loops. Review
  conflict count accumulation and group decision normalization now use named
  direct-loop helpers while preserving count keys, identifier/issue counting,
  row pagination, group key normalization, merge order, and policy persistence.
- Move 404 tightens import product parent and lookup-map helpers. Parent
  selection now scans candidates once instead of clone-and-sort, settings
  option maps build normalized lookup entries in one pass, and product import
  category/unit/supplier/branch indexes now share a direct lookup-map helper
  while preserving selection priority, option order, normalized keys, and
  cached lookup behavior.
- Move 405 tightens import product row-cache ordering. Same-name product cache
  updates now remove a matching product ID and insert the replacement in sorted
  position instead of filtering then sorting the whole list, preserving the
  group, parent, created_at, and id ordering rules.
- Move 406 tightens import branch-batch stock cleanup. Product batch IDs now
  use shared direct-loop collection, and replacement stock cleanup now reuses a
  single branch-batch zeroing helper plus the shared SQL placeholder builder
  while preserving no-branch replacement, branch replacement, stock rollups, and
  positive-quantity batch increases.
- Move 407 tightens import cancellation placeholder and ID loops. Cancellable
  job queries, active-job wait polling, cancel-all updates, import file
  cancellation, and delete-all job ID collection now reuse shared SQL
  placeholder and row-ID helpers while preserving wait, cancel, delete, and
  broadcast semantics.
- Move 408 reconciles obsolete Phase 29 status wording and tightens import
  image/CSV lookup construction. The plan docs now distinguish the completed
  first Phase 29 baseline from the still-active recurring guardrail. Image
  lookup keys, image-only product match keys, inventory product/branch lookup
  maps, sales product/branch lookup maps, and default-branch selection now use
  named direct-loop helpers while preserving matching and import semantics.
- Move 409 tightens import error CSV export. Error CSV generation now appends
  escaped rows through a direct helper loop instead of nested `map()` chains
  and spread materialization while preserving the BOM, header order, row limit,
  escaping, row order, and public download contract.
- Move 410 tightens remaining import product signature and ZIP-file selection
  callbacks. Same-name product signature matching now uses a shared direct
  helper across review, preflight, and apply paths, while ZIP extraction
  selection uses a direct unprocessed-file helper. The only remaining callback
  chain in `importJobs.ts` is a suspicious-catalog warning text pipeline left
  for a separate semantic cleanup pass.
- Move 411 clears the final import-service callback chain. Brand-option
  cleanup after product imports now uses a direct helper to normalize values,
  drop blanks, and reject suspicious catalog text before the existing
  de-duplication step. A callback-chain scan now reports no `map()`,
  `filter()`, `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in
  `backend/src/services/importJobs.ts`.
- Move 412 tightens product-route branch, import-signature, and sorted-map
  helpers. Default branch selection, branch lookups, bounded set
  materialization, category usage sorting, clean brand sorting, and product
  import same-detail matching now use named direct-loop helpers. A callback
  scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`,
  or `Array.from()` hits in `backend/src/routes/products.ts`.
- Move 413 tightens inventory product family expansion. Family root ID
  collection and merged family-row sorting now use direct-loop helpers while
  preserving parent/variant expansion, de-duplication, and product ordering. A
  callback scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`,
  `find()`, or `Array.from()` hits in `backend/src/routes/inventory.ts`.
- Move 414 tightens sale stock availability sampling. The insufficient-stock
  validation path now uses a direct helper to find the sample sale item for an
  error message, preserving required quantity aggregation, branch scoping, and
  route behavior. A callback scan now reports no `map()`, `filter()`,
  `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in
  `backend/src/routes/sales.ts`.
- Move 415 tightens contact import, search, scoped-ID, and point-summary
  helpers. Provided import rows, search haystacks, scoped customer IDs,
  point-summary maps, source IDs, defaults, and response decoration now use
  named direct-loop helpers while preserving row numbers, search SQL, scoped
  summary behavior, and point calculations. A callback scan now reports no
  `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
  `Array.from()` hits in `backend/src/routes/contacts.js`.
- Move 416 tightens auth/user route selection helpers. Password-reset redirect
  selection now uses a direct first-valid-URL helper, and user linked-provider
  identity selection now uses direct UUID and provider-identity helpers while
  preserving redirect priority, URL validation, UUID trimming, provider
  normalization, and unlink guard behavior. Callback scans now report no
  `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
  `Array.from()` hits in `backend/src/routes/auth.js` or
  `backend/src/routes/users.js`.
- Move 417 clears the backend route callback-chain scan. The system route now
  uses direct helpers for import-stop IDs, migration counts, settings maps,
  setting writes, row totals, custom-table names, broadcasts, sync operation
  IDs, folder roots, visible directories, and folder-picker script assembly
  while preserving backup/reset/restore SQL order and folder browsing payloads.
  A callback scan now reports no `map()`, `filter()`, `forEach()`, `reduce()`,
  `find()`, `flatMap()`, or `Array.from()` hits anywhere under
  `backend/src/routes`.
- Move 418 clears the backend service callback-chain scan. Backup writable
  waiters, object-copy worker promises, grouped remote package values,
  backup-version sorting inputs, and Google Drive reusable non-folder sibling
  selection now use named direct-loop helpers while preserving writable
  drain/error behavior, object-copy concurrency, package grouping, retention
  sorting, and Drive file reuse semantics. A callback scan now reports no
  `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, `flatMap()`, or
  `Array.from()` hits anywhere under `backend/src/services`.
- Move 419 tightens backup summary and catalog text utilities. Backup row
  counts, custom-table row totals, normalized backup counts, suspicious catalog
  field detection, and normalized option-list de-duplication now use direct
  loops while preserving backup summary keys, suspicious-text rules,
  first-seen option casing, and locale sorting.
- Move 420 tightens contact option normalization. Stored structured options,
  legacy string options, fallback options, serialization cleanup, primary
  option selection, and option data checks now use direct-loop helpers while
  preserving the three-option cap, address-vs-area rules, default labels,
  legacy migration behavior, and JSON shape.
- Move 421 tightens startup/runtime infrastructure helpers. Env candidate
  filtering, runtime/data folder creation, organization folder creation,
  settings snapshot sanitizing, first existing runtime directory selection, and
  source-hash file filtering now use direct loops while preserving env
  precedence, folder guardrails, media sanitization, runtime revision behavior,
  and source hash ordering.
- Move 422 tightens CSV import parsing. Delimiter detection, header
  normalization, parsed row materialization, streaming header setup,
  row-content checks, and CSV value-to-row projection now use direct-loop
  helpers while preserving BOM handling, delimiter priority, quote/CRLF
  parsing, Khmer text and digit preservation, row numbers, batch sizing, and
  empty-row filtering.
- Move 423 tightens product import policy list helpers. Array, JSON, and
  delimited-string list normalization, lowercase uniqueness set construction,
  and append-unique merging now use direct-loop helpers while preserving
  JSON-array support, separator handling, case-insensitive de-duplication,
  imported item order, and ` | ` serialization.
- Move 424 tightens schema/security/runtime helper loops. Column candidate
  normalization, column presence caching, permission key collection,
  any-permission checks, rate/abuse timestamp pruning, private IPv4 parsing,
  blocked host suffix checks, and organization folder discovery now use direct
  loops while preserving cache keys, permission responses, retry-after
  behavior, private network blocking, and exact/canonical organization folder
  precedence.
- Move 425 tightens system job lifecycle helpers. Runtime migration statement
  execution, finished-job collection, old finished job cleanup, persisted job
  row serialization, and in-memory job listing now use direct-loop helpers
  while preserving stale recovery, persistence throttling, completed-job cap,
  listing order, and public job shape.
- Move 426 tightens file-asset reference, orphan, and usage helpers. Upload
  reference recursion, persisted reference collection, reference backfill
  registration, tracked upload path collection, object/local orphan scans,
  storage-delete key collection, usage map seeding, settings/submission usage
  expansion, and asset-row serialization now use named direct-loop helpers
  while preserving R2 key normalization, local upload deletion rules, backfill
  metadata, usage labels, `canDelete`, and browser public paths.
- Move 427 tightens product-batch stock hierarchy helpers. Product ID
  normalization, placeholder construction, batch ID extraction, tracked-batch
  detection, product-batch grouping, branch rollup aggregation, legacy batch
  zeroing, branch quantity seeding, force-migration ID listing, and
  availability totals now use named direct-loop helpers while preserving FEFO
  ordering, branch rollup math, synthetic legacy batches, allocation restore
  behavior, and public helper exports.
- Move 428 tightens shared backend helper loops. CSV non-empty line filtering,
  header normalization, parsed-row construction, backup import placeholder and
  value construction, returned-item quantity maps, fully-returned sale
  detection, integrity success checks, and sale profit COGS totals now use
  named direct-loop helpers while preserving CSV row numbering, backup import
  ignore behavior, sale status repair semantics, integrity response shape, and
  profit calculations.
- Move 429 tightens object-store helper loops. Cloudflare R2 API query
  construction, delete-key normalization and de-duplication, bulk delete object
  descriptors, Cloudflare object-list serialization, and S3 object-list
  serialization now use named direct-loop helpers while preserving S3/R2 driver
  selection, R2 API fallback conditions, timeout handling, delete chunk sizing,
  and list payload shape.
- Move 430 tightens server utility host and sanitizer helpers. Configured
  public host collection, customer portal host de-duplication, and recursive
  array key sanitization now use direct-loop helpers while preserving origin
  allowlist behavior, customer portal host precedence, WebSocket origin checks,
  CSP/cache headers, and prototype-pollution key stripping.
- Move 431 tightens portal about-block normalization. About-block creation and
  meaningful-block filtering now use a direct-loop helper while preserving JSON
  string parsing, fallback IDs, supported block types, media/title/body
  trimming, Google Maps embed normalization, and public helper exports.
- Move 432 tightens permission definition helpers. Permission definition
  expansion and definition lookup now use direct-loop helpers while preserving
  section labels, sensitivity metadata, default role permissions,
  action-history permission mapping, sensitive action detection, and public
  exports.
- Move 433 tightens initial-key aggregation helpers. Khmer order map
  construction, row aggregation, sorted entry materialization, and aggregate
  response construction now use direct-loop helpers while preserving Khmer
  collation, Latin/number ordering, symbol handling, count accumulation, and
  public helper exports.
- Move 434 tightens small security and maintenance predicates. Public API
  allowlist matching, maintenance-lock write allowlisting, read-only method
  checks, and upload magic-byte matching now use direct loops or named
  predicates while preserving public route behavior, maintenance 423
  responses, upload type detection, and focused security tests.
- Move 435 tightens Postgres compatibility and cutover-readiness scans. Numeric
  field matching, coerced-row materialization, forbidden-pattern scanning,
  blocker counting, summary row construction, and multi-file analysis now use
  named direct-loop helpers while preserving SQL translation, numeric coercion
  exceptions, cutover blockers, packaged-runtime gating, and report shapes.
- Move 436 tightens the synchronous Postgres runtime bridge. Query-row
  coercion, semicolon-split exec statement materialization, runtime
  schema/index statement execution, and default role seeding now use named
  direct-loop helpers while preserving statement translation, transaction
  boundaries, runtime DDL order, default organization/bootstrap behavior, and
  role seed updates.
- Move 437 tightens small route predicate helpers. Paged branch-stock query
  detection, inventory stats filter detection, portal AI profile preference
  checks, suspicious brand option checks, sync conflict detection, and replay
  success checks now use named direct-loop helpers while preserving route
  registration, validation messages, conflict status codes, and offline replay
  behavior.
- Move 438 tightens upload reference cleanup. Settings, product image, product,
  user avatar, file asset, and customer-share screenshot repair passes now use
  direct row loops while preserving sanitization rules, gallery-primary
  fallback behavior, delete-vs-update decisions, summary counters, and public
  cleanup exports.
- Move 439 clears the remaining backend source callback-chain scan. CSV
  row-content checks, integration critical-check aggregation, and Google Drive
  canonical layout detection now use named direct-loop predicates while
  preserving CSV parsing, Khmer text preservation, integration report shape,
  Drive versioning, mapping reset behavior, and sync retention behavior. A
  backend source scan now reports no `map()`, `filter()`, `forEach()`,
  `reduce()`, `find()`, `some()`, `every()`, `flatMap()`, or `Array.from()`
  hits under `backend/src`.
- Move 440 tightens authenticated Dashboard startup. Route warmups now wait
  for user intent, pending-sync/notification/import-tracker/offline
  maintenance work is delayed past the first interaction window, Dashboard
  reads use the narrow dashboard transport, and export helper modules load
  only on export commands. Real Docker-served authenticated Playwright proof on
  hash `9b132859aa24909c` reduced first-12-seconds startup from 34 JavaScript
  chunks and 5 app data/auth API calls to 12 JavaScript chunks and 3 app
  data/auth API calls, plus 3 expected health probes, with no
  unrelated product/POS/inventory/catalog/file-picker/local-DB/import-tracker/
  notification-center requests and no relevant console or failed-response
  noise.
- Move 441 deduplicates startup health probes. The HTTP layer now owns a
  shared `pingServerHealth()` with in-flight and short fresh-result reuse,
  while AppContext consumes that result instead of launching a parallel raw
  `/health` fetch. The active background cadence now waits 30 seconds after
  the first shared probe. Docker-served authenticated Playwright proof on hash
  `f29e8401e596bf6c` kept the Dashboard startup at 12 JavaScript chunks but
  reduced `/health` from 3 probes to 1 in the first 12 seconds; auth bootstrap,
  analytics, and dashboard data stayed HTTP 200 with zero failed responses and
  zero relevant console messages.
- Move 442 combines Dashboard startup summary and analytics reads. The backend
  now shares cached summary and analytics builders across `/api/dashboard`,
  `/api/analytics`, and `/api/dashboard/startup`; the frontend first empty
  Dashboard load calls the combined route once, while range changes call only
  `/api/analytics`. Docker-served Playwright proof on hash
  `435e572a3d2acfaf` observed exactly `/health`, `/api/auth/bootstrap`, and
  `/api/dashboard/startup` on initial load, with zero initial legacy
  dashboard/analytics split calls and zero relevant console messages.
- Move 443 primes startup health from authenticated bootstrap. The backend
  bootstrap payload now carries served frontend runtime metadata, and the
  frontend health layer can seed its shared online/runtime-version state from
  that payload before the delayed first scheduled `/health` probe runs.
  Docker-served Playwright proof on hash `09107596d6229a5a` observed exactly
  `/api/auth/bootstrap` and `/api/dashboard/startup` on initial Dashboard load:
  zero startup `/health`, zero initial legacy dashboard/analytics split calls,
  and zero relevant console messages. Pressing `7 Days` still made exactly one
  analytics request and no summary refetch.
- Move 444 defers inactive Dashboard bar-chart code. Dashboard now imports
  visible line and payment donut charts directly while lazy-loading the
  inactive volume/transactions `BarChart` branch. Production output split
  `BarChart` into a 3.33 kB lazy chunk and reduced the first-paint chart chunk
  from the earlier 10.58 kB bundle to a 7.56 kB `DonutChart` chunk.
  Docker-served Playwright proof on hash `9ee8a8bbcfeb8deb` confirmed
  `BarChart` was neither requested nor modulepreloaded during default
  Dashboard startup, the visible donut chart still loaded, startup stayed at
  two app API responses, and relevant console messages stayed at zero.
- Move 445 splits later-route shared controls from the Dashboard startup
  shared chunk. Vite now emits focused chunks for `PaginationControls`,
  `ActionHistoryBar`, `FilterMenu`, `SectionSwitcher`, `PageHeader`, and
  `Modal` before the fallback `app-shared` rule. Production output reduced
  `app-shared` from the prior 92.97 kB chunk to 73.03 kB. Docker-served
  Playwright proof on hash `453778909dc40f11` confirmed none of those split
  shared-control chunks or inactive `BarChart` were requested or
  modulepreloaded during default Dashboard startup; initial app API traffic
  stayed at `/api/auth/bootstrap` plus `/api/dashboard/startup`, and the
  `7 Days` interaction still made exactly one analytics request.
- Move 446 intent-loads the Dashboard export portal menu. `ExportMenu` now
  renders the visible export button without statically importing `PortalMenu`,
  preloads the portal menu on pointer/focus intent, and opens it after a
  direct first-click dynamic import using `PortalMenu.defaultOpen`. Vite emits
  `shared-portal-menu` as a 4.10 kB deferred chunk, and production output
  reduced `app-shared` from 73.03 kB to 69.31 kB. Docker-served Playwright
  proof on hash `23fd366cede8b3c4` confirmed the portal chunk was neither
  requested nor modulepreloaded on Dashboard startup, then a direct `Export`
  click fetched the portal chunk at HTTP 200 and opened the menu.
- Move 447 focuses startup Lucide icon ownership. Runtime icon imports now use
  direct `lucide-react/dist/esm/icons/*` modules, and Vite assigns only
  shell/Login/sidebar icons to `app-shell-icons` instead of emitting a broad
  `vendor-lucide` chunk or letting route chunks own shell-needed icons.
  Production output removed `vendor-lucide` and emitted
  `app-shell-icons-Cb4aT_3T.js` at 15.53 kB. Docker-served Playwright proof on
  hash `ab7ff057cc20cdd9` measured 13 startup JavaScript files, 620,625
  decoded bytes, 189,316 transfer bytes, no catalog/notification/import
  tracker/file-picker/media/portal-menu/vendor-zxing startup chunks, no
  `vendor-lucide`, clean console, clean failed-request list, and preserved
  on-demand `shared-portal-menu` loading after clicking `Export`.
- Move 448 defers signed-out Login UI and auth-only icon ownership. `App.tsx`
  now lazy-loads `Login` only in the unauthenticated branch, and Vite emits a
  deferred `auth-login` chunk with auth-only Lucide icons assigned before the
  shell-icon rule. Docker-served Playwright proof on hash `80aceec796128140`
  measured 13 authenticated startup JavaScript files, 587,317 decoded bytes,
  181,800 transfer bytes, no `auth-login`, catalog, notification/import
  tracker, file-picker, media upload, portal-menu, vendor-zxing, or
  vendor-lucide startup chunks or modulepreloads. The signed-out `/login`
  proof loaded `auth-login-SHSYT-QZ.js` on demand and did not load catalog/
  file-picker/media/ZXing extras.
- Move 449 gates signed-out sync/runtime listeners and polling. AppContext
  skips operational sync listeners and websocket polling without an active or
  stored user, the sync banner skips pending-sync listeners and its 20 second
  poll while signed out, and the websocket module gates auth/network/focus
  lifecycle listeners behind stored-session evidence. Docker-served
  Playwright proof on hash `6eb9420d6daf9353` observed signed-out `/login`
  with only `sync:update`, no 500/3000/20000 ms sync intervals, no 100 ms
  websocket quick check, and zero relevant console messages after filtering
  the expected unauthenticated bootstrap 401. The authenticated Dashboard
  still registered sync/auth listeners, started websocket polling, returned
  `/api/dashboard/startup` HTTP 200, and had zero console or failed-request
  noise.
- Move 450 lazy-installs HTTP sync cache invalidation after session recovery.
  The HTTP module no longer registers `sync:update` when signed-out startup
  imports it; AppContext installs the one-shot cache listener only after the
  recoverable-session gate passes. Docker-served Playwright proof on hash
  `81223d01f14bfad9` observed signed-out `/login` with `listeners: []`,
  `intervals: []`, and `timeouts: []`, while authenticated Dashboard still
  registered `sync:update`, sync/auth listeners, websocket polling, and
  `/api/dashboard/startup` HTTP 200 with zero console or failed-request noise.
- Move 451 defers the pending-sync polling interval after startup. The app
  keeps immediate event-driven pending-sync refreshes, but starts the periodic
  20 second poll only after the 30 second startup window. Docker-served
  Playwright proof on hash `e473ce0cdd641ad7` observed signed-out `/login`
  with empty listener/interval/timeout probes, and authenticated Dashboard
  with websocket intervals `500` and `3000` only, no startup `20000`
  pending-sync interval, deferred `30000` timers scheduled, and
  `/api/dashboard/startup` HTTP 200 with zero console or failed-request noise.
- Move 452 gates session recovery, active health, websocket lifecycle, and UI
  focus-recovery listeners after session recovery. `web-api.ts`,
  `api/http.ts`, `api/websocket.ts`, and `App.tsx` now keep those public-route
  side effects behind explicit authenticated installers. Docker-served
  Playwright proof on hash `cb858c5ce1c60aa4` observed signed-out `/login`
  with no recovery listeners, no visibility listener, no WebSocket, no
  intervals, expected unauthenticated bootstrap 401, and zero relevant console
  noise. Authenticated Dashboard still registered recovery listeners, opened
  one WebSocket, started intervals `30000`, `25000`, `500`, and `3000`,
  returned `/api/dashboard/startup` HTTP 200, and had zero failed requests or
  relevant console messages.
- Move 453 consolidates authenticated browser lifecycle recovery listeners.
  `web-api.ts` now owns online/focus/visible recovery and calls
  `resumeWS()`, `startHealthCheck()`, `pingServerHealth()`, and offline
  maintenance from one listener set. `api/http.ts` keeps only the offline
  health flip, and `api/websocket.ts` keeps auth suppression plus `resumeWS()`
  instead of duplicating online/focus/visibility listeners. Docker-served
  Playwright proof on hash `254ace63c1c99efe` observed signed-out `/login`
  with zero recovery listeners/WebSocket/intervals, and authenticated
  Dashboard with one online listener, two focus listeners, three visibility
  listeners, one WebSocket, `/api/dashboard/startup` HTTP 200, and zero
  relevant console noise.
- Move 454 records roadmap Move 723: gate the background import tracker to
  real import activity. `App.tsx` now keeps the tracker out of normal
  navigation until a 180 second idle window or an explicit
  `import-job:activity` event, and `importJobsTransport.ts` emits that event
  only for real import job create/start/upload/cancel/retry/delete work.
  `BackgroundImportTracker` no longer imports the shared Settings `Trash2`
  icon, so Vite does not make Settings/Backup navigation fetch the tracker
  chunk as a shared icon carrier. Docker-served Playwright proof on hash
  `cb6332a2ac6f7165` shows the broad Phase 8.4 UI live check produced zero
  `background-import-tracker` and zero `/api/import-jobs` requests during
  normal route exercise. A focused probe confirmed generic product,
  inventory, and bare imports sync events kept the tracker dark, while
  explicit `import-job:activity` loaded `background-import-tracker-C6QiW-VT.js`
  and `/api/import-jobs?limit=8` at HTTP 200.
- Move 455 records roadmap Move 724: trim public portal editor-only chunks
  from first load. The public catalog route now keeps editor-only upload and
  file-picker behavior behind admin/editor interaction gates, and Vite assigns
  `public-asset-urls`, `favicon-utils`, and editor-only `CatalogImageField`
  to explicit chunks so the public chunk graph is honest. Docker-served build
  hash `e37146866b299666` passed TypeScript, JSX/source checks, the frontend
  utility suite, production build, local Docker health/build metadata checks,
  public Cloudflare Playwright, and broad Phase 8.4 UI Playwright. The public
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T17-37-37-400Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, enforced CSP, and no first-load
  `file-picker-modal`, `media-upload-utils`, or `image-lightbox` requests.
  The broad report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T17-38-20-661Z/report.json`
  kept the admin app loaders healthy with zero relevant console messages.
- Move 456 records roadmap Move 725: split public portal API bootstrap from
  the legacy API/Dexie registry. The public portal now lazy-loads
  `portalTransport.ts` through a focused `app-portal` chunk, while admin-only
  methods continue to fall through the legacy registry. `web-api.ts` skips
  public IndexedDB bootstrap mirror writes, `vite.config.ts` assigns
  `portalTransport.ts` plus `portalHttp.ts` to `app-portal`, and shared
  catalog icons no longer live in `auth-login`. Docker-served build hash
  `cbfed31b11f3c265` passed focused guards, typecheck, source checks,
  frontend utility tests, production build, local `/public`, Docker live sync,
  public Cloudflare Playwright, and broad Phase 8.4 UI Playwright. The public
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T18-58-27-864Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, enforced CSP, and no first-load `auth-login`,
  `app-api-methods`, `vendor-dexie`, `app-auth`, or `app-local-db` requests.
  The broad report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T19-20-44-127Z/report.json`
  kept the admin app helper loaders at HTTP 200 with zero relevant console
  messages.
- Move 457 records roadmap Move 726: lazy-load public portal transport from
  the legacy API registry. The remaining `api/methods.ts` registry no longer
  statically imports `portalTransport.ts`; legacy/admin fallback methods use a
  memoized dynamic boundary. Docker-served build hash `73fbae6ef77ff4b8`
  passed API HTTP source coverage, the performance loading guard, frontend
  typecheck, source checks, production build, emitted chunk scans, Docker live
  sync, public Cloudflare Playwright, and broad Phase 8.4 UI Playwright. The
  emitted `app-api-methods-DGc6nbrI.js` chunk is 60,808 bytes and contains no
  portal endpoint strings, while `app-portal-DTjuMQBz.js` owns the portal
  endpoints at 2,747 bytes. The public report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T19-48-47-456Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, enforced CSP, and the expected focused portal
  chunk request. The broad report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T19-49-20-982Z/report.json`
  kept all checked admin/helper paths at HTTP 200 with zero relevant console
  messages.
- Move 458 records roadmap Move 728: coalesce Products/POS filter loads and
  speed live audit loops. Products and POS now allow one active
  product/catalog request plus one pending latest-state reload during rapid
  filter/search/page changes, which keeps visible route state current without
  sending every intermediate state to `/api/products/search`. The all-pages
  audit harness also uses shorter configurable settle waits, records route
  filters/time budgets in summaries, and waits for file chooser events only on
  likely file/media controls. Docker-served build hash `da6ef8d8e9971506`
  passed frontend source checks, typecheck, production build, Docker
  release/update, focused all-pages route slice, filter burst proof, public
  Cloudflare Playwright, and exhaustive all-pages desktop/mobile Playwright.
  The burst proof `ops/runtime/reports/filter-burst-check-latest.json`
  produced one `/api/products/search` response per three-click burst on
  desktop/mobile Products and POS, all HTTP 200. The exhaustive report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T01-39-09-836Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 386, skipped 133 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 459 records roadmap Move 729: cache POS catalog metadata during
  filter/search/page reloads. The POS route now separates product application
  from category/branch/filter metadata application: first route-ready load
  fetches metadata, ordinary catalog reloads fetch products only, and
  branch/category sync forces a metadata refresh. The live
  `filter-burst-check` now counts `/api/categories`, `/api/branches`, and
  `/api/products/filters` as metadata responses and fails if any appear during
  a post-ready burst. Docker-served build hash `25a697370460f92b` passed
  source checks, typecheck, production build, Docker release/update, focused
  Products/POS/Public route-control sweep, public Cloudflare Playwright, and
  full desktop/mobile all-pages Playwright. The burst proof
  `ops/runtime/reports/filter-burst-check-latest.json` produced one
  `/api/products/search` response and zero metadata responses per three-click
  burst on desktop/mobile Products and POS. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-16-24-667Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 384, skipped 134 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 460 records roadmap Move 730: dedupe public portal AI status and make
  all-pages audit route timing route-ready by default. `CatalogPage` now keeps
  one public AI status request per provider key unless the request fails or
  public AI is disabled, removing the duplicate `/api/portal/ai/status` call
  seen during the default-config/fetched-config render sequence. The all-pages
  audit now skips network-idle waits unless
  `BOS_ALL_PAGES_WAIT_NETWORK_IDLE=1`, so route timings reflect first useful
  UI readiness instead of background quiet. Docker-served build hash
  `ca7fbc36b3f8c914` passed source checks, typecheck, production build, Docker
  release/update, local public Playwright load trace, focused Public Catalog
  route-control sweep, public Cloudflare Playwright, and full desktop/mobile
  all-pages Playwright. The load trace
  `ops/runtime/reports/public-load-trace-latest.json` measured root attached
  at 192 ms, first visible product/search text at 248 ms, network idle at
  3.8 s, one AI status request, and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-41-33-682Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 380, skipped 138 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 461 records roadmap Move 731: initialize direct admin routes from the
  current URL before the app shell mounts and move Sales/Returns into the
  narrow delayed page-entry warmup set. `AppContext` now derives initial page
  state with `getAdminPageFromPath(window.location.pathname)`, so direct
  `/returns`, `/pos`, `/inventory`, and `/server` entries no longer mount
  Dashboard first or pull Dashboard chart/startup chunks into the first-load
  window. The top-route trace
  `ops/runtime/reports/top-route-load-trace-latest.json` reduced Returns from
  68 to 37 first-window requests, POS from 52 to 49, Inventory from 46 to 43,
  and Server from 36 to 33, with zero failed requests and zero console/page
  errors. Docker-served build hash `e2b70d07090424d9` passed frontend utility
  tests, JSX/source check, typecheck, production build, Docker release/update,
  focused Inventory/POS/Returns/Server route-control audit, public Cloudflare
  Playwright, and full desktop/mobile all-pages Playwright. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-06-28-636Z/summary.json`
  covered 34 routes, discovered 520 controls, exercised 384, skipped 136 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 462 records roadmap Move 732: add focused route-load tracing and
  defer Sales background history/user reads. The new
  `ops/scripts/runtime/live-checks/route-load-trace.ts` script records route
  ready timing, total requests, API requests, script requests, failed requests,
  and console/page errors for selected routes. Sales now gates
  `useActionHistory()` behind a post-ready `historyReady` delay, preserving
  local undo/redo recording while moving server action-history and admin user
  option reads out of the first route window. Docker-served build hash
  `696ba3a8fffee895` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, focused
  Dashboard/Inventory/Sales/Audit Log control audit, public Cloudflare
  Playwright, and full desktop/mobile all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced Sales
  first-window API requests from 4 to 2 and reported zero failed requests and
  zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-32-00-189Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 381, skipped 138 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 463 records roadmap Move 733: defer Returns background history/user
  reads and make broad all-pages control sequencing smarter. Returns now gates
  `useActionHistory()` behind a post-ready `historyReady` delay, preserving
  local undo/redo recording while moving server action-history and admin user
  option reads out of the first route window. The all-pages Playwright harness
  now clicks Filters/History/Collapse style controls before import/export
  surfaces and restores the route before final layout/screenshot collection.
  Docker-served build hash `e01139c6b67c1fea` passed frontend utility tests,
  JSX/source check, production build, Docker release/update, focused
  route-load trace, focused Sales/Returns route-control audit, public
  Cloudflare Playwright, and full desktop/mobile all-pages Playwright. The
  focused trace `ops/runtime/reports/route-load-trace-latest.json` reduced
  Returns first-window API requests from 4 to 2 and reported zero failed
  requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T04-18-20-042Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 381, skipped 138 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 464 records roadmap Move 734: defer the Server page online-count health
  probe out of the first route window. `ServerPage` now waits on
  `SERVER_ONLINE_CHECK_READY_DELAY_MS` before the initial card-level online
  device count check, while keeping immediate app sync status, system debug
  log, system config, and the 10 second refresh interval. Docker-served build
  hash `f3bf6be019ef79a0` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, focused
  Server/Products/Inventory/POS route-control audit, public Cloudflare
  Playwright, and full desktop/mobile all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced Server
  first-window API requests from 5 to 3 and total requests from 33 to 31, with
  zero failed requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-01-14-100Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 382, skipped 137 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 465 records roadmap Move 735: defer Products action-history and admin
  user-option reads out of the first route window. `Products` now waits on
  `PRODUCTS_HISTORY_READY_DELAY_MS` before enabling server action history,
  while preserving immediate product search, lookup/filter metadata, and local
  undo/redo recording for real product writes. Docker-served build hash
  `f3aa7ba4ab674f79` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, focused
  Products/Inventory/POS/Server route-control audit, public Cloudflare
  Playwright, and full desktop/mobile all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced Products
  first-window API requests from 8 to 6 and total requests from 46 to 44, with
  zero failed requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-22-24-340Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 381, skipped 138 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 466 records roadmap Move 736: defer Inventory action-history and admin
  user-option reads out of the first route window. `Inventory` now waits on
  `INVENTORY_HISTORY_READY_DELAY_MS` before enabling server action history,
  while preserving immediate bootstrap, branches, inventory product search,
  the movement filter's on-demand user loader, and local undo/redo recording
  for real inventory writes. Docker-served build hash `beab212aef40e70f`
  passed frontend utility tests, JSX/source check, production build, Docker
  release/update, focused route-load trace, focused Inventory/Products/POS/
  Server route-control audit, public Cloudflare Playwright, and full
  desktop/mobile all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced Inventory
  first-window API requests from 5 to 3 and total requests from 43 to 41, with
  zero failed requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-41-43-994Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 378, skipped 141 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 467 records roadmap Move 737: defer POS customer and delivery option
  reads out of the first route window. `POS` now waits for the first catalog
  load to settle and then enables contact option loading behind
  `POS_CONTACT_OPTIONS_READY_DELAY_MS`, preserving immediate bootstrap,
  branches, categories, product search, product filters, quick-add
  customer/delivery writes, membership lookup, discounts, and checkout.
  Docker-served build hash `45a502aeada4c721` passed frontend utility tests,
  JSX/source check, production build, Docker release/update, focused
  route-load trace, focused POS/Inventory/Products/Server route-control audit,
  public Cloudflare Playwright, and full desktop/mobile all-pages Playwright.
  The focused trace `ops/runtime/reports/route-load-trace-latest.json`
  reduced POS first-window API requests from 7 to 5 and total requests from 49
  to 47, with zero failed requests and zero console/page errors. The full
  report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-05-09-969Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 378, skipped 140 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 468 records roadmap Move 738: defer Products full filter metadata out
  of the first route window. `Products` now waits for the first product load to
  settle and then enables `/api/products/filters` behind
  `PRODUCTS_FILTER_META_READY_DELAY_MS`, while the first search payload still
  seeds lightweight brand/category/supplier/initial filter hints. Docker-served
  build hash `3dfa9015ce1870dc` passed frontend utility tests, JSX/source
  check, production build, Docker release/update, focused route-load trace,
  focused Products/POS/Inventory/Server route-control audit, public
  Cloudflare Playwright, and full desktop/mobile all-pages Playwright. The
  focused trace `ops/runtime/reports/route-load-trace-latest.json` reduced
  Products first-window API requests from 6 to 5 and total requests from 44 to
  43, with zero failed requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-45-34-334Z/summary.json`
  covered 34 routes, discovered 519 controls, exercised 380, skipped 139 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 469 records roadmap Move 739: defer POS full filter metadata out of
  the first route window. `POS` now waits for the first catalog load to settle
  and then enables `/api/products/filters` behind
  `POS_FILTER_META_READY_DELAY_MS`, while the first product search payload still
  seeds lightweight brand/supplier/initial filter hints. Docker-served build
  hash `e24069f961a21ccd` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, focused
  POS/Products/Inventory/Server route-control audit, public Cloudflare
  Playwright, and full desktop/mobile all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced POS first-window
  API requests from 5 to 4 and total requests from 47 to 46, with zero failed
  requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-09-56-238Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 378, skipped 140 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 470 records roadmap Move 740: defer Products auxiliary category/unit/
  branch options out of the first route window. `Products` now waits for the
  first product load to settle and then enables category, unit, and branch
  lookup reads behind `PRODUCTS_AUX_OPTIONS_READY_DELAY_MS`, while option-
  dependent UI can wake the same loader immediately. Docker-served build hash
  `b5ac468402187aa5` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, delayed
  Products wake trace, focused Products/POS/Inventory/Server route-control
  audit, public Cloudflare Playwright, and full desktop/mobile all-pages
  Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced Products
  first-window API requests from 5 to 2 and total requests from 43 to 40, with
  zero failed requests and zero console/page errors. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-33-46-064Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 377, skipped 141 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 471 records roadmap Move 741: defer POS category options out of the
  first route window. `POS` now keeps bootstrap, branches, and first product
  search in the route-ready batch, then loads categories through a tracked
  delayed loader behind `POS_CATEGORY_OPTIONS_READY_DELAY_MS`; opening the
  filter panel wakes category options immediately. Docker-served build hash
  `bfa5413c3b822243` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, delayed
  POS wake trace, focused Products/POS/Inventory/Server route-control audit,
  public Cloudflare Playwright, and full desktop/mobile all-pages Playwright.
  The focused trace `ops/runtime/reports/route-load-trace-latest.json` reduced
  POS first-window API requests from 4 to 3 and total requests from 46 to 45,
  with zero failed requests and zero console/page errors. The delayed trace
  `ops/runtime/reports/route-load-trace-2026-06-03T09-55-22-507Z.json` proved
  `/api/categories` wakes around 2.3 s beside contact options and full product
  filters. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-58-08-520Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 377, skipped 141 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 472 records roadmap Move 742: defer Branches server action-history
  and admin user-option reads out of the first route window. `Branches` now
  waits for the branch list and summary to settle, then enables
  `useActionHistory` behind `BRANCHES_HISTORY_READY_DELAY_MS`, keeping local
  undo/redo action pushes intact while moving `/api/users` and
  `/api/action-history...` after route-ready. Docker-served build hash
  `ab34fc8688353364` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, delayed
  Branches wake trace, focused Branches/Products/POS/Inventory/Server
  route-control audit, public Cloudflare Playwright, and full desktop/mobile
  all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-latest.json` reduced Branches
  first-window API requests from 5 to 3 and total requests from 36 to 34, with
  zero failed requests and zero console/page errors. The delayed trace
  `ops/runtime/reports/route-load-trace-2026-06-03T10-18-05-277Z.json` proved
  `/api/users` and `/api/action-history...` wake around 2.3 s. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T10-21-23-872Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 377, skipped 141 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 473 records roadmap Move 743: defer Files, Users, and Backup server
  action-history reads out of the first route window. `FilesPage` waits for the
  first file library load to settle, `Users` waits for the first users load to
  settle, and `Backup` waits for the lightweight overview to render before
  enabling `useActionHistory`, keeping local undo/redo action pushes intact
  while moving `/api/users` and `/api/action-history...` after route-ready.
  Docker-served build hash `211a8ad974753d8e` passed frontend utility tests,
  JSX/source check, production build, Docker release/update, focused route-load
  trace, delayed history wake trace, focused Backup/Files/Users/Server
  route-control audit, public Cloudflare Playwright, and full desktop/mobile
  all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T10-45-03-014Z.json` reduced
  Backup first-window API requests from 3 to 1, Files from 4 to 2, and Users
  from 4 to 3, with zero failed requests and zero console/page errors. The
  delayed trace
  `ops/runtime/reports/route-load-trace-2026-06-03T10-43-53-491Z.json` proved
  `/api/users` and `/api/action-history...` wake around 2.1-2.3 s. The full
  report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T10-50-19-615Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 371, skipped 147 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 474 records roadmap Move 744: defer Contacts server action-history and
  admin user-option reads out of the first route window. `CustomersTab`,
  `SuppliersTab`, and `DeliveryTab` now wait for their first contact data load
  to settle, then enable `useActionHistory` behind a 1.8 s post-ready gate,
  keeping local undo/redo action pushes intact while moving `/api/users` and
  `/api/action-history...` after route-ready. Docker-served build hash
  `2e7905d575e826a0` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused route-load trace, delayed
  history wake trace, focused Contacts route-control audit, public Cloudflare
  Playwright, and full desktop/mobile all-pages Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T11-06-34-317Z.json` reduced
  Contacts first-window API requests from 4 to 2 and total requests from 41 to
  39, with zero failed requests and zero console/page errors. The delayed trace
  `ops/runtime/reports/route-load-trace-2026-06-03T11-06-34-357Z.json` proved
  `/api/users` and `/api/action-history...` wake around 2.6 s. The full report
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T11-07-36-285Z/summary.json`
  covered 34 routes, discovered 518 controls, exercised 369, skipped 149 by
  stable broad-audit guardrails, captured 68 screenshots, and recorded zero
  failures or findings.
- Move 475 records roadmap Move 745: make the public portal product-first and
  defer nonessential map/AI work. `CatalogPage` now defaults the public route
  to Products when catalog display is enabled, only mounts the Google Maps
  iframe when About is visible, and requests `/api/portal/ai/status` only after
  the Assistant tab is active. Docker-served build hash `02444cf84d29ee29`
  passed frontend utility tests, JSX/source check, production build, Docker
  release/update, focused public route-load trace, and public Cloudflare
  Playwright with a real Assistant tab click. The focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T11-27-44-386Z.json` reduced
  public_catalog from 27 total requests, 4 API requests, and one failed Google
  Maps document to 25 total requests, 3 API requests, zero failed requests, and
  zero console/page errors. The Cloudflare report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T11-27-43-868Z/report.json`
  rendered 20 products, confirmed AI status is absent before interaction, then
  clicked Assistant and observed AI status HTTP 200 with zero relevant console/
  page errors.
- Move 476 records roadmap Move 746: collapse the public portal first-load
  config/meta/search waterfall into one `/api/portal/bootstrap` response.
  `CatalogPage` now uses bootstrap config, metadata, products, and pagination,
  then skips the already-satisfied search effect once so normal searches and
  filters still use the existing search endpoint. Docker-served build hash
  `26f11137bb93baee` passed frontend utility tests, JSX/source check,
  production build, Docker release/update, focused public route-load trace,
  public Cloudflare Playwright, and broad Phase 8.4 UI Playwright. The focused
  trace `ops/runtime/reports/route-load-trace-2026-06-03T11-40-35-980Z.json`
  shows public_catalog at 23 total requests, 1 API request, zero failed
  requests, and zero console/page errors. The Cloudflare report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T11-40-45-423Z/report.json`
  rendered 20 products, confirmed bootstrap HTTP 200, confirmed AI status is
  absent before interaction, then clicked Assistant and observed AI status HTTP
  200 with zero relevant console/page errors. The broad Phase 8.4 report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T11-42-12-482Z/report.json`
  passed with `publicPortalBootstrapStatus: 200`.
- Move 477 records roadmap Move 747: collapse the Server page first-load
  security config and initial diagnostics reads into one authenticated
  `/api/system/bootstrap` response. The backend keeps `/api/system/config` and
  `/api/system/debug/log` available, but they now share payload builders with
  bootstrap; `ServerPage` seeds security config and Diagnostics from bootstrap
  and lets diagnostics refresh after startup. Docker-served build hash
  `05d5d4b5fb849663` passed frontend utility tests, frontend JSX/source check,
  backend utility tests, production build, Docker release/update, focused
  Server route-load trace, broad Phase 8.4 UI Playwright, and public
  Cloudflare Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T11-57-06-358Z.json` shows
  Server at 30 total requests, 2 API requests, zero failed requests, and zero
  console/page errors. The broad Phase 8.4 report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T11-58-20-197Z/report.json`
  passed with `serverBootstrapStatus: 200`, no framework overlay, and zero
  relevant console messages.
- Move 478 records roadmap Move 748: collapse POS first-window branch metadata
  and product catalog reads into `/api/products/bootstrap`. The backend now
  shares the product search payload builder between the old search route and
  bootstrap, and POS uses the combined route only while first metadata is
  needed. Docker-served build hash `19487bd8a970df74` passed frontend utility
  tests, JSX/source check, backend utility tests, production build, Docker
  release/update, focused multi-route Playwright trace, broad Phase 8.4 UI
  Playwright, and public Cloudflare Playwright. The focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T12-16-06-540Z.json` reduced
  POS first-window work from 45 total requests and 3 API requests to 44 total
  requests and 2 API requests, with zero failed requests and zero console/page
  errors. The first-window POS APIs are now `/api/auth/bootstrap` and
  `/api/products/bootstrap?...include=branch_stock,images,family`. The same
  pass pruned 238,110,370 bytes of old reports, 100,882,733 bytes of old
  Docker-release backups, and 38.06 MB of Docker builder cache.
- Move 479 records roadmap Move 749: collapse Inventory product-section
  startup branch metadata and product summary reads into
  `/api/inventory/bootstrap`. The backend now shares the inventory product
  search payload builder between the legacy `/api/inventory/products/search`
  route and bootstrap, and `Inventory.tsx` uses the combined route only when
  Products is the visible startup section. Docker-served build hash
  `877b43b78c35bc00` passed frontend utility tests, JSX/source check, backend
  utility tests, production build, Docker release/update, focused multi-route
  Playwright trace, broad Phase 8.4 UI Playwright, public Cloudflare
  Playwright, storage pruning, and `git diff --check`. The focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T12-48-29-331Z.json`
  reduced Inventory from 41 total requests and 3 API requests to 40 total
  requests and 2 API requests, with zero failed requests and zero console/page
  errors. First-window Inventory APIs are now `/api/auth/bootstrap` and
  `/api/inventory/bootstrap`. The broad Phase 8.4 report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T12-49-01-316Z/report.json`
  passed with `inventoryBootstrapStatus: 200`, and the public Cloudflare
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T12-49-52-154Z/report.json`
  rendered 20 products with zero failed responses, console messages, or page
  errors. Storage pruning removed 295,764 bytes of old reports, 4,827,993
  bytes of old Docker-release backup data, and 76.13 MB of Docker builder
  cache.
- Move 480 records roadmap Move 750: split cross-route Lucide icon ownership
  away from `notification-center` and tighten notification wakeups to explicit
  notification-shaped events. The Docker-served trace
  `ops/runtime/reports/route-load-trace-2026-06-03T13-23-37-802Z.json` shows
  `notification=none` for dashboard, products, inventory, POS, sales, returns,
  backup, contacts, server, and public_catalog. Products now uses
  `shared-icons-1LAsiUVr.js` instead of `notification-center`; Backup fell
  31->29 requests and 27->25 scripts, Server fell 30->28 requests and
  25->23 scripts, and all routes had zero failed requests and zero
  console/page errors. Broad Phase 8.4 UI Playwright verified
  `notificationPanelVisible: true`, and public Cloudflare Playwright rendered
  20 products with zero relevant console/page errors.
- Move 481 records roadmap Move 751: split reusable product primitives,
  action guards, small catalog helper modules, and Catalog/admin-shared Lucide
  icons out of the heavy Catalog route chunk. The Docker-served trace
  `ops/runtime/reports/route-load-trace-2026-06-03T13-53-46-619Z.json` shows
  `catalog=none` for dashboard, products, inventory, POS, sales, returns,
  backup, contacts, and server, while public_catalog still loads Catalog by
  design. Backup fell 29->26 requests and 25->22 scripts, Server fell 28->25
  requests and 23->20 scripts, and Sales/Returns/Contacts each dropped two
  first-window scripts with zero failed requests and zero console/page errors.
  Broad Phase 8.4 UI Playwright and public Cloudflare Playwright passed on
  Docker image `business-os:v6.0.0-202606032143`.
- Move 482 records roadmap Move 752: keep Dexie/local DB and system helper
  chunks out of healthy first-route loads. Local DB usage now goes through
  `lazyLocalDb.ts` for transport fallback paths, CSV template/download helpers
  no longer sit in the local DB chunk, healthy-server local fallbacks start
  only after the fallback timer/server failure path, and sensitive mirror purge
  runs in a delayed idle slot. Server bootstrap/config/debug/test calls use the
  narrow `app-system` transport, and pending sync queue diagnostics load only
  after the Queue tab is active. Docker image
  `business-os:v6.0.0-202606032321` served the final proof trace
  `ops/runtime/reports/route-load-trace-2026-06-03T15-23-15-920Z.json`:
  dashboard 211 ms, products 233 ms, inventory 240 ms, POS 287 ms, sales
  200 ms, returns 202 ms, backup 230 ms, contacts 239 ms, server 215 ms, and
  public_catalog 242 ms, all with zero failed requests and zero console/page
  errors. Chunk analysis showed `app-local-db=none` and `vendor-dexie=none` on
  all ten traced routes in the first 600 ms, `system=none` on domain routes,
  and `app-system` only on Server. A live Server Queue-tab Playwright click
  then loaded `app-api-methods`, `app-local-db`, and `vendor-dexie` on demand,
  rendered pending/syncing/failed counters, and recorded zero console/page
  errors.
- Move 483 records roadmap Move 753: intent-load shared portal positioning
  menus across Products, Contacts, and reusable filter/action surfaces. The
  focused Docker-served trace
  `ops/runtime/reports/route-load-trace-2026-06-03T16-17-24-309Z.json` shows
  Products, Inventory, POS, Sales, Returns, and Contacts route-ready in
  187-318 ms with zero failed requests or console/page errors, and no
  `shared-portal-menu`, `app-local-db`, or `vendor-dexie` chunk in the first
  600 ms. The live Playwright proof
  `ops/runtime/reports/lazy-portal-menu-live-check-2026-06-03T16-20-20-068Z/report.json`
  clicked Products Filters and Contacts row actions, loaded
  `shared-portal-menu-D4vj-XWE.js` only after intent, opened both menus, and
  recorded zero relevant console/page errors. Docker image
  `business-os:v6.0.0-202606040015` serves the verified runtime.
- Move 484 records roadmap Move 754: memoize Inventory product and movement
  filtering before grouping. `Inventory.tsx` now keeps `searchTerms`,
  `matchesSearch`, `productHay`, `movHay`, `filteredSummary`, and
  `filteredMovements` stable unless their real inputs change, preventing
  unrelated UI state from repeatedly rebuilding product sections and grouped
  movement history. Docker image `business-os:v6.0.0-202606040046` served the
  live timing proof
  `ops/runtime/reports/initial-filter-timing-2026-06-03T17-00-58-548Z/report.json`:
  Products `G288` completed in 520 ms, Inventory `G` in 491 ms, and public
  catalog `G` in 519 ms, all HTTP 200 with zero relevant console/page errors.
  The focused route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-01-16-586Z.json`
  measured Products 213 ms, Inventory 202 ms, POS 292 ms, and public_catalog
  196 ms route-ready, all with zero failed requests and zero console/page
  errors.
- Move 485 records roadmap Move 755: intent-load the public catalog language
  menu. `CatalogPreviewSurface.tsx` now uses `LazyPortalMenu` for translation
  tools, and the performance-loading guard prevents reintroducing the
  React.lazy `PortalMenu` first-route path. Docker image
  `business-os:v6.0.0-202606040111` served the focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-14-07-644Z.json`:
  public_catalog was ready in 229 ms with 28 requests and 23 scripts, zero
  failed requests, zero console/page errors, and no first-window
  `shared-portal-menu`. The mobile click proof
  `ops/runtime/reports/public-language-menu-live-check-2026-06-03T17-18-31-063Z/report.json`
  then loaded `shared-portal-menu-D4vj-XWE.js` only after the Language tools
  click, rendered language options, and recorded zero relevant console/page
  errors.
- Move 486 records roadmap Move 756: isolate shared Khmer script typography
  helpers into their own manual chunk. `vite.config.ts` now assigns
  `src/utils/scriptTypography.ts` to `script-typography`, and the
  performance-loading guard prevents that helper from being re-owned by public
  catalog preview. Docker image `business-os:v6.0.0-202606040128` served the
  focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-31-19-384Z.json`:
  Products 272 ms, Inventory 232 ms, POS 335 ms, and public 199 ms route-ready,
  all with zero failed requests and zero console/page errors. The request parse
  confirmed Products, Inventory, and POS loaded `script-typography-avi8xpqd.js`
  and no `catalog-preview`, `catalog-ui`, or `catalog-display` chunks, while
  `/public` still loaded those catalog chunks by design.
- Move 487 records roadmap Move 757: remove POS's accidental dependency on
  customer-management route code. `POS.tsx` now imports
  `parseStoredContactOptions` directly from `contactOptionUtils` and keeps a
  local `parseContactOptions` wrapper for the customer option picker, while the
  performance-loading guard prevents POS from importing `CustomersTab`.
  Docker image `business-os:v6.0.0-202606040138` served the focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-40-43-530Z.json`: POS
  was ready in 281 ms with 33 requests and 25 scripts, down from 42 requests
  and 34 scripts in the prior focused trace, with zero failed requests and zero
  console/page errors. POS loaded `contactOptionUtils-BSXveFTP.js` and no
  `CustomersTab`, `Contacts`, or `CustomerFormModal` chunks.
- Move 488 records roadmap Move 758: intent-load POS filter panel. `POS.tsx`
  now lazy-loads `FilterPanel` only while `filterOpen` is true, and the
  performance-loading guard prevents a static `FilterPanel` import from
  returning. Docker image `business-os:v6.0.0-202606040149` served the focused
  trace `ops/runtime/reports/route-load-trace-2026-06-03T17-51-33-389Z.json`:
  POS was ready in 302 ms with 32 requests and 24 scripts, down from 33
  requests and 25 scripts in the prior focused trace, with zero failed requests
  and zero console/page errors. The first-window script parse had no
  `FilterPanel` chunk, and a live Filters click loaded
  `FilterPanel-BSgPp0Gy.js` only after intent and rendered Stock Status and
  Groups controls.
- Move 489 records roadmap Move 759: split POS product-read startup from the
  broad API methods registry. `POS.tsx` now calls `productReadTransport.ts`
  directly for catalog bootstrap/search and delayed product-filter metadata,
  while `vite.config.ts` assigns the read boundary to `product-read-api`.
  Docker image `business-os:v6.0.0-202606040205` served the focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T18-07-22-223Z.json`: POS
  was ready in 244 ms with 30 requests and 22 scripts, down from 302 ms, 32
  requests, and 24 scripts in Move 758, with zero failed requests and zero
  console/page errors. The first-window script parse loaded
  `product-read-api-DbMd_KMA.js` and did not load `app-api-methods` or
  `csv-utils`. A live POS interaction then typed `mask`, opened Filters, and
  verified Stock Status and Groups controls; the post-click script list loaded
  `FilterPanel-BSgPp0Gy.js` on intent and exposed delayed category options as
  the next source of `app-api-methods`/`csv-utils`.
- Move 490 records roadmap Move 760: keep POS filter-open category lookups
  out of the broad API methods registry. `POS.tsx` now calls
  `lookupTransport.ts` directly for category options, while `vite.config.ts`
  keeps `lookupTransport.ts` and `expectedUpdatedAt.ts` in the
  `product-read-api` manual chunk with product read helpers. Docker image
  `business-os:v6.0.0-202606040219` served the focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T18-22-00-988Z.json`: POS
  was ready in 262 ms with 30 requests and 22 scripts, with zero failed
  requests and zero console/page errors. A live POS interaction typed `mask`,
  opened Filters, and verified Stock Status and Groups controls; the pre-click
  scripts had `product-read-api`, no `app-api-methods`, no `csv-utils`, and no
  `FilterPanel`, while the post-click script list added only
  `truck-Y2SFGnKm.js` and `FilterPanel-BSgPp0Gy.js`.
- Move 491 records roadmap Move 761: keep POS delayed customer and
  delivery-contact option reads out of the broad API methods registry.
  `POS.tsx` now lazy-loads `contactReadTransport.ts`, while `vite.config.ts`
  assigns that read boundary to the separate 1.31 kB `contact-read-api` chunk.
  Route-level local mirror writes wait beyond the first route/interaction
  windows so IndexedDB/Dexie and CSV helpers do not wake during read-only POS
  browsing. Docker image `business-os:v6.0.0-202606040246` served the focused
  trace `ops/runtime/reports/route-load-trace-2026-06-03T18-48-15-082Z.json`:
  POS was ready in 353 ms with 30 requests and 22 scripts, with zero failed
  requests and zero console/page errors. A live Chromium delayed-contact probe
  confirmed the first 600 ms window had no `contact-read-api`,
  `app-api-methods`, `csv-utils`, `app-local-db`, or `vendor-dexie`; after the
  delayed gate, only `contact-read-api-3bBCBgdj.js` was added and those broad
  chunks stayed unloaded through the tested customer interaction window.
- Move 492 records roadmap Move 762: keep POS membership lookup out of the
  broad API methods registry. `POS.tsx` now lazy-loads `portalTransport.ts`
  directly for `lookupPortalMembership`, reusing the focused `app-portal`
  manual chunk. Docker image `business-os:v6.0.0-202606040258` served the
  focused trace `ops/runtime/reports/route-load-trace-2026-06-03T19-00-43-680Z.json`:
  POS was ready in 268 ms with 30 requests and 22 scripts, with zero failed
  requests and zero console/page errors. A live Chromium customer-selection
  probe chose existing membership customer `Customer 1`; the first window had
  no `app-portal`, `app-api-methods`, `csv-utils`, `app-local-db`, or
  `vendor-dexie`, and membership selection added only
  `app-portal-Bi-RHhNA.js` after the earlier delayed `contact-read-api` wake.
- Move 493 records roadmap Move 763: keep POS quick customer and
  delivery-contact create writes out of the broad API methods registry.
  `POS.tsx` now lazy-loads `contactWriteTransport.ts` for Add Customer and
  Add Delivery saves, and `vite.config.ts` assigns that boundary to
  `contact-write-api`. The new transport posts directly to `/api/customers`
  and `/api/delivery-contacts`, adds device metadata, and owns a local
  client-request-id helper so the intent chunk does not import `requestIds.ts`,
  `app-api-methods`, or CSV helpers. `contactReadTransport.ts` now dynamically
  imports `lazyLocalDb.ts` and `localMirrors.ts`, preventing the read chunk
  from waking `app-local-db`, `vendor-dexie`, or CSV code during the first
  read windows. Docker image `business-os:v6.0.0-202606040328` served the
  focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T19-31-04-184Z.json`: POS
  was ready in 275 ms with 30 requests and 22 scripts, with zero failed
  requests and zero console/page errors. A headed live Chromium probe used the
  actual POS Add Customer and Add Delivery buttons, saved both records, deleted
  the created customer id `4` and delivery contact id `4`, and confirmed exact
  post-cleanup searches returned zero remaining rows. The create flow loaded
  only `contact-read-api-DS-Y1Uow.js` and `contact-write-api-BlLnWfno.js`;
  `app-api-methods`, `csv-utils`, `app-local-db`, and `vendor-dexie` stayed
  unloaded. Post-live hygiene removed four matching QA audit-log entries.
- Move 494 records roadmap Move 764: keep POS checkout sale writes out of the
  broad API methods registry. `POS.tsx` now lazy-loads
  `saleWriteTransport.ts` for Done -> Completed checkout, and `vite.config.ts`
  assigns that boundary to `sale-write-api`. The new transport owns sale
  create, pending offline sale queue retry, client request ids, mirror writes,
  retry/backoff, conflict marking, sync events, and background sync
  registration without importing `methods.ts`, `salesTransport.ts`,
  `requestIds.ts`, `app-api-methods`, or CSV helpers. Docker image
  `business-os:v6.0.0-202606040354` served the focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T19-56-35-700Z.json`: POS
  was ready in 245 ms with 30 requests and 22 scripts, with zero failed
  requests and zero console/page errors. A headed live Chromium checkout probe
  used the real POS product search/card click, `Exact $`, `Done`, and
  `Completed` controls, reached receipt preview, confirmed the sale through
  `/api/sales`, and loaded only `sale-write-api-BDCbXrEC.js` for the sale
  write intent; `app-api-methods` and `csv-utils` stayed unloaded. Cleanup
  removed the QA sale, sale item, allocation, product, stock rows, batch rows,
  inventory movement, action-history entry, and audit log.
- Move 495 records roadmap Move 765: keep receipt PDF/image/print generators
  out of the receipt preview path. `Receipt.tsx` now dynamically imports
  `printReceipt.ts` only from Print, Open PDF, and Image export handlers, with
  a memoized module promise for repeated export clicks. Production build
  emitted `Receipt-B-UUoysE.js` at 16,162 bytes and split
  `printReceipt-C-vsIQZL.js` at 21,413 bytes, with no circular chunk warning.
  Docker image `business-os:v6.0.0-202606040412` served the focused trace
  `ops/runtime/reports/route-load-trace-2026-06-03T20-14-57-395Z.json`: POS
  was ready in 270 ms with 30 requests, 2 API requests, and 22 scripts, with
  zero failed requests and zero console/page errors. A headed live Chromium
  checkout probe reached receipt preview with zero `printReceipt-*` scripts
  loaded; clicking the real Image export button loaded
  `printReceipt-C-vsIQZL.js` and downloaded the receipt image. Cleanup removed
  the QA sale, sale item, allocation, product, stock rows, batch rows,
  inventory movement, action-history entry, and audit log.
- Move 496 records roadmap Move 766: keep Products create/delete,
  ProductForm supplier/image-upload, action-history user filters, and idle
  offline snapshot refresh out of the broad API methods registry.
  `Products.tsx` and `ProductForm.tsx` now use focused lazy transports for
  product writes, branch/stock actions, supplier options, image uploads, and
  action-history calls; `web-api.ts` delegates idle offline snapshot refresh
  and sale queue retry to focused transports instead of waking `methods.ts`.
  `vite.config.ts` now pins `contactsTransport.ts`, `salesTransport.ts`,
  `offlineSnapshotTransport.ts`, `productImageUploadTransport.ts`,
  `productWriteTransport.ts`, `actionHistoryTransport.ts`, branch, inventory,
  request-id, and product-read helpers into narrow chunks. Docker image
  `business-os:v6.0.0-202606040522` served local Products route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T21-25-11-474Z.json`:
  Products was ready in 282 ms with 37 requests, 2 API requests, and 29
  scripts, with zero failed requests and zero console/page errors. The
  Products write live check
  `ops/runtime/reports/move766-product-write-live-check-2026-06-03T21-25-13-480Z/report.json`
  created and deleted `QA Product Move766 1780521913531`, loaded
  `product-write-api-CYyuCWn_.js`, and kept `app-api-methods` unloaded before
  and after the write intent. Remote admin Products trace against
  `https://admin.leangcosmetics.dpdns.org` passed with 16 requests, 1 API
  request, 11 scripts, zero failures, and zero console/page errors. Remote
  public portal Playwright check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T21-26-13-600Z/report.json`
  rendered 20 products with portal bootstrap 200, AI status 200 after
  interaction, and zero failed responses.
- Move 497 records roadmap Move 767: keep Contacts first-load reads,
  mutations, and all-contacts export out of broad or mixed transports.
  `Contacts.tsx` and the Customers/Suppliers/Delivery tabs now lazy-load
  `contactReadTransport.ts` for reads and `contactWriteTransport.ts` for
  mutations; ZIP/CSV helpers load only after the Export action. The focused
  guard rejects `window.api`, `contactsTransport.ts`, and static CSV/ZIP
  loading in the Contacts route shell and tabs. Docker image
  `business-os:v6.0.0-202606040638` served local Contacts trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-40-29-536Z.json`:
  Contacts was ready in 269 ms with 35 requests, 2 API requests, and 30
  scripts, with zero failed requests and zero console/page errors. The 17-route
  local trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-41-45-113Z.json`
  passed every route with zero failed requests and zero console/page errors.
  Fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T22-41-45-201Z/summary.json`
  exercised 183 stable controls across 17 routes with zero failed controls.
  Remote admin Contacts trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-41-27-698Z.json`
  passed with 17 requests, 1 API request, 12 scripts, zero failures, and zero
  console/page errors. Public Cloudflare portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T22-45-03-158Z/report.json`
  rendered 20 products with portal bootstrap 200, AI status 200 after
  interaction, and zero failed responses.
- Move 498 records roadmap Move 768: keep Inventory first-load reads, stats,
  movement reads, focused user/returns/RFID/dashboard reads, and stock
  mutations out of the broad API methods registry. `Inventory.tsx` now uses
  memoized lazy loaders for focused transports, with new `returnsTransport.ts`
  and `userReadTransport.ts` boundaries plus manual chunks for `returns-api`,
  `user-read-api`, `dashboard-api`, and `rfid-api`. Docker image
  `business-os:v6.0.0-202606040703` served local Inventory trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-06-34-762Z.json`:
  Inventory was ready in 364 ms with 39 requests, 2 API requests, and 32
  scripts, with zero failed requests and zero console/page errors. The broader
  local 17-route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-07-07-709Z.json`
  measured Inventory at 227 ms with 39 requests/32 scripts and passed all
  routes with zero failures. This improves the prior Inventory first-load
  shape of 47 requests and 40 scripts from
  `ops/runtime/reports/route-load-trace-2026-06-03T22-51-14-968Z.json`.
  Fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T23-07-37-291Z/summary.json`
  exercised 184 controls across 17 routes with zero failed controls. Remote
  admin Inventory trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-07-37-804Z.json`
  passed with zero failures but still needed 6308 ms through the public
  Cloudflare/tunnel/auth path, marking tunnel latency as the next non-local
  bottleneck. Public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T23-07-37-740Z/report.json`
  rendered 20 products with portal bootstrap 200, AI status 200 after
  interaction, and zero failed responses.
- Move 499 records roadmap Move 769: defer Products CSV export helpers until
  export intent. `Products.tsx` now dynamically imports `../../utils/csv.ts`
  inside `exportProductsCsv`, and the performance guard rejects a static
  Products `downloadCSV` import. Docker image
  `business-os:v6.0.0-202606040733` served local trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-36-07-611Z.json`:
  Products was ready in 265 ms with zero failed requests/errors, POS was ready
  in 296 ms, and public catalog was ready in 215 ms. Trace parsing confirmed
  `csv-utils` is absent from Products, POS, and public first-paint scripts.
  Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-41-37-731Z.json`
  measured Products at 3443 ms and POS at 4173 ms with zero failures/errors
  and no first-paint `csv-utils`. Real public-host trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-42-27-763Z.json`
  measured `https://leangcosmetics.dpdns.org/public` at 2635 ms with zero
  failures/errors. Fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T23-37-55-737Z/summary.json`
  exercised 183 stable controls across 17 routes with zero failed controls.
- Move 500 records roadmap Move 770: split the public catalog preview,
  Products, and secondary-tab bundles. Vite now emits separate
  `catalog-preview-BjcSy4tW.js`, `catalog-products-6njbw9vv.js`, and
  `catalog-secondary-tabs-NY-SRrRp.js` chunks, while the production HTML
  modulepreload list remains limited to core startup chunks. Docker image
  `business-os:v6.0.0-202606040757` served local trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-59-46-868Z.json`:
  public catalog was ready in 190 ms with 30 requests, one API request, 25
  scripts, zero failures/errors, and no first-load `catalog-secondary-tabs`.
  Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-59-46-898Z.json` passed
  Dashboard, Products, POS, and Settings with zero failures/errors. Real
  public-host trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-59-47-108Z.json` passed
  `/public` with zero failures/errors and no first-load
  `catalog-secondary-tabs`; final direct curl samples for public/admin were
  about 0.84-0.85 s total. Fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-04T00-01-16-941Z/summary.json`
  exercised 182 stable controls across 17 routes with zero failed controls.
- Move 501 records roadmap Move 771: add a best-effort Cloudflare startup
  asset warmup after Docker release health. The new
  `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts` script
  fetches public/admin shell HTML, extracts same-origin startup assets, warms
  them with bounded concurrency, and writes timestamped plus latest reports.
  The first standalone run
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-04T00-13-07-290Z.json`
  saw 16 `MISS`, 4 `HIT`, 4 `BYPASS`, and zero failed assets; the immediate
  second run
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-04T00-13-28-973Z.json`
  saw 20 `HIT`, 4 `BYPASS`, and zero failed assets. The launcher-integrated
  report `ops/runtime/docker-release/cloudflare-startup-warmup.json` also saw
  20 `HIT`, 4 `BYPASS`, and zero failed assets after `run\docker\start.bat`.
  Post-warmup route traces
  `ops/runtime/reports/route-load-trace-2026-06-04T00-15-51-524Z.json` and
  `ops/runtime/reports/route-load-trace-2026-06-04T00-15-51-525Z.json` passed
  the real public/admin links with zero failures/errors.
- Move 502 records roadmap Move 772: short-cache the two static root
  bootstrap helpers. `runtime-noise-guard.js` and `theme-bootstrap.js` now use
  `Cache-Control: public, max-age=300, stale-while-revalidate=3600`; `sw.js`
  and `business-os-build.json` remain no-store. Docker image
  `business-os:v6.0.0-202606040823` served the new policy, and real
  Cloudflare header checks confirmed both bootstrap scripts no longer return
  `no-store`. Follow-up startup warmup
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-04T00-27-17-434Z.json`
  completed with `HIT: 24` and zero failed assets. Public route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-26-53-991Z.json`, admin
  route trace `ops/runtime/reports/route-load-trace-2026-06-04T00-27-19-299Z.json`,
  and public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-27-41-981Z/report.json`
  all passed with zero relevant failures/errors.
- Move 503 records roadmap Move 773: defer public catalog rounded-favicon
  canvas generation from first-load startup. `CatalogPage.tsx` now sets the
  favicon/logo URL immediately and loads `utils/favicon.ts` from an idle
  dynamic import for the rounded data URL upgrade; the focused guard rejects a
  static catalog favicon import. Docker image
  `business-os:v6.0.0-202606040838` served the change with frontend hash
  `b8e3f80f8cecccf8`. Production catalog chunk size dropped from prior
  `catalog-CSNTiyfk.js` 177,479 bytes to `catalog-BmR4n15a.js` at about
  156.14 KB. Public route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-40-41-174Z.json` passed
  `/public` with 24 scripts, zero failures/errors, and no first-load
  `favicon-utils` request. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-40-40-630Z.json`,
  remote admin route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-41-02-114Z.json`, public
  portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-40-41-123Z/report.json`,
  and post-live hygiene all passed with zero relevant failures/errors.
- Move 504 records roadmap Move 774: make the public catalog `portal-tools`
  manual chunk rule reachable before the generic catalog fallback. Vite now
  emits `catalog-De1dDiHJ.js` at 78,587 bytes and
  `portal-tools-DEMOOZsR.js` at 99,711 bytes, replacing the prior roughly
  156 KB base catalog route chunk from Move 773 with a narrower base route
  chunk plus explicit editor/translation/language helper chunk. The focused
  performance guard now asserts `portalLanguagePacks.ts`,
  `portalContentI18n.ts`, `portalTranslateController.ts`, and
  `portalEditorUtils.ts` are matched before the generic catalog fallback.
  Docker image `business-os:v6.0.0-202606040854` served frontend hash
  `06f2981d71deccc1`. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-55-40-207Z.json`
  passed public catalog, Dashboard, Products, and POS with zero failures/
  errors. Real public-host trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-55-54-685Z.json`
  passed `/public` in 3286 ms with zero failures/errors. Real admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-56-22-899Z.json`,
  public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-56-07-251Z/report.json`,
  and post-live hygiene all passed with zero relevant failures/errors.
- Move 505 records roadmap Move 775: lazy-load the public Google Translate
  controller. `CatalogPage.tsx` now reads translate preference locally and
  imports `portalTranslateController.ts` only for external Google Translate
  setup or translate-switch cleanup. Vite emits
  `portal-translate-controller-DInGtqE9.js` at 5.51 KB gzip 2.16 KB, while
  `portal-tools-Ct95pUNn.js` drops to 72.84 KB in Vite output. Docker image
  `business-os:v6.0.0-202606040909` served frontend hash
  `85ba33f03f2cbcf2`. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-12-10-187Z.json` and
  real public-host trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-12-37-146Z.json` passed
  with zero failures/errors and showed no first-load
  `portal-translate-controller` request. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-13-18-964Z.json`,
  public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T01-13-03-264Z/report.json`,
  and post-live hygiene all passed with zero relevant failures/errors.
- Move 506 records roadmap Move 776: lazy-load Backup reset panels and split
  their chunk from normal Backup/Settings route load. `ResetData.tsx` now sits
  behind a lazy advanced-maintenance boundary and a focused
  `backup-reset-tools` chunk, while shared reset/settings icons stay in
  `shared-icons`. Production output: `Backup-D63EkRDg.js` 50.66 KB gzip
  14.21 KB, `Settings-D-HfFOkr.js` 53.94 KB gzip 15.19 KB, and
  `backup-reset-tools-CTsF6z9H.js` 10.72 KB gzip 3.01 KB. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-32-11-024Z.json` and
  real admin route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-32-11-509Z.json` show no
  normal-route `backup-reset-tools` request, with Backup at 23 requests/19
  scripts and Settings at 28 requests/23 scripts, zero failures/errors.
- Move 507 records roadmap Move 777: lazy-load Settings 2FA OTP modal into a
  focused action-only chunk. `Settings.tsx` now imports only the
  `OtpModalProps` type and renders `LazyOtpModal` behind Suspense after a 2FA
  button intent. Production output: `Settings-SNkEEPE-.js` 54.43 KB gzip
  15.37 KB and `settings-otp-modal-BTTCqa0J.js` 6.74 KB gzip 2.28 KB. Local
  route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-47-30-975Z.json` passed
  Dashboard, Products, Backup, and Settings with zero failures/errors; Settings
  loaded in 206 ms with 27 requests, two API requests, and 22 scripts. Remote
  admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-47-31-450Z.json` passed
  the same routes with zero failures/errors; Settings loaded in 216 ms. Both
  traces show no normal-route `settings-otp-modal`, `OtpModal`, or
  `backup-reset-tools` request.
- Move 508 records roadmap Move 778: split Settings media upload state from
  heavier media preview helpers. `Settings.tsx` now imports only
  `mediaUploadState.ts`, delays the favicon canvas helper by 1800 ms plus idle
  scheduling, and dynamically imports `mediaUpload.ts` only after an image
  upload succeeds. Production output emits `media-upload-state-BR061biI.js` at
  1.28 KB gzip 0.51 KB, `media-upload-utils` around 0.76 KB gzip 0.49 KB, and
  `favicon-utils-BefJ4jdU.js` at 1.41 KB gzip 0.80 KB. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-01-26-353Z.json` passed
  Dashboard, Products, Backup, and Settings with zero failures/errors; Settings
  loaded in 193 ms with 25 requests and 20 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-01-26-931Z.json` passed
  the same routes with zero failures/errors; Settings loaded in 205 ms. Both
  traces show no normal-route `media-upload-utils`, `favicon-utils`,
  `settings-otp-modal`, or `backup-reset-tools` request.
- Move 509 records roadmap Move 779: split Users action-only surfaces from
  normal route load. `Users.tsx` lazy-loads `UserProfileModal`,
  `UserDetailSheet`, and `PermissionEditor` only after user intent, while
  `permissionDefinitions.ts`, `formatters.ts`, and `actionHistory.ts` are
  pinned to small shared chunks so Rollup does not make the lazy action chunks
  top-level route dependencies. Production output: `Users-CrxxMbTW.js` 34.74
  KB gzip 8.33 KB, `user-profile-modal-fZZ1WHxv.js` 39.77 KB gzip 11.29 KB,
  `user-detail-sheet-DrgkE-YZ.js` 3.83 KB gzip 1.50 KB,
  `user-permission-editor-BDueo37y.js` 3.12 KB gzip 1.24 KB,
  `user-permission-definitions-D4YB3sF5.js` 2.17 KB gzip 0.73 KB,
  `shared-formatters-hlKiTBw1.js` 1.05 KB gzip 0.48 KB, and
  `shared-action-history-C7vkR4lr.js` 11.26 KB gzip 3.77 KB. Artifact
  inspection confirmed the three action chunks appear only inside runtime
  `import()` calls. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-28-37-499Z.json` passed
  Users, Settings, Backup, and Products with zero failures/errors; Users
  loaded in 223 ms with 38 requests, three API requests, and 32 scripts, down
  from the earlier stable 45 requests and 39 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-28-50-177Z.json` passed
  the same routes with zero failures/errors; Users loaded in 267 ms. Public
  portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T02-29-03-671Z/report.json`
  and post-live hygiene passed with zero relevant failures/errors.
- Move 510 records roadmap Move 780: defer Sales/Returns CSV export helpers,
  CSV template generation, and browser file-dialog utilities from route
  startup. `Sales.tsx` and `Returns.tsx` dynamically import `utils/csv.ts`
  only after export intent. `contactsTransport.ts` and `api/methods.ts`
  lazy-load `csvTemplate.ts`; `api/methods.ts` lazy-loads `browserDialogs.ts`.
  Vite pins `browserDialogs.ts` to a focused `browser-dialogs` chunk and keeps
  `assets/browser-dialogs-` out of eager modulepreload so CSV decoding does
  not fold into `app-api-methods`.
  Standalone output emits `browser-dialogs-b2rpWGfH.js` at 0.75 KB gzip
  0.47 KB, `csv-utils-rS6b7zK6.js` at 7.59 KB gzip 3.36 KB,
  `Sales-BLPOxK6G.js` at 35.77 KB gzip 9.93 KB,
  `Returns-eWBP2b2n.js` at 23.11 KB gzip 7.72 KB, and
  `app-api-methods-CBKXmBPK.js` at 43.01 KB gzip 13.69 KB. Docker image
  `business-os:v6.0.0-202606041056` served frontend hash
  `547935922e3f9ab5`. Local trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-59-01-255Z.json` passed
  Sales in 287 ms with 39 requests/34 scripts and Returns in 221 ms with
  40 requests/35 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-59-25-149Z.json` passed
  Sales in 248 ms and Returns in 252 ms with the same request/script counts.
  Both traces had zero failures/errors and `csv-utils-present=False` for both
  routes. Public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T02-59-23-699Z/report.json`
  and post-live hygiene passed with zero relevant failures/errors.
- Move 511 records roadmap Move 781: route-start Sales/Returns reads now use
  focused transports and a split `api-http-core` chunk. `Sales.tsx` uses
  `salesTransport.getSales()` and `userReadTransport.getUsers()` for normal
  read startup; `Returns.tsx` uses `returnsTransport.getReturns()`.
  `vite.config.ts` now pins `http.ts`, `query.ts`, and `actorQuery.ts` to
  `api-http-core`, so focused read transports do not inherit
  `app-api-methods`. Standalone output emits `api-http-core-BRrzV8AY.js` at
  20.79 KB gzip 7.34 KB and shrinks `app-api-CJUW8tAi.js` to 4.41 KB gzip
  1.72 KB. Docker image `business-os:v6.0.0-202606041117` served frontend hash
  `c4818ba473b05528`. Local trace
  `ops/runtime/reports/route-load-trace-2026-06-04T03-19-53-714Z.json` passed
  Sales at 31 requests/26 scripts and Returns at 30 requests/25 scripts.
  Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T03-20-19-101Z.json` passed
  Sales in 240 ms and Returns in 228 ms. Both local and remote traces had zero
  failures/errors and confirmed `app-api-methods-present=False` and
  `csv-utils-present=False` for both routes. Public Cloudflare portal check,
  post-live hygiene, and storage prune passed; prune removed 30,592,188 bytes
  of old reports, 4,829,716 bytes of old local Docker-release backup data, and
  38.19 MB of Docker builder cache. Generated-artifact cleanup then removed
  415,957,346 bytes from regenerable `release`, `frontend/dist`, and `output`
  folders, and the follow-up Phase 29 audit passed with zero failures.
- Move 857 records public catalog shared-utility chunk slimming. `AppSelect`
  now builds as `shared-select`, `LazyPortalMenu` as
  `shared-lazy-portal-menu`, and `pageActivity` folds into `route-sync-utils`
  before the generic shared fallback. Production output now emits
  `app-shared-u7Xi8a2R.js` at 9.03 KB / 3.66 KB gzip instead of the previous
  roughly 58 KB `app-shared` bucket. Focused Playwright resource traces on
  local, public Cloudflare, and admin Cloudflare `/public` confirmed zero
  `app-shared` script fetches, 20 real products rendered, working search, and
  no relevant console/request failures. Local LCP was 248 ms; warm public and
  admin Cloudflare LCPs were 2.776 s and 2.784 s.
- Move 858 records public catalog provider slimming. `PublicCatalogRoot` now
  uses `PublicCatalogAppProvider`, while shared hooks and fallback context live
  in `AppContextCore`; `CatalogPage` and `pageActivity` import that tiny core
  instead of the full admin `AppContext`. Production output emits
  `route-sync-utils-D2WGtH-x.js` at 4.49 KB / 1.91 KB gzip, down from the
  previous roughly 48.7 KB helper chunk that pulled admin provider code into
  public startup. Docker image `business-os:v6.0.0-202606090940-move858`
  served frontend hash `5096e7c52a17b058`. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-09T02-17-53-549Z.json` passed
  with zero failures/errors; public catalog measured 202 ms at 21 requests /
  16 scripts, Dashboard 178 ms, Products 289 ms, Inventory 278 ms, POS
  287 ms, and Returns 228 ms. Focused Playwright rendered the real public
  catalog with search and product content, no request/console failures, local
  LCP 196 ms, and warm public/admin Cloudflare LCPs around 2.13-2.14 s.
- Move 859 records public catalog secondary/social icon deferral. `CatalogPage`
  now passes contact/social metadata without direct Lucide component
  references, `chevron-down` stays in the first-viewport `catalog-icons`
  bucket for `AppSelect`, and `shared-icons` remains excluded from route
  modulepreload. Docker image `business-os:v6.0.0-202606091115-move859`
  served frontend hash `b2cb83f3fcf497c7`. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-09T03-12-29-886Z.json` passed
  with zero failures/errors; public catalog measured 161 ms at 20 requests /
  15 scripts. Focused mobile Playwright confirmed 12 initial scripts, local LCP
  336 ms, `catalog-icons-B89f4Ick.js` loaded, no initial `shared-icons-*` or
  `catalog-secondary-tabs-*`, and About-tab intent loading of
  `catalog-secondary-tabs-D9bzcZjJ.js` plus `shared-icons-Z1cfLhvY.js`. Warm
  admin/public Cloudflare checks both returned 200 with 12 scripts and no
  initial `shared-icons`. Cleanup also deleted the generated
  `release/business-os` kit after reference checks, removing 380,917,753 bytes
  and letting the Phase 29 generated-bulk audit pass below its 512 MB
  threshold.
- Move 860 records public portal API transport splitting. `public-web-api.ts`
  now lazy-loads `portalPublicTransport.ts`, a customer-facing transport that
  does not import shared `apiFetch`, route helpers, the shared query helper, or
  admin review transport. Production output emits `app-portal-i7Pp78I2.js` at
  2.57 kB / 1.00 kB gzip and `portal-admin-api-DNJ6zyZz.js` at 2.80 kB /
  1.09 kB gzip; `app-portal` contains no `api-http-core`, `api-http-state`, or
  `portal-admin-api`. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-09T04-04-32-989Z.json` passed
  with zero failures/errors; public catalog measured 173 ms at 18 requests /
  13 scripts. Focused Playwright loaded local `/public` in 962 ms with real
  `5,539 result(s)`, confirmed admin/public Cloudflare `/public` both returned
  200 with real catalog data, and verified About-tab chunks still load only on
  intent. Remaining honest public startup targets are `index-CW_jNXiu.css`
  size, the roughly 106 kB catalog chunk, the roughly 49 kB decoded bootstrap
  payload, and the Google Maps iframe path.
- Move 864 records public catalog first-load bootstrap embedding and preload
  correction. The backend injects the public portal bootstrap payload into
  `/public` and `/customer-portal` HTML; `PublicCatalogPage` reads that payload
  into a reusable window cache instead of spending the first render on
  `/api/portal/bootstrap`. The first product-search effect now skips when the
  embedded bootstrap already has the first page. The public catalog pagination
  control uses a local compact select, and public price display owns its small
  discount calculation so startup no longer needs the shared admin select or
  product shared chunk. The server preload resolver now treats
  `catalog-public` separately from `catalog-public-core` and
  `catalog-public-utils`, so the route preloads the real public component chunk
  instead of the utility chunk twice. Docker image
  `business-os:v6.0.0-202606091602-perf870` served frontend hash
  `83b81a7b4acf802f`. Local Playwright route-load passed at 259 ms ready,
  19 requests, 15 scripts, `api=0`, and zero failures/errors; local LCP passed
  at 280 ms. Public Cloudflare warmup passed 13 targets with 0 failures. Real
  public Cloudflare route-load passed at 2.215 s ready with `api=0`; public LCP
  passed at 2.324 s, below the 2.5 s target.
- Move 866 records artificial admin loading-delay removal. Products, POS,
  Inventory, Files, Branch, Contacts, Sales, Returns, Backup, Users, and Sync
  Server no longer wait 1.8 s before enabling secondary history/filter/metadata
  and online-check work; those gates now resolve at 250 ms after primary load.
  Frontend typecheck, full frontend utility suite, production build, Docker
  build, and Docker release health passed. Local Docker image
  `business-os:v6.0.0-202606101030-move866` served frontend hash
  `69e2e819e937bff6`; affected local route-load passed with zero failures and
  ready times of Products 317 ms, POS 291 ms, Returns 270 ms, Files 360 ms,
  Branches 307 ms, Users 263 ms, and Sync Server 238 ms. Local multi-route LCP
  stayed below 1 s with zero failures/errors. Move 866 also restores the
  performance chunk contract by moving `pageActivity.ts`, `loaders.ts`,
  initials, and Khmer typography into `route-sync-utils` and keeping secondary
  contact icons out of the public first-viewport icon chunk. Warmed public
  Cloudflare LCP passed at 2.328 s after a 12/12 HIT startup warmup. Warmed
  admin Cloudflare route-load passed with zero failures/errors but remains the
  next hotspot: Products 3.402 s, Inventory 3.306 s, POS 3.912 s, Branches
  4.333 s.
- Move 879 records the next route-startup and double-load reduction. POS
  removed the last 1.5 s artificial category/contact/filter metadata waits
  after the real catalog load. Inventory removed the 1.2 s artificial product
  metadata wait after the primary product page load. Backend route preload
  hints now include POS `productDisplayHelpers`, Inventory
  `InventoryProductsSurface`, and Branches `shared-page-header`. Products no
  longer imports public catalog chunks in its first window because
  `productFilterHelpers.ts` is owned by `product-shared`; shared Lucide icons
  prefer `shared-ui` before auth/catalog buckets; and
  `AppContext.tsx`/`AppContextCore.tsx` moved to `app-auth`, dropping the
  normal admin shell's dependency on the full login form chunk. Docker image
  `business-os:v6.0.0-202606100950-move879` served frontend hash
  `ecede1516f03dac6`. Local Playwright route-load
  `ops/runtime/reports/route-load-trace-2026-06-10T01-55-17-751Z.json` passed
  with zero failures/errors: Products 260 ms, Inventory 317 ms, POS 381 ms,
  and Branches 284 ms. Cloudflare trace
  `ops/runtime/reports/route-load-trace-2026-06-10T01-55-21-233Z.json` had one
  slow Products pass at 7.697 s and measured Inventory 3.179 s, POS 2.456 s,
  Branches 2.510 s; repeat
  `ops/runtime/reports/route-load-trace-2026-06-10T01-56-02-633Z.json`
  measured Products 2.303 s, Inventory 1.629 s, POS 2.279 s, and Branches
  1.862 s. Both remote traces had zero failed requests/errors. Remaining
  hotspot: Cloudflare variance around `/api/auth/bootstrap`, first static
  chunk delivery, and a Vite circular chunk warning between `app-auth`,
  `app-shared`, `shared-ui`, and `route-sync-utils`.
- Move 880 records the follow-up chunk-graph stabilization. Shared lazy
  widgets that only need app hooks now import from `AppContextCore`, and Vite
  manual chunking separates `app-context-core`, `pricing-utils`, and
  `shared-export-menu`. Production build now finishes without circular chunk
  warnings; `app-shared` drops from roughly 9.46 kB to 5.52 kB, while
  `pricing-utils` is 1.65 kB and `app-context-core` is 1.68 kB. Docker image
  `business-os:v6.0.0-202606101009-move880` served frontend hash
  `b7bc8cf415985ebf`. Local Playwright route-load
  `ops/runtime/reports/route-load-trace-2026-06-10T02-13-01-221Z.json` passed
  with zero failures/errors: Products 259 ms, Inventory 275 ms, POS 335 ms,
  and Branches 253 ms. First public Cloudflare trace
  `ops/runtime/reports/route-load-trace-2026-06-10T02-13-01-306Z.json`
  measured Products 8.326 s, Inventory 3.404 s, POS 3.684 s, and Branches
  4.958 s; warmed repeat
  `ops/runtime/reports/route-load-trace-2026-06-10T02-13-36-332Z.json`
  measured Products 2.658 s, Inventory 2.508 s, POS 3.148 s, and Branches
  3.223 s. Both remote traces had zero failed requests/errors. Remaining
  hotspot: Cloudflare/tunnel variance and first-route API transfer time, not
  app-owned chunk cycles or artificial waits.
- Move 894 continues the real-load performance pass by moving passive secondary
  reads out of route first-paint windows. Shared action history now delays its
  initial server history/admin-user reads until after load/idle while keeping
  writes, undo, and redo immediate. Inventory keeps the primary
  `/api/inventory/bootstrap?...metadata=0` product load first-class and moves
  the `metadataOnly=1` filter refresh to an idle scheduled read. Users keeps
  `/api/users` as the primary first-load request and defers `/api/roles` on the
  default Users tab while still loading roles immediately on the Roles tab or
  when role-backed forms need them. Vite no longer creates a separate
  `shared-export-menu` startup chunk; the small export trigger folds into route
  chunks to remove one Cloudflare round trip. Docker image
  `business-os:v6.0.0-202606100822-move894` served frontend hash
  `481c0829fc62462f`. Local route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-10T14-23-12-097Z.json` passed
  with zero failures/errors: Products 352 ms, Inventory 427 ms, Sales 320 ms,
  Returns 269 ms, Contacts 312 ms, Branches 276 ms, Users 263 ms, Audit Log
  516 ms. The public first-window trace
  `ops/runtime/reports/route-load-trace-2026-06-10T14-24-46-325Z.json` also
  passed with zero failures/errors; request counts were reduced to one primary
  API on Sales, Returns, Contacts, Branches, Users, and Audit Log, with
  Inventory at two because authenticated bootstrap plus inventory bootstrap are
  both required. Public LCP trace
  `ops/runtime/reports/lcp-route-trace-2026-06-10T14-23-15-647Z.json` stayed
  error-free; Products, Sales, Contacts, Branches, and Audit Log were near
  one-second LCP, while Inventory, Returns, and Users remain the next
  Cloudflare/tunnel latency hotspots.
<!-- phase29-manual-notes:end -->
