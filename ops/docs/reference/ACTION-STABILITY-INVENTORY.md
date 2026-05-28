# Action Stability Inventory

Last updated: 2026-05-18

## Current Position

This file tracks Session 2 / Phase 8 from `ops/docs/whole-app-hardening.md` and
`ops/docs/OPTIMIZATION-ROADMAP.md`.

Status:
- Phase 8.1 action inventory: saved and active.
- Phase 8.2 repeat-click checks: implemented for POS, product import, backup,
  returns, product media, catalog media, file library, profile/avatar, and
  settings save paths.
- Phase 8.3 shared busy guards: implemented for the current obvious duplicate
  set. Shared guard primitives live in `frontend/src/utils/actionGuards.mjs`
  for single-action, named-action, and keyed-action synchronous gates.
- Phase 8.4 loader recovery: started and verified for background import tracker
  polling, branch stock expansion/pagination, and transfer modal source-stock
  loading. Sales and Inventory user-filter option reads are now bounded and
  preserve previous options on auxiliary read failure. Product supplier,
  product image file-picker, and supplier return setup/inventory reads are also
  bounded and preserve still-valid data on transient read failure. Files page
  library, AI provider, and AI response reads now have explicit timeout
  contracts and no-clear refresh behavior. POS customer and delivery-contact
  option reads now use explicit timeouts, and delivery failures no longer become
  successful empty option lists. Product lookup manager modals for Categories,
  Units, and Brand now use explicit timeouts, tracked request freshness, and
  no-clear recovery for transient refresh failures. Inventory saved-reasons
  reads now use explicit timeout/no-clear recovery and remain retryable after a
  failed refresh. Inventory primary branch, stats, product summary, movement,
  and RFID status reads now use explicit timeout constants. Inventory movement
  product-detail fallback reads now use an explicit timeout before falling back
  to movement snapshot details. Products
  page auxiliary category/unit/branch reads, product filter metadata reads, and
  by-id refreshes now use explicit timeouts; failed filter metadata refreshes
  keep the previous filter set visible. Product lookup manager bulk-operation
  support reads for category/unit/brand delete, rename, undo, and restore
  snapshot flows now use explicit timeouts around lookup and full-catalog
  product fetches. Inventory secondary return/dashboard stats reads now use
  explicit timeouts without treating transient failures as zero/empty stats.
  Customer return history lookup now uses explicit timeouts and stops before
  return creation if previous-return history cannot be verified. Contacts
  all-export reads now use explicit timeouts, Loyalty customer point reads keep
  prior rows after transient failures, and Users/Roles reads no longer cache
  failed first loads as empty completed lists. Audit log, Settings OTP status,
  Server sync config, Server diagnostics, and pending sync queue helper reads now
  have explicit timeout contracts. OTP setup/confirm/disable and favicon preview
  are source-tested with explicit timeout constants but not live-clicked because
  they mutate security state or local browser assets. Catalog portal bootstrap,
  AI status, editor provider/review helpers, favicon generation, AI request, and
  membership lookup now have explicit timeout constants; Catalog membership
  transient failures keep the last confirmed lookup data visible. Loyalty
  membership lookup and Returns list/detail/snapshot helper reads now have
  explicit timeout constants. Public portal config, metadata, bootstrap, and
  product search reads now have explicit timeout constants. Remote Cloudflare
  public portal browser verification now has a dedicated Playwright checker that
  fails on visible `{"success":false}` output, internal server error text,
  portal API 5xx responses, page errors, or missing rendered product content. Receipt Settings
  save/refresh and Receipt Preview dynamic import now have explicit timeout
  constants. Branches list, summary, and transfer-history reads now have
  explicit timeout constants, and the Branches loader tracks in-flight read mode
  so a Transfer History request queues behind, rather than reuses, an in-flight
  branch-list-only refresh. Profile modal details, OTP status, verification
  capabilities, and sign-in method hydration reads now have explicit timeout
  constants. Dashboard summary and analytics reads now have explicit timeout
  constants and preserve the last valid payloads when a refresh fails.
  Inventory adjustment, move, transfer, undo/redo, and selected-product batch
  stock actions now use shared same-tick guards plus explicit 12s mutation
  timeout contracts. Product stock helper actions in the Products bulk add-stock
  modal and product-form branch stock adjuster now use the same guard/timeout
  contract around `adjustStock`. Users/Roles security actions now use shared
  same-tick guards plus explicit 12s mutation timeouts for user create/update,
  password change, role create/update/delete, and action-history undo/redo
  callbacks. Customer return create/edit, supplier-return create, Returns
  action-history restore writes, typed-confirm reset/factory-reset actions,
  Server pending-sync queue/test actions, Audit Log retention cleanup, and
  Catalog portal submission/review actions, and Products page action-history
  restore/delete plus bulk stock/write pathways now use same-tick guards or
  bounded mutation runners plus explicit write timeout contracts.
  Files AI provider actions now use shared same-tick guards plus
  explicit mutation/test timeouts for provider save, test, delete, and provider
  undo/redo callbacks. Product category manager actions now use shared
  same-tick guards plus explicit mutation timeouts for category save, delete,
  selected delete, and category undo/redo callbacks. Product unit manager
  actions now use the same guard/timeout contract for unit save, delete,
  selected delete, and unit undo/redo callbacks. Product brand manager actions
  now use a shared named-action guard plus explicit mutation timeouts for
  settings-backed brand save/delete, product brand rewiring, selected delete,
  and brand undo/redo callbacks. Product variant creation now uses a shared
  same-tick save guard plus an explicit mutation timeout around
  `createProductVariant`. The main Products page save/delete path now uses
  shared guards and explicit timeouts for product create/update, gallery image
  upload, single delete, bulk delete, and delete redo callbacks.

Execution focus:
- First harden high-risk actions that create, mutate, upload, export, restore,
  or start background jobs.
- Prefer narrow, testable guards before broad rewires.
- Keep existing data intact; any risky rework must have backup/restore proof.

## Existing Shared Guardrails

Frontend:
- `frontend/src/utils/actionGuards.mjs` provides the standard same-tick guard
  vocabulary:
  - `beginSingleAction` / `finishSingleAction`
  - `beginNamedAction` / `finishNamedAction`
  - `beginKeyedAction` / `finishKeyedAction`
- `frontend/src/api/http.ts` dedupes identical in-flight JSON writes while
  ignoring generated request/idempotency keys in the comparison.
- `frontend/src/utils/loaders.mjs` provides tracked request ids and loader
  timeouts for reads and long-running UI loads.
- `frontend/src/api/methods.js` adds `client_request_id` to many record-create
  flows and queues retryable offline POS sales.

Backend:
- `backend/src/routes/sales.js` returns the existing sale when the same
  `client_request_id` is submitted again.
- `backend/src/routes/returns.js` normalizes `client_request_id` for customer
  and supplier returns and handles duplicate-key retry results.
- `backend/src/systemJobs.js` dedupes active jobs by `dedupeKey`.
- `backend/src/routes/system/index.js` uses stable dedupe keys for Google Drive
  sync, backup export, and backup restore jobs.

## Priority Action Matrix

