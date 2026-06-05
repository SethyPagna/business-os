# Business OS Optimization Status

Last updated: 2026-06-05

## Phase Board

- Phase 8.4: active live verification and UI/runtime checks
- Phase 26: 51 completed organization moves; future folder moves must cite Phase 29 evidence
- Phase 28: active, with R2 prune follow-up still open
- Phase 29: active whole-codebase schema, cleanup, TypeScript, runtime, and performance sweeps
- Latest completed move: Move 793, inline the tiny public runtime guard scripts
  at Vite HTML-transform time so cold admin/public page loads no longer spend
  separate parser-blocking requests on `/runtime-noise-guard.js` and
  `/theme-bootstrap.js`

## Current Baseline

Latest verified runtime health:

- local health: `http://127.0.0.1:4000/health`
- latest verified frontend/source hash from the most recent Docker-served live check: `5d419c030bf25d50`
- latest production build hash from Docker-served live check:
  `b95ab65d20e981cf`

Latest verified reports:

- latest retained all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-latest.json`
- latest fast all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-04T00-01-16-941Z/summary.json`
- latest exhaustive desktop/mobile all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T16-31-07-897Z/summary.json`
- latest broad Phase 8.4 UI live check:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-04T22-48-17-381Z/report.json`
- latest public Cloudflare portal check:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-05T00-20-09-999Z/report.json`
- latest focused local route-load trace:
  `ops/runtime/reports/route-load-trace-2026-06-05T00-19-57-544Z.json`
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

- Frontend access-control transport is now
  `frontend/src/api/accessControlTransport.ts` with typed user, profile,
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

## Latest Move 785

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
