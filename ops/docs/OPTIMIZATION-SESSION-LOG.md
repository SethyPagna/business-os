# Business OS Optimization Session Log

Last updated: 2026-06-04

This is a concise running log of what actually happened in recent sessions.

## 2026-06-04

### Accepted

- POS customer contact-option parser deferral
  - route: `pos`
  - result: kept
  - note: removed the normal-route static `contactOptionUtils` import from
    `POS.tsx`; the customer contact parser now loads through memoized
    `loadContactOptionUtilsModule()` only after customer selection/search
    intent. The source guardrail rejects reintroducing the static parser import.
  - proof: Docker release `business-os:v6.0.0-202606041924` is running with
    frontend hash `65f9c9c258d20478`. Local POS route trace
    `ops/runtime/reports/route-load-trace-2026-06-04T11-38-42-025Z.json`
    passed in 235 ms with 30 requests, 22 scripts, two API calls, zero failed
    requests, zero console/page errors, and `hasContactOptionUtils=false`.
    An authenticated Playwright probe loaded POS, opened the customer panel,
    filled `Search by name or phone...`, and recorded zero failed
    requests/page errors. Public portal check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T11-44-23-687Z/report.json`
    rendered 20 products, confirmed portal bootstrap 200 and AI status 200
    after interaction, and recorded zero failed responses, zero relevant
    console messages, and zero page errors. Generated-artifact cleanup removed
    412,448,579 bytes from regenerable `release` and `frontend/dist`; the
    follow-up Phase 29 audit passed with zero failures.

- Settings media upload state/helper deferral
  - route: `settings`
  - result: kept
  - note: split lightweight upload state logic into `mediaUploadState.ts`,
    removed normal-route static imports of the full media upload helper and
    favicon canvas helper from `Settings.tsx`, delayed circular favicon preview
    work by 1800 ms plus idle scheduling, and dynamically loaded cache-busted
    upload path logic only after an upload succeeds.
  - proof: Docker release `business-os:v6.0.0-202606040958` is running;
    standalone frontend build hash is `8517c0bf4c9e5cd9`. Local route trace
    `ops/runtime/reports/route-load-trace-2026-06-04T02-01-26-353Z.json`
    passed Dashboard, Products, Backup, and Settings with zero failures/errors;
    Settings loaded in 193 ms with 25 requests and 20 scripts. Remote admin
    trace `ops/runtime/reports/route-load-trace-2026-06-04T02-01-26-931Z.json`
    passed the same routes with zero failures/errors; Settings loaded in
    205 ms. Both traces show no normal-route `media-upload-utils`,
    `favicon-utils`, `settings-otp-modal`, or `backup-reset-tools` request.
    Public portal check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T02-01-45-667Z/report.json`
    rendered 20 products with portal bootstrap 200, AI status 200 after
    interaction, and zero relevant console/page errors. Post-live hygiene
    passed with zero QA cleanup matches and relationship orphan checks passing
    for 49 FK candidates.

- Public catalog translate-controller deferral
  - route: `public_catalog`
  - result: kept
  - note: removed the static `portalTranslateController.ts` import from
    `CatalogPage.tsx`, added small local preference helpers, and moved the
    Google Translate controller behind a cached dynamic import. Ordinary public
    first paint keeps first-party language/content behavior but does not fetch
    the external translate controller.
  - proof: Docker release `business-os:v6.0.0-202606040909` is running with
    frontend hash `85ba33f03f2cbcf2`; production output emits
    `portal-translate-controller-DInGtqE9.js` at 5.51 KB while `portal-tools`
    is 72.84 KB in Vite output. Local trace
    `ops/runtime/reports/route-load-trace-2026-06-04T01-12-10-187Z.json`
    and real public trace
    `ops/runtime/reports/route-load-trace-2026-06-04T01-12-37-146Z.json`
    passed with zero failures/errors and include no `portal-translate-controller`
    first-load request. Public portal check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T01-13-03-264Z/report.json`
    rendered 20 products with portal bootstrap 200, AI status 200 after
    interaction, and zero relevant console/page errors. Post-live hygiene
    passed with zero QA cleanup matches and relationship orphan checks passing
    for 49 FK candidates.

- Public catalog portal-tools chunk ordering
  - route: `public_catalog`
  - result: kept
  - note: moved the existing `portalLanguagePacks.ts`,
    `portalContentI18n.ts`, `portalTranslateController.ts`, and
    `portalEditorUtils.ts` manual chunk rule before the generic catalog
    fallback so the `portal-tools` chunk is actually emitted. Production
    assets now split the base `catalog` chunk to 78,587 bytes and
    `portal-tools` to 99,711 bytes instead of carrying the combined work in
    the roughly 156 KB catalog route chunk from Move 773.
  - proof: Docker release `business-os:v6.0.0-202606040854` is running with
    frontend hash `06f2981d71deccc1`; local trace
    `ops/runtime/reports/route-load-trace-2026-06-04T00-55-40-207Z.json`
    passed public catalog, Dashboard, Products, and POS with zero failures/
    errors; real public trace
    `ops/runtime/reports/route-load-trace-2026-06-04T00-55-54-685Z.json`
    passed `/public` with zero failures/errors; real admin trace
    `ops/runtime/reports/route-load-trace-2026-06-04T00-56-22-899Z.json`
    passed Dashboard and Products with zero failures/errors; public portal
    check
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-56-07-251Z/report.json`
    rendered 20 products with portal bootstrap 200, AI status 200 after
    interaction, and zero relevant console/page errors. Post-live hygiene
    passed with zero QA cleanup matches and relationship orphan checks passing
    for 49 FK candidates.

## 2026-06-03

### Accepted

- POS category-options deferral
  - route: `pos`
  - result: kept
  - note: moved `/api/categories` out of the POS route-ready batch and into a
    tracked delayed loader that wakes immediately when the filter panel opens;
    Docker-served route trace shows POS at 45 total requests, 3 API requests,
    zero failed requests, and zero console/page errors, while a longer trace
    proves categories wake around 2.3 s with other non-critical metadata

- Branches action-history deferral
  - route: `branches`
  - result: kept
  - note: moved `/api/users` and `/api/action-history...` out of the Branches
    route-ready batch by enabling server history only after the branch list and
    summary settle; Docker-served route trace shows Branches at 34 total
    requests, 3 API requests, zero failed requests, and zero console/page
    errors, while a longer trace proves history wakes around 2.3 s

- Files/Users/Backup action-history deferral
  - routes: `files`, `users`, `backup`
  - result: kept
  - note: moved non-critical server action-history reads out of the first route
    window; Docker-served route trace now shows Backup at 1 API request, Files
    at 2 API requests, and Users at 3 API requests, while a longer trace proves
    server history wakes around 2.1-2.3 s after navigation

- Contacts action-history deferral
  - route: `contacts`
  - result: kept
  - note: moved `/api/users` and `/api/action-history...` out of the Contacts
    route-ready batch by giving Customers, Suppliers, and Delivery the same
    post-ready history gate; Docker-served route trace now shows Contacts at
    39 total requests, 2 API requests, zero failed requests, and zero console/
    page errors, while a longer trace proves history wakes around 2.6 s

- Public portal first-load deferral
  - route: `public_catalog`
  - result: kept
  - note: made Products the default public tab, deferred Google Maps until
    About is visible, and deferred portal AI status until the Assistant tab is
    clicked; Docker-served route trace now shows the public catalog at 25 total
    requests, 3 API requests, zero failed requests, and zero console/page
    errors, while the Cloudflare check proves AI status is absent before
    interaction and returns HTTP 200 after the Assistant click

- Public portal bootstrap collapse
  - route: `public_catalog`
  - result: kept
  - note: replaced the first-load public config/meta/search waterfall with one
    `/api/portal/bootstrap` response carrying config, metadata, and the first
    product page; Docker-served route trace now shows public_catalog at 23
    total requests, 1 API request, zero failed requests, and zero console/page
    errors

- Server startup bootstrap collapse
  - route: `server`
  - result: kept
  - note: replaced the first-load `/api/system/config` plus
    `/api/system/debug/log` pair with one `/api/system/bootstrap` response
    carrying security config and initial diagnostics; Docker-served route trace
    now shows Server at 30 total requests, 2 API requests, zero failed
    requests, and zero console/page errors

### Verification

- Frontend `test:utils`, frontend `check:jsx`, backend `test:utils`, and
  production build passed.
- Docker release image `business-os:v6.0.0-202606031954` is healthy on
  `http://127.0.0.1:4000/health` with frontend hash `05d5d4b5fb849663`.
- Focused Server route-load trace passed at 30 requests, 2 API requests, and
  zero failures:
  `ops/runtime/reports/route-load-trace-2026-06-03T11-57-06-358Z.json`.
- Focused public catalog route-load trace passed at 23 requests, 1 API
  request, and zero failures:
  `ops/runtime/reports/route-load-trace-2026-06-03T11-40-35-980Z.json`.
- Broad Phase 8.4 UI live check passed with `publicPortalBootstrapStatus: 200`,
  `serverBootstrapStatus: 200`, and zero relevant console messages:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T11-58-20-197Z/report.json`.
- Public Cloudflare portal check passed after clicking the Assistant tab, with
  20 rendered products, deferred AI status, and no relevant console/page
  errors:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T11-59-08-126Z/report.json`.
- Focused Contacts desktop/mobile control audit passed with 23 tested controls
  and zero failures.
- Focused Backup/Files/Users/Server control audit passed with 50 tested
  controls and zero failures.
- Focused Branches/Products/POS/Inventory/Server control audit passed with 144
  tested controls and zero failures.
- Prior focused Products/POS/Inventory/Server control audit passed with 123 tested
  controls and zero failures.
- Exhaustive desktop/mobile all-pages control audit passed with 369 tested
  controls and zero failures.
- Prior public Cloudflare portal check passed with 20 rendered products and no
  relevant console/page errors.

## 2026-05-31

### Accepted

- Backend source JavaScript elimination
  - area: `backend/src/services/importJobs.ts`
  - result: kept
  - note: final `backend/src` JavaScript file was renamed to a package-safe
    TypeScript path with explicit runtime/test imports, source-load proof,
    focused import tests, schema audit, language audit, and Linux packaging
    proof

### Follow-up

- Backend package compile/staging lane
  - area: `backend/package.json`
  - result: kept
  - note: backend release packaging now uses `backend/.pkg-stage` generated by
    `ops/scripts/backend/build-package-stage.ts`, so `pkg` receives staged
    JavaScript files while live source remains TypeScript

## 2026-05-16

### Accepted

- Notification summary server-side cache
  - area: `backend/src/routes/notifications.ts`
  - result: kept
  - note: `/api/notifications/summary` now reuses a short-lived cache keyed by
    effective access and preferences, which removed the shared inventory-side
    summary pressure from the warm baseline

- Inventory filter tab-scoping cleanup
  - route: `inventory`
  - result: kept
  - note: product-tab filter sections were split away from movement-only state,
    and admin user loading now waits until the Movements tab is active

- Public catalog hidden secondary-tab render removal
  - route: `public_catalog`
  - result: kept
  - note: kept chunk preloading, but stopped rendering hidden primed secondary
    tab panels after idle warmup

- Products orphaned reveal-state cleanup
  - route: `products`
  - result: kept
  - note: removed an unused post-load desktop reveal state/effect that no longer
    affected the list surface but still forced an extra rerender

- Returns lazy filter sections
  - route: `returns`
  - result: kept
  - note: stopped building filter section data while the menu is closed

- Import tracker settled-list cache
  - area: `backend/src/services/importJobs.ts`
  - result: kept
  - note: repeated dashboard/import tracker polling now reuses short-lived
    settled job lists

### Rejected

- Branches delayed action-history hydration
  - area: `frontend/src/components/branches/Branches.tsx`
  - result: rejected
  - note: copied the delayed history pattern from Customers, but desktop
    Branches document time got much worse in the real route audit

- Notification-center delayed summary fetch
  - area: `frontend/src/components/shared/NotificationCenter.tsx`
  - result: rejected
  - note: looked like a shared-background win, but Products route timing
    regressed once it was validated live

- Returns cached display-field reuse
  - area: `frontend/src/components/returns/Returns.tsx`
  - result: rejected
  - note: precomputing row display fields did not survive warm reruns and made
    Returns slower

- Returns global mobile deferred-card threshold
  - area: `frontend/src/components/returns/ReturnsListSurface.tsx`
  - result: rejected
  - note: making the mobile deferred-card threshold global across groups made
    both desktop and mobile Returns slower in the real route audit

- Products orphaned load-promise bookkeeping removal
  - area: `frontend/src/components/products/Products.tsx`
  - result: rejected
  - note: looked like dead bookkeeping, but real route timings regressed once
    the verify worktree runtime was recreated correctly

- Backup version hard timeout fallback
  - area: `backend/src/services/backupPackages.ts`
  - result: rejected
  - note: targeted backup API improved, but warm exhaustive reruns woke
    unrelated pockets

- Mobile public-catalog background panel unmounting
  - area: `frontend/src/components/catalog/CatalogPage.tsx`
  - result: rejected
  - note: route-only win, but warm whole-app reruns drifted into unrelated
    findings

## 2026-05-15

### Accepted

- Products route now reuses grouped sections instead of rebuilding them twice.
- Products filter sections now build only when the menu opens.
- Dashboard KPI detail models were memoized.
- Backup version listings reuse cached assembled results.
- Backup version route wait time was bounded.
- POS global filter metadata now waits until Filters opens.
- Dashboard export helpers now load on demand.

### Rejected

- Several productGrouping helper cache passes
- Products export-menu hidden-work deferral
- App shell startup page initialization from URL
- Action-history hydration deferral for Products

Common reason:

- route-level improvement did not hold the warm whole-app gate

## Session Template

Use this shape for future entries:

- change:
- affected files:
- route or API target:
- keeper or rollback:
- route-scoped result:
- warm whole-app result:
- follow-up insight:

## 2026-05-29

### Accepted

- change: converted sales export/import and inventory import modal cluster to
  TSX with typed API, worker, queued-result, date, and CSV fallback boundaries
- affected files: `frontend/src/components/sales/ExportModal.tsx`,
  `frontend/src/components/sales/SalesImportModal.tsx`,
  `frontend/src/components/inventory/InventoryImportModal.tsx`
- route or API target: sales export, sales CSV import, inventory CSV import
- keeper or rollback: keeper if typecheck, focused import/export tests, build,
  Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: pending verification in Move 509
- warm whole-app result: pending verification in Move 509
- follow-up insight: this cluster is a good pattern for the remaining modal
  conversions because it keeps `window.api` access behind local typed accessors
  while preserving extensionless lazy imports.

- change: converted the customer form and shared contact table/menu helpers to
  TSX with typed form, option, selection, menu, and pagination boundaries
- affected files: `frontend/src/components/contacts/CustomerFormModal.tsx`,
  `frontend/src/components/contacts/shared.tsx`,
  `frontend/src/components/contacts/CustomersTab.tsx`
- route or API target: Contacts customer form, shared customer/supplier/delivery
  table and row actions
- keeper or rollback: keeper if contact pricing/loading tests, typecheck,
  build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: pending verification in Move 510
- warm whole-app result: pending verification in Move 510
- follow-up insight: shared contact helpers are now ready for the larger
  Customers/Suppliers/Delivery tab TSX conversions without exact `.jsx` modal
  imports.

- change: converted the Contacts route shell to TSX with typed tab, import,
  lazy-module, app-context, and export API boundaries
- affected files: `frontend/src/components/contacts/Contacts.tsx`,
  `frontend/src/types/jsx-modules.d.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Contacts page shell, all-contact export, import picker,
  customer/supplier/delivery tab loading
- keeper or rollback: keeper if loading UX tests, contact pricing/action
  stability tests, typecheck, build, Phase 29 audit, and Phase 8.4 live suite
  pass
- route-scoped result: pending verification in Move 511
- warm whole-app result: pending verification in Move 511
- follow-up insight: the remaining customer/supplier/delivery tab `.jsx`
  conversions can now use the same explicit JSX-module seam instead of
  widening global `any` types.

- change: converted the contact import modal to TSX with typed import config,
  CSV worker, file-picker, API, and queued-result boundaries
- affected files: `frontend/src/components/contacts/ContactImportModal.tsx`,
  `frontend/src/components/contacts/Contacts.tsx`,
  `frontend/src/components/contacts/CustomersTab.tsx`,
  `frontend/src/components/contacts/SuppliersTab.tsx`,
  `frontend/src/components/contacts/DeliveryTab.tsx`
- route or API target: Contacts CSV import, background import jobs, worker row
  counting, existing-file CSV selection
- keeper or rollback: keeper if import worker tests, CSV import tests,
  loading UX tests, action stability tests, typecheck, build, Phase 29 audit,
  and Phase 8.4 live suite pass
- route-scoped result: pending verification in Move 512
- warm whole-app result: pending verification in Move 512
- follow-up insight: the three remaining contact tab JSX files now import the
  modal extensionlessly, so each tab can be converted independently without
  exact `.jsx` modal coupling.

- change: converted the inventory product detail modal to TSX with typed
  product, branch stock, batch, formatter, translation, and stock-action
  boundaries
- affected files: `frontend/src/components/inventory/ProductDetailModal.tsx`,
  `frontend/vite.config.ts`, `ops/docs/whole-app-hardening.md`
- route or API target: Inventory product detail modal, stock action entrypoints,
  Vite product-detail manual chunking
- keeper or rollback: keeper if product discount UX, inventory mobile layout,
  typecheck, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 513 focused product discount, inventory
  mobile layout, typecheck, JSX, build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 513 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: this was a compact modal conversion and a useful check
  that manual chunk rules do not retain obsolete exact `.jsx` paths.

- change: converted the customer edit return modal to TSX with typed editable
  return rows, update payloads, return API access, quantity normalization, and
  unknown-safe conflict handling
- affected files: `frontend/src/components/returns/EditReturnModal.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Returns customer edit modal, customer return update
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 514 action stability, performance
  loading UX, typecheck, JSX, frontend/backend utility, build, Phase 29, and
  schema/reference checks
- warm whole-app result: passed in Move 514 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: this modal now uses the same local typed API accessor
  pattern as other converted write surfaces while preserving the synchronous
  submit guard.

- change: converted the navigation sidebar shell to TSX with typed app
  context, settings color/style overrides, user/profile fields, nav items,
  Lucide icon mapping, and page intent events
- affected files: `frontend/src/components/navigation/Sidebar.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/frontend/verify-performance.ts`
- route or API target: app shell navigation, desktop sidebar, mobile header,
  mobile bottom bar, more drawer, route chunk warmup
- keeper or rollback: keeper if performance loading UX, frontend performance
  verifier, typecheck, JSX, frontend/backend utility, build, Phase 29 audit,
  and Phase 8.4 live suite pass
- route-scoped result: passed in Move 515 performance loading UX, frontend
  performance verifier, typecheck, JSX, frontend/backend utility, build, Phase
  29, and schema/reference checks
- warm whole-app result: passed in Move 515 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: the nav shell now has a typed icon fallback so future nav
  ids cannot render an undefined icon component during settings/order changes.

- change: converted the sales detail modal to TSX with typed sale details,
  parsed line items, status/membership callbacks, formatter callbacks, and
  numeric total/quantity normalization
- affected files: `frontend/src/components/sales/SaleDetailModal.tsx`
- route or API target: Sales detail modal, print action, status update,
  membership attach, totals and line-item rendering