| Area | Representative files | Risk | Current guard | Next check |
| --- | --- | --- | --- | --- |
| POS checkout/payment | `frontend/src/components/pos/POS.jsx`, `frontend/src/api/methods.js`, `backend/src/routes/sales.js` | Duplicate sales, stock double-deduct | `checkoutInFlightRef`, `loading`, `client_request_id`, backend duplicate lookup | Add/keep source regression covering all three layers |
| Customer returns | `frontend/src/components/returns/NewReturnModal.jsx`, `frontend/src/components/returns/EditReturnModal.jsx`, `backend/src/routes/returns.js` | Duplicate returns, wrong restored stock | `submitting`, synchronous submit ref, backend idempotency for creates | Add deeper edit conflict Playwright check |
| Supplier returns | `frontend/src/components/returns/NewSupplierReturnModal.jsx`, `backend/src/routes/returns.js` | Duplicate supplier stock removal | `submitting`, synchronous submit ref, backend idempotency | Add live form-state Playwright check |
| Product import/apply | `frontend/src/components/products/import/BulkImportModal.jsx`, `frontend/src/api/methods.js`, `backend/src/routes/importJobs.js` | Multiple import jobs, repeated uploads, conflicting apply | `loading`, synchronous in-flight ref, server job state, rate limits | Add deeper server idempotency review for approve/start |
| Product media upload | `frontend/src/components/products/forms/ProductForm.jsx`, `frontend/src/api/methods.js`, `backend/src/routes/products.js` | Duplicate media, broken primary image | `saving`, `imageUploading`, synchronous upload/save refs, live-server write requirement | Add failure recovery check |
| Catalog/public media | `frontend/src/components/catalog/CatalogPage.jsx`, `frontend/src/components/catalog/CatalogEditorSurface.jsx`, `frontend/src/components/catalog/CatalogImageField.jsx` | Broken public media refs | per-block upload status, per-target synchronous upload guard | Add path ownership and retry checks |
| File library upload/delete | `frontend/src/components/files/FilePickerModal.jsx`, `frontend/src/components/files/FilesPage.jsx`, `backend/src/routes/files.js` | Duplicate assets, wrong delete | `uploading`, delete id state, synchronous upload/delete refs | Add live file-picker Playwright check |
| Backup export/restore | `frontend/src/components/utils-settings/Backup.jsx`, `backend/src/routes/system/index.js`, `backend/src/systemJobs.js` | Data loss, duplicate destructive jobs | `loading`, active job disable, backend dedupe key | Keep regression proving UI + backend job dedupe |
| Settings save | `frontend/src/components/utils-settings/Settings.jsx`, `frontend/src/AppContext.jsx`, `backend/src/routes/settings.js` | Lost config, stale overwrite | write conflict helpers, upload wait check, synchronous save/upload refs, API save queue | Add stale-conflict Playwright check |
| Profile/avatar save | `frontend/src/components/users/UserProfileModal.jsx`, `frontend/src/api/methods.js` | Duplicate avatar upload, stale profile | `savingProfile`, `savingPassword`, `uploadingAvatar`, synchronous refs, loader timeout | Add disconnected-server recovery check |

## Initial Findings

- POS checkout is already strongly guarded: the button opens a status picker,
  `handleCheckout` exits when `loading` or `checkoutInFlightRef.current` is set,
  the API layer adds a `client_request_id`, and the backend returns an existing
  sale for duplicate ids.
- Backup export/restore has both UI busy state and backend active-job dedupe.
- Bulk product import had disabled buttons, but the core handlers did not all
  have a synchronous ref guard before async work. That gap is now closed for
  retry, delete, image-only import, CSV picker/analyze, and final import start.
- Returns have local `submitting` guards and backend idempotency on creates, but
  now also have synchronous submit refs and source tests proving the guards
  remain in place. Customer return create/edit and supplier-return create writes
  also have source-tested timeout contracts. They are not live-clicked in broad
  UI checks because they mutate returns, stock, inventory movements, sales, and
  supplier compensation/loss state; loader/setup paths are still live-tested.
- File picker and file library upload/delete flows now have synchronous
  upload/delete refs. Delete refs are set before confirmation prompts to avoid
  stacking multiple confirms from rapid clicks.
- Product form image upload and product save now have synchronous refs, covering
  camera/photo/file image selection and product record save.
- Catalog portal media uploads now have a per-target synchronous guard before
  opening the file chooser, so rapid repeat upload clicks cannot stack multiple
  pickers or uploads for the same logo, cover, about block, or promo item.
- Profile account save, password save, and avatar upload now have synchronous
  refs in addition to visual saving states.
- Profile modal hydration now has bounded read contracts for profile details,
  OTP state, verification capabilities, and sign-in methods.
- Dashboard summary and analytics now have bounded read contracts and live
  range-button coverage.
- Sales status and membership actions now use shared same-tick guards plus
  explicit mutation timeouts for single status changes, bulk status changes,
  membership attach, and undo/redo callbacks.
- Branch create/update/delete, bulk delete, branch undo/redo callbacks, and
  branch stock transfer submit now use shared same-tick guards plus explicit
  mutation timeouts.
- Inventory single-product adjust, transfer, and move actions now use shared
  same-tick guards plus explicit mutation timeouts. Their action-history
  undo/redo callbacks are also bounded, and selected-product batch adjust,
  transfer, and move rows route through the same timeout helper.
- Product bulk add-stock and branch stock adjuster helpers now use shared
  same-tick guards plus explicit mutation timeouts around `adjustStock`, while
  preserving partial-success reporting in the bulk stock modal.
- Users/Roles user create/update, password change, role create/update/delete,
  and related undo/redo callbacks now use shared same-tick guards plus explicit
  mutation timeouts. Delete-role busy state is tracked per role id so repeated
  delete attempts cannot stack while one role delete is pending.
- Files AI provider create/update, test, delete, and related undo/redo callbacks
  now use shared same-tick guards plus explicit mutation/test timeout contracts.
  Delete-provider busy state is tracked per provider id, and the provider tab
  disables competing Test/Delete controls while one provider action is active.
- Product category create/update/delete, selected-category delete, and
  undo/redo callbacks now use shared same-tick guards plus bounded mutation
  contracts. Delete guards are entered before confirmation prompts so rapid
  repeat clicks cannot stack multiple delete confirmations.
- Product unit create/update/delete, selected-unit delete, and undo/redo
  callbacks now use shared same-tick guards plus bounded mutation contracts.
  Delete guards are entered before confirmation prompts so rapid repeat clicks
  cannot stack multiple delete confirmations.
- Product brand create/update/delete, selected-brand delete, product brand
  rewiring, and undo/redo callbacks now use a shared named-action guard plus
  bounded mutation contracts. Delete guards are entered before confirmation
  prompts so rapid repeat clicks cannot stack multiple delete confirmations.
- Product variant creation now uses a shared same-tick save guard plus a bounded
  mutation contract around `createProductVariant`.
- Main Products page save/delete actions now use shared same-tick guards plus
  bounded mutation contracts around product create/update, image upload, single
  delete, bulk delete, and delete redo callbacks.
- Contacts customer, supplier, and delivery create/update/delete, bulk delete,
  and undo/redo callbacks now have same-tick guards plus bounded mutation
  contracts.
- Sales export preview and CSV reads now have bounded read contracts, and the
  backend product-summary query groups by both selected product identity fields
  so Postgres does not reject the report route at runtime.
- Settings save now has a synchronous guard and disables both save buttons while
  a save is active; settings image upload now uses a keyed synchronous guard
  before opening the file picker. The API settings save queue remains in place
  for cross-component serialization.
- Phase 8.3 standardization has started without a broad churn pass:
  - bulk product import uses the shared named-action guard
  - catalog portal media uses the shared keyed-action guard
  - settings save uses the shared single-action guard
  - settings image upload uses the shared keyed-action guard
  - contact, inventory, and sales import modals use the shared single-action
    guard
  - OTP confirm/disable uses the shared single-action guard
  - customer/supplier return search/submit actions use the shared single-action
    guard
  - loyalty point rule save uses the shared single-action guard
- Runtime startup previously attempted frontend `npm ci` even when
  `frontend/dist/index.html` already existed. The Docker app command now only
  installs frontend dev dependencies when it must rebuild the frontend, avoiding
  registry timeouts on normal restarts.

## Phase 8.2 Test Targets

- Source-level regression: POS checkout must keep local ref guard, API request
  id, backend duplicate lookup, and duplicate-key recovery.
- Source-level regression: bulk import start/retry/delete/image-only/pick CSV
  actions must use a synchronous in-flight guard.
- Source-level regression: backup export/restore buttons must disable while a
  local operation or active backend backup job exists, and backend routes must
  provide `dedupeKey`.
- Source-level regression: catalog media uploads, profile save/avatar upload,
  and settings save/image upload must keep synchronous same-tick guards.
- Source-level regression: shared action guard helpers must block repeats,
  allow independent keyed actions, and release only the intended active action.
- Source-level regression: secondary import modals and OTP security actions must
  stay on the shared single-action guard.
- Source-level regression: return search/submit and loyalty point save must stay
  on the shared single-action guard.
- Live Playwright regression: visit admin locally, open representative pages,
  click high-risk buttons enough to verify disabled/busy states without
  creating duplicate business records.

## Next Session Pointer

Continue with Phase 8.4:
- Product import synchronous guard is implemented.
- `frontend/tests/actionStability.test.ts` is included in `npm run test:utils`.
- Returns, file picker/library, and product form image/save guard checks are
  implemented.
