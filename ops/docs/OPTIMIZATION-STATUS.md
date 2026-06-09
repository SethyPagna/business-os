# Business OS Optimization Status

Last updated: 2026-06-09

## Phase Board

- Phase 8.4: active live verification and UI/runtime checks
- Phase 26: 51 completed organization moves; future folder moves must cite Phase 29 evidence
- Phase 28: active, with R2 prune follow-up still open
- Phase 29: active whole-codebase schema, cleanup, TypeScript, runtime, and performance sweeps
- Latest completed move: Move 858, split the public catalog onto a minimal app provider so it no longer imports the full admin AppContext during public startup.

## Current Baseline

Latest verified runtime health:

- local health: `http://127.0.0.1:4000/health`
- latest verified frontend hash from the most recent Docker-served live check:
  `5096e7c52a17b058`
- latest verified source hash from the most recent Docker-served live check:
  `e907e23af14377c3`

Latest verified reports:

- latest retained all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-latest.json`
- latest passing all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-07T00-22-18-993Z/summary.json`
- latest fast all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-04T00-01-16-941Z/summary.json`
- latest exhaustive desktop/mobile all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T16-31-07-897Z/summary.json`
- latest broad Phase 8.4 UI live check:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-08T20-39-18-526Z/report.json`
- latest Phase 8.4 live suite:
  `ops/runtime/reports/phase84-live-suite-latest.json`
- latest Loyalty Points rollback check:
  `ops/runtime/reports/phase84-loyalty-points-rollback-check-latest.json`
- latest Settings save rollback check:
  `ops/runtime/reports/phase84-settings-save-rollback-check-latest.json`
- latest focused filter/dropdown live check:
  `ops/runtime/reports/phase84-filter-menu-live-check-2026-06-06T23-29-11-677Z/report.json`
- latest focused shared select live check:
  `ops/runtime/reports/phase84-shared-select-live-check-2026-06-06T23-27-47-674Z/report.json`
- latest focused receipt export layout check:
  `ops/runtime/reports/phase84-receipt-export-layout-check-2026-06-06T22-52-27-772Z/report.json`
- latest public Cloudflare portal check:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-08T20-39-57-851Z/report.json`
- latest focused local route-load trace:
  `ops/runtime/reports/route-load-trace-2026-06-09T02-17-53-549Z.json`
- latest Inventory persisted-section live check:
  `ops/runtime/reports/phase84-inventory-section-restore-live-check-2026-06-04T23-48-31-869Z/report.json`
- latest focused remote admin route-load trace:
  `ops/runtime/reports/route-load-trace-2026-06-04T03-20-19-101Z.json`
- latest focused public-host route-load trace:
  `ops/runtime/reports/route-load-trace-2026-06-04T01-12-37-146Z.json`
- latest Cloudflare startup asset warmup:
  `ops/runtime/docker-release/cloudflare-startup-warmup.json`
- latest focused Products write live check:
  `ops/runtime/reports/move766-product-write-live-check-2026-06-03T21-25-13-480Z/report.json`
- latest initial-filter timing proof:
  `ops/runtime/reports/initial-filter-timing-2026-06-03T17-00-58-548Z/report.json`
- latest lazy portal-menu interaction proof:
  `ops/runtime/reports/lazy-portal-menu-live-check-2026-06-03T16-20-20-068Z/report.json`
- latest public language-menu interaction proof:
  `ops/runtime/reports/public-language-menu-live-check-2026-06-03T17-18-31-063Z/report.json`
- latest public portal load trace:
  `ops/runtime/reports/public-load-trace-latest.json`
- latest top-route load trace:
  `ops/runtime/reports/top-route-load-trace-latest.json`
- latest Products/POS filter burst proof:
  `ops/runtime/reports/filter-burst-check-latest.json`
- latest import-tracker focused proof:
  `ops/runtime/reports/move723-import-tracker-probe-2026-06-02T16-53-06-381Z.json`
- post-live hygiene:
  `ops/runtime/reports/post-live-hygiene-latest.json`
- Phase 29 repeated audit:
  `ops/docs/reference/PHASE29-AUDIT.md`

Latest cleanup run:

- Move 858 gives the public catalog a minimal `PublicCatalogAppProvider` and
  moves shared context hooks into `AppContextCore`. Public startup now keeps the
  admin provider, auth/bootstrap side effects, websocket health wiring, and
  full settings/theme provider code out of the public route while existing
  admin imports continue through `AppContext` re-exports.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run
  build`, `npm.cmd --prefix frontend run test:utils`,
  `node ops\scripts\docs\generate-doc-reference.ts`,
  `node ops\scripts\docs\performance-scan.ts`, Docker image build, Docker
  release update, health check, route-load trace, focused local/public/admin
  Playwright browser probes, `git diff --check`, and storage prune passed.
- Live proof on Docker image `business-os:v6.0.0-202606090940-move858`,
  frontend hash `5096e7c52a17b058`, source hash `e907e23af14377c3`: route
  trace `ops/runtime/reports/route-load-trace-2026-06-09T02-17-53-549Z.json`
  passed with zero failures/errors. Public catalog measured 202 ms at 21
  requests / 16 scripts; Dashboard 178 ms at 31 / 25; Products 289 ms at
  38 / 30; Inventory 278 ms at 40 / 33; POS 287 ms at 35 / 28; Returns
  228 ms at 35 / 30.
- Build proof: `route-sync-utils-D2WGtH-x.js` is 4.49 kB / 1.91 kB gzip after
  the provider split, down from the previous roughly 48.7 kB helper chunk that
  pulled the full admin context into public startup. The generated performance
  scan no longer lists `route-sync-utils` in the top 25 built chunks.
- Focused Playwright proof: local `/public` rendered the real public catalog
  with search and product content, no console/request failures, and LCP 196 ms.
  Cold tunnel samples were clean but slower; warm public checks measured
  `https://admin.leangcosmetics.dpdns.org/public` at 2.128 s LCP and
  `https://leangcosmetics.dpdns.org/public` at 2.144 s LCP. Remaining remote
  startup work is now the real `catalog`, language, CSS, vendor, and Cloudflare
  path cost rather than the removed admin-provider import.
- Cleanup proof: storage prune removed two stale runtime reports (1,563 bytes),
  one old Docker-release backup (`20260609-080847`, 5,357,364 bytes), and
  2.348 GB of Docker builder cache while keeping newest local/R2 backups,
  uploads, secrets, volumes, and protected rollback images.
- Current plan position after Move 858: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 857 gives the public catalog its own focused shared utility ownership:
  `AppSelect` now builds as `shared-select`, `LazyPortalMenu` as
  `shared-lazy-portal-menu`, and `pageActivity` folds into
  `route-sync-utils` before the generic `components/shared` fallback. This
  keeps the public product page from fetching the broad `app-shared` bundle
  just to render first-viewport select/menu plumbing.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run
  build`, `node ops\scripts\docs\generate-doc-reference.ts`,
  `node ops\scripts\docs\performance-scan.ts`, Docker image build, Docker
  release update, health check, route-load trace, and focused Playwright local
  plus Cloudflare browser probes passed.
- Live proof on Docker image `business-os:v6.0.0-202606090110-move857`,
  frontend hash `0067e4e403e00d73`, source hash `e907e23af14377c3`: route
  trace `ops/runtime/reports/route-load-trace-2026-06-09T01-30-15-433Z.json`
  passed with zero failures/errors. Public catalog measured 174 ms at 21
  requests / 16 scripts; Dashboard 167 ms at 28 / 22; Products 272 ms at
  35 / 27; Inventory 300 ms at 37 / 30; POS 266 ms at 30 / 23; Returns
  223 ms at 32 / 27.
- Focused Playwright proof: local `/public` rendered 20 real products with no
  console/request failures, working search input, no `app-shared` script, and
  LCP 248 ms. Warm Cloudflare probes rendered 20 products with no failures:
  `https://leangcosmetics.dpdns.org/public` LCP 2.776 s and
  `https://admin.leangcosmetics.dpdns.org/public` LCP 2.784 s. Cold tunnel
  samples still vary, so the remaining remote bottleneck is the Cloudflare
  path plus the still-large `catalog`, language, CSS, and vendor chunks.
- Cleanup proof: storage prune removed one stale runtime report
  (`test-data-cleanup-postcheck-latest.json`, 770 bytes), one old
  Docker-release backup (`20260609-080325`, 5,356,932 bytes), and 2.348 GB of
  Docker builder cache while keeping newest local/R2 backups, uploads, secrets,
  volumes, and protected rollback images.
- Current plan position after Move 857: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 856 moves the public catalog editor context provider into the lazy
  `CatalogEditorSurface`, routes `CatalogPageContext` into the `catalog-editor`
  chunk, and gates the large `editorSections`/`editorContextValue` allocation
  behind `canEdit`. Public visitors now skip the editor-only provider module
  and the per-render editor context object while staff editing keeps the same
  lazy editor behavior.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run
  build`, Docker image build, Docker release update, route-load trace, local
  and Cloudflare header checks, and focused local/public/admin Playwright
  LCP/resource probes passed. Final frontend utility suite, `git diff --check`,
  and storage prune also passed.
- Live proof on Docker image `business-os:v6.0.0-202606090950-move856`,
  frontend hash `b2c34722d82f7abf`, source hash `e907e23af14377c3`: route
  trace `ops/runtime/reports/route-load-trace-2026-06-09T00-50-18-388Z.json`
  passed with zero failures/errors. Public catalog measured 201 ms at 20
  requests / 15 scripts; Dashboard 341 ms at 27 / 21; Products 299 ms at
  33 / 25; Inventory 327 ms at 35 / 28; POS 261 ms at 29 / 22; Returns
  273 ms at 30 / 25.
- Focused Playwright proof: local `/public` rendered 20 real products with no
  console/request failures and LCP 492 ms. Warm Cloudflare probes rendered the
  same 20 products with no failures: `https://leangcosmetics.dpdns.org/public`
  LCP 3.044 s and `https://admin.leangcosmetics.dpdns.org/public` LCP 2.816 s.
  A cold public tunnel sample reached 34.928 s LCP before warming, so the next
  bottleneck remains Cloudflare/tunnel variability plus the still-large
  `catalog` and `app-shared` first-route scripts, not fake or missing data.
- Cleanup proof: storage prune removed one stale runtime report
  (`phase84-settings-save-rollback-check-latest.json`, 544 bytes), one old
  Docker-release backup (`20260609-064844`, 5,356,502 bytes), and 2.387 GB of
  Docker builder cache while keeping the newest local/R2 backups and protected
  rollback images.
- Current plan position after Move 856: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 855 splits public catalog Lucide icons out of the broader shared icon
  bundle and fixes exact SPA preload resolution for the new `catalog-icons`
  chunk. `CatalogPage` and `CatalogProductsSection` dropped dead icon imports,
  Vite now emits a named `catalog-icons` chunk, and the backend `catalog`
  preload collision guard excludes `catalog-icons` so `/public` receives one
  correct `catalog`, `catalog-icons`, and `catalog-products` header each.
- Verification proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node backend\test\routeContracts.test.ts`, `npm.cmd --prefix frontend run
  typecheck`, `npm.cmd --prefix frontend run build`, Docker image build,
  Docker release update, local/Cloudflare header checks, route-load trace, and
  focused local/Cloudflare Playwright LCP/resource probes passed.
- Live proof on Docker image `business-os:v6.0.0-202606090810-move855`,
  frontend hash `95b3c1b169231b34`, source hash `e907e23af14377c3`: local
  `/public` LCP was 232 ms with real products present and zero failures/errors.
  Cloudflare public `/public` rendered products with zero failures/errors and
  measured 3.232 s LCP in the focused mobile probe, down from the prior
  5.820 s probe where the catalog shell was not in the Link header. The
  server Link header now includes `app-portal`, `catalog`, `catalog-icons`,
  and `catalog-products`.
- Route proof:
  `ops/runtime/reports/route-load-trace-2026-06-09T00-09-50-358Z.json`
  passed with zero failures/errors: Dashboard 180 ms at 27 requests / 21
  scripts; Products 268 ms at 33 / 25; Inventory 221 ms at 35 / 28; POS
  201 ms at 29 / 22; Returns 235 ms at 30 / 25; public catalog 207 ms at
  20 / 15. Production build proof emits `catalog-icons-CFqKE5MX.js` at
  10.99 kB / 2.67 kB gzip while shrinking `shared-icons-BJJYPCes.js` to
  9.22 kB / 2.08 kB gzip.
- Current plan position after Move 855: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 854 splits the public catalog product grid out of the route shell.
  `CatalogPage` now lazy-loads `CatalogProductsSection`, Vite emits a named
  `catalog-products` chunk, and both the built HTML route-aware preload script
  and backend SPA `Link: rel=modulepreload` headers prefetch it for `/public`
  and `/customer-portal`.
- Verification proof: backend route-contract guard, performance/loading guard,
  frontend typecheck, frontend utility suite, backend utility suite, frontend
  production build, Docker image build, Docker release update, local route-load
  trace, local Playwright public search/asset probe, Cloudflare public/admin
  header checks, Cloudflare public Playwright check, health check, Docker
  container check, `git diff --check`, and storage prune passed.
- Live proof on Docker image `business-os:v6.0.0-202606090650-move854`,
  frontend hash `7ede2385a44420a8`, source hash `60d3b6f9db28ae02`: local
  `/public` reached real product text in 270 ms, requested
  `catalog-products-CQz2d15d.js`, made zero `lang-en` and zero
  `app-bootstrap` requests, and a real `AHC, Mask` search returned AHC Mask
  content with zero request failures or app console errors. Cloudflare
  `/public` rendered the same product count with zero failures/errors; direct
  public/admin Cloudflare headers now include `app-portal`, `catalog`, and
  `catalog-products`.
- Route proof:
  `ops/runtime/reports/route-load-trace-2026-06-08T22-49-47-936Z.json`
  passed with zero failures/errors: Dashboard 211 ms at 26 requests / 20
  scripts; Products 206 ms at 32 / 24; Inventory 216 ms at 34 / 27; POS
  196 ms at 28 / 21; Returns 216 ms at 29 / 24; public catalog 174 ms at
  19 / 14. Production build proof split `catalog` from 124.49 kB / 36.60 kB
  gzip to 104.38 kB / 31.51 kB gzip plus `catalog-products` at 20.49 kB /
  5.90 kB gzip.
- Cleanup proof: storage prune removed 137,941 bytes of stale reports,
  10,701,268 bytes of old Docker-release backup data, and 2.419 GB of Docker
  builder cache while preserving uploads, secrets, env files, Docker volumes,
  the active image, `business-os:latest`, and latest local/R2 backup sets.
- Current plan position after Move 854: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 852 keeps the public portal startup path off authenticated admin-only
  assets. `backend/server.ts` now treats `/public` and `/customer-portal` as
  public portal routes when building SPA `Link: rel=modulepreload` headers, so
  those routes keep only their route-owned `app-portal` and `catalog` hints.
  Admin routes still receive `/api/auth/bootstrap`, `app-bootstrap`, and their
  route chunk preload hints.
- Verification proof: backend utility suite, frontend utility suite,
  JSX/source check, production build, `git diff --check`, Docker release
  update, local and Cloudflare header checks, focused Playwright public portal
  asset probe, route-load trace, health check, Docker container check, and
  storage prune passed.
- Live proof on Docker image `business-os:v6.0.0-202606090500-move852`,
  frontend hash `d89391073231d012`, source hash `542f5c165aab068e`: local
  `/public` and Cloudflare `/public` headers contain only `app-portal` and
  `catalog` modulepreloads, while `/dashboard` still includes the admin
  bootstrap preload. Focused Playwright found zero `app-bootstrap` downloads
  and zero request failures on `/public`.
- Route proof:
  `ops/runtime/reports/route-load-trace-2026-06-08T21-29-53-373Z.json`
  passed with zero failures/errors: Dashboard 135 ms at 26 requests / 20
  scripts; Products 221 ms at 32 / 24; Inventory 211 ms at 34 / 27; POS
  234 ms at 28 / 21; Returns 205 ms at 29 / 24; public catalog 154 ms at
  18 / 13. Public catalog is one request and one script lower than Move 851.
- Cleanup proof: storage prune removed 435,578 bytes of stale reports,
  5,345,195 bytes of old Docker-release backup data, and 4.848 GB of Docker
  builder cache while preserving uploads, secrets, env files, Docker volumes,
  the active image, `business-os:latest`, and latest local/R2 backup sets.
- Current plan position after Move 852: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 851 fixes the cookie-only authenticated startup path. `AppContext`
  now keeps `authReady` false whenever a server bootstrap probe is available
  until `/api/auth/bootstrap` confirms or rejects the httpOnly cookie session,
  preventing a transient unauthenticated render. `App.tsx` keeps the secure
  loading shell active for stored sessions while bootstrap catches up, and
  Vite now separates admin and direct-login HTML preloads so normal admin
  routes do not preload `auth-login`.
- Verification proof: frontend utility suite, JSX/source check, production
  build, Docker image build, Docker update, focused Playwright auth-login
  request proof, direct `/login` proof, route-load trace, full Phase 8.4 live
  suite, public Cloudflare portal check, receipt/loyalty/settings rollback
  checks, post-live hygiene, storage prune, health check, and in-app Browser
  POS interaction checks passed.
- Live proof on Docker image `business-os:v6.0.0-202606090431-move851`,
  frontend hash `40d6419e815cddbb`, source hash `9cb28cddba119d87`: the
  authenticated dashboard startup made zero `auth-login` requests and rendered
  no login form, while direct `/login` still loaded `auth-login-BvphkK3w.js`
  and showed the sign-in form. Route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-08T20-39-01-221Z.json`
  passed with zero failures/errors: Dashboard 128 ms at 26 requests / 20
  scripts; Products 273 ms at 32 / 24; Inventory 280 ms at 34 / 27; POS
  218 ms at 28 / 21; Returns 224 ms at 29 / 24; public catalog 168 ms at
  19 / 14.
- Browser proof: in-app Browser opened POS at `http://127.0.0.1:4000/pos`,
  searched `AHC`, verified the filtered count `1-4 / 4`, visible AHC product
  cards and Khmer unit labels, no horizontal overflow, zero relevant console
  messages, and cleared the old service-worker update banner.
- Cleanup proof: storage prune removed 1,031,387 bytes of stale reports,
  26,686,028 bytes of old Docker-release backup data, two old Docker rollback
  tags (`business-os:v6.0.0-202606090119` and
  `business-os:v6.0.0-202606090044`), and 4.571 GB of Docker builder cache
  while preserving uploads, secrets, env files, Docker volumes, the active
  image, `business-os:latest`, and latest local/R2 backup sets.
- Current plan position after Move 851: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 850 splits POS supplier normalization from the heavier Products menu
  helper. `frontend/src/components/products/helpers/productSupplierOptions.ts`
  now owns `buildProductSupplierOptions`, POS imports it directly, and
  `frontend/tests/performanceLoadingUx.test.ts` rejects POS importing
  `productMenuHelpers.ts`. Public portal startup noise was also fixed by
  removing the public `/api/portal/bootstrap` `Link: rel=preload` header,
  which Cloudflare Early Hints was reporting as unused.
- Verification proof: backend utility suite, frontend utility suite,
  JSX/source check, production build, `git diff --check`, Docker release,
  Docker update, route-load trace, full Phase 8.4 live suite, public Cloudflare
  portal check, receipt/loyalty/settings rollback checks, post-live hygiene,
  health check, storage prune, and in-app Browser POS/public checks passed.
  Build proof emitted `product-shared-DEk7U8Qi.js` at 12.05 kB / 4.25 kB gzip
  and no standalone `productMenuHelpers-*.js` asset in the local production
  build.
- Live proof on Docker image `business-os:v6.0.0-202606090302`, frontend hash
  `fb52a37577b666c6`, source hash `9cb28cddba119d87`: route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-08T19-04-46-912Z.json` passed
  with zero failures/errors. Dashboard loaded in 168 ms at 29 requests /
  21 scripts; Products 310 ms at 35 / 25; Inventory 261 ms at 37 / 28; POS
  230 ms at 31 / 22 while no longer requesting `productMenuHelpers`; Returns
  198 ms at 32 / 25; public catalog 173 ms at 19 / 14. The public Cloudflare
  check rendered 20 products with zero relevant console messages after the
  preload fix.
- Browser proof: in-app Browser opened POS, filled the search field with
  `AHC`, verified the filtered AHC products, zero console messages, and no
  horizontal overflow. It also opened `https://leangcosmetics.dpdns.org/public`
  and verified 5,539 products, no loading placeholder, no internal-server
  error, zero relevant console messages, and no horizontal overflow.
- Cleanup proof: storage prune removed 1,075,543 bytes of stale reports,
  10,630,217 bytes of old Docker-release backup data, two old Docker rollback
  tags (`business-os:v6.0.0-202606090010` and
  `business-os:v6.0.0-202606082331`), and 3.65 GB of Docker builder cache
  while preserving uploads, secrets, env files, Docker volumes, the active
  image, `business-os:latest`, and latest local/R2 backup sets.
- Current plan position after Move 850: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 848 continues route-start request reduction by routing the tiny
  `frontend/src/utils/bulkOps.ts` concurrency helper into the already-loaded
  `shared-action-history` chunk. Products and Inventory use the helper beside
  action-history and bulk-selection controls, while POS and the public catalog
  do not load it on startup, so this removes the standalone `bulkOps-*.js`
  request without making unrelated pages heavier.
- Source guardrails now require `bulkOps.ts` to stay in
  `shared-action-history`, beside the existing `historyHelpers.ts` guardrail.
- Verification proof: frontend utility suite, JSX/source check, production
  build, `git diff --check`, Docker release, Docker update, route-load trace,
  full Phase 8.4 live suite, public Cloudflare portal check, receipt/loyalty/
  settings rollback checks, post-live hygiene, health check, and storage prune
  passed. Build proof emitted `shared-action-history-DXTzoB3i.js` at 12.53 kB
  / 4.34 kB gzip and no standalone `bulkOps-*.js` asset.
