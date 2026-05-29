# Whole-App Hardening And Reliability Program

Last updated: 2026-05-18

## Baseline

- `cmd /c run\verify-local.bat` passed on 2026-04-30 before Session 1 edits.
- Frontend build, frontend utility tests, i18n verification, UI verification, and backend utility/security/core tests were green.
- Known local-only artifacts remain untracked and intentionally excluded from commits: `output/` and root `package.json`.
- Browser-wrapper or extension errors that reference injected `vendor.js`, `content.js`, `VM####`, or Grammarly scripts are tracked separately from first-party app errors.

## Session Checklist

- [x] Session 1: Add a tracked master report/checklist and capture baseline risks.
- [x] Session 1: Patch immediate route-level authorization and action-history ownership gaps found during baseline inspection.
- [ ] Session 2: Finish loader/action stability sweeps across all remaining pages and high-risk buttons.
- [ ] Session 3: Deepen auth, authorization, session, OTP, reset, and local-storage security coverage.
- [ ] Session 4: Standardize route validation, upload/CSP/network hardening, and secrets handling.
- [ ] Session 5: Review transactions, optimistic locking, idempotency, indexes, websocket ordering, and sync races.
- [ ] Session 6: Add performance budgets and optimize runtime responsiveness.
- [ ] Session 7: Complete portal dark mode, translation, tag polish, and public/editor wiring checks.
- [ ] Session 8: Complete server-backed undo/redo and action-history integrity for reversible flows.
- [ ] Session 9: Clean duplicate/dead code, dependency hygiene, run/release scripts, and generated references.
- [ ] Session 10: Final threat model, attack surface map, severity-ranked findings, verification, commit, and push.

## Initial Findings

- Action history was scope-filtered but not owner-filtered, so authenticated users could see or update history rows from other users if they guessed scope or id.
- Several system routes had side effects or sensitive path/status output but only required authentication:
  - Drive sync status
  - Drive sync manual sync
  - Folder backup export
  - Data-path read and reset
- The app intentionally allows Google Translate's required script behavior only on public portal routes. This is a compatibility exception, not a pattern for admin/internal pages.
- Current storage/auth design still supports local/session token storage; later sessions must continue minimizing persistent sensitive storage and clearing caches on logout/session invalidation.

## Immediate Fixes Applied

- Action history reads now default to rows created by the signed-in user; privileged users with `settings` or `backup` may request all rows explicitly for audit views.
- Action history status updates now require ownership.
- Action history labels/scopes/entities are length-limited, and payloads are capped to prevent oversized JSON abuse.
- Drive sync status and manual sync now require `backup` or `settings`.
- Folder backup export now requires `backup`.
- Data-path read/reset now require `backup` or `settings`.
- Start/setup scripts no longer attempt global PM2 installation automatically; they use the tracked app runtime and fall back to Node/background mode unless PM2 is already installed.
- Shared API writes now dedupe identical in-flight JSON mutations, ignoring generated request/idempotency keys for the dedupe comparison so double-clicked creates/updates still collapse to one request across product, POS, inventory, backup, settings, profile, upload, and reset surfaces while individual page guards continue to be hardened.

## Session 2 Notes

- Added frontend regression coverage for in-flight write dedupe, including stable JSON body ordering and post-settle cleanup.
- Switched normal public access to Cloudflare Tunnel at `https://leangcosmetics.dpdns.org/ -> http://127.0.0.1:4000`; local health at `http://127.0.0.1:4000/health` passed. Legacy Tailscale checks are kept only behind explicit support wrappers.
- This is a cross-cutting guardrail, not the final Session 2 sweep. Remaining work is to keep tightening individual high-risk actions with explicit busy states, idempotency keys, and loader timeout/retry UX.
- Expanded `ops/docs/OPTIMIZATION-ROADMAP.md` with Phases 6-25:
  - full relational schema/data-loss guardrails
  - connection and Cloudflare gateway stabilization
  - loader/action/button stability sweep
  - function/loop complexity audit
  - smarter read models and derived data strategy
  - upload/camera/image/video/file pipeline rework
  - permission/security reauthorization
  - sync queue/conflict upgrade
  - worker/job resource governance
  - frontend state ownership and rerender reduction
  - UI system and responsive density review
  - query/index/transaction correctness audit
  - API contract/type boundary hardening
  - measured language/runtime conversion evaluation
  - import/dedup/merge intelligence
  - backup/restore disaster recovery drill
  - public portal/admin boundary optimization
- Expanded Phase 6 into a repeated schema-analysis loop and replaced the old
  lightweight `ops/docs/SCHEMA-RELATIONSHIPS.md` note with a full relational
  schema audit. The audit covers static Postgres tables, runtime DDL, dynamic
  custom tables, JSON text payloads, polymorphic references, Dexie offline
  stores, Redis queue/cache roles, object-storage path usage, and concrete DDL
  recommendations for primary keys, idempotency indexes, detail-read indexes,
  staged foreign keys, JSONB conversion, product taxonomy rewiring, stock
  source-of-truth cleanup, and file usage normalization.
- Added `ops/scripts/backend/schema-audit.ts` and generated
  `ops/docs/reference/SCHEMA-AUDIT.md` so the Phase 6 schema sweep can be
  repeated without relying on memory. The latest generated audit confirms 45
  static Postgres tables, 0 missing relationship-doc entities, and 0 declared
  foreign key/reference constraints in scanned DDL. The durable backup gaps it
  surfaced were closed by adding batch inventory tables, sale/return allocation
  tables, and `stock_row_moves` to the backup manifest; `system_jobs` is now
  explicitly non-backup runtime state.
  - analytics semantics correctness
  - release/verification discipline
  - continuous architecture review and rewire candidate register
- Current execution position after roadmap expansion:
  - Continue Session 2 first.
  - Start with Phase 8.1 action inventory and Phase 8.2 double-click/repeat behavior checks.
  - Prioritize high-risk actions before broad refactors: sales create/payment, returns create/edit, product import/apply, media upload/replace, backup/export/restore, settings save.