- Catalog media, profile/avatar, and settings save/upload guards are
  implemented and covered by source regression.
- Latest verification passed:
  - `node tests/performanceLoadingUx.test.ts`
  - `node tests/apiHttp.test.ts`
  - `node tests/actionGuards.test.ts`
  - `node tests/actionStability.test.ts`
  - `npm.cmd run typecheck`
  - `npm.cmd run test:utils`
  - `npm.cmd run build`
  - Playwright Contacts focused UI check on build `42f694565739` / frontend
    hash `fb6658da3dd6d8f0`: opened Contacts, clicked Customers/Suppliers/
    Delivery tabs, opened each Add modal and the import picker, verified
    `/api/customers`, `/api/suppliers`, and `/api/delivery-contacts` returned
    HTTP 200, and found zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-contacts-live-check-2026-05-17T23-16-00-164Z/report.json`.
  - Playwright Sales action UI check on build `42f694565739` / frontend hash
    `92150b9c3e7c3c06`: opened Sales, verified `/api/sales` returned HTTP 200,
    selected a real sale to reveal the bulk Done/Delivery/Cancel status
    buttons, opened sale details, confirmed membership/status controls rendered,
    and found zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-sales-actions-live-check-2026-05-17T23-25-03-542Z/report.json`.
  - Playwright Branch action UI check on build `42f694565739` / frontend hash
    `4b13d6244528d536`: opened Branches, verified `/api/branches` and
    `/api/branches/summary` returned HTTP 200, opened Add/Edit Branch modals,
    selected a branch to reveal the bulk Delete button, opened Transfer, verified
    `/api/branches/{id}/stock` returned HTTP 200, and found zero relevant
    first-party console errors. Report:
    `ops/runtime/reports/phase84-branches-actions-live-check-2026-05-17T23-36-56-531Z/report.json`.
  - Playwright Inventory action UI check on build `42f694565739` / frontend hash
    `d037ad59dbe3df46`: opened Inventory, verified
    `/api/inventory/products/search`, `/api/branches`, and
    `/api/inventory/reasons` returned HTTP 200, opened Adjust, Transfer, Move
    Stock, and Batch Session controls, switched batch rows through transfer and
    move modes, and found zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-inventory-actions-live-check-2026-05-17T23-49-24-673Z/report.json`.
  - Playwright Product stock-helper UI check on build `42f694565739` /
    frontend hash `b79c04b453d1b469`: opened Products, verified
    `/api/products/search` and `/api/branches` returned HTTP 200, opened the
    Products bulk Add Stock modal, opened a product's stock tab with the Branch
    Stock Adjuster, and found zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-stock-actions-live-check-2026-05-18T06-16-56-368Z/report.json`.
  - Playwright Users/Roles action UI check on build `42f694565739` /
    frontend hash `ce3d41a537d09333`: opened Users, verified `/api/users`,
    `/api/roles`, and `/api/action-history` returned HTTP 200, opened Add User,
    opened Change Password from a row action menu, opened Roles, verified role
    edit/delete controls rendered, opened Create Role, and found zero relevant
    first-party console errors. Report:
    `ops/runtime/reports/phase84-users-actions-live-check-2026-05-18T04-23-30-286Z/report.json`.
  - Playwright Files Providers action UI check on build `42f694565739` /
    frontend hash `cba9bab9be5dd975`: opened Files, verified `/api/files`,
    `/api/ai/providers`, `/api/ai/responses`, and `/api/action-history`
    returned HTTP 200, opened Providers, confirmed the provider form rendered
    with five provider choices, confirmed 12 existing provider rows exposed
    Edit/Test/Delete controls, and found zero relevant first-party console
    errors. Report:
    `ops/runtime/reports/phase84-files-providers-actions-live-check-2026-05-18T04-34-29-711Z/report.json`.
  - Playwright Product category-manager action UI check on build
    `42f694565739` / frontend hash `8115d343d5877c22`: opened Products,
    verified `/api/products/search`, `/api/categories`,
    `/api/products/lookups/usage`, and action-history reads returned HTTP 200,
    opened Manage Categories, confirmed Add/Delete selected controls and 24 row
    Edit/Delete controls rendered, and found zero relevant first-party console
    errors. Report:
    `ops/runtime/reports/phase84-product-categories-actions-live-check-2026-05-18T04-44-05-593Z/report.json`.
  - Playwright Product unit-manager action UI check on build `42f694565739` /
    frontend hash `c9f8b88babd005ad`: opened Products, verified
    `/api/products/search`, `/api/units`, `/api/products/lookups/usage`, and
    action-history reads returned HTTP 200, opened Manage Units, confirmed
    Add/Delete selected controls and 24 row Edit/Delete controls rendered, and
    found zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-units-actions-live-check-2026-05-18T05-00-07-865Z/report.json`.
  - Playwright Product brand-manager action UI check on build `42f694565739` /
    frontend hash `34c73c8baad40cfa`: opened Products, verified
    `/api/products/search`, `/api/products/lookups/usage`, and product-brand
    action-history reads returned HTTP 200, opened Manage Brand, confirmed
    Add/Delete selected controls plus 242 row Edit controls and 242 row Delete
    controls rendered, and found zero relevant first-party console errors.
    Report:
    `ops/runtime/reports/phase84-product-brands-actions-live-check-2026-05-18T05-11-54-559Z/report.json`.
  - Playwright Product variant action UI check on build `42f694565739` /
    frontend hash `621899c803183643`: opened Products, verified
    `/api/products/search` returned HTTP 200, opened a row action menu, opened
    Add Variant, confirmed variant name/SKU/barcode/unit/branch fields and the
    Add Variant submit button rendered, and found zero relevant first-party
    console errors. Report:
    `ops/runtime/reports/phase84-product-variant-actions-live-check-2026-05-18T05-20-26-899Z/report.json`.
  - Playwright Product page action UI check on build `42f694565739` / frontend
    hash `5718287e8b560442`: opened Products, verified `/api/products/search`
    returned HTTP 200, opened the Add Product modal, confirmed product name and
    Save controls rendered, opened a row action menu, clicked Delete, dismissed
    the confirmation dialog, observed zero product mutation requests, and found
    zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T05-48-53-308Z/report.json`.
  - Runtime local health, route contract, worker readiness, Cloudflare public
    health, and explicit protected admin-domain probe
  - Playwright focused UI check on build `42f694565739` / frontend hash `15dbf21db5b400ff`: app bootstrap/settings/meta probes, Dashboard route,
    Dashboard summary/analytics reads, `7 Days` range analytics refresh,
    Notification Center bell click and `/api/notifications/summary` read, Branch route,
    Branches list/summary reads, Stock button expansion, branch stock read,
    Transfer modal source-stock read, Transfer History tab read, Sales export
    preview read, Sales import modal render,
    Products search/filter/action-history reads, Product form supplier read, product image
    file-picker read, Supplier return setup/inventory reads, Files page library
    read, AI provider read, AI
    response read, Catalog AI provider/review reads, public portal config/meta
    product reads, Receipt Settings preview render, POS product search/category/
    branch/filter/customer/delivery/membership reads, import tracker chunk/poll, product lookup manager
    Category/Unit/Brand reads, Inventory primary product/branch/stats/movement
    reads, Inventory saved-reasons read, Inventory return/dashboard stats
    reads, Inventory import modal render, Contacts all-export reads, Contacts import modal render, Loyalty customer
    point reads, Loyalty membership lookup button read, Users/Roles reads,
    Profile modal details/OTP/capabilities/sign-in method reads, Audit log read,
    Settings OTP status read, Backup integration doctor read, Server sync config read, Server
    diagnostics read, pending sync queue render, no framework overlay, and zero
    relevant console errors.
    Report:
    `ops/runtime/reports/phase84-ui-live-check-2026-05-17T20-43-48-998Z/report.json`.
  - Runtime system smoke on build `42f694565739` / frontend hash `15dbf21db5b400ff`: product create, stock
    adjust, sale, return, transfer, dashboard, analytics, movement search,
    action history, and CSV import job start/preflight/approval/completion.
  - Local health and public Cloudflare health returned app JSON HTTP 200. The
    unauthenticated admin-domain check returned the Cloudflare Access sign-in
    page with HTTP 200, so admin app-health JSON still requires Access context.