- Live proof on Docker image `business-os:v6.0.0-202606090119`, frontend hash
  `a17aafcbe9a0d3d4`, source hash `24d1c2a2a89e8dcc`: route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-08T17-42-53-495Z.json` passed
  with zero failures/errors. Products loaded in 267 ms with 36 requests /
  26 scripts; Inventory loaded in 219 ms with 37 requests / 28 scripts;
  Dashboard stayed 29 / 21, POS stayed 31 / 22, Returns stayed 32 / 25, and
  public catalog stayed 20 / 15.
- Cleanup proof: storage prune removed 719,265 bytes of stale reports,
  5,295,169 bytes of old Docker-release backup data, one old
  `business-os:v6.0.0-202606082242` rollback tag, and 3.579 GB of Docker
  builder cache while preserving uploads, secrets, env files, Docker volumes,
  the active image, `business-os:latest`, and latest local/R2 backup sets.
- Current plan position after Move 848: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 845 continues the startup/preload cleanup by routing the notification
  center summary read away from the broad `window.api` compatibility facade.
  `frontend/src/components/shared/NotificationCenter.tsx` now imports
  `getNotificationSummary` from `frontend/src/api/notificationSummary.ts`
  directly, preserving the existing cooldown-aware fallback and request sharing
  in the focused transport.
- Code-flow cleanup also fixes a live stale-loading bug. Notification summary
  data requests still share the normal summary request tracker, but visible
  panel loading now has its own tracker so silent background refreshes cannot
  invalidate the original visible request and strand `Loading notifications...`
  after data has rendered.
- Source guardrails now reject `getNotificationApi`, `window.api`, and broad
  `api.getNotificationSummary` access returning to
  `frontend/src/components/shared/NotificationCenter.tsx`, while proving the
  focused transport and separate visible-loader tracking stay in place.
- Verification proof: focused notification badge guard, focused
  performance-loading guards, standalone frontend typecheck, JSX/source check,
  frontend production build, full frontend utility suite, backend utility
  suite, schema audit, organization audit, generated reference refresh, full
  project-doc refresh, Phase 29 audit, storage prune, and in-app Browser
  DOM/log/interaction checks passed. Browser proof loaded the Vite dev
  `/dashboard` route, clicked the Notifications bell, verified notification
  content rendered, confirmed `Loading notifications...` settled to
  `No active notifications.`, and recorded zero relevant console warnings/
  errors after timestamped retest.
- Current plan position after Move 845: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 844 continues the startup/preload cleanup by routing the reusable file
  picker away from the broad `window.api` compatibility facade. The picker now
  imports `getFiles`, `uploadFileAsset`, and `deleteFileAsset` from
  `frontend/src/api/fileTransport.ts` directly for list, upload, and delete
  paths.
- Code-flow cleanup also stabilizes the picker open-load effect. The default
  initial selection now uses a stable empty array, content-equivalent
  `initialSelected` arrays are keyed by normalized value instead of object
  identity, and load failures use a notification ref so changing app context
  callbacks do not restart the loader loop.
- Source guardrails now reject `getFilePickerApi`, `window.api`, and broad
  `api.getFiles`/`api.uploadFileAsset`/`api.deleteFileAsset` access returning
  to `frontend/src/components/files/FilePickerModal.tsx`, while still proving
  bounded load, upload, and delete timeouts.
- Verification proof: focused performance-loading guards, action stability
  guards, standalone frontend typecheck, JSX/source check, frontend production
  build, full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, full project-doc refresh,
  Phase 29 audit, storage prune, and in-app Browser DOM/log/interaction checks
  passed. Browser proof loaded the Vite dev `/users` route, opened Profile,
  opened Files, verified the picker search and Upload file controls rendered
  with the `No files yet` empty state, confirmed loading was not stuck, and
  recorded zero relevant console warnings/errors after timestamped retests.
  Browser screenshot capture timed out through the bridge, so DOM/log/
  interaction proof is the accepted live evidence for this slice.
- Current plan position after Move 844: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 842 continues the returns cleanup by routing customer-return edit-submit
  updates away from the broad `window.api` compatibility facade. The edit modal
  now lazy-loads `frontend/src/api/returnsTransport.ts` directly for
  `updateReturn`, preserving expected-updated-at/device metadata handling from
  the focused transport.
- Source guardrails now reject `getReturnApi`, `window.api`, and broad
  `api.updateReturn` access returning to
  `frontend/src/components/returns/EditReturnModal.tsx`, while still proving
  the edit payload keeps bounded loader timeout and same-tick submit guard
  behavior.
- Verification proof: focused performance-loading guards, action stability
  guards, standalone frontend typecheck, JSX/source check, frontend production
  build, full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, `git diff --check`, and in-app Browser DOM/log checks passed. Browser
  proof loaded the Vite dev `/returns` route, signed in with the documented local default,
  verified the Returns page/empty state/New Return control rendered, and
  recorded zero relevant console errors. The local dev data had no existing
  returns, so the edit modal was not opened to avoid creating disposable test
  business records. Browser screenshot capture timed out through the bridge, so
  DOM/log state is the accepted live evidence for this slice.
- Current plan position after Move 842: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 841 continues the startup/preload cleanup by routing the customer-return
  modal away from the broad `window.api` compatibility facade. The modal now
  lazy-loads focused sales-read and returns-write transports directly for sale
  search, existing-return history lookup, and create-submit paths.
- Source guardrails now reject `getReturnApi`, `window.api`, and broad
  `api.getSales`/`api.getReturns`/`api.createReturn` access returning to
  `frontend/src/components/returns/NewReturnModal.tsx`, while still proving
  the sale search, history lookup, and create operations keep bounded loader
  timeouts and same-tick submit guards.
- Verification proof: focused performance-loading guards, action stability
  guards, standalone frontend typecheck, JSX/source check, frontend production
  build, full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, `git diff --check`, and in-app Browser DOM/log/interaction checks
  passed. Browser proof loaded `/returns`, opened New Return, searched for unmatched receipt
  `codex-no-sale-841`, confirmed the expected `Sale not found` state, verified
  the search was not stuck, and recorded zero relevant console errors. Browser
  screenshot capture timed out through the bridge, so DOM/log/interaction proof
  is the accepted live evidence for this slice.
- Current plan position after Move 841: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 840 continues the startup/preload cleanup by routing the supplier-return
  modal away from the broad `window.api` compatibility facade. The modal now
  lazy-loads focused branch, contact-read, inventory-read, and returns-write
  transports directly for setup, inventory refresh, and create-submit paths.
- The live browser pass exposed a real React dev StrictMode lifecycle issue:
  modal cleanup could mark the component as unmounted, then the next setup pass
  did not restore the mounted flag. That pinned setup loaders and ignored
  timeout/finally callbacks. Move 840 now resets the mounted flag on setup and
  adds a bounded setup watchdog so the supplier-return modal exits its loading
  skeleton instead of freezing.
- Source guardrails now reject `getSupplierReturnApi`, `window.api`, and broad
  `api.getBranches`/`api.getSuppliers`/`api.getInventorySummary`/
  `api.createSupplierReturn` access returning to
  `frontend/src/components/returns/NewSupplierReturnModal.tsx`, while still
  proving the setup, inventory, and create operations keep bounded loader
  timeouts and same-tick submit guards.
- Verification proof: focused performance-loading guards, action stability
  guards, standalone frontend typecheck, JSX/source check, frontend production
  build, full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, `git diff --check`, and in-app Browser DOM/log/interaction checks
  passed. Browser proof loaded `/returns`, switched to Supplier Returns, opened
  Return to Supplier, verified the modal no longer stayed in `Loading......`,
  filled product search with `mask`, filled the reason input, saw filtered
  products, and recorded zero relevant console errors. Storage prune removed
  zero bytes because retained report, backup, R2, Docker, and log policies were
  already within limits. Browser screenshot capture timed out through the
  bridge, so the accepted proof is the DOM/log/interaction state.
- Current plan position after Move 840: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 839 continues the startup/preload cleanup by removing the Product image
  upload wrapper from the broad legacy `window.api` compatibility facade. The
  Products route and Product form already import
  `frontend/src/api/productImageUploadTransport.ts` directly on image-upload
  intent, so `frontend/src/api/methods.ts` no longer keeps
  `uploadProductImage`, `loadProductImageUploadTransport`, or the dead
  product-image transport promise.
- Dashboard label stability was hardened in the same slice: visible range,
  payment-method, and no-data labels now use guarded `translateOr(...)`
  fallbacks, and source tests reject raw translation keys returning to those
  first-viewport labels.
- Build/runtime proof: production emitted `app-api-methods` at 23.75 KB, down
  from 23.94 KB in Move 838, while the focused
  `product-image-upload-api` chunk remains available at 1.29 KB. The Docker
  release runtime was rebuilt and recreated as
  `business-os:v6.0.0-202606071009-move839`; local health then served frontend
  hash `1c581b7659d369c7` with revision `move839-local`.
- Verification proof: focused API/performance/dashboard/action-stability tests,
  standalone frontend typecheck, JSX/source check, frontend production build,
  the full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local Docker health, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser live check on
  `http://127.0.0.1:4000/?codex_cache_bust=move839-fresh` found app content,
  Dashboard visible, no relevant app console errors, no raw Dashboard range or
  no-data keys, and a Custom range interaction that exposed the range inputs.
  The broad live suite supplied Playwright proof with 66 UI signals, zero
  relevant console messages, 20 public portal products, zero failed
  responses/page errors, and passing post-live hygiene. Storage prune removed
  321,415 bytes of stale retained reports while preserving uploads, secrets,
  env files, Docker volumes, active images, newest local backup sets, and the
  newest R2 backup. Browser screenshot capture timed out through the bridge
  after the Docker refresh, so the focused Browser proof for this move is
  DOM/log/interaction based.
- Current plan position after Move 839: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 838 continues the startup/preload cleanup by removing Dashboard
  operations from the broad legacy `window.api` compatibility facade. The
  Dashboard route already imports `frontend/src/api/dashboardTransport.ts`
  directly, and Inventory owns its narrow lazy dashboard loader for stats, so
  `frontend/src/api/methods.ts` no longer keeps the dead `getDashboard`,
  `getAnalytics`, or dashboard transport loader wrappers. Build proof:
  production emitted `app-api-methods` at 23.94 KB, down from 24.16 KB in
  Move 837, while the focused `dashboard-api` route chunk remains available at
  0.47 KB.
- Verification proof: focused API/performance/dashboard reliability tests,
  standalone frontend typecheck, JSX/source check, frontend production build,
  the full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error; repo Playwright
  checks supplied browser proof with 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  passing post-live hygiene. Storage prune removed 321,843 bytes of stale
  retained reports while preserving uploads, secrets, env files, Docker
  volumes, active images, newest local backup sets, and the newest R2 backup.
- Current plan position after Move 838: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 837 continues the startup/preload cleanup by removing Audit Log
  operations from the broad legacy `window.api` compatibility facade. The
  Audit Log page already imports `frontend/src/api/auditLogTransport.ts`
  directly, so `frontend/src/api/methods.ts` no longer keeps the dead
  `getAuditLogs`, `deleteAuditLogsRetention`, or audit transport loader
  wrappers. Build proof: production emitted `app-api-methods` at 24.16 KB,
  down from 24.42 KB in Move 836, while the focused `audit-log-api` route
  chunk remains available at 1.64 KB.
- Verification proof: focused API/performance/action-stability source tests,
  standalone frontend typecheck, JSX/source check, frontend production build,
  the full frontend utility suite, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error; repo Playwright
  checks supplied browser proof with 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  passing post-live hygiene. Storage prune removed 321,659 bytes of stale
  retained reports while preserving uploads, secrets, env files, Docker
  volumes, active images, newest local backup sets, and the newest R2 backup.
- Current plan position after Move 837: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 836 continues the startup/preload cleanup by removing Custom Tables
  operations from the broad legacy `window.api` compatibility facade. The
  Custom Tables component now lazy-loads
  `frontend/src/api/customTablesTransport.ts` directly when that dormant
  admin surface is opened, and `frontend/src/api/methods.ts` no longer
  carries custom-table wrappers or a custom-table loader. Build proof:
  production emitted `app-api-methods` at 24.42 KB after the cleanup, down
  from 25.24 KB in Move 835, and no custom-table API asset was emitted or
  preloaded because the Custom Tables component is not part of the active
  routed bundle.
- Verification proof: focused API/performance/action-stability source tests,
  standalone frontend typecheck, JSX/source check, full frontend utility
  suite, frontend production build, backend utility suite, schema audit,
  organization audit, generated reference refresh, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The in-app Browser path was attempted first but
  remains blocked locally by the kernel asset path error; repo Playwright
  checks supplied browser proof with 66 UI signals, zero relevant console
  messages, 20 public portal products, zero failed responses/page errors, and
  passing post-live hygiene. Storage prune removed 321,677 bytes of stale
  retained reports while preserving uploads, secrets, env files, Docker
  volumes, active images, newest local backup sets, and the newest R2 backup.
- Current plan position after Move 836: Phase 8.4 remains active for live
  browser checks and measured startup/interaction reductions; Phase 26 stays at
  51 completed organization moves; Phase 28 remains active with R2/access
  follow-up open; Phase 29 remains active as the repeated whole-codebase,
  schema, cleanup, TypeScript, runtime, and performance guardrail.

- Move 835 continues the startup/preload cleanup by retiring the obsolete
  combined access-control wrapper after its behavior was split into narrower
  user transports. The legacy `window.api.getUsers`
  compatibility wrapper now lazy-loads the 906-byte `user-read-api` chunk,
  while user profile, authentication-method, password, and role operations
  lazy-load the 2,543-byte `user-admin-api` chunk. `frontend/vite.config.ts`
  no longer emits or excludes the former access-control chunk because the
  source module is gone. Build proof: production emitted `user-read-api` at 0.91 KB,
  `user-admin-api` at 2.54 KB, `app-api-methods` at 25.24 KB,
  `api-http-core` at 21.90 KB, and no former access-control asset; built
  `index.html` has no eager preload entry for user read/admin chunks,
  `app-api-methods`, or the retired access-control chunk. Verification proof:
  focused API and performance tests, standalone frontend typecheck,
  JSX/source check, full frontend utility suite, frontend production build,
  backend utility suite, schema audit, organization audit, generated reference
  refresh, Phase 29 audit, storage prune, local health check, and `npm.cmd
  --prefix ops run phase84:live-suite -- --skip-rollback` passed. The in-app
  Browser path was attempted first but remains blocked locally by the kernel
  asset path error, so repo Playwright checks supplied browser proof: 66 UI
  signals, zero relevant console messages, 20 public portal products, zero
  failed responses/page errors, and post-live hygiene passed. Storage prune
  removed 0 bytes because local/R2 backup retention, report retention, Docker
  image retention, and log policies were already satisfied.
- Move 834 continues the startup/preload cleanup by routing the legacy
  `window.api.uploadProductImage` wrapper through the focused
  `frontend/src/api/productImageUploadTransport.ts` chunk instead of the broad
  `frontend/src/api/fileTransport.ts` library-file transport. The duplicate
  product-image upload implementation was removed from `fileTransport.ts`, so
  the file-library chunk no longer carries product upload endpoint, live-write
  channel, or browser `FormData` image logic that only product image intent
  needs. `frontend/vite.config.ts` now also excludes
  `product-image-upload-api` from eager modulepreload. Build proof: production
  emitted `file-api` at 3.70 KB, `product-image-upload-api` at 1.29 KB,
  `api-http-core` at 21.90 KB, `api-http-state` at 0.18 KB, and
  `app-api-methods` at 25.05 KB; the built `index.html` has no eager preload
  entry for `file-api`, `product-image-upload-api`, or `app-api-methods`.
  Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  JSX/source check, the full frontend utility suite, frontend production build,
  backend utility suite, schema audit, organization audit, storage prune, local
  health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The in-app Browser path was attempted first but is
  still blocked locally by the kernel asset path error, so the repo Playwright
  live suite was used for browser proof. The live suite checked 66 UI signals
  with zero relevant console messages, rendered 20 public portal products with
  zero failed responses or page errors, and passed post-live hygiene. The
  storage prune removed 643,340 bytes of stale retained live-check report
  directories while preserving uploads, secrets, env files, Docker volumes,
  active images, newest local backup sets, and the newest R2 backup.
- Move 833 continues the reset/runtime cleanup by removing duplicate
  `cacheClearAll()` calls from legacy `resetData()` and `factoryReset()`
  wrappers in `frontend/src/api/methods.ts`. Both flows still clear cache once
  through `invalidateClientRuntimeState()`, which also resets client runtime
  state and emits the runtime sync event; the outer wrappers no longer
  re-import the HTTP core and clear the same cache a second time. Build proof:
  production emitted `api-http-state` at 0.18 KB, `api-http-core` at 21.90 KB,
  and reduced `app-api-methods` from 25.00 KB to 24.93 KB. Verification proof:
  `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses or page errors, and passed post-live hygiene. The storage
  prune removed 321,343 bytes of stale retained live-check report directories
  while preserving uploads, secrets, env files, Docker volumes, active images,
  newest local backup sets, and the newest R2 backup.
- Move 832 continues the startup/preload cleanup by splitting the legacy
  sync-server URL/token state out of `frontend/src/api/http.ts` and into the
  tiny `frontend/src/api/httpState.ts` module. `frontend/src/api/methods.ts`
  now imports only the synchronous `getSyncServerUrl()` helper from that state
  module and lazy-loads `http.ts` only when reset/cache-clear flows need
  `cacheClearAll()`. Build proof: production emitted `api-http-state` at
  0.18 KB, `api-http-core` at 21.90 KB, and `app-api-methods` at 25.00 KB.
  The earlier circular chunk warning is gone; compiled `app-api-methods`
  statically imports only the 0.18 KB state chunk and references
  `api-http-core` through Vite's dynamic dependency map for reset-like flows.
  Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses or page errors, and passed post-live hygiene. The storage
  prune removed 321,475 bytes of stale retained live-check report directories
  while preserving uploads, secrets, env files, Docker volumes, active images,
  newest local backup sets, and the newest R2 backup.
- Move 831 continues the startup/preload cleanup by removing the remaining
  static runtime-reset and app-refresh utility imports from
  `frontend/src/api/methods.ts`. Legacy reset/data-path invalidation now
  lazy-loads `clientRuntime.ts` only when a reset-like flow runs, and category
  or unit mutations lazy-load `appRefresh.ts` only after the write succeeds.
  The category/unit refresh channel lists stay local to the legacy facade so
  `settingsRefresh.ts` does not ride along with registry load. Build proof:
  the production build emits `settings-refresh` at 1.45 KB as a deferred
  dependency; compiled `app-api-methods` references the helper chunk through
  Vite's dynamic dependency map. The compatibility facade grew from 24.39 KB
  to 24.80 KB because of the final lazy wrapper metadata, but the runtime reset
  and refresh helper code is no longer evaluated on registry load. Verification
  proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed
  321,164 bytes of stale retained live-check report directories while
  preserving uploads, secrets, env files, Docker volumes, active images, and
  newest backup sets.
- Move 830 continues the startup/preload cleanup by turning legacy auth,
  organization, Google OAuth, and OTP wrappers in `frontend/src/api/methods.ts`
  into lazy facades. The focused `authTransport.ts` remains the behavior owner
  for login/logout, password reset, session duration, verification
  capabilities, organization bootstrap/search/current-organization reads,
  Google OAuth, and OTP setup/confirm/disable/verify/status. Build proof:
  `app-auth` emitted at 1.96 KB as an intent chunk; compiled
  `app-api-methods` no longer has a static source import for `authTransport.ts`
  and references the emitted auth chunk only through Vite's dynamic import
  dependency map. The compatibility facade grew from 23.84 KB to 24.39 KB
  because of the lazy wrapper metadata, but it now avoids automatic auth
  transport request and evaluation on legacy API registry load. Verification
  proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed 0
  bytes because local/R2 backup retention, report retention, and Docker safety
  policies were already satisfied.
- Move 829 continues the startup/preload cleanup by turning legacy Branches and
  Inventory read/transfer wrappers in `frontend/src/api/methods.ts` into lazy
  facades. The focused `branchTransport.ts` remains the behavior owner for
  branch reads, CRUD, stock reads, transfers, and integrity repair; the focused
  `inventoryTransport.ts` remains the behavior owner for inventory summary,
  stats, bootstrap, product search, movement reads, and saved reasons. Build
  proof: `branch-api` emitted at 1.96 KB and `inventory-api` emitted at 1.55
  KB as intent chunks; compiled `app-api-methods` no longer has static imports
  for either transport and only references them through dynamic calls. The
  facade wrapper grew from 23.26 KB to 23.84 KB, but it now avoids automatic
  branch/inventory transport request and evaluation on legacy API registry
  load. Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, storage prune,
  local health check, and `npm.cmd --prefix ops run phase84:live-suite --
  --skip-rollback` passed. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed
  321,689 bytes of stale retained live-check report directories while
  preserving uploads, secrets, env files, Docker volumes, active images, and
  newest backup sets.
- Move 828 continues the startup/preload cleanup by turning the legacy
  `frontend/src/api/methods.ts` registry into a lazy facade for product reads,
  category/unit lookup reads and writes, access-control/role operations,
  custom-table operations, query-cache cleanup, and sensitive mirror purge. The
  focused transports keep owning their real behavior:
  `productReadTransport.ts` owns product search/bootstrap/lookup replacement,
  `lookupTransport.ts` owns category/unit route mirroring and expected-update
  writes, the then-current access-control transport owned Users/Roles reads and mutations, and
  `customTablesTransport.ts` owns custom-table row access. Build wiring now
  gave access control and custom tables named access-control and
  `custom-tables-api` intent chunks and excludes both from eager module
  preload. Verification proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, generated
  reference refresh, Phase 29 audit, schema audit, organization audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The build emitted the then-current access-control chunk at 2.07
  KB, `custom-tables-api` at 1.28 KB, kept `product-read-api` as the focused
  7.00 KB lazy dependency, and reduced `app-api-methods` from 23.51 KB to
  23.26 KB while removing the static `product-read-api` import from the
  emitted legacy registry. The live suite checked 66 UI signals with zero
  relevant console messages, rendered 20 public portal products with zero
  failed responses, and passed post-live hygiene. The storage prune removed 0
  bytes because local/R2 backup retention, report retention, and Docker safety
  policies were already satisfied.
- Move 827 moves system job status, cancel, poll, backup export queue, and
  backup restore queue calls out of the legacy eager API registry and behind
  the focused `frontend/src/api/systemJobs.ts` transport. The typed transport
  continues to own system job ID validation, long polling, queue timeouts, and
  backup export/restore route payloads. Build wiring now emits a separate
  `system-jobs-api` intent chunk and excludes it from eager module preload.
  Proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\backupJobs.test.ts`, standalone frontend typecheck, the full
  frontend utility suite, frontend production build, generated reference
  refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  build emitted `system-jobs-api` at 1.48 KB and reduced `app-api-methods` to
  23.51 KB. The storage prune removed 89,157 bytes of stale retained reports.
- Move 826 moves notification summary reads out of the legacy eager API
  registry and behind the focused `frontend/src/api/notificationSummary.ts`
  transport. The focused transport continues to own transient-gateway fallback,
  404/missing cooldown, notification summary fallback payloads, and in-flight
  request reuse. `frontend/vite.config.ts` now excludes `notification-api`
  from eager module preload so the notification fallback path stays
  intent-loaded instead of startup-preloaded. Proof: `node
  frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\notificationBadge.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, generated
  reference refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  build emitted `notification-api` at 1.63 KB and kept `app-api-methods` at
  24.39 KB while removing the static notification summary import from the
  legacy registry. The storage prune removed 89,315 bytes of stale retained
  reports.
- Move 825 moves Google Drive sync status, preference save, OAuth start,
  disconnect, credential-forget, queued sync, and immediate sync calls out of
  the legacy eager API registry and behind the focused
  `frontend/src/api/driveSync.ts` transport. The typed transport continues to
  own Drive status cooldown fallback, in-flight status request reuse, Drive
  preference/job routes, and manual sync trigger behavior. Build wiring now
  emits a separate `drive-sync-api` intent chunk and excludes it from eager
  module preload. Proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\backupJobs.test.ts`, standalone frontend typecheck, the full
  frontend utility suite, frontend production build, generated reference
  refresh, Phase 29 audit, storage prune, local health check, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  build emitted `drive-sync-api` at 1.82 KB and reduced `app-api-methods` to
  24.31 KB. The storage prune removed 137,941 bytes of stale retained reports.
- Move 824 moves pending sync queue reads, queue discard, and manual retry out
  of `frontend/src/api/methods.ts` and into
  `frontend/src/api/pendingSyncTransport.ts`. The typed transport now owns
  Dexie `sync_queue` reads and clears, compact pending queue preview
  serialization, sync queue changed events, discard update broadcasts, and
  retry delegation to the sale write transport. The legacy registry keeps the
  same `window.api` names but now lazy-loads the focused transport and no
  longer imports local DB, sync preview, query, or sync runtime helpers for
  those paths. Proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\offlineSalesQueue.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, standalone frontend typecheck,
  the full frontend utility suite, frontend production build, Phase 29 audit,
  storage prune, local health check, and `npm.cmd --prefix ops run
  phase84:live-suite -- --skip-rollback` passed. The build emitted
  `pending-sync-api` at 1.66 KB and reduced `app-api-methods` to 25.07 KB. The
  storage prune removed 238,300 bytes of stale retained reports.
- Move 823 moves the remaining legacy sales mutation/export implementation out
  of `frontend/src/api/methods.ts` and into `frontend/src/api/salesTransport.ts`.
  The typed transport now owns sales status updates, customer membership
  attachment, sales export query construction, encoded sale IDs, expected
  `updated_at` guards, local sales row updates, and attempted conflict metadata.
  The legacy registry keeps the same `window.api` names but now lazy-loads the
  focused transport. Proof: `node frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\actionStability.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, the full frontend utility
  suite, standalone frontend typecheck, frontend production build, Phase 29
  audit, storage prune, local health check, and `npm.cmd --prefix ops run
  phase84:live-suite -- --skip-rollback` passed. The build emitted
  `sales-read-api` at 2.40 KB and reduced `app-api-methods` to 26.58 KB. The
  storage prune removed 302,307 bytes of stale retained reports.
- Move 822 moves the remaining legacy return API implementation out of
  `frontend/src/api/methods.ts` and into `frontend/src/api/returnsTransport.ts`.
  The typed transport now owns return reads, return detail reads, customer and
  supplier return creation, return updates, return request IDs, encoded return
  IDs, local return mirror/update behavior, and return conflict-attempt
  metadata. The legacy registry keeps the same `window.api` names but now
  lazy-loads the focused transport. Proof: `node
  frontend\tests\apiHttp.test.ts`, `node
  frontend\tests\actionStability.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, the full frontend utility
  suite, frontend production build, Phase 29 audit, storage prune, and
  `npm.cmd --prefix ops run phase84:live-suite -- --skip-rollback` passed. The
  build emitted `returns-api` at 1.93 KB and reduced `app-api-methods` to 27.90
  KB. The storage prune removed 267,804 bytes of stale retained reports without
  touching uploads, secrets, env files, newest backups, or running data.
- Move 821 removes the duplicated untyped offline snapshot refresh
  implementation from `frontend/src/api/methods.ts`. The legacy API registry
  now lazy-loads `frontend/src/api/offlineSnapshotTransport.ts` for
  `refreshOfflineDeviceSnapshot`, keeping server/session guards, five-minute
  refresh throttling, local snapshot metadata, settings snapshot persistence,
  and local mirror refresh steps in the typed transport chunk. This removes the
  old inline snapshot loop from the broad registry while preserving the
  `window.api.refreshOfflineDeviceSnapshot` contract. Proof:
  `node frontend\tests\offlineSalesQueue.test.ts`, `node
  frontend\tests\performanceLoadingUx.test.ts`, `node
  frontend\tests\apiHttp.test.ts`, and `node
  frontend\tests\offlineSecurityHardening.test.ts` passed, then the full
  frontend utility suite, frontend production build, Phase 29 audit, storage
  prune, local health check, and `npm.cmd --prefix ops run phase84:live-suite
  -- --skip-rollback` passed. The build emitted `offline-snapshot-api` at 2.67
  KB and reduced `app-api-methods` to 28.85 KB.
- Move 820 removes the duplicated untyped Settings read/save implementation
  from `frontend/src/api/methods.ts`. The legacy API registry now lazy-loads
  `frontend/src/api/settingsTransport.ts` for `getSettings` and `saveSettings`,
  keeping conflict retries, inline `updatedAt` handling, local mirror writes,
  and refresh-channel logic in the typed transport. This removes 100 lines from
  the broad registry while preserving the `window.api` contract. Proof:
  `node frontend\tests\performanceLoadingUx.test.ts`, frontend typecheck,
  JSX/source check, frontend production build, and `npm.cmd --prefix ops run
  phase84:settings-save-rollback` passed. The build emitted
  `settings-api` at 2.10 KB and `app-api-methods` at 30.22 KB.
- Move 819 adds rollback-safe live coverage for the Settings page Save action.
  The new `ops/scripts/runtime/live-checks/phase84-settings-save-rollback-check.ts`
  snapshots `business_name`, uses the real Settings UI to change it, clicks
  Save, verifies `/api/settings` persisted the temporary value, then restores
  the original value. It is exposed as `npm.cmd --prefix ops run
  phase84:settings-save-rollback` and is now included in the default
  `phase84:live-suite` rollback group. Proof:
  `ops/runtime/reports/phase84-settings-save-rollback-check-2026-06-07T00-47-55-940Z/report.json`
  and `ops/runtime/reports/phase84-live-suite-latest.json`, where the suite
  passed UI, public portal, receipt rollback, loyalty rollback, settings
  rollback, and hygiene steps.
- Move 818 adds dedicated rollback-safe live coverage for Loyalty Points save.
  The new `ops/scripts/runtime/live-checks/phase84-loyalty-points-rollback-check.ts`
  snapshots loyalty settings, uses the real UI to switch the earning basis,
  clicks Save, verifies `/api/settings` persisted the expected values, then
  restores the exact snapshot. It is available as `npm.cmd --prefix ops run
  phase84:loyalty-points-rollback` and is now included in the default
  `phase84:live-suite` behind the new `--skip-rollback` suite option. Proof:
  `ops/runtime/reports/phase84-loyalty-points-rollback-check-2026-06-07T00-41-14-929Z/report.json`
  and `ops/runtime/reports/phase84-live-suite-latest.json`, where the suite
  passed UI, public portal, receipt rollback, loyalty rollback, and hygiene
  steps with zero relevant console messages.
