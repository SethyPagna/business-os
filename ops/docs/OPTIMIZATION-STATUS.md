# Business OS Optimization Status

Last updated: 2026-06-01

## Phase Board

- Phase 8.4: active live verification and UI/runtime checks
- Phase 26: 51 completed organization moves; future folder moves must cite Phase 29 evidence
- Phase 28: active, with R2 prune follow-up still open
- Phase 29: active whole-codebase schema, cleanup, TypeScript, runtime, and performance sweeps
- Latest completed move: Move 690, typed custom tables transport extraction

## Current Baseline

Latest verified runtime health:

- local health: `http://127.0.0.1:4000/health`
- latest verified frontend hash from the most recent broad Phase 8.4 UI live check: `55cf7b8ef08a4b8d`
- latest production build hash from `npm.cmd --prefix frontend run build`:
  `f0bd9c4c253b521e`

Latest verified reports:

- broad Phase 8.4 UI live check:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T04-15-34-032Z/report.json`
- latest focused Products desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T05-45-21-656Z/summary.json`
- latest focused Dashboard desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T07-05-12-423Z/summary.json`
- latest focused Settings desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T07-16-31-085Z/summary.json`
- latest focused Library desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T06-14-04-097Z/summary.json`
- latest focused Contacts desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T06-31-14-438Z/summary.json`
- latest focused Users desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T06-50-58-307Z/summary.json`
- latest focused public catalog desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T03-48-20-747Z/summary.json`
- latest focused Audit Log desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T04-00-11-876Z/summary.json`
- latest focused Inventory desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T04-26-48-123Z/summary.json`
- latest focused Branch desktop/mobile control audit:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T05-00-35-669Z/summary.json`
- post-live hygiene:
  `ops/runtime/reports/post-live-hygiene-latest.json`
- Phase 29 repeated audit:
  `ops/docs/reference/PHASE29-AUDIT.md`

Current honest pockets:

- broad Phase 8.4 UI live check passed with 72 checked signals, no relevant
  console messages, and no framework overlay
- post-live hygiene passed after elevated Docker access, with loaded dataset
  status and zero generated integrity matches
- the public Cloudflare portal check still failed because
  `https://leangcosmetics.dpdns.org/public` did not render expected customer
  content; keep that as the next public tunnel/runtime issue instead of mixing
  it into local TypeScript migration work

Recent route-level win:

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