- keeper or rollback: keeper if performance loading UX, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 516 performance loading UX, typecheck,
  JSX, frontend/backend utility, build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 516 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: line item math is now normalized through a single number
  coercion helper, which is safer for mixed string/number API payloads.

- change: converted the files AI providers tab to TSX with typed provider
  rows, provider metadata, form state, label text, and provider action
  callbacks
- affected files: `frontend/src/components/files/FilesProvidersTab.tsx`,
  `frontend/src/components/files/FilesPage.tsx`,
  `frontend/tests/actionStability.test.ts`
- route or API target: Library AI providers tab, provider create/update/test
  and delete controls
- keeper or rollback: keeper if action stability, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 517 action stability, typecheck, JSX,
  frontend/backend utility, build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 517 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: this tab is now a typed boundary for provider metadata
  defaults before the larger library page shell is converted.

- change: converted the returns list surface to TSX with typed return records,
  grouped sections, selection scopes, checkbox refs, deferred styles, amount
  rendering, and detail callbacks
- affected files: `frontend/src/components/returns/ReturnsListSurface.tsx`,
  `frontend/tests/returnsLayout.test.ts`
- route or API target: Returns desktop table, mobile card list, grouped
  selection and collapse controls
- keeper or rollback: keeper if returns layout, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 518 returns layout, typecheck, JSX,
  frontend/backend utility, build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 518 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: return row grouping now has an explicit typed boundary,
  which makes the larger Returns route conversion less risky.

- change: converted the sales list surface to TSX with typed sale rows, item
  arrays, grouped sections, selection scopes, checkbox refs, formatters, branch
  labels, status rendering, detail callbacks, and reprint callbacks
- affected files: `frontend/src/components/sales/SalesListSurface.tsx`
- route or API target: Sales desktop table, mobile card list, grouped
  selection and collapse controls, receipt reprint entry
- keeper or rollback: keeper if action stability, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 519 action stability, typecheck, JSX,
  frontend/backend utility, build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 519 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: sales grouping now has the same typed list boundary as
  returns, which reduces risk before converting the larger Sales route shell.

- change: converted the supplier return modal to TSX with typed branch,
  supplier, inventory product, settlement, selected item, app user, formatter,
  notification, and API boundaries
- affected files: `frontend/src/components/returns/NewSupplierReturnModal.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/whole-app-hardening.md`
- route or API target: Supplier return modal, setup/inventory reads, supplier
  return create write, returns/inventory/products sync events
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: passed in Move 520 action stability, performance
  loading UX, typecheck, JSX, frontend/backend utility, build, Phase 29, and
  schema/reference checks
- warm whole-app result: passed in Move 520 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: supplier-return payload construction now goes through a
  typed API helper, making future Returns route conversion safer.

- change: converted the customer return modal to TSX with typed sale, sale
  item, selected return item, previous-return, create payload, app user,
  formatter, notification, and API boundaries
- affected files: `frontend/src/components/returns/NewReturnModal.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/whole-app-hardening.md`
- route or API target: Customer return modal, sale search, return history
  lookup, return create write, returns/inventory/sales sync events
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: passed in Move 521 action stability, performance
  loading UX, typecheck, JSX, frontend/backend utility, build, Phase 29, and
  schema/reference checks
- warm whole-app result: passed in Move 521 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: the customer and supplier return create flows now both
  use explicit typed API helpers, reducing risk before the larger Returns page
  shell conversion.

- change: converted the receipt overlay to TSX with typed sale payload, line
  item, settings, language mode, export mode, row prop, section map,
  app-context, and receipt export boundaries
- affected files: `frontend/src/components/receipt/Receipt.tsx`,
  `frontend/src/components/receipt-settings/ReceiptPreview.tsx`,
  `frontend/tests/receiptTemplate.test.ts`,
  `frontend/tests/receiptSettingsSync.test.ts`
- route or API target: POS and Sales receipt overlays, Receipt Settings
  preview, PDF/print/image receipt export actions
- keeper or rollback: keeper if receipt template tests, receipt settings sync,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: passed in Move 522 receipt template, receipt settings
  sync, performance loading UX, typecheck, JSX, frontend/backend utility,
  build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 522 Phase 8.4 live UI suite with zero
  relevant console messages; public Cloudflare remained skipped for the known
  tunnel failure
- follow-up insight: the receipt overlay no longer relies on implicit JSX
  arithmetic for totals and export modes, reducing risk before converting the
  larger Receipt Settings page shell.

- change: converted the receipt settings page to TSX with typed template
  state, app-context settings, save/load callbacks, notification callbacks,
  auto-save queue options, section ids, preview refs, and local section/toggle
  props
- affected files:
  `frontend/src/components/receipt-settings/ReceiptSettings.tsx`,
  `frontend/src/components/receipt-settings/ReceiptPreview.tsx`,
  `frontend/tests/receiptSettingsSync.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Receipt Settings page, settings save/load API,
  receipt preview, print settings panel, field/order/all-fields controls
- keeper or rollback: keeper if receipt settings sync, receipt template,
  performance loading UX, typecheck, JSX, frontend/backend utility, build,
  Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 523 receipt settings sync, receipt
  template, performance loading UX, typecheck, JSX, frontend/backend utility,
  build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 523 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 13,201,004
  bytes of old runtime reports, kept latest local backups, kept latest R2
  backup metadata, and pruned no Docker volumes or images
- follow-up insight: Receipt Settings now has typed save queue and preview
  boundaries, reducing risk before converting the remaining settings/ops pages.

- change: converted the custom tables page to TSX with typed table metadata,
  dynamic schemas, row payloads, app/sync context, custom-table API calls, row
  modal state, delete ids, history result ids, and display/input coercion
- affected files: `frontend/src/components/custom-tables/CustomTables.tsx`,
  `frontend/tests/actionStability.test.ts`
- route or API target: Custom Tables page, `/api/custom-tables`, custom table
  row create/update/delete, row undo/redo history
- keeper or rollback: keeper if action stability, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 524 action stability, typecheck, JSX,
  frontend/backend utility, build, Phase 29, and schema/reference checks
- warm whole-app result: passed in Move 524 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 220,327
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, and pruned no Docker volumes or images
- follow-up insight: arbitrary custom-table row data now crosses a typed
  `Record<string, unknown>` boundary, which is the right shape for this dynamic
  schema area without overpromising static knowledge of user-created columns.

- change: converted the catalog products section to TSX with typed portal copy
  helpers, local/server product paging, initial filter options,
  category/brand/branch/stock filter state, preview config flags, promotion
  cards, stock/price helpers, metadata chips, gallery callbacks, highlight
  badges, and pagination callbacks
- affected files: `frontend/src/components/catalog/CatalogProductsSection.tsx`,
  `frontend/vite.config.ts`, `ops/scripts/frontend/verify-ui.ts`
- route or API target: Customer Portal products tab, catalog-preview chunk,
  customer-safe product cards, promotion cards, product gallery entry points
- keeper or rollback: keeper if portal catalog display tests, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 525 portal catalog display, UI verifier,
  typecheck, JSX, frontend/backend utility, build, Phase 29, organization,
  schema, and reference checks
- warm whole-app result: passed in Move 525 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 219,952
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, and pruned no Docker volumes or images
- follow-up insight: the portal product list now has a typed boundary for both
  server-paged and local-paged modes, which reduces risk before converting the
  larger customer-facing catalog page shell.

- change: converted the inventory products surface to TSX with typed product
  rows, branch stock chips, grouped sections, group summary callbacks, stock
  quantity callbacks, selection scopes, injected discount/batch preview
  components, formatter/translator functions, detail/adjust callbacks, and
  loading/reveal gates
- affected files:
  `frontend/src/components/inventory/InventoryProductsSurface.tsx`,
  `frontend/tests/inventoryMobileCardLayout.test.ts`
- route or API target: Inventory products section, grouped desktop inventory
  table, compact mobile inventory product cards, selection and adjust actions
- keeper or rollback: keeper if inventory mobile-card layout, inventory
  movement groups, typecheck, JSX, frontend/backend utility, build, Phase 29
  audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 526 inventory mobile-card layout,
  inventory movement groups, UI verifier, typecheck, JSX, frontend/backend
  utility, build, Phase 29, organization, schema, and reference checks
- warm whole-app result: passed in Move 526 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 220,179
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, and pruned no Docker volumes or images
- follow-up insight: the inventory product card/table boundary now documents
  the shared row shape before the larger Inventory shell conversion, reducing
  the risk of losing mobile compactness or branch-stock detail in later moves.

- change: converted the inventory movements surface to TSX with typed movement
  records, grouped movement sections, action groups, expanded page state,
  movement metadata, selected ids, action history, export items, date filters,
  selection scope callbacks, product detail callbacks, and injected pagination
  controls
- affected files:
  `frontend/src/components/inventory/InventoryMovementsSurface.tsx`,
  `frontend/tests/inventoryRfidSection.test.ts`
- route or API target: Inventory movements section, grouped movement history,
  movement selection/export, custom date range filter, movement product detail
  links
- keeper or rollback: keeper if inventory RFID section, inventory movement
  groups, typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and
  Phase 8.4 live suite pass
- route-scoped result: passed in Move 527 inventory RFID section, inventory
  movement groups, UI verifier, typecheck, JSX, frontend/backend utility,
  build, Phase 29, organization, schema, and reference checks
- warm whole-app result: passed in Move 527 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 220,307
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, and pruned no Docker volumes or images
- follow-up insight: movement grouping now has a typed UI boundary around the
  section/action/group nesting, which reduces risk before converting the large
  Inventory shell that assembles those structures.

- change: converted the loyalty points page to TSX with typed loyalty settings
  form state, USD/KHR basis state, section ids, app-context save/notify/format
  callbacks, local loyalty API access, customer point rows, membership lookup
  result totals, error messages, and numeric policy coercion helpers
- affected files:
  `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`,
  `frontend/src/types/jsx-modules.d.ts`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/sectionNavigation.test.ts`
- route or API target: Loyalty Points page, point-rule save, customer point
  leaderboard, membership lookup, policy preview, section persistence, loading
  watchdog retry path
- keeper or rollback: keeper if action stability, performance loading UX,
  section navigation, typecheck, JSX, frontend/backend utility, build, Phase 29
  audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 528 action stability, performance loading
  UX, section navigation, UI verifier, typecheck, JSX, frontend/backend
  utility, build, Phase 29, organization, schema, and reference checks
- warm whole-app result: passed in Move 528 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 220,067
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, pruned no Docker containers/cache bytes, and the
  post-prune Phase 29 repeat audit passed
- follow-up insight: the loyalty page now has a typed boundary around settings,
  customer lookup, and point-balance display before the broader AppContext and
  remaining route shells are converted.

- change: converted the sync server page to TSX with typed app-context access,
  local copy fallbacks, connection-info props, diagnostics tab ids, client and
  server log rows, write-error events, pending sync queue state, system debug
  payloads, security config, connection test results, and typed server API
  gateway calls
- affected files:
  `frontend/src/components/server/ServerPage.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/offlineSalesQueue.test.ts`,
  `frontend/tests/offlineSecurityHardening.test.ts`
- route or API target: Sync Server page, diagnostics tabs, pending sync queue,
  retry/discard queue actions, connection test, system config/debug reads,
  offline security and sync-center messaging
- keeper or rollback: keeper if action stability, performance loading UX,
  offline sales queue, offline security hardening, typecheck, JSX,
  frontend/backend utility, build, Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 529 action stability, performance loading
  UX, offline sales queue, offline security hardening, UI verifier, typecheck,
  JSX, frontend/backend utility, build, Phase 29, organization, schema, and
  reference checks
- warm whole-app result: passed in Move 529 Phase 8.4 live UI suite with 72
  checked UI signals and zero relevant console messages; public Cloudflare
  remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 219,923
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, pruned no Docker containers/cache bytes, and the
  post-prune Phase 29 repeat audit passed
- follow-up insight: sync-server connection and queue diagnostics now have a
  typed UI boundary, which reduces risk before larger App/AppContext conversion
  slices touch the same websocket and offline-write pathways.

- change: converted the returns page shell to TSX with typed return rows,
  return line-item snapshots, history restore payloads, mutation result
  payloads, app/sync context access, local return API gateway calls, selection
  ids, grouped return sections, filter/group/sort state, watchdog timers, and
  export/stat calculations
- affected files:
  `frontend/src/components/returns/Returns.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/returnsLayout.test.ts`
- route or API target: Returns page, return list/detail/snapshot/restore
  reads/writes, customer/supplier summary stats, grouped selection, export
  menu, history undo/redo restore
- keeper or rollback: keeper if action stability, performance loading UX,
  returns layout, typecheck, JSX, frontend/backend utility, build, Phase 29
  audit, and Phase 8.4 live suite pass
- route-scoped result: passed in Move 530 returns layout, action stability,
  performance loading UX, UI verifier, typecheck, JSX, frontend/backend
  utility, build, Phase 29, organization, schema, and reference checks
- warm whole-app result: passed in Move 530 Phase 8.4 live UI suite with 72
  checked UI signals, zero relevant console messages, and no framework overlay;
  public Cloudflare remained skipped for the known tunnel failure
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed 219,973
  bytes from one old Phase 8.4 runtime report, kept latest local backups and
  latest R2 backup metadata, pruned no Docker containers/cache bytes, and the
  post-prune Phase 29 repeat audit passed
- follow-up insight: the Returns route shell now has a typed local API and
  snapshot-history boundary, reducing risk before converting the larger
  Dashboard, Inventory, and App/AppContext route shells.

- change: converted the customers contact tab to TSX with typed customer rows,
  section rows, modal state, app/sync context, local customer API gateway
  calls, mutation result payloads, exported contact-option helpers, grouped
  filters, loading watchdog timers, undo/redo history payloads, and bulk
  restore bookkeeping
- affected files:
  `frontend/src/components/contacts/CustomersTab.tsx`,
  `frontend/src/components/contacts/Contacts.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/pricingContacts.test.ts`
- route or API target: Contacts customers tab, customer list with point
  balances, customer create/update/delete, bulk delete/restore, contact option
  parsing, POS contact option import contract
- keeper or rollback: keeper if action stability, performance loading UX,
  pricing/contact helpers, typecheck, JSX, frontend/backend utility, build,
  Phase 29 audit, and Phase 8.4 live suite pass
- route-scoped result: focused typecheck, JSX, action stability, performance
  loading UX, and pricing/contact checks passed; broad frontend/backend utility
  suites, UI audit, production build, organization audit, schema audit, and
  Phase 29 repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,046 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: customer contacts now have typed list/mutation/history
  boundaries, reducing risk before converting supplier and delivery contact
  tabs with the same pattern.

- change: converted the sales page shell to TSX with typed sale rows, line
  items, user filter options, app/sync context access, local sales API gateway
  calls, status and membership mutation payloads, grouped sale sections,
  selection ids, export rows, loading watchdog timers, and action-history
  payloads
- affected files:
  `frontend/src/components/sales/Sales.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Sales page, sales list loading, user filter loading,
  sale status updates, sale membership linking, grouped selection, receipt
  print handoff, export/import modal handoff
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: focused typecheck, JSX, action stability, and
  performance loading UX checks passed; broad frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, and Phase 29
  repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,086 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Sales now has a typed local API and selection/mutation
  boundary, reducing risk before converting supplier/delivery contacts and the
  larger POS/Inventory shells.

- change: converted the delivery contact tab to TSX with typed delivery rows,
  section rows, modal state, contact-option form payloads, app/sync context,
  local delivery API gateway calls, mutation result payloads, grouped filters,
  loading watchdog timers, undo/redo history payloads, and bulk restore
  bookkeeping
- affected files:
  `frontend/src/components/contacts/DeliveryTab.tsx`,
  `frontend/src/components/contacts/Contacts.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Contacts delivery tab, delivery contact loading,
  delivery create/update/delete, bulk delete/restore, delivery contact option
  parsing, import modal refresh handoff, grouped selection
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: focused typecheck, JSX, action stability, and
  performance loading UX checks passed; broad frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, and Phase 29
  repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,137 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: delivery contacts now have typed local API and
  option/history boundaries, leaving supplier contacts as the next contact-tab
  JSX conversion candidate.

- change: converted the suppliers contact tab to TSX with typed supplier rows,
  section rows, modal state, contact-option form payloads, app/sync context,
  local supplier API gateway calls, mutation result payloads, grouped filters,
  loading watchdog timers, undo/redo history payloads, and bulk restore
  bookkeeping
- affected files:
  `frontend/src/components/contacts/SuppliersTab.tsx`,
  `frontend/src/components/contacts/Contacts.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Contacts suppliers tab, supplier loading, supplier
  create/update/delete, bulk delete/restore, supplier contact option parsing,
  import modal refresh handoff, grouped selection
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: focused typecheck, JSX, action stability, and
  performance loading UX checks passed; broad frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, and Phase 29
  repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,033 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: all Contacts secondary tabs are now TSX; the next useful
  conversion target is a larger route shell such as Branches, Files, or POS.

- change: converted the branches page shell to TSX with typed branch rows,
  summary payloads, branch stock pages, transfer history rows, tab/modal
  state, app/sync context, local branch API gateway calls, mutation result
  payloads, loading watchdog timers, stat detail payloads, and bulk restore
  bookkeeping
- affected files:
  `frontend/src/components/branches/Branches.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Branches list, branch summary, branch stock expansion,
  stock pagination, transfer history, branch create/update/delete, bulk
  delete/restore, transfer modal handoff, grouped stat details
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: focused typecheck, JSX, action stability, and
  performance loading UX checks passed; broad frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, and Phase 29
  repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 219,984 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Branches now has a typed local API and stock/transfer
  boundary; Files, Login, and Catalog secondary tabs remain the next smaller
  JSX route candidates before POS/Products/Dashboard/Inventory.

- change: converted the files/library page shell to TSX with typed file
  assets, paged file responses, AI provider metadata, provider forms, provider
  mutation/test result payloads, saved AI responses, tab state, selected asset
  ids, app/sync context, local files API gateway calls, loading request guards,
  upload/delete guards, and provider action guards