- Move 817 strengthened the Phase 8.4 all-pages control audit. The audit now
  skips mutating/file/print/settings-toggle controls before applying the
  long-label stability guard, uses a configurable 96-character stable label
  limit, and reloads the route between safe button clicks so tab/panel controls
  do not hide later candidates from the same route. The targeted Receipt
  Settings/Loyalty Points rerun passed with 4 routes, 27 tested controls, 0
  failed controls, and 0 findings. The full broad all-pages audit then passed
  with 34 routes, 454 controls, 398 tested controls, 56 guarded skips, 0 failed
  controls, 0 layout/network/console findings, 68 screenshots, and a 12.3%
  skipped-control ratio. Proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-07T00-22-18-993Z/summary.json`.
- Move 816 built and started Docker release `business-os:v6.0.0-202606070759`
  for the compact public portal mobile polish. The public Cloudflare portal
  check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-07T00-02-46-596Z/report.json`
  passed on frontend hash `8d3cdc06c5e7b390`: it rendered 20 products, loaded
  the About/Assistant mobile path with no generic `Loading customer portal...`
  panel left visible, measured a 413 px About hero, a 134 px contact tray, zero
  horizontal overflow, HTTP 200 portal bootstrap and AI status, zero failed
  responses, zero relevant console messages, and zero page errors. The route
  trace loaded Dashboard in 211 ms, Inventory in 184 ms, Sales in 181 ms, and
  Audit Log in 181 ms with zero failed requests and zero console errors.
  Ignored regenerable output was removed again: `frontend/dist` (31,828,646
  bytes) and `release` (380,875,107 bytes), for 412,703,753 bytes reclaimed.
  `npm.cmd --prefix ops run prune-storage` then removed 293,626 bytes of stale
  runtime reports, two old Docker-release backup packages (10,115,370 bytes
  total), old Docker rollback tags `business-os:v6.0.0-202606070634` and
  `business-os:v6.0.0-202606070604`, and 2.538 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070759` were not touched. Phase 29 and
  schema audits passed after cleanup. The obsolete manual verification command
  `node ops\scripts\backend\schema-audit.js` was corrected to the current
  TypeScript entrypoint, `node ops\scripts\backend\schema-audit.ts`.
- Move 815 built and started Docker release `business-os:v6.0.0-202606070725`
  for rounded custom filter dropdown hardening. The focused filter-menu live
  check
  `ops/runtime/reports/phase84-filter-menu-live-check-2026-06-06T23-29-11-677Z/report.json`
  passed Products, Inventory, Audit Log, Library, Dashboard, and POS with no
  stray `Back` label, rounded sections/options, HTTP 200 reads, no framework
  overlay, and zero relevant console messages. The shared-select live check
  also passed on frontend hash `c36ea69af92f848f`. The route trace loaded
  Dashboard in 245 ms, Inventory in 243 ms, Sales in 183 ms, and Audit Log in
  167 ms with zero failed requests and zero console errors. Ignored
  regenerable output was removed again: `frontend/dist` (31,827,380 bytes) and
  `release` (380,878,695 bytes), for 412,706,075 bytes reclaimed.
  `npm.cmd --prefix ops run prune-storage` then removed 306,905 bytes of stale
  runtime reports, Docker-release backup `20260607-061341` (5,056,608 bytes),
  old Docker rollback tags `business-os:v6.0.0-202606070530` and
  `business-os:v6.0.0-202606070504`, and 2.5 GB of Docker builder cache. Phase
  29 and schema audits passed after cleanup.
- Move 802 built and started Docker release `business-os:v6.0.0-202606061709`
  for the Dashboard export/report split. `Dashboard.tsx` now lazy-loads
  `dashboardExport.ts` only from export actions; the export module owns CSV row
  assembly, dashboard formula rows, standalone report HTML, and ZIP package
  generation. `frontend/vite.config.ts` keeps visible chart components in a
  separate `dashboard-charts` chunk so Rollup does not park shared chart code
  inside the export-only chunk. The production build emits `Dashboard` at
  63.64 kB, `dashboard-charts` at 10.70 kB, and intent-only
  `dashboard-export` at 20.52 kB. The focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-06T09-12-04-350Z.json`
  loaded Dashboard in 322 ms ready time with 25 requests, 19 scripts, 2 API
  calls, no failed requests, no relevant console errors, and zero
  `dashboard-export-*` requests on normal route entry. The broad Phase 8.4 UI
  live check
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T09-12-04-495Z/report.json`
  passed with 66 checked signals, all probed route/API signals at HTTP 200,
  no framework overlay, and zero relevant console messages. The public
  Cloudflare portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T09-12-43-086Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Before restart, the
  Docker update created backup
  `ops/runtime/docker-release/backups/20260606-171118`; Docker then showed only
  the expected release stack: app, cloudflared, import worker, media worker,
  Postgres, Redis queue, and Redis cache. After live proof, ignored
  regenerable output was removed again: `frontend/dist` (31,781,438 bytes) and
  `release` (380,845,720 bytes), for 412,627,158 bytes reclaimed. The follow-up
  Phase 29 audit passed all nine checks. `npm.cmd --prefix ops run
  prune-storage` still has the non-data follow-up for locked old Vite preview
  report log `ops/runtime/reports/vite-preview-appselect.log`.
- Move 801 built and started Docker release `business-os:v6.0.0-202606061633`
  for the Products CSV export split. `Products.tsx` now lazy-loads
  `productExport.ts` only when the CSV export action runs; the export module
  owns row normalization, image gallery flattening, branch-stock summary
  formatting, and price formatting. The production build emits
  `assets/Products-*.js` at 96.60 kB and the intent-only
  `assets/product-export-*.js` at 2.60 kB, moving 2.20 kB out of the first
  Products route chunk compared with the previous 98.80 kB baseline. The
  focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-06T08-38-13-721Z.json`
  loaded Products in 315 ms ready time with 35 requests, 27 scripts, 2 API
  calls, no failed requests, no relevant console errors, and no
  `product-export-*` request on normal route entry. The broad Phase 8.4 UI
  live check
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T08-38-27-510Z/report.json`
  passed with 66 checked signals, all probed route/API signals at HTTP 200,
  no framework overlay, and zero relevant console messages. The public
  Cloudflare portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T08-39-03-098Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Docker showed only the
  expected release stack: app, cloudflared, import worker, media worker,
  Postgres, Redis queue, and Redis cache. After live proof, ignored
  regenerable output was removed again: `frontend/dist` (31,780,848 bytes) and
  `release` (380,849,816 bytes), for 412,630,664 bytes reclaimed. The
  follow-up Phase 29 audit passed all nine checks. `npm.cmd --prefix ops run
  prune-storage` still has a non-data follow-up: it could not remove a locked
  old Vite preview report log, `ops/runtime/reports/vite-preview-appselect.log`.
- Move 800 built and started Docker release `business-os:v6.0.0-202606061614`
  for the Inventory export/report split. `Inventory.tsx` now lazy-loads
  `inventoryExport.ts` only when an export action is requested; the export
  module owns CSV rows, report HTML assembly, and ZIP packaging. The production
  build emits `assets/Inventory-*.js` at 132.96 kB and the intent-only
  `assets/inventory-export-*.js` at 16.71 kB, moving about 13 kB out of the
  first Inventory route chunk compared with the previous 145.95 kB baseline.
  The focused route trace
  `ops/runtime/reports/route-load-trace-2026-06-06T08-16-53-367Z.json`
  loaded Inventory in 371 ms ready time with 37 requests, 30 scripts, 2 API
  calls, no failed requests, no relevant console errors, and no
  `inventory-export-*` request on normal route entry. The broad Phase 8.4 UI
  live check
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T08-17-36-183Z/report.json`
  passed with 66 checked signals, all probed route/API signals at HTTP 200,
  no framework overlay, and zero relevant console messages. The public
  Cloudflare portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T08-18-14-943Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP present. Docker now shows only
  the expected release stack: app, cloudflared, import worker, media worker,
  Postgres, Redis queue, and Redis cache. After live proof, ignored
  regenerable output was removed again: `frontend/dist` (31,780,450 bytes) and
  `release` (380,849,304 bytes), for 412,629,754 bytes reclaimed. The
  follow-up Phase 29 audit passed all nine checks.
- Move 799 built and started Docker release `business-os:v6.0.0-202606061544`
  for shared filter/dropdown polish. The focused filter-menu live check
  `ops/runtime/reports/phase84-filter-menu-live-check-2026-06-06T07-46-47-026Z/report.json`
  passed Products, Inventory, Audit, Library, Dashboard, and POS with rounded
  sections/options, compact POS filter rows, no stray `Back` labels, HTTP 200
  filter reads, no framework overlay, and zero relevant console messages.
  The broad Phase 8.4 UI live check
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T07-46-47-867Z/report.json`
  passed the Docker-served app with all probed route/API signals at HTTP 200.
  The public Cloudflare portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T07-47-54-599Z/report.json`
  rendered 20 products at `https://leangcosmetics.dpdns.org/public` with
  portal bootstrap 200, AI status 200 after interaction, enforced CSP present,
  no internal server error, zero failed responses, zero relevant console
  messages, and zero page errors.
- Move 796 built and started Docker release `business-os:v6.0.0-202606061516`
  for the receipt export fallback hardening. The focused receipt export live
  check
  `ops/runtime/reports/phase84-receipt-export-layout-check-2026-06-06T07-16-15-109Z/report.json`
  passed settings preview, Sales reprint modal, print-preview popup, and PNG
  download. The check now explicitly rejects sale status rows, redundant
  `@ $...` unit-price lines, missing Name/Qty/Price item headers, overflow,
  and collapsed image exports. The broad Phase 8.4 UI live check
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T07-16-37-505Z/report.json`
  also passed on the same Docker image with all probed routes/API calls at
  HTTP 200, no framework overlay, and zero relevant console messages.
- Move 795 built and started Docker release `business-os:v6.0.0-202606050903`
  for the Returns icon-chunk startup optimization. The focused local
  route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-05T01-14-26-794Z.json`
  loaded Returns with 27 total requests, 22 script requests, 2 API requests,
  ready text at 190 ms, and zero failed requests or page errors. Compared with
  the previous Returns baseline, this removes one request and one script fetch
  while keeping the shared icon chunk bounded at 11,985 bytes. After live
  proof, ignored regenerable output was removed again: `release` (380,751,752
  bytes) and `frontend/dist` (31,738,016 bytes), for 412,489,768 bytes
  reclaimed. Uploads, secrets, env files, databases, volumes, backups, and the
  active Docker image were not touched. The follow-up `prune-storage` removed
  1,563 bytes of stale report metadata, 1.269 GB of Docker builder cache, and
  only the old rollback tag `business-os:v6.0.0-202606050504`, while
  preserving active image `business-os:v6.0.0-202606050903`,
  `business-os:latest`, and rollback tags `v6.0.0-202606050831`,
  `v6.0.0-202606050809`, `v6.0.0-202606050737`, and
  `v6.0.0-202606050515`.
- Move 794 built and started Docker release `business-os:v6.0.0-202606050831`
  for the Contacts icon-chunk startup optimization. The focused local
  route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-05T00-47-32-343Z.json`
  loaded Contacts with 30 total requests, 25 script requests, 2 API requests,
  ready text at 215 ms, and zero failed requests or page errors. Compared with
  Move 793's Contacts baseline, this removes two requests and two script
  fetches while keeping the shared icon chunk bounded at 11,651 bytes. After
  live proof, ignored regenerable output was removed again: `release`
  (380,754,312 bytes) and `frontend/dist` (31,738,200 bytes), for
  412,492,512 bytes reclaimed. Uploads, secrets, env files, databases,
  volumes, backups, and the active Docker image were not touched. The follow-up
  `prune-storage` removed 770 bytes of stale report metadata, 38.22 MB of
  Docker builder cache, and only the old rollback tag
  `business-os:v6.0.0-202606050450`, while preserving active image
  `business-os:v6.0.0-202606050831`, `business-os:latest`, and rollback tags
  `v6.0.0-202606050809`, `v6.0.0-202606050737`,
  `v6.0.0-202606050515`, and `v6.0.0-202606050504`.
- Move 793 built and started Docker release `business-os:v6.0.0-202606050809`
  for the inline-runtime-guard optimization, then removed ignored/regenerable
  output after live verification: `release` (380,754,312 bytes) and
  `frontend/dist` (31,738,771 bytes), for 412,493,083 bytes removed. The
  follow-up `prune-storage` removed 311,268 bytes of old live-check report
  folders, 38.22 MB of Docker builder cache, and only the oldest rollback
  image tag `business-os:v6.0.0-202606050445`. It preserved uploads, secrets,
  env files, databases, volumes, backup roots, active image
  `business-os:v6.0.0-202606050809`, `business-os:latest`, and rollback tags
  `v6.0.0-202606050737`, `v6.0.0-202606050515`,
  `v6.0.0-202606050504`, and `v6.0.0-202606050450`.
- Move 792 added policy-backed Docker image retention to
  `ops/scripts/runtime/storage/prune-storage.ts`. The dry-run preview planned
  one deletion, `business-os:v6.0.0-202606050440`, while protecting
  `business-os:latest`, active image `business-os:v6.0.0-202606050737`, the
  running image ID, and four newest rollback tags. The apply run removed only
  that stale tag plus 176,008 bytes of old route-trace reports; it did not run
  `docker image prune`, `docker system prune`, or `docker volume prune`, and
  preserved uploads, secrets, env files, databases, volumes, backups, active
  image, and rollback images. Final Docker image set is `latest`,
  `v6.0.0-202606050737`, `v6.0.0-202606050515`,
  `v6.0.0-202606050504`, `v6.0.0-202606050450`, and
  `v6.0.0-202606050445`.
- The Move 791 generated-artifact cleanup removed 412,470,343 bytes from
  regenerable `release` and `frontend/dist` folders after Docker image
  `business-os:v6.0.0-202606050737` was built and verified healthy. The
  focused Inventory persisted-section live check seeded
  `business-os:inventory:section:v2=all`, opened Inventory, confirmed
  `Products` stayed active, loaded exactly one product startup read through
  `/api/inventory/bootstrap`, and recorded zero stats, movements, RFID,
  dashboard, or returns startup reads. `npm.cmd --prefix ops run
  prune-storage` removed 488,515 bytes of old reports and 21.32 GB of Docker
  builder cache while preserving uploads, secrets, env files, databases,
  volumes, backup roots, and the newest R2 backup
  `datasync-2026-06-04T21-30-57-430Z`. Phase 29 audit passed with zero
  failures after cleanup.
- The Move 790 generated-artifact cleanup removed 444,183,234 bytes from
  regenerable `release` and `frontend/dist` folders across the post-release
  and post-build cleanup passes. Docker release image
  `business-os:v6.0.0-202606050515` is running, and `business-os:latest` was
  retagged to that verified image.
- Move 790 pruned 98 stale `business-os:v6.0.0-*` Docker image tags while
  keeping the active image plus four recent rollback tags:
  `v6.0.0-202606050515`, `v6.0.0-202606050504`,
  `v6.0.0-202606050450`, `v6.0.0-202606050445`, and
  `v6.0.0-202606050440`. Docker image count dropped from 109 to 11 without
  pruning volumes, uploads, databases, or secrets.
- The Move 790 `npm.cmd --prefix ops run prune-storage` pass removed 371,474
  bytes of old runtime reports and 76.44 MB of Docker builder cache while
  keeping uploads, secrets, env files, backup roots, Docker images/volumes, and
  newest R2 backup `datasync-2026-06-04T21-30-57-430Z`.
- The follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero
  failures after cleanup.

- The Move 789 generated-artifact cleanup removed 412,463,075 bytes from
  regenerable `release` and `frontend/dist` folders after Docker image
  `business-os:v6.0.0-202606050450` was already built and running. The
  follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero
  failures.
- The Move 789 `npm.cmd --prefix ops run prune-storage` pass removed 264,795
  bytes of old runtime reports and 76.43 MB of Docker builder cache. It kept
  uploads, secrets, env files, local backup retention roots, Docker images,
  Docker volumes, and newest R2 backup `datasync-2026-06-04T15-29-49-246Z`.
- Move 789 also fixed the Docker release env writer in
  `ops/scripts/powershell/docker-release.ps1` after a successful image build
  failed while writing `docker-release.env`; the wrapper now writes the env
  lines with explicit .NET `WriteAllLines` and the rerun completed.

- The Move 788 generated-artifact cleanup removed 412,461,000 bytes from
  regenerable `release` and `frontend/dist` folders after Docker image
  `business-os:v6.0.0-202606050403` was already built and running. The
  follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero
  failures.
- The Move 788 `npm.cmd --prefix ops run prune-storage` pass removed 319,795
  bytes of old runtime reports and 38.21 MB of Docker builder cache. It kept
  uploads, secrets, env files, local backup retention roots, Docker images,
  Docker volumes, and newest R2 backup `datasync-2026-06-04T15-29-49-246Z`.

- The Move 787 generated-artifact cleanup removed 412,455,989 bytes from
  regenerable `release` and `frontend/dist` folders after Docker image
  `business-os:v6.0.0-202606050336` was already built and running. The
  follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero
  failures.
- The Move 787 `npm.cmd --prefix ops run prune-storage` pass removed 252,488
  bytes of old runtime reports and 38.2 MB of Docker builder cache. It kept
  uploads, secrets, env files, local backup retention roots, Docker images,
  Docker volumes, and newest R2 backup `datasync-2026-06-04T15-29-49-246Z`.

- The Move 786 generated-artifact cleanup removed 412,453,034 bytes from
  regenerable `release` and `frontend/dist` folders after Docker image
  `business-os:v6.0.0-202606050317` was already built and running. The
  follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero
  failures.
- The Move 786 `npm.cmd --prefix ops run prune-storage` pass removed 300,396
  bytes of old runtime reports and 38.2 MB of Docker builder cache. It kept
  uploads, secrets, env files, local backup retention roots, Docker images,
  Docker volumes, and newest R2 backup `datasync-2026-06-04T15-29-49-246Z`.

- The Move 784 generated-artifact cleanup removed 380,729,941 bytes from the
  regenerable `release` folder after Docker image
  `business-os:v6.0.0-202606042015` was already built and running. The host
  `frontend/dist` folder was already absent. The follow-up
  `npm.cmd --prefix ops run phase29:audit` passed with zero failures.
- The Move 784 `npm.cmd --prefix ops run prune-storage` pass removed 226,683
  bytes of old runtime reports and 38.19 MB of Docker builder cache. It kept
  uploads, secrets, env files, local backup retention roots, Docker images,
  Docker volumes, and newest R2 backup `datasync-2026-06-04T09-26-59-912Z`.

- The Move 783 generated-artifact cleanup removed 412,448,579 bytes from
  regenerable `release` and `frontend/dist` folders after Docker image
  `business-os:v6.0.0-202606041924` was already built and running. The
  follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero
  failures.
- The Move 783 `npm.cmd --prefix ops run prune-storage` pass removed 160,733
  bytes of old runtime reports and 38.19 MB of Docker builder cache. It kept
  uploads, secrets, env files, local backup retention roots, Docker images,
  Docker volumes, and newest R2 backup `datasync-2026-06-04T09-26-59-912Z`.

- `npm.cmd --prefix ops run prune-storage` in the Move 782 verification pass
  removed 326,086 bytes of old runtime reports and 38.19 MB of Docker builder
  cache. It kept uploads, secrets, env files, newest local backup packages,
  Docker images, Docker volumes, and retained newest R2 backup object
  `datasync-2026-06-04T09-26-59-912Z`.
- The Move 782 generated-artifact cleanup removed an additional 412,447,007
  bytes from regenerable `release` and `frontend/dist` folders after Docker
  image `business-os:v6.0.0-202606041904` was already built and running. The
  follow-up `npm.cmd --prefix ops run phase29:audit` passed with zero failures.

Current honest pockets:

- Move 784 is now served by Docker release image
  `business-os:v6.0.0-202606042015`. The Cloudflare startup warmup now retries
  transient document failures with five configurable attempts and a two-second
  delay. Before the fix, startup warmup could report both public and admin
  documents as Cloudflare Tunnel 1033/530 with zero warmed targets while the
  local app was healthy. The launcher proof now passes through
  `run\docker\start.bat`, writes
  `ops/runtime/docker-release/cloudflare-startup-warmup.json`, and reports
  `ok=true`, `failedCount=0`, 26 targets, and retry options
  `documentAttempts=5` / `documentRetryDelayMs=2000`.
- The rebuilt Docker image reports source hash `5d419c030bf25d50` and
  frontend hash `e00a60f6b9937815`. The broad local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T12-18-08-251Z.json` passed
  Dashboard, Products, POS, Inventory, Contacts, Sales, Returns, and Server
  with zero failed requests and zero console/page errors. Public Cloudflare
  portal proof rendered 20 products, confirmed portal bootstrap 200 and AI
  status 200 after interaction, enforced CSP was present, and recorded zero
  failed responses, zero relevant console messages, and zero page errors.
- Guardrail proof: Docker release verification now requires the Cloudflare
  startup warmup retry knobs, transient failure predicate, attempt reporting,
  and release-start coverage. Post-live hygiene passed with zero QA/smoke
  cleanup matches, zero generated integrity matches, loaded dataset status, and
  relationship orphan checks passing for 49 FK candidates.

- Move 783 is now served by Docker release image
  `business-os:v6.0.0-202606041924`. `POS.tsx` no longer statically imports
  `contactOptionUtils`; customer contact parsing is behind the memoized
  `loadContactOptionUtilsModule()` boundary. The Docker-served POS trace
  passed in 235 ms with 30 requests, 22 scripts, two API calls, zero failed
  requests, zero console/page errors, and `hasContactOptionUtils=false`.
- Authenticated Playwright interaction proof loaded POS, opened the customer
  panel, accepted customer search input, and recorded zero failed requests and
  zero page errors.
- Public Cloudflare portal proof rendered 20 products at
  `https://leangcosmetics.dpdns.org/public`, confirmed portal bootstrap 200
  and AI status 200 after interaction, and recorded zero failed responses,
  zero relevant console messages, and zero page errors.

