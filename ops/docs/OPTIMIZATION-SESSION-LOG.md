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
  `frontend/src/components/files/FilesPage.jsx`,
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