- Phase 8.1 action inventory is now tracked in `ops/docs/reference/ACTION-STABILITY-INVENTORY.md`.
- Phase 8.2 has started with regression coverage for POS checkout and quick-add writes, return create/edit/supplier writes, bulk product import, auth/settings shell writes, and backup export/restore repeat-action guardrails.
- Bulk product import now has a synchronous in-flight guard around retry, delete, image-only import, CSV picker/analyze, and final import start. This closes the small window where a rapid repeat click could start duplicate async work before React applied `loading`.
- Customer return create/edit and supplier return create now have synchronous submit refs in addition to backend create idempotency.
- File picker and file library upload/delete flows now have synchronous upload/delete refs, and file inputs disable while upload/delete is active.
- Product form image upload and product save now have synchronous refs covering chosen files, camera/photo capture, and product record save; product form image upload now also has an explicit 30s timeout contract.
- Catalog portal media uploads now have per-target same-tick guards before the file picker opens, covering portal logo, favicon, cover, about block media, and promo item media.
- Profile save, password save, and avatar upload now have synchronous refs in addition to `saving*` state, closing repeat-click windows before React disables the UI.
- Settings save now has a same-tick ref guard, visible saving state, disabled top/bottom save buttons, and keyed guards for app favicon upload. The API-level settings queue remains the shared serialization layer.
- Phase 8.3 guard-pattern standardization has started with `frontend/src/utils/actionGuards.mjs`, a small tested helper module for single-action, named-action, and keyed-action same-tick gates. Initial adoption is limited to bulk import, catalog media, and settings save/upload so this pass improves consistency without broad churn.
- Phase 8.3 adoption now also covers contact, inventory, and sales import modals plus OTP confirm/disable, all through the shared single-action guard.
- Phase 8.3 adoption now covers return search/submit flows and loyalty point rule save through the same shared single-action guard.
- Phase 8.4 loader recovery has started: background import tracker poll reads now timeout/back off without clearing visible jobs, and branch stock expansion/pagination reads now timeout with warnings while preserving already loaded stock rows.
- Phase 8.4 now also covers the branch transfer modal's source-stock loader: it requests a bounded positive-stock page, normalizes paged payloads, times out slow reads, and avoids clearing already loaded source products on refresh failure.
- Phase 8.4 now also covers Sales and Inventory admin user-filter option reads: they timeout auxiliary `getUsers()` calls and keep prior options/retry later instead of marking an empty failed response as successfully loaded.
- Phase 8.4 now also covers Product form supplier options and Supplier return setup/inventory reads: auxiliary supplier/setup reads timeout and preserve still-valid options/rows instead of blanking the modal after a transient read failure.
- Phase 8.4 now also covers the product image file picker library read: `getFiles({ mediaType: 'image' })` uses an explicit timeout and keeps the current picker contents visible if a transient read fails.
- Phase 8.4 now also covers the Files page library, AI provider, and AI response reads: all three use explicit timeouts, and provider/response refresh failures preserve the last visible rows/metadata instead of replacing the view with an empty failed read.
- Phase 8.4 now also covers POS customer and delivery-contact option reads: both use explicit timeouts, and delivery contacts no longer convert a failed read into a successful empty list.
- Phase 8.4 now also covers product lookup manager modals for Categories, Units, and Brand: lookup usage and unit/category reads have explicit timeout contracts, stale modal requests are ignored after close/reopen, and transient refresh failures do not clear the last visible lookup rows.
- Phase 8.4 now also covers the Inventory saved-reasons loader: saved stock adjustment/transfer/move reasons use an explicit timeout, failed reads keep the current reason catalog visible, and the loaded flag remains retryable instead of caching an empty failed result.
- Phase 8.4 now also covers Inventory primary loaders: branch options, SQL-backed inventory stats, paged product summaries, movement history, and RFID status now use explicit timeout constants instead of default budgets. Live verification exercises Products, Stats, and Movements tabs and asserts the `/api/inventory/products/search`, `/api/inventory/stats`, and `/api/inventory/movements` reads.
- Phase 8.4 now also covers the Inventory movement product-detail fallback read: movement rows that need a product detail fetch now use an explicit timeout before falling back to the movement snapshot details.
- Phase 8.4 now also covers Products page auxiliary reads: category/unit/branch option refreshes, product filter metadata, and by-id product refreshes use explicit timeouts, while failed filter refreshes preserve the last visible filter metadata.
- Phase 8.4 now also covers product lookup manager bulk-operation support reads: category/unit/brand delete, rename, undo, and restore snapshot reads now use bounded product/lookup fetches instead of unbounded full-catalog reads.
- Product lookup manager snapshot/restore reads have been rewired away from full-catalog product downloads: Category, Unit, and Brand flows now snapshot affected products with paged `/api/products/search` calls scoped to the lookup value, restore only affected products with batched by-id fetches, and backend product search now supports `unit` filtering so Unit snapshots stay scoped too.
- Phase 8.4 now also covers Inventory secondary stats and customer return history reads: Inventory return/dashboard stat refreshes use explicit timeouts without converting failed reads into zero/empty stats, and customer return sale-history lookup now fails closed instead of assuming no previous returns after a transient read failure.
- Phase 8.4 now also covers Contacts/Loyalty/Users helper reads: Contacts all-export customer/supplier/delivery reads use explicit timeouts, Loyalty customer point reads keep prior rows after transient failures, and Users/Roles first-load failures no longer cache empty completed lists.
- Phase 8.4 now also covers audit/settings/server admin helper reads: Audit log, Settings OTP status, Server sync config, Server diagnostics, and pending sync queue reads have explicit timeout contracts. OTP setup/confirm/disable and favicon preview reads are source-tested with explicit timeout constants but not live-clicked because they mutate account/security state or local browser assets.
- Phase 8.4 now also covers Catalog/Loyalty/Returns helper reads: Catalog portal bootstrap, AI status, editor provider/review helpers, favicon generation, AI request, and membership lookup now use explicit timeout constants; Catalog membership transient failures keep the last confirmed lookup data visible. Loyalty membership lookup and Returns list/detail/snapshot reads now use explicit timeout constants.
- Phase 8.4 now also covers public portal and receipt settings helper reads: public portal config, metadata, bootstrap, and product search reads have explicit timeout constants; Receipt Settings save/refresh and Receipt Preview dynamic import have explicit timeout contracts. Live verification opens `/public` and `/receipt-settings` without mutating settings.
- Phase 8.4 now also covers Branches initial list/summary/transfer-history reads and User Profile modal hydration reads: Branches list, Branch summary, Branch transfers, profile details, profile OTP status, profile verification capabilities, and profile sign-in methods all have explicit timeout contracts. The Branches loader now tracks the in-flight read mode so a Transfer History tab request cannot be swallowed by a lighter branch-list refresh already in progress.
- Phase 8.4 now also covers Dashboard summary and analytics reads: dashboard summary and dashboard analytics have explicit timeout constants, refresh failures preserve last valid payloads, and live verification opens Dashboard plus clicks the `7 Days` range button to prove a real analytics refresh.
- Phase 8.4 now also covers Sales export preview/CSV reads: the export modal wraps JSON preview and CSV export requests in explicit timeout contracts. Live verification clicks Sales > Export > Detailed sales report > Preview Summary and asserts `/api/sales/export` returns HTTP 200 before accepting the modal summary. The backend product-summary aggregation was corrected for Postgres by grouping on both `si.product_name` and `si.product_id`.
- Phase 8.4 now also covers Backup integration doctor and system-job polling reads: quick/deep doctor calls have explicit timeout budgets, job status polls have explicit per-poll timeouts, and the job watcher tolerates transient status-read failures with backoff before surfacing a failed job card.
- Phase 8.4 now also covers Product bulk-import cancelled-job recovery reads: the modal's cancelled/retry recovery status fetch now has an explicit timeout, and live verification opens Products > Import to exercise the visible import button/modal path without mutating product data.
- Phase 8.4 now also covers Product/import-tracker preflight reads: the product import modal and background import tracker wrap import preflight checks in explicit timeout contracts before apply/approve, and runtime smoke now calls `/api/import-jobs/{id}/preflight` before approving a live import job.
- Phase 8.4 now also covers Product bulk-import create/upload/start pipelines: CSV and image-only product imports use explicit timeouts for job creation, CSV manifest upload, ZIP/browser image uploads, and job start. Cancel checks still run immediately before preflight and start, so a user cancel cannot continue into queued server work.
- Phase 8.4 now also covers Background Import Tracker action buttons: cancel, retry, approve, error-download, and remove now use same-tick action guards and explicit timeout contracts. The mutating buttons are source-tested to avoid altering existing jobs during UI verification; runtime smoke still proves the safe import-job create/upload/start/preflight/approve/completion chain.
- Phase 8.4 now also covers shared Action History helper reads: recent history and admin user-filter options now use explicit timeout contracts, stale responses are ignored, and transient user-option failures preserve the current filter options instead of blanking the control.
- Phase 8.4 now also covers AppContext bootstrap/settings reads: app settings and auth bootstrap now use explicit timeout constants across startup, login, OTP login, runtime refresh, and auth-recovery paths. Transient settings refresh failures preserve the current settings snapshot instead of resetting the shell to defaults.
- Phase 8.4 now also covers Notification Center summary reads: the app-shell notification bell uses an explicit summary timeout, preserves already visible alerts through unavailable refreshes, and live verification clicks the bell and asserts `/api/notifications/summary` returns HTTP 200 before accepting the panel.
- Phase 8.4 now also covers POS catalog bootstrap reads: the batched product search, categories, branches, and global product filters load has an explicit timeout contract, and live verification now asserts each POS catalog read returns HTTP 200 before accepting the POS screen.
- Phase 8.4 now also covers POS membership lookup reads: customer membership lookup from POS has an explicit timeout, preserves the last confirmed same-member panel through transient refresh failure, and live verification selects a real member in POS and asserts `/api/portal/membership/{number}` returns HTTP 200.
- Phase 8.4 now also covers secondary import modal job pipelines: Contact, Sales, and Inventory import modals use explicit timeouts for import-job creation, CSV upload, and job start, while keeping the existing same-tick submit guards. Live verification opens the Sales, Inventory, and Contacts import modals from real buttons without mutating data.
- Phase 8.4 now also covers the Custom Tables helper surface: table-list and
  row-list reads use explicit timeout constants, create/save/delete row actions
  use same-tick guards plus mutation timeouts, and undo/redo custom-row actions
  are bounded. The component is not currently mounted in the main app shell, so
  live verification uses an authenticated Playwright browser context to call
  `/api/custom-tables` through `window.api.getCustomTables()` and confirm HTTP
  200/array results without first-party console errors.