- affected files:
  `frontend/src/components/files/FilesPage.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Library assets list, asset upload/delete, bulk asset
  delete, AI provider list/create/update/delete/test, provider undo/redo,
  saved AI responses, child tab handoffs
- keeper or rollback: keeper if action stability, performance loading UX,
  typecheck, JSX, frontend/backend utility, build, Phase 29 audit, and Phase
  8.4 live suite pass
- route-scoped result: focused typecheck, JSX, action stability, and
  performance loading UX checks passed; broad frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, and Phase 29
  repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,072 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Library now has a typed local API and upload/provider
  boundary; Login, Catalog secondary tabs, and Users remain the next smaller
  JSX conversion candidates.

- change: converted the login/auth shell to TSX with typed auth users, login
  result payloads, OAuth callback payloads, organization matches, verification
  capability payloads, password reset responses, app context access, local
  auth API gateway calls, OTP pending user ids, DOM refs, form submit events,
  OAuth provider state, and error extraction
- affected files:
  `frontend/src/components/auth/Login.tsx`,
  `frontend/tests/ownedGoogleAuth.test.ts`
- route or API target: Login, organization bootstrap/search, Google OAuth
  sign-in, OTP verification, OTP password reset, email password reset,
  recovery callback completion, session duration persistence
- keeper or rollback: keeper; owned Google auth, typecheck, JSX, frontend and
  backend utility suites, UI audit, production build, organization audit,
  schema audit, Phase 29 repeat audit, and Phase 8.4 live suite passed
- route-scoped result: focused typecheck, JSX, and owned Google auth checks
  passed; broad frontend/backend utility suites, UI audit, production build,
  organization audit, schema audit, and Phase 29 repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,016 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and retained Docker
  volumes/images as protected data/runtime assets
- follow-up insight: Login now has a typed auth boundary; Catalog secondary
  tabs and Users remain smaller JSX conversion candidates before POS,
  Products, Dashboard, and Inventory.

- change: converted the catalog secondary tabs shell to TSX with typed portal
  copy functions, preview config, membership customer/points/totals,
  purchase/return rows, share submission rows, submission draft state,
  business facts, social links, about blocks, FAQ items, assistant profile,
  usage policy, assistant references, assistant recommendations, and
  tab-dispatch props
- affected files:
  `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`,
  `frontend/vite.config.ts`,
  `ops/scripts/frontend/verify-ui.ts`
- route or API target: customer portal membership lookup, About, FAQ, and AI
  assistant tab surfaces plus catalog preview chunk assignment
- keeper or rollback: keeper; typecheck, JSX, UI audit, frontend/backend
  utility suites, production build, organization audit, schema audit, Phase
  29 repeat audit, and Phase 8.4 live suite passed
- route-scoped result: focused typecheck, JSX, and UI audit checks passed;
  broad frontend/backend utility suites, production build, organization
  audit, schema audit, and Phase 29 repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,226 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and retained Docker
  volumes/images as protected data/runtime assets
- follow-up insight: Catalog secondary tabs now have typed customer portal
  payloads; Users remains the next smaller JSX conversion candidate before
  POS, Products, Dashboard, and Inventory.

- change: converted the users administration shell to TSX with typed user
  rows, role rows, user/role/password form state, app/sync context access,
  local users API gateway calls, mutation result payloads, modal/tab state,
  loading watchdog timers, permission maps, and undo/redo payload construction
- affected files:
  `frontend/src/components/users/Users.tsx`,
  `frontend/src/components/users/UserDetailSheet.tsx`,
  `frontend/src/utils/actionHistory.ts`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Users and Roles administration, profile modal handoff,
  user detail sheet handoff, password reset, role create/update/delete, and
  user/role undo-redo actions
- keeper or rollback: keeper; focused typecheck, JSX, action stability,
  performance loading UX, frontend/backend utility suites, UI audit,
  production build, organization audit, schema audit, Phase 29 repeat audit,
  and Phase 8.4 live suite passed
- route-scoped result: focused typecheck, JSX, action stability, and
  performance loading UX checks passed; broad frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, generated
  reference refresh, and Phase 29 repeat audit also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `a59e1ee721a5d5bc`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 219,989 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Users now has a typed admin boundary; User Profile Modal
  remains the next users-folder JSX target before the larger POS, Products,
  Dashboard, and Inventory shells.

- change: converted the user profile modal to TSX with typed profile user
  rows, settings, verification capability payloads, sign-in method state,
  profile mutation results, app context access, local profile API gateway
  calls, avatar editor props, file-input events, OTP modal mode, active section
  state, and stored organization fallback parsing
- affected files:
  `frontend/src/components/users/UserProfileModal.tsx`,
  `frontend/src/components/navigation/Sidebar.tsx`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/adminShellMediaGuards.test.ts`,
  `frontend/tests/ownedGoogleAuth.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/frontend/verify-performance.ts`
- route or API target: self-service profile, avatar crop/upload, OTP refresh,
  Google OAuth link/unlink, password update, session-duration save, and
  sign-out surfaces
- keeper or rollback: keeper; focused typecheck, JSX, action stability,
  performance loading UX, media guard, owned Google auth, performance
  verifier, frontend/backend utility suites, UI audit, production build,
  organization audit, schema audit, generated reference refresh, Phase 29
  repeat audit, Phase 8.4 live suite, and prune checks passed
- route-scoped result: focused source and type gates passed; broad
  frontend/backend utility suites, UI audit, production build, organization
  audit, schema audit, generated reference refresh, and pre/post-prune Phase
  29 repeat audits also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `678282931a4c4696`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T01-28-37-946Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,177 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: The users folder no longer needs a profile modal shim;
  the remaining larger JSX shells are POS, Products, Dashboard, Inventory,
  Catalog page/editor, and utils-settings pages.

- change: converted the audit log shell to TSX with typed audit rows, paged
  audit responses, audit user filter rows, local audit API gateway calls, app
  context access, detail-row props, export items, selected id sets, grouped
  section ids, sort/group modes, loader watchdog refs, animation frame refs,
  and error extraction
- affected files:
  `frontend/src/components/utils-settings/AuditLog.tsx`,
  `frontend/src/components/utils-settings/index.ts`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/utilsSettingsBarrel.test.ts`
- route or API target: Audit Log read/search/filter/group/export, row detail
  modal, bulk selection, refresh, and admin retention cleanup surfaces
- keeper or rollback: keeper; focused typecheck, JSX, utils-settings barrel,
  action stability, performance loading UX, frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, generated
  reference refresh, Phase 29 repeat audit, Phase 8.4 live suite, and prune
  checks passed
- route-scoped result: focused TSX source checks passed; broad
  frontend/backend utility suites, UI audit, production build, organization
  audit, schema audit, generated reference refresh, and pre/post-prune Phase
  29 repeat audits also passed
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `5b0200961bed11da`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T01-46-20-552Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,152 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Audit Log is the first utils-settings page shell moved to
  TSX; Backup and Settings remain the next bounded utils-settings conversion
  candidates before POS, Products, Dashboard, Inventory, and Catalog.

- change: converted the backup shell to TSX with typed backup jobs, job
  metrics/results, integration doctor payloads, Google Drive sync
  status/forms, app context access, action-history rows, local backup API
  gateway calls, section ids, action locks, retry timers, job watcher
  handlers, overview cards, and backup/Drive button props
- affected files:
  `frontend/src/components/utils-settings/Backup.tsx`,
  `frontend/src/components/utils-settings/index.ts`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/backupJobs.test.ts`,
  `frontend/tests/ownedGoogleAuth.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/sectionNavigation.test.ts`,
  `frontend/tests/utilsSettingsBarrel.test.ts`,
  `ops/scripts/verification/verify-backup-reliability.ts`
- route or API target: Backup overview, integration doctor, queued backup
  export/restore, Google Drive sync preferences/connect/sync/disconnect/forget,
  cancellable system job polling, and action-history recording surfaces
- keeper or rollback: keeper; focused typecheck, JSX, utils-settings barrel,
  backup jobs, section navigation, performance loading UX, action stability,
  owned Google auth, backup reliability, frontend/backend utility suites, UI
  audit, production build, organization audit, schema audit, generated
  reference refresh, Phase 29 repeat audit, Phase 8.4 live suite, and prune
  checks passed
- route-scoped result: focused TSX source checks passed; broad
  frontend/backend utility suites, UI audit, production build, organization
  audit, schema audit, generated reference refresh, and pre/post-prune Phase
  29 repeat audits also passed. Direct backup `window.api` calls are now
  contained behind the typed `getBackupApi()` gateway.
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `016a61d39eff3e04`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T02-10-58-114Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,177 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Backup is the second utils-settings shell moved to TSX;
  Settings remains the next bounded utils-settings candidate before POS,
  Products, Dashboard, Inventory, and Catalog.

- change: converted the settings shell to TSX with typed settings records,
  app context access, local settings API gateway calls, OTP status reads,
  image upload payloads/progress, upload controller maps, conflict state,
  color swatches, navigation items, section ids, payment methods, and favicon
  sanitization
- affected files:
  `frontend/src/components/utils-settings/Settings.tsx`,
  `frontend/src/components/utils-settings/index.ts`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/adminShellMediaGuards.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/sectionNavigation.test.ts`,
  `frontend/tests/utilsSettingsBarrel.test.ts`
- route or API target: Settings business profile, appearance/navigation,
  security/OTP status, payment methods, app icon upload/preview, conflict
  resolution, and settings save surfaces
- keeper or rollback: keeper; focused typecheck, JSX, utils-settings barrel,
  section navigation, performance loading UX, action stability, admin media
  guard, settings conflict, settings refresh, frontend/backend utility suites,
  UI audit, production build, organization audit, schema audit, generated
  reference refresh, Phase 29 repeat audit, Phase 8.4 live suite, and prune
  checks passed
- route-scoped result: focused TSX source checks passed; source/test scans
  found no remaining old Settings JSX filename references in frontend
  source/tests or ops scripts and no `any` escape hatches in the converted
  Settings shell. Direct
  settings `window.api` calls are now contained behind the typed
  `getSettingsApi()` gateway.
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `5c7826c6be6c8641`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T02-32-02-184Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,131 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Settings is the third utils-settings shell moved to TSX;
  the remaining larger JSX shells are POS, Products, Dashboard, Inventory,
  Catalog page/editor, and App/AppContext.

- change: converted the dashboard shell to TSX with typed dashboard summary
  and analytics payloads, period/payment/branch/hour rows, product stock
  alerts, customer/product/sale detail rows, app/sync context access, range
  and granularity state, chart/top mode unions, KPI detail modal payloads,
  export dependency loading, and local dashboard API gateway calls
- affected files:
  `frontend/src/components/dashboard/Dashboard.tsx`,
  `frontend/tests/backupJobs.test.ts`,
  `frontend/tests/dashboardDataReliability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`
- route or API target: Dashboard KPI cards, revenue/profit/transaction
  analytics, stock alerts, sales/customer/product/hour detail modals,
  compact range/chart controls, CSV/report/package export, and inventory
  stock-alert handoff surfaces
- keeper or rollback: keeper; focused typecheck, JSX, dashboard reliability,
  performance loading UX, backup jobs, frontend utility suite, UI audit,
  production build, organization audit, schema audit, generated reference
  refresh, Phase 29 repeat audits, Phase 8.4 live suite, and prune checks
  passed
- route-scoped result: focused TSX source checks passed; source/test/script
  scans found no old Dashboard JSX filename references in frontend source,
  frontend tests, or ops scripts and no `any` escape hatches in the converted
  Dashboard shell. Direct dashboard `window.api` reads are now contained behind
  the typed `getDashboardApi()` gateway.
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `84dc0e2e87e5f5d0`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T02-58-54-887Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,232 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: Dashboard is now off the JSX backlog; the remaining JSX
  shells are Inventory, Products, POS, Catalog page/editor, App, and
  AppContext.

- change: converted the app shell to TSX with typed page ids, lazy route
  importers, app context access, notification payloads, sync/offline event
  details, pending-sync state, app-shell API calls, network-information reads,
  page-error boundary props/state, page slot props, route warmup loaders,
  timer/idle handles, scroll direction, and chunk recovery helpers
- affected files:
  `frontend/src/App.tsx`,
  `frontend/src/index.tsx`,
  `frontend/tests/appShellUtils.test.ts`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/offlineSalesQueue.test.ts`,
  `frontend/tests/offlineSecurityHardening.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/frontend/verify-performance.ts`
- route or API target: authenticated app shell routing, public catalog shell,
  lazy page chunk recovery, navigation intent warmup, mounted-page retention,
  global notification/sync banners, offline sale notices, app favicon shaping,
  and write-conflict modal loading
- keeper or rollback: keeper; focused app-shell/performance/offline/API tests,
  full frontend utility suite, JSX check, UI audit, performance verifier,
  production build, organization audit, schema audit, generated reference
  refresh, Phase 29 repeat audit, Phase 8.4 live suite, and prune checks passed
- route-scoped result: focused TSX source checks passed; source/test/script
  scans found no old App JSX filename references in frontend source, frontend
  tests, or ops scripts and no `any` escape hatches in the converted App shell.
  `index.tsx`, app-shell source tests, and performance verifier now point at
  `App.tsx`.
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `eb1887c5b4ad134b`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T03-19-10-774Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,278 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed
- follow-up insight: App is now off the JSX backlog; the remaining JSX shells
  are Inventory, Products, POS, Catalog page/editor, and AppContext.

- change: converted the app context provider to TSX with typed global
  settings, user/session/bootstrap payloads, notification and write-conflict
  state, sync-channel event details, storage helpers, translation packs,
  permission maps, app/sync context values, and a typed runtime API gateway
  for auth, settings, Google OAuth, session duration refreshes, public asset
  URL updates, and sync URL updates
- affected files:
  `frontend/src/AppContext.tsx`,
  `frontend/src/index.tsx`,
  AppContext consumers under `frontend/src/components/**`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/ownedGoogleAuth.test.ts`,
  `frontend/tests/receiptSettingsSync.test.ts`,
  `ops/scripts/verification/verify-runtime-deps.ts`
- route or API target: app bootstrap, session recovery, login/logout, Google
  OAuth link completion, settings load/save, receipt/settings refresh
  contracts, runtime mismatch recovery, websocket sync status, device-local UI
  settings, permissions, translation fallback, and sync URL/public asset URL
  setup
- keeper or rollback: keeper; frontend typecheck, JSX scan, full utility
  suite, UI audit, performance verifier, organization audit, schema audit,
  and production build passed before live-suite/reference refresh
- route-scoped result: source/test/script scans found no old AppContext JSX
  filename references in frontend source, frontend tests, or ops scripts and
  no `any`/suppression escape hatches in the converted AppContext provider.
  Remaining JSX shells are Inventory, Products, POS, Catalog page, and Catalog
  editor.
- warm whole-app result: Phase 8.4 live suite passed with 72 checked UI
  signals, no relevant console messages, no framework overlay, and the public
  Cloudflare check skipped for the known 530/1033 tunnel follow-up. The
  running app still served frontend hash `55cf7b8ef08a4b8d`; the fresh local
  production build hash is `842b12c2b2ef92e8`. Live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T03-45-26-211Z/report.json`.
- cleanup result: storage prune removed one old Phase 8.4 live-check report
  directory for 220,253 bytes, kept the latest R2 backup object, found no
  stopped Docker containers or builder cache to reclaim, and the post-prune
  Phase 29 repeat audit passed

- change: converted the POS shell to TSX with typed POS product rows, grouped
  product metadata, cart lines, open-order state, customer and delivery
  contacts, contact-option selection, membership lookup state, receipt queue
  entries, image lightbox state, app/sync context access, and a typed POS API
  gateway
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/src/components/pos/CartItem.tsx`,
  `frontend/src/components/pos/posCore.ts`,
  `frontend/tests/actionStability.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/productSearchPagination.test.ts`
- route or API target: POS catalog search/bootstrap, product family cards,
  customer and delivery quick-add, membership lookup, cart branch validation,
  checkout sale creation, product detail lightbox, and promotion/special price
  cart lines
- keeper or rollback: keeper; POS core tests, product search/pagination checks,
  action stability checks, performance loading UX checks, frontend typecheck,
  full frontend utility suite, JSX scan, and production build passed before
  reference refresh
- route-scoped result: source/test/script scans found no old POS JSX filename
  references in frontend source, frontend tests, or ops scripts and no
  `any`/suppression escape hatches in the converted POS shell. Remaining JSX
  shells are Inventory, Products, Catalog page, and Catalog editor.
- warm whole-app result: broad Phase 8.4 UI live suite passed with 72 checked
  signals, no relevant console messages, and no framework overlay. Post-live
  hygiene passed after elevated Docker access, with zero QA/generated cleanup
  matches and loaded dataset status. The public Cloudflare portal check still
  failed to render expected customer content, matching the known tunnel/public
  follow-up. The fresh local production build hash is `bd5c1f96afecd8fd`, and
  the live report is
  `ops/runtime/reports/phase84-ui-live-check-2026-05-30T04-15-34-032Z/report.json`.

- change: converted the catalog editor surface to TSX with typed catalog page
  context access, draft settings payloads, editor section tuples,
  recommended-product options, promotion/about/FAQ/review rows, upload state,
  preview config, drag/drop helpers, media picker/gallery callbacks, and review
  submission statuses
- affected files:
  `frontend/src/components/catalog/CatalogEditorSurface.tsx`,
  `frontend/src/components/catalog/CatalogPageContext.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/portalCatalogDisplay.test.ts`
- route or API target: customer portal editor display settings, recommended
  products, promotions, about blocks, FAQ, AI/provider settings, public link
  settings, business/contact/media settings, submission settings, and review
  queue actions
- keeper or rollback: keeper; catalog display/editor/content/language/translate
  tests, frontend typecheck, full frontend utility suite, JSX scan, and
  production build passed before reference refresh
- route-scoped result: source/test/script scans found no old catalog editor JSX
  filename references in frontend source or frontend tests and no
  `any`/suppression escape hatches in the converted editor surface. Remaining
  JSX shells are Inventory, Products, and Catalog page.
- warm whole-app result: fresh local production build hash is
  `756d985623fba5b1`. Live-suite rerun is pending for this move; the previous
  broad Phase 8.4 UI suite passed, and the public Cloudflare portal remains a
  known tunnel/public follow-up until remote rendering is repaired.

- change: split logged-out sign-in and bootstrap startup away from the heavy
  legacy API registry and offline database graph
- affected files:
  `frontend/src/web-api.ts`,
  `frontend/src/api/appBootstrapTransport.ts`,
  `frontend/src/api/methods.ts`,
  `frontend/src/AppContext.tsx`,
  `frontend/src/App.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/apiHttp.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: logged-out app shell, invalid-session bootstrap,
  sign-in verification capabilities, organization bootstrap/search, login,
  OTP, Google OAuth, session duration, and pending-sync/offline maintenance
  startup gates
- keeper or rollback: keeper; real Docker-served Playwright first-12-seconds
  network trace showed only `app-bootstrap-EfLFgo7i.js` and
  `app-auth-DD-QfBFn.js` among auth startup lazy chunks, with zero
  `app-api-methods`, `app-local-db`, `vendor-dexie`, `vendor-zxing`, catalog,
  file-picker, or profile-modal requests; relevant console count was zero and
  failed response count was zero
- warm whole-app result: frontend utility suite, backend utility suite,
  production build, built graph check, broad Phase 8.4 live suite, public
  Cloudflare portal check, post-live hygiene, exhaustive all-pages control
  audit, Phase 29 audit, generated references, and organization audit passed.
  Production build hash: `1a5804d05a4e008e`. Broad live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-01T15-57-09-334Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-01T16-00-02-450Z/report.json`.
  Exhaustive all-pages report:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T16-00-36-623Z/summary.json`.

- change: shrink authenticated Dashboard startup network and chunk load
- affected files:
  `frontend/src/App.tsx`,
  `frontend/src/api/appBootstrapTransport.ts`,
  `frontend/src/components/dashboard/Dashboard.tsx`,
  `frontend/src/components/shared/NotificationCenter.tsx`,
  `frontend/src/web-api.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: authenticated Dashboard startup, bootstrap fallback,
  Dashboard summary and analytics reads, notification bell lazy mount,
  background import tracker, pending-sync refresh, offline maintenance, and
  Dashboard export helper loading
- keeper or rollback: keeper; the change removes startup work rather than
  hiding loading states, and every deferred path still has an interaction or
  delayed background trigger
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/` on frontend hash `9b132859aa24909c`
  reduced the first 12 seconds from the earlier 34 JavaScript chunks and 5 app
  data/auth API calls to 12 JavaScript chunks and 3 app data/auth API calls,
  plus 3 expected health probes. The final trace loaded only
  entry/vendor/language, `app-api`, shell/shared/bootstrap, Dashboard,
  DonutChart, and formatters chunks; it had zero product/POS/inventory/catalog/
  file-picker/local-DB/import-tracker/notification-center requests, zero
  failed responses, and zero relevant console messages.
