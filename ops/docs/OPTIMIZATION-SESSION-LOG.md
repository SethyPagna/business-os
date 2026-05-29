# Business OS Optimization Session Log

Last updated: 2026-05-16

This is a concise running log of what actually happened in recent sessions.

## 2026-05-16

### Accepted

- Notification summary server-side cache
  - area: `backend/src/routes/notifications.js`
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
  - area: `backend/src/services/importJobs.js`
  - result: kept
  - note: repeated dashboard/import tracker polling now reuses short-lived
    settled job lists

### Rejected

- Branches delayed action-history hydration
  - area: `frontend/src/components/branches/Branches.jsx`
  - result: rejected
  - note: copied the delayed history pattern from Customers, but desktop
    Branches document time got much worse in the real route audit

- Notification-center delayed summary fetch
  - area: `frontend/src/components/shared/NotificationCenter.tsx`
  - result: rejected
  - note: looked like a shared-background win, but Products route timing
    regressed once it was validated live

- Returns cached display-field reuse
  - area: `frontend/src/components/returns/Returns.jsx`
  - result: rejected
  - note: precomputing row display fields did not survive warm reruns and made
    Returns slower

- Returns global mobile deferred-card threshold
  - area: `frontend/src/components/returns/ReturnsListSurface.jsx`
  - result: rejected
  - note: making the mobile deferred-card threshold global across groups made
    both desktop and mobile Returns slower in the real route audit

- Products orphaned load-promise bookkeeping removal
  - area: `frontend/src/components/products/Products.jsx`
  - result: rejected
  - note: looked like dead bookkeeping, but real route timings regressed once
    the verify worktree runtime was recreated correctly

- Backup version hard timeout fallback
  - area: `backend/src/services/backupPackages.js`
  - result: rejected
  - note: targeted backup API improved, but warm exhaustive reruns woke
    unrelated pockets

- Mobile public-catalog background panel unmounting
  - area: `frontend/src/components/catalog/CatalogPage.jsx`
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
  `frontend/src/components/contacts/CustomersTab.jsx`
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
  `frontend/src/components/contacts/CustomersTab.jsx`,
  `frontend/src/components/contacts/SuppliersTab.jsx`,
  `frontend/src/components/contacts/DeliveryTab.jsx`
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