- Move 782 is now served by Docker release image
  `business-os:v6.0.0-202606041904`. `CustomersTab.tsx`,
  `SuppliersTab.tsx`, and `DeliveryTab.tsx` no longer statically import
  `../../utils/csv`; each export button now lazy-loads the CSV helper through
  a memoized dynamic import only after export intent. `performanceLoadingUx`
  rejects static contact CSV imports and requires the memoized dynamic import
  path. Local Docker-served Contacts route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T11-14-33-581Z.json` passed
  in 233 ms with 34 requests, 29 scripts, two API calls, zero failed
  responses, zero console/page errors, and `hasCsvUtils=false`. Public portal
  Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T11-14-33-554Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors. Post-live hygiene passed with loaded
  dataset status, zero QA/smoke/action-history cleanup matches, zero generated
  integrity matches, and relationship orphan checks passing for 49 FK
  candidates.

- Move 781 is served by Docker release image
  `business-os:v6.0.0-202606041117`. `Sales.tsx` uses focused
  `salesTransport.getSales()` and `userReadTransport.getUsers()` for normal
  route-start reads, while write/status/member actions remain on the existing
  action API. `Returns.tsx` uses focused `returnsTransport.getReturns()` for
  normal list reads, while detail/snapshot/restore writes remain action-bound.
  `frontend/vite.config.ts` now splits `http.ts`, `query.ts`, and
  `actorQuery.ts` into `api-http-core` so focused read transports do not
  inherit broad `app-api-methods` chunk references. `performanceLoadingUx`
  guards now reject Sales/Returns route-start reads through the broad API
  registry and require the focused HTTP core chunk rule.
  Standalone production output emits `api-http-core-BRrzV8AY.js` at 20.79 KB
  gzip 7.34 KB, `app-api-CJUW8tAi.js` at 4.41 KB gzip 1.72 KB,
  `sales-read-api-BBx8NexI.js` at 0.36 KB gzip 0.28 KB,
  `user-read-api-BIsGsdp_.js` at 0.93 KB gzip 0.46 KB,
  `returns-api-CgYUCNqr.js` at 1.03 KB gzip 0.52 KB,
  `Sales--kY2zhyr.js` at 35.98 KB gzip 10.00 KB, and
  `Returns-D-9fvGHO.js` at 23.23 KB gzip 7.76 KB. Docker release output
  emitted matching chunks including `api-http-core-Bxclxty4.js`,
  `app-api-BtC9oIBZ.js`, `sales-read-api-CBfvMGRA.js`,
  `user-read-api-DDf_z86s.js`, `returns-api-Dv5fJpu_.js`,
  `Sales-TpSCleO4.js`, and `Returns-Qj9xC_JH.js`.
  Local Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T03-19-53-714Z.json` passed
  Sales in 399 ms with 31 requests and 26 scripts, and Returns in 464 ms with
  30 requests and 25 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T03-20-19-101Z.json` passed
  Sales in 240 ms with 31 requests and 26 scripts, and Returns in 228 ms with
  30 requests and 25 scripts. Both traces had zero failed requests, zero
  console/page errors, `app-api-methods-present=False`, and
  `csv-utils-present=False` for both routes. Public portal Cloudflare check
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors. Post-live hygiene passed with loaded
  dataset status, zero broad QA/smoke/action-history cleanup matches, zero
  generated integrity matches, and relationship orphan checks passing for 49
  FK candidates. Storage prune removed 30,592,188 bytes of old reports,
  4,829,716 bytes of old Docker-release backup package data, and 38.19 MB of
  Docker builder cache while keeping protected data and the latest R2 backup.
  Generated-artifact cleanup then removed 415,957,346 bytes from `release`,
  `frontend/dist`, and `output`, and the follow-up Phase 29 audit passed with
  zero failures.
- Move 780 is now served by Docker release image
  `business-os:v6.0.0-202606041056`. Sales and Returns no longer statically
  import `downloadCSV`; both route components dynamically import
  `utils/csv.ts` only from export handlers. The legacy API registry now
  lazy-loads CSV template generation and browser file dialogs, and
  `frontend/vite.config.ts` pins `browserDialogs.ts` to the focused
  `browser-dialogs` chunk so CSV decoding does not fold back into
  `app-api-methods`.
  Standalone production output emits `browser-dialogs-b2rpWGfH.js` at
  0.75 KB gzip 0.47 KB, `csv-utils-rS6b7zK6.js` at 7.59 KB gzip 3.36 KB,
  `Sales-BLPOxK6G.js` at 35.77 KB gzip 9.93 KB,
  `Returns-eWBP2b2n.js` at 23.11 KB gzip 7.72 KB, and
  `app-api-methods-CBKXmBPK.js` at 43.01 KB gzip 13.69 KB. The Docker build
  emitted matching runtime chunks including `browser-dialogs-biE403Mo.js`,
  `csv-utils-BUq7xiy4.js`, `Sales-DZkPqEiA.js`, `Returns-Cl67aTYQ.js`, and
  `app-api-methods-DN0RAWza.js`.
  Local Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-59-01-255Z.json` passed
  Sales in 287 ms with 39 requests and 34 scripts, and Returns in 221 ms with
  40 requests and 35 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-59-25-149Z.json` passed
  Sales in 248 ms with 39 requests and 34 scripts, and Returns in 252 ms with
  40 requests and 35 scripts. Both traces had zero failed requests, zero
  console/page errors, and script-list inspection confirmed
  `csv-utils-present=False` for both routes.
  Public portal Cloudflare check rendered 20 products, confirmed portal
  bootstrap 200, confirmed AI status 200 after interaction, and recorded zero
  failed responses, zero relevant console messages, and zero page errors.
  Post-live hygiene passed with loaded dataset status, zero broad
  QA/smoke/action-history cleanup matches, zero generated integrity matches,
  and relationship orphan checks passing for 49 FK candidates.
- Move 779 is now served by Docker release image
  `business-os:v6.0.0-202606041026`. `Users.tsx` lazy-loads
  `UserProfileModal`, `UserDetailSheet`, and `PermissionEditor` behind
  Suspense intent boundaries. Shared helpers now live in focused chunks:
  `shared-formatters-hlKiTBw1.js` at 1.05 KB gzip 0.48 KB,
  `user-permission-definitions-D4YB3sF5.js` at 2.17 KB gzip 0.73 KB, and
  `shared-action-history-C7vkR4lr.js` at 11.26 KB gzip 3.77 KB, so those
  helpers are no longer owned by the lazy modal chunks. Standalone production
  output emits `Users-CrxxMbTW.js` at 34.74 KB gzip 8.33 KB,
  `user-profile-modal-fZZ1WHxv.js` at 39.77 KB gzip 11.29 KB,
  `user-detail-sheet-DrgkE-YZ.js` at 3.83 KB gzip 1.50 KB, and
  `user-permission-editor-BDueo37y.js` at 3.12 KB gzip 1.24 KB. Artifact
  inspection confirms the three action chunks appear only in runtime
  `import()` calls, not top-level imports. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-28-37-499Z.json` passed
  Users, Settings, Backup, and Products with zero failed requests and zero
  console/page errors; Users loaded in 223 ms with 38 requests, three API
  requests, and 32 scripts, down from the earlier stable 45 requests and 39
  scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-28-50-177Z.json` passed
  the same routes with zero failures/errors; Users loaded in 267 ms. Public
  portal Cloudflare check rendered 20 products, confirmed portal bootstrap
  200, confirmed AI status 200 after interaction, and recorded zero failed
  responses, zero relevant console messages, and zero page errors. Post-live
  hygiene passed with loaded dataset status, zero broad QA/smoke/action-history
  cleanup matches, zero generated integrity matches, and relationship orphan
  checks passing for 49 FK candidates.
- Move 778 is now served by Docker release image
  `business-os:v6.0.0-202606040958`. `Settings.tsx` no longer statically
  imports the full `mediaUpload.ts` helper or the favicon canvas helper during
  normal route load. It imports only `mediaUploadState.ts`, sets the raw
  favicon preview immediately, then delays the circular favicon canvas helper
  by 1800 ms and idle time. Successful image uploads dynamically import
  `buildCacheBustedMediaPath` only after upload response data is available.
  Vite emits `media-upload-state-BR061biI.js` at 1.28 KB gzip 0.51 KB, keeps
  `media-upload-utils-BmNZXeC2.js` and `favicon-utils-BefJ4jdU.js` out of
  eager modulepreload, and normal Settings output remains 55.00 KB gzip
  15.54 KB. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-01-26-353Z.json` passed
  Dashboard, Products, Backup, and Settings with zero failed requests and zero
  console/page errors; Settings loaded in 193 ms with 25 requests and 20
  scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-01-26-931Z.json` passed
  the same routes with zero failures/errors; Settings loaded in 205 ms. Both
  traces show no normal-route `media-upload-utils`, `favicon-utils`,
  `settings-otp-modal`, or `backup-reset-tools` request. Public portal
  Cloudflare check rendered 20 products, confirmed portal bootstrap 200,
  confirmed AI status 200 after interaction, and recorded zero failed
  responses, zero relevant console messages, and zero page errors. Post-live
  hygiene passed with loaded dataset status and zero cleanup/integrity matches.
- Move 777 is now served by Docker release image
  `business-os:v6.0.0-202606040944`. `Settings.tsx` no longer statically
  imports `OtpModal.tsx`; it imports only the modal props type and lazy-loads
  the OTP setup/disable UI through React Suspense after the 2FA button is
  pressed. Vite emits `settings-otp-modal-BTTCqa0J.js` at 6.74 KB gzip
  2.28 KB and excludes `assets/settings-otp-modal-` from eager modulepreload.
  Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-47-30-975Z.json` passed
  Dashboard, Products, Backup, and Settings with zero failed requests and zero
  console/page errors; Settings loaded in 206 ms with 27 requests, two API
  requests, and 22 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-47-31-450Z.json` passed
  the same routes with zero failures/errors; Settings loaded in 216 ms. Both
  traces show no normal-route `settings-otp-modal`, `OtpModal`, or
  `backup-reset-tools` request. Public portal Cloudflare check rendered 20
  products, confirmed portal bootstrap 200, confirmed AI status 200 after
  interaction, and recorded zero failed responses, zero relevant console
  messages, and zero page errors. Post-live hygiene passed with loaded dataset
  status and zero cleanup/integrity matches.
- Move 775 is now served by Docker release image
  `business-os:v6.0.0-202606040909`. `CatalogPage.tsx` no longer statically
  imports `portalTranslateController.ts`; it reads stored translation
  preference locally and lazy-loads the controller only for external Google
  Translate setup or translate-switch cleanup. The build now emits
  `portal-translate-controller-DInGtqE9.js` at 5.51 KB and `portal-tools` is
  down to 72.84 KB in Vite output. Real public-host traces and the public
  portal check confirm `portal-translate-controller` is absent from ordinary
  first load while `/public` still renders 20 products with zero errors.
- exhaustive desktop/mobile all-pages Playwright control audit passed on Docker
  build hash `7530b3876d0d1959` across 34 routes, with 518 visible controls
  discovered, 371 controls exercised, 147 intentionally skipped by stable
  broad-audit guardrails, 68 screenshots, zero failed controls, and zero
  findings
- public catalog route-ready timing is now measured without waiting for
  background network idle by default. The latest broad audit measured
  public_catalog at about 231 ms desktop and 201 ms mobile, down from the prior
  audit's 7.6 s desktop and 4.0 s mobile network-idle-biased route timings.
- Products and POS desktop/mobile filter burst proof passed with three rapid
  filter/search clicks per route and only one `/api/products/search` response
  per burst, zero category/branch/filter metadata responses after page-ready,
  and all HTTP 200
- public Cloudflare portal check passed with 20 rendered products, zero failed
  responses, zero relevant console messages, zero page errors, enforced CSP,
  deferred AI status before interaction, and HTTP 200 AI status after the
  Assistant tab click
- Docker release image `business-os:v6.0.0-202606031726` is serving the
  verified build from Move 740; Move 741 is served by Docker release image
  `business-os:v6.0.0-202606031752`; Move 742 is served by Docker release
  image `business-os:v6.0.0-202606031814`; Move 743 is served by Docker
  release image `business-os:v6.0.0-202606031841`; Move 744 is served by
  Docker release image `business-os:v6.0.0-202606031903`; Move 745 is served
  by Docker release image `business-os:v6.0.0-202606031923`; Move 746 is
  served by Docker release image `business-os:v6.0.0-202606031937`; Move 747
  is served by Docker release image `business-os:v6.0.0-202606031954`; Move
  753 is served by Docker release image `business-os:v6.0.0-202606040015`;
  Move 754 is served by Docker release image `business-os:v6.0.0-202606040046`;
  Move 755 is served by Docker release image `business-os:v6.0.0-202606040111`;
  Move 756 is served by Docker release image `business-os:v6.0.0-202606040128`;
  Move 757 is served by Docker release image `business-os:v6.0.0-202606040138`;
  Move 758 is served by Docker release image `business-os:v6.0.0-202606040149`;
  Move 759 is served by Docker release image `business-os:v6.0.0-202606040205`;
  Move 760 is served by Docker release image `business-os:v6.0.0-202606040219`;
  Move 761 is served by Docker release image `business-os:v6.0.0-202606040246`;
  Move 762 is served by Docker release image `business-os:v6.0.0-202606040258`;
  Move 763 is served by Docker release image `business-os:v6.0.0-202606040328`;
  Move 764 is served by Docker release image `business-os:v6.0.0-202606040354`;
  Move 765 is served by Docker release image `business-os:v6.0.0-202606040412`;
  Move 766 is served by Docker release image `business-os:v6.0.0-202606040522`;
  Move 767 is served by Docker release image `business-os:v6.0.0-202606040638`.
- post-live hygiene passed with loaded dataset status and zero generated
  integrity matches

Recent runtime/load win:

- Contacts first-load now avoids the broad API methods registry and the mixed
  contacts transport. Proof: Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-40-29-536Z.json`
  measured Contacts at 269 ms route-ready with 35 requests, 2 API requests,
  and 30 scripts, zero failed requests, and zero console/page errors. The
  17-route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-41-45-113Z.json`
  passed every route with zero failed requests and zero console/page errors.
  The fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T22-41-45-201Z/summary.json`
  exercised 183 of 254 visible stable controls across 17 routes with zero
  failed controls. Remote admin Contacts trace against
  `https://admin.leangcosmetics.dpdns.org` passed with 17 requests, 1 API
  request, 12 scripts, zero failures, and zero console/page errors. Remote
  public portal check rendered 20 products, confirmed portal bootstrap 200,
  AI status 200 after interaction, and zero failed responses. Docker release
  image `business-os:v6.0.0-202606040638` serves frontend hash
  `8680fae2ea641ed8`.

- Products create/delete now avoids the broad API methods registry. Proof:
  Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T21-25-11-474Z.json`
  measured Products at 282 ms route-ready with 37 requests, 2 API requests,
  and 29 scripts, zero failed requests, and zero console/page errors. A live
  Playwright Product button -> create -> search -> row menu delete flow loaded
  `product-write-api-CYyuCWn_.js` plus focused supplier/action-history chunks,
  while `app-api-methods` stayed unloaded before and after the write intent.
  The remote admin Products trace against
  `https://admin.leangcosmetics.dpdns.org` passed with 16 requests, 1 API
  request, 11 scripts, zero failed requests, and zero console/page errors.
  The public Cloudflare portal check also passed with 20 rendered products,
  `/api/portal/bootstrap` HTTP 200, AI status HTTP 200 after interaction, zero
  failed responses, and zero relevant console/page errors. Post-live cleanup
  removed 20 QA action-history rows and 10 QA audit-log rows. Docker release
  image `business-os:v6.0.0-202606040522` serves frontend hash
  `30cbc69ea051e0fd`.

- Receipt preview now lazy-loads PDF/image/print generators only after an
  export intent. Proof: Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T20-14-57-395Z.json`
  measured POS at 270 ms route-ready with 30 requests, 2 API requests, 22
  scripts, zero failed requests, and zero console/page errors. A headed live
  Chromium checkout reached receipt preview with zero `printReceipt-*` scripts
  loaded; clicking the actual Image button loaded `printReceipt-C-vsIQZL.js`
  and downloaded the receipt image. Post-live cleanup removed the QA sale,
  sale item, allocation, product, stock rows, batch rows, inventory movement,
  action-history entry, and audit log. Docker release image
  `business-os:v6.0.0-202606040412` serves frontend hash
  `71ea4f3183cefe58`.

- POS checkout sale writes now use a focused `sale-write-api` transport chunk
  instead of the broad API methods registry. Proof: Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T19-56-35-700Z.json`
  measured POS at 245 ms route-ready with 30 requests and 22 scripts, zero
  failed requests, and zero console/page errors. A headed live Chromium check
  used the real POS product search/card click, `Exact $`, `Done`, and
  `Completed` controls, reached the receipt preview, and confirmed the sale by
  API search. The script list loaded `sale-write-api-BDCbXrEC.js`, while
  `app-api-methods` and `csv-utils` stayed unloaded. Post-live cleanup removed
  the QA sale, sale item, allocation, product, stock rows, batch rows,
  inventory movement, action-history entry, and audit log. Docker release image
  `business-os:v6.0.0-202606040354` serves frontend hash
  `95087b02ae5f91bc`.

- POS now lazy-loads the filter panel only after the cashier opens Filters.
  Proof: Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-51-33-389Z.json`
  measured POS at 302 ms route-ready with 32 requests and 24 scripts, down
  from 33 requests and 25 scripts in the prior focused trace, with zero failed
  requests and zero console/page errors. The first-window script parse had no
  `FilterPanel` chunk, and the live Filters click loaded
  `FilterPanel-BSgPp0Gy.js`, rendered Stock Status and Groups controls, and
  recorded zero relevant console/page errors. Docker release image
  `business-os:v6.0.0-202606040149` serves frontend hash
  `2a554c3c40e34b1e`.

- POS no longer imports customer-management route code just to parse customer
  contact options. `POS.tsx` uses `parseStoredContactOptions` from the lean
  contact-option utility, and the startup guard prevents reintroducing a
  `CustomersTab` import. Proof: Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-40-43-530Z.json`
  measured POS at 281 ms route-ready with 33 requests and 25 scripts, down
  from 42 requests and 34 scripts in the prior focused trace, with zero failed
  requests and zero console/page errors. POS loaded
  `contactOptionUtils-BSXveFTP.js` and no `CustomersTab`, `Contacts`, or
  `CustomerFormModal` chunks. Docker release image
  `business-os:v6.0.0-202606040138` serves frontend hash
  `586f2e7f02c612bf`.

- Shared Khmer script typography helpers now live in a dedicated
  `script-typography` chunk instead of being owned by public catalog preview.
  Proof: Docker-served route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-31-19-384Z.json`
  measured Products 272 ms, Inventory 232 ms, POS 335 ms, and public 199 ms
  route-ready with zero failed requests and zero console/page errors. Products,
  Inventory, and POS loaded `script-typography-avi8xpqd.js` and did not load
  `catalog-preview`, `catalog-ui`, or `catalog-display`; `/public` still loaded
  those catalog chunks by design. Docker release image
  `business-os:v6.0.0-202606040128` serves frontend hash
  `604112e02c049f10`.

- Public catalog translation tools now use `LazyPortalMenu`, keeping
  `shared-portal-menu` out of the first public catalog route window until a
  visitor opens the language button. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T17-14-07-644Z.json`
  measured public_catalog at 229 ms route-ready with 28 requests and 23
  scripts, down from 29 requests and 24 scripts in the prior trace, with zero
  failed requests, zero console/page errors, and no first-window
  `shared-portal-menu` chunk. The mobile click proof
  `ops/runtime/reports/public-language-menu-live-check-2026-06-03T17-18-31-063Z/report.json`
  loaded `shared-portal-menu-D4vj-XWE.js` only after clicking Language tools,
  rendered visible language options, and recorded zero relevant console/page
  errors. Docker release image `business-os:v6.0.0-202606040111` serves the
  verified runtime.

- Inventory now memoizes the product and movement filter loops before building
  visible product sections and grouped movement history. `searchTerms`,
  `matchesSearch`, `productHay`, `movHay`, `filteredSummary`, and
  `filteredMovements` are stable across unrelated state updates, so paging,
  history controls, tab changes, and small UI toggles no longer force the same
  product/movement scans before regrouping. Proof:
  `ops/runtime/reports/initial-filter-timing-2026-06-03T17-00-58-548Z/report.json`
  clicked the Products `G288`, Inventory `G`, and public catalog `G` filters
  in the Docker-served app; all three returned HTTP 200, completed in
  491-520 ms, and recorded zero relevant console/page errors. The focused
  route-load trace
  `ops/runtime/reports/route-load-trace-2026-06-03T17-01-16-586Z.json`
  measured Products 213 ms, Inventory 202 ms, POS 292 ms, and public_catalog
  196 ms route-ready, with zero failed requests and zero console/page errors.
  Docker release image `business-os:v6.0.0-202606040046` serves the verified
  runtime.

- Shared portal positioning/menu code is now truly intent-loaded on Products,
  Contacts, and reusable filter/action surfaces. `FilterMenu`, Products manage
  menus, product row actions, and contact row actions use `LazyPortalMenu`,
  while `PortalMenu` honors delayed first-click `defaultOpen` after the chunk
  arrives. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T16-17-24-309Z.json` shows
  `shared-portal-menu=none`, `app-local-db=none`, and `vendor-dexie=none` for
  Products, Inventory, POS, Sales, Returns, and Contacts in the first 600 ms,
  with route-ready timings from 187 ms to 318 ms and zero failed requests or
  console/page errors. The live Playwright interaction proof at
  `ops/runtime/reports/lazy-portal-menu-live-check-2026-06-03T16-20-20-068Z/report.json`
  clicked Products Filters and Contacts row actions, loaded
  `shared-portal-menu-D4vj-XWE.js` only on demand, opened both menus, and
  recorded zero relevant console/page errors. Docker release image
  `business-os:v6.0.0-202606040015` serves the verified runtime.

- Healthy first-route loads no longer wake IndexedDB/Dexie. Local mirror writes,
  expected-updated-at reads, query-cache fallbacks, and transport fallbacks now
  load `localDb.ts` through lazy boundaries only when the local fallback,
  queued offline work, or explicit queue diagnostics are actually used. CSV
  template/download helpers moved to `csvTemplate.ts`, `csvImport.ts` is owned
  by `csv-utils`, and sensitive mirror purge is delayed into a later idle slot.
  Server bootstrap/debug/test calls now use a tiny `app-system` transport from
  `web-api.ts`, while the legacy API registry lazy-loads `systemRuntime.ts`
  instead of statically owning it. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T15-23-15-920Z.json` shows
  `app-local-db=none` and `vendor-dexie=none` for dashboard, products,
  inventory, POS, sales, returns, backup, contacts, server, and public_catalog
  in the first 600 ms. The same trace shows `app-system=none` for domain routes
  and `app-system` only for Server. A live Playwright Queue-tab interaction
  loaded `app-local-db`, `vendor-dexie`, and `app-api-methods` only after the
  Queue button click, rendered pending/syncing/failed queue labels, and
  recorded zero console/page errors. Broad Phase 8.4 UI and public Cloudflare
  portal checks also passed with zero relevant console/page errors. Docker release image
  `business-os:v6.0.0-202606032321` served the verified runtime.

- Non-catalog admin routes no longer fetch the heavy Catalog route chunk for
  shared icons and helpers. Reusable product primitives, action guards, small
  catalog helpers, and Catalog/admin-shared Lucide icons now live in focused
  chunks before the generic catalog rule. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T13-53-46-619Z.json` shows
  `catalog=none` for dashboard, products, inventory, POS, sales, returns,
  backup, contacts, and server. Backup dropped from 29 to 26 requests and 25
  to 22 scripts, Server dropped from 28 to 25 requests and 23 to 20 scripts,
  and Sales/Returns/Contacts each dropped two first-window scripts. Public
  catalog still loads Catalog by design, rendered 20 products through
  Cloudflare, and recorded zero failed responses or relevant console/page
  errors.

- Route startup no longer pulls the notification-center chunk just because a
  feature page shares an icon with NotificationCenter. Shared Lucide icons now
  live in `shared-icons`, and NotificationCenter only wakes from explicit
  notification-shaped events. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T13-23-37-802Z.json` shows
  `notification=none` for dashboard, products, inventory, POS, sales, returns,
  backup, contacts, server, and public_catalog. Backup dropped from 31 to 29
  requests and 27 to 25 scripts, Server dropped from 30 to 28 requests and 25
  to 23 scripts, and all traced routes recorded zero failed requests and zero
  console/page errors. Broad Phase 8.4 still verified
  `notificationPanelVisible: true`, so the panel remains available on use.

- Server page first-load now uses one authenticated system bootstrap response
  for security config and initial diagnostics. The old first-window pair
  `/api/system/config` plus `/api/system/debug/log` is replaced by
  `/api/system/bootstrap`; diagnostics refresh still polls after startup, and
  the old endpoints remain available for fallback/manual reads. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T11-57-06-358Z.json` shows
  Server at 30 total requests, 2 API requests, zero failed requests, and zero
  console/page errors, down from 31 total requests and 3 API requests in the
  pre-change trace. The first-window API list is now `/api/auth/bootstrap` and
  `/api/system/bootstrap`. The broad Phase 8.4 UI live check at
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T11-58-20-197Z/report.json`
  passed with `serverBootstrapStatus: 200`, no framework overlay, and zero
  relevant console messages.

- Public portal first-load now uses one customer-safe bootstrap response for
  config, metadata, and the first product page. The old public waterfall of
  `/api/portal/config`, `/api/portal/catalog/meta`, and
  `/api/portal/catalog/products/search` is replaced by
  `/api/portal/bootstrap`; the first search effect skips the already-
  bootstrapped page once, then normal filters/searches still use the existing
  search endpoint. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T11-40-35-980Z.json` shows
  public_catalog at 23 total requests, 1 API request, zero failed requests,
  and zero console/page errors. The public Cloudflare check at
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T11-40-45-423Z/report.json`
  rendered 20 products, confirmed `/api/portal/bootstrap` returned HTTP 200,
  confirmed no AI status before interaction, clicked Assistant, then observed
  `/api/portal/ai/status` return HTTP 200 with no relevant console/page
  errors. The broad Phase 8.4 UI live check at
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T11-42-12-482Z/report.json`
  passed with `publicPortalBootstrapStatus: 200` and zero relevant console
  messages.

- Public portal first-load is now product-first and avoids nonessential third-
  party work before the catalog is useful. The public catalog defaults to
  Products when catalog display is enabled, Google Maps is only mounted when
  About is visible, and portal AI status waits until the Assistant tab is
  clicked. Proof: `ops/runtime/reports/route-load-trace-2026-06-03T11-27-44-386Z.json`
  shows public_catalog at 25 total requests, 3 API requests, zero failed
  requests, and zero console/page errors, down from 27 total requests, 4 API
  requests, and one failed Google Maps document in the earlier trace. The
  Cloudflare check at
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T11-27-43-868Z/report.json`
  rendered 20 products, confirmed no AI status before interaction, clicked the
  Assistant tab, then observed `/api/portal/ai/status` return HTTP 200 with no
  relevant console/page errors.

- Contacts first-load now defers server action-history and admin user-option
  reads until after the first visible contact list is useful. The default
  Customers tab still loads authenticated bootstrap and the customer page
  immediately; Customers, Suppliers, and Delivery tabs now all use the same
  post-ready history gate so tab switches do not pull server history before
  the contact data settles. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T11-06-34-317Z.json` shows
  Contacts with 39 total requests, 2 API requests, zero failed requests, and
  zero console/page errors. The first-window API list is now
  `/api/auth/bootstrap` and `/api/customers?...includePoints=1`. A longer
  3200 ms trace at
  `ops/runtime/reports/route-load-trace-2026-06-03T11-06-34-357Z.json` proved
  delayed `/api/users` and `/api/action-history...` wake around 2.6 s after
  navigation, outside the route-ready window. The focused Contacts desktop/
  mobile route-control audit passed with 23 exercised controls and zero
  findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T11-06-34-415Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 369 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T11-07-36-285Z/summary.json`.

- Files, Users, and Backup first-load now defer non-critical server
  action-history reads until after the page is useful. Backup first-window API
  calls now contain only `/api/auth/bootstrap`; Files now contains
  `/api/auth/bootstrap` and `/api/files?...`; Users now contains
  `/api/auth/bootstrap`, `/api/users`, and `/api/roles`. Proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T10-45-03-014Z.json`
  shows Backup at 31 total requests and 1 API request, Files at 31 total
  requests and 2 API requests, Users at 37 total requests and 3 API requests,
  with zero failed requests and zero console/page errors. A longer 3200 ms
  trace at
  `ops/runtime/reports/route-load-trace-2026-06-03T10-43-53-491Z.json` proved
  delayed `/api/users` and `/api/action-history...` wake around 2.1-2.3 s
  after navigation, outside the route-ready window. The focused
  Backup/Files/Users/Server route-control audit passed with 50 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T10-44-22-752Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 371 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T10-50-19-615Z/summary.json`.