- warm whole-app result: focused performance loading guard, API HTTP guard,
  frontend typecheck, source guard, frontend utility suite, backend utility
  suite, production build, Docker live build sync, broad Phase 8.4 live suite,
  public Cloudflare portal check, exhaustive all-pages control audit, and
  exhaustive browser-action smoke passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-01T18-01-08-129Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-01T18-03-40-430Z/report.json`.
  Exhaustive all-pages report:
  `ops/runtime/reports/all-pages-control-audit-2026-06-01T17-28-30-123Z/summary.json`.

- change: deduplicate startup health probes
- affected files:
  `frontend/src/api/http.ts`,
  `frontend/src/AppContext.tsx`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: app-shell startup health, AppContext sync URL
  discovery, runtime version health payload checks, Cloudflare Access health
  redirects, and active background server health cadence
- keeper or rollback: keeper; this shares the same health result across
  startup callers instead of deleting the connection check
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/` on frontend hash `f29e8401e596bf6c`
  kept Dashboard startup at 12 JavaScript chunks with zero unwanted
  product/POS/inventory/catalog/file-picker/local-DB/import-tracker/
  notification-center requests. `/health` dropped from 3 probes to 1 in the
  first 12 seconds, while `/api/auth/bootstrap`, `/api/analytics`, and
  `/api/dashboard` remained HTTP 200. Failed responses and relevant console
  messages stayed at zero.
- warm whole-app result: API HTTP unit tests, performance loading guard,
  frontend typecheck, source guard, full frontend utility suite, production
  build, Docker live build sync, authenticated Playwright startup trace, broad
  Phase 8.4 live suite, public Cloudflare portal check, and post-live hygiene
  passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T00-04-26-857Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T00-05-06-334Z/report.json`.

- change: combine Dashboard startup summary and analytics reads
- affected files:
  `backend/src/routes/sales.ts`,
  `backend/test/routeContracts.test.ts`,
  `frontend/src/api/dashboardTransport.ts`,
  `frontend/src/components/dashboard/Dashboard.tsx`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/runtime/live-checks/phase84-ui-live-check.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: Dashboard first-load summary and analytics,
  Dashboard range analytics refresh, backend sales/dashboard route contracts,
  and Phase 8.4 live dashboard loader proof
- keeper or rollback: keeper; old `/api/dashboard` and `/api/analytics`
  remain available, while the first empty Dashboard render uses one combined
  protected read
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/dashboard` on frontend hash
  `435e572a3d2acfaf` observed three initial API/health responses total:
  `/health`, `/api/auth/bootstrap`, and one `/api/dashboard/startup`, all HTTP
  200. Initial `/api/dashboard` and `/api/analytics` calls were zero. Pressing
  `7 Days` produced exactly one `/api/analytics` response and zero summary
  refetches. Failed responses and relevant console messages stayed at zero.
- warm whole-app result: backend route contract test, API HTTP guard,
  performance loading guard, frontend typecheck, backend utility suite,
  frontend utility suite, production build, generated runtime route sync,
  broad Phase 8.4 UI live check, public Cloudflare portal check, and
  post-live hygiene passed. The first public Cloudflare check hit 1033/530
  while cloudflared logged edge network failures; restarting only
  `business-os-cloudflared-1` restored HTTP 200 and the final live suite
  passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T00-30-32-189Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T00-31-12-927Z/report.json`.

- change: prime startup health from authenticated bootstrap
- affected files:
  `backend/src/routes/auth.ts`,
  `frontend/src/api/http.ts`,
  `frontend/src/AppContext.tsx`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: authenticated `/api/auth/bootstrap` runtime payload,
  app-shell startup health, runtime version mismatch checks, Dashboard first
  paint, and active background server health recovery cadence
- keeper or rollback: keeper; this removes the successful-startup health
  network call without deleting health checks or Cloudflare/runtime fallback
  behavior
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/dashboard` on frontend hash
  `09107596d6229a5a` observed exactly two initial app responses:
  `/api/auth/bootstrap` and `/api/dashboard/startup`, both HTTP 200. Initial
  `/health`, `/api/dashboard`, and `/api/analytics` calls were zero. Pressing
  `7 Days` produced exactly one `/api/analytics` response and zero summary
  refetches. Failed responses and relevant console messages stayed at zero.
- warm whole-app result: API HTTP guard, performance loading guard, frontend
  typecheck, backend utility suite, frontend utility suite, source guard,
  production build, generated runtime route sync, authenticated Playwright
  startup trace, broad Phase 8.4 UI live check, public Cloudflare portal check,
  and post-live hygiene passed. The first public Cloudflare check hit 530 while
  cloudflared logged edge `connect: network is unreachable`; restarting only
  `business-os-cloudflared-1` restored HTTP 200 and the final live suite
  passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T00-49-30-643Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T00-50-10-063Z/report.json`.

- change: defer inactive Dashboard bar-chart code
- affected files:
  `frontend/src/components/dashboard/Dashboard.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: Dashboard first-paint chart chunk graph and
  volume/transactions chart branch
- keeper or rollback: keeper; it removes inactive chart code from default
  startup while keeping the visible line and payment donut charts available
  and preserving the bar chart behind a stable lazy fallback
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/dashboard` on frontend hash
  `9ee8a8bbcfeb8deb` kept startup at two app API responses, confirmed
  `BarChart` was neither requested nor modulepreloaded, confirmed the visible
  `DonutChart` still loaded, and had zero relevant console messages. The
  production build split `BarChart` into a 3.33 kB lazy chunk and reduced the
  first-paint chart chunk from the previous 10.58 kB bundle to 7.56 kB.
- warm whole-app result: performance loading guard, frontend typecheck, source
  guard, frontend utility suite, production build, Docker live sync,
  authenticated Playwright startup chunk trace, broad Phase 8.4 UI live check,
  public Cloudflare portal check, and post-live hygiene passed. The first
  public Cloudflare check hit 530 while cloudflared logged edge
  `connect: network is unreachable`; restarting only `business-os-cloudflared-1`
  restored HTTP 200 and the final live suite passed. Broad Phase 8.4 live
  report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T01-06-07-357Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T01-06-48-825Z/report.json`.

- change: split later-route shared controls from Dashboard startup
- affected files:
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: Dashboard first-paint shared chunk graph, route-demand
  shared controls, and default Dashboard startup resource trace
- keeper or rollback: keeper; it reduces first-paint shared JavaScript while
  preserving focused route chunks for controls used by products, inventory,
  POS, contacts, returns, settings, audit, backup, and library pages
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/dashboard` on frontend hash
  `453778909dc40f11` observed only `/api/auth/bootstrap` and
  `/api/dashboard/startup` during initial Dashboard load, both HTTP 200.
  Pressing `7 Days` produced exactly one `/api/analytics` response. The
  startup resource list contained `app-shared-DbVyBb2V.js` with 73,051 decoded
  bytes and no requested or modulepreloaded `shared-pagination`,
  `shared-action-history`, `shared-filter-menu`, `shared-section-switcher`,
  `shared-page-header`, `shared-modal`, or inactive `BarChart` chunks. Failed
  requests and relevant console messages stayed at zero.
- warm whole-app result: performance loading guard, frontend typecheck, source
  guard, frontend utility suite, production build, Docker live sync,
  authenticated Playwright startup resource trace, broad Phase 8.4 UI live
  check, public Cloudflare portal check, and post-live hygiene passed. The
  first public Cloudflare check hit 530; restarting only
  `business-os-cloudflared-1` restored public HTTP 200 and the final live suite
  passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T01-20-30-348Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T01-21-12-550Z/report.json`.

- change: intent-load Dashboard export portal menu
- affected files:
  `frontend/src/components/shared/ExportMenu.tsx`,
  `frontend/src/components/shared/PortalMenu.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: Dashboard first-paint shared chunk graph and Export
  menu first-click behavior
- keeper or rollback: keeper; it removes portal positioning/menu code from
  startup while preserving the visible Export button and direct first-click
  open behavior
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/dashboard` on frontend hash
  `23fd366cede8b3c4` observed only `/api/auth/bootstrap` and
  `/api/dashboard/startup` during initial Dashboard load, both HTTP 200. The
  startup resource list contained `app-shared-ViL7Y8Tc.js` with 69,332 decoded
  bytes and no requested or modulepreloaded `shared-portal-menu` chunk. A
  direct `Export` click then fetched `shared-portal-menu-CJonXxAs.js` at HTTP
  200 and opened the menu. Failed requests and relevant console messages
  stayed at zero.
- warm whole-app result: performance loading guard, frontend typecheck, source
  guard, frontend utility suite, production build, Docker live sync,
  authenticated Playwright startup plus Export-click resource trace, broad
  Phase 8.4 UI live check, public Cloudflare portal check, and post-live
  hygiene passed. The first public Cloudflare check hit 530; restarting only
  `business-os-cloudflared-1` restored public HTTP 200 and the final live suite
  passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T01-35-09-312Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T01-35-50-511Z/report.json`.

- change: focus startup Lucide icons into an explicit shell chunk
- affected files:
  `frontend/src/**/*.tsx`,
  `frontend/src/types/lucide-react-icons.d.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: Dashboard first-paint icon chunk graph, Login/sidebar
  shell icon ownership, and route chunk cold-start discipline
- keeper or rollback: keeper; it removes the broad Lucide vendor bucket while
  preventing shell-needed icons from being parked inside catalog,
  notification, import-tracker, media, file-picker, or portal menu chunks
- route-scoped result: real Docker-served authenticated Playwright trace
  against `http://127.0.0.1:4000/dashboard` on frontend hash
  `ab7ff057cc20cdd9` observed 13 startup JavaScript files, 620,625 decoded
  bytes, 189,316 transfer bytes, no `vendor-lucide`, no forbidden startup
  route chunks, `/api/auth/bootstrap` and `/api/dashboard/startup` at HTTP
  200, exactly one `/api/analytics` after pressing `7 Days`, and a direct
  `Export` click that loaded `shared-portal-menu-DlZ9M2na.js` on demand and
  opened the menu. Failed requests and relevant console messages stayed at
  zero.
- warm whole-app result: performance loading guard, frontend typecheck,
  source guard, frontend utility suite, production build, Docker live sync,
  authenticated Playwright startup plus Export-click resource trace, broad
  Phase 8.4 UI live check, public Cloudflare portal check, and post-live
  hygiene passed. The first public Cloudflare check failed while the tunnel
  was stale; restarting only `business-os-cloudflared-1` restored public HTTP
  200 and the final live suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T02-20-07-473Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T02-20-47-048Z/report.json`.

- change: defer signed-out Login UI and auth-only icons
- affected files:
  `frontend/src/App.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: authenticated Dashboard startup graph, signed-out
  Login chunk ownership, and auth-only icon chunking
- keeper or rollback: keeper; it removes signed-out-only React/UI/icon code
  from authenticated startup and prevents those auth icons from falling into
  catalog while preserving signed-out Login behavior
- route-scoped result: real Docker-served Playwright trace against
  `http://127.0.0.1:4000/dashboard` on frontend hash `80aceec796128140`
  observed 13 startup JavaScript files, 587,317 decoded bytes, 181,800
  transfer bytes, no `auth-login`, catalog, notification-center,
  background-import-tracker, file-picker, media-upload, portal-menu,
  `vendor-zxing`, or `vendor-lucide` startup chunks or modulepreloads,
  `/api/auth/bootstrap` and `/api/dashboard/startup` at HTTP 200, exactly one
  `/api/analytics` after pressing `7 Days`, and a direct `Export` click that
  loaded `shared-portal-menu-CoNiqTbJ.js` on demand and opened the menu. A
  separate signed-out `/login` proof loaded `auth-login-SHSYT-QZ.js`, did not
  load catalog/file-picker/media/ZXing extras, and had no relevant console or
  failed-request noise after filtering the expected unauthenticated bootstrap
  401.
- warm whole-app result: performance loading guard, frontend typecheck,
  source guard, frontend utility suite, production build, Docker live sync,
  authenticated Dashboard plus signed-out Login resource trace, broad Phase
  8.4 UI live check, public Cloudflare portal check, and post-live hygiene
  passed. The first public Cloudflare check failed while the tunnel was stale;
  restarting only `business-os-cloudflared-1` restored public HTTP 200 and the
  final live suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T02-44-49-687Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T02-45-32-669Z/report.json`.

- change: gate signed-out sync/runtime listeners and polling
- affected files:
  `frontend/src/App.tsx`,
  `frontend/src/AppContext.tsx`,
  `frontend/src/api/websocket.ts`,
  `frontend/tests/appShellUtils.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: signed-out Login first render, authenticated Dashboard
  sync loop, and module-level WebSocket lifecycle listener ownership
- keeper or rollback: keeper; it removes unnecessary signed-out listener and
  timer work without weakening authenticated websocket recovery or changing
  the login/auth bootstrap contract
- route-scoped result: real Docker-served instrumented Playwright trace
  against `http://127.0.0.1:4000/login` and `/dashboard` on frontend hash
  `6eb9420d6daf9353` observed signed-out `/login` with only `sync:update`
  registered, no sync intervals, no 100 ms websocket quick check, expected
  unauthenticated bootstrap 401, and zero relevant console messages. The
  authenticated Dashboard path returned `/api/dashboard/startup` HTTP 200,
  registered sync/auth listeners, started 500 ms websocket polling plus the
  100 ms quick check, and had zero console or failed-request noise.
- warm whole-app result: focused app-shell guard, performance loading guard,
  frontend typecheck, frontend utility suite, production build, Docker live
  sync, instrumented Login/Dashboard Playwright probe, broad Phase 8.4 UI live
  check, public Cloudflare portal check, and post-live hygiene passed. The
  first public Cloudflare check failed while the tunnel was stale; restarting
  only `business-os-cloudflared-1` restored public HTTP 200 and the final
  live suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T03-11-44-760Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T03-12-21-734Z/report.json`.

- change: lazy-install HTTP sync cache invalidation after session recovery
- affected files:
  `frontend/src/AppContext.tsx`,
  `frontend/src/api/http.ts`,
  `frontend/tests/appShellUtils.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: signed-out Login first render and authenticated
  Dashboard sync cache invalidation
- keeper or rollback: keeper; it removes the final signed-out sync listener
  while keeping cache invalidation installed for authenticated sync sessions
- route-scoped result: real Docker-served instrumented Playwright trace
  against `http://127.0.0.1:4000/login` and `/dashboard` on frontend hash
  `81223d01f14bfad9` observed signed-out `/login` with `listeners: []`,
  `intervals: []`, `timeouts: []`, expected unauthenticated bootstrap 401,
  and zero relevant console messages. The authenticated Dashboard returned
  `/api/dashboard/startup` HTTP 200, registered `sync:update`, sync/auth
  listeners, 500 ms websocket polling, the 100 ms quick check, and had zero
  console or failed-request noise.
- warm whole-app result: focused app-shell guard, performance loading guard,
  frontend typecheck, frontend utility suite, production build, Docker live
  sync, instrumented Login/Dashboard Playwright probe, broad Phase 8.4 UI live
  check, public Cloudflare portal check, and post-live hygiene passed. The
  first public Cloudflare check failed while the tunnel was stale; restarting
  only `business-os-cloudflared-1` restored public HTTP 200 and the final
  live suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T03-23-20-716Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T03-24-03-733Z/report.json`.

- change: defer pending-sync polling interval after startup
- affected files:
  `frontend/src/App.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: authenticated Dashboard first paint and global
  pending-sync maintenance
- keeper or rollback: keeper; it removes a first-paint interval while keeping
  event-driven pending-sync refreshes and delayed polling for long sessions
- route-scoped result: real Docker-served instrumented Playwright trace
  against `http://127.0.0.1:4000/login` and `/dashboard` on frontend hash
  `e473ce0cdd641ad7` observed signed-out `/login` with empty sync listener,
  interval, and timeout probes. The authenticated Dashboard returned
  `/api/dashboard/startup` HTTP 200, registered live sync listeners, started
  websocket intervals `500` and `3000`, did not allocate the startup `20000`
  pending-sync interval, scheduled deferred `30000` timers, and had zero
  console or failed-request noise.
- warm whole-app result: performance loading guard, frontend typecheck,
  frontend utility suite, production build, Docker live sync, instrumented
  Login/Dashboard Playwright probe, broad Phase 8.4 UI live check, public
  Cloudflare portal check, and post-live hygiene passed. The first public
  Cloudflare check failed while the tunnel was stale; restarting only
  `business-os-cloudflared-1` restored public HTTP 200 and the final live
  suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T15-02-21-650Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T15-03-06-801Z/report.json`.

- change: gate session recovery, health, websocket, and UI focus listeners
  after session recovery
- affected files:
  `frontend/src/App.tsx`,
  `frontend/src/AppContext.tsx`,
  `frontend/src/api/http.ts`,
  `frontend/src/api/websocket.ts`,
  `frontend/src/web-api.ts`,
  `frontend/tests/appShellUtils.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: signed-out Login first render and authenticated
  Dashboard recovery lifecycle
- keeper or rollback: keeper; it removes public-route listener/timer side
  effects while preserving authenticated reconnect, health, and offline
  maintenance behavior through explicit installers
- route-scoped result: real Docker-served instrumented Playwright trace
  against `http://127.0.0.1:4000/login` and `/dashboard` on frontend hash
  `cb858c5ce1c60aa4` observed signed-out `/login` with no recovery
  listeners, no `visibilitychange` listener, no WebSocket, no intervals,
  expected unauthenticated bootstrap 401, and zero relevant console messages.
  The authenticated Dashboard returned `/api/dashboard/startup` HTTP 200,
  registered `online`, `focus`, and `sync:reconnected` recovery listeners,
  kept authenticated visibility listeners, opened one WebSocket, started
  intervals `30000`, `25000`, `500`, and `3000`, and had zero console or
  failed-request noise.
- warm whole-app result: app-shell guard, performance loading guard,
  frontend typecheck, frontend utility suite, production build, Docker live
  sync, instrumented Login/Dashboard Playwright probe, broad Phase 8.4 UI live
  check, public Cloudflare portal check, and post-live hygiene passed. The
  first public Cloudflare check failed with HTTP 530 while the tunnel was
  stale; restarting only `business-os-cloudflared-1` restored public HTTP 200
  and the final live suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T15-39-31-396Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T15-40-13-584Z/report.json`.

- change: consolidate authenticated browser lifecycle recovery listeners
- affected files:
  `frontend/src/api/http.ts`,
  `frontend/src/api/websocket.ts`,
  `frontend/src/web-api.ts`,
  `frontend/tests/appShellUtils.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`
- route or API target: authenticated Dashboard recovery lifecycle and
  signed-out Login first render
- keeper or rollback: keeper; it removes duplicate online/focus/visibility
  recovery listeners while keeping WebSocket reconnect suppression reset,
  active health ping, and offline maintenance behavior centralized in
  `web-api.ts`
- route-scoped result: real Docker-served instrumented Playwright trace
  against `http://127.0.0.1:4000/login` and `/dashboard` on frontend hash
  `254ace63c1c99efe` observed signed-out `/login` with no online, focus,
  `sync:reconnected`, or visibility listeners, no WebSocket, no intervals,
  expected unauthenticated bootstrap 401, and zero relevant console messages.
  The authenticated Dashboard returned `/api/dashboard/startup` HTTP 200,
  kept one online listener, two focus listeners, two `sync:reconnected`
  listeners for UI plus maintenance, three visibility listeners, one
  WebSocket, intervals `30000`, `25000`, `500`, and `3000`, and had zero
  console or failed-request noise.