- Phase 8.4 now also covers Contacts CRUD actions: Customers, Suppliers, and
  Delivery create/update/delete, bulk delete, and action-history undo/redo
  mutation paths use same-tick guards plus 12s mutation timeouts. Live
  verification clicks the real Contacts tabs, opens each Add modal, opens the
  import picker, and confirms `/api/customers`, `/api/suppliers`, and
  `/api/delivery-contacts` return HTTP 200 without mutating contact records.
- Phase 8.4 now also covers Sales status and membership actions: single-sale
  status changes, bulk status updates, sale membership attach, and related
  undo/redo callbacks use shared same-tick guards plus 12s mutation timeouts.
  Live verification opens Sales, selects a real sale to reveal the bulk Done/
  Delivery/Cancel action buttons, opens sale details, and confirms the status
  and membership controls render without clicking mutating save/update buttons.
- Phase 8.4 now also covers Branch CRUD and Transfer submit actions: branch
  create/update/delete, bulk delete, undo/redo callbacks, and branch stock
  transfer submit use shared same-tick guards plus 12s mutation timeouts. Live
  verification opens Branches, Add/Edit branch modals, bulk-delete visibility,
  and the Transfer modal source-stock loader while avoiding branch save/delete
  and transfer submit mutations.
- Phase 8.4 now also covers Inventory adjustment/move/transfer actions:
  single-product adjust, move, transfer, action-history undo/redo callbacks,
  and selected-product batch adjust/transfer/move paths use shared same-tick
  guards plus 12s mutation timeouts. Live verification opens the real Inventory
  adjust, transfer, move, and batch action surfaces while avoiding stock
  mutations.
- Phase 8.4 now also covers Product stock helper actions: the Products bulk
  add-stock modal and product-form branch stock adjuster use shared same-tick
  guards plus 12s mutation timeouts around `adjustStock`. Live verification
  opens both stock-helper surfaces from the Products UI without submitting stock
  mutations.
- Phase 8.4 now also covers Users/Roles security actions: user create/update,
  password change, role create/update/delete, and related action-history
  undo/redo callbacks use shared same-tick guards plus 12s mutation timeouts.
  Live verification opens Add User, Change Password, Roles, and Create Role
  from the real Users UI while avoiding user/role mutations.
- Phase 8.4 now also covers Files AI provider actions: provider create/update,
  provider test, provider delete, and provider undo/redo callbacks use shared
  same-tick guards plus explicit mutation/test timeouts. Live verification opens
  Files > Providers, confirms provider form controls and existing provider
  Edit/Test/Delete buttons render, and avoids provider writes/deletes/tests.
- Phase 8.4 now also covers Files library asset write actions: the Files page
  and shared FilePicker upload/delete actions keep their same-tick guards and
  now wrap asset upload/delete requests in explicit timeout contracts. A live
  Playwright loop uploaded a temporary CSV through the Library upload input,
  searched for it, deleted it through the card Delete button, and confirmed it
  disappeared with HTTP 200 upload/list/delete responses.
- Phase 8.4 now also covers Settings and Catalog media uploads: both uploaders
  keep their keyed same-tick guards, abort controllers, progress reporting, and
  preview rollback while wrapping the underlying `uploadFileAsset(...)` call in
  an explicit 30s timeout contract. A targeted Playwright loop opened Settings,
  expanded Browser tab icon, uploaded a temporary PNG through Upload Image,
  confirmed the field was populated, then removed that asset through Library.
- Phase 8.4 now also covers Product category manager actions: category
  create/update/delete, selected-category delete, and category undo/redo
  callbacks use shared same-tick guards plus 12s mutation timeouts. Live
  verification opens Products > Manage > Categories and confirms Add,
  Delete selected, Edit, and Delete controls render without mutating categories.
- Phase 8.4 now also covers Product unit manager actions: unit
  create/update/delete, selected-unit delete, and unit undo/redo callbacks use
  shared same-tick guards plus 12s mutation timeouts. Live verification opens
  Products > Manage > Units and confirms Add, Delete selected, Edit, and Delete
  controls render without mutating units.
- Phase 8.4 now also covers Product brand manager actions: settings-backed
  brand create/update/delete, selected-brand delete, product brand rewiring, and
  brand undo/redo callbacks use a shared same-tick named guard plus 12s mutation
  timeouts. Live verification opens Products > Manage > Brand and confirms Add,
  Delete selected, Edit, and Delete controls render without mutating brands.
- Phase 8.4 now also covers Product variant creation: the Add Variant modal uses
  a shared same-tick save guard plus a 12s mutation timeout around
  `createProductVariant`. Live verification opens a product row action menu,
  opens Add Variant, and confirms the variant form fields and submit button
  render without creating a variant.
- Phase 8.4 now also covers the main Products page save/delete pathway:
  product create/update, gallery image upload, single-row delete, bulk delete,
  and delete redo callbacks use shared same-tick guards plus explicit mutation
  timeouts. Live verification opens the Add Product modal and row Delete
  confirmation, dismisses it, and confirms no product mutation was sent.
- Phase 8.4 now also covers Backup Google Drive and job actions: Drive sync
  preference save, OAuth start, manual sync queueing, disconnect, credential
  forget, backup export/restore queueing, and system-job cancellation now have
  explicit timeout contracts. Live browser verification saved Drive preferences,
  queued a real `google_drive_sync` job, cancelled it from the Backup page, and
  observed zero relevant console errors.