- Current position: Phase 8.4 is active. Import tracker poll reads, import
  tracker action buttons, shared Action History helper reads, AppContext
  bootstrap/settings reads, branch stock loaders, and the transfer modal
  source-stock loader now use timeout/recovery paths that preserve visible data
  where it is still valid. Sales and Inventory
  admin user-filter option reads now retry later instead of replacing prior
  options with an empty failed read. Product supplier and supplier-return
  setup/inventory reads now preserve still-valid modal data on transient read
  failure. The product image file-picker read now has the same timeout/no-clear
  contract and is covered by live `/api/files?mediaType=image` verification.
  Dashboard summary/analytics reads now have explicit timeout/no-clear
  contracts and live verification for `/api/dashboard`, `/api/analytics`, and
  the `7 Days` range button. Contacts CRUD actions now use same-tick mutation
  guards and explicit timeout contracts across Customers, Suppliers, and
  Delivery save/delete/bulk delete plus undo/redo action-history callbacks. The
  focused Contacts Playwright check uses real tab/add/import buttons and read
  endpoints while avoiding data-mutating saves or deletes. Sales status and
  membership actions now use shared same-tick guards and explicit timeout
  contracts across single status changes, bulk status updates, membership
  attach, and undo/redo callbacks; live verification exposes the buttons and
  detail controls without submitting a mutating status or membership change.
  Branch create/update/delete, bulk delete, branch undo/redo callbacks, and
  branch stock transfer submit now use shared same-tick guards and explicit
  timeout contracts; live verification opens the Add/Edit/Transfer controls and
  source-stock read path without submitting save/delete/transfer mutations.
  Sales export preview/CSV reads now have explicit
  timeout contracts, and live verification proves `/api/sales/export` returns
  HTTP 200 from the preview button. Backup integration doctor and system-job
  status polling now have explicit timeout contracts; system-job polling backs
  off through transient status-read failures before failing the visible job
  card. Branches list/summary/transfer-history reads now have explicit timeout
  contracts and a smarter in-flight mode gate for tab-specific work.
  Files page library/provider/response reads now have explicit timeout/no-clear
  coverage and live verification for `/api/files`, `/api/ai/providers`, and
  `/api/ai/responses`. POS customer and delivery-contact option reads now have
  explicit timeout/no-clear coverage and live verification for `/api/customers`
  and `/api/delivery-contacts`. Profile modal hydration reads now have explicit
  timeout contracts and live verification for `/api/users/:id/profile`,
  `/api/auth/otp/status/:id`, `/api/auth/verification-capabilities`, and
  `/api/users/:id/auth-methods`. Inventory secondary return/dashboard stat reads
  are now bounded and live-verified through `/api/returns?scope=all` and
  `/api/dashboard`. Customer return history lookup is now bounded and fails
  closed if prior-return history cannot be verified. Contacts all-export,
  Loyalty customer point, and Users/Roles reads are now bounded and live-verified
  through `/api/customers`, `/api/suppliers`, `/api/delivery-contacts`,
  `/api/users`, and `/api/roles`. Audit log, Settings OTP status, Server sync
  config, Server diagnostics, and pending sync queue helper reads are now
  bounded and live-verified where non-mutating through `/api/system/audit-logs`,
  `/api/auth/otp/status`, `/api/system/config`, and `/api/system/debug/log`.
  Catalog editor helper reads are now bounded and live-verified through
  `/api/ai/providers` and `/api/portal/submissions/review`; Loyalty membership
  lookup is live-verified through `/api/portal/membership/{membershipNumber}`;
  public portal config/meta/product reads are live-verified through
  `/api/portal/config`, `/api/portal/catalog/meta`, and
  `/api/portal/catalog/products/search`; Receipt Settings preview import is
  live-verified by rendering the preview receipt; Returns list/detail/snapshot
  timeout contracts are source-verified. Product lookup manager Category/Unit/
  Brand snapshot and restore support reads now avoid full-catalog product
  downloads: snapshots use paged `/api/products/search` scoped to the affected
  lookup value, restore uses batched by-id product fetches, and backend product
  search supports `unit` filtering for Unit snapshots.
  Users/Roles security mutations now use same-tick guards and 12s mutation
  timeouts across user save, password change, role save/delete, and their
  undo/redo callbacks. Live verification opens the real Add User, Change
  Password, Roles, and Create Role surfaces while avoiding user/role writes.
  Files AI provider mutations now use same-tick guards and explicit timeouts
  across provider save, test, delete, and undo/redo provider callbacks. Live
  verification opens Files > Providers, verifies provider form/options plus
  existing Edit/Test/Delete controls, and avoids provider writes/deletes/tests.
  Product category manager mutations now use same-tick guards and 12s mutation
  timeouts across add, update, delete, selected delete, and undo/redo category
  callbacks. Live verification opens Products > Manage > Categories and checks
  Add/Delete selected/Edit/Delete controls without mutating categories.
  Product unit manager mutations now use same-tick guards and 12s mutation
  timeouts across add, update, delete, selected delete, and undo/redo unit
  callbacks. Live verification opens Products > Manage > Units and checks
  Add/Delete selected/Edit/Delete controls without mutating units.
  Product brand manager mutations now use a same-tick named-action guard and
  12s mutation timeouts across settings-backed add/update/delete, selected
  delete, product brand rewiring, and undo/redo brand callbacks. Live
  verification opens Products > Manage > Brand and checks Add/Delete selected/
  Edit/Delete controls without mutating brands.
  Product variant creation now uses a same-tick save guard and 12s mutation
  timeout around `createProductVariant`. `VariantFormModal.tsx` now lives under
  `frontend/src/components/products/forms`. Live verification opens a product
  row action menu, opens Add Variant, and checks the core variant form fields
  and submit button without creating a variant. Latest verified frontend hash:
  `42378a84fc53ab2f`; latest report:
  `ops/runtime/reports/phase84-product-variant-actions-live-check-2026-05-18T06-07-30-407Z/report.json`.
  Product stock-helper mutations still use same-tick guards and 12s mutation
  timeouts after `BulkAddStockModal.tsx` and `BranchStockAdjuster.tsx` moved
  under `frontend/src/components/products/forms`. Live verification opens the
  Products bulk Add Stock modal and a product stock tab with branch-stock inputs
  without submitting stock mutations. Latest verified frontend hash:
  `b79c04b453d1b469`; latest report:
  `ops/runtime/reports/phase84-product-stock-actions-live-check-2026-05-18T06-16-56-368Z/report.json`.
  Product import/apply paths still use same-tick named action guards, bounded
  import job create/upload/start/preflight reads, and worker-based CSV analysis
  after `BulkImportModal.jsx`, `productImportPlanner.mjs`, and
  `productImportWorker.mjs` moved under
  `frontend/src/components/products/import`. Live verification opens the Product
  import modal from the real Products button without starting an import. Latest
  verified frontend hash: `0028bc915078664f`; latest report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-18T06-26-02-433Z/report.json`.
  Product barcode scanning files now live under
  `frontend/src/components/products/scanning`. The scanner flow still keeps
  manual entry available when camera access is unavailable, and live
  verification opens Add Product, opens Scan barcode, applies a manual barcode
  value back to the form, and confirms no product mutation request was sent.
  Latest verified frontend hash: `4fdf242042c73694`; latest report:
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T06-38-05-695Z/report.json`.
  Main Products page save/delete actions now use shared same-tick guards and
  explicit mutation timeouts for create/update, image upload, single delete,
  bulk delete, and delete redo callbacks. Live verification opens Add Product
  and the row Delete confirmation while proving no product mutation is sent.
  File organization and language-conversion work is now tracked separately in
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`, with generated audit output in
  `ops/docs/reference/ORGANIZATION-AUDIT.md`; physical moves should proceed one
  cluster at a time with this action-stability inventory used as a regression
  checklist for affected screens. The first physical move placed Phase 8.4
  live-check scripts under `ops/scripts/runtime/live-checks`, and the Product
  page action live check passed from that new path.
  The second physical move placed product lookup modals and lookup snapshot
  helpers under `frontend/src/components/products/lookups`; the Product
  category, unit, and brand live checks passed against frontend hash
  `3296f6327bd7aa53`.
  The third physical move started `frontend/src/components/products/forms` with
  `VariantFormModal.tsx`; the Product variant live check passed against
  frontend hash `42378a84fc53ab2f`.
  The fourth physical move continued `frontend/src/components/products/forms`
  with `BulkAddStockModal.tsx` and `BranchStockAdjuster.tsx`; the Product
  stock-helper live check passed against frontend hash `b79c04b453d1b469`.
  The fifth physical move created `frontend/src/components/products/import`
  for `BulkImportModal.jsx`, `productImportPlanner.mjs`, and
  `productImportWorker.mjs`; the broad Phase 8.4 UI live check passed against
  frontend hash `0028bc915078664f`.
  The sixth physical move created `frontend/src/components/products/scanning`
  for `BarcodeScannerModal.jsx`, `barcodeImageScanner.mjs`,
  `barcodeScannerState.mjs`, and `scanbotScanner.mjs`; the Product scanner live
  check passed against frontend hash `4fdf242042c73694`.
  The seventh physical move created `frontend/src/components/products/history`
  for `productHistoryHelpers.mjs`; product history helper tests and the Product
  page action live check passed against frontend hash `db2bde8c13de0d64`.
  Latest Product page report:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T06-45-27-618Z/report.json`.
  The eighth physical move created `frontend/src/components/products/surfaces`
  for `HeaderActions.tsx`, `ProductsListSurface.tsx`, and
  `ProductDetailModal.tsx`; product discount and pagination source tests and
  the Product page action live check passed against frontend hash
  `e9b985386668bdf9`. Latest Product page report:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T06-56-46-809Z/report.json`.
  The ninth physical move created `frontend/src/components/products/shared` for
  `primitives.jsx`; Products, ProductForm, VariantForm, Product surfaces,
  Catalog, and POS imports were rewired. Product, POS, and portal catalog source
  tests, the Product page action live check, and the broad Phase 8.4 UI live
  check passed against frontend hash `21bd97f0b6d8a0df`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-05-07-502Z/report.json`
  and
  `ops/runtime/reports/phase84-ui-live-check-2026-05-18T07-05-08-089Z/report.json`.
  The tenth physical move placed the main product form at
  `frontend/src/components/products/forms/ProductForm.jsx`; action-stability
  source checks, performance-loading source checks, the Product page action live
  check, and the Product scanner live check passed against frontend hash
  `d1de3f08c3064e4d`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-15-06-244Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T07-15-06-876Z/report.json`.
  The eleventh physical move placed Products page config constants at
  `frontend/src/components/products/config/productPageConfig.mjs`; source tests
  now verify the timeout values there while `Products.jsx` imports the same
  constants. The Product page action live check and Product scanner live check
  passed against frontend hash `e0871873ba445219`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-23-57-202Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T07-23-57-736Z/report.json`.
  The twelfth physical move placed Products page helper functions at
  `frontend/src/components/products/helpers/productPageHelpers.mjs`; the module
  now owns the debounce hook, brand color map parsing, brand lookup
  normalization, and next-frame scheduling helper. Helper source tests, source
  checks, typecheck, production build, runtime health, Product page action live
  check, and Product scanner live check passed against frontend hash
  `a440b744817036af`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-37-55-558Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T07-37-56-183Z/report.json`.
  The thirteenth physical move placed product gallery helper functions at
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`; the
  module now owns gallery normalization, product gallery fallback selection, and
  public product image URL resolution. Helper source tests, source checks,
  typecheck, production build, runtime health, Product page action live check,
  and Product scanner live check passed against frontend hash
  `ff7f953e9b217168`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-44-21-214Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T07-44-21-748Z/report.json`.
  The fourteenth physical move placed product row presentation helpers at
  `frontend/src/components/products/surfaces/ProductRowParts.jsx`; the module
  now owns the discount badge, row action menu wrapper, batch preview chips, and
  desktop details cell. Source checks, typecheck, production build, runtime
  health, Product page action live check, and Product scanner live check passed
  against frontend hash `f04520d849d51963`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-49-58-972Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T07-49-59-555Z/report.json`.
  The fifteenth physical move placed product filter/export helper logic at
  `frontend/src/components/products/helpers/productFilterHelpers.mjs`; the
  module now owns search-term parsing, branch quantity lookup, filtered product
  selection, and product CSV export row shaping. Focused helper tests, source
  checks, typecheck, production build, runtime health, Product page action live
  check, and Product scanner live check passed against frontend hash
  `8a33b1bdd672f31c`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T07-57-37-897Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T07-57-38-542Z/report.json`.
  The sixteenth physical move placed product selection/pagination helper logic
  at `frontend/src/components/products/helpers/productSelectionHelpers.mjs`;
  the module now owns visible id extraction, selected-visible id resolution,
  pagination summary math, selected product filtering, letter jump targets, and
  selection-scope predicates. Focused helper tests, source checks, typecheck,
  production build, runtime health, Product page action live check, and Product
  scanner live check passed against frontend hash `f0b69a89f50f0e7f`. Latest
  reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T08-05-32-858Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T08-05-33-395Z/report.json`.
  The seventeenth physical move placed product group view helper logic at
  `frontend/src/components/products/helpers/productGroupViewHelpers.mjs`; the
  module now owns grouped product price labels and grouped summary chip text.
  Focused helper tests, source checks, typecheck, production build, runtime
  health, Product page action live check, and Product scanner live check passed
  against frontend hash `5781a6bf1ff07e16`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T08-15-11-132Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T08-15-11-433Z/report.json`.
  The eighteenth physical move placed product display data helper logic at
  `frontend/src/components/products/helpers/productDisplayHelpers.mjs`; the
  module now owns lookup map construction, merged brand options, branch id/name
  maps, branch summary labels, and stock-status classification. Focused helper
  tests, source checks, typecheck, production build, runtime health, Product
  page action live check, and Product scanner live check passed against
  frontend hash `6039db439c681904`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T08-23-18-728Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T08-23-19-093Z/report.json`.
  The nineteenth physical move placed product menu metadata helper logic at
  `frontend/src/components/products/helpers/productMenuHelpers.mjs`; the module
  now owns export menu item construction, supplier filter option normalization,
  and active filter count calculation. Focused helper tests, source checks,
  typecheck, production build, runtime health, Product page action live check,
  and Product scanner live check passed against frontend hash
  `2641f1ce0445f430`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T08-30-24-825Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T08-30-25-343Z/report.json`.
  The twentieth organization move placed Product filter menu section builder
  logic in `frontend/src/components/products/helpers/productMenuHelpers.mjs`;
  the module now also owns year/month, branch, group, stock, category, brand,
  and supplier filter section construction. Focused helper tests, source
  checks, typecheck, production build, runtime health, Product page action live
  check, and Product scanner live check passed against frontend hash
  `b96c2bf7d1b6c06e`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T08-57-33-328Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T08-57-32-749Z/report.json`.
  The twenty-first organization move placed product row display state helper
  logic in `frontend/src/components/products/helpers/productDisplayHelpers.mjs`;
  the module now also owns purchase-price fallback, margin math, visible stock
  quantity, promotion calculation, compact brand/category metadata, branch
  labels, and mobile stock badge presentation. Focused helper tests, source
  checks, typecheck, production build, runtime health, Product page action live
  check, and Product scanner live check passed against frontend hash
  `8426a118f46c25cc`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T09-05-16-081Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T09-05-15-503Z/report.json`.
  The twenty-second organization move placed product lightbox state
  construction in
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`; the
  module now also owns lightbox image URL resolution, empty-gallery handling,
  and safe start-index clamping. Focused helper tests, source checks,
  typecheck, production build, runtime health, Product page action live check,
  and Product scanner live check passed against frontend hash
  `3469c4d8b3425629`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T09-14-19-027Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T09-14-18-477Z/report.json`.
  The twenty-third organization move placed product lightbox index update logic
  in `frontend/src/components/products/helpers/productGalleryHelpers.ts`; the
  module now also owns reusable lightbox index clamping and active lightbox
  index updates. `Products.jsx` delegates gallery index changes to that helper
  and no longer carries the disabled legacy `false && lightbox` overlay branch.
  Focused helper tests, source checks, typecheck, production build, runtime
  health, Product page action live check, and Product scanner live check passed
  against frontend hash `713180d4d834b1ce`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T09-22-02-891Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T09-22-03-500Z/report.json`.
  The twenty-fourth organization move placed product detail lightbox
  gallery-input fallback in
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`; the
  module now owns the detail-modal decision to prefer a normalized clicked
  gallery or fall back to the clicked source image. Focused helper tests,
  source checks, typecheck, production build, runtime health, Product page
  action live check, and Product scanner live check passed against frontend
  hash `ce63c5f06c94a85e`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T09-29-02-043Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T09-29-01-475Z/report.json`.
  The twenty-fifth organization move placed product thumbnail state
  construction in
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`; the
  module now owns the normalized row gallery, `hasImage` flag, and first
  thumbnail path used by desktop and mobile product rows. Initial live
  verification exposed a stale removed callback dependency that crashed
  Products before `/api/products/search`; diagnostic Playwright confirmed the
  root cause, the dependency was removed, and final Product page action and
  Product scanner live checks passed against frontend hash
  `3e2b508f0b07839b`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T09-39-43-267Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T09-39-43-286Z/report.json`.
  The twenty-sixth organization move placed product collection index
  construction in
  `frontend/src/components/products/helpers/productSelectionHelpers.mjs`; the
  module now owns product id map construction and parent-product id set
  construction for grouping and filtering. Focused helper tests, source checks,
  typecheck, production build, performance verification, runtime health,
  Product page action live check, and Product scanner live check passed against
  frontend hash `d225ee10885691f9`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-06-48-335Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-06-48-947Z/report.json`.
  The twenty-seventh organization move placed product restore/write payload
  construction in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  module now owns normalized gallery/image fields, price fallbacks, stock
  thresholds, active/group flags, parent ids, and user attribution for
  undo/redo restore and deleted-product recreation flows. Focused helper tests,
  source checks, typecheck, production build, performance verification, runtime
  health, Product page action live check, and Product scanner live check passed
  against frontend hash `87ac9fa332bb6004`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-16-30-330Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-16-29-776Z/report.json`.
  The twenty-eighth organization move placed product branch-stock restore
  adjustment planning in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper now compares snapshot branch stock with current branch stock, ignores
  invalid branch ids, treats invalid quantities as zero, and returns only the
  add/remove deltas needed for restore. Focused helper tests, source checks,
  typecheck, production build, performance verification, runtime health,
  Product page action live check, and Product scanner live check passed against
  frontend hash `f8c95fdbb7171cff`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-22-03-113Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-22-03-677Z/report.json`.
  The twenty-ninth organization move placed deleted-product restore planning
  helpers in `frontend/src/components/products/helpers/productWriteHelpers.mjs`;
  the module now owns default branch selection, deleted-id set construction,
  preferred restore branch selection, and parent-id remapping for deleted
  parent/variant batches. Focused helper tests, source checks, typecheck,
  production build, performance verification, runtime health, Product page
  action live check, and Product scanner live check passed against frontend
  hash `f355894dc1465d5c`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-26-31-806Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-26-31-812Z/report.json`.
  The thirtieth organization move placed product clear-stock adjustment
  planning in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper now filters invalid branch ids, ignores zero/invalid quantities,
  resolves purchase/cost unit prices once, and returns only valid branch stock
  removal adjustments for the bulk out-of-stock path. Focused helper tests,
  source checks, typecheck, production build, performance verification, runtime
  health, Product page action live check, and Product scanner live check passed
  against frontend hash `2fbb7e7e9a4dee2c`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-30-57-190Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-30-56-554Z/report.json`.
  The thirty-first organization move placed product branch-move planning in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper now identifies a valid positive-stock source branch, returns an
  explicit transfer plan, returns an initialize plan when no positive stock
  exists, and returns no-op when the product is already in the target branch.
  Focused helper tests, source checks, typecheck, production build, performance
  verification, runtime health, Product page action live check, and Product
  scanner live check passed against frontend hash `749aede9830d88e9`. Latest
  reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-34-58-058Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-34-58-044Z/report.json`.
  The thirty-second organization move placed product bulk-run summary logic in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper now extracts positive finite success and failure ids from concurrent
  runs and returns one stable summary shape for bulk delete, bulk add stock,
  bulk branch move, and bulk update flows. A focused helper test caught the
  `Number(null) === 0` edge, so zero ids are rejected explicitly. Focused
  helper tests, source checks, typecheck, production build, performance
  verification, runtime health, Product page action live check, and Product
  scanner live check passed against frontend hash `8e1cbcfe93564245`. Latest
  reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-41-06-205Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-41-06-734Z/report.json`.
  The thirty-third organization move placed product bulk-update payload
  construction in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper now removes only `undefined` update fields, preserves intentional
  `null` and blank-string values, attaches user attribution, and selects the
  current optimistic-lock timestamp before falling back to a snapshot timestamp
  for redo. Focused helper tests, source checks, typecheck, production build,
  performance verification, runtime health, Product page action live check, and
  Product scanner live check passed against frontend hash
  `b7f08da087125792`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-52-03-286Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-52-22-845Z/report.json`.
  The thirty-fourth organization move placed product bulk edit update builders
  in `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  info helper now keeps populated category, unit, supplier, brand, and valid
  low-stock threshold values while ignoring blank fields and unsafe threshold
  text, and the pricing helper normalizes only provided price fields through
  the shared price normalizer. Focused helper tests, source checks, typecheck,
  production build, performance verification, runtime health, Product page
  action live check, and Product scanner live check passed against frontend
  hash `2b36f4913641bbb3`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-58-35-415Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-58-53-410Z/report.json`.
  The thirty-fifth organization move placed product stock adjustment payload
  construction in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper now normalizes product ids, product names, branch ids, quantities,
  reasons, user attribution, and unit-cost fallback/override behavior for bulk
  add-stock and clear-stock execution paths. A diagnostic Playwright probe
  confirmed the Add Product modal opened after one transient live-check wait
  timeout; the focused Product page and scanner checks then passed on the same
  bundle. Focused helper tests, source checks, typecheck, production build,
  performance verification, runtime health, Product page action live check, and
  Product scanner live check passed against frontend hash
  `48b70424364d4ee8`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T11-06-37-891Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T11-07-19-685Z/report.json`.
  The thirty-sixth organization move completed Product-page adjust-stock
  payload delegation. Restore branch-stock sync, deleted-product stock restore,
  clear-stock, bulk add-stock, and branch initialization now build
  `window.api.adjustStock(...)` payloads through
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper supports snapshot product-name overrides and zero-quantity branch
  initialization while preserving purchase/cost unit-cost fallback behavior.
  Focused helper tests, source checks, typecheck, production build,
  performance verification, runtime health, Product page action live check, and
  Product scanner live check passed against frontend hash
  `543cc58df3c2b094`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T11-12-56-006Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T11-13-11-426Z/report.json`.
  The thirty-seventh organization move placed product transfer-stock payload
  construction in
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`; the
  helper maps branch-move plans into `fromBranchId`, `toBranchId`, quantity,
  product identity, note, and user attribution for bulk branch transfers. A
  focused helper test caught invalid branch-id normalization before build
  verification, so transfer branch ids now use the shared finite-number
  normalizer. Focused helper tests, source checks, typecheck, production build,
  performance verification, runtime health, Product page action live check, and
  Product scanner live check passed against frontend hash
  `875d7a0928f443de`. Latest reports:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T11-20-43-909Z/report.json`
  and
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T11-21-12-558Z/report.json`.
  Custom Tables helper reads/actions now use explicit timeout constants and
  same-tick mutation guards for table creation, row save, row delete, and
  undo/redo row actions. The component is not currently mounted in the main app
  shell, so live verification used authenticated Playwright plus
  `window.api.getCustomTables()` to assert `/api/custom-tables` returns HTTP 200
  and an array without first-party console errors.
  Next continue through visible operational loaders that still issue direct
  reads or clear existing data during refresh failures.

## Phase 8.4 Loader Recovery Notes

Started:
- Background import tracker poll reads now use `withLoaderTimeout` and backoff
  while preserving the last visible jobs when a poll fails.
- Branch stock expansion and "show more stock" reads now use
  `withLoaderTimeout`; failures warn the user without clearing already loaded
  branch stock rows.
- Transfer modal source-stock reads now use an explicit timeout, request a
  bounded positive-stock page, normalize paged payloads, and avoid clearing
  already loaded products on refresh failure. Selecting a different source
  branch still clears stale source rows before the new branch load.
- Sales and Inventory user-filter option reads now wrap `getUsers()` with an
  explicit 8s timeout. Failed auxiliary reads preserve previous options and
  leave the loaded flag retryable instead of caching an empty option list.
- Product form supplier option reads now wrap `getSuppliers()` with an explicit
  8s timeout and preserve previous supplier suggestions on read failure.
- Product image file-picker reads now wrap `getFiles({ mediaType: 'image' })`
  with an explicit 8s timeout and do not clear the current picker contents after
  a transient library read failure.
- Files page library reads now use an explicit 10s timeout for paged
  `getFiles({ includeMeta: true })` requests.
- Files page AI provider and response reads now use explicit 8s timeouts and
  preserve the currently visible providers, provider metadata, and saved
  responses after transient refresh failures.
- Files page and shared FilePicker asset uploads/deletes now keep their
  same-tick upload/delete guards and wrap write calls in explicit timeout
  contracts. The Files selected-assets toolbar now uses the imported `Download`
  icon instead of an undefined `Save` symbol.
- Settings and Catalog media uploads now keep keyed same-tick guards, abort
  controllers, progress updates, and preview rollback while wrapping
  `uploadFileAsset(...)` in explicit 30s timeout contracts.
- POS customer and delivery-contact option reads now use an explicit 8s timeout.
  Failed customer refreshes keep the current customer options, and delivery
  contacts no longer use an inline `.catch(() => [])` fallback that could blank
  valid delivery options after a transient failure.
- Supplier return setup reads now timeout branch/supplier setup, while inventory
  reads timeout branch inventory summary. Setup failure preserves existing
  branch/supplier options; same-branch inventory failure preserves already
  loaded products. Selecting a different branch still clears stale product rows.
- Inventory secondary stat reads now timeout `getReturns({ scope: 'all' })` and
  `getDashboard()` with explicit 12s contracts. Failed secondary refreshes leave
  the last confirmed return/refund/tax/delivery stats intact instead of turning
  the stat cards into successful zero/empty values.
- Inventory primary reads now use explicit timeout constants for branch options,
  SQL-backed inventory stats, paged product summaries, movement history, and
  RFID status. Live verification exercises the Products, Stats, and Movements
  tabs and asserts the backing API reads return HTTP 200.
- Customer return history lookup now timeouts `getReturns({ saleId })` with an
  explicit 10s contract and stops before item selection if the app cannot verify
  previous returns for the sale.
- Contacts all-export now timeouts customer, supplier, and delivery-contact reads
  with explicit 12s contracts while still allowing partial export warnings when
  only some groups are available.
- Loyalty customer point reads now timeout `getCustomers()` with an explicit 12s
  contract and preserve the last visible point rows after transient failures.
- Users and Roles list reads now use explicit 8s timeout constants. Initial read
  failures show the load error but leave the loaded flags retryable instead of
  caching empty completed lists.
- Audit log reads now use an explicit 20s timeout constant.
- Settings OTP status reads now use an explicit 8s timeout constant. Favicon
  preview generation now uses an explicit 8s timeout constant.
- OTP setup, confirmation, and disable reads now use explicit 12s timeout
  constants. They are source-tested only because clicking them live changes
  account security state.
- Server pending sync queue, sync config, and diagnostics reads now use explicit
  timeout constants. Pending sync queue is a local helper read, while sync config
  and diagnostics are live-verified through HTTP.
- Catalog portal bootstrap, AI status, editor AI provider/review helpers,
  favicon generation, AI request, and membership lookup now use explicit timeout
  constants. Transient Catalog membership lookup failures now keep the last
  confirmed membership data visible instead of blanking it.
- Loyalty membership lookup now uses an explicit 12s timeout.
- Returns list, detail, and snapshot helper reads now use explicit timeout
  constants.
- Public portal config, metadata, bootstrap, and product search reads now use
  explicit timeout constants.
- Remote Cloudflare public portal browser verification now opens
  `https://leangcosmetics.dpdns.org/public`, confirms customer portal content
  and visible product entries render, verifies portal config/meta/search/AI
  endpoints return HTTP 200, and rejects visible internal-server-error JSON.