- warm whole-app result: app-shell guard, performance loading guard,
  frontend typecheck, frontend utility suite, production build, Docker live
  sync, instrumented lifecycle Playwright probe, broad Phase 8.4 UI live
  check, public Cloudflare portal check, and post-live hygiene passed. The
  first public Cloudflare check failed with HTTP 530 while the tunnel was
  stale; restarting only `business-os-cloudflared-1` restored public HTTP 200
  and the final live suite passed. Broad Phase 8.4 live report:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T15-59-00-742Z/report.json`.
  Public portal report:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T15-59-50-621Z/report.json`.

- change: gate background import tracker to real import activity
- affected files:
  `frontend/src/App.tsx`,
  `frontend/src/api/importJobsTransport.ts`,
  `frontend/src/components/shared/BackgroundImportTracker.tsx`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`,
  `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md`
- route or API target: authenticated normal navigation and global import job
  progress tracker
- keeper or rollback: keeper; it removes normal-route tracker chunk/API work
  while preserving immediate tracker wakeup for actual import actions
- route-scoped result: Docker-served broad Phase 8.4 UI live check on
  frontend hash `cb6332a2ac6f7165` exercised dashboard, branches, sales,
  products, returns, library, catalog/public portal, receipt settings, POS,
  inventory, contacts, loyalty, users, audit, settings, server, and backup
  loaders. The report contains zero `background-import-tracker` and zero
  `/api/import-jobs` requests during normal navigation:
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T16-53-31-646Z/report.json`.
- focused tracker proof: `ops/runtime/reports/move723-import-tracker-probe-2026-06-02T16-53-06-381Z.json`
  observed no tracker/import-jobs requests after generic product, inventory,
  and bare imports `sync:update` events; explicit `import-job:activity`
  loaded `background-import-tracker-C6QiW-VT.js` and
  `/api/import-jobs?limit=8`, both HTTP 200, with no browser failures.
- warm whole-app result: performance loading guard, import transport API
  test, frontend typecheck, JSX/source check, frontend utility suite,
  production build, Docker live sync, focused tracker probe, broad Phase 8.4
  UI live check, public Cloudflare portal check, post-live hygiene, and
  storage prune passed. The first full live suite public step failed with
  Cloudflare HTTP 530 while the tunnel was stale; restarting only
  `business-os-cloudflared-1` restored public HTTP 200 and the rerun public
  check passed with 20 products, zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T17-05-26-223Z/report.json`.
- cleanup result: `npm.cmd --prefix ops run prune-storage` removed
  60,810,012 bytes of old runtime reports/probe output, kept latest local
  backups, kept newest R2 backup `datasync-2026-06-02T14-23-51-966Z`, and
  found no stopped containers or Docker builder cache to reclaim.

- change: trim public portal editor-only chunks from first load
- affected files:
  `frontend/src/components/catalog/CatalogPage.tsx`,
  `frontend/src/components/catalog/CatalogPreviewSurface.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`,
  `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md`
- route or API target: public customer portal first load and admin catalog
  editor upload/file-picker behavior
- keeper or rollback: keeper; it removes public first-load editor chunks by
  changing conditional mounting and Vite chunk ownership while preserving
  admin upload, file picker, and gallery behavior on interaction
- route-scoped result: Cloudflare-served public Playwright on frontend hash
  `e37146866b299666` rendered 20 products, returned HTTP 200 for public
  config/meta/search/AI endpoints, enforced CSP, recorded zero failed
  responses, zero relevant console messages, zero page errors, and no
  first-load `file-picker-modal`, `media-upload-utils`, or `image-lightbox`
  requests:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T17-37-37-400Z/report.json`.
- warm whole-app result: performance loading guard, frontend typecheck,
  JSX/source check, frontend utility suite, production build, Docker live
  sync, local `/health` and `/business-os-build.json`, public Cloudflare
  Playwright, broad Phase 8.4 UI live check, and `git diff --check` passed.
  The broad report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T17-38-20-661Z/report.json`
  exercised dashboard, branches, sales, products, returns, files/library,
  catalog/public portal, receipt settings, POS, inventory, contacts, loyalty,
  users, audit, settings, server, and backup helper loaders with zero relevant
  console messages.
- infrastructure note: the first public curl after app restart returned
  Cloudflare HTTP 502 while local `/public` was HTTP 200. Restarting only
  `business-os-cloudflared-1` restored public HTTP 200 before the final public
  Playwright pass.

- change: split public portal API bootstrap from legacy API/Dexie registry
- affected files:
  `frontend/src/web-api.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`,
  `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md`
- route or API target: public customer portal first load and portal
  config/catalog/membership/submission/AI API calls
- keeper or rollback: keeper; it replaces public fallback through the legacy
  `api/methods.ts` registry with a focused portal transport chunk while
  preserving admin-only registry behavior behind lazy method fallback
- route-scoped result: Cloudflare-served public Playwright on frontend hash
  `cbfed31b11f3c265` rendered 20 products, returned HTTP 200 for public
  config/meta/search/AI endpoints, enforced CSP, recorded zero failed
  responses, zero relevant console messages, zero page errors, and no
  first-load `auth-login`, `app-api-methods`, `vendor-dexie`, `app-auth`, or
  `app-local-db` requests:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T18-58-27-864Z/report.json`.
- warm whole-app result: performance loading guard, frontend typecheck,
  JSX/source check, frontend utility suite, production build, Docker live
  sync, local `/public`, public Cloudflare Playwright, broad Phase 8.4 UI
  Playwright, emitted chunk-reference scans, and local build metadata checks
  passed. The app now loads a focused `app-portal-CThiOzAf.js` chunk for
  portal API work instead of the legacy registry plus Dexie/auth/local DB
  chunks. The broad report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T19-20-44-127Z/report.json`
  exercised the admin app helper loaders with all checked endpoints at HTTP
  200 and zero relevant console messages.
- infrastructure note: public Cloudflare returned HTTP 530 after app restart
  while local `/public` was HTTP 200. Restarting only
  `business-os-cloudflared-1` restored public HTTP 200; cloudflared logs
  showed Cloudflare edge/Docker DNS connectivity failures rather than app
  render failures.

- change: lazy-load public portal transport from legacy API registry
- affected files:
  `frontend/src/api/methods.ts`,
  `frontend/tests/apiHttp.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`,
  `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md`
- route or API target: legacy/admin portal fallback methods and public portal
  first-load chunk ownership
- keeper or rollback: keeper; `api/methods.ts` no longer statically imports
  `portalTransport.ts`, while fallback portal methods still work by awaiting a
  memoized dynamic transport module
- route-scoped result: Cloudflare-served public Playwright on frontend hash
  `73fbae6ef77ff4b8` rendered 20 products, returned HTTP 200 for public
  config/meta/search/AI endpoints, enforced CSP, recorded zero failed
  responses, zero relevant console messages, zero page errors, and loaded the
  focused `app-portal-DTjuMQBz.js` chunk:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-02T19-48-47-456Z/report.json`.
- warm whole-app result: API HTTP source test, performance loading guard,
  frontend typecheck, JSX/source check, production build, Docker live sync,
  emitted chunk scans, public Cloudflare Playwright, and broad Phase 8.4 UI
  Playwright passed. `app-api-methods-DGc6nbrI.js` is 60,808 bytes and has no
  portal endpoint strings; `app-portal-DTjuMQBz.js` owns portal endpoints at
  2,747 bytes. The broad report
  `ops/runtime/reports/phase84-ui-live-check-2026-06-02T19-49-20-982Z/report.json`
  exercised the admin app helper loaders with all checked endpoints at HTTP
  200 and zero relevant console messages.
- infrastructure note: public Cloudflare briefly returned HTTP 530 after app
  restart while local `/public` stayed HTTP 200. Restarting only
  `business-os-cloudflared-1` restored public HTTP 200, matching the existing
  tunnel/Docker DNS follow-up rather than an app rendering regression.

- change: redesign public portal contact/social area for mobile
- affected files:
  `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`,
  `frontend/src/styles/main.css`,
  `frontend/tests/portalCatalogDisplay.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`
- route or API target: public customer portal `/public`, About hero on
  phone-sized and small-tablet screens
- keeper or rollback: keeper; it preserves the desktop portal presentation
  while phone screens use one compact contact/social tray with icon social
  actions and clamped address text
- route-scoped result: local Docker-served build hash `988172b09a81dc18`
  rendered `/public` at 390x844, 430x932, and 768x900 with the compact tray
  visible and no horizontal visual overflow. Screenshot evidence:
  `output/playwright/public-mobile-before-waited.png`,
  `output/playwright/public-mobile-after.png`,
  `output/playwright/public-large-mobile-after.png`, and
  `output/playwright/public-tablet-after.png`.
- warm whole-app result: focused portal catalog display test, performance
  loading guard, frontend typecheck, JSX/source check, production build,
  Docker live sync, public Cloudflare Playwright, and `git diff --check`
  passed. The public Cloudflare report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T00-40-53-697Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP.
- infrastructure note: public Cloudflare returned HTTP 530 after the app
  restart while local `/public` was HTTP 200. Restarting only
  `business-os-cloudflared-1` restored public HTTP 200, matching the existing
  tunnel/Docker DNS follow-up.

- change: coalesce Products/POS filter loads and speed live audit loops
- affected files:
  `frontend/src/components/products/Products.tsx`,
  `frontend/src/components/pos/POS.tsx`,
  `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`,
  `ops/scripts/runtime/live-checks/filter-burst-check.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products, POS, `/api/products/search`, and the broad
  all-pages live Playwright audit harness
- keeper or rollback: keeper; it preserves route-visible loading state while
  collapsing rapid intermediate filter/search/page state changes into one
  active request and one latest-state reload
- route-scoped result: `ops/runtime/reports/filter-burst-check-latest.json`
  rapidly clicked three filter controls on desktop/mobile Products and POS.
  Each burst produced one `/api/products/search` response, all HTTP 200.
- warm whole-app result: frontend JSX/source check, frontend typecheck,
  production build, Docker release build/update, focused all-pages route
  slice, public Cloudflare Playwright, and exhaustive all-pages desktop/mobile
  Playwright passed. Docker image `business-os:v6.0.0-202606030916` is serving
  build hash `da6ef8d8e9971506`; release update backup:
  `ops/runtime/docker-release/backups/20260603-092847`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T01-39-09-836Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 386 controls,
  intentionally skipped 133 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T01-38-34-629Z/report.json`
  rendered 20 products with zero failed responses, zero relevant console
  messages, zero page errors, and enforced CSP.
- infrastructure note: the post-start public health path returned Cloudflare
  530 while local/admin health were reachable. Restarting only
  `business-os-cloudflared-1` restored both public and admin health to HTTP
  200; the tunnel/Docker DNS stability follow-up remains open.

- change: cache POS catalog metadata during filter reloads
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `ops/scripts/runtime/live-checks/filter-burst-check.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS catalog reloads, Products/POS filter bursts,
  `/api/products/search`, `/api/categories`, `/api/branches`, and
  `/api/products/filters`
- keeper or rollback: keeper; POS now fetches lookup metadata at first
  route-ready load and on explicit branch/category sync, while normal
  filter/search/page changes keep product data current without repeating
  category/branch/filter metadata requests
- route-scoped result: `ops/runtime/reports/filter-burst-check-latest.json`
  rapidly clicked three filter controls on desktop/mobile Products and POS.
  Each burst produced one `/api/products/search` response, zero metadata
  responses, and HTTP 200 statuses.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-11-44-128Z/summary.json`
  covered desktop/mobile Products, POS, and Public Catalog, discovered 143
  controls, exercised 118 controls, skipped 25 by stable broad-audit
  guardrails, captured 12 screenshots, and recorded zero failed controls.
- warm whole-app result: frontend source check, frontend typecheck, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public/admin Cloudflare health, public Cloudflare
  Playwright, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031003` is serving build hash
  `25a697370460f92b`; release update backup:
  `ops/runtime/docker-release/backups/20260603-100513`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-16-24-667Z/summary.json`
  covered 34 routes, discovered 518 visible controls, exercised 384 controls,
  intentionally skipped 134 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T02-14-58-954Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: dedupe public portal status and route-ready live audit timing
- affected files:
  `frontend/src/components/catalog/CatalogPage.tsx`,
  `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: public catalog first load, `/api/portal/ai/status`, and
  the broad all-pages live Playwright audit harness
- keeper or rollback: keeper; it removes a duplicate same-provider status
  request while keeping retry behavior after a status failure, and makes the
  audit timing match first useful route readiness by default
- route-scoped result: `ops/runtime/reports/public-load-trace-latest.json`
  measured local `/public` root attached at 192 ms, first visible
  product/search text at 248 ms, network idle at 3.8 s, one
  `/api/portal/ai/status` request, and zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-39-06-029Z/summary.json`
  covered desktop/mobile Public Catalog, discovered 42 controls, exercised 42
  controls, captured 4 screenshots, and recorded zero failed controls.
- warm whole-app result: frontend source check, frontend typecheck,
  production build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, and full all-pages
  desktop/mobile Playwright passed. Docker image
  `business-os:v6.0.0-202606031036` is serving build hash
  `ca7fbc36b3f8c914`; release update backup:
  `ops/runtime/docker-release/backups/20260603-103722`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T02-41-33-682Z/summary.json`
  covered 34 routes, discovered 518 visible controls, exercised 380 controls,
  intentionally skipped 138 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T02-41-03-398Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: initialize direct routes from URL and narrow Sales/Returns warmup
- affected files:
  `frontend/src/AppContext.tsx`,
  `frontend/src/App.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: direct admin route first-load behavior for `/returns`,
  `/pos`, `/inventory`, `/server`, Sales, Returns, and delayed page-entry
  warmup
- keeper or rollback: keeper; direct URLs now mount the intended page first
  instead of Dashboard, and Sales/Returns keep later route warmup useful but
  delayed/narrow enough to avoid competing with first useful content
- route-scoped result: `ops/runtime/reports/top-route-load-trace-latest.json`
  compared top admin routes before and after the change. Returns dropped from
  68 to 37 first-window requests, POS from 52 to 49, Inventory from 46 to 43,
  and Server from 36 to 33; the post-change traces had zero unrelated
  Dashboard or later-admin chunks for non-Dashboard entries, zero failed
  requests, and zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-04-37-523Z/summary.json`
  covered desktop/mobile Inventory, POS, Returns, and Server, discovered 143
  controls, exercised 105 controls, intentionally skipped 38 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls.
- warm whole-app result: frontend utility tests, JSX/source check, frontend
  typecheck, production build, Docker release build/update, local
  `/health`, local `/business-os-build.json`, public Cloudflare Playwright,
  and full all-pages desktop/mobile Playwright passed. Docker image
  `business-os:v6.0.0-202606031101` is serving build hash
  `e2b70d07090424d9`; release update backup:
  `ops/runtime/docker-release/backups/20260603-110259`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-06-28-636Z/summary.json`
  covered 34 routes, discovered 520 visible controls, exercised 384 controls,
  intentionally skipped 136 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T03-06-28-154Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer Sales background history reads and add focused route-load trace
- affected files:
  `frontend/src/components/sales/Sales.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/runtime/live-checks/route-load-trace.ts`,
  `ops/package.json`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Sales first route load, `/api/sales`, `/api/users`,
  `/api/action-history`, and focused route-load measurement for Dashboard,
  Inventory, Sales, and Audit Log
- keeper or rollback: keeper; Sales keeps local undo/redo recording for real
  actions, but server history and all-user history filters now wait until
  after first Sales data has settled
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Dashboard, Inventory, Sales, and Audit Log. Sales dropped from 4 to
  2 first-window API requests by moving `/api/users` and
  `/api/action-history?scope=global...` out of the first route window. The
  post-change Sales trace had 34 total requests, 2 API requests, zero failed
  requests, and zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-29-36-198Z/summary.json`
  covered desktop/mobile Dashboard, Inventory, Sales, and Audit Log,
  discovered 138 controls, exercised 107 controls, intentionally skipped 31
  stable broad-audit guardrail controls, captured 16 screenshots, and recorded
  zero failed controls.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, and full all-pages
  desktop/mobile Playwright passed. Docker image
  `business-os:v6.0.0-202606031125` is serving build hash
  `696ba3a8fffee895`; release update backup:
  `ops/runtime/docker-release/backups/20260603-112741`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T03-32-00-189Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 381 controls,
  intentionally skipped 138 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T03-31-56-597Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer Returns background history reads and strengthen mobile Sales
  broad-audit coverage
- affected files:
  `frontend/src/components/returns/Returns.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/runtime/live-checks/all-pages-control-audit.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Returns first route load, `/api/returns`,
  `/api/users`, `/api/action-history`, and mobile Sales/Returns broad control
  sequencing
- keeper or rollback: keeper; Returns keeps local undo/redo recording for real
  return create/edit actions, but server history and all-user history filters
  now wait until after first Returns data has settled
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Products, Inventory, POS, Sales, Returns, and Server. Returns
  dropped from 4 to 2 first-window API requests by moving `/api/users` and
  `/api/action-history?scope=returns...` out of the first route window. The
  post-change Returns trace had 35 total requests, 2 API requests, zero failed
  requests, and zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T04-17-44-648Z/summary.json`
  covered desktop/mobile Sales and Returns, discovered 36 controls, exercised
  30 controls, intentionally skipped 6 stable broad-audit guardrail controls,
  captured 8 screenshots, and recorded zero failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, focused Playwright
  route-load trace, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031149` is serving build hash
  `e01139c6b67c1fea`; release update backup:
  `ops/runtime/docker-release/backups/20260603-115040`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T04-18-20-042Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 381 controls,
  intentionally skipped 138 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T03-54-18-902Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer Server page online-count health probe out of first route
  window
- affected files:
  `frontend/src/components/server/ServerPage.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Server first route load, `/health`,
  `/api/system/debug/log`, and `/api/system/config`
- keeper or rollback: keeper; the Server page still shows sync connection
  state immediately from app state, and the online device count refresh still
  runs shortly after route-ready and then every 10 seconds
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Server, Inventory, Products, and POS. Server dropped from 33 to 31
  total requests and from 5 to 3 first-window API requests by moving the
  duplicate `/health` probe out of the initial route window. The post-change
  Server trace had zero failed requests and zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T06-58-49-350Z/summary.json`
  covered desktop/mobile Server, Products, Inventory, and POS, discovered 165
  controls, exercised 127 controls, intentionally skipped 38 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, focused Playwright
  route-load trace, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031455` is serving build hash
  `f3bf6be019ef79a0`; release update backup:
  `ops/runtime/docker-release/backups/20260603-145726`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-01-14-100Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 382 controls,
  intentionally skipped 137 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T07-01-11-106Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer Products action-history and admin user reads out of first route
  window
- affected files:
  `frontend/src/components/products/Products.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products first route load,
  `/api/action-history?scope=products...`, `/api/users`,
  `/api/products/search`, and lookup/filter metadata