- Branches first-load now defers server action-history and admin user-option
  reads until after the branch list and summary are useful. The page still
  loads authenticated bootstrap, branch list, and branch summary immediately;
  local undo/redo pushes remain available, while server history wakes after
  route-ready. Proof: `ops/runtime/reports/route-load-trace-latest.json`
  shows Branches with 34 total requests, 3 API requests, zero failed requests,
  and zero console/page errors. The first-window API list is now
  `/api/auth/bootstrap`, `/api/branches`, and `/api/branches/summary`. A longer
  3200 ms trace at
  `ops/runtime/reports/route-load-trace-2026-06-03T10-18-05-277Z.json` proved
  delayed `/api/users` and `/api/action-history...` wake around 2.3 s after
  navigation, outside the route-ready window. The focused
  Branches/Products/POS/Inventory/Server route-control audit passed with 144
  exercised controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T10-18-37-102Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 377 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T10-21-23-872Z/summary.json`.

- POS first-load now defers category option reads until after the first
  product grid is useful, while still loading authenticated bootstrap,
  active branches, and the first product search immediately. Opening the POS
  filter panel wakes categories immediately, and category sync invalidates the
  delayed category loader without forcing categories back into the route-ready
  batch. Proof: `ops/runtime/reports/route-load-trace-latest.json` shows POS
  with 45 total requests, 3 API requests, zero failed requests, and zero
  console/page errors. The first-window API list is now `/api/auth/bootstrap`,
  `/api/branches`, and `/api/products/search...`. A longer 3200 ms trace at
  `ops/runtime/reports/route-load-trace-2026-06-03T09-55-22-507Z.json` proved
  delayed `/api/categories`, `/api/customers`, `/api/delivery-contacts`, and
  `/api/products/filters` wake around 2.3 s after navigation, outside the
  route-ready window. The focused Products/POS/Inventory/Server route-control
  audit passed with 123 exercised controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-55-50-606Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 377 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-58-08-520Z/summary.json`.

- Products first-load now defers category, unit, and branch auxiliary lookup
  options until after the first product list is useful. Products still loads
  authenticated bootstrap and the first product search immediately. Full
  category/unit/branch options now wake after route-ready, and they also wake
  immediately if option-dependent UI opens, such as the filter menu, product
  form, bulk import, lookup managers, or bulk edit controls. Proof:
  `ops/runtime/reports/route-load-trace-latest.json` shows Products with 40
  total requests, 2 API requests, zero failed requests, and zero console/page
  errors. The first-window API list is now only `/api/auth/bootstrap` and
  `/api/products/search...`. A longer 3000 ms trace at
  `ops/runtime/reports/route-load-trace-2026-06-03T09-32-54-993Z.json` proved
  the delayed `/api/branches`, `/api/categories`, `/api/units`,
  `/api/products/filters`, `/api/users`, and `/api/action-history...` reads
  wake after route-ready as intended. The focused Products/POS/Inventory/
  Server route-control audit passed with 123 exercised controls and zero
  findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-29-59-399Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 377 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-33-46-064Z/summary.json`.

- POS first-load now defers full `/api/products/filters` metadata until after
  the first catalog load is useful. POS still loads authenticated bootstrap,
  active branches, categories, and the first product search immediately. The
  search response continues to seed lightweight brand/supplier/initial filter
  hints, while the complete metadata refresh wakes after route-ready and resets
  on product/branch/category sync. Proof:
  `ops/runtime/reports/route-load-trace-latest.json` shows POS with 46 total
  requests, 4 API requests, zero failed requests, and zero console/page errors.
  The first-window API list is now `/api/auth/bootstrap`, `/api/branches`,
  `/api/categories`, and `/api/products/search...`. The focused POS/Products/
  Inventory/Server route-control audit passed with 123 exercised controls and
  zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-07-16-666Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 378 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-09-56-238Z/summary.json`.

- Products first-load now defers the full `/api/products/filters` metadata
  refresh until after the first product search is useful. The product search
  response still seeds lightweight brand/category/supplier/initial filter
  hints immediately, while the full filter metadata wakes after route-ready
  and resets on product/category/unit/branch/supplier/settings sync. Proof:
  `ops/runtime/reports/route-load-trace-latest.json` shows Products with 43
  total requests, 5 API requests, zero failed requests, and zero console/page
  errors. The first-window API list is now `/api/auth/bootstrap`,
  `/api/products/search...`, `/api/branches`, `/api/categories`, and
  `/api/units`. The focused Products/POS/Inventory/Server route-control audit
  passed with 124 exercised controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-42-55-113Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 380 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-45-34-334Z/summary.json`.

- POS first-load now defers customer and delivery option list reads until the
  first catalog load is useful. The route still loads authenticated bootstrap,
  branch/category metadata, the first product search, and product filters
  immediately, while `/api/customers` and `/api/delivery-contacts` wake after
  catalog readiness so cart-first use is faster without breaking quick-add
  customer, delivery, membership, discount, or checkout flows. Proof:
  `ops/runtime/reports/route-load-trace-latest.json` shows POS with 47 total
  requests, 5 API requests, zero failed requests, and zero console/page errors.
  The first-window API list is now `/api/auth/bootstrap`, `/api/branches`,
  `/api/categories`, `/api/products/search...`, and `/api/products/filters`.
  The focused POS/Inventory/Products/Server route-control audit passed with
  122 exercised controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-02-31-805Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 378 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-05-09-969Z/summary.json`.

- Inventory first-load now defers non-critical server action-history and admin
  user-option reads until after the inventory products list is useful. The
  route still loads authenticated bootstrap, branch options, and the first
  inventory product search immediately, but it no longer starts `/api/users` or
  `/api/action-history?scope=inventory...` in the first visible route window.
  Proof: `ops/runtime/reports/route-load-trace-latest.json` shows Inventory
  with 41 total requests, 3 API requests, zero failed requests, and zero
  console/page errors. The first-window API list is now `/api/auth/bootstrap`,
  `/api/branches`, and `/api/inventory/products/search...`. The focused
  Inventory/Products/POS/Server route-control audit passed with 122 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-39-02-233Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 378 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-41-43-994Z/summary.json`.

- Products first-load now defers non-critical server action-history and admin
  user-option reads until after the product list is useful. The route still
  loads authenticated bootstrap, the first products search, auxiliary options,
  and filter metadata immediately, but it no longer starts `/api/users` or
  `/api/action-history?scope=products...` in the first visible route window.
  Proof: `ops/runtime/reports/route-load-trace-latest.json` shows Products
  with 44 total requests, 6 API requests, zero failed requests, and zero
  console/page errors. The first-window API list is now `/api/auth/bootstrap`,
  `/api/products/search...`, `/api/branches`, `/api/categories`, `/api/units`,
  and `/api/products/filters`. The focused Products/Inventory/POS/Server
  route-control audit passed with 124 exercised controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-19-41-250Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 381 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-22-24-340Z/summary.json`.

- Server page first-load now defers the card-level online device count health
  probe until after route-ready. The route still loads authenticated bootstrap,
  system debug log, and system config immediately, but it no longer duplicates
  `/health` in the first visible route window. Proof:
  `ops/runtime/reports/route-load-trace-latest.json` shows Server with 31 total
  requests, 3 API requests, zero failed requests, and zero console/page errors.
  The first-window API list is now `/api/auth/bootstrap`,
  `/api/system/debug/log`, and `/api/system/config`. The focused
  Server/Products/Inventory/POS route-control audit passed with 127 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T06-58-49-350Z/summary.json`;
  the exhaustive all-pages audit passed across 34 routes with 382 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-01-14-100Z/summary.json`.

- Returns first-load now matches the Sales history deferral pattern. The
  Returns page delays non-critical server action-history and admin user-option
  reads until after the route is ready, preserving local undo/redo recording
  for real return actions while removing `/api/users` and
  `/api/action-history?scope=returns...` from the first visible route window.
  Proof: `ops/runtime/reports/route-load-trace-latest.json` shows Returns with
  35 total requests, 2 API requests, zero failed requests, and zero console/page
  errors after the change. The focused Sales/Returns route-control audit passed
  with 30 exercised controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T04-17-44-648Z/summary.json`.
  The exhaustive all-pages audit then passed across 34 routes with 381 exercised
  controls and zero findings at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T04-18-20-042Z/summary.json`.
  The all-pages harness now tests non-disruptive controls before import/export
  style controls and restores the route before final layout/screenshot checks,
  improving mobile Sales coverage without hiding modal/navigation side effects.

- Sales first-load now defers non-critical server action-history and admin
  user-option reads until after the route is ready. The new reusable
  `npm.cmd --prefix ops run phase84:route-load-trace` Playwright probe saves
  focused route request/timing reports, and the latest live trace shows Sales
  first-window API requests dropped from 4 to 2 by removing `/api/users` and
  `/api/action-history?scope=global...` from the initial Sales route window.
  Proof: `ops/runtime/reports/route-load-trace-latest.json` shows Sales with
  34 total requests, 2 API requests, zero failed requests, and zero console/page
  errors. The focused Dashboard/Inventory/Sales/Audit Log route-control audit
  passed with 107 exercised controls and zero failures at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-29-36-198Z/summary.json`;
  the full all-pages audit passed at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-32-00-189Z/summary.json`,
  and the public Cloudflare portal passed at
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T03-31-56-597Z/report.json`.

- Direct admin URLs now initialize the active page from the browser path before
  the shell mounts. `/returns`, `/pos`, `/inventory`, and other direct links no
  longer briefly mount Dashboard first or pull Dashboard chart chunks into the
  first-load window. Sales and Returns also use the narrow delayed page-entry
  warmup path, so Returns no longer warms Contacts, Users, Audit Log, Receipt
  Settings, Settings, Files, Server, and Backup immediately on entry. Proof:
  `ops/runtime/reports/top-route-load-trace-latest.json` shows Returns request
  count dropped from 68 to 37 in the 500 ms first-load trace window, with zero
  unrelated route chunks, zero failed requests, and zero console/page errors.
  The focused Inventory/POS/Returns/Server route-control audit passed with 105
  exercised controls and zero failures at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-04-37-523Z/summary.json`;
  the full all-pages audit passed at
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-06-28-636Z/summary.json`.

- Public portal first-load status checks now dedupe by AI provider key. The
  local Playwright load trace on `/public` showed root attached at 192 ms,
  first visible product/search text at 248 ms, network idle at 3.8 s, zero
  console/page errors, and one `/api/portal/ai/status` request instead of the
  previous duplicate pair. The all-pages control audit now treats route-ready
  content as the default timing target and keeps the old network-idle wait
  available behind `BOS_ALL_PAGES_WAIT_NETWORK_IDLE=1`. Proof:
  `ops/runtime/reports/public-load-trace-latest.json`,
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-41-33-682Z/summary.json`,
  and
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T02-41-03-398Z/report.json`.

- POS catalog reloads now cache categories, branches, and filter metadata
  after the first route-ready load. Normal POS search/filter/page changes fetch
  the product list only; branch/category sync forces a metadata refresh. The
  live `filter-burst-check` now fails if any category, branch, or product
  filter metadata request fires during a post-ready filter burst, and the
  Docker-served proof passed with zero metadata responses on desktop/mobile
  POS and Products. Full all-pages Playwright then passed on build
  `25a697370460f92b` with zero failed controls.

- Products and POS now coalesce rapid filter/search/page changes into one
  active product/catalog load plus one latest-state follow-up reload instead
  of issuing every intermediate request. The all-pages live audit harness was
  also tightened: it only waits for file chooser events on likely file/media
  buttons, uses shorter settle waits, and can stop cleanly on time budgets.
  Proof: `ops/runtime/reports/filter-burst-check-latest.json` passed across
  desktop/mobile Products and POS, the focused all-pages slice passed, and the
  exhaustive all-pages audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T01-39-09-836Z/summary.json`
  passed with zero failed controls.

- Public portal first load now avoids the legacy API registry and offline DB
  chunks. `frontend/src/web-api.ts` lazy-loads `portalTransport.ts` directly
  for public portal config, catalog, membership, submission, and AI calls, and
  skips public IndexedDB bootstrap mirror writes. `frontend/vite.config.ts`
  assigns `portalTransport.ts` plus `portalHttp.ts` to a focused
  `app-portal` chunk, and keeps shared catalog icons out of `auth-login`.
  Docker-served build `cbfed31b11f3c265` passed performance guards,
  typecheck, JSX/source check, frontend utility suite, production build,
  Docker live sync, local `/public`, public Cloudflare Playwright, and broad
  Phase 8.4 UI Playwright. The live public report rendered 20 products with
  zero failed responses, zero relevant console messages, zero page errors,
  enforced CSP, and no first-load `auth-login`, `app-api-methods`,
  `vendor-dexie`, `app-auth`, or `app-local-db` requests. The broad report
  exercised dashboard, branches, sales, products, returns, files/library,
  catalog/public portal, receipt settings, POS, inventory, contacts, loyalty,
  users, audit, settings, server, and backup helper loaders with all checked
  endpoints at HTTP 200 and zero relevant console messages. Public Cloudflare
  returned HTTP 530 after app restart while local `/public` stayed HTTP 200;
  restarting only
  `business-os-cloudflared-1` restored public HTTP 200, and the cloudflared
  logs showed edge/Docker DNS failures (`network is unreachable`,
  `127.0.0.11:53 connection refused`), not an app render failure.

- Public portal first load no longer fetches editor-only file picker, media
  upload, or image lightbox chunks. `CatalogPreviewSurface` now mounts the
  file picker only in admin/editor mode and mounts image lightboxes only after
  a gallery is actually open. `CatalogPage` keeps upload-state helpers local
  so public/catalog boot no longer statically imports the editor upload helper.
  `vite.config.ts` splits `public-asset-urls`, `favicon-utils`, and the
  editor-only `CatalogImageField` into explicit chunks, and
  `frontend/tests/performanceLoadingUx.test.ts` guards those chunk boundaries.
  Docker-served build `e37146866b299666` passed TypeScript, JSX/source checks,
  the frontend utility suite, production build, Cloudflare public Playwright,
  and broad Phase 8.4 UI Playwright. The public report showed 20 rendered
  products, zero failed responses, zero relevant console messages, zero page
  errors, enforced CSP, and no first-load `file-picker-modal`,
  `media-upload-utils`, or `image-lightbox` requests. The first public curl
  after app restart briefly returned Cloudflare HTTP 502 while the tunnel was
  stale; restarting only `business-os-cloudflared-1` restored public HTTP 200.

- The global background import tracker no longer loads during normal
  dashboard, sales, products, returns, library, catalog, POS, inventory,
  contacts, loyalty, users, audit, settings, server, or backup navigation.
  `frontend/src/App.tsx` now gates tracker mounting behind a 180 second idle
  delay or an explicit `import-job:activity` event, and
  `frontend/src/api/importJobsTransport.ts` emits that event only for real
  import job create/start/upload/cancel/retry/delete actions. The tracker also
  stopped owning the shared Settings `Trash2` icon, preventing Vite from using
  the tracker chunk as a shared icon carrier. Broad Docker-served Phase 8.4 UI
  proof on hash `cb6332a2ac6f7165` found zero `background-import-tracker` and
  zero `/api/import-jobs` requests during normal live checks. The focused
  Playwright probe confirmed generic product/inventory/imports `sync:update`
  events do not load the tracker, while explicit `import-job:activity` loads
  `background-import-tracker-C6QiW-VT.js` and `/api/import-jobs?limit=8` at
  HTTP 200. Public Cloudflare initially returned HTTP 530 from a stale tunnel;
  restarting `business-os-cloudflared-1` restored public HTTP 200 and the
  final public portal check passed with 20 products, zero failed responses,
  zero relevant console messages, zero page errors, and enforced CSP.

- Authenticated browser lifecycle recovery is now coordinated through one
  owner instead of three overlapping modules. `frontend/src/web-api.ts` is the
  single online/focus/visible recovery coordinator: it resumes WebSocket
  reconnects, starts health polling, pings `/health`, and runs offline
  maintenance. `frontend/src/api/http.ts` keeps only the immediate `offline`
  health-state listener, and `frontend/src/api/websocket.ts` keeps only
  auth-unauthorized suppression plus a `resumeWS()` helper that clears
  reconnect suppression before reconnecting. Real Docker-served Playwright
  proof against `http://127.0.0.1:4000/login` and `/dashboard` on build hash
  `254ace63c1c99efe` observed signed-out `/login` with no online, focus,
  visibility, `sync:reconnected`, WebSocket, or interval work. Authenticated
  Dashboard kept one `online` listener, two `focus` listeners, two
  `sync:reconnected` listeners for UI plus maintenance, three
  `visibilitychange` listeners, one WebSocket, intervals `30000`, `25000`,
  `500`, and `3000`, `/api/dashboard/startup` HTTP 200, zero relevant console
  noise, and zero failed requests. Broad Phase 8.4 UI live check, public
  Cloudflare portal check, and post-live hygiene passed after restarting the
  Cloudflare tunnel from a stale public portal HTTP 530.

- Signed-out startup no longer installs session recovery, active health,
  websocket lifecycle, or kiosk focus-recovery listeners. `frontend/src/web-api.ts`
  now exposes a one-shot `ensureSessionRecoveryListeners()` that is called
  only after a stored session exists or successful login persists a user.
  `frontend/src/api/http.ts` installs online/focus/visibility health probes
  only through `startHealthCheck()`, `frontend/src/api/websocket.ts` installs
  auth/network lifecycle listeners only through `connectWS()` with stored
  session evidence, and `frontend/src/App.tsx` gates the UI focus-recovery
  hook behind `authReady && !!user`. Real Docker-served Playwright proof
  against `http://127.0.0.1:4000/login` and `/dashboard` on build hash
  `cb858c5ce1c60aa4` observed signed-out `/login` with no recovery listeners,
  no `visibilitychange` listener, no WebSocket, no intervals, the expected
  unauthenticated bootstrap 401, and zero relevant console noise. The
  authenticated Dashboard still registered `online`, `focus`, and
  `sync:reconnected` recovery listeners, five visibility listeners from
  authenticated runtime features, one WebSocket, health/ping/websocket
  intervals `30000`, `25000`, `500`, and `3000`, `/api/dashboard/startup`
  HTTP 200, zero relevant console noise, and zero failed requests. Broad
  Phase 8.4 UI live check, public Cloudflare portal check, and post-live
  hygiene passed after restarting the Cloudflare tunnel from a stale public
  portal HTTP 530.

- Authenticated startup no longer allocates the 20 second pending-sync polling
  interval during first paint. `frontend/src/App.tsx` now keeps the existing
  event-driven pending-sync refreshes, but moves periodic polling behind
  `scheduleDeferredPendingSyncPolling()`, which starts the interval only after
  the existing 30 second startup window. Real Docker-served Playwright proof
  against `http://127.0.0.1:4000/login` and `/dashboard` on build hash
  `e473ce0cdd641ad7` observed signed-out `/login` with empty sync listener,
  interval, and timeout probes, and authenticated Dashboard with websocket
  polling intervals `500` and `3000` only: no startup `20000` pending-sync
  interval, deferred `30000` timers scheduled, `/api/dashboard/startup` HTTP
  200, zero console noise, and zero failed requests. Broad Phase 8.4 UI live
  check, public Cloudflare portal check, and post-live hygiene passed after
  restarting the Cloudflare tunnel from a stale public portal failure.

- Signed-out startup now reaches zero sync-related listener registrations and
  zero sync timers. `frontend/src/api/http.ts` no longer registers its
  `sync:update` cache invalidation listener at module load; instead it exports
  `ensureSyncUpdateCacheListener()`, which `frontend/src/AppContext.tsx`
  calls only after the recoverable-session gate passes. Real Docker-served
  Playwright proof against `http://127.0.0.1:4000/login` and `/dashboard` on
  build hash `81223d01f14bfad9` observed signed-out `/login` with
  `listeners: []`, `intervals: []`, `timeouts: []`, no relevant console noise
  after filtering the expected unauthenticated bootstrap 401, and
  authenticated Dashboard still registering `sync:update`, sync/auth
  listeners, 500 ms websocket polling, 100 ms quick check,
  `/api/dashboard/startup` HTTP 200, zero console noise, and zero failed
  requests. Broad Phase 8.4 UI live check, public Cloudflare portal check, and
  post-live hygiene passed after restarting the Cloudflare tunnel from a stale
  public portal failure.

- Signed-out startup no longer registers operational sync listeners or starts
  websocket/pending-sync polling timers before a user or stored session exists.
  `frontend/src/AppContext.tsx` skips its sync listener effect and 100 ms/500
  ms websocket checks without a recoverable session, `frontend/src/App.tsx`
  skips sync-banner listeners and the 20 second pending-sync poll while
  signed out, and `frontend/src/api/websocket.ts` gates module-level
  auth/network/focus lifecycle listeners behind stored-session evidence. Real
  Docker-served Playwright proof against `http://127.0.0.1:4000/login` and
  `/dashboard` on build hash `6eb9420d6daf9353` observed signed-out `/login`
  with only the lightweight `sync:update` cache listener, no sync intervals,
  no 100 ms websocket quick check, no relevant console noise after filtering
  the expected unauthenticated bootstrap 401, and authenticated Dashboard still
  registering sync/auth listeners, 500 ms websocket polling, 100 ms quick
  check, `/api/dashboard/startup` HTTP 200, zero console noise, and zero
  failed requests. Broad Phase 8.4 UI live check, public Cloudflare portal
  check, and post-live hygiene passed after restarting the Cloudflare tunnel
  from a stale public portal failure.

- Authenticated startup no longer imports the signed-out Login UI or auth-only
  Lucide icons. `frontend/src/App.tsx` now lazy-loads `Login` only in the
  unauthenticated branch, `frontend/vite.config.ts` emits `auth-login` as a
  deferred chunk, and auth-only icons are assigned to that chunk instead of
  `app-shell-icons` or catalog. Real Docker-served Playwright proof against
  `http://127.0.0.1:4000/dashboard` on build hash `80aceec796128140`
  observed 13 startup JavaScript files, 587,317 decoded bytes, 181,800
  transfer bytes, no forbidden startup chunks, no forbidden modulepreloads,
  no `vendor-lucide`, clean console, clean failed-request list,
  `/api/auth/bootstrap` plus `/api/dashboard/startup` at HTTP 200, exactly
  one `/api/analytics` after pressing `7 Days`, and a direct `Export` click
  that still loaded `shared-portal-menu-CoNiqTbJ.js` on demand and opened the
  menu. A separate signed-out `/login` proof loaded
  `auth-login-SHSYT-QZ.js`, did not load catalog/file-picker/media/ZXing
  extras, and filtered only the expected unauthenticated bootstrap 401. Broad
  Phase 8.4 UI live check, public Cloudflare portal check, and post-live
  hygiene passed after restarting the Cloudflare tunnel from a stale public
  portal failure.

- Startup Lucide icons now belong to one focused shell chunk instead of a
  broad `vendor-lucide` bucket or accidental route chunks. Runtime imports in
  `frontend/src` now use direct `lucide-react/dist/esm/icons/*` modules,
  `frontend/src/types/lucide-react-icons.d.ts` types those icon modules, and
  `frontend/vite.config.ts` explicitly assigns only true shell/Login/sidebar
  icons to `app-shell-icons`. This avoids waking catalog, notification,
  background import tracker, file-picker, media upload, or portal-menu chunks
  during Dashboard first paint. Production output removed `vendor-lucide`,
  emitted `app-shell-icons-Cb4aT_3T.js` at 15.53 kB, and kept later route
  chunks dynamic. Real Docker-served Playwright proof against
  `http://127.0.0.1:4000/dashboard` on build hash `ab7ff057cc20cdd9`
  observed 13 startup JavaScript files, 620,625 decoded bytes, 189,316
  transfer bytes, no forbidden route chunks, no `vendor-lucide`, clean
  console, clean failed-request list, `/api/auth/bootstrap` plus
  `/api/dashboard/startup` at HTTP 200, exactly one `/api/analytics` after
  pressing `7 Days`, and a direct `Export` click that still loaded
  `shared-portal-menu-DlZ9M2na.js` on demand and opened the menu. Broad Phase
  8.4 UI live check, public Cloudflare portal check, and post-live hygiene
  passed after restarting the Cloudflare tunnel from a transient public check
  failure.

- Dashboard export menu now loads its portal-positioning menu code only on
  user intent. `frontend/src/components/shared/ExportMenu.tsx` keeps the
  visible export button in first paint, preloads `PortalMenu` on hover/focus,
  and opens the menu after the chunk loads on a direct first click.
  `frontend/src/components/shared/PortalMenu.tsx` supports `defaultOpen`, and
  `frontend/vite.config.ts` emits `shared-portal-menu` as a deferred
  intent-loaded chunk. Production build proof reduced `app-shared` from 73.03
  kB to 69.31 kB and emitted `shared-portal-menu` as a 4.10 kB on-demand
  chunk. Real Docker-served Playwright proof against
  `http://127.0.0.1:4000/dashboard` on build hash `23fd366cede8b3c4` observed
  only `/api/auth/bootstrap` and `/api/dashboard/startup` during initial
  Dashboard load, with no `shared-portal-menu` request or modulepreload; a
  direct `Export` click then loaded `shared-portal-menu-CJonXxAs.js` at HTTP
  200 and opened the menu. Failed requests and relevant console messages
  stayed at zero. Broad Phase 8.4 UI live check, public Cloudflare portal
  check, and post-live hygiene passed after restarting the Cloudflare tunnel
  from a transient 530 edge-connectivity failure.

- Dashboard startup now keeps later-route shared controls out of the generic
  first-paint shared chunk. `frontend/vite.config.ts` assigns
  `PaginationControls`, `ActionHistoryBar`, `FilterMenu`, `SectionSwitcher`,
  `PageHeader`, and `Modal` to their own route-demand chunks before the
  fallback `app-shared` rule, and `frontend/tests/performanceLoadingUx.test.ts`
  guards that ordering. Production build proof reduced `app-shared` from the
  previous 92.97 kB chunk to 73.03 kB. Real Docker-served Playwright proof
  against `http://127.0.0.1:4000/dashboard` on build hash
  `453778909dc40f11` observed only `/api/auth/bootstrap` and
  `/api/dashboard/startup` during initial Dashboard load, then exactly one
  `/api/analytics` after pressing `7 Days`; none of the newly split shared
  control chunks or inactive `BarChart` were requested or modulepreloaded, and
  failed requests plus relevant console messages stayed at zero. Broad Phase
  8.4 UI live check, public Cloudflare portal check, and post-live hygiene
  passed after restarting the Cloudflare tunnel from a transient 530
  edge-connectivity failure.