- Runtime restart stability improved in `ops/docker/compose.scale.yml`: the Docker app container now skips frontend `npm ci` when `frontend/dist/index.html` already exists, so normal restarts do not depend on downloading frontend dev packages from the registry.
- Verification after Phase 8.4 checkpoint:
  - `node test/routeContracts.test.ts`
  - `node tests/actionStability.test.ts`
  - `node tests/actionGuards.test.ts`
  - `node tests/performanceLoadingUx.test.ts`
  - `node tests/apiHttp.test.ts`
  - Backend `npm.cmd run test:utils`
  - `npm.cmd run typecheck`
  - Frontend `npm.cmd run test:utils`
  - `npm.cmd run build`
  - Focused Playwright Contacts UI check on build `42f694565739` / frontend
    hash `fb6658da3dd6d8f0`: opened Contacts, clicked Customers/Suppliers/
    Delivery tabs, opened Customer/Supplier/Delivery Add modals, opened the
    Contacts import picker, verified `/api/customers`, `/api/suppliers`, and
    `/api/delivery-contacts` returned HTTP 200, found no framework overlay, and
    recorded zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-contacts-live-check-2026-05-17T23-16-00-164Z/report.json`.
  - Focused Playwright Sales action UI check on build `42f694565739` /
    frontend hash `92150b9c3e7c3c06`: opened Sales, verified `/api/sales`
    returned HTTP 200, selected a real sale to reveal the bulk Done/Delivery/
    Cancel buttons, opened the sale detail modal, confirmed the membership
    attach field and status selector rendered, found no framework overlay, and
    recorded zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-sales-actions-live-check-2026-05-17T23-25-03-542Z/report.json`.
  - Focused Playwright Branch action UI check on build `42f694565739` /
    frontend hash `4b13d6244528d536`: opened Branches, verified `/api/branches`
    and `/api/branches/summary` returned HTTP 200, opened Add/Edit Branch
    modals, selected a branch to reveal the bulk Delete button, opened the
    Transfer modal, verified `/api/branches/{id}/stock` returned HTTP 200, and
    found zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-branches-actions-live-check-2026-05-17T23-36-56-531Z/report.json`.
  - Focused Playwright Inventory action UI check on build `42f694565739` /
    frontend hash `d037ad59dbe3df46`: opened Inventory, verified
    `/api/inventory/products/search`, `/api/branches`, and
    `/api/inventory/reasons` returned HTTP 200, opened Adjust, Transfer, Move
    Stock, and Batch Session controls, switched batch rows through transfer and
    move modes, found no framework overlay, and recorded zero relevant
    first-party console errors. Report:
    `ops/runtime/reports/phase84-inventory-actions-live-check-2026-05-17T23-49-24-673Z/report.json`.
  - Focused Playwright Product stock-helper UI check on build `42f694565739` /
    frontend hash `b79c04b453d1b469`: opened Products, verified
    `/api/products/search` and `/api/branches` returned HTTP 200, selected the
    visible product page, opened the bulk Add Stock modal, opened a product's
    stock tab with the Branch Stock Adjuster, found no framework overlay, and
    recorded zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-stock-actions-live-check-2026-05-18T06-16-56-368Z/report.json`.
  - Focused Playwright Users/Roles action UI check on build `42f694565739` /
    frontend hash `ce3d41a537d09333`: opened Users, verified `/api/users`,
    `/api/roles`, and `/api/action-history` returned HTTP 200, opened Add User,
    opened Change Password from a row action menu, opened Roles, verified role
    edit/delete controls rendered, opened Create Role, found no framework
    overlay, and recorded zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-users-actions-live-check-2026-05-18T04-23-30-286Z/report.json`.
  - Focused Playwright Files Providers action UI check on build
    `42f694565739` / frontend hash `cba9bab9be5dd975`: opened Files, verified
    `/api/files`, `/api/ai/providers`, `/api/ai/responses`, and
    `/api/action-history` returned HTTP 200, opened Providers, confirmed the
    provider form rendered with five provider choices, confirmed 12 existing
    provider rows exposed Edit/Test/Delete controls, found no framework overlay,
    and recorded zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-files-providers-actions-live-check-2026-05-18T04-34-29-711Z/report.json`.
  - Focused Playwright Product category-manager action UI check on build
    `42f694565739` / frontend hash `8115d343d5877c22`: opened Products,
    verified `/api/products/search`, `/api/categories`,
    `/api/products/lookups/usage`, and action-history reads returned HTTP 200,
    opened Manage Categories, confirmed Add/Delete selected controls and 24 row
    Edit/Delete controls rendered, found no framework overlay, and recorded zero
    relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-categories-actions-live-check-2026-05-18T04-44-05-593Z/report.json`.
  - Focused Playwright Product unit-manager action UI check on build
    `42f694565739` / frontend hash `c9f8b88babd005ad`: opened Products,
    verified `/api/products/search`, `/api/units`,
    `/api/products/lookups/usage`, and action-history reads returned HTTP 200,
    opened Manage Units, confirmed Add/Delete selected controls and 24 row
    Edit/Delete controls rendered, found no framework overlay, and recorded zero
    relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-units-actions-live-check-2026-05-18T05-00-07-865Z/report.json`.
  - Focused Playwright Product brand-manager action UI check on build
    `42f694565739` / frontend hash `34c73c8baad40cfa`: opened Products,
    verified `/api/products/search`, `/api/products/lookups/usage`, and
    product-brand action-history reads returned HTTP 200, opened Manage Brand,
    confirmed Add/Delete selected controls plus 242 row Edit controls and 242
    row Delete controls rendered, found no framework overlay, and recorded zero
    relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-brands-actions-live-check-2026-05-18T05-11-54-559Z/report.json`.
  - Focused Playwright Product variant action UI check on build
    `42f694565739` / frontend hash `42378a84fc53ab2f`: opened Products,
    verified `/api/products/search` returned HTTP 200, opened a row action menu,
    opened Add Variant, confirmed variant name/SKU/barcode/unit/branch fields
    and the Add Variant submit button rendered, found no framework overlay, and
    recorded zero relevant first-party console errors. Report:
    `ops/runtime/reports/phase84-product-variant-actions-live-check-2026-05-18T06-07-30-407Z/report.json`.
  - Focused Playwright Product page action UI check on build `42f694565739` /
    frontend hash `5718287e8b560442`: opened Products, verified
    `/api/products/search` returned HTTP 200, opened the Add Product modal,
    confirmed the name field and Save button rendered, opened a row action menu,
    clicked Delete, dismissed the confirmation dialog, found zero product
    mutation requests, no framework overlay, and zero relevant first-party
    console errors. Report:
    `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T05-48-53-308Z/report.json`.
  - Focused Playwright runtime check on updated local build hash
    `bda870a593321c52`: authenticated app load plus
    `/api/custom-tables` through `window.api.getCustomTables()` returned HTTP
    200/array results with zero relevant first-party console errors.
  - `ops/scripts/powershell/start-runtime.ps1` with local health, route contract, worker readiness, Cloudflare public health, and Cloudflare admin reachability passing.
  - Playwright focused UI check on `http://127.0.0.1:4000` build `42f694565739` / frontend hash `15dbf21db5b400ff`: authenticated app bootstrap/settings/meta probes, Dashboard route, Dashboard summary/analytics reads, `7 Days` range analytics refresh, Notification Center bell click and `/api/notifications/summary` read, Branch route, Branches list/summary reads, Stock button expansion, branch stock read, Transfer modal source-stock read, Transfer History tab read, Sales export preview read, Sales import modal button render, Products search/filter/action-history reads, Product import modal button render, Product form supplier read, product image file-picker read, Supplier return setup/inventory reads, Files page library read, AI provider read, AI response read, Catalog AI provider/review reads, public portal config/meta/product reads, Receipt Settings preview render, POS product search/category/branch/filter/customer/delivery/membership reads, product lookup manager Category/Unit/Brand modal reads, Inventory primary product/branch/stats/movement reads, Inventory saved-reasons read, Inventory return/dashboard stats reads, Inventory import modal button render, Contacts all-export reads, Contacts import modal button render, Loyalty customer point read, Loyalty membership lookup button read, Users/Roles reads, Profile modal details/OTP/capabilities/sign-in method reads, Audit log read, Settings OTP status read, Backup integration doctor read, Server sync config read, Server diagnostics read, pending sync queue render, import tracker chunk/poll, no framework overlay, and zero relevant console errors. Report: `ops/runtime/reports/phase84-ui-live-check-2026-05-17T20-43-48-998Z/report.json`.
  - Runtime system smoke on build `42f694565739` / frontend hash `15dbf21db5b400ff`: branches, product create, stock adjust, sale, return, transfer, dashboard, analytics, movement search, inventory stats, action history, and CSV import job create/upload/start/preflight/approve/completion/search.
  - Local health and public Cloudflare health returned app JSON HTTP 200 after the local live checks. The unauthenticated admin-domain check returned the Cloudflare Access sign-in page with HTTP 200, which confirms the protected endpoint is reachable but not app-health JSON without Access credentials.
  - Repository organization and language-conversion planning is now tracked in
    `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`; the generated audit lives at
    `ops/docs/reference/ORGANIZATION-AUDIT.md` and currently scans 344 files,
    with 57 files over 700 lines.
  - First Phase 26 physical move complete: Phase 8.4 live-check scripts moved
    into `ops/scripts/runtime/live-checks`, and the latest Product page action
    live check passed from the new path.
  - Second Phase 26 physical move complete: Product Category/Unit/Brand lookup
    modals and `productLookupSnapshots.mjs` moved into
    `frontend/src/components/products/lookups`; Product category, unit, and
    brand live checks passed on frontend hash `3296f6327bd7aa53`.
  - Third Phase 26 physical move complete: Product form files have started
    moving into `frontend/src/components/products/forms`; `VariantFormModal.tsx`
    now lives there, and the Product variant live check passed on frontend hash
    `42378a84fc53ab2f`.
  - Fourth Phase 26 physical move complete: Product stock-helper form files
    `BulkAddStockModal.tsx` and `BranchStockAdjuster.tsx` now live in
    `frontend/src/components/products/forms`, and the Product stock-helper live
    check passed on frontend hash `b79c04b453d1b469`.
  - Fifth Phase 26 physical move complete: Product import files
    `BulkImportModal.tsx`, `productImportPlanner.ts`, and
    `productImportWorker.ts` now live in
    `frontend/src/components/products/import`; the broad Phase 8.4 UI live
    check opened the Product import modal and passed on frontend hash
    `0028bc915078664f`.
  - Sixth Phase 26 physical move complete: Product scanner files
    `BarcodeScannerModal.tsx`, `barcodeImageScanner.ts`,
    `barcodeScannerState.ts`, and `scanbotScanner.ts` now live in
    `frontend/src/components/products/scanning`; the focused Product scanner
    live check opened Scan barcode, applied a manual barcode value back to the
    form, and passed on frontend hash `4fdf242042c73694`.
  - Seventh Phase 26 physical move complete: Product history helper logic
    `productHistoryHelpers.ts` now lives in
    `frontend/src/components/products/history`; product history helper tests,
    source checks, typecheck, production build, runtime health, and the focused
    Product page action live check passed on frontend hash
    `db2bde8c13de0d64`.
  - Eighth Phase 26 physical move complete: Product presentation surfaces
    `HeaderActions.tsx`, `ProductsListSurface.tsx`, and
    `ProductDetailModal.tsx` now live in
    `frontend/src/components/products/surfaces`; product discount and product
    pagination source tests, source checks, typecheck, production build,
    runtime health, and the focused Product page action live check passed on
    frontend hash `e9b985386668bdf9`.
  - Ninth Phase 26 physical move complete: Product shared primitives
    `primitives.jsx` now lives in `frontend/src/components/products/shared`.
    Products, ProductForm, VariantForm, Product surfaces, Catalog, and POS
    imports were rewired; product, POS, and portal catalog source tests, source
    checks, typecheck, production build, runtime health, a focused Product page
    action live check, and the broad Phase 8.4 UI live check passed on frontend
    hash `21bd97f0b6d8a0df`.
  - Tenth Phase 26 physical move complete: Main product form
    `ProductForm.tsx` now lives in `frontend/src/components/products/forms`.
    Lazy imports, action-stability source tests, performance-loading source
    tests, and the performance verifier were rewired; source checks, typecheck,
    production build, runtime health, focused Product page action live check,
    and focused Product scanner live check passed on frontend hash
    `d1de3f08c3064e4d`.
  - Eleventh Phase 26 physical move complete: Products page config constants
    now live in `frontend/src/components/products/config/productPageConfig.mjs`.
    Products imports month options, visual defaults, read timeouts, and mutation
    timeouts from that module, and source tests read the same module directly.
    Source checks, typecheck, production build, runtime health, focused Product
    page action live check, and focused Product scanner live check passed on
    frontend hash `e0871873ba445219`.
  - Twelfth Phase 26 physical move complete: Products page helper functions now
    live in `frontend/src/components/products/helpers/productPageHelpers.ts`.
    Products imports debounced state, brand color parsing, brand lookup
    normalization, and frame scheduling from that module. Helper source tests,
    source checks, typecheck, production build, runtime health, focused Product
    page action live check, and focused Product scanner live check passed on
    frontend hash `a440b744817036af`.
  - Thirteenth Phase 26 physical move complete: Product gallery helper
    functions now live in
    `frontend/src/components/products/helpers/productGalleryHelpers.ts`.
    Products imports gallery normalization, product gallery fallback selection,
    and public product image URL resolution from that module. Helper source
    tests, source checks, typecheck, production build, runtime health, focused
    Product page action live check, and focused Product scanner live check
    passed on frontend hash `ff7f953e9b217168`.
  - Fourteenth Phase 26 physical move complete: Product row presentation parts
    now live in `frontend/src/components/products/surfaces/ProductRowParts.jsx`.
    Products imports the discount badge, row action menu wrapper, batch preview
    chips, and desktop details cell from that surface module. Source checks,
    typecheck, production build, runtime health, focused Product page action
    live check, and focused Product scanner live check passed on frontend hash
    `f04520d849d51963`.
  - Fifteenth Phase 26 physical move complete: Product filter/export helpers
    now live in
    `frontend/src/components/products/helpers/productFilterHelpers.ts`.
    Products delegates search-term parsing, branch quantity lookup, filtered
    product selection, and CSV export row shaping to that module. Focused helper
    tests, source checks, typecheck, production build, runtime health, focused
    Product page action live check, and focused Product scanner live check
    passed on frontend hash `8a33b1bdd672f31c`.
  - Sixteenth Phase 26 physical move complete: Product selection/pagination
    helpers now live in
    `frontend/src/components/products/helpers/productSelectionHelpers.ts`.
    Products delegates visible id extraction, selected-visible id resolution,
    pagination summary math, selected product filtering, letter jump targets,
    and selection-scope predicates to that module. Focused helper tests, source
    checks, typecheck, production build, runtime health, focused Product page
    action live check, and focused Product scanner live check passed on frontend
    hash `f0b69a89f50f0e7f`.
  - Seventeenth Phase 26 physical move complete: Product group view helpers now
    live in
    `frontend/src/components/products/helpers/productGroupViewHelpers.ts`.
    Products delegates grouped product price labels and grouped summary chip
    text to that module. Focused helper tests, source checks, typecheck,
    production build, runtime health, focused Product page action live check,
    and focused Product scanner live check passed on frontend hash
    `5781a6bf1ff07e16`.
  - Eighteenth Phase 26 physical move complete: Product display data helpers now
    live in
    `frontend/src/components/products/helpers/productDisplayHelpers.ts`.
    Products delegates lookup map construction, merged brand options, branch
    id/name maps, branch summary labels, and stock-status classification to
    that module. Focused helper tests, source checks, typecheck, production
    build, runtime health, focused Product page action live check, and focused
    Product scanner live check passed on frontend hash `6039db439c681904`.
  - Nineteenth Phase 26 physical move complete: Product menu metadata helpers
    now live in
    `frontend/src/components/products/helpers/productMenuHelpers.ts`. Products
    delegates export menu item construction, supplier filter option
    normalization, and active filter count calculation to that module. Focused
    helper tests, source checks, typecheck, production build, runtime health,
    focused Product page action live check, and focused Product scanner live
    check passed on frontend hash `2641f1ce0445f430`.
  - Twentieth Phase 26 organization move complete: Product filter menu section
    builder logic now lives in
    `frontend/src/components/products/helpers/productMenuHelpers.ts`. Products
    delegates year/month, branch, group, stock, category, brand, and supplier
    filter section construction to that module while keeping the shared
    `FilterMenu` UI unchanged. Focused helper tests, source checks, typecheck,
    production build, runtime health, focused Product page action live check,
    and focused Product scanner live check passed on frontend hash
    `b96c2bf7d1b6c06e`.
  - Twenty-first Phase 26 organization move complete: Product row display state
    helper logic now lives in
    `frontend/src/components/products/helpers/productDisplayHelpers.ts`.
    Products delegates purchase-price fallback, margin math, visible stock
    quantity, promotion calculation, compact brand/category metadata, branch
    labels, and mobile stock badge presentation to that module while preserving
    row rendering and actions. Focused helper tests, source checks, typecheck,
    production build, runtime health, focused Product page action live check,
    and focused Product scanner live check passed on frontend hash
    `8426a118f46c25cc`.
  - Twenty-second Phase 26 organization move complete: Product lightbox state
    construction now lives in
    `frontend/src/components/products/helpers/productGalleryHelpers.ts`.
    Products delegates lightbox image URL resolution, empty-gallery handling,
    and start-index clamping to that module while preserving the lightbox UI and
    navigation actions. Focused helper tests, source checks, typecheck,
    production build, runtime health, focused Product page action live check,
    and focused Product scanner live check passed on frontend hash
    `3469c4d8b3425629`.
  - Twenty-third Phase 26 organization move complete: Product lightbox index
    update logic now lives in
    `frontend/src/components/products/helpers/productGalleryHelpers.ts`.
    Products delegates gallery index changes to that module and no longer
    carries the disabled legacy `false && lightbox` overlay branch. Focused
    helper tests, source checks, typecheck, production build, runtime health,
    focused Product page action live check, and focused Product scanner live
    check passed on frontend hash `713180d4d834b1ce`.
  - Twenty-fourth Phase 26 organization move complete: Product detail lightbox
    gallery-input fallback now lives in
    `frontend/src/components/products/helpers/productGalleryHelpers.ts`.
    Products delegates the detail-modal gallery/source fallback to that module
    before opening the shared lightbox, preserving the detail modal UI while
    making the fallback behavior source-tested. Focused helper tests, source
    checks, typecheck, production build, runtime health, focused Product page
    action live check, and focused Product scanner live check passed on
    frontend hash `ce63c5f06c94a85e`.
  - Twenty-fifth Phase 26 organization move complete: Product thumbnail state
    construction now lives in
    `frontend/src/components/products/helpers/productGalleryHelpers.ts`.
    Products desktop and mobile rows compute one normalized thumbnail state per
    row and reuse it for thumbnail display and lightbox open. A stale removed
    callback dependency crashed Products during first live verification; root
    cause was identified with diagnostic Playwright, removed, rebuilt, and the
    focused Product page/scanner checks passed on frontend hash
    `3e2b508f0b07839b`.
  - Twenty-sixth Phase 26 organization move complete: Product collection index
    construction now lives in
    `frontend/src/components/products/helpers/productSelectionHelpers.ts`.
    Products delegates the `productsById` map and `parentProductIds` set used
    by grouping and filtering to that module. Focused helper tests, source
    checks, typecheck, production build, performance verification, runtime
    health, focused Product page action live check, and focused Product scanner
    live check passed on frontend hash `d225ee10885691f9`.
  - Twenty-seventh Phase 26 organization move complete: Product restore/write
    payload construction now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates undo/redo restore and deleted-product recreation payload
    shaping to that helper through a small user-context wrapper. Focused helper
    tests, source checks, typecheck, production build, performance
    verification, runtime health, focused Product page action live check, and
    focused Product scanner live check passed on frontend hash
    `87ac9fa332bb6004`.
  - Twenty-eighth Phase 26 organization move complete: Product branch-stock
    restore adjustment planning now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates snapshot/current branch stock diffing to that helper, so
    restore loops execute preplanned add/remove deltas and avoid invalid branch
    ids or NaN quantities. Focused helper tests, source checks, typecheck,
    production build, performance verification, runtime health, focused Product
    page action live check, and focused Product scanner live check passed on
    frontend hash `f8c95fdbb7171cff`.
  - Twenty-ninth Phase 26 organization move complete: Deleted-product restore
    planning helpers now live in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates default branch selection, deleted-id set construction,
    preferred restore branch selection, and deleted-parent remapping to source-
    tested helpers. Focused helper tests, source checks, typecheck, production
    build, performance verification, runtime health, focused Product page
    action live check, and focused Product scanner live check passed on
    frontend hash `f355894dc1465d5c`.
  - Thirtieth Phase 26 organization move complete: Product clear-stock
    adjustment planning now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates bulk out-of-stock branch-row filtering and unit-cost
    resolution to that helper, so the nested mutation loop only executes valid
    preplanned removal adjustments. Focused helper tests, source checks,
    typecheck, production build, performance verification, runtime health,
    focused Product page action live check, and focused Product scanner live
    check passed on frontend hash `2fbb7e7e9a4dee2c`.
  - Thirty-first Phase 26 organization move complete: Product branch-move
    planning now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates transfer-vs-initialize-vs-no-op branch-change decisions
    to source-tested helpers and only executes explicit plans in the mutation
    loop. Focused helper tests, source checks, typecheck, production build,
    performance verification, runtime health, focused Product page action live
    check, and focused Product scanner live check passed on frontend hash
    `749aede9830d88e9`.
  - Thirty-second Phase 26 organization move complete: Product bulk-run summary
    logic now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates concurrent-run success/failure id extraction to that
    helper for bulk delete, bulk add stock, bulk branch move, and bulk update
    flows. A focused test caught the `Number(null) === 0` edge, so the helper
    now rejects zero ids explicitly. Focused helper tests, source checks,
    typecheck, production build, performance verification, runtime health,
    focused Product page action live check, and focused Product scanner live
    check passed on frontend hash `8e1cbcfe93564245`.
  - Thirty-third Phase 26 organization move complete: Product bulk-update
    payload construction now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates defined-update filtering, optimistic-lock timestamp
    selection, redo fallback timestamps, and user attribution to that helper
    for bulk update and redo flows. Focused helper tests, source checks,
    typecheck, production build, performance verification, runtime health,
    focused Product page action live check, and focused Product scanner live
    check passed on frontend hash `b7f08da087125792`.
  - Thirty-fourth Phase 26 organization move complete: Product bulk edit
    update builders now live in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates info and pricing form-to-update shaping to those helpers,
    including blank-field omission, safe low-stock threshold parsing, and shared
    price normalization. Focused helper tests, source checks, typecheck,
    production build, performance verification, runtime health, focused Product
    page action live check, and focused Product scanner live check passed on
    frontend hash `2b36f4913641bbb3`.
  - Thirty-fifth Phase 26 organization move complete: Product stock adjustment
    payload construction now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates bulk add-stock and clear-stock `adjustStock` payload
    construction to that helper, including product ids/names, branch ids,
    quantities, reasons, user attribution, and unit-cost fallback/override
    behavior. A diagnostic Playwright probe confirmed the Add Product modal
    opened after one transient live-check wait timeout; the focused Product
    page and scanner checks then passed on the same bundle. Focused helper
    tests, source checks, typecheck, production build, performance
    verification, runtime health, focused Product page action live check, and
    focused Product scanner live check passed on frontend hash
    `48b70424364d4ee8`.
  - Thirty-sixth Phase 26 organization move complete: Product adjust-stock
    payload delegation is now complete in `Products.jsx`. Restore branch-stock
    sync, deleted-product stock restore, clear-stock, bulk add-stock, and branch
    initialization all use
    `frontend/src/components/products/helpers/productWriteHelpers.ts` for
    `window.api.adjustStock(...)` payloads. The helper now supports snapshot
    product-name overrides and zero-quantity branch initialization while
    preserving purchase/cost unit-cost fallback behavior. Focused helper tests,
    source checks, typecheck, production build, performance verification,
    runtime health, focused Product page action live check, and focused Product
    scanner live check passed on frontend hash `543cc58df3c2b094`.
  - Thirty-seventh Phase 26 organization move complete: Product transfer-stock
    payload construction now lives in
    `frontend/src/components/products/helpers/productWriteHelpers.ts`.
    Products delegates bulk branch-transfer payload construction to that helper
    while keeping ownership of transfer-vs-initialize workflow decisions. A
    focused helper test caught invalid branch-id normalization before build
    verification, so transfer branch ids now use the shared finite-number
    normalizer. Focused helper tests, source checks, typecheck, production
    build, performance verification, runtime health, focused Product page
    action live check, and focused Product scanner live check passed on
    frontend hash `875d7a0928f443de`.