- Receipt Settings save/refresh and Receipt Preview dynamic import now use
  explicit timeout constants.
- Sales export preview and CSV reads now use explicit timeout constants. The
  backend export product summary now groups by `si.product_name, si.product_id`
  and coalesces item cost aggregation so the report route remains valid under
  Postgres.
- Backup integration doctor quick/deep reads now use explicit timeout
  constants, and Backup system-job status polling now uses bounded status reads
  with capped transient-failure backoff.
- Backup Google Drive and job actions now use explicit timeout contracts for
  sync preference save, OAuth start, manual sync queueing, disconnect,
  credential forget, backup export/restore queueing, and system-job
  cancellation. Existing Backup action locks remain in place, so repeated
  clicks cannot queue overlapping Drive or backup job requests.
- Product bulk-import cancelled-job recovery now wraps `getImportJob(jobId)` in
  an explicit timeout. Product modal apply and tracker approve paths also wrap
  `preflightImportJob(...)` in explicit timeout contracts. The live checker opens
  Products > Import and confirms the import modal renders, while runtime smoke
  calls `/api/import-jobs/{id}/preflight` before approving a live import job.
- Product bulk-import CSV and image-only pipelines now wrap import-job creation,
  CSV manifest upload, ZIP/browser image uploads, and job start in explicit
  timeout constants. Cancel checks remain immediately before server preflight and
  job start so user cancellation cannot fall through into queued server work.