- Dashboard first-paint chart code is now narrower. `frontend/src/components/dashboard/Dashboard.tsx`
  imports the visible line and payment donut charts directly, while the
  inactive volume/transactions `BarChart` path lazy-loads only when that chart
  branch renders. `frontend/tests/performanceLoadingUx.test.ts` now guards
  against reintroducing the eager chart barrel import. Production build proof
  split `BarChart` into a 3.33 kB lazy chunk and reduced the first-paint
  `DonutChart` chunk from the previous 10.58 kB chart bundle to 7.56 kB.
  Real Docker-served Playwright proof against `http://127.0.0.1:4000/dashboard`
  on build hash `9ee8a8bbcfeb8deb` kept startup at two app API responses,
  confirmed `BarChart` was neither requested nor modulepreloaded, confirmed
  the visible donut chart still loaded, and had zero relevant console messages.
  Broad Phase 8.4 UI live check, public Cloudflare portal check, and post-live
  hygiene passed after restarting the Cloudflare tunnel from a transient 530
  edge-connectivity failure.

- Authenticated startup now primes the shared health and runtime-version cache
  from `/api/auth/bootstrap`, so Dashboard first paint no longer pays a
  separate `/health` request when bootstrap succeeds. `backend/src/routes/auth.ts`
  includes served frontend build metadata in `system.runtime`;
  `frontend/src/api/http.ts` exposes `primeServerHealthFromRuntime()` and delays
  the first automatic health-loop probe by 2.5 seconds; `frontend/src/AppContext.tsx`
  primes reachability from bootstrap and keeps `/health` as the fallback for
  missing/failed bootstrap data. Real Docker-served authenticated Playwright
  proof against `http://127.0.0.1:4000/dashboard` on build hash
  `09107596d6229a5a` showed exactly two initial app responses:
  `/api/auth/bootstrap` and `/api/dashboard/startup`, both HTTP 200. Initial
  `/health`, `/api/dashboard`, and `/api/analytics` calls were zero; pressing
  `7 Days` produced exactly one `/api/analytics` response and no summary
  refetch. Broad Phase 8.4 UI live check, public Cloudflare portal check, and
  post-live hygiene passed after restarting the Cloudflare tunnel from a
  transient 530 edge-connectivity failure.

- Dashboard startup now combines summary and initial analytics into one
  protected backend read. `backend/src/routes/sales.ts` shares
  `buildDashboardSummary()` and `buildDashboardAnalytics()` between the old
  `/api/dashboard`, old `/api/analytics`, and new `/api/dashboard/startup`
  route, preserving existing refresh/range APIs while avoiding the initial
  client waterfall. `frontend/src/components/dashboard/Dashboard.tsx` uses the
  combined startup transport for the first empty Dashboard load, and range
  buttons now refresh only `/api/analytics` without rereading the all-time
  summary. Real Docker-served authenticated Playwright proof against
  `http://127.0.0.1:4000/dashboard` on build hash `435e572a3d2acfaf` showed
  three initial API/health responses total: `/health`,
  `/api/auth/bootstrap`, and one `/api/dashboard/startup` at HTTP 200. Initial
  `/api/dashboard` and `/api/analytics` calls were zero; pressing `7 Days`
  produced exactly one `/api/analytics` response and no summary refetch. Broad
  Phase 8.4 UI live check, public Cloudflare portal check, and post-live
  hygiene passed after restarting the Cloudflare tunnel from a transient
  1033/530 edge connectivity failure.

- Frontend startup now shares health probes instead of launching parallel
  `/health` checks during first paint. `frontend/src/api/http.ts` exports a
  shared `pingServerHealth()` with in-flight and fresh-result reuse, keeps
  Cloudflare Access handling and runtime-version checks centralized, and moves
  the active background health cadence to 30 seconds after the first shared
  probe. `frontend/src/AppContext.tsx` consumes that shared result instead of
  raw-fetching `/health` after it sets the sync URL. Real Docker-served
  authenticated Playwright proof against `http://127.0.0.1:4000/` on build
  hash `f29e8401e596bf6c` kept Dashboard startup at 12 JavaScript chunks,
  dropped `/health` from 3 probes to 1 in the first 12 seconds, kept
  `/api/auth/bootstrap`, `/api/analytics`, and `/api/dashboard` at HTTP 200,
  and still had zero unrelated route/local-DB chunks, zero failed responses,
  and zero relevant console messages. Verification: API HTTP unit tests,
  performance loading guard, frontend typecheck, source guard, production
  build, Docker live sync, authenticated Playwright startup trace, broad Phase
  8.4 live suite, public Cloudflare portal check, and post-live hygiene
  passed.

- Frontend authenticated Dashboard startup now avoids speculative page chunks,
  local IndexedDB bootstrap reads, notification/import-tracker work, and export
  helper imports during the first screen. `frontend/src/App.tsx` leaves route
  chunks cold until hover/touch/click intent and delays pending-sync,
  notification-center, and import-tracker background work until well after the
  Dashboard is interactive. `frontend/src/api/appBootstrapTransport.ts` now
  builds the local bootstrap fallback without Dexie/local mirror imports, and
  `frontend/src/web-api.ts` schedules offline maintenance instead of running it
  while the app is booting. `frontend/src/components/dashboard/Dashboard.tsx`
  uses the narrow dashboard transport directly and lazy-loads CSV/report/ZIP
  export helpers only when an export command is used. Real Docker-served
  authenticated Playwright proof against `http://127.0.0.1:4000/` on build
  hash `9b132859aa24909c` reduced the first 12 seconds from the earlier
  baseline of 34 JavaScript chunks and 5 app data/auth API calls to 12
  JavaScript chunks and 3 app data/auth API calls, plus 3 expected health
  probes. The final trace loaded only entry/vendor/language, `app-api`,
  shell/shared/bootstrap, Dashboard, DonutChart, and formatters chunks; it had
  zero product/POS/inventory/catalog/file-picker/local-DB/import-tracker/
  notification-center requests, zero failed responses, and zero relevant
  console messages. Verification: focused loading guard, API HTTP guard,
  frontend typecheck, source guard, frontend utility suite, backend utility
  suite, production build, Docker live sync, authenticated Playwright startup
  trace, broad Phase 8.4 live suite, public Cloudflare portal check,
  exhaustive all-pages control audit, and exhaustive browser-action smoke all
  passed.

- Frontend logged-out and invalid-session startup now avoids the heavy legacy
  API registry and offline database chunks during the first shell render. The
  sign-in page's verification and organization bootstrap calls use a narrow
  lazy `app-auth` chunk from `frontend/src/api/authTransport.ts`, while
  `frontend/src/web-api.ts` keeps `getAppBootstrap()` on a direct lazy
  `app-bootstrap` path. `frontend/src/AppContext.tsx` no longer treats a
  stored user as fully ready until server bootstrap validates it, and invalid
  sessions return an empty sign-in bootstrap instead of reading IndexedDB.
  Real Docker-served Playwright network proof against
  `http://127.0.0.1:4000/` on build hash `1a5804d05a4e008e` showed only
  `app-bootstrap-EfLFgo7i.js` and `app-auth-DD-QfBFn.js` among auth startup
  lazy chunks in the first 12 seconds, with zero `app-api-methods`,
  `app-local-db`, `vendor-dexie`, `vendor-zxing`, catalog, file-picker, or
  profile-modal requests, zero failed responses, and zero relevant console
  messages. The built graph check also found no bad startup preloads or static
  entry imports. Verification: focused loading guard, frontend typecheck,
  source guard, frontend utility suite, backend utility suite, production
  build, broad Phase 8.4 live suite, public Cloudflare portal check,
  post-live hygiene, exhaustive all-pages control audit, Phase 29 audit,
  generated references, and organization audit all passed.

- Frontend startup now removes Dexie/local IndexedDB from the initial static
  import graph entirely. The remaining blocker was
  `frontend/src/platform/runtime/clientRuntime.ts`, where the pure runtime
  descriptor helpers shared a static import with the rare runtime reset path.
  `resetClientRuntimeState()` now dynamically imports `resetLocalMirrorDb()`
  only while a reset is actually running, so normal app boot keeps
  `app-local-db` and `vendor-dexie` out of both modulepreload and top-level
  entry imports. The live Docker-served `http://127.0.0.1:4000/` entry is
  `assets/index-sOwFDnkY.js` at 80,434 bytes, and its startup graph contains
  only React/vendor, lucide, English language, app API, app shell, and shared
  UI chunks. No startup preload or static import remains for
  `notification-center`, `catalog-*`, `catalog-preview-*`,
  `catalog-editor-*`, `portal-tools`, `media-upload-utils`,
  `file-picker-modal`, `UserProfileModal`, `app-local-db`, or `vendor-dexie`.
  Production build hash: `1d2c42ce528647f9`; exhaustive Playwright all-pages
  control audit passed across 34 desktop/mobile routes with 392 exercised
  controls and zero failures; broad Phase 8.4 UI live check, public Cloudflare
  portal check, and post-live hygiene also passed.

- Frontend startup now keeps the user profile modal, file picker stack,
  notification center, catalog route, public portal route tools, and favicon
  canvas helpers out of the authenticated shell's initial static imports.
  `frontend/src/components/navigation/Sidebar.tsx` lazy-loads
  `UserProfileModal` only after the profile button opens, and receives the
  mobile notification UI from the app-level deferred notification gate instead
  of importing `NotificationCenter` directly. `frontend/src/App.tsx`
  dynamically imports the circular favicon helper inside the delayed idle
  favicon task, and `frontend/vite.config.ts` prevents media-upload helper
  preloads while keeping shared `PortalMenu` in the shared UI chunk instead of
  creating a separate startup portal-tools request. The live Docker-served
  `http://127.0.0.1:4000/` entry dropped from roughly 130 KB to 80,504 bytes
  and its startup HTML/entry no longer preloads or statically imports
  `notification-center`, `catalog-*`, `catalog-preview-*`,
  `catalog-editor-*`, `portal-tools`, `media-upload-utils`,
  `file-picker-modal`, or `UserProfileModal`. Dexie/local DB still appears as
  a synchronous web-api side-effect and remains the next deeper startup
  bootstrap target. Production build hash: `960afc698c5a3a4d`; exhaustive
  Playwright all-pages control audit passed across 34 desktop/mobile routes
  with 392 exercised controls and zero failures; broad Phase 8.4 UI live check,
  public Cloudflare portal check, and post-live hygiene also passed.

- Frontend startup now defers catalog and public portal route chunks from
  eager modulepreload. `frontend/vite.config.ts` excludes `catalog`,
  `catalog-preview`, `catalog-editor`, and `portal-tools` chunk prefixes from
  startup preload while keeping the route-lazy `CatalogPage` import intact, so
  the public catalog and admin catalog still load when navigated but no longer
  compete with the first shell/dashboard paint. The running Docker app was
  clean-synced with the rebuilt `frontend/dist`, and the live
  `http://127.0.0.1:4000/` HTML now preloads only the startup set: entry,
  React/vendor/lucide, English translations, API startup, shell/shared, media
  upload helpers, initials, and CSS. The production build hash is
  `035370df0dd56898`; the exhaustive Playwright all-pages control audit passed
  across 34 desktop/mobile routes with zero failed controls and zero findings;
  the broad Phase 8.4 UI live check, public Cloudflare portal check, and
  post-live hygiene gate also passed.

- Frontend startup now keeps Dexie and the local IndexedDB schema out of the
  critical browser load path. `frontend/src/web-api.ts` no longer statically
  imports `frontend/src/api/localDb.ts`; offline vault, outbox, file chunks,
  and persisted sync settings call `getOfflineDb()` only when those paths run.
  `frontend/vite.config.ts` also separates startup API files from method/local
  DB chunks and excludes `app-local-db` plus `vendor-dexie` from eager
  modulepreload. The real production output confirms `index.html` no longer
  preloads `vendor-dexie` or `app-local-db`, and the startup `app-api` chunk no
  longer references Dexie. The source guard parsed 227 frontend TypeScript
  files, the production build hash is `4ee9559e01210d68`, and the focused
  Dashboard desktop/mobile live audit passed with 36/46 controls tested, 10
  long-label controls skipped by stable broad-audit guardrails, and zero
  findings.

- Frontend route warmups now wait until the current document has finished
  loading in `frontend/src/App.tsx`. Primary route chunk warmups and
  page-entry warmups still run on settled, eligible sessions, but the new
  `scheduleWarmupAfterLoad()` gate prevents speculative dynamic imports from
  competing with the page's own network and parse work during initial load.
  Empty data warmup plans also return before allocating timers. This keeps
  useful later navigation warming while reducing first-load contention on slow
  or busy browsers. The source guard parsed 227 frontend TypeScript files, the
  production build hash is `830635f186b1e640`, and the focused Dashboard
  desktop/mobile live audit passed with 36/46 controls tested, 10 long-label
  controls skipped by stable broad-audit guardrails, and zero findings.

- Frontend API bootstrap now defers retired-token cleanup and backend-origin
  sync URL persistence in `frontend/src/web-api.ts`. The API proxy,
  `syncServerUrl`, websocket connection, health check, and scheduled offline
  maintenance still start immediately, but `localStorage` cleanup,
  `localStorage` sync URL writes, and Dexie settings writes now wait until
  page load plus a short delay and browser idle time. `setSyncServerUrl()` also
  avoids duplicate cache clears and forced offline maintenance when AppContext
  sets the same URL the bootstrap already installed. This removes storage and
  IndexedDB maintenance from the startup path without delaying connection
  readiness. The source guard parsed 227 frontend TypeScript files, the
  production build hash is `95565c2fbe120c41`, and the focused Dashboard
  desktop/mobile live audit passed with 36/46 controls tested, 10 long-label
  controls skipped by stable broad-audit guardrails, and zero findings.

- Frontend `AppProvider` now avoids writing the backend-origin sync URL to
  `localStorage` during state initialization in `frontend/src/AppContext.tsx`.
  The current origin still becomes the active `syncUrl` immediately for
  backend-served pages, and Vite dev still reads the saved sync server URL,
  but persisting the backend-origin value now waits for a short delay plus
  browser idle time with a timeout fallback. This removes a synchronous
  storage write from the first render setup while preserving settings
  persistence and user-selected sync URL behavior. The source guard parsed 227
  frontend TypeScript files, the production build hash is
  `5bb3317e6301aad9`, and the focused Dashboard desktop/mobile live audit
  passed with 36/46 controls tested, 10 long-label controls skipped by stable
  broad-audit guardrails, and zero findings.

- Frontend API bootstrap now defers initial offline maintenance in
  `frontend/src/web-api.ts`. The sync server URL, websocket connection, and
  health checks still start immediately so auth/bootstrap remains responsive,
  but the first `retryPendingSyncNow`, offline snapshot refresh, background
  sync registration, and service-worker update pass now wait until page load
  plus a short delay and browser idle time. This keeps offline recovery active
  without lazy-loading the larger domain methods module or scanning offline
  queues during first paint. The source guard parsed 227 frontend TypeScript
  files, the production build hash is `7166cf124209d1aa`, and the focused
  Dashboard desktop/mobile live audit passed with 36/46 controls tested, 10
  long-label controls skipped by stable broad-audit guardrails, and zero
  findings.

- Frontend startup now lets React render before scheduling non-critical
  maintenance in `frontend/src/index.tsx`. Offline service-worker
  registration still happens, but only after page load plus browser idle time,
  with a timeout fallback for busy browsers. The form-field accessibility scan
  now uses the same after-load idle scheduler instead of being queued before
  root render. This keeps offline support and generated field-label hygiene
  intact while reducing work competing with first paint. The source guard
  parsed 227 frontend TypeScript files, the production build hash is
  `f41fed1ff54d30f9`, and the focused Dashboard desktop/mobile live audit
  passed with 36/46 controls tested, 10 long-label controls skipped by stable
  broad-audit guardrails, and zero findings.

- Frontend startup now defers retry-marker storage cleanup in
  `frontend/src/App.tsx`. URL recovery parameters are still removed
  immediately, but old `business_os_page_loader_retry:` and `bos-lazy-reload:`
  markers are no longer enumerated from `sessionStorage` during the first app
  boot. The cleanup waits for a short delay and then browser idle time, with a
  timeout fallback so stale markers still get removed. This avoids a
  synchronous storage scan on the visible render path while preserving loader
  recovery hygiene. The source guard parsed 227 frontend TypeScript files, the
  production build hash is `f75e2c8d3320d0ec`, and the focused Dashboard
  desktop/mobile live audit passed with 36/46 controls tested, 10 long-label
  controls skipped by stable broad-audit guardrails, and zero findings.

- Frontend startup now defers custom favicon canvas processing in
  `frontend/src/App.tsx`. When a custom logo/favicon is configured, the shell
  still sets the plain favicon immediately, but the image decode, canvas draw,
  and PNG data-URL generation now wait until after a short delay and browser
  idle time. This keeps a non-critical tab-icon polish task out of the first
  visible render path while preserving the rounded favicon once the app is
  settled. The source guard parsed 227 frontend TypeScript files, the
  production build hash is `2e6cd6a7af03e203`, and the focused Dashboard
  desktop/mobile live audit passed with 36/46 controls tested, 10 long-label
  controls skipped by stable broad-audit guardrails, and zero findings.

- Frontend startup now defers the desktop notification center through
  `useDeferredNotificationCenterMount()` in `frontend/src/App.tsx`. Normal
  shell boot no longer immediately requests the 17.98 kB `notification-center`
  chunk or starts the notification summary read. The bell remains visible and
  clickable, and notification loading still wakes automatically after idle time
  or immediately on relevant sync updates for inventory, sales, returns,
  customers, contacts, catalog, settings, and backup. The source guard parsed
  227 frontend TypeScript files, the production build hash is
  `5ad9eba769d0526d`, and the focused Dashboard desktop/mobile live audit
  passed with 36/46 controls tested, 10 long-label controls skipped by stable
  broad-audit guardrails, and zero findings.

- Frontend startup now gates two global lazy chunks that were being requested
  during normal shell boot. `frontend/src/App.tsx` mounts
  `WriteConflictModal` only when a write conflict exists, and mounts
  `BackgroundImportTracker` only after idle time or immediately when an
  import-job sync update appears. That removes the normal-startup request and
  parse cost for the 7.54 kB write-conflict chunk and the 15.82 kB background
  import tracker chunk, and avoids the import tracker `listImportJobs` poll on
  first render. The source guard parsed 227 frontend TypeScript files, the
  production build hash is `b3f0c3283db09f7f`, and the focused Dashboard
  desktop/mobile live audit passed with 36/46 controls tested, 10 long-label
  controls skipped by stable broad-audit guardrails, and zero findings.

- Frontend startup now defers the global pending-sync banner's first
  `getPendingSyncState()` read through a cancellable idle scheduler in
  `frontend/src/App.tsx`. This keeps the first shell render from immediately
  importing the lazy `app-api-methods` chunk and scanning IndexedDB for queued
  writes, while still refreshing immediately on sync errors, write-blocked
  signals, reconnect/status changes, queue changes, offline sale queued/synced
  events, and write conflicts. The source guard parsed 227 frontend TypeScript
  files, the production build hash is `ec095d6fa2045c5a`, and the focused
  Dashboard desktop/mobile live audit passed with 36/46 controls tested, 10
  long-label controls skipped by stable broad-audit guardrails, and zero
  findings.

Recent route-level win:

- Frontend sales transport is now `frontend/src/api/salesTransport.ts` with
  typed sale creation, queued-offline retry POST transport, and sales list
  reads. Sale route keys, write-dedupe bypass for queued retries, mirrored
  sales fallback, and paged query construction now live outside the large API
  registry. The source guard now parses 227 frontend TypeScript files, the
  production build reports the `app-api-methods` chunk around 26.59 kB, and
  focused Sales and POS desktop/mobile live audits passed with zero findings.

- Frontend dashboard transport is now
  `frontend/src/api/dashboardTransport.ts` with typed dashboard summary and
  analytics reads. Analytics query construction, range-aware route cache keys,
  and shared append-query behavior now live outside the large API registry.
  The source guard now parses 226 frontend TypeScript files, the production
  build reports the `app-api-methods` chunk around 26.86 kB, and the focused
  Dashboard desktop/mobile live audit passed with 36/46 controls tested, 10
  long-label controls skipped by stable broad-audit guardrails, and zero
  findings.

- Frontend audit log transport is now
  `frontend/src/api/auditLogTransport.ts` with typed paged audit-log reads and
  retention cleanup transport. Audit row mirroring, local paged fallback shape,
  shared query building, and encoded retention query parameters now live
  outside the large API registry. The source guard now parses 225 frontend
  TypeScript files, the production build reports the `app-api-methods` chunk
  around 26.97 kB, and the focused Audit Log desktop/mobile live audit passed
  with 28/29 controls tested, 1 empty-label control skipped, and zero findings.

- Frontend custom tables transport is now
  `frontend/src/api/customTablesTransport.ts` with typed custom table
  list/create and custom row read/create/update/delete transport. Encoded table
  and row path segments plus the Dexie custom-table fallback now live outside
  the large API registry. The source guard now parses 224 frontend TypeScript
  files, the production build reports the `app-api-methods` chunk around
  27.57 kB, and the focused Settings desktop/mobile live audit passed with
  12/34 controls tested, 22 controls skipped by stable broad-audit guardrails,
  and zero findings.

- Frontend app bootstrap transport is now
  `frontend/src/api/appBootstrapTransport.ts` with typed local, invalid-session,
  and transient-offline bootstrap fallback behavior. Stored-user recovery,
  local settings bootstrap, sensitive live-server mirror purge, stored-session
  detection, and unauthorized/offline response shaping now live outside the
  large API registry. The source guard now parses 223 frontend TypeScript
  files, the production build reports the `app-api-methods` chunk around
  27.90 kB, and the focused Dashboard desktop/mobile live audit passed with
  36/46 controls tested, 10 long-label controls skipped by stable broad-audit
  guardrails, and zero findings.

- Frontend access-control transport was extracted as a typed user, profile,
  auth-method, password, role, and permission-management transport. Actor
  attribution, mirrored user/role fallbacks, encoded row ids, provider
  disconnect paths, and expected-updated-at security mutations now live
  outside the large API registry. The source guard now parses 222 frontend
  TypeScript files, the production build reports the `app-api-methods` chunk
  around 28.58 kB, and the focused Users desktop/mobile live audit passed with
  14/16 controls tested, 2 controls skipped by low-value control guardrails,
  and zero findings.

- Frontend contacts transport is now `frontend/src/api/contactsTransport.ts`
  with typed customer, supplier, and delivery-contact reads/writes, bulk
  imports, loyalty point summaries, and contact CSV templates. Mirrored
  unpaged reads, cached paged customer reads, device-attributed creates,
  expected-updated-at mutations, encoded row ids, and import-template
  ownership now live outside the large API registry. The source guard now
  parses 221 frontend TypeScript files, the production build reports the
  `app-api-methods` chunk around 29.42 kB, and the focused Contacts
  desktop/mobile live audit passed with 24/26 controls tested, 2 controls
  skipped by visibility/label guardrails, and zero findings.

- Frontend file transport is now `frontend/src/api/fileTransport.ts` with
  typed Library file list/delete, generic asset upload, product image upload,
  and user avatar upload transport. File list metadata normalization,
  XMLHttpRequest upload progress, data-url image conversion, actor
  attribution, and live-server upload gating now live outside the large API
  registry. The source guard now parses 220 frontend TypeScript files, the
  production build reports the `app-api-methods` chunk around 32.01 kB, and
  the focused Library desktop/mobile live audit passed with 16/18 controls
  tested, 2 hidden controls skipped, and zero findings.

- Frontend import job transport is now `frontend/src/api/importJobsTransport.ts`
  with typed import job create/list/status/review/action transport, canonical
  delete fallback, error CSV downloads, and CSV/ZIP/image upload helpers.
  Last-list fallback caching, device metadata form fields, batched image
  upload progress, and import remove-route compatibility now live outside the
  large API registry. The source guard now parses 219 frontend TypeScript
  files, the production build reports the `app-api-methods` chunk around
  36.41 kB, and the focused Products desktop/mobile live audit passed with
  42/42 controls tested and zero findings.

- Frontend product write transport is now
  `frontend/src/api/productWriteTransport.ts` with typed product create,
  update, delete, variant create, and bulk import write transport. Supplier
  auto-create checks, client request ids, device metadata, expected-updated-at
  product mutation guards, and product write route keys now live outside the
  large API registry. The source guard now parses 218 frontend TypeScript
  files, the production build reports the `app-api-methods` chunk around
  40.23 kB, and the focused Products desktop/mobile live audit passed with
  42/42 controls tested and zero findings.

- Frontend product read/lookup transport is now
  `frontend/src/api/productReadTransport.ts` with typed product list/search,
  id lookup, filter metadata, lookup usage, and lookup replacement transport.
  Product query-cache keys, id normalization, mirrored product reads, and
  live-server lookup replacement gating now live outside the large API
  registry. Lookup replacement now gates before actually performing the write.
  The source guard now parses 217 frontend TypeScript files, the production
  build reports the `app-api-methods` chunk around 41.09 kB, and the focused
  Products desktop/mobile live audit passed with 42/42 controls tested and
  zero findings.

- Frontend branch transport is now `frontend/src/api/branchTransport.ts` with
  typed branch list/summary/stock reads, create/update/delete writes, transfer
  reads/writes, and branch stock-integrity transport. Branch id path segments,
  device-attributed writes, mirrored branch reads, and expected-updated-at
  branch mutations now live outside the large API registry. The source guard
  now parses 216 frontend TypeScript files, the production build reports the
  `app-api-methods` chunk around 41.91 kB, and the focused Branch
  desktop/mobile live audit passed with zero findings.

- Frontend category/unit lookup transport is now
  `frontend/src/api/lookupTransport.ts` with typed mirrored lookup reads,
  expected-updated-at guarded create/update/delete transport, and explicit
  category versus unit write methods. UI refresh side effects stay in the
  public `methods.ts` wrappers, keeping the transport boundary pure and
  avoiding circular chunk warnings. The source guard now parses 215 frontend
  TypeScript files, the production build reports the `app-api-methods` chunk
  around 42.83 kB and the main `app-api` chunk around 60.66 kB, and the
  focused Products desktop/mobile live audit passed with 42/42 controls tested
  and zero findings.