- keeper or rollback: keeper; Products still records local undo/redo actions
  immediately, and the server history/user option reads still wake after the
  first product data load settles
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Products, Inventory, POS, and Server. Products dropped from 46 to
  44 total requests and from 8 to 6 first-window API requests by moving
  `/api/users` and `/api/action-history?scope=products...` out of the initial
  route window. The post-change Products trace had zero failed requests and
  zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-19-41-250Z/summary.json`
  covered desktop/mobile Products, Inventory, POS, and Server, discovered 165
  controls, exercised 124 controls, intentionally skipped 41 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, focused Playwright
  route-load trace, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031516` is serving build hash
  `f3aa7ba4ab674f79`; release update backup:
  `ops/runtime/docker-release/backups/20260603-151830`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-22-24-340Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 381 controls,
  intentionally skipped 138 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T07-22-20-564Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer Inventory action-history and admin user reads out of first
  route window
- affected files:
  `frontend/src/components/inventory/Inventory.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Inventory first route load,
  `/api/action-history?scope=inventory...`, `/api/users`, `/api/branches`,
  and `/api/inventory/products/search`
- keeper or rollback: keeper; Inventory still records local undo/redo actions
  immediately, the movement filter's on-demand user loader is unchanged, and
  the server history/user option reads wake after the first inventory data load
  settles
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Inventory, Products, POS, and Server. Inventory dropped from 43 to
  41 total requests and from 5 to 3 first-window API requests by moving
  `/api/users` and `/api/action-history?scope=inventory...` out of the initial
  route window. The post-change Inventory trace had zero failed requests and
  zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-39-02-233Z/summary.json`
  covered desktop/mobile Inventory, Products, POS, and Server, discovered 165
  controls, exercised 122 controls, intentionally skipped 43 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, focused Playwright
  route-load trace, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031535` is serving build hash
  `beab212aef40e70f`; release update backup:
  `ops/runtime/docker-release/backups/20260603-153751`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T07-41-43-994Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 378 controls,
  intentionally skipped 141 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T07-41-40-527Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer POS customer and delivery option reads out of first route
  window
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS first route load, `/api/customers`,
  `/api/delivery-contacts`, `/api/products/search`, branches, categories, and
  product filter metadata
- keeper or rollback: keeper; POS cart-first catalog usability remains
  immediate, quick-add customer/delivery writes remain bounded and
  intent-driven, and the option lists still wake shortly after the first
  catalog load settles
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared POS, Inventory, Products, and Server. POS dropped from 49 to 47
  total requests and from 7 to 5 first-window API requests by moving
  `/api/customers` and `/api/delivery-contacts` out of the initial route
  window. The post-change POS trace had zero failed requests and zero
  console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-02-31-805Z/summary.json`
  covered desktop/mobile POS, Inventory, Products, and Server, discovered 165
  controls, exercised 122 controls, intentionally skipped 43 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, focused Playwright
  route-load trace, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031558` is serving build hash
  `45a502aeada4c721`; release update backup:
  `ops/runtime/docker-release/backups/20260603-160045`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-05-09-969Z/summary.json`
  covered 34 routes, discovered 518 visible controls, exercised 378 controls,
  intentionally skipped 140 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T08-05-10-948Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer Products full filter metadata out of first route window
- affected files:
  `frontend/src/components/products/Products.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products first route load,
  `/api/products/filters`, `/api/products/search`, categories, units, and
  branches
- keeper or rollback: keeper; Products still renders product rows and
  lightweight filter hints from the search payload immediately, then refreshes
  full brand/category/supplier/initial metadata shortly after route-ready and
  resets the one-shot metadata loader on product/category/unit/branch/
  supplier/settings sync
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Products, POS, Inventory, and Server. Products dropped from 44 to
  43 total requests and from 6 to 5 first-window API requests by moving
  `/api/products/filters` out of the initial route window. The post-change
  Products trace had zero failed requests and zero console/page errors.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-42-55-113Z/summary.json`
  covered desktop/mobile Products, POS, Inventory, and Server, discovered 165
  controls, exercised 124 controls, intentionally skipped 41 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, local
  `/business-os-build.json`, public Cloudflare Playwright, focused Playwright
  route-load trace, and full all-pages desktop/mobile Playwright passed. Docker
  image `business-os:v6.0.0-202606031639` is serving build hash
  `3dfa9015ce1870dc`; release update backup:
  `ops/runtime/docker-release/backups/20260603-164146`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T08-45-34-334Z/summary.json`
  covered 34 routes, discovered 519 visible controls, exercised 380 controls,
  intentionally skipped 139 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T08-42-52-358Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: defer POS full product filter metadata out of first route window
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/productSearchPagination.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS first route load, `/api/products/filters`,
  `/api/products/search`, categories, branches, customers, and delivery
  contacts
- keeper or rollback: keeper; POS keeps branch/category metadata and product
  search in the first catalog window, still seeds lightweight filter hints from
  the product search payload, and refreshes complete brand/supplier/initial
  metadata shortly after route-ready with a tracked one-shot loader
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared POS, Products, Inventory, and Server. POS dropped from 47 to 46
  total requests and from 5 to 4 first-window API requests by moving
  `/api/products/filters` out of the initial route window. The post-change POS
  trace had zero failed requests and zero console/page errors. The
  first-window API list is `/api/auth/bootstrap`, `/api/branches`,
  `/api/categories`, and `/api/products/search...`.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-07-16-666Z/summary.json`
  covered desktop/mobile POS, Products, Inventory, and Server, discovered 165
  controls, exercised 123 controls, intentionally skipped 42 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, public Cloudflare
  Playwright, focused Playwright route-load trace, and full all-pages desktop/
  mobile Playwright passed. Docker image `business-os:v6.0.0-202606031703` is
  serving build hash `e24069f961a21ccd`; release update backup:
  `ops/runtime/docker-release/backups/20260603-170519`. The local Vite build
  hash was `299a1048a429052f`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-09-56-238Z/summary.json`
  covered 34 routes, discovered 518 visible controls, exercised 378 controls,
  intentionally skipped 140 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T09-18-12-371Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP. One immediately prior public-portal attempt rendered successfully but
  saw a transient generic `net::ERR_CONNECTION_TIMED_OUT`; the rerun passed
  without relevant console noise.

- change: defer Products auxiliary category/unit/branch options out of first
  route window
- affected files:
  `frontend/src/components/products/Products.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products first route load, `/api/categories`,
  `/api/units`, `/api/branches`, `/api/products/search`, `/api/products/
  filters`, action history, and user options
- keeper or rollback: keeper; Products keeps bootstrap and first product
  search immediate, while category/unit/branch auxiliary options wake behind a
  post-route-ready one-shot loader or immediately when option-dependent UI
  opens
- route-scoped result: `ops/runtime/reports/route-load-trace-latest.json`
  compared Products, POS, Inventory, and Server. Products dropped from 43 to
  40 total requests and from 5 to 2 first-window API requests by moving
  `/api/branches`, `/api/categories`, and `/api/units` out of the initial
  route window. The post-change Products trace had zero failed requests and
  zero console/page errors. The first-window API list is `/api/auth/bootstrap`
  and `/api/products/search...`.
- delayed wake proof:
  `ops/runtime/reports/route-load-trace-2026-06-03T09-32-54-993Z.json` used a
  3000 ms trace window and showed the delayed reads waking after route-ready:
  `/api/users`, `/api/branches`, `/api/categories`, `/api/action-history?
  scope=products...`, `/api/units`, and `/api/products/filters`, all HTTP 200.
- focused route-control result:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-29-59-399Z/summary.json`
  covered desktop/mobile Products, POS, Inventory, and Server, discovered 165
  controls, exercised 123 controls, intentionally skipped 42 stable
  broad-audit guardrail controls, captured 16 screenshots, and recorded zero
  failed controls and zero findings.
- warm whole-app result: frontend utility tests, JSX/source check, production
  build, Docker release build/update, local `/health`, public Cloudflare
  Playwright, focused Playwright route-load trace, delayed Products wake trace,
  focused route-control audit, and full all-pages desktop/mobile Playwright
  passed. Docker image `business-os:v6.0.0-202606031726` is serving build hash
  `b5ac468402187aa5`; release update backup:
  `ops/runtime/docker-release/backups/20260603-172827`. The local Vite build
  hash was `2ce425b5b1e43404`.
- exhaustive live proof:
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T09-33-46-064Z/summary.json`
  covered 34 routes, discovered 518 visible controls, exercised 377 controls,
  intentionally skipped 141 stable broad-audit guardrail controls, captured 68
  screenshots, and recorded zero failed controls and zero findings.
- public Cloudflare proof:
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T09-33-45-517Z/report.json`
  rendered 20 products with config/meta/search/AI HTTP 200, zero failed
  responses, zero relevant console messages, zero page errors, and enforced
  CSP.

- change: intent-load shared portal menus for Products, Contacts, and reusable
  filter/action surfaces
- affected files:
  `frontend/src/components/shared/LazyPortalMenu.tsx`,
  `frontend/src/components/shared/PortalMenu.tsx`,
  `frontend/src/components/shared/FilterMenu.tsx`,
  `frontend/src/components/products/surfaces/HeaderActions.tsx`,
  `frontend/src/components/products/surfaces/ProductRowParts.tsx`,
  `frontend/src/components/contacts/shared.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products, Inventory, POS, Sales, Returns, and Contacts
  first-route script windows plus Products Filters and Contacts row action
  clicks
- keeper or rollback: keeper; it removes body-level menu positioning code
  from healthy first-route loads while preserving first-click menu behavior
  through delayed `defaultOpen` handling in `PortalMenu`
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T16-17-24-309Z.json`
  measured Products 218 ms, Inventory 237 ms, POS 318 ms, Sales 209 ms,
  Returns 187 ms, and Contacts 208 ms, all with zero failed requests, zero
  console/page errors, no first-window `shared-portal-menu`, no
  `app-local-db`, and no `vendor-dexie`
- interaction proof:
  `ops/runtime/reports/lazy-portal-menu-live-check-2026-06-03T16-20-20-068Z/report.json`
  clicked Products Filters and Contacts row actions in the Docker-served app,
  loaded `shared-portal-menu-D4vj-XWE.js` only after intent, opened both
  menus, and recorded zero relevant console/page errors. Docker image
  `business-os:v6.0.0-202606040015` is serving frontend hash
  `7530b3876d0d1959`.

- change: memoize Inventory product and movement filtering before grouping
- affected files:
  `frontend/src/components/inventory/Inventory.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Inventory Products and Movements render loops,
  `/api/inventory/bootstrap`, Products initial filter, and public catalog
  initial filter timing
- keeper or rollback: keeper; stable memoized search terms, matchers,
  haystack builders, and filtered lists reduce repeated O(n) render work
  without changing server query contracts or moving business data
- live timing proof:
  `ops/runtime/reports/initial-filter-timing-2026-06-03T17-00-58-548Z/report.json`
  clicked Products `G288`, Inventory `G`, and public catalog `G` in the
  Docker-served app. All three returned HTTP 200, completed in 491-520 ms, and
  recorded zero relevant console/page errors.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T17-01-16-586Z.json`
  measured Products 213 ms, Inventory 202 ms, POS 292 ms, and public_catalog
  196 ms route-ready, all with zero failed requests and zero console/page
  errors. Docker image `business-os:v6.0.0-202606040046` is serving frontend
  hash `745ad264d4801eff`.

- change: intent-load public catalog language menu
- affected files:
  `frontend/src/components/catalog/CatalogPreviewSurface.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: public catalog first-route script window and the
  public Language tools button
- keeper or rollback: keeper; public translation controls still open on first
  click, but the shared portal-menu positioning code now loads only after
  language-button intent instead of during healthy first route paint
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T17-14-07-644Z.json`
  measured public_catalog at 229 ms route-ready with 28 requests and 23
  scripts, down from 29 requests and 24 scripts in the prior trace, with zero
  failed requests, zero console/page errors, and no first-window
  `shared-portal-menu` chunk. Products, Inventory, and POS stayed clean in the
  same sweep.
- interaction proof:
  `ops/runtime/reports/public-language-menu-live-check-2026-06-03T17-18-31-063Z/report.json`
  opened the Docker-served mobile public catalog, confirmed no
  `shared-portal-menu` before the click, loaded
  `shared-portal-menu-D4vj-XWE.js` at HTTP 200 after clicking Language tools,
  rendered visible language options, and recorded zero relevant console/page
  errors. Docker image `business-os:v6.0.0-202606040111` is serving frontend
  hash `1fbc899a2010cd9d`.

- change: isolate shared Khmer script typography helpers from public catalog
  preview ownership
- affected files:
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products, Inventory, POS, and public catalog first-route
  script windows
- keeper or rollback: keeper; Products, Inventory, POS, and public catalog keep
  the same Khmer-safe text rendering helper behavior, but admin routes no
  longer import the public catalog preview/display/UI chunks just to style
  mixed Khmer/Latin product names
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted
  `script-typography-avi8xpqd.js` at 0.30 kB, and local dist inspection showed
  Products, Inventory, and POS importing that chunk with no `catalog-preview`,
  `catalog-ui`, or `catalog-display` imports.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T17-31-19-384Z.json`
  measured Products 272 ms, Inventory 232 ms, POS 335 ms, and public 199 ms
  route-ready in the Docker-served app, all with zero failed requests and zero
  console/page errors. The request parse confirmed Products, Inventory, and
  POS loaded `script-typography-avi8xpqd.js` and no catalog preview/display/UI
  chunks, while `/public` kept loading the public catalog chunks by design.
  Docker image `business-os:v6.0.0-202606040128` is serving frontend hash
  `604112e02c049f10`.

- change: remove POS dependency on customer-management route code
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS first-route script window, customer panel, and
  Contacts route compatibility
- keeper or rollback: keeper; POS keeps customer contact-option parsing through
  `parseStoredContactOptions(raw, { legacyField: 'address' })`, but no longer
  imports the whole `CustomersTab` module to get that helper
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted a 1.48 kB
  `contactOptionUtils-BSXveFTP.js` chunk, and compiled POS inspection showed
  POS importing that chunk with no `CustomersTab` import.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T17-40-43-530Z.json`
  measured POS at 281 ms route-ready with 33 requests and 25 scripts, down
  from the prior focused trace's 42 requests and 34 scripts. POS and Contacts
  both recorded zero failed requests and zero console/page errors. POS loaded
  `contactOptionUtils-BSXveFTP.js` and no `CustomersTab`, `Contacts`, or
  `CustomerFormModal` chunks.
- interaction proof:
  a Docker-served Playwright check opened POS, expanded the Customer panel,
  filled `#pos-customer-search`, confirmed the input was visible, and recorded
  zero failed requests, zero relevant console/page errors, loaded
  `contactOptionUtils`, and no `CustomersTab`, `Contacts`, or
  `CustomerFormModal`. Docker image `business-os:v6.0.0-202606040138` is
  serving frontend hash `586f2e7f02c612bf`.

- change: intent-load POS filter panel
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS first-route script window and the Filters button
- keeper or rollback: keeper; the Filters button remains visible immediately,
  while the closed filter panel's section UI and icons load only after filter
  intent
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted
  `FilterPanel-BSgPp0Gy.js` at 5.83 kB and reduced the POS route chunk to
  75.69 kB from the prior 81.25 kB chunk.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T17-51-33-389Z.json`
  measured POS at 302 ms route-ready with 32 requests and 24 scripts, down
  from 33 requests and 25 scripts in the prior focused trace. The first-window
  parse confirmed no `FilterPanel` or `shared-filter-menu` chunk before intent,
  with zero failed requests and zero console/page errors.
- interaction proof:
  a Docker-served Playwright check opened POS, dismissed the update toast,
  clicked Filters, loaded `FilterPanel-BSgPp0Gy.js` only after the click,
  rendered Stock Status and Groups controls, and recorded zero failed requests
  and zero relevant console/page errors. Docker image
  `business-os:v6.0.0-202606040149` is serving frontend hash
  `2a554c3c40e34b1e`.

- change: split POS product-read startup from the broad API methods registry
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS first-route product catalog bootstrap/search and
  delayed product-filter metadata
- keeper or rollback: keeper; POS keeps mirrored live/offline product reads,
  but those reads now enter `productReadTransport.ts` directly and land in a
  narrow `product-read-api` chunk instead of loading all of
  `app-api-methods`
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `product-read-api-*.js` at
  4.22 kB, reduced `app-api-methods` from 60.71 kB to 57.82 kB locally, and
  compiled POS inspection showed `product-read-api` with no POS import of
  `app-api-methods` or `csv-utils`.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T18-07-22-223Z.json`
  measured POS at 244 ms route-ready with 30 requests and 22 scripts, down
  from Move 758's 302 ms, 32 requests, and 24 scripts. POS loaded
  `product-read-api-DbMd_KMA.js`, `app-api-methods` was absent, `csv-utils`
  was absent, and there were zero failed requests and zero console/page errors.
- interaction proof:
  a Docker-served Playwright check opened POS, dismissed the update toast,
  typed `mask` in product search, clicked Filters, rendered Stock Status and
  Groups controls, and recorded zero failed requests and zero relevant
  console/page errors. Pre-click scripts had `product-read-api`, no
  `app-api-methods`, no `csv-utils`, and no `FilterPanel`; after click,
  `FilterPanel-BSgPp0Gy.js` loaded on intent. The click also revealed the next
  bottleneck: delayed category options still wake `app-api-methods` and
  `csv-utils`. Docker image `business-os:v6.0.0-202606040205` is serving the
  verified runtime.

- change: keep POS filter-open category lookup out of broad API methods
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS Filters click, category options, and the
  `product-read-api` manual chunk boundary
- keeper or rollback: keeper; POS now calls `lookupTransport.ts` directly for
  category options, while the manual chunk also owns `expectedUpdatedAt.ts` to
  avoid a circular chunk warning and keep optimistic write helpers consistent
  with the lookup transport
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `product-read-api-*.js` at
  5.87 kB with no circular chunk warning. Compiled POS inspection showed POS
  importing `product-read-api` and no `app-api-methods` or `csv-utils`; the
  compiled `product-read-api` chunk contains `/api/categories` and
  `/api/products/bootstrap`, with no `app-api-methods` import.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T18-22-00-988Z.json`
  measured POS at 262 ms route-ready with 30 requests and 22 scripts, with
  zero failed requests and zero console/page errors. Docker image
  `business-os:v6.0.0-202606040219` served the check.
- interaction proof:
  a Docker-served Playwright check opened POS, dismissed the update toast,
  typed `mask`, clicked Filters, rendered Stock Status and Groups controls,
  and recorded zero failed requests and zero relevant console/page errors.
  Pre-click scripts had `product-read-api`, no `app-api-methods`, no
  `csv-utils`, and no `FilterPanel`; after click, only `truck-Y2SFGnKm.js`
  and `FilterPanel-BSgPp0Gy.js` were added. Screenshot:
  `C:\Users\user\Downloads\business-os\output\playwright\pos-lookup-filter-1780510955919.png`.

- change: keep POS delayed customer/contact option reads out of broad API methods
- affected files:
  `frontend/src/api/contactReadTransport.ts`,
  `frontend/src/api/localMirrors.ts`,
  `frontend/src/components/pos/POS.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS delayed customer and delivery-contact option reads,
  plus first-window IndexedDB/Dexie/CSV wake timing