- Current Session 2 position:
  - Phase 8.1 inventory complete enough to guide high-risk work.
  - Phase 8.2 source guards are implemented for the current priority set: POS, returns, product import, product media, catalog media, file library, backup, profile/avatar, and settings.
  - Phase 8.3 is nearly complete for obvious low-risk duplicates: shared guard helper exists, has utility tests, and is adopted in bulk import, catalog media, settings, secondary import modals, OTP, returns, and loyalty point rules.
- Phase 8.4 is in progress and verified for import tracker poll reads and tracker action buttons, shared Action History helper reads, AppContext bootstrap/settings reads, AppContext auth/settings writes, Notification Center summary reads, Dashboard summary/analytics reads, branch list/summary/stock/transfer-history reads, branch CRUD/transfer action guards/timeouts, transfer-modal source-stock, Sales export preview/CSV timeout contracts plus backend product-summary aggregation, Sales status/membership action guards/timeouts, Backup integration doctor and system-job status polling, Backup Google Drive sync and backup job action timeout contracts, Products search/filter/auxiliary metadata reads, Product stock helper action guards/timeouts, Product category/unit/brand manager action guards/timeouts, Product variant creation guard/timeouts, main Products page save/delete/upload/history/bulk stock guards/timeouts, Product form image upload timeout contracts, Users/Roles security action guards/timeouts, Files AI provider action guards/timeouts, Files library asset upload/delete timeout contracts, Settings/Catalog media upload timeout contracts, Catalog portal submission/review action guards/timeouts, destructive reset/factory-reset action guards/timeouts, Server pending-sync queue and connection-test action guards/timeouts, Audit Log retention cleanup action guards/timeouts, product bulk-import cancelled-job recovery, preflight, create/upload/start pipelines, secondary import modal create/upload/start pipelines, product supplier, product image file-picker, Files page library/provider/response reads, Catalog/public portal helper reads, Receipt Settings preview/read-refresh contracts, POS catalog/customer/delivery option/membership reads, POS quick-add customer/delivery and checkout write timeout contracts, Returns customer/supplier write timeout contracts, Returns history restore timeout/guard contracts, product lookup manager modals and paged lookup snapshot/restore support reads, Inventory primary product/branch/stats/movement loaders, Inventory saved-reasons reads, Inventory movement product-detail fallback reads, Inventory secondary return/dashboard stats reads, Inventory adjust/move/transfer/batch action guards/timeouts, Contacts/Loyalty/Users helper reads, Contacts CRUD action guards/timeouts, Profile modal hydration reads, audit/settings/server admin helper reads, customer return history lookup, Returns detail/snapshot timeout contracts, supplier-return setup/inventory recovery improvements, and Custom Tables helper reads/actions. Sales/Inventory auxiliary user-filter option reads are source-tested and included in the latest build.
  - Remote Cloudflare public portal verification is now repeatable through
    `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`.
    The latest run against `https://leangcosmetics.dpdns.org/public` rendered
    the customer portal, rejected visible `{"success":false}` / internal server
    error output, confirmed portal config/meta/search/AI endpoints returned HTTP
    200, rendered 40 product cards, and recorded zero HTTP 5xx responses, page
    errors, or relevant console messages. Report:
    `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-18T22-50-34-125Z/report.json`.
  - Phase 26/27 are now added as parallel roadmap tracks for repository
    organization and language conversion. The first safe slice is to use the
    organization audit before physical moves, then move one cluster at a time
    with source, build, and Playwright verification.
  - Phase 26 now has fifty-one completed organization/hardening moves: runtime
    live-check scripts grouped under `ops/scripts/runtime/live-checks`, and
    product lookup files grouped under `frontend/src/components/products/lookups`,
    the first product form splits under
    `frontend/src/components/products/forms`, and product import files under
    `frontend/src/components/products/import`, and product scanner files under
    `frontend/src/components/products/scanning`, and product history helpers
    under `frontend/src/components/products/history`, and product presentation
    surfaces under `frontend/src/components/products/surfaces`, and product
    shared primitives under `frontend/src/components/products/shared`. The
    forms split now includes the main `ProductForm.tsx`, and product page
    constants now live under `frontend/src/components/products/config`, and
    product page helpers and gallery helpers now live under
    `frontend/src/components/products/helpers`, and product row presentation
    parts now live under `frontend/src/components/products/surfaces`. Product
    filter/export data helpers now live under
    `frontend/src/components/products/helpers`, product selection/pagination
    data helpers now live under `frontend/src/components/products/helpers`, and
    product group view helpers now live under
    `frontend/src/components/products/helpers`, product display data helpers now
    live under `frontend/src/components/products/helpers`, product menu
    metadata helpers now live under `frontend/src/components/products/helpers`,
    and Product filter menu section construction now lives under
    `frontend/src/components/products/helpers`. Product row display state now
    also lives under `frontend/src/components/products/helpers`, and Product
    lightbox state construction now also lives under
    `frontend/src/components/products/helpers`. Product lightbox index updates
    now also live under `frontend/src/components/products/helpers`, and the
    disabled legacy lightbox overlay branch has been removed from `Products.jsx`.
    Product detail lightbox gallery/source fallback now also lives under
    `frontend/src/components/products/helpers`. Product row thumbnail state now
    also lives under `frontend/src/components/products/helpers`. Product
    collection indexes now also live under
    `frontend/src/components/products/helpers`. Product restore/write payload
    construction now also lives under
    `frontend/src/components/products/helpers`. Product branch-stock restore
    adjustment planning now also lives under
    `frontend/src/components/products/helpers`. Deleted-product restore
    planning helpers now also live under
    `frontend/src/components/products/helpers`. Product clear-stock adjustment
    planning now also lives under
    `frontend/src/components/products/helpers`. Product branch-move planning
    now also lives under `frontend/src/components/products/helpers`. Product
    bulk-run summary logic now also lives under
    `frontend/src/components/products/helpers`. Product bulk-update payload
    construction now also lives under
    `frontend/src/components/products/helpers`. Product bulk edit update
    builders now also live under
    `frontend/src/components/products/helpers`. Product stock adjustment
    payload construction now also lives under
    `frontend/src/components/products/helpers`, and every Product-page
    `adjustStock` payload now delegates there. Product transfer-stock payload
    construction now also lives under `frontend/src/components/products/helpers`.
    Backup Drive sync and backup job action pathways now have explicit timeout
    contracts in `frontend/src/components/utils-settings/Backup.jsx`. Files
    library asset upload/delete pathways now have explicit timeout contracts in
    `frontend/src/components/files/FilesPage.jsx` and
    `frontend/src/components/files/FilePickerModal.tsx`. Settings and Catalog
    media upload pathways now have explicit timeout contracts in
    `frontend/src/components/utils-settings/Settings.jsx` and
    `frontend/src/components/catalog/CatalogPage.jsx`. Product form image
    uploads now have explicit timeout contracts in
    `frontend/src/components/products/forms/ProductForm.tsx`. App shell login,
    logout, Google OAuth completion, settings save, and session-duration refresh
    now have explicit timeout contracts in `frontend/src/AppContext.jsx`.
    POS quick-add customer, quick-add delivery contact, and checkout sale writes
    now have explicit timeout contracts in
    `frontend/src/components/pos/POS.jsx`.
    Return create, return update, and supplier return create writes now have
    explicit timeout contracts in
    `frontend/src/components/returns/NewReturnModal.jsx`,
    `frontend/src/components/returns/EditReturnModal.tsx`, and
    `frontend/src/components/returns/NewSupplierReturnModal.tsx`.
    Remote public portal Cloudflare verification now lives in
    `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`.
    Returns action-history undo/redo restore writes now have explicit timeout
    contracts and a same-tick guard in
    `frontend/src/components/returns/Returns.jsx`.
    Destructive business-data reset and factory-reset actions now have explicit
    timeout contracts and same-tick guards in
    `frontend/src/components/utils-settings/ResetData.jsx`.
    Server pending-sync queue retry/discard and manual sync-server test actions
    now have explicit timeout contracts and same-tick guards in
    `frontend/src/components/server/ServerPage.jsx`.
    Audit Log retention cleanup now has an explicit timeout contract and
    same-tick guard in
    `frontend/src/components/utils-settings/AuditLog.jsx`.
    Catalog customer portal share-proof submission and staff review actions now
    have explicit timeout contracts and same-tick guards in
    `frontend/src/components/catalog/CatalogPage.jsx`.
    Products page action-history restore/delete, deleted-product restore, bulk
    update, clear-stock, add-stock, and branch-move stock pathways now route
    through bounded mutation runners in
    `frontend/src/components/products/Products.jsx`. The broad Phase 8.4
    Playwright UI live check passed on build `42f694565739` / frontend hash
    `70927cf691f499db`, with Products search/filter/action-history reads,
    import modal opening, and no framework overlay or relevant console errors.
    Report:
    `ops/runtime/reports/phase84-ui-live-check-2026-05-18T22-45-06-995Z/report.json`.
  - Phase 28 storage cleanup and access-friction hardening is now active. The
    storage sweep found the largest safe cleanup targets in generated runtime
    reports, timestamped datasync backup packages, ignored demo artifacts, and
    clean Codex worktrees. New retention defaults keep the latest 20 runtime
    report folders, latest 3 local backup packages per backup root, and latest
    1 Cloudflare R2 backup mirror. Full automation now runs the retention
    script before heavy verification, and Cloudflare Access admin sessions are
    configured for 720 hours to reduce repeated email-code prompts on trusted
    admin browsers. Follow-up verification normalized `Backup.jsx` line endings
    so the full whitespace gate passes with only Git CRLF warnings. The latest
    prune kept the newest 20 runtime report folders and 3 local backup packages
    per backup root; Cloudflare R2 mirror retention also completed with zero
    pending remote deletions.
  - Phase 29 is now active for merged whole-codebase schema, cleanup, flow, loop,
    dead-code, folder, Cloudflare/runtime, and language/runtime sweeps. The
    first cleanup pass removed ignored/generated bulk, shrinking `ops` from
    roughly 753 MB to about 60 MB while preserving secrets, env files, business
    uploads, and newest backup packages. Verification passed on frontend hash
    `a6a634e7a29d6a46`.
  - Phase 29 cleanup retention now also recognizes Docker-release timestamp
    backup packages under `ops/runtime/docker-release/backups`, so the standard
    prune path keeps the newest packages without a manual cleanup pass.
  - Phase 29 cleanup retention now also covers `ops/runtime/recovery-reports`
    with a latest-five default, including generated report folders and top-level
    recovery SQL files.
  - Phase 29 ops organization now groups the storage cleanup implementation
    under `ops/scripts/runtime/storage`, with the old runtime prune path kept as
    a compatibility wrapper.
  - Next work: continue Phase 8.4 across remaining visible operational loaders/actions that still have direct calls, weak repeated-click protection, or clear previous data on refresh failures; remaining smaller modal/helper panes are likely next candidates.

## Remaining Reports To Fill

- Threat model and attack surface map.
- Severity-ranked vulnerability list.
- Error matrix by layer.
- Race-condition and edge-condition resilience report.
- Performance bottleneck report and budgets.
- Bad-practice cleanup list and long-term roadmap.