- Frontend RFID inventory transport is now `frontend/src/api/rfidTransport.ts`
  with typed gateway status, tag search/create, session event, review, and
  apply transport. RFID id encoding and device-attributed RFID write payloads
  now live outside the large API registry. The source guard now parses 214
  frontend TypeScript files, the production build reports the `app-api-methods`
  chunk around 43.40 kB, and the focused Inventory desktop/mobile live audit
  passed with zero findings.

- Frontend inventory core transport is now
  `frontend/src/api/inventoryTransport.ts` with typed stock actions,
  summary/stats, product search, movement history, and reason read/write
  transport. The shared mirrored-read helper now lives in
  `frontend/src/api/localMirrors.ts`, so inventory product search keeps the
  same cache-backed fallback without duplicating registry logic. The source
  guard now parses 213 frontend TypeScript files, the production build reports
  the `app-api-methods` chunk around 44.19 kB, and the focused Inventory
  desktop/mobile live audit passed with zero findings.

- Frontend action history transport is now
  `frontend/src/api/actionHistoryTransport.ts` with typed read/create/update,
  undo, and redo transport plus shared device attribution payload shaping. The
  large API registry keeps only public `window.api` compatibility wrappers for
  history actions. The source guard now parses 212 frontend TypeScript files,
  the production build reports the `app-api-methods` chunk around 45.34 kB,
  and the focused Audit Log desktop/mobile live audit passed with zero
  findings.

- Frontend customer portal transport is now
  `frontend/src/api/portalTransport.ts` with typed catalog/config reads,
  submission writes, AI chat/status calls, membership lookup, review actions,
  timeout headers, and API-version mismatch handling outside the large API
  registry. The source guard now parses 211 frontend TypeScript files, and the
  production build reports the `app-api-methods` chunk around 45.75 kB. The
  focused public catalog live audit passed on desktop and mobile with 42/42
  controls tested and zero findings.

- Frontend AI provider transport is now `frontend/src/api/aiTransport.ts` with
  typed provider CRUD/test calls and AI response reads using the shared actor
  query helper. The large API registry keeps only public `window.api`
  compatibility wrappers for those AI actions, and the source guard now parses
  210 frontend TypeScript files.

- Frontend auth and organization transport is now
  `frontend/src/api/authTransport.ts` with typed login/logout, password reset,
  OTP/2FA, session-duration, owned Google OAuth, and organization lookup
  transport. The large API registry keeps only public `window.api`
  compatibility wrappers, and the source guard now parses 209 frontend
  TypeScript files.

- Frontend system runtime transport is now `frontend/src/api/systemRuntime.ts`
  with typed system config/debug reads, integration doctor, reset/factory-reset,
  sync-server health test, open-path/folder, data-path, browse-dir, and
  scale-migration transport. Runtime cache invalidation remains in the large
  registry wrapper chunk to avoid adding a new app-shared chunk edge.

- Frontend notification summary transport is now
  `frontend/src/api/notificationSummary.ts` with typed transient fallback,
  cooldown handling, and shared in-flight request state. The large API registry
  keeps only the public wrapper for `getNotificationSummary`.

- Frontend Drive sync transport is now `frontend/src/api/driveSync.ts` with
  typed status cooldown fallback, preferences, OAuth start, disconnect, credential
  forgetting, and queued sync job transport. The large API registry keeps only
  public `window.api` compatibility wrappers for those actions.

- Loyalty Points page is now `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`
  with typed settings form state, API lookup boundaries, point rows, lookup
  totals, section ids, and save/lookup loading guards.
- Sync Server page is now `frontend/src/components/server/ServerPage.tsx` with
  typed diagnostics tabs, pending sync queue state, call logs, system debug
  payloads, security config, connection tests, and queue action guards.
- Returns page is now `frontend/src/components/returns/Returns.tsx` with typed
  return rows, snapshot/history restore payloads, grouped selection, local
  return API gateway calls, filter/group/sort state, and watchdog timers.
- Customers contact tab is now `frontend/src/components/contacts/CustomersTab.tsx`
  with typed customer rows, grouped sections, point-balance loading, contact
  option helper exports, local customer API calls, and history/bulk restore
  payloads.
- Sales page is now `frontend/src/components/sales/Sales.tsx` with typed sale
  rows, line items, user filters, grouped sections, local sales API calls,
  status/membership mutations, selection ids, and export/history payloads.
- Delivery contact tab is now `frontend/src/components/contacts/DeliveryTab.tsx`
  with typed delivery rows, grouped sections, contact-option form payloads,
  local delivery API calls, watchdog timers, same-tick mutation guards, and
  history/bulk restore payloads.
- Suppliers contact tab is now `frontend/src/components/contacts/SuppliersTab.tsx`
  with typed supplier rows, grouped sections, contact-option form payloads,
  local supplier API calls, watchdog timers, same-tick mutation guards, and
  history/bulk restore payloads.
- Branches page is now `frontend/src/components/branches/Branches.tsx` with
  typed branch rows, summaries, stock page payloads, transfer history rows,
  local branch API calls, tab/modal state, same-tick mutation guards, and
  bulk restore payloads.
- Library page is now `frontend/src/components/files/FilesPage.tsx` with
  typed file assets, provider metadata/forms, saved AI responses, selected
  asset ids, local files API calls, upload/delete guards, provider mutation
  guards, and sanitized stale mojibake fallback copy.
- Login page is now `frontend/src/components/auth/Login.tsx` with typed auth
  users, login results, OAuth callback payloads, organization matches,
  verification capability payloads, password reset responses, auth API calls,
  DOM refs, form submit events, and error extraction.
- Catalog secondary tabs are now
  `frontend/src/components/catalog/CatalogSecondaryTabs.tsx` with typed portal
  copy functions, preview config, membership data, share submissions, about
  blocks, FAQ items, assistant profile, assistant references, assistant
  recommendations, and portal tab boundaries.
- POS page is now `frontend/src/components/pos/POS.tsx` with typed product,
  order, cart, contact, membership, receipt, lightbox, app/sync, and POS API
  gateway boundaries. Subsequent moves finished the active frontend source
  migration; `frontend/src` is now guarded as TypeScript/TSX-only source.
- Users administration is now `frontend/src/components/users/Users.tsx` with
  typed user rows, role rows, form state, API gateway calls, modal/tab state,
  loading watchdog timers, permission maps, mutation results, and undo/redo
  payload construction.
- User profile modal is now
  `frontend/src/components/users/UserProfileModal.tsx` with typed profile
  rows, verification capability payloads, sign-in method state, avatar editor
  props, file-input events, OTP mode, local profile API calls, and stored
  organization fallback parsing.
- Audit Log is now `frontend/src/components/utils-settings/AuditLog.tsx` with
  typed audit rows, paged response payloads, user filter options, selection
  ids, grouped sections, export items, local audit API calls, loader refs, and
  retention cleanup guards.
- Backup is now `frontend/src/components/utils-settings/Backup.tsx` with typed
  backup jobs, job metrics/results, integration doctor payloads, Google Drive
  sync status/forms, section ids, action locks, job watcher handlers, local
  backup API calls, and cancellable queued backup/Drive job flows.
- Settings is now `frontend/src/components/utils-settings/Settings.tsx` with
  typed settings records, app context access, local settings API calls, OTP
  status reads, image upload payloads/progress, conflict state, navigation
  items, section ids, color swatches, payment methods, and favicon
  sanitization.
- Dashboard is now `frontend/src/components/dashboard/Dashboard.tsx` with typed
  summary/analytics payloads, period/payment/branch/hour rows, stock alerts,
  detail rows, app/sync context access, range/granularity state, chart/top mode
  unions, KPI detail payloads, export dependency loading, and local dashboard
  API calls.
- App shell is now `frontend/src/App.tsx` with typed page ids, lazy route
  importers, AppContext access, notification payloads, sync/offline event
  details, pending-sync state, route warmup loaders, page error boundaries,
  scroll controls, and chunk recovery helpers.
- App context is now `frontend/src/AppContext.tsx` with typed settings,
  user/session/bootstrap payloads, notification and write-conflict state,
  sync-channel event details, storage/translation helpers, app/sync context
  values, and a typed runtime API gateway for auth/settings/OAuth/session
  refresh/sync URL calls.
- browser API bootstrap is now `frontend/src/web-api.ts` with typed lazy method
  dispatch, typed offline vault rows, typed service-worker message handlers,
  typed timers, and an explicit background-sync registration boundary
- Catalog editor surface is now
  `frontend/src/components/catalog/CatalogEditorSurface.tsx` with typed editor
  context, draft settings, promo/about/FAQ/review rows, upload state,
  recommended-product options, preview config, drag/drop helpers, and review
  submission statuses.
- core frontend transport modules are now TypeScript:
  `frontend/src/api/http.ts`, `frontend/src/api/websocket.ts`,
  `frontend/src/api/localDb.ts`, and `frontend/src/web-api.ts`

## Current Working Rules

- Keep UI shape stable unless evidence forces a visible change.
- Prefer hidden-work reduction, derived-data tightening, and helper reuse.
- Use route-scoped audits before whole-app reruns.
- Reject any route-local win that wakes unrelated warm whole-app findings.
- Keep generated/browser/server `.js` wrappers stable only where the runtime
  inventory explicitly allows them; active frontend source must stay
  TypeScript/TSX-only.
- TypeScript conversions must add real safety, not only rename files: type
  public boundaries, payloads, timers, event details, dynamic imports, and
  browser/runtime gateways.

## Recently Accepted Wins

- Notification summary now reuses a short-lived server-side cache keyed by
  effective section access and summary preferences, which removed the shared
  inventory-side summary hotspot from the warm baseline.
- Inventory no longer builds product-tab filter sections off movement-only state,
  and admin user options now wait for the Movements tab.
- Public catalog keeps chunk preloading but no longer pre-mounts hidden
  secondary tab panels after priming.
- Products no longer schedules an orphaned desktop reveal state update after load.
- Returns filter sections now build only when the menu opens.
- Import tracker settled job lists now reuse a short-lived cache.
- Inventory filter selectors now open behind summary rows.
- POS global filter metadata now waits until Filters opens.
- Dashboard export helpers now load on demand.
- Backup version list and route hot paths were hardened in earlier passes.
- POS product catalog startup now uses a dedicated `product-read-api` chunk.
  The Docker-served POS route trace for Move 759 was ready in 244 ms with 30
  requests and 22 scripts, and the first-window script list had no
  `app-api-methods` or `csv-utils`.
- POS filter-open category options now also stay inside the narrowed
  `product-read-api`/lookup transport path. The Docker-served Move 760 trace
  was ready in 262 ms with 30 requests and 22 scripts, and a live POS
  search-plus-Filters click added only the icon chunk and `FilterPanel`, with
  no `app-api-methods` or `csv-utils` loaded before or after the click.
- POS delayed customer and delivery-contact option reads now use a separate
  1.31 kB `contact-read-api` chunk instead of the broad API methods registry.
  The Docker-served Move 761 trace was ready in 353 ms with 30 requests and
  22 scripts. A live Chromium delayed-contact probe confirmed the first
  600 ms POS window had no `contact-read-api`, `app-api-methods`, `csv-utils`,
  `app-local-db`, or `vendor-dexie`; after the delayed gate, only
  `contact-read-api-3bBCBgdj.js` loaded, with zero failed requests and zero
  relevant console/page errors.
- POS membership lookup now uses the focused `app-portal` transport chunk
  directly instead of the broad API methods registry. The Docker-served
  Move 762 trace was ready in 268 ms with 30 requests and 22 scripts. A live
  Chromium customer-selection probe loaded only `app-portal-Bi-RHhNA.js` after
  selecting existing membership customer `Customer 1`, while `app-api-methods`,
  `csv-utils`, `app-local-db`, and `vendor-dexie` stayed unloaded.
- POS checkout sale writes now use the focused `sale-write-api` transport chunk
  directly instead of the broad API methods registry. The Docker-served
  Move 764 trace was ready in 245 ms with 30 requests and 22 scripts. A headed
  Chromium checkout probe used real POS product search/card click, `Exact $`,
  `Done`, and `Completed` controls, reached receipt preview, and loaded
  `sale-write-api-BDCbXrEC.js` while `app-api-methods` and `csv-utils` stayed
  unloaded.
- API HTTP, local Dexie, websocket, and browser API bootstrap were converted to
  TypeScript and verified through frontend utility tests, the TypeScript source
  guard, production build, Phase 29 audit, schema audit, organization audit,
  and runtime dependency guardrails.
- The large frontend API domain registry is being split into typed helper
  modules. Query-string/id normalization, request-id idempotency, conflict
  preview shaping, pending-sync preview serialization, actor/user query
  attribution, public portal base URL resolution, abortable portal fetches,
  multipart import transport, notification/Drive cooldown fallbacks,
  read-query cache helpers, optimistic updated-at payload helpers, and local
  read-mirror helpers now live outside `frontend/src/api/methods.ts` with
  direct focused coverage. Shared sync event, queue-change, stored-session,
  and service-worker outbox registration helpers now live in
  `frontend/src/api/syncRuntime.ts` and are shared by both the API registry and
  browser bootstrap. Browser CSV picker and image/data-url compatibility
  fallbacks now live in `frontend/src/api/browserDialogs.ts`, keeping DOM file
  inputs and CSV decoding out of the remaining domain registry. System job
  polling, cancellation, and backup folder queue helpers now live in
  `frontend/src/api/systemJobs.ts`, keeping long-running Backup transport
  mechanics out of the remaining domain registry. Public portal fallback
  methods inside the legacy registry now lazy-load `portalTransport.ts`
  through a memoized dynamic boundary, so `app-api-methods` no longer carries
  portal endpoint strings by default.
- The public portal About hero is now mobile-friendlier: phone, address, and
  social media links share one compact action tray on phones, long addresses
  clamp instead of stretching the hero, and social links collapse to accessible
  icon buttons until the `sm` breakpoint.
- Public catalog first load now keeps About/contact/social/map code out of the
  first Products viewport. Move 770 split `CatalogPreviewSurface`,
  `CatalogProductsSection`, and `CatalogSecondaryTabs` into intent-sized
  chunks, stopped idle warming for hidden secondary tabs, and verified the real
  public link without first-loading `catalog-secondary-tabs`.
- Inventory no longer wakes the broad `window.api`/`app-api-methods` registry
  for first-load reads, stats, movement reads, branch/product/user/returns/RFID
  reads, or stock mutations. The Docker-served Move 768 local Inventory trace
  dropped from the prior 47 requests/40 scripts to 39 requests/32 scripts, with
  zero failed requests and zero console/page errors.

## Recently Rejected Candidates

- Notification-center summary deferral:
  looked like a reasonable shared-background delay, but real route timing on
  Products regressed and did not hold the gate
- Returns cached display-field reuse:
  reduced repeated formatting locally, but warm route reruns got slower instead
- products loadPromise bookkeeping removal:
  the code was dead-looking, but the real route metrics got worse after proper
  worktree-targeted runtime verification
- hard-capped backup version fallback path:
  targeted API improved, but warm exhaustive reruns woke unrelated route noise
- mobile public-catalog hidden-panel unmounting:
  route-scoped win, but warm whole-app reruns drifted
- broad returns section repagination:
  looked tidy locally, but whole-app timing shape worsened

## Next Best Moves

1. Continue splitting `frontend/src/api/methods.ts` into typed sections,
   starting with bounded domain clusters that still have static imports in
   the registry. Next candidates: settings/system transport, customer/contact
   helpers, and write-conflict/offline mirror paths. Remove the temporary
   `ts-nocheck` marker only after request payloads, retries, cache
   invalidation, import jobs, and offline mirrors are covered by explicit
   types.
2. Keep backend TypeScript packaging and generated runtime wrappers guarded by
   the runtime JavaScript inventory, Docker release guardrail, and backend
   package staging checks before deleting any generated startup file.
3. Update source-inspection tests and ops verification scripts whenever a real
   implementation moves behind a compatibility wrapper.
4. Refresh Phase 29 references after each migration and keep the public
   Cloudflare portal failure separate until the tunnel/runtime path is fixed.
5. Continue mobile public portal polish from the screenshots: next candidates
   are the large hero logo/avatar sizing and first-card spacing if the public
   owner wants an even shorter first viewport.
6. Continue measured POS splits after Move 765: product-management writes,
   settings/system transports, and any remaining checkout-adjacent paths can
   still wake broad registry or generator code on real intent. Keep each slice
   guarded by route traces plus interaction proof so read-only POS browsing
   remains light while live/offline write behavior stays intact.
7. Current position after Move 785: Phase 8.4 active; Phase 26 at 51 completed
   organization moves; Phase 28 active with R2 prune follow-up; Phase 29 active
   for whole-codebase schema/cleanup/TypeScript/runtime/performance sweeps.

## Recent Move 785

- Products and Inventory no longer load the ProductDetailModal chunk during
  first-window route startup. `frontend/vite.config.ts` keeps visible row
  primitives in `product-shared`, including `productBatches.ts` and
  `color.ts`, while the two ProductDetailModal files remain in the lazy
  `product-detail` chunk.
- Guardrails: `frontend/tests/performanceLoadingUx.test.ts` now asserts that
  product image, color, and visible batch helpers are owned by
  `product-shared`, and that `productBatches.ts` and `color.ts` cannot force
  `product-detail` into startup.
- Build/source proof: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`, and
  `npm.cmd --prefix frontend run build` passed. Generated chunk inspection
  confirmed Products has no static `from "./product-detail"` import, only the
  intended lazy `import("./product-detail...")`.
- Docker/live proof: Docker image `business-os:v6.0.0-202606042050` is
  running with source hash `5d419c030bf25d50` and frontend hash
  `28fb39f953a5425c`. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T12-52-46-933Z.json`
  passed Products in 202 ms with 35 requests/27 scripts and Inventory in
  194 ms with 38 requests/31 scripts, both with zero failures/errors and
  `productDetailRequested=false`.
- Interaction proof: an authenticated Playwright probe clicked a real Products
  row and observed `beforeDetailClick=false` and `afterDetailClick=true` for
  the `product-detail` chunk, with zero failed responses, zero request
  failures, zero page errors, and zero relevant console messages.
- Public link proof: Cloudflare portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T12-52-46-457Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200 and AI status 200
  after interaction, enforced CSP was present, and recorded zero failed
  responses, zero relevant console messages, and zero page errors.
- Hygiene/cleanup proof: post-live hygiene, schema audit, organization audit,
  generated reference refresh, Phase 29 audit, and storage prune passed.
  Generated-artifact cleanup removed 412,450,532 bytes from regenerable
  `release` and `frontend/dist`; prune removed 594,838 bytes of old reports
  and 38.2 MB of Docker builder cache while preserving uploads, secrets, env
  files, backup roots, images, volumes, and newest R2 backup
  `datasync-2026-06-04T09-26-59-912Z`.

## Recent Move 803

- `frontend/src/AppContext.tsx` now defers the full English language pack.
  The app keeps a tiny `CORE_ENGLISH_PACK` for first-paint labels, then loads
  `frontend/src/lang/en.json` dynamically after page load/idle. Khmer and other
  non-core language selections still load immediately.
- Guardrails and source tests passed:
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build`.
- Docker/live proof: release image `business-os:v6.0.0-202606061728` built,
  updated, and started healthy after backup
  `ops/runtime/docker-release/backups/20260606-173024`. Route traces against
  the live Docker app passed with no failures/errors and no first-window
  `lang-en-*` requests: public catalog 271 ms with 21 requests/16 scripts,
  Dashboard 271 ms with 24 requests/18 scripts, Inventory 362 ms with
  36 requests/29 scripts, and POS 206 ms with 26 requests/19 scripts.
- Full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T09-33-26-469Z/report.json`
  checked 66 signals with zero relevant console messages. Public Cloudflare
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T09-34-08-289Z/report.json`
  rendered 20 products with zero failed responses, zero page errors, and CSP
  enforced.
- Cleanup removed ignored/regenerable `frontend/dist` (31,826,118 bytes) and
  `release` (380,876,952 bytes), reclaiming 412,703,070 bytes. Uploads,
  secrets, env files, databases, volumes, backups, and active Docker images
  were preserved. `npm.cmd --prefix ops run prune-storage` still has the same
  non-data follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 803: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 804

- `frontend/src/components/catalog/portalTranslateController.ts` now owns the
  external Google Translate widget setup path through
  `setupPortalExternalTranslateWidget`. `CatalogPage.tsx` delegates to that
  lazy module instead of carrying `window.google`, `TranslateElement`,
  script-host setup, or combo retry-loop code in the public catalog route.
- Guardrails and source tests passed:
  `node frontend\tests\portalTranslateController.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build`.
- Build proof: public catalog dropped from the prior 121.24 kB / 35.34 kB
  gzip route chunk to 120.50 kB / 35.12 kB gzip. The deferred
  `portal-translate-controller` chunk grew to 6.59 kB because it now owns the
  external widget setup path.
- Docker/live proof: release image `business-os:v6.0.0-202606061753` built,
  updated, and started healthy after backup
  `ops/runtime/docker-release/backups/20260606-175543`. Route traces against
  the live Docker app passed with no failures/errors: public catalog 239 ms
  with 21 requests/16 scripts/1 API, Dashboard 365 ms with 24 requests/18
  scripts/2 API, Inventory 400 ms with 36 requests/29 scripts/2 API, and POS
  212 ms with 26 requests/19 scripts/2 API. The public catalog trace did not
  request `portal-translate-controller-*`, `lang-en-*`, or Google Translate
  assets during first-window route load.
- Full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T09-57-04-872Z/report.json`
  checked 66 signals with zero relevant console messages. Public Cloudflare
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T09-57-43-322Z/report.json`
  rendered 20 products with zero failed responses, zero page errors, and CSP
  enforced.
- Cleanup removed ignored/regenerable `frontend/dist` (31,826,230 bytes) and
  `release` (380,877,976 bytes), reclaiming 412,704,206 bytes. Uploads,
  secrets, env files, databases, volumes, backups, and active Docker images
  were preserved. Generated references were refreshed and
  `npm.cmd --prefix ops run phase29:audit` passed all nine checks.
  `npm.cmd --prefix ops run prune-storage` still has the same non-data
  follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 804: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 805

- Public catalog mode no longer builds or writes staff-editor draft state.
  `editorDraft` initializes to `{}` for public mode, public bootstrap skips
  `setEditorDraft(buildDraft(nextConfig))`, and recommended/about/promo/FAQ
  memos read `previewConfig` unless `canEdit` is true.
- Guardrails and source tests passed:
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build`.
- Docker/live proof: release image `business-os:v6.0.0-202606061809` built,
  updated, and started healthy after backup
  `ops/runtime/docker-release/backups/20260606-181051`. Route traces against
  the live Docker app passed with no failures/errors: public catalog 295 ms
  with 21 requests/16 scripts/1 API, Dashboard 270 ms with 24 requests/18
  scripts/2 API, Inventory 249 ms with 36 requests/29 scripts/2 API, and POS
  205 ms with 26 requests/19 scripts/2 API.
- Full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T10-12-01-061Z/report.json`
  checked 66 signals with zero relevant console messages. Public Cloudflare
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T10-12-39-454Z/report.json`
  rendered 20 products with zero failed responses, zero page errors, and CSP
  enforced.
- Cleanup removed ignored/regenerable `frontend/dist` (31,826,268 bytes) and
  `release` (380,877,976 bytes), reclaiming 412,704,244 bytes. Uploads,
  secrets, env files, databases, volumes, backups, and active Docker images
  were preserved. Generated references were refreshed and
  `npm.cmd --prefix ops run phase29:audit` passed all nine checks.
  `npm.cmd --prefix ops run prune-storage` still has the same non-data
  follow-up for locked old report log
  `ops/runtime/reports/vite-preview-appselect.log`.
- Current plan position after Move 805: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 806

- Inventory movement selection now reuses one memoized visible-group ID index.
  `Inventory.tsx` builds `visibleMovementGroupIds` once from
  `visibleMovementGroups`, reuses it for expanded group cleanup, expanded page
  cleanup, and selected group cleanup, and memoizes `selectedMovementGroups`
  for movement rendering/export.
- Guardrails and source tests passed:
  `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`,
  `npm.cmd --prefix frontend run check:jsx`,
  `npm.cmd --prefix frontend run test:utils`, and
  `npm.cmd --prefix frontend run build`.
- Docker/live proof: release image `business-os:v6.0.0-202606070254` built,
  updated, and started healthy after backup
  `ops/runtime/docker-release/backups/20260607-025635`. Route traces against
  the live Docker app passed with no failures/errors: Inventory 513 ms with 36
  requests/29 scripts/2 API, Dashboard 657 ms with 24 requests/18 scripts/2
  API, POS 638 ms with 26 requests/19 scripts/2 API, and public catalog 421 ms
  with 21 requests/16 scripts/1 API.
- Full Phase 8.4 live suite passed. Broad UI report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-06T18-57-45-619Z/report.json`
  checked 66 signals on frontend hash `0fadf1009a3f3008`, source hash
  `9e29b055b17fc325`, with zero relevant console messages. Public Cloudflare
  report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-06T18-58-29-787Z/report.json`
  rendered 20 products with zero failed responses, zero page errors, and CSP
  enforced.
- Cleanup removed ignored/regenerable `frontend/dist` (31,826,258 bytes) and
  `release` (380,877,976 bytes), reclaiming 412,704,234 bytes. Uploads,
  secrets, env files, databases, volumes, backups, and active Docker images
  were preserved. The standard `prune-storage` command completed afterward and
  pruned stale reports plus old `business-os:v6.0.0-*` release image tags under
  policy while preserving `business-os:latest`, active image
  `business-os:v6.0.0-202606070254`, Docker volumes, uploads, secrets, env
  files, and backups. Generated references were refreshed and
  `npm.cmd --prefix ops run phase29:audit` passed all nine checks.
- Current plan position after Move 806: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 807