- keeper or rollback: keeper; POS now lazy-loads `contactReadTransport.ts`
  when contact options are needed, reads `/api/customers` and
  `/api/delivery-contacts` directly, and preserves local mirror fallback while
  deferring mirror writes beyond the first route/interaction windows
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `contact-read-api-*.js` at
  1.31 kB and kept `product-read-api-*.js` at 5.87 kB. The source guard
  prevents POS from calling `api.getCustomers` or `api.getDeliveryContacts`
  through the broad registry and verifies the manual `contact-read-api`
  boundary.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T18-48-15-082Z.json`
  measured POS at 353 ms route-ready with 30 requests and 22 scripts, with
  zero failed requests and zero console/page errors. Docker image
  `business-os:v6.0.0-202606040246` served the check.
- interaction proof:
  a Docker-served Chromium probe opened POS and recorded loaded scripts before
  and after the delayed contact option gate. The first 600 ms window had
  22 scripts and no `contact-read-api`, `app-api-methods`, `csv-utils`,
  `app-local-db`, or `vendor-dexie`; after the delayed gate, only
  `contact-read-api-3bBCBgdj.js` was added. Those broad/local chunks stayed
  unloaded through the tested customer interaction window, with zero failed
  requests and zero relevant console/page errors. Screenshot:
  `C:\Users\user\Downloads\business-os\output\playwright\pos-contact-read-1780512638903.png`.

- change: keep POS membership lookup out of broad API methods
- affected files:
  `frontend/src/components/pos/POS.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS customer membership lookup after selecting a
  customer with a membership number
- keeper or rollback: keeper; POS now lazy-loads `portalTransport.ts`
  directly for `lookupPortalMembership`, preserving the focused portal
  transport path while leaving checkout/offline sale writes untouched
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `app-portal-*.js` as the
  existing focused portal transport chunk. The source guard verifies the
  memoized `portalTransport.ts` dynamic import and rejects
  `api.lookupPortalMembership` in POS.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T19-00-43-680Z.json`
  measured POS at 268 ms route-ready with 30 requests and 22 scripts, with
  zero failed requests and zero console/page errors. Docker image
  `business-os:v6.0.0-202606040258` served the check.
- interaction proof:
  a Docker-served Chromium probe opened POS, waited through the delayed
  contact gate, opened the customer picker, selected existing customer
  `Customer 1` with membership `LCMN-P3D01HD0`, and recorded loaded scripts.
  The first window had no `app-portal`, `app-api-methods`, `csv-utils`,
  `app-local-db`, or `vendor-dexie`; after the delayed contact gate only
  `contact-read-api-DeDopXO-.js` was added; after membership selection only
  `app-portal-Bi-RHhNA.js` was added. Broad/local chunks stayed unloaded with
  zero failed requests and zero relevant console/page errors. Screenshot:
  `C:\Users\user\Downloads\business-os\output\playwright\pos-membership-lookup-1780513393629.png`.

- change: keep POS quick customer and delivery-contact create writes out of
  broad API methods
- affected files:
  `frontend/src/api/contactReadTransport.ts`,
  `frontend/src/api/contactWriteTransport.ts`,
  `frontend/src/components/pos/POS.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS Add Customer and Add Delivery modal save paths,
  plus contact-option read fallback/mirror timing
- keeper or rollback: keeper; POS now lazy-loads `contactWriteTransport.ts`
  for quick customer and delivery-contact creates. The write transport posts
  directly to `/api/customers` and `/api/delivery-contacts`, adds device
  metadata, and owns a local client-request-id helper so it does not import
  `requestIds.ts`, `app-api-methods`, or CSV helpers. `contactReadTransport.ts`
  dynamically imports local DB and mirror helpers only after those fallback
  paths are needed.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `contact-write-api-*.js` as a
  focused write chunk. Compiled inspection found no `app-api-methods`,
  `csv-utils`, `requestIds`, or broad dynamic registry import in the chunk. The
  source guard verifies the contact-write manual chunk, rejects
  `api.createCustomer` and `api.createDeliveryContact` in POS, and requires
  dynamic local DB/mirror imports in `contactReadTransport.ts`.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T19-31-04-184Z.json`
  measured POS at 275 ms route-ready with 30 requests and 22 scripts, with
  zero failed requests and zero console/page errors. Docker image
  `business-os:v6.0.0-202606040328` served the check.
- interaction proof:
  a Docker-served headed Chromium probe opened POS, clicked the real Add
  Customer and Add Delivery buttons, filled both modals, saved both records,
  and then deleted the created customer id `4` and delivery contact id `4`.
  Exact post-cleanup searches returned zero remaining rows. The flow loaded
  only `contact-read-api-DS-Y1Uow.js` and `contact-write-api-BlLnWfno.js`,
  while `app-api-methods`, `csv-utils`, `app-local-db`, and `vendor-dexie`
  stayed unloaded with zero failed requests and zero relevant console/page
  errors. Screenshot:
  `C:\Users\user\Downloads\business-os\output\playwright\pos-contact-create-1780515114591.png`.
- post-live hygiene:
  `npm.cmd --prefix ops run cleanup-test-data -- --prefix "QA POS" --apply`
  removed four QA audit-log entries left by the live create flow and found no
  remaining matching source rows.

- change: keep POS checkout sale writes out of broad API methods
- affected files:
  `frontend/src/api/saleWriteTransport.ts`,
  `frontend/src/api/methods.ts`,
  `frontend/src/components/pos/POS.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS Done -> Completed sale checkout writes, plus
  pending offline sale queue forced retry
- keeper or rollback: keeper; POS now lazy-loads `saleWriteTransport.ts` for
  checkout, while `methods.ts` keeps compatibility exports that dynamically
  delegate `createSale` and `retryPendingSyncNow`. The focused transport owns
  sale create, client request ids, offline sale queueing, retry/backoff,
  conflict marking, mirror writes, sync update dispatch, and background sync
  registration without importing the broad API methods registry.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `sale-write-api-*.js` as a
  focused write chunk with no circular chunk warning. Compiled inspection
  found no `app-api-methods`, `csv-utils`, `requestIds`, `methods`, or
  `salesTransport` imports in the sale-write chunk. The source guard verifies
  the sale-write manual chunk, rejects `api.createSale`, `getPosApi`, and
  `missingPosApiMethod` in POS, and ensures duplicate offline sale queue
  helpers are no longer owned by `methods.ts`.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T19-56-35-700Z.json`
  measured POS at 245 ms route-ready with 30 requests and 22 scripts, with
  zero failed requests and zero console/page errors. Docker image
  `business-os:v6.0.0-202606040354` served the check.
- interaction proof:
  a Docker-served headed Chromium probe created temporary product
  `QA POS Move764 1780517016314 Item`, opened POS, searched for it, clicked
  the product card, clicked `Exact $`, `Done`, and `Completed`, reached receipt
  preview, and confirmed the sale through `/api/sales` search. The flow loaded
  `sale-write-api-BDCbXrEC.js`, while `app-api-methods` and `csv-utils` stayed
  unloaded with zero failed requests and zero relevant console/page errors.
  Screenshots:
  `C:\Users\user\Downloads\business-os\output\playwright\pos-sale-write-before.png`
  and
  `C:\Users\user\Downloads\business-os\output\playwright\pos-sale-write-after.png`.
- post-live hygiene:
  `npm.cmd --prefix ops run cleanup-test-data -- --prefix "QA POS Move764" --apply --output ops/runtime/reports/pos-sale-write-cleanup-latest.json`
  removed the QA sale, sale item, allocation, product, stock rows, batch rows,
  inventory movement, action-history entry, and audit log created by the live
  checkout proof.

- change: lazy-load receipt export generators from receipt preview
- affected files:
  `frontend/src/components/receipt/Receipt.tsx`,
  `frontend/tests/receiptTemplate.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: POS checkout receipt preview, then Print/Open
  PDF/Image export intent
- keeper or rollback: keeper; receipt preview now avoids static
  `printReceipt.ts` loading and uses one memoized dynamic import when export
  buttons are clicked. This keeps preview fast after checkout while preserving
  the same PDF, print, and image export behavior.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `Receipt-B-UUoysE.js` at
  16,162 bytes and separated `printReceipt-C-vsIQZL.js` at 21,413 bytes, with
  no circular chunk warning. The source guard rejects static `printReceipt`
  imports in `Receipt.tsx` and requires `loadReceiptPrintModule()` plus
  `printTools.downloadReceiptImage`, `printTools.printReceipt`, and
  `printTools.openReceiptPdf` usage in export handlers.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T20-14-57-395Z.json`
  measured POS at 270 ms route-ready with 30 requests, 2 API requests, and 22
  scripts, with zero failed requests and zero console/page errors. Docker image
  `business-os:v6.0.0-202606040412` served frontend hash
  `71ea4f3183cefe58`.
- interaction proof:
  a Docker-served headed Chromium probe created temporary product
  `QA POS Move765 1780517748968 Item`, opened POS, searched for it, clicked
  the product card, clicked `Exact $`, `Done`, and `Completed`, reached receipt
  preview, and confirmed the sale through `/api/sales` search. Before clicking
  Image there were zero `printReceipt-*` scripts in the loaded script list;
  clicking Image loaded `printReceipt-C-vsIQZL.js` and downloaded
  `C:\Users\user\Downloads\business-os\output\playwright\move765-Receipt-RCP-1780517750786-H5W7.png`.
  The flow had zero failed requests, zero relevant console messages, and zero
  page errors. Screenshots:
  `C:\Users\user\Downloads\business-os\output\playwright\pos-receipt-export-before.png`
  and
  `C:\Users\user\Downloads\business-os\output\playwright\pos-receipt-export-after.png`.
- post-live hygiene:
  `npm.cmd --prefix ops run cleanup-test-data -- --prefix "QA POS Move765" --apply --output ops/runtime/reports/pos-receipt-export-cleanup-latest.json`
  removed the QA sale, sale item, allocation, product, stock rows, batch rows,
  inventory movement, action-history entry, and audit log created by the live
  receipt export proof.

- change: narrow Products write, ProductForm supplier/image upload, action
  history, and idle offline-snapshot paths
- affected files:
  `frontend/src/components/products/Products.tsx`,
  `frontend/src/components/products/forms/ProductForm.tsx`,
  `frontend/src/api/productImageUploadTransport.ts`,
  `frontend/src/api/actionHistoryTransport.ts`,
  `frontend/src/api/offlineSnapshotTransport.ts`,
  `frontend/src/utils/actionHistory.ts`,
  `frontend/src/web-api.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/scripts/runtime/live-checks/move766-product-write-live-check.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products route load, Product button create flow,
  ProductForm supplier options/image upload intents, action-history user
  filter, idle offline snapshot refresh, and actual Cloudflare admin/public
  links
- keeper or rollback: keeper; ProductForm and Products intent paths now use
  focused lazy transports and no longer wake `app-api-methods` for the tested
  create/delete flow. The change preserves server-first reads, offline mirror
  fallback, and cleanup hygiene while making the resource use measurable.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted focused
  `product-write-api-CYyuCWn_.js`, `product-image-upload-api-CTBygZzI.js`,
  `contacts-api--0vC5ZWJ.js`, `action-history-api-DdIk84Ze.js`, and
  `offline-snapshot-api-C5dLnuHI.js` chunks. The source guard verifies those
  manual chunk boundaries and rejects ProductForm `window.api` supplier/image
  upload access.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T21-25-11-474Z.json`
  measured local Docker Products at 282 ms route-ready with 37 requests, 2 API
  requests, and 29 scripts, with zero failed requests and zero console/page
  errors. Docker image `business-os:v6.0.0-202606040522` served frontend hash
  `30cbc69ea051e0fd`.
- interaction proof:
  `ops/runtime/reports/move766-product-write-live-check-2026-06-03T21-25-13-480Z/report.json`
  created `QA Product Move766 1780521913531` through the Product modal, found
  it through Products search, deleted it from the row menu, observed one
  create call and one delete call, loaded `product-write-api-CYyuCWn_.js`, and
  kept `app-api-methods` unloaded before and after the write intent.
- actual link proof:
  `https://admin.leangcosmetics.dpdns.org/health` and
  `https://leangcosmetics.dpdns.org/public` returned HTTP 200. Remote admin
  Products route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T21-27-00-948Z.json`
  passed with 16 requests, 1 API request, 11 scripts, zero failed requests,
  and zero console/page errors. Remote public portal report
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T21-26-13-600Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, AI status 200 after
  interaction, zero failed responses, zero relevant console messages, and zero
  page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run cleanup-test-data -- --prefix "QA Product Move766" --apply --output ops/runtime/reports/move766-product-write-cleanup-latest.json`
  removed 20 QA action-history rows and 10 QA audit-log rows from repeated
  product write proof runs.

- change: narrow Contacts first-load read/write/export transport paths
- affected files:
  `frontend/src/api/contactReadTransport.ts`,
  `frontend/src/api/contactWriteTransport.ts`,
  `frontend/src/components/contacts/Contacts.tsx`,
  `frontend/src/components/contacts/CustomersTab.tsx`,
  `frontend/src/components/contacts/SuppliersTab.tsx`,
  `frontend/src/components/contacts/DeliveryTab.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Contacts route first paint, Customers/Suppliers/Delivery
  reads and CRUD intents, all-contacts export, actual admin/public Cloudflare
  links, all-page local route and control sweeps
- keeper or rollback: keeper; contact reads now use `contactReadTransport.ts`,
  mutations use `contactWriteTransport.ts`, and ZIP/CSV helpers load only after
  the Export action. The older mixed `contactsTransport.ts` remains available
  for existing import/template/offline-snapshot paths while first-load tabs
  avoid broad `window.api` and mixed transport wakeups.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `Contacts-Dg4T67Dm.js`,
  `contact-read-api-mA4znrvJ.js`, `contact-write-api-DjXNP-nz.js`, and
  `csv-utils-Cx1V6C4j.js`. The Contacts route chunk has no direct
  `app-api-methods` or `contacts-api` reference, and the source guard now
  rejects `window.api`, `contactsTransport.ts`, and static CSV/ZIP loading in
  the Contacts shell and tabs.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T22-40-29-536Z.json`
  measured local Docker Contacts at 269 ms route-ready with 35 requests, 2 API
  requests, and 30 scripts, with zero failed requests and zero console/page
  errors. The broader local 17-route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-41-45-113Z.json`
  passed every route with zero failed requests and zero console/page errors.
- interaction/control proof:
  fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T22-41-45-201Z/summary.json`
  discovered 254 controls across 17 routes, safely exercised 183 controls,
  intentionally skipped 71 guarded controls, captured 34 screenshots, and
  found zero failed controls. Phase 8.4 live suite
  `ops/runtime/reports/phase84-ui-live-check-2026-06-03T22-44-22-296Z/report.json`
  checked 66 live UI/API signals with zero relevant console messages and no
  framework overlay.
- actual link proof:
  `https://admin.leangcosmetics.dpdns.org/health` and
  `https://leangcosmetics.dpdns.org/public` returned HTTP 200. Remote admin
  Contacts trace
  `ops/runtime/reports/route-load-trace-2026-06-03T22-41-27-698Z.json`
  passed with 17 requests, 1 API request, 12 scripts, zero failed requests,
  and zero console/page errors. Public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T22-45-03-158Z/report.json`
  rendered 20 products, confirmed portal bootstrap HTTP 200, confirmed AI
  status HTTP 200 after interaction, and recorded zero failed responses, zero
  relevant console messages, and zero page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset
  status, zero broad QA cleanup matches, zero smoke/action-history cleanup
  matches, zero generated integrity matches, and relationship orphan checks
  passing for 49 FK candidates.

- change: narrow Inventory first-load reads and stock mutation transports
- affected files:
  `frontend/src/components/inventory/Inventory.tsx`,
  `frontend/src/api/returnsTransport.ts`,
  `frontend/src/api/userReadTransport.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/offlineSalesQueue.test.ts`,
  `frontend/tests/offlineSyncArchitecture.test.ts`,
  `frontend/tests/productSearchPagination.test.ts`,
  `frontend/tests/actionStability.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Inventory route first-load, stats, movement reads,
  branch/product/user/returns/RFID reads, stock adjust/move/transfer writes,
  actual admin/public Cloudflare links, and all-page local control sweeps
- keeper or rollback: keeper; Inventory no longer wakes `window.api` or the
  broad `app-api-methods` chunk for its tested first-load path. The focused
  transports preserve server-first reads and local fallback behavior while
  reducing first-load request/script pressure.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `inventory-api-uLLdUUMj.js`,
  `product-read-api-DHxOeOrS.js`, `returns-api-gGxVAAzH.js`,
  `user-read-api-DLkRgI9Y.js`, `dashboard-api-BJnL1tJk.js`, and
  `rfid-api-C15O85S3.js` without a circular chunk warning. The performance
  guard rejects Inventory `window.api` access and checks the focused lazy
  loaders.
- route-scoped result:
  `ops/runtime/reports/route-load-trace-2026-06-03T23-06-34-762Z.json`
  measured local Docker Inventory at 364 ms route-ready with 39 requests, 2
  API requests, and 32 scripts, with zero failed requests and zero console/page
  errors. The broader 17-route trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-07-07-709Z.json`
  measured Inventory at 227 ms with 39 requests and 32 scripts and passed all
  17 routes with zero failures or page errors. Before Move 768, Inventory was
  47 requests and 40 scripts in
  `ops/runtime/reports/route-load-trace-2026-06-03T22-51-14-968Z.json`.
- interaction/control proof:
  fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T23-07-37-291Z/summary.json`
  discovered 255 controls across 17 routes, exercised 184 stable controls,
  skipped 71 guarded/noisy controls, captured 34 screenshots, and found zero
  failed controls.
- actual link proof:
  `https://admin.leangcosmetics.dpdns.org/health` and
  `https://leangcosmetics.dpdns.org/public` returned HTTP 200. Remote admin
  Inventory trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-07-37-804Z.json`
  passed with 27 requests, 1 API request, 22 scripts, zero failed requests,
  and zero console/page errors, but still took 6308 ms route-ready through the
  public tunnel/auth shell. Public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T23-07-37-740Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, AI status 200 after
  interaction, zero failed responses, zero relevant console messages, and zero
  page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset
  status, zero QA cleanup matches, zero generated integrity matches, and
  relationship orphan checks passing for 49 FK candidates.

- change: defer Products CSV export helpers until export intent
- affected files:
  `frontend/src/components/products/Products.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Products export menu, Products first-paint resource
  list, actual admin/public Cloudflare links, local Products/POS/public route
  traces, and broad local all-page control sweep
- keeper or rollback: keeper; Products keeps CSV export behavior but no longer
  requests `csv-utils` before an Export click.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted `Products-Br7M9jP8.js` and
  `csv-utils-DOaabJN_.js` as separate chunks. The source guard now rejects a
  static Products `downloadCSV` import and requires the dynamic
  `../../utils/csv.ts` export helper load.
- route-scoped result:
  local Docker trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-36-07-611Z.json`
  measured Products at 265 ms, POS at 296 ms, and public catalog at 215 ms,
  all with zero failed requests and zero console/page errors. Trace parsing
  confirmed `csv-utils` was absent from first-paint scripts for all three.
- interaction/control proof:
  fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-03T23-37-55-737Z/summary.json`
  discovered 254 controls, exercised 183 stable controls, skipped 71 guarded
  controls, captured 34 screenshots, and found zero failed controls.