- Background Import Tracker action buttons now use the shared same-tick action
  guard plus explicit timeout constants for cancel, retry, approve,
  error-download, and remove. The approve path keeps the explicit preflight
  timeout before the approve call; remove releases the guard even when the
  confirmation dialog is cancelled.
- Shared Action History recent-history and admin user-filter reads now use
  explicit timeout constants. History and user-option responses are ignored when
  stale, and transient user-option read failures preserve the current filter
  options instead of replacing them with an empty list.
- AppContext app settings and auth bootstrap reads now use explicit timeout
  constants. Startup, login, OTP login, runtime refresh, and auth-recovery
  bootstrap calls all go through the same timeout helper, and transient settings
  refresh failures preserve the current settings snapshot instead of resetting
  the shell to defaults.
- Notification Center summary reads now wrap `getNotificationSummary()` in an
  explicit timeout. The live checker clicks the app-shell notification bell,
  waits for the searchable panel, and observes HTTP 200 for
  `/api/notifications/summary`.
- POS catalog bootstrap reads now wrap the batched product search, category,
  branch, and product-filter requests in an explicit timeout. The live checker
  opens POS and observes HTTP 200 for `/api/products/search`, `/api/categories`,
  `/api/branches`, and `/api/products/filters`.
- POS membership lookup now wraps `lookupPortalMembership(...)` in an explicit
  timeout and preserves the current same-member membership panel after a
  transient refresh failure. The live checker selects a real customer with a
  membership number in POS and observes HTTP 200 for `/api/portal/membership`.
