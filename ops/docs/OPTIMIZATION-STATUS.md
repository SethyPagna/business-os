# Business OS Optimization Status

Last updated: 2026-06-01

## Phase Board

- Phase 8.4: active live verification and UI/runtime checks
- Phase 26: 51 completed organization moves; future folder moves must cite Phase 29 evidence
- Phase 28: active, with R2 prune follow-up still open
- Phase 29: active whole-codebase schema, cleanup, TypeScript, runtime, and performance sweeps
- Latest completed move: Move 708, split login/auth bootstrap out of the heavy API registry

## Current Baseline

Latest verified runtime health:

- local health: `http://127.0.0.1:4000/health`
- latest verified frontend hash from the most recent broad Phase 8.4 UI live check: `1a5804d05a4e008e`
- latest production build hash from `npm.cmd --prefix frontend run build`:
  `1a5804d05a4e008e`

Latest verified reports:

- latest retained all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-latest.json`
- latest exhaustive desktop/mobile all-pages control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T16-00-36-623Z/summary.json`
- latest broad Phase 8.4 UI live check:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-01T15-57-09-334Z/report.json`
- latest public Cloudflare portal check:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-01T16-00-02-450Z/report.json`
- post-live hygiene:
  `ops/runtime/reports/post-live-hygiene-latest.json`
- Phase 29 repeated audit:
  `ops/docs/reference/PHASE29-AUDIT.md`

Latest cleanup run:

- `npm.cmd --prefix ops run prune-storage` in the 2026-06-01 Move 708
  verification pass removed three old live/audit report folders for 9,728,509
  bytes, kept the latest local backups, kept the newest R2 backup object
  `datasync-2026-06-01T14-12-08-430Z`, and found no stopped containers or
  Docker builder cache to reclaim.

Current honest pockets:

- exhaustive desktop/mobile all-pages Playwright control audit passed across
  34 routes, with 518 visible controls discovered, 392 controls exercised, 126
  intentionally skipped by stable broad-audit guardrails, 68 screenshots, zero
  failed controls, and zero findings
- broad Phase 8.4 UI live check passed on frontend hash `1a5804d05a4e008e`
  with 72 checked signals, no relevant console messages, and no framework
  overlay
- public Cloudflare portal check passed with 20 rendered products, zero failed
  responses, zero relevant console messages, zero page errors, and enforced CSP
- post-live hygiene passed with loaded dataset status and zero generated
  integrity matches

Recent runtime/load win:

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
  mechanics out of the remaining domain registry.

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

1. Split `frontend/src/api/methods.ts` into typed sections, starting with
   bounded helpers and low-risk domain clusters, then remove its temporary
   `ts-nocheck` marker when request payloads, retries, cache invalidation,
   import jobs, and offline mirrors are covered by explicit types.
2. Keep backend TypeScript packaging and generated runtime wrappers guarded by
   the runtime JavaScript inventory, Docker release guardrail, and backend
   package staging checks before deleting any generated startup file.
3. Update source-inspection tests and ops verification scripts whenever a real
   implementation moves behind a compatibility wrapper.
4. Refresh Phase 29 references after each migration and keep the public
   Cloudflare portal failure separate until the tunnel/runtime path is fixed.