- POS checkout math now reuses one memoized `cartTotals` pass in
  `frontend/src/components/pos/POS.tsx`. That pass derives USD subtotal, KHR
  subtotal, and unique cart branch IDs together, while checkout reuses
  `branchesById` and `cartTotals.branchIds` instead of rebuilding Set/map/filter
  results.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` blocks the old
  separate subtotal `active.cart.reduce` scans and checkout branch `map/filter`
  rebuild.
- Source checks passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  frontend typecheck, JSX/source check, frontend utility suite, and frontend
  production build.
- Docker/runtime proof: `business-os:v6.0.0-202606070314` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-032424`.
- Live route proof: POS 213 ms, Inventory 232 ms, Dashboard 213 ms, and public
  catalog 189 ms, all with zero failed requests and zero console errors.
- Browser proof: the in-app Browser rendered the local app shell and public
  portal with no runtime overlay and no captured console errors; the portal
  showed 5,539 products.
- Full live suite passed: broad UI 66 signals, public Cloudflare portal 20
  products, zero failed responses, zero page errors, zero relevant console
  messages, CSP present, and post-live hygiene loaded.
- Cleanup reclaimed 412,703,283 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,826,331 bytes) and `release` (380,876,952 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 326,058 bytes of stale runtime
  reports, Docker-release backup `20260606-175543` (5,037,440 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606061709`, and 21.27 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070314` were preserved.
- Current plan position after Move 807: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 808

- POS branch-filtered product visibility now reuses one branch-stock lookup in
  `frontend/src/components/pos/POS.tsx`. When a branch filter is active, the
  product loop finds the selected branch row once, uses it to require branch
  presence, then reuses its quantity for stock-status filtering.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` blocks the old
  nested quantity IIFE that rescanned `branch_stock`.
- Source checks passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  frontend typecheck, JSX/source check, frontend utility suite, and frontend
  production build.
- Docker/runtime proof: `business-os:v6.0.0-202606070343` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-035407`.
- Live route proof: POS 237 ms, Inventory 256 ms, Dashboard 225 ms, and public
  catalog 184 ms, all with zero failed requests and zero console errors.
- Browser proof: the in-app Browser rendered the local app shell and public
  portal with no runtime overlay and no captured console warnings/errors; the
  portal showed 5,539 products, and a public `AHC` search kept real product
  cards visible with no `0`/no-results flash.
- Full live suite passed: broad UI 66 signals, public Cloudflare portal 20
  products, zero failed responses, zero page errors, zero relevant console
  messages, CSP present, and post-live hygiene loaded.
- Cleanup reclaimed 412,704,227 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,826,251 bytes) and `release` (380,877,976 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 328,231 bytes of stale runtime
  reports, Docker-release backup `20260606-181051` (5,039,476 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606061728`, and 613.5 MB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070343` were preserved.
- Current plan position after Move 808: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 809

- POS add-to-cart branch choice now scans branch stock once in
  `frontend/src/components/pos/POS.tsx`. `pickBestBranchId` returns the
  preferred/default branch immediately when available with positive stock, then
  otherwise tracks the highest positive quantity without `map`/`filter`/`sort`.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` blocks the old
  branch-stock `stockRows.sort(...)` selection path.
- Source checks passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  frontend typecheck, JSX/source check, frontend utility suite, and frontend
  production build. The POS chunk is `77.23 kB` / `20.03 kB` gzip.
- Docker/runtime proof: `business-os:v6.0.0-202606070408` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-041754`.
- Live route proof: POS 236 ms, Inventory 231 ms, Dashboard 223 ms, and public
  catalog 211 ms, all with zero failed requests and zero console errors.
- Full live suite passed: broad UI 66 signals on frontend hash
  `d7232f7ee0e9f429`, public Cloudflare portal 20 products, zero failed
  responses, zero page errors, zero relevant console messages, CSP present, and
  post-live hygiene loaded.
- Browser/Playwright proof: the in-app Browser loaded the surfaces but its
  virtual clipboard layer failed before typing, so regular Playwright completed
  the no-side-effect interaction proof. Public catalog loaded 5,539 products;
  searching `AHC` showed 4 real products with no no-results flash and zero
  console/page errors.
- Cleanup reclaimed 412,703,139 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,826,187 bytes) and `release` (380,876,952 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 354,792 bytes of stale runtime
  reports, Docker-release backup `20260607-025635` (5,041,511 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606061753`, and 613.6 MB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070408` were preserved.
- Current plan position after Move 809: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 810

- POS image gallery and lightbox handling now reuses
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`.
  `normalizeProductGallery` accepts array values, JSON array strings, and
  pipe-delimited strings, while POS calls `getProductGalleryImages` and
  `buildProductLightboxState` instead of a route-local parser.
- Guardrails: `frontend/tests/productGalleryHelpers.test.ts` covers stored
  string gallery formats, and `frontend/tests/performanceLoadingUx.test.ts`
  blocks the old POS-local JSON/pipe parsing path.
- Source checks passed: `node frontend\tests\productGalleryHelpers.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`, frontend typecheck,
  JSX/source check, frontend utility suite, and frontend production build. The
  POS chunk is `76.75 kB` / `19.91 kB` gzip, and `product-shared` is
  `6.83 kB` / `2.62 kB` gzip.
- Docker/runtime proof: `business-os:v6.0.0-202606070439` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-044957`.
- Live route proof: POS 209 ms, Inventory 247 ms, Dashboard 273 ms, and public
  catalog 202 ms, all with zero failed requests and zero console errors.
- Full live suite passed: broad UI 66 signals on frontend hash
  `4669a465a3229a92`, public Cloudflare portal 20 products, zero failed
  responses, zero page errors, zero relevant console messages, CSP present, and
  post-live hygiene loaded.
- Browser/Playwright proof: the in-app Browser loaded the public catalog with
  no runtime overlay and zero captured warnings/errors. Its fill bridge set the
  search value without triggering the same React filter path, so standalone
  Playwright completed the interaction proof: public catalog loaded 5,539
  products; searching `AHC` showed 4 real products with no no-results flash and
  zero console/page errors.
- Cleanup reclaimed 412,704,336 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,825,848 bytes) and `release` (380,878,488 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 354,753 bytes of stale runtime
  reports, Docker-release backup `20260607-032424` (5,043,546 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606061809`, and 613.6 MB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070439` were preserved.
- Current plan position after Move 810: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 811

- POS filter option normalization now reuses the Products helper layer.
  `frontend/src/components/pos/POS.tsx` calls `buildProductBrandOptions` and
  `buildProductSupplierOptions` instead of locally parsing saved brand options
  and rebuilding supplier Set/sort state.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` requires the shared
  imports and blocks the old local brand settings parser and supplier Set/sort
  copy.
- Source checks passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productDisplayHelpers.test.ts`,
  `node frontend\tests\productMenuHelpers.test.ts`, frontend typecheck,
  JSX/source check, frontend utility suite, and frontend production build. The
  POS chunk is `76.52 kB` / `19.86 kB` gzip, Products is `88.63 kB` /
  `23.93 kB` gzip, and `productMenuHelpers` is `8.06 kB` / `2.55 kB` gzip.
- Docker/runtime proof: `business-os:v6.0.0-202606070504` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-051433`.
- Live route proof: POS 205 ms, Inventory 298 ms, Dashboard 218 ms, and public
  catalog 215 ms, all with zero failed requests and zero console errors.
- Full live suite passed: broad UI 66 signals on frontend hash
  `a3fd08ced369f325`, public Cloudflare portal 20 products, zero failed
  responses, zero page errors, zero relevant console messages, CSP present, and
  post-live hygiene loaded.
- Browser/Playwright proof: the in-app Browser rendered the public catalog with
  no blank shell, no runtime overlay, and zero captured warnings/errors.
  Standalone Playwright typed `AHC` into public search and verified the list
  narrowed from 5,539 products to 4 real AHC products with no no-results flash
  and zero console/page errors.
- Cleanup reclaimed 412,704,332 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,825,844 bytes) and `release` (380,878,488 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 325,725 bytes of stale runtime
  reports, Docker-release backup `20260607-035407` (5,045,580 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606070254`, and 1.269 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070504` were preserved.
- Current plan position after Move 811: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 812

- POS comma search-term parsing now reuses the Products helper layer.
  `frontend/src/components/pos/POS.tsx` calls `buildProductSearchTerms` from
  `frontend/src/components/products/helpers/productFilterHelpers.ts` instead
  of keeping a route-local `deferredSearch.split(...)` parser.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` requires the shared
  search helper import and blocks the old local comma parser.
- Source checks passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productFilterHelpers.test.ts`,
  `node frontend\tests\productSearchPagination.test.ts`, frontend typecheck,
  JSX/source check, frontend utility suite, and frontend production build. The
  POS chunk is `76.50 kB` / `19.86 kB` gzip, Products is `86.85 kB` /
  `23.30 kB` gzip, and `product-shared` is `6.83 kB` / `2.62 kB` gzip.
- Docker/runtime proof: `business-os:v6.0.0-202606070530` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-054018`.
- Live route proof: POS 272 ms, Products 234 ms, Inventory 255 ms, Dashboard
  207 ms, and public catalog 197 ms, all with zero failed requests and zero
  console errors.
- Full live suite passed: broad UI 66 signals on frontend hash
  `0dd2009439038702`, public Cloudflare portal 20 products, zero failed
  responses, zero page errors, zero relevant console messages, CSP present, and
  post-live hygiene loaded.
- Browser/Playwright proof: the in-app Browser loaded the public catalog with
  no blank shell, no runtime overlay, and zero relevant app console messages.
  A focused authenticated Playwright POS probe typed `AHC, Mask`, verified both
  `ahc` and `mask` chips, narrowed POS to `1-4 / 4` real AHC mask cards, and
  saw no no-data flash, console error, or page error.
- Follow-up finding: public catalog comma search currently keeps `AHC, Mask`
  at the full `5,539 result(s)` count in the rendered UI. The backend portal
  search already accepts comma terms, so the next focused slice should
  synchronize the public UI/request path.
- Cleanup reclaimed 412,701,800 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,825,872 bytes) and `release` (380,875,928 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 333,540 bytes of stale runtime
  reports, Docker-release backup `20260607-041754` (5,047,616 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606070314`, and 38.4 MB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070530` were preserved.
- Current plan position after Move 812: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Recent Move 813

- Public catalog comma search-term parsing now reuses the Products helper
  layer. `frontend/src/components/catalog/CatalogPage.tsx` calls
  `buildProductSearchTerms`, sends the stable comma-normalized
  `portalSearchQuery` to the portal product search API, resets pagination from
  that normalized query, and uses the same terms for the local visible-product
  pass.
- Guardrail: `frontend/tests/performanceLoadingUx.test.ts` requires the public
  catalog shared helper import, `portalSearchTerms` and `portalSearchQuery`
  memoization, and blocks the old ad hoc
  `deferredSearch.toLowerCase().split(...)` parser.
- Source checks passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  `node frontend\tests\productFilterHelpers.test.ts`, frontend typecheck,
  JSX/source check, frontend utility suite, and frontend production build. The
  public catalog chunk is `126.96 kB` / `37.33 kB` gzip, `product-shared` is
  `6.83 kB` / `2.62 kB` gzip, and `PublicCatalogRoot` is `1.61 kB` /
  `0.80 kB` gzip.
- Docker/runtime proof: `business-os:v6.0.0-202606070604` is running healthy
  after backup `ops/runtime/docker-release/backups/20260607-061341`; runtime
  health reports frontend hash `92a899e0a7b2462c` and source hash
  `9e29b055b17fc325`.
- Browser/Playwright proof: standalone Playwright loaded the deployed public
  catalog in 346 ms, typed `AHC, Mask`, saw the API request
  `query=ahc%2Cmask`, received `total=4` and 4 items, rendered `4 result(s)`
  and `Showing 1-4 of 4`, and found zero relevant console/page errors.
- Full live suite passed: broad UI 66 signals on frontend hash
  `92a899e0a7b2462c`, public Cloudflare portal 20 products, zero failed
  responses, zero page errors, zero relevant console messages, CSP present, and
  post-live hygiene loaded.
- Route trace proof: Dashboard 195 ms, Inventory 209 ms, Sales 235 ms, and
  Audit Log 227 ms, all with zero failed requests and zero console errors.
- Cleanup reclaimed 412,703,992 bytes from ignored regenerable artifacts:
  `frontend/dist` (31,826,528 bytes) and `release` (380,877,464 bytes). No
  source or business data was deleted.
- Standard retention cleanup then removed 299,344 bytes of stale runtime
  reports, Docker-release backup `20260607-044957` (5,049,651 bytes) beyond the
  latest-three retention policy, old Docker rollback tag
  `business-os:v6.0.0-202606070343`, and 1.269 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070604` were preserved.
- Phase 29 audit passed after cleanup with 9 checks and 0 failures.
- Follow-up cleared: the Move 812 public catalog comma-search synchronization
  issue is resolved for the deployed local runtime.
- Current plan position after Move 813: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Latest Move 820

- The legacy domain API registry no longer owns a second untyped copy of
  Settings read/save logic. `frontend/src/api/methods.ts` now lazy-loads
  `frontend/src/api/settingsTransport.ts` for `getSettings` and
  `saveSettings`.
- The typed settings transport remains the single owner for `/api/settings`
  reads, conflict retry payloads, inline `updatedAt` metadata, local settings
  mirror writes, and refresh-channel dispatch.
- The performance/source guard now verifies that `settingsTransport.ts` owns
  the `/api/settings` call, that `methods.ts` lazy-loads the typed transport,
  that the legacy registry does not duplicate settings read logic, and that
  `/api/settings/meta` is still blocked as a startup waterfall.
- Verification passed: `node frontend\tests\performanceLoadingUx.test.ts`,
  `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run
  check:jsx`, `npm.cmd --prefix frontend run build`, and `npm.cmd --prefix ops
  run phase84:settings-save-rollback`.
- Live proof:
  `ops/runtime/reports/phase84-settings-save-rollback-check-2026-06-07T01-27-43-770Z/report.json`
  saved `business_name` with HTTP 200, observed the temporary value, and
  restored the original value.
- Current plan position after Move 820: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Previous Move 819

- Settings page Save now has a dedicated rollback-safe live check. The harness
  snapshots the current `business_name`, changes it through the real Settings
  form, clicks Save, verifies the persisted value through `/api/settings`, and
  restores the original value in a `finally` block.
- The Phase 8.4 live suite now includes three rollback-sensitive settings
  checks by default: Receipt Settings language rollback, Loyalty Points
  point-rule rollback, and Settings save rollback. The shared `--skip-rollback`
  option remains available for explicit faster runs.
- Verification passed: `npm.cmd --prefix ops run
  phase84:settings-save-rollback` and the expanded `npm.cmd --prefix ops run
  phase84:live-suite`.
- Live proof: `ops/runtime/reports/phase84-settings-save-rollback-check-2026-06-07T00-47-55-940Z/report.json`
  saved `business_name` with HTTP 200, observed the temporary value, and
  restored the original value. `ops/runtime/reports/phase84-live-suite-latest.json`
  passed all six default steps.
- Current plan position after Move 819: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Previous Move 818

- Loyalty Points save now has a dedicated rollback-safe live check. The harness
  snapshots the customer portal point-rule settings, uses the real Loyalty
  Points page to change the earning basis and save, verifies the persisted
  settings through `/api/settings`, and restores the original settings in a
  `finally` block.
- The Phase 8.4 live suite now runs both rollback-sensitive settings checks by
  default: Receipt Settings language rollback and Loyalty Points point-rule
  rollback. A new `--skip-rollback` option keeps fast suite runs possible.
- Verification passed: `npm.cmd --prefix ops run
  phase84:loyalty-points-rollback` and the expanded `npm.cmd --prefix ops run
  phase84:live-suite`.
- Live proof: `ops/runtime/reports/phase84-loyalty-points-rollback-check-2026-06-07T00-41-14-929Z/report.json`
  saved target basis `khr` with HTTP 200, observed the expected settings, and
  restored the original snapshot. `ops/runtime/reports/phase84-live-suite-latest.json`
  passed UI, public portal, receipt rollback, loyalty rollback, and post-live
  hygiene.
- Current plan position after Move 818: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Previous Move 817

- The all-pages control audit is now more independent and higher coverage.
  Safe button clicks are isolated by returning the page to its route between
  interactions, so one tab click no longer hides the remaining safe candidates.
- Mutating, file/media, print/download, delivery, and settings-toggle actions
  are still skipped into the seeded rollback backlog before the long-label
  stability guard runs. Normal safe sentence-length controls now remain
  testable up to a configurable 96-character limit.
- Verification passed: targeted Receipt Settings/Loyalty Points all-pages
  audit, then the full broad all-pages control audit.
- Live proof: `ops/runtime/reports/all-pages-control-audit-2026-06-07T00-22-18-993Z/summary.json`
  passed with 34 routes, 398 tested controls, 56 guarded skips, 0 failed
  controls, 0 findings, and 68 screenshots. The previously weak routes now
  meet the minimum route coverage gate: desktop/mobile Loyalty Points tested 5
  controls each, desktop Receipt Settings tested 8, and mobile Receipt Settings
  tested 9.
- Current plan position after Move 817: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Previous Move 816

- Public portal mobile loading is now more compact and specific. The About
  hero uses mobile-first spacing, removes the forced tall hero height on small
  screens, clamps intro copy only on mobile, and compresses telephone, address,
  and social contact actions into a shorter rounded tray.
- Secondary public portal tabs now show a tab-specific compact Suspense
  fallback instead of the large generic `Loading customer portal...` panel, so
  mobile users do not land on a blank-feeling placeholder after tapping
  Assistant, FAQ, Membership, or Products.
- The public Cloudflare portal live check now verifies the mobile About hero,
  contact tray, horizontal overflow, and absence of the generic loading panel
  after opening the Assistant tab. This makes the mobile public-portal
  regression visible in the normal Phase 8.4 gate.
- Verification passed: `node frontend\tests\portalCatalogDisplay.test.ts`,
  `node frontend\tests\performanceLoadingUx.test.ts`, frontend typecheck,
  JSX/source check, frontend production build, Docker release/update, public
  Cloudflare portal Playwright check, route-load trace, storage prune, Phase 29
  audit, and schema audit through the current TypeScript entrypoint.
- Runtime proof: Docker release `business-os:v6.0.0-202606070759` is healthy;
  frontend hash `8d3cdc06c5e7b390`, source hash `9e29b055b17fc325`.
- Live proof: public portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-07T00-02-46-596Z/report.json`
  rendered 20 products, measured a 413 px mobile About hero and 134 px contact
  tray, saw zero horizontal overflow, kept `genericLoadingVisible` false, and
  recorded zero failed responses, zero relevant console messages, and zero page
  errors. Route-load trace was Dashboard 211 ms, Inventory 184 ms, Sales
  181 ms, Audit Log 181 ms, with zero failed requests and zero console errors.
- Cleanup proof: ignored regenerable `frontend/dist` and `release` reclaimed
  412,703,753 bytes. Storage prune removed stale reports, two old
  Docker-release backups, old Docker rollback tags, and 2.538 GB of Docker
  builder cache while preserving uploads, secrets, env files, data, Docker
  volumes, latest backup sets, R2 latest backup, `business-os:latest`, and the
  active release image.
- Current plan position after Move 816: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Current Move 847

- Action-history route startup is leaner. `historyHelpers.ts` now belongs to
  `shared-action-history` instead of emitting a separate `historyHelpers-*.js`
  request.
- Guardrail added in `frontend/tests/performanceLoadingUx.test.ts` so history
  snapshot helpers stay with the shared action-history chunk.
- Build proof: production build emitted `shared-action-history-opXl0TYw.js`
  at 12.00 kB / 4.12 kB gzip and no standalone `historyHelpers-*.js`.
- Runtime proof: Docker image `business-os:v6.0.0-202606090044` is healthy
  with frontend hash `c542cd5c37ee937b`.
- Live route proof: Products improved to 37 requests / 27 scripts, Inventory
  to 38 / 29, and Returns to 32 / 25, each one request and one script lower
  than the prior Docker trace. Dashboard, POS, and public catalog stayed
  stable, and all six routes had zero failed responses and zero page errors.
- Live suite proof: Phase 8.4 UI check, public Cloudflare portal check,
  receipt settings rollback, loyalty points rollback, settings rollback, and
  post-live hygiene all passed.
- Cleanup proof: storage prune removed 719,667 bytes of stale reports,
  5,272,836 bytes of old Docker-release backup data, one old Docker rollback
  tag, and 3.579 GB of Docker builder cache.
- Current plan position after Move 847: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Current Move 846

- Product-driven route startup is leaner. `productGrouping.ts` now belongs to
  the existing `product-shared` chunk instead of emitting a separate
  `productGrouping-*.js` request.
- Guardrail added in `frontend/tests/performanceLoadingUx.test.ts` so the
  grouping helper remains with product shared primitives.
- Build proof: production build emitted `product-shared-BTlFGq5T.js` at
  11.93 kB / 4.21 kB gzip and no standalone `productGrouping-*.js`.
- Runtime proof: Docker image `business-os:v6.0.0-202606090010` is healthy
  with frontend hash `55303e93b37a9590`.
- Live route proof: Products improved to 38 requests / 28 scripts, Inventory
  to 39 / 30, and POS to 31 / 22, each one request and one script lower than
  the prior Docker trace. Dashboard, Returns, and public catalog stayed stable,
  and all six routes had zero failed responses and zero page errors.
- Live suite proof: Phase 8.4 UI check, public Cloudflare portal check,
  receipt settings rollback, loyalty points rollback, settings rollback, and
  post-live hygiene all passed.
- Cleanup proof: storage prune removed 719,979 bytes of stale reports,
  5,286,447 bytes of old Docker-release backup data, one old Docker rollback
  tag, and 3.579 GB of Docker builder cache.
- Current plan position after Move 846: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Previous Move 815

- Rounded dropdown hardening is now live. `AppSelect` exposes stable trigger
  and selected-value hooks, and its custom menu is viewport-bounded so page-size
  and filter selectors stay rounded and compact instead of falling back to
  square native popups.
- Component source is guarded against native `<select>` reintroduction, and
  the performance/loading UX test now requires compact one-row filter sections,
  the accidental `Back` label fallback, the `AppSelect` hooks, and the bounded
  custom menu.
- The filter-menu live check now handles localized/compact Dashboard custom
  range controls by falling back through persisted dashboard filter preferences
  before verifying the actual custom date and granularity controls.
- Verification passed: source syntax check, performance/loading UX guard,
  frontend typecheck, JSX/source check, frontend production build, focused
  filter-menu live check, focused shared-select live check, and route-load
  trace.
- Runtime proof: Docker release `business-os:v6.0.0-202606070725` is healthy;
  frontend hash `c36ea69af92f848f`, source hash `9e29b055b17fc325`.
- Live proof: Products, Inventory, Audit Log, Library, Dashboard, and POS all
  passed the focused filter-menu live check. Route-load trace was Dashboard
  245 ms, Inventory 243 ms, Sales 183 ms, Audit Log 167 ms, with zero failed
  requests and zero console errors. The in-app browser logged in through the
  real UI and opened the Products page-size dropdown with options `20`, `50`,
  and `100`, `16.8px` menu radius, `288px` max height, zero native selects,
  and no framework overlay.
- Cleanup proof: ignored regenerable `frontend/dist` and `release` reclaimed
  412,706,075 bytes. Storage prune removed stale reports, one old
  Docker-release backup, old Docker rollback tags, and 2.5 GB of Docker builder
  cache while preserving uploads, secrets, env files, data, Docker volumes,
  latest backup sets, R2 latest backup, `business-os:latest`, and the active
  release image.
- Current plan position after Move 815: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.

## Previous Move 814

- Receipt bilingual output now uses the canonical Khmer label map directly.
  `frontend/src/components/receipt/Receipt.tsx` no longer carries a duplicated
  second Khmer label object, and the source guard now requires real Khmer text
  while rejecting mojibake fragments.
- Receipt PNG fallback rendering is tighter. `frontend/src/utils/printReceipt.ts`
  wraps canvas text by measured pixel width, clips product names to the item
  name column, and draws Qty and Price at fixed column positions so image
  downloads do not regress into a horizontal strip or run-on item row.
- Live guardrail:
  `ops/scripts/runtime/live-checks/phase84-receipt-export-layout-check.ts`
  now rejects English and Khmer status rows, redundant `@ $...` unit-price
  lines, missing Name/Qty/Price headers, receipt overflow, and collapsed image
  downloads.
- Verification passed: `node frontend\tests\receiptTemplate.test.ts`,
  `node frontend\tests\receiptSettingsSync.test.ts`, frontend typecheck,
  JSX/source check, frontend utility suite, and frontend production build.
- Runtime proof: Docker release `business-os:v6.0.0-202606070648` is running
  healthy after backup `ops/runtime/docker-release/backups/20260607-065135`;
  runtime health reports frontend hash `e567678f3ad2f58d` and source hash
  `9e29b055b17fc325`.
- Live receipt proof:
  `ops/runtime/reports/phase84-receipt-export-layout-check-2026-06-06T22-52-27-772Z/report.json`
  passed Receipt Settings preview, Sales reprint modal, print-preview popup,
  and PNG image download. The downloaded image
  `Receipt-RCP-1778187462364-1R0O.png` measured 672 by 876 pixels.
- Cleanup proof: ignored regenerable `frontend/dist` (31,827,183 bytes) and
  `release` (380,878,183 bytes) were removed for 412,705,366 bytes reclaimed.
  `npm.cmd --prefix ops run prune-storage` then removed 30,307 bytes of stale
  runtime reports, two old Docker-release backup packages (10,105,392 bytes
  total), two old Docker rollback tags, and 1.269 GB of Docker builder cache.
  Uploads, secrets, env files, databases, Docker volumes, latest backup sets,
  R2 backup `datasync-2026-06-06T18-54-10-839Z`, `business-os:latest`, and
  active image `business-os:v6.0.0-202606070648` were not touched.
- Phase 29/schema proof: `node ops\scripts\architecture\phase29-audit.ts`
  passed after cleanup with 9 checks and 0 failures, and
  `node ops\scripts\backend\schema-audit.ts` passed with 45 static tables and
  zero relationship-doc or backup action-needed gaps.
- Current plan position after Move 814: Phase 8.4 active; Phase 26 at 51
  completed organization moves; Phase 28 active with R2/access follow-up open;
  Phase 29 active for repeated whole-codebase schema, cleanup, TypeScript,
  runtime, and performance sweeps.