- Contact, Sales, and Inventory import modals now wrap import-job creation, CSV
  upload, and job start in explicit timeout constants. The existing single-action
  guards still block duplicate submits, and the live checker opens each import
  modal through its real UI path without queuing a job.

Verified:
- `frontend/tests/performanceLoadingUx.test.ts` checks tracker timeout usage,
  tracker no-clear behavior, branch stock timeout usage, and transfer modal
  timeout/no-clear behavior. It now also checks Sales and Inventory user-filter
  option timeout/no-clear behavior, Product form supplier option timeout/no-clear
  behavior, product image file-picker timeout/no-clear behavior, Files page
  library/provider/response timeout/no-clear behavior, POS customer/delivery
  option timeout/no-clear behavior, Supplier return setup/inventory
  timeout/no-clear behavior, and secondary import modal create/upload/start
  timeout coverage. It now also checks Background Import Tracker cancel, retry,
  approve, error-download, and remove action timeout coverage, plus shared
  Action History timeout, stale-response, and no-clear user-option coverage.
  It now also checks AppContext settings/bootstrap timeout coverage and the
  settings no-clear fallback. It now also checks Inventory primary branch,
  stats, product summary, movement, and RFID timeout constants.
- `frontend/tests/actionStability.test.ts` checks the Background Import Tracker
  same-tick action guard wiring for cancel, retry, approve, error-download, and
  remove, including direct calls through `beginTrackerAction(...)`.
- `frontend/tests/apiHttp.test.ts` keeps the import tracker in the read-only
  530/fallback/backoff coverage.