- actual link proof:
  `https://admin.leangcosmetics.dpdns.org/health` and
  `https://leangcosmetics.dpdns.org/public` returned HTTP 200. Remote admin
  trace `ops/runtime/reports/route-load-trace-2026-06-03T23-41-37-731Z.json`
  measured Products at 3443 ms and POS at 4173 ms with zero failures/errors
  and no first-paint `csv-utils`. Real public-host trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-42-27-763Z.json`
  measured `/public` at 2635 ms with zero failures/errors. Public portal
  Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-03T23-36-08-136Z/report.json`
  rendered 20 products with portal bootstrap 200, AI status 200 after
  interaction, and zero failed responses.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero QA cleanup matches, zero generated integrity matches, and relationship
  orphan checks passing for 49 FK candidates.

- change: split public catalog preview, Products, and secondary-tab chunks
- affected files:
  `frontend/src/components/catalog/CatalogPage.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: public customer portal first Products viewport, public
  About/Membership/FAQ/AI tab intent, actual admin/public Cloudflare links,
  local public/Dashboard/Products/POS route traces, and broad local all-page
  control sweep
- keeper or rollback: keeper; the common public landing path no longer loads
  hidden About/contact/social/map secondary-tab code during first paint, while
  non-Products tab clicks immediately load the deferred secondary chunk.
- compiled chunk proof:
  `npm.cmd --prefix frontend run build` emitted
  `catalog-preview-BjcSy4tW.js`, `catalog-products-6njbw9vv.js`, and
  `catalog-secondary-tabs-NY-SRrRp.js`. The production HTML modulepreload list
  still contains only core startup chunks, not the catalog split chunks.
- route-scoped result:
  local Docker trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-59-46-868Z.json`
  measured public catalog at 190 ms, Dashboard at 236 ms, Products at 243 ms,
  and POS at 266 ms, all with zero failed requests and zero console/page
  errors. Local public first-load scripts included `catalog-preview` and
  `catalog-products`, but not `catalog-secondary-tabs`.
- interaction/control proof:
  public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-01-16-334Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors. Fast all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-04T00-01-16-941Z/summary.json`
  discovered 254 controls across 17 routes, exercised 182 stable controls,
  skipped 72 guarded/noisy controls, captured 34 screenshots, and found zero
  failed controls.
- actual link proof:
  `https://admin.leangcosmetics.dpdns.org/health` and
  `https://leangcosmetics.dpdns.org/public` returned HTTP 200 with final direct
  curl totals around 0.84-0.85 s. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-59-46-898Z.json` passed
  Dashboard, Products, POS, and Settings with zero failures/errors. Real
  public-host trace
  `ops/runtime/reports/route-load-trace-2026-06-03T23-59-47-108Z.json` passed
  `/public` with zero failures/errors and no first-load
  `catalog-secondary-tabs`; the 7835 ms ready sample is tracked as
  tunnel/browser cold-path variance rather than a render failure.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.

- change: lazy-load Contacts tab CSV export helpers
- affected files:
  `frontend/src/components/contacts/CustomersTab.tsx`,
  `frontend/src/components/contacts/SuppliersTab.tsx`,
  `frontend/src/components/contacts/DeliveryTab.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  generated references under `ops/docs/reference/`
- route or API target: Contacts route startup, Customers/Suppliers/Delivery
  export buttons, and the focused contact read transport path
- keeper or rollback: keeper; export behavior stays behind the same buttons,
  and rollback is the previous static CSV import if a future browser or build
  issue appears.
- source proof:
  `CustomersTab.tsx`, `SuppliersTab.tsx`, and `DeliveryTab.tsx` no longer
  statically import `../../utils/csv`; each tab memoizes
  `import('../../utils/csv')` and awaits it only from the export handler.
  `frontend/tests/performanceLoadingUx.test.ts` now rejects static contact CSV
  imports and requires the dynamic import path.
- actual link proof:
  Docker release image `business-os:v6.0.0-202606041904` is running. Local
  health reports frontend build hash `225fc10e0846045b`. Local Docker route
  trace
  `ops/runtime/reports/route-load-trace-2026-06-04T11-14-33-581Z.json` passed
  Contacts in 233 ms with 34 requests, 29 scripts, two API calls, zero failed
  requests, zero console/page errors, and script inspection confirmed
  `hasCsvUtils=false`.
- public proof:
  public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T11-14-33-554Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200 and AI status 200
  after interaction, and recorded zero failed responses, zero relevant console
  messages, and zero page errors.
- verification:
  focused performance guard, frontend typecheck, JSX/source check, full
  frontend utility suite, production build, Docker release build/start, public
  Cloudflare portal Playwright, post-live hygiene, organization audit, schema
  audit, generated reference refresh, Phase 29 audit, and prune checks passed.
- cleanup:
  deleted regenerable `release` and `frontend/dist` after the Docker image was
  built and healthy, removing 412,447,007 bytes. Storage prune removed
  326,086 bytes of old reports plus 38.19 MB of Docker builder cache while
  preserving protected data, newest local backups, Docker images/volumes, and
  latest R2 backup `datasync-2026-06-04T09-26-59-912Z`.

- change: narrow Sales/Returns route-start reads and split API HTTP core
- affected files:
  `frontend/src/components/sales/Sales.tsx`,
  `frontend/src/components/returns/Returns.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: Sales and Returns normal read startup, admin
  Cloudflare route traces, public Cloudflare portal check, and Phase 29 cleanup
- keeper or rollback: keeper; focused read transports now share
  `api-http-core`, while write/detail actions stay on the existing action API.
  Rollback would be restoring broad route-start reads through `window.api`,
  which would re-add `app-api-methods` to Sales startup.
- bundle proof:
  standalone output emits `api-http-core-BRrzV8AY.js` at 20.79 KB gzip
  7.34 KB and `app-api-CJUW8tAi.js` at 4.41 KB gzip 1.72 KB. Docker image
  `business-os:v6.0.0-202606041117` served frontend hash
  `c4818ba473b05528`.
- actual link proof:
  local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T03-19-53-714Z.json` passed
  Sales in 399 ms with 31 requests/26 scripts and Returns in 464 ms with
  30 requests/25 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T03-20-19-101Z.json` passed
  Sales in 240 ms and Returns in 228 ms, with matching request/script counts.
  Both traces had zero failures/errors and script-list inspection confirmed
  `app-api-methods-present=False` and `csv-utils-present=False` for both
  routes. Public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T03-19-53-181Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors.
- cleanup proof:
  post-live hygiene passed with zero QA/smoke/action-history cleanup matches
  and relationship orphan checks passing for 49 FK candidates. Storage prune
  removed 30,592,188 bytes of old reports, 4,829,716 bytes of old local
  Docker-release backup data, and 38.19 MB of Docker builder cache while
  keeping protected data and the newest R2 backup. Generated-artifact cleanup
  removed another 415,957,346 bytes from regenerable `release`,
  `frontend/dist`, and `output` folders, then `npm.cmd --prefix ops run
  phase29:audit` passed with zero failures.

## 2026-06-04 - Move 779 Users Action Surface Deferral

- change: lazy-load Users profile/detail/permission editor surfaces and split
  shared helper ownership away from those action-only chunks
- affected files:
  `frontend/src/components/users/Users.tsx`,
  `frontend/src/components/users/UserDetailSheet.tsx`,
  `frontend/src/components/users/PermissionEditor.tsx`,
  `frontend/src/components/users/permissionDefinitions.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `frontend/tests/permissionEditor.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: admin Users route, profile modal, user detail sheet,
  role permission editor, shared action history, and actual admin/public
  Cloudflare links
- keeper or rollback: keeper; the normal Users list and role summary keep
  their visible data, while profile/detail/permission editor UI loads only
  after the user opens those actions. Helper chunks remain small and shared.
- bundle proof:
  standalone output emits `Users-CrxxMbTW.js` at 34.74 KB gzip 8.33 KB,
  `user-profile-modal-fZZ1WHxv.js` at 39.77 KB gzip 11.29 KB,
  `user-detail-sheet-DrgkE-YZ.js` at 3.83 KB gzip 1.50 KB,
  `user-permission-editor-BDueo37y.js` at 3.12 KB gzip 1.24 KB,
  `user-permission-definitions-D4YB3sF5.js` at 2.17 KB gzip 0.73 KB,
  `shared-formatters-hlKiTBw1.js` at 1.05 KB gzip 0.48 KB, and
  `shared-action-history-C7vkR4lr.js` at 11.26 KB gzip 3.77 KB. Artifact
  inspection confirmed the action chunks appear only inside runtime
  `import()` calls, not as top-level imports.
- actual link proof:
  local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-28-37-499Z.json` passed
  Users, Settings, Backup, and Products with zero failed requests and zero
  console/page errors. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-28-50-177Z.json` passed
  the same routes with zero failures/errors. Users now loads with 38 requests
  and 32 scripts instead of the earlier stable 45 requests and 39 scripts.
  Public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T02-29-03-671Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200 and AI status 200
  after interaction, and recorded zero failed responses, zero relevant console
  messages, and zero page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.

## 2026-06-04 - Move 780 Sales/Returns CSV Startup Deferral

- change: lazy-load Sales and Returns CSV export helpers, CSV template
  generation, and browser file-dialog utilities so normal route startup does
  not request `csv-utils`.
- affected files:
  `frontend/src/components/sales/Sales.tsx`,
  `frontend/src/components/returns/Returns.tsx`,
  `frontend/src/api/contactsTransport.ts`,
  `frontend/src/api/methods.ts`,
  `frontend/vite.config.ts`,
  `frontend/tests/apiHttp.test.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: admin Sales and Returns startup, export actions,
  contact/import template download actions, browser CSV/image file dialogs,
  and actual admin/public Cloudflare links
- keeper or rollback: keeper; visible Sales/Returns data still loads normally,
  while CSV export/template/file-dialog code loads only after an explicit
  export/template/dialog action.
- bundle proof:
  standalone output emits `browser-dialogs-b2rpWGfH.js` at 0.75 KB gzip
  0.47 KB, `csv-utils-rS6b7zK6.js` at 7.59 KB gzip 3.36 KB,
  `Sales-BLPOxK6G.js` at 35.77 KB gzip 9.93 KB,
  `Returns-eWBP2b2n.js` at 23.11 KB gzip 7.72 KB, and
  `app-api-methods-CBKXmBPK.js` at 43.01 KB gzip 13.69 KB. Docker image
  `business-os:v6.0.0-202606041056` served frontend hash
  `547935922e3f9ab5`.
- actual link proof:
  local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-59-01-255Z.json` passed
  Sales in 287 ms with 39 requests/34 scripts and Returns in 221 ms with
  40 requests/35 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T02-59-25-149Z.json` passed
  Sales in 248 ms and Returns in 252 ms with the same request/script counts.
  Both traces had zero failed requests, zero console/page errors, and
  `csv-utils-present=False` for both routes. Public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T02-59-23-699Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200 and AI status 200
  after interaction, and recorded zero failed responses, zero relevant console
  messages, and zero page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.

Move 777 status:
- Move 777 lazy-loads the Settings 2FA OTP modal. `Settings.tsx` now imports
  only the `OtpModalProps` type and loads the runtime modal through a React
  lazy/Suspense boundary after Enable 2FA or Disable 2FA is pressed.
  `OtpModal.tsx` exports the props type so the intent boundary remains typed.
- Vite emits `settings-otp-modal-BTTCqa0J.js` at 6.74 KB gzip 2.28 KB and
  excludes `assets/settings-otp-modal-` from eager modulepreload. Normal
  Settings route output is `Settings-SNkEEPE-.js` at 54.43 KB gzip 15.37 KB.
- Guardrail proof: focused performance guard, frontend typecheck, source
  syntax check, full frontend utility suite, production build, Docker release
  build/start, local and remote route traces, public Cloudflare portal check,
  Docker container inspection, and post-live hygiene passed.
- Actual-link proof: local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-47-30-975Z.json` passed
  Dashboard, Products, Backup, and Settings with zero failed requests and zero
  console/page errors; Settings loaded in 206 ms with 27 requests, two API
  requests, and 22 scripts. Remote admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-47-31-450Z.json` passed
  the same routes with zero failures/errors; Settings loaded in 216 ms. Both
  traces show no normal-route `settings-otp-modal`, `OtpModal`, or
  `backup-reset-tools` request. Public portal Cloudflare check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T01-47-49-508Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors.
- Docker proof: `docker ps` shows only the expected current release runtime
  set on image `business-os:v6.0.0-202606040944` plus Cloudflare, Postgres,
  and Redis containers. Local health reports source hash
  `5d419c030bf25d50`; standalone frontend build hash is `4dc16c316e9b1246`.
- Post-live hygiene: `npm.cmd --prefix ops run post-live-hygiene` passed with
  loaded dataset status, zero broad QA cleanup matches, zero smoke/action
  history cleanup matches, zero generated integrity matches, and relationship
  orphan checks passing for 49 FK candidates.
- Current plan position after Move 777: Phase 8.4 remains active for live
  route/control verification and measured load reductions; Phase 26 remains at
  51 completed organization moves; Phase 28 remains active with the R2 prune
  follow-up; Phase 29 remains active for whole-codebase schema, cleanup,
  TypeScript, runtime, and performance sweeps.

- change: lazy-load Backup destructive reset panels
- affected files:
  `frontend/src/components/utils-settings/Backup.tsx`,
  `frontend/vite.config.ts`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: normal Backup and Settings route startup, with
  destructive reset/factory reset panels deferred until advanced maintenance
  intent.
- keeper or rollback: keeper; reset behavior remains available behind the
  same UI panel, while normal route startup no longer requests the reset-tools
  chunk.
- bundle proof:
  Docker image `business-os:v6.0.0-202606040929` emits
  `Backup-D63EkRDg.js` at 50.66 KB gzip 14.21 KB,
  `Settings-D-HfFOkr.js` at 53.94 KB gzip 15.19 KB, and
  `backup-reset-tools-CTsF6z9H.js` at 10.72 KB gzip 3.01 KB.
- actual link proof:
  local trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-32-11-024Z.json` and
  real admin trace
  `ops/runtime/reports/route-load-trace-2026-06-04T01-32-11-509Z.json` passed
  Dashboard, Products, Backup, and Settings with zero failures/errors and no
  normal-route `backup-reset-tools` request. Public portal check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T01-32-13-122Z/report.json`
  rendered 20 products with zero relevant failures/errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.

- change: defer public catalog rounded-favicon canvas helper from first-load
  startup
- affected files:
  `frontend/src/components/catalog/CatalogPage.tsx`,
  `frontend/tests/performanceLoadingUx.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: public customer portal first-load catalog startup,
  public/admin route traces, and public Cloudflare portal interaction check
- keeper or rollback: keeper; the normal favicon/logo URL is applied
  immediately, while rounded canvas generation moves to an idle dynamic import
  of `utils/favicon.ts`. Rollback would be restoring the static import, which
  would re-add `favicon-utils` to the public startup path.
- bundle proof:
  production `catalog` chunk dropped from prior `catalog-CSNTiyfk.js`
  177,479 bytes to Docker release `catalog-BmR4n15a.js` at about 156.14 KB.
  Docker release image `business-os:v6.0.0-202606040838` is running with
  frontend hash `b8e3f80f8cecccf8`.
- actual link proof:
  public-host route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-40-41-174Z.json` passed
  `/public` with 24 scripts, zero failures/errors, and no first-load
  `favicon-utils` request. Local route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-40-40-630Z.json` passed
  public catalog, Dashboard, Products, and POS with zero failures/errors.
  Remote admin route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-41-02-114Z.json` passed
  Dashboard and Products with zero failures/errors. Public portal Cloudflare
  check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-40-41-123Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.

- change: short-cache static root bootstrap scripts for Cloudflare warmup
- affected files:
  `backend/src/serverUtils.ts`,
  `backend/test/serverUtils.test.ts`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: public/admin root startup scripts
  `runtime-noise-guard.js` and `theme-bootstrap.js`, Cloudflare warmup, public
  customer portal, and admin Dashboard/Products traces
- keeper or rollback: keeper; `sw.js` and `business-os-build.json` remain
  no-store, while only the two static bootstrap helpers become short-cacheable
  with `public, max-age=300, stale-while-revalidate=3600`.
- header proof:
  after Docker release `business-os:v6.0.0-202606040823` and
  `run\docker\start.bat`, real Cloudflare headers for
  `https://leangcosmetics.dpdns.org/runtime-noise-guard.js` and
  `https://leangcosmetics.dpdns.org/theme-bootstrap.js` returned
  `Cache-Control: public, max-age=300, stale-while-revalidate=3600` instead of
  the previous `no-cache, no-store, must-revalidate`.
- warmup proof:
  follow-up warmup
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-04T00-27-17-434Z.json`
  completed with `HIT: 24` and zero failed assets, proving the root bootstrap
  scripts now participate in the warmed startup cache.
- actual link proof:
  public-host route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-26-53-991Z.json` passed
  `/public` with zero failures/errors. Remote admin route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-27-19-299Z.json` passed
  Dashboard and Products with zero failures/errors. Public portal Cloudflare
  check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-27-41-981Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.

- change: add best-effort Cloudflare startup asset warmup after Docker start
- affected files:
  `ops/scripts/runtime/cloudflare/warm-cloudflare-startup-assets.ts`,
  `ops/scripts/powershell/docker-release.ps1`,
  `ops/package.json`,
  `ops/docs/OPTIMIZATION-ROADMAP.md`,
  `ops/docs/OPTIMIZATION-STATUS.md`,
  `ops/docs/OPTIMIZATION-SESSION-LOG.md`,
  `ops/docs/reference/PERFORMANCE-SCAN.md`
- route or API target: public/admin Cloudflare shell pages and their hashed
  same-origin startup scripts/styles/modulepreloads after Docker release
  health, plus actual public/admin route traces
- keeper or rollback: keeper; the warmup is read-only, bounded, and
  best-effort. It warns instead of failing startup if Cloudflare is unavailable,
  and can be disabled with `BUSINESS_OS_SKIP_CLOUDFLARE_WARMUP=1`.
- cold-edge proof:
  first standalone warmup
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-04T00-13-07-290Z.json`
  succeeded with zero failed assets and observed 16 `MISS`, 4 `HIT`, and 4
  `BYPASS` responses. Immediate second warmup
  `ops/runtime/reports/cloudflare-startup-warmup-2026-06-04T00-13-28-973Z.json`
  succeeded with zero failed assets and observed 20 `HIT` and 4 `BYPASS`
  responses.
- launcher proof:
  `run\docker\start.bat` completed successfully and wrote
  `ops/runtime/docker-release/cloudflare-startup-warmup.json`; the launcher
  report observed 20 `HIT`, 4 `BYPASS`, and zero failed assets.
- actual link proof:
  public-host route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-15-51-524Z.json` passed
  `/public` with zero failures/errors. Remote admin route trace
  `ops/runtime/reports/route-load-trace-2026-06-04T00-15-51-525Z.json` passed
  Dashboard and Products with zero failures/errors. Public portal Cloudflare
  check
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-06-04T00-15-52-108Z/report.json`
  rendered 20 products, confirmed portal bootstrap 200, confirmed AI status
  200 after interaction, and recorded zero failed responses, zero relevant
  console messages, and zero page errors.
- post-live hygiene:
  `npm.cmd --prefix ops run post-live-hygiene` passed with loaded dataset,
  zero broad QA cleanup matches, zero smoke/action-history cleanup matches,
  zero generated integrity matches, and relationship orphan checks passing for
  49 FK candidates.