- Focused Playwright UI check clicked the Branch stock button against the live
  local runtime and observed HTTP 200 for both `background-import-tracker` and
  `/api/import-jobs?limit=8`; the same script opened the Transfer modal and
  observed HTTP 200 for `/api/branches/{id}/stock?page=1&pageSize=50&stockState=positive`.
  It also opened Product form and Supplier return modal, observing HTTP 200 for
  `/api/suppliers`, `/api/files?mediaType=image`,
  `/api/files?mediaType=all&page=1&pageSize=24&includeMeta=true`,
  `/api/ai/providers`, `/api/ai/responses?limit=80`, and
  `/api/customers`, `/api/delivery-contacts`, and
  `/api/inventory/summary?branchId={id}`.
- A dedicated Playwright Files action loop now opens `/files`, uploads a
  temporary CSV through the real Library file input, searches for the uploaded
  file, deletes it through the card Delete button with dialog confirmation, and
  confirms the file disappears. Upload, list, and delete each returned HTTP 200
  with zero relevant console errors.
- A dedicated Settings media upload loop now opens `/settings`, expands Browser
  tab icon, uploads a temporary PNG through Upload Image, confirms the favicon
  field is populated, then removes that uploaded asset through Library. Upload,
  list, and delete each returned HTTP 200 with zero relevant console errors.
- A dedicated Product form image upload loop now opens `/products`, opens Add
  Product, clicks Choose File, uploads a temporary PNG through the real product
  image input, confirms `/api/products/upload-image` returns HTTP 200, confirms
  the preview image renders in the modal, then deletes the uploaded file asset
  through the API. Upload and cleanup each returned HTTP 200 with zero relevant
  console errors.
- A dedicated AppContext auth/settings loop now starts from a fresh browser
  context, signs in through the visible Login form, confirms
  `/api/auth/login` and the post-login `/api/auth/bootstrap` return HTTP 200,
  opens `/settings`, clicks Save, and confirms the server settings write returns
  HTTP 200. The expected pre-login bootstrap 401 is ignored; the authenticated
  flow completed with zero relevant console errors.
- A dedicated POS write loop now opens `/pos`, clicks the visible quick-add
  customer button, creates a temporary customer through the modal, confirms
  `/api/customers` returns HTTP 200, toggles Delivery on, clicks the delivery
  quick-add button, creates a temporary rider through the modal, confirms
  `/api/delivery-contacts` returns HTTP 200, and deletes both temporary records
  through their API cleanup routes. One temporary customer left by a failed
  selector probe was also cleaned before the passing run. Checkout sale creation
  remains source-tested rather than live-clicked because it mutates sales,
  receipts, stock, inventory, and customer ledger state.
- Return create/edit/supplier-return writes now have explicit timeout contracts
  around the mutating API calls. These paths remain source-tested rather than
  live-clicked in the broad UI check because they mutate returns, stock,
  inventory movements, sale state, and supplier compensation/loss accounting;
  return list/detail/snapshot and supplier-return setup/inventory paths remain
  live-tested.
- Returns action-history undo/redo restore now wraps `updateReturn(...)` in an
  explicit timeout and same-tick guard. It remains source-tested because a live
  restore click rewrites return state and can cascade into inventory, stock
  movement, sale, and accounting changes.
- Business-data reset and factory reset now wrap the typed-confirm destructive
  calls in explicit timeout contracts and same-tick guards. They remain
  source-tested only because live-clicking them would intentionally delete
  production business data and uploaded assets.
- Server pending-sync queue retry/discard and manual sync-server connection
  test actions now wrap their API calls in explicit timeout contracts and
  same-tick guards. The broad live check opens the Server page and verifies the
  helper reads; queue mutations remain source-tested because they can replay or
  discard locally pending writes.
- Audit Log retention cleanup now wraps the admin "Clear 30d" delete call in an
  explicit timeout contract and same-tick guard. The broad live check opens the
  Audit Log and verifies the helper reads; cleanup remains source-tested because
  live-clicking it deletes audit history.
- Catalog portal share-proof submission creation and staff submission review
  now wrap their portal write calls in explicit timeout contracts and same-tick
  guards. The broad live check exercises catalog/public portal reads; submission
  writes remain source-tested because live-clicking them creates customer
  submission/reward-review records.
- Main Products page action-history restore/delete, deleted-product restore,
  bulk update, clear-stock, add-stock, and branch-move stock pathways now route
  through bounded product write/delete/stock mutation runners. These remain
  source-tested because live-clicking them rewrites product, stock, inventory,
  and action-history state. The broad Phase 8.4 Playwright UI check still opens
  Products, confirms search/filter/action-history reads, opens the product
  import modal, and passed on frontend hash `70927cf691f499db` with zero
  relevant console messages.
- The focused Playwright UI check also opened Products > Manage > Categories,
  Products > Manage > Units, and Products > Manage > Brand, observing HTTP 200
  for `/api/categories`, `/api/units`, and
  `/api/products/lookups/usage` while confirming the modals rendered.
- The focused Playwright UI check now also opens Inventory, selects visible
  product rows, clicks Reasons, confirms the Saved reasons modal renders, and
  observes HTTP 200 for `/api/inventory/reasons`. It also observes HTTP 200 for
  `/api/inventory/products/search` and `/api/branches`, then switches Inventory
  to Stats and Movements and observes HTTP 200 for `/api/inventory/stats`,
  `/api/returns?scope=all`, `/api/dashboard`, and `/api/inventory/movements`.
- The focused Playwright UI check now also clicks Contacts all-export and
  observes HTTP 200 for `/api/customers`, `/api/suppliers`, and
  `/api/delivery-contacts`; opens Loyalty and observes HTTP 200 for
  `/api/customers`; and opens Users/Roles with HTTP 200 for `/api/users` and
  `/api/roles`.
- The focused Playwright UI check now also opens Audit log, Settings, and Server
  pages, observing HTTP 200 for `/api/system/audit-logs`,
  `/api/auth/otp/status/{id}`, `/api/system/config`, and
  `/api/system/debug/log`, plus a rendered pending sync queue state.
- The focused Playwright UI check now also opens Catalog and observes HTTP 200
  for `/api/ai/providers` and `/api/portal/submissions/review`, then opens
  Loyalty, types a real membership number into the lookup field, clicks the
  lookup button, and observes HTTP 200 for `/api/portal/membership/{number}`.
- The focused Playwright UI check now also opens `/public`, observing HTTP 200
  for `/api/portal/config`, `/api/portal/catalog/meta`, and
  `/api/portal/catalog/products/search`; it opens Receipt Settings and confirms
  the live preview receipt renders.
- The focused Playwright UI check now also opens Sales > Export > Detailed sales
  report, clicks Preview Summary, observes HTTP 200 for `/api/sales/export`, and
  waits for the modal-scoped Accounting Summary to render.
- The focused Playwright UI check now also opens Backup, switches to Doctor,
  observes HTTP 200 for `/api/system/integration-doctor`, and confirms the
  doctor controls render.
- In-app browser verification now opens Backup > Google Drive, saves the Drive
  sync preferences, queues a real `google_drive_sync` job with Sync now,
  cancels that job from the Backup page, captures the cancellation state, and
  observes zero relevant console errors.
- The focused Playwright UI check now also opens Products > Import and confirms
  the Products + CSV import modal renders, covering the user-facing import
  button path while leaving CSV upload/start actions untouched.
- The focused Playwright UI check now also asserts Products page
  `/api/action-history` returns HTTP 200, and the observed request log captures
  additional Action History reads for global, product lookup, inventory,
  returns, profile, and backup scopes.
- The focused Playwright UI check now probes `/api/auth/bootstrap`,
  `/api/settings`, and `/api/settings/meta` with the authenticated session and
  reports each as HTTP 200 before starting the broader browser walk.
- Runtime system smoke now creates a product import job, uploads CSV, starts it,
  waits for review, calls preflight, approves, waits for completion, and searches
  for the imported product.
- Tracker cancel/retry/remove/error-download buttons are not live-clicked in the
  broad UI check because they mutate jobs or download files; their guard/timeout
  paths are source-tested, and the runtime smoke covers the safe import-job
  action chain through approve.

Next:
- Continue across smaller modal/read surfaces that still have direct read calls,
  prioritizing visible operational panes over one-off admin helpers. Likely next
  candidates are remaining full-catalog helper reads and smaller modal/helper
  panes.
