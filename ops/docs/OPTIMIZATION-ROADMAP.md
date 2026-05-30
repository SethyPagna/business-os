# Business OS Optimization Roadmap

This roadmap now works alongside the live tracking docs below:

- `ops/docs/OPTIMIZATION-MASTER-PLAN.md`
- `ops/docs/OPTIMIZATION-STATUS.md`
- `ops/docs/OPTIMIZATION-SESSION-LOG.md`

This roadmap turns the broad optimization ideas into a step-by-step plan for
Business OS specifically. The goal is not "maximum caching" or "maximum
cleverness"; the goal is fast, reliable, secure business software that behaves
well on slower remote links and across long-running sessions.

Operational tracking for the live optimization program is split into:

- `OPTIMIZATION-MASTER-PLAN.md`
- `OPTIMIZATION-STATUS.md`
- `OPTIMIZATION-SESSION-LOG.md`

## Guiding Rules

1. Local-first beats network-first for business data reads.
2. Static assets may be cached aggressively; HTML and API data should not be
   cached by the service worker.
3. Deploy safety matters more than squeezing out one more benchmark point.
4. Conflict handling must be explicit for writes that can happen from multiple
   devices.
5. We prefer boring reliability over brittle "offline magic".

## Already Applied

- Frontend route and vendor chunking for the heavy shell.
- Local Dexie cache for core data tables.
- Safer auth/session rotation handling.
- WebSocket handoff protection during token changes.
- Basic optimistic write-conflict guards for core master data.
- Minimal service worker strategy:
  - caches static same-origin assets only
  - does not cache HTML
  - does not cache API traffic
  - does not cache uploads or user-generated media
- Backend compression is enabled when the optional `compression` package is
  installed.

## Current Position And Remaining Work

Current position:
- Phase 8.4 is active for loader/action stability, live UI checks, and
  no-leftover hygiene.
- Phase 26 is preserved at 51 completed physical organization moves; further
  folder moves require organization-audit evidence and focused tests.
- Phase 28 is active for storage cleanup, backup retention, Cloudflare/R2
  pruning, and access-friction follow-up.
- Phase 29 completed its first baseline at Move 207 and remains active as the
  recurring whole-codebase/schema/cleanup guardrail.
- Latest completed implementation move in this roadmap: Move 609.

What remains:
- Continue Phase 8.4 live stability sweeps across the admin app, POS, product,
  inventory, returns, audit, backup, settings, library, and sync-server pages.
- Continue Phase 28 storage/R2 pruning and Cloudflare access convenience work
  only through guarded scripts that preserve uploads, secrets, env files, and
  newest backup packages.
- Continue Phase 29 repeat audits before source deletion, folder rewires,
  schema rewires, Docker/runtime cleanup, or language conversion.
- Keep optimizing hot loops and duplicated helper paths one focused slice at a
  time, with backend/frontend tests plus Playwright checks after each visible
  or runtime-facing change.
- Treat Rust/Go/Python/WASM rewrites as candidates only after benchmark,
  packaging, backup/restore, and rollback proof; TypeScript, SQL/DuckDB, and
  Web Workers remain the preferred near-term conversion targets.

## Phase 1: Safe Wins

These changes are low-risk and should improve speed without making deploys or
 sync behavior harder to trust.

### 1.1 Reduce request waterfalls after login

- Add one lightweight bootstrap endpoint that returns:
  - current user
  - organization summary
  - permissions
  - session expiry
  - app settings needed immediately
- Use that response to populate the shell before deeper page-specific fetches.

Why:
- fewer round trips through Cloudflare Tunnel
- less "first click after login" instability
- lower chance of early 401 noise from staggered requests

### 1.2 Break large frontend features by user intent

Highest priority split targets:
- `CatalogPage`
  - public shell
  - portal editor
  - about/media editor
  - membership lookup
  - share/reward review queue
- `Products`
  - list/table
  - editor modal
  - import/export actions
  - analytics/detail panels

Why:
- reduces memory pressure
- reduces navigation latency after long sessions
- keeps heavy editing features out of simple read-only visits

### 1.3 Namespace translation files

Current translation payloads are still large.

Split by namespace instead of per-language monolith:
- `auth`
- `shell`
- `dashboard`
- `products`
- `contacts`
- `settings`
- `portal`

Why:
- smaller first render
- avoids pulling portal/product copy when a user only opens dashboard

### 1.4 Strengthen table and list rendering

Apply virtualization where data can grow significantly:
- products
- customers
- suppliers
- audit log
- files/library

Why:
- improves long-session responsiveness
- lowers CPU and memory cost on weaker devices

## Phase 2: Sync Reliability

These changes should make multi-device behavior more predictable.

### 2.1 Formalize per-table sync metadata

Add sync metadata for syncable tables:
- `updated_at`
- `updated_by`
- `version`
- optional `deleted_at` for soft deletes where appropriate

Use this for:
- stale write detection
- delta sync
- conflict reporting

### 2.2 Move from broad refreshes to delta sync

Instead of refreshing whole datasets after many operations:
- sync by table
- sync by `updated_at` cursor
- fetch only changes since the last known checkpoint

Why:
- less bandwidth
- faster remote devices
- less UI churn after writes

### 2.3 Add explicit conflict outcomes

Current conflict handling is mostly optimistic rejection.

Next step:
- detect conflict type:
  - stale update
  - stale delete
  - deleted-on-server
  - version mismatch
- return structured payload:
  - client copy
  - server copy
  - conflict reason
  - conflict timestamp

Frontend then decides:
- retry automatically
- prompt user
- merge safe fields

### 2.4 Background sync queue discipline

Keep the queue, but tighten policy:
- queue writes only for approved operations
- pause non-critical sync when tab hidden
- resume on focus, reconnect, or after critical user actions
- batch retries to avoid thrash

Why:
- smoother UI
- less background churn on weak links

## Phase 3: Heavy Work Off Main Thread

### 3.1 Move CPU-heavy workflows into workers

Best candidates:
- CSV parsing/import
- report generation
- sync diff calculation
- large Dexie write batches

Why:
- avoids UI freezes
- keeps navigation smooth during imports and sync

### 3.2 Chunk Dexie hydration and writes

Avoid large synchronous DB work on startup:
- hydrate only what the current route needs
- write in batches of a few hundred rows
- avoid clearing and replacing very large tables unless necessary

Why:
- less startup jank
- fewer freezes when data volumes grow

## Phase 4: Data Layout and Organization Isolation

### 4.1 Move the live runtime data root fully under organization-owned paths

Current state:
- org scaffolding exists
- live source-of-truth paths are still not fully rooted under the org runtime

Target:
- each organization owns its own:
  - DB
  - uploads
  - imports
  - exports
  - backups
  - logs

Why:
- cleaner tenant separation
- easier backup/restore per organization
- less accidental data bleed between future businesses

### 4.2 Add startup migration/version coordination

When code changes or schema changes:
- store an app/build version marker
- store a schema version marker
- run explicit migrations at startup
- surface migration status in admin diagnostics

Why:
- safer updates
- clearer handling when one device upgrades before another

## Phase 5: Observability and Failure Visibility

### 5.1 Add real client-side diagnostics

Track and expose:
- slow route loads
- repeated local fallback usage
- sync queue backlog
- websocket reconnect counts
- auth refresh failures

### 5.2 Add server-side performance counters

Track:
- slow queries
- slow API routes
- sync conflict frequency
- upload processing duration

Why:
- lets us fix real bottlenecks instead of guessing from anecdotal lag

## Phase 6: Full Relational Schema Map And Data Loss Guardrails

Target:
- Build and maintain a complete relationship map for every table, migration,
  business entity, and cross-table workflow.
- Make every future deep rework prove that data is preserved before it ships.

Mini phases:
- 6.1 Extract tables, columns, indexes, constraints, triggers, and generated
  fields from `backend/src/db/postgresSchema.sql`.
- 6.2 Classify tables by domain:
  - identity and sessions
  - products and inventory
  - sales, returns, discounts, loyalty
  - contacts and customers
  - files, uploads, media, object storage
  - imports, exports, backups
  - sync, audit, action history, notifications
  - settings and runtime metadata
- 6.3 Produce a table-by-table relationship matrix:
  - parent table
  - child table
  - foreign key or implicit reference
  - delete behavior
  - restore behavior
  - offline/sync behavior
  - owner/tenant scope
- 6.4 Identify implicit relationships that should become explicit constraints
  or validated application-level references.
- 6.5 Add migration safety checks before structural rewrites:
  - row counts before/after
  - orphan checks
  - duplicate key checks
  - nullable-to-required readiness checks
  - backup manifest confirmation
- 6.6 Repeat the schema sweep against runtime DDL in `postgresDatabase.ts` and
  `systemJobs.ts` so schema added after the dump is not missed.
- 6.7 Repeat the relationship sweep against route/service SQL joins, manual
  cascades, and `*_id` filters.
- 6.8 Repeat the implicit-schema sweep against JSON text columns, settings
  payloads, custom tables, object-storage paths, Redis-backed queues, and Dexie
  offline stores.
- 6.9 Maintain `ops/docs/SCHEMA-RELATIONSHIPS.md` as the current relational
  schema source of truth before any table rewire.
- 6.10 Build a prioritized DDL backlog:
  - missing primary keys
  - idempotency unique indexes
  - detail-read indexes
  - `NOT VALID` foreign keys
  - JSON text to `jsonb` candidates
  - taxonomy ID migration
- 6.11 For every DDL candidate, write the cleanup query, migration query,
  rollback query, and verification query before implementation.
- 6.12 Keep `ops/scripts/backend/schema-audit.ts` as the repeatable schema
  coverage guard, and regenerate `ops/docs/reference/SCHEMA-AUDIT.md` after any
  schema, backup, restore, or Dexie-store change.
- 6.13 Classify backup coverage gaps found by the generated audit:
  - durable business state that must be backed up,
  - reconstructable/index/runtime state that can be rebuilt,
  - intentionally excluded sensitive or transient state.
- 6.14 Keep the current backup gap fix covered before deeper rewires:
  `product_batches`, `branch_batch_stock`, `sale_item_batch_allocations`,
  `return_item_batch_allocations`, and `stock_row_moves` are now in
  `BACKUP_TABLES`; `system_jobs` is explicitly classified as non-backup runtime
  state.

Tests and analysis:
- Keep the generated schema audit script green:
  `node ops\scripts\backend\schema-audit.ts`.
- Add a restore rehearsal that imports a backup into a throwaway DB and compares
  critical counts.
- Add a generated schema diagram artifact under `ops/docs/reference/`.
- Add an orphan-check suite for users/roles, products/stock/images/batches,
  sales/items/returns, import-job children, RFID children, and file usages.
- Add `EXPLAIN (ANALYZE, BUFFERS)` snapshots for high-volume product, POS,
  inventory, dashboard, sales export, and portal search queries before index
  rewires.

Safety gate:
- No schema rewire can proceed without a successful backup, restore rehearsal,
  and count/relationship diff.
- No foreign key should be validated until existing orphan rows have a documented
  cleanup decision: repair, null, archive, or delete.

## Phase 7: Connection Pathway Audit And Gateway Stabilization

Target:
- Make all client-to-server paths more predictable across local, Cloudflare
  Tunnel, flaky Wi-Fi, and long-running sessions.

Mini phases:
- 7.1 Map every network entry point:
  - app shell
  - API reads
  - API writes
  - websocket sync
  - uploads
  - media/object URLs
  - public portal
  - health and diagnostics
- 7.2 Standardize transient failure handling for 429, 499, 500, 502, 503, 504,
  520, 522, 523, 524, and 530.
- 7.3 Add one shared retry/backoff profile per operation class:
  - fast read
  - slow report/export
  - idempotent write retry
  - upload resume
  - websocket reconnect
- 7.4 Add visible state that differentiates:
  - offline
  - tunnel unavailable
  - auth expired
  - server reachable but route failed
  - local cache serving stale data
- 7.5 Add gateway-specific tests so Cloudflare failures do not look like app
  logic failures.

Tests and analysis:
- Extend `frontend/tests/apiHttp.test.ts`.
- Add backend route contract checks for health, auth, and upload routes.
- Add Playwright smoke tests for local and public admin URLs.

Safety gate:
- Retry logic must not duplicate writes or hide authorization failures.

## Phase 8: Loader, Action, And Button Stability Sweep

Target:
- Ensure every high-impact user action has correct busy state, disabled state,
  timeout recovery, retry copy, and idempotency.

Mini phases:
- 8.1 Inventory every button/action by page and classify risk:
  - destructive
  - creates records
  - updates records
  - uploads files
  - exports/downloads
  - sync/backups
  - camera/scanner
- 8.2 Verify double-click behavior and rapid repeat behavior.
- 8.3 Standardize busy guards for each action class.
- 8.4 Add loader timeouts that recover without clearing valid existing data.
- 8.5 Add targeted tests for the most dangerous action paths first:
  - sales create/payment
  - returns create/edit
  - product import/apply
  - backup restore/export
  - settings save
  - upload/media replace

Tests and analysis:
- Add source-level guards in utility tests where DOM mounting is expensive.
- Add Playwright checks for at least one representative action per class.
- Record findings in `ops/docs/whole-app-hardening.md`.

Safety gate:
- No action should be able to create duplicate business records from a single
  accidental double click.

Current execution note:
- Phase 8.1 inventory and Phase 8.2 priority guards are tracked in
  `ops/docs/reference/ACTION-STABILITY-INVENTORY.md`.
- Priority same-tick guards now cover POS checkout, returns, product import,
  product media save/upload, catalog portal media, file library upload/delete,
  backup export/restore, profile/avatar, and settings save/upload.
- Live verification breadth passed on the local app for profile/avatar,
  settings, catalog, files, and returns.
- Phase 8.3 standardization has started with `frontend/src/utils/actionGuards.mjs`
  and targeted adoption in bulk import, catalog media, settings, secondary
  import modals, OTP, returns, and loyalty point rules. Continue helper adoption
  only where it reduces duplication without hiding action-specific behavior; the
  next main target is Phase 8.4 loader timeout recovery breadth.
- Phase 8.4 has started with background import tracker and branch stock loader
  recovery. The working rule is to prefer timeout/backoff/retry behavior that
  preserves last known good data for visible operational surfaces.
- Phase 8.4 checkpoint verified on local build `eae8be8864cc0fec`:
  background import tracker chunk and `/api/import-jobs?limit=8` poll loaded
  with HTTP 200, Dashboard summary and analytics reads returned HTTP 200, the
  Dashboard `7 Days` range button triggered a fresh analytics read with HTTP 200,
  Branches list and summary reads returned HTTP 200, Branch
  stock expansion rendered after a real Stock button click, Transfer modal
  source-stock loading returned HTTP 200 for the bounded positive-stock page,
  and the Transfer History tab read returned HTTP 200. The Branches loader now
  tracks in-flight read mode so a heavier transfer-tab request can queue behind
  a lighter branch-list refresh instead of being skipped. The runtime smoke
  passed product, stock, sale, return, transfer, analytics, movement,
  action-history, and CSV import-job loops. Sales and Inventory admin user-filter
  option reads are now bounded and
  preserve prior options on auxiliary read failure. Product form supplier reads,
  product image file-picker reads, and Supplier return setup/inventory reads are
  now bounded and verified in the expanded Playwright check. Files page
  library, AI provider, and AI response reads are now bounded and verified with
  live tab clicks. POS customer and delivery-contact option reads are now
  bounded and verified in the same live check. Product lookup manager modals
  for Categories, Units, and Brand now use explicit timeout/no-clear recovery
  and were exercised with live Manage menu clicks. Inventory saved-reasons reads
  are now bounded, retryable after failure, and verified by opening the Reasons
  manager after selecting inventory rows. Inventory movement product-detail
  fallback reads now have an explicit timeout before falling back to the
  movement snapshot. Products page auxiliary category/unit/branch reads, product
  filter metadata reads, and by-id refreshes now have explicit timeouts, with
  live `/api/products/search` and `/api/products/filters` coverage. Product
  lookup manager bulk-operation support reads are now also bounded: category,
  unit, and brand delete, rename, undo, and restore snapshot reads use explicit
  timeouts around lookup and full-catalog product fetches. Inventory secondary
  return/dashboard stats reads now use explicit timeouts and no longer convert
  transient failures into zero/empty stats; customer return history lookup now
  fails closed instead of assuming no previous returns. Contacts all-export
  customer/supplier/delivery reads, Loyalty customer point reads, and Users/Roles
  reads are now bounded/no-empty where appropriate and live-verified. Audit log,
  Settings OTP status, Server sync config, Server diagnostics, and pending sync
  queue reads are now bounded and live-verified where non-mutating. OTP
  setup/confirm/disable and favicon preview reads are source-tested with
  explicit timeout constants. Catalog portal bootstrap, AI status, editor
  provider/review helpers, favicon generation, AI request, and membership lookup
  now have explicit timeout constants; the editor provider/review helpers are
  live-verified and the membership lookup is exercised through the Loyalty
  lookup button. Returns list/detail/snapshot helper reads now have explicit
  timeout constants. Public portal config, metadata, bootstrap, and product
  search reads now have explicit timeout constants and are live-verified through
  `/public`. Receipt Settings save/refresh and Receipt Preview dynamic import
  now have explicit timeout constants; live verification opens Receipt Settings
  and confirms the preview renders without mutating settings. Profile modal
  details, OTP status, verification capabilities, and sign-in method reads now
  have explicit timeout constants and live verification through the Profile
  button. Latest report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-17T09-36-22-477Z/report.json`.
  Continue Phase 8.4 with the next visible operational loaders before moving
  into Phase 9 loop and function efficiency scans; remaining full-catalog helper
  reads and smaller modal/helper panes are likely next candidates.

## Phase 9: Function And Loop Complexity Audit

Target:
- Find loops, nested loops, repeated transforms, and broad refreshes that waste
  CPU, memory, or network resources.

Mini phases:
- 9.1 Scan for nested loops over product, sale, inventory, import, and file
  arrays.
- 9.2 Replace repeated O(n*m) lookups with indexed maps where safe.
- 9.3 Move repeated normalization into shared helpers with tests.
- 9.4 Add dataset-size benchmarks for import planning, product grouping, POS
  search, inventory summaries, and dashboard aggregation.
- 9.5 Split large functions only where the split creates testable boundaries,
  not as cosmetic churn.

Tests and analysis:
- Add micro-benchmark scripts under `ops/scripts/performance/`.
- Add regression tests around changed helpers before rewrites.
- Add before/after timings to `ops/docs/reference/PERFORMANCE-SCAN.md`.

Safety gate:
- Behavioral snapshots must match before/after for transformed datasets.

## Phase 10: Smarter Read Models And Derived Data Strategy

Target:
- Reduce repeated expensive joins and recalculations without making stale data
  dangerous.

Mini phases:
- 10.1 Identify derived values used repeatedly:
  - stock availability
  - product family/group state
  - customer spend
  - revenue/profit/refund summaries
  - dashboard KPI cards
  - portal product availability
- 10.2 Decide per derived value:
  - compute live
  - cache in memory
  - store as materialized table
  - store as snapshot with invalidation
- 10.3 Add invalidation rules tied to writes:
  - product update
  - stock movement
  - sale create
  - return create/edit
  - import apply
- 10.4 Add "stale but safe" UI flags for delayed derived refreshes.

Tests and analysis:
- Add backend tests proving summaries update after each relevant write.
- Add dashboard snapshot tests comparing derived totals to raw source tables.

Safety gate:
- Do not cache business totals unless invalidation is explicit and tested.

## Phase 11: Upload, Camera, Image, Video, And File Pipeline Rework

Target:
- Make media workflows faster, safer, resumable, and consistent across admin
  and public portal use.

Mini phases:
- 11.1 Map every upload entry point:
  - product image
  - catalog image
  - portal media
  - file library
  - barcode/camera image scan
  - receipt/export images
  - backup package
- 11.2 Standardize upload states:
  - selected
  - validating
  - compressing/transcoding
  - uploading
  - processing
  - attached
  - failed/retryable
- 11.3 Move image compression and metadata extraction off the main thread.
- 11.4 Add file-type, size, dimension, and extension validation in both frontend
  and backend.
- 11.5 Add object key ownership checks and signed/public URL rules.
- 11.6 Evaluate chunked/resumable uploads for large videos and backup files.

Tests and analysis:
- Add tests for media URL sanitization and object-key authorization.
- Add Playwright upload/camera fallback tests where browser support allows.
- Add sample large file stress test outside committed artifacts.

Safety gate:
- Upload rewrites must not break existing image references or public catalog
  media URLs.

## Phase 12: Security And Permission Reauthorization Pass

Target:
- Re-check authorization at every route, action, file, and cross-user boundary.

Mini phases:
- 12.1 Produce a permission matrix:
  - route
  - required permission
  - ownership requirement
  - sensitive fields returned
  - write side effects
- 12.2 Audit backend routes for auth-only endpoints that need stronger
  permissions.
- 12.3 Audit frontend hidden controls so UI permissions match route permissions.
- 12.4 Audit local/offline storage for sensitive fields.
- 12.5 Add tests for cross-user access attempts.

Tests and analysis:
- Extend backend security tests.
- Add route contract tests for every privileged endpoint.
- Add a "sensitive response fields" checklist to the attack surface map.

Safety gate:
- No sensitive route should rely on frontend hiding as the primary control.

## Phase 13: Sync Queue, Offline Vault, And Conflict Resolution Upgrade

Target:
- Make offline writes reliable, inspectable, conflict-safe, and cheap to replay.

Mini phases:
- 13.1 Classify write operations by conflict risk.
- 13.2 Add operation-specific merge rules only for fields that are safe to merge.
- 13.3 Add conflict preview UI for business-critical conflicts.
- 13.4 Make replay resumable by operation id.
- 13.5 Add queue backpressure so reconnect does not flood the server.

Tests and analysis:
- Add replay tests for interrupted sync.
- Add stale version conflict tests for products, contacts, sales, returns, and
  settings.
- Add simulated reconnect storm test.

Safety gate:
- Sync replay must never silently overwrite newer server data.

## Phase 14: Runtime Worker And Background Job System Audit

Target:
- Make imports, media processing, backups, exports, and reports use resources
  intelligently.

Mini phases:
- 14.1 Map every worker:
  - import worker
  - media worker
  - backup jobs
  - export/report jobs
  - background sync
- 14.2 Define job classes and resource limits:
  - CPU-heavy
  - IO-heavy
  - user-blocking
  - background maintenance
- 14.3 Add concurrency caps per class.
- 14.4 Add cancellation and recovery where possible.
- 14.5 Add job status detail visible in diagnostics.

Tests and analysis:
- Add queue tests for retries, cancellation, and duplicate job keys.
- Add stress test for large import plus media uploads.

Safety gate:
- Background jobs must not starve normal POS/sales/dashboard API traffic.

## Phase 15: Frontend State Ownership And Re-render Reduction

Target:
- Reduce unnecessary rerenders, state duplication, and broad context churn.

Mini phases:
- 15.1 Map context providers and high-frequency state:
  - auth/session
  - sync
  - navigation
  - local mirrors
  - settings/theme/language
- 15.2 Split contexts where broad updates rerender too much UI.
- 15.3 Memoize derived data only when profiling proves benefit.
- 15.4 Move expensive transformations closer to their owning feature.
- 15.5 Add render-count instrumentation in development-only mode.

Tests and analysis:
- Add React profiler runs for dashboard, products, POS, inventory, and catalog.
- Add performance budgets for route switch and first interaction readiness.

Safety gate:
- State refactors must keep offline/local mirror behavior identical.

## Phase 16: UI System And Responsive Density Review

Target:
- Make the UI more consistent, scannable, compact where needed, and resistant
  to overflow.

Mini phases:
- 16.1 Inventory repeated UI primitives:
  - buttons
  - tabs
  - filter bars
  - stat cards
  - chart legends
  - modals
  - list rows
  - mobile cards
- 16.2 Create or strengthen shared variants for compact, dense, danger, loading,
  selected, and disabled states.
- 16.3 Add mobile viewport checks for every major page.
- 16.4 Remove nested-card and oversized-control patterns where they hurt
  operational screens.
- 16.5 Add chart/table readability standards.

Tests and analysis:
- Extend UI verification to check overflow and text clipping.
- Add Playwright screenshots for dashboard, products, inventory, POS, returns,
  settings, portal editor, and public portal.

Safety gate:
- Visual compaction must not reduce tap targets for dangerous or frequently
  repeated actions below usable limits.

## Phase 17: Query, Index, And Transaction Correctness Audit

Target:
- Make database reads faster and writes safer under realistic data volume.

Mini phases:
- 17.1 Identify slow or high-frequency queries.
- 17.2 Add missing indexes based on actual WHERE/JOIN/ORDER usage.
- 17.3 Review write transactions for:
  - partial failure
  - duplicate idempotency keys
  - inventory movement consistency
  - sale/return cost correctness
  - loyalty point updates
- 17.4 Add transaction wrappers around multi-table business writes that still
  rely on sequential loose statements.
- 17.5 Add explain-plan snapshots for critical queries.

Tests and analysis:
- Add backend tests for partial failure rollback.
- Add generated index report under `ops/docs/reference/`.

Safety gate:
- Index changes must be migration-safe and measured; transaction changes must
  prove rollback behavior.

## Phase 18: API Contract And Type Boundary Hardening

Target:
- Make frontend/backend data shapes explicit so rewrites do not break silently.

Mini phases:
- 18.1 Inventory API responses consumed by the frontend.
- 18.2 Add lightweight runtime validators for high-risk payloads:
  - auth
  - dashboard
  - products
  - inventory
  - sales
  - returns
  - files/uploads
  - backup jobs
- 18.3 Add contract tests for required fields and invalid payload behavior.
- 18.4 Consider shared schema files only where they reduce real duplication.
- 18.5 Add version mismatch handling for incompatible contract changes.

Tests and analysis:
- Extend `frontend/tests/apiHttp.test.ts`.
- Add backend contract fixtures for representative payloads.

Safety gate:
- Contract validation must degrade gracefully for read failures and never invent
  fake successful data.

## Phase 19: Language And Runtime Conversion Evaluation

Target:
- Evaluate whether any subsystem should move to a different language/runtime for
  speed, stability, or maintainability.

Mini phases:
- 19.1 Identify candidates:
  - CSV parsing
  - barcode/image scanning helpers
  - report rendering
  - backup verification
  - media processing
  - import diff planning
  - analytics snapshots
- 19.2 Benchmark current JavaScript/Node implementation first.
- 19.3 Prototype only isolated modules with stable IO boundaries.
- 19.4 Compare Node workers, Web Workers, WASM libraries, native CLI tools, and
  database-side processing.
- 19.5 Keep JS/React for interactive UI unless a measured bottleneck proves a
  different boundary is better.

Tests and analysis:
- Add before/after benchmarks and correctness fixtures.
- Require identical output for every conversion candidate.

Safety gate:
- No rewrite by taste. Convert only with measured speed/stability gains and a
  rollback path.

## Phase 20: Data Import, Deduplication, And Merge Intelligence

Target:
- Make import paths faster, safer, and smarter about product/contact/history
  relationships.

Mini phases:
- 20.1 Audit import planners for product, contact, sale, and inventory data.
- 20.2 Improve duplicate detection using normalized names, identifiers, brands,
  units, prices, and branch stock.
- 20.3 Add user-visible merge explanations before destructive or collapsing
  actions.
- 20.4 Add chunked validation and progress reporting for large files.
- 20.5 Persist cancelled/recoverable job state.

Tests and analysis:
- Add large-file deterministic test fixtures.
- Add merge explanation tests so import decisions stay understandable.

Safety gate:
- Imports must never silently merge distinct products or drop source rows.

## Phase 21: Backup, Restore, And Disaster Recovery Drill

Target:
- Make bold reworks safe by proving we can recover.

Mini phases:
- 21.1 Define backup completeness:
  - database
  - uploads/object keys
  - settings
  - import job metadata
  - backup manifests
  - runtime version
- 21.2 Add restore rehearsal into verification flow.
- 21.3 Add checksum and count comparisons.
- 21.4 Add "pre-risky-change" backup reminder/check.
- 21.5 Document operator recovery steps.

Tests and analysis:
- Add automated backup package validation.
- Add restore smoke test against throwaway runtime storage.

Safety gate:
- Deep rewires require a recent verified backup and a tested restore path.

## Phase 22: Public Portal And Admin Boundary Optimization

Target:
- Keep public customer traffic lightweight and isolated from admin-heavy code.

Mini phases:
- 22.1 Split public portal dependencies from admin dependencies where possible.
- 22.2 Audit public routes for cacheability and media weight.
- 22.3 Optimize portal images and catalog filtering.
- 22.4 Ensure public reads cannot expose admin-only fields.
- 22.5 Add independent smoke tests for public customer URL.

Tests and analysis:
- Add bundle-size check for public portal chunks.
- Add public API response field tests.

Safety gate:
- Public optimization must not weaken access control or leak drafts/internal
  product details.

## Phase 23: Analytics Semantics And Business Metric Correctness

Target:
- Make dashboard/report numbers understandable, correct, and resistant to
  misleading zero/net cases.

Mini phases:
- 23.1 Define metric dictionary:
  - gross sales
  - discounts
  - refunds
  - net revenue
  - COGS
  - profit
  - sales count
  - returns count
  - collected total
- 23.2 Add formula display for each KPI.
- 23.3 Compare dashboard values to raw SQL fixtures.
- 23.4 Improve charts so gross/refunds/net relationships are visible.
- 23.5 Add report export consistency checks.

Tests and analysis:
- Add analytics fixture test covering full refund, partial refund, discount,
  return-to-stock, and no-cost product scenarios.

Safety gate:
- Metric labels must match what the SQL actually calculates.

## Phase 24: Release, Verification, And Deployment Discipline

Target:
- Make every release measurable, reversible, and easy to verify.

Mini phases:
- 24.1 Define standard verification tiers:
  - fast local utility tests
  - backend route/security tests
  - frontend build
  - Playwright smoke
  - public/admin health
  - backup/restore rehearsal for risky changes
- 24.2 Add release notes template with:
  - migrations
  - data risk
  - rollback notes
  - tested flows
  - known limitations
- 24.3 Add runtime hash verification to prevent stale bundles. Done:
  `ops/scripts/verification/verify-runtime-deps.ts`, which is called by
  `run/verify-local.bat` before frontend build/test work, now verifies the
  frontend build manifest emission, service-worker build-hash cache key,
  frontend runtime mismatch event, AppContext listener, backend
  `/api/runtime/version` route, backend frontend-build metadata reader, and
  frontend performance build-metadata guard. If a built
  `frontend/dist/business-os-build.json` already exists, the verifier also
  checks that it has concrete `revision`, `hash`, and `builtAt` values.
- 24.4 Add post-start diagnostics checklist. Done:
  `ops/scripts/runtime/smoke/post-start-diagnostics.ts` now checks the local
  `/health`, `/api/runtime/version`, `/business-os-build.json`, and `/sw.js`
  startup surface, records optional public/admin health, and writes a JSON
  checklist artifact. `start-runtime.ps1` and Docker release health checks run
  it after the route-contract smoke so support can see exactly which runtime,
  build, service-worker, and tunnel health checks passed.

Tests and analysis:
- Keep current `start-runtime.ps1` health checks and extend with targeted smoke
  probes for changed surfaces.

Safety gate:
- No final handoff without stating exactly what was and was not verified.

Current checkpoint:
- Phase 8.4 loader recovery is currently active.
- Phase 6 schema/data guardrails were expanded on 2026-05-18. The full current
  relational schema audit now lives in `ops/docs/SCHEMA-RELATIONSHIPS.md` and
  covers canonical Postgres tables, runtime DDL, implicit JSON/polymorphic
  schemas, Dexie offline stores, Redis queue/cache usage, object-storage path
  references, and optimized DDL recommendations.
- Phase 6 now has a repeatable generated audit:
  `ops/scripts/backend/schema-audit.ts` writes
  `ops/docs/reference/SCHEMA-AUDIT.md`. Latest generated counts: 45 static
  Postgres tables, 9 runtime `CREATE TABLE` statements, 21 runtime
  `ALTER TABLE ... ADD COLUMN` statements, Dexie version 5 with 24 stores,
  37 backup tables, 0 declared foreign key/reference constraints in scanned
  DDL, and 0 missing relationship-doc entities.
- The generated audit currently reports 0 action-needed backup coverage gaps
  after adding the durable batch inventory/allocation/move tables to
  `BACKUP_TABLES` and classifying `system_jobs` as intentionally non-backup
  runtime state.
- Latest verified build: `42f694565739` / frontend hash `875d7a0928f443de`.
- Latest Playwright report:
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T11-21-12-558Z/report.json`.
- File organization and language-conversion work is now tracked in
  `ops/docs/FILE-ORGANIZATION-LANGUAGE-PLAN.md`, with the generated source map
  at `ops/docs/reference/ORGANIZATION-AUDIT.md`. Latest organization audit
  scanned 345 files across `frontend/src`, `backend/src`, `ops/scripts`, and
  `ops/docs`; it found 57 files above 700 lines and identifies
  `frontend/src/components/inventory/Inventory.tsx`,
  `backend/src/services/importJobs.js`, `frontend/src/components/catalog/CatalogPage.tsx`,
  `frontend/src/components/products/Products.tsx`, and `frontend/src/api/methods.ts`
  as high-value split candidates.
- First Phase 26 physical move complete: Phase 8.4 live Playwright check scripts
  now live in `ops/scripts/runtime/live-checks`, with relative auth/root imports
  updated. The Product page action live check passed from the new path.
- Second Phase 26 physical move complete: Product lookup files now live under
  `frontend/src/components/products/lookups`, including Category, Unit, Brand
  modals and `productLookupSnapshots.mjs`. Product category, unit, and brand
  live checks passed on frontend hash `3296f6327bd7aa53`.
- Third Phase 26 physical move complete: Product form files have started moving
  under `frontend/src/components/products/forms`; `VariantFormModal.tsx` now
  lives there. The Product variant live check passed on frontend hash
  `42378a84fc53ab2f`.
- Fourth Phase 26 physical move complete: Product stock-helper form files
  `BulkAddStockModal.tsx` and `BranchStockAdjuster.tsx` now live under
  `frontend/src/components/products/forms`. The Product stock-helper live check
  passed on frontend hash `b79c04b453d1b469`.
- Fifth Phase 26 physical move complete: Product import files
  `BulkImportModal.tsx`, `productImportPlanner.ts`, and
  `productImportWorker.ts` now live under
  `frontend/src/components/products/import`. The broad Phase 8.4 UI live check
  opened the Product import modal from the real Products button on frontend hash
  `0028bc915078664f`.
- Sixth Phase 26 physical move complete: Product scanning files
  `BarcodeScannerModal.tsx`, `barcodeImageScanner.ts`,
  `barcodeScannerState.ts`, and `scanbotScanner.ts` now live under
  `frontend/src/components/products/scanning`. The focused Product scanner live
  check opened Add Product, opened Scan barcode, applied a manual barcode value,
  and sent zero product mutations on frontend hash `4fdf242042c73694`.
- Seventh Phase 26 physical move complete: Product history helper logic
  `productHistoryHelpers.mjs` now lives under
  `frontend/src/components/products/history`. Product history helper tests,
  source checks, typecheck, production build, runtime health, and the focused
  Product page action live check passed on frontend hash `db2bde8c13de0d64`.
- Eighth Phase 26 physical move complete: Product presentation surfaces
  `HeaderActions.tsx`, `ProductsListSurface.tsx`, and `ProductDetailModal.tsx`
  now live under `frontend/src/components/products/surfaces`. Product discount
  and product pagination source tests, source checks, typecheck, production
  build, runtime health, and the focused Product page action live check passed
  on frontend hash `e9b985386668bdf9`.
- Ninth Phase 26 physical move complete: Product shared primitives
  `primitives.tsx` now lives under `frontend/src/components/products/shared`.
  Products, ProductForm, VariantForm, Product surfaces, Catalog, and POS imports
  were rewired. Product, POS, and portal catalog source tests, source checks,
  typecheck, production build, runtime health, a focused Product page action
  live check, and the broad Phase 8.4 UI live check passed on frontend hash
  `21bd97f0b6d8a0df`.
- Tenth Phase 26 physical move complete: Main product form
  `ProductForm.tsx` now lives under `frontend/src/components/products/forms`.
  Lazy imports, action-stability source tests, performance-loading source tests,
  and the performance verifier were rewired. Source checks, typecheck,
  production build, runtime health, focused Product page action live check, and
  focused Product scanner live check passed on frontend hash
  `d1de3f08c3064e4d`.
- Eleventh Phase 26 physical move complete: Products page config constants
  now live under `frontend/src/components/products/config/productPageConfig.mjs`.
  Month options, visual defaults, read timeouts, and mutation timeouts are
  imported by `Products.tsx`, while source tests read the config module
  directly. Source checks, typecheck, production build, runtime health, focused
  Product page action live check, and focused Product scanner live check passed
  on frontend hash `e0871873ba445219`.
- Twelfth Phase 26 physical move complete: Products page helper functions now
  live under `frontend/src/components/products/helpers/productPageHelpers.mjs`.
  The module owns the debounce hook, brand color map parsing, brand lookup
  normalization, and next-frame scheduling helper; the dead local `multiMatch`
  helper was removed from `Products.tsx`. Helper source tests, source checks,
  typecheck, production build, runtime health, focused Product page action live
  check, and focused Product scanner live check passed on frontend hash
  `a440b744817036af`.
- Thirteenth Phase 26 physical move complete: Product gallery helper functions
  now live under
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`. The
  module owns gallery normalization, primary-image fallback selection, and
  public product image URL resolution. `Products.tsx` now depends on that helper
  instead of carrying local gallery normalization or direct public asset URL
  resolution. Helper source tests, source checks, typecheck, production build,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `ff7f953e9b217168`.
- Fourteenth Phase 26 physical move complete: Product row presentation helpers
  now live under `frontend/src/components/products/surfaces/ProductRowParts.tsx`.
  The module owns the product discount badge, row action menu wrapper, batch
  preview chips, and desktop details cell. `Products.tsx` now imports those
  presentation pieces instead of defining them inline. Source checks, typecheck,
  production build, runtime health, focused Product page action live check, and
  focused Product scanner live check passed on frontend hash
  `f04520d849d51963`.
- Fifteenth Phase 26 physical move complete: Product filter/export helper logic
  now lives under
  `frontend/src/components/products/helpers/productFilterHelpers.mjs`. The
  module owns search-term parsing, branch quantity lookup, filtered product
  selection, and product CSV export row shaping. `Products.tsx` now delegates
  that data work to the helper module. Focused helper tests, source checks,
  typecheck, production build, runtime health, focused Product page action live
  check, and focused Product scanner live check passed on frontend hash
  `8a33b1bdd672f31c`.
- Sixteenth Phase 26 physical move complete: Product selection/pagination
  helper logic now lives under
  `frontend/src/components/products/helpers/productSelectionHelpers.mjs`. The
  module owns visible id extraction, selected-visible id resolution, pagination
  summary math, selected product filtering, letter jump targets, and
  selection-scope predicates. `Products.tsx` now delegates that data work to the
  helper module. Focused helper tests, source checks, typecheck, production
  build, runtime health, focused Product page action live check, and focused
  Product scanner live check passed on frontend hash `f0b69a89f50f0e7f`.
- Seventeenth Phase 26 physical move complete: Product group view helper logic
  now lives under
  `frontend/src/components/products/helpers/productGroupViewHelpers.mjs`. The
  module owns grouped product price labels and grouped summary chip text for
  list rows. `Products.tsx` now delegates that presentation data work to the
  helper module. Focused helper tests, source checks, typecheck, production
  build, runtime health, focused Product page action live check, and focused
  Product scanner live check passed on frontend hash `5781a6bf1ff07e16`.
- Eighteenth Phase 26 physical move complete: Product display data helper logic
  now lives under
  `frontend/src/components/products/helpers/productDisplayHelpers.mjs`. The
  module owns category/unit lookup maps, merged brand option construction,
  branch id/name maps, branch summary labels, and stock-status classification.
  `Products.tsx` now delegates that display data work while preserving the row
  UI. Focused helper tests, source checks, typecheck, production build, runtime
  health, focused Product page action live check, and focused Product scanner
  live check passed on frontend hash `6039db439c681904`.
- Nineteenth Phase 26 physical move complete: Product menu metadata helper
  logic now lives under
  `frontend/src/components/products/helpers/productMenuHelpers.mjs`. The module
  owns export menu item construction, supplier filter option normalization, and
  active filter count calculation. `Products.tsx` now delegates that menu data
  work while preserving the header/export/filter surfaces. Focused helper tests,
  source checks, typecheck, production build, runtime health, focused Product
  page action live check, and focused Product scanner live check passed on
  frontend hash `2641f1ce0445f430`.
- Twentieth Phase 26 organization move complete: Product filter menu section
  builder logic now lives under
  `frontend/src/components/products/helpers/productMenuHelpers.mjs`. The module
  now also owns year/month, branch, group, stock, category, brand, and supplier
  filter section construction. `Products.tsx` now delegates that menu data
  builder while preserving the shared `FilterMenu` UI surface. Focused helper
  tests, source checks, typecheck, production build, runtime health, focused
  Product page action live check, and focused Product scanner live check passed
  on frontend hash `b96c2bf7d1b6c06e`.
- Twenty-first Phase 26 organization move complete: Product row display state
  helper logic now lives under
  `frontend/src/components/products/helpers/productDisplayHelpers.mjs`. The
  module now also owns purchase-price fallback, margin math, visible stock
  quantity, promotion calculation, compact brand/category metadata, branch
  labels, and mobile stock badge presentation. `Products.tsx` now delegates
  shared desktop/mobile row display data while preserving row rendering and
  actions. Focused helper tests, source checks, typecheck, production build,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `8426a118f46c25cc`.
- Twenty-second Phase 26 organization move complete: Product lightbox state
  construction now lives under
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`. The
  module now also owns lightbox image URL resolution, empty-gallery handling,
  and safe start-index clamping. `Products.tsx` now delegates lightbox state
  construction while preserving the lightbox UI and navigation actions. Focused
  helper tests, source checks, typecheck, production build, runtime health,
  focused Product page action live check, and focused Product scanner live
  check passed on frontend hash `3469c4d8b3425629`.
- Twenty-third Phase 26 organization move complete: Product lightbox index
  update logic now lives under
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`. The
  module now also owns reusable lightbox index clamping and active lightbox
  index updates. `Products.tsx` delegates gallery index changes to that helper
  and no longer carries the disabled legacy `false && lightbox` overlay branch.
  Focused helper tests, source checks, typecheck, production build, runtime
  health, focused Product page action live check, and focused Product scanner
  live check passed on frontend hash `713180d4d834b1ce`.
- Twenty-fourth Phase 26 organization move complete: Product detail lightbox
  gallery-input fallback now lives under
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`. The
  module now also owns the detail-modal decision to prefer a normalized clicked
  gallery or fall back to the clicked source image. `Products.tsx` delegates
  that fallback before opening the shared lightbox while preserving the detail
  modal UI. Focused helper tests, source checks, typecheck, production build,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `ce63c5f06c94a85e`.
- Twenty-fifth Phase 26 organization move complete: Product thumbnail state
  construction now lives under
  `frontend/src/components/products/helpers/productGalleryHelpers.ts`. The
  module now also owns one normalized row gallery, a `hasImage` flag, and first
  thumbnail path. Desktop and mobile product rows compute thumbnail state once
  and reuse it for thumbnail display and lightbox open. A stale removed
  callback dependency briefly crashed Products during live verification; root
  cause was confirmed with diagnostic Playwright, the dependency was removed,
  and the final focused Product page/scanner live checks passed on frontend
  hash `3e2b508f0b07839b`.
- Twenty-sixth Phase 26 organization move complete: Product collection index
  construction now lives under
  `frontend/src/components/products/helpers/productSelectionHelpers.mjs`. The
  module now owns product id map construction and parent-product id set
  construction, so Products delegates the `productsById` and
  `parentProductIds` indexes used by grouping and filtering. Focused helper
  tests, source checks, typecheck, production build, performance verification,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `d225ee10885691f9`.
- Twenty-seventh Phase 26 organization move complete: Product restore/write
  payload construction now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  module owns normalized gallery/image fields, price fallbacks, stock
  thresholds, active/group flags, parent ids, and user attribution for restore
  and deleted-product recreation flows. `Products.tsx` delegates that payload
  construction through a small user-context wrapper. Focused helper tests,
  source checks, typecheck, production build, performance verification,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `87ac9fa332bb6004`.
- Twenty-eighth Phase 26 organization move complete: Product branch-stock
  restore adjustment planning now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper compares snapshot branch stock with current branch stock, ignores
  invalid branch ids, treats invalid quantities as zero, and returns only the
  add/remove deltas needed for restore. `Products.tsx` now keeps the API loop
  focused on executing planned adjustments. Focused helper tests, source
  checks, typecheck, production build, performance verification, runtime
  health, focused Product page action live check, and focused Product scanner
  live check passed on frontend hash `f8c95fdbb7171cff`.
- Twenty-ninth Phase 26 organization move complete: Deleted-product restore
  planning helpers now live under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  module now owns default restore branch selection, deleted-id set
  construction, preferred restore branch selection, and parent-id remapping for
  deleted parent/variant batches. `Products.tsx` keeps the restore loop focused
  on API creation, id tracking, and stock restoration. Focused helper tests,
  source checks, typecheck, production build, performance verification,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `f355894dc1465d5c`.
- Thirtieth Phase 26 organization move complete: Product clear-stock
  adjustment planning now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper filters invalid branch ids, ignores zero/invalid quantities, resolves
  purchase/cost unit prices once, and returns only valid branch stock removal
  adjustments for the bulk out-of-stock path. `Products.tsx` now keeps that
  nested loop focused on executing preplanned adjustments. Focused helper
  tests, source checks, typecheck, production build, performance verification,
  runtime health, focused Product page action live check, and focused Product
  scanner live check passed on frontend hash `2fbb7e7e9a4dee2c`.
- Thirty-first Phase 26 organization move complete: Product branch-move
  planning now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper identifies a valid positive-stock source branch, returns an explicit
  transfer plan, returns an initialize plan when no positive stock exists, and
  returns no-op when the product is already in the target branch. `Products.tsx`
  now executes those plans instead of interpreting raw branch rows inline.
  Focused helper tests, source checks, typecheck, production build, performance
  verification, runtime health, focused Product page action live check, and
  focused Product scanner live check passed on frontend hash
  `749aede9830d88e9`.
- Thirty-second Phase 26 organization move complete: Product bulk-run summary
  logic now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper extracts positive finite success and failure ids from concurrent runs
  and returns one stable `{ done, failed, failedIds, updatedIds }` shape for
  bulk delete, bulk add stock, bulk branch move, and bulk update flows. A
  focused helper test caught the `Number(null) === 0` edge, so zero ids are
  rejected explicitly. Focused helper tests, source checks, typecheck,
  production build, performance verification, runtime health, focused Product
  page action live check, and focused Product scanner live check passed on
  frontend hash `8e1cbcfe93564245`.
- Thirty-third Phase 26 organization move complete: Product bulk-update payload
  construction now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper removes only `undefined` update fields, preserves intentional `null`
  and blank-string values, attaches user attribution, and selects the current
  optimistic-lock timestamp before falling back to a snapshot timestamp for
  redo. `Products.tsx` now delegates both update and redo payload construction
  while keeping the workflow loop responsible for confirmation, concurrent
  execution, undo/redo registration, and notifications. Focused helper tests,
  source checks, typecheck, production build, performance verification, runtime
  health, focused Product page action live check, and focused Product scanner
  live check passed on frontend hash `b7f08da087125792`.
- Thirty-fourth Phase 26 organization move complete: Product bulk edit update
  builders now live under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The info
  helper keeps populated category, unit, supplier, brand, and valid low-stock
  threshold values while ignoring blank fields and unsafe threshold text. The
  pricing helper normalizes only provided price fields through the shared price
  normalizer. `Products.tsx` no longer imports pricing normalization directly
  or builds those update objects inside render handlers. Focused helper tests,
  source checks, typecheck, production build, performance verification, runtime
  health, focused Product page action live check, and focused Product scanner
  live check passed on frontend hash `2b36f4913641bbb3`.
- Thirty-fifth Phase 26 organization move complete: Product stock adjustment
  payload construction now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper normalizes product ids, product names, branch ids, quantities, reasons,
  user attribution, and unit-cost fallback/override behavior for bulk
  add-stock and clear-stock execution paths. `Products.tsx` now delegates those
  nested `adjustStock` payloads while preserving the workflow loops that fetch
  latest product rows, run concurrent tasks, and refresh state. A diagnostic
  Playwright probe confirmed the Add Product modal opened after one transient
  live-check wait timeout; the focused Product page and scanner checks then
  passed on the same bundle. Focused helper tests, source checks, typecheck,
  production build, performance verification, runtime health, focused Product
  page action live check, and focused Product scanner live check passed on
  frontend hash `48b70424364d4ee8`.
- Thirty-sixth Phase 26 organization move complete: Product adjust-stock
  payload delegation is now complete for `Products.tsx`. Restore branch-stock
  sync, deleted-product stock restore, clear-stock, bulk add-stock, and branch
  initialization all build their `window.api.adjustStock(...)` payloads through
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper now supports snapshot product-name overrides and zero-quantity branch
  initialization while preserving purchase/cost unit-cost fallback behavior.
  Focused helper tests, source checks, typecheck, production build,
  performance verification, runtime health, focused Product page action live
  check, and focused Product scanner live check passed on frontend hash
  `543cc58df3c2b094`.
- Thirty-seventh Phase 26 organization move complete: Product transfer-stock
  payload construction now lives under
  `frontend/src/components/products/helpers/productWriteHelpers.mjs`. The
  helper maps branch-move plans into `fromBranchId`, `toBranchId`, quantity,
  product identity, note, and user attribution for bulk branch transfers. A
  focused helper test caught invalid branch-id normalization before build
  verification, so the helper now uses the shared finite-number normalizer for
  transfer branch ids. Focused helper tests, source checks, typecheck,
  production build, performance verification, runtime health, focused Product
  page action live check, and focused Product scanner live check passed on
  frontend hash `875d7a0928f443de`.
- Latest runtime smoke covered product create, stock adjust, sale, return,
  transfer, dashboard, analytics, movement search, inventory stats, action
  history, and CSV import job completion.
- Latest focused Playwright runtime check covered authenticated app load plus
  `/api/custom-tables` through `window.api.getCustomTables()` on local hash
  `bda870a593321c52`.
- Latest focused Contacts Playwright check covered the refreshed local bundle
  hash `fb6658da3dd6d8f0`: Contacts page load, Customers/Suppliers/Delivery tab
  buttons, Customer/Supplier/Delivery Add modal buttons, Contacts import picker,
  `/api/customers`, `/api/suppliers`, `/api/delivery-contacts`, no framework
  overlay, and zero relevant first-party console errors.
- Latest focused Sales action Playwright check covered refreshed local bundle
  hash `92150b9c3e7c3c06`: Sales page load, `/api/sales`, real sale selection,
  bulk Done/Delivery/Cancel status button visibility, sale detail modal,
  membership attach field, status selector, no framework overlay, and zero
  relevant first-party console errors.
- Latest focused Branch action Playwright check covered refreshed local bundle
  hash `4b13d6244528d536`: Branches page load, `/api/branches`,
  `/api/branches/summary`, Add/Edit Branch modals, bulk Delete button
  visibility, Transfer modal, `/api/branches/{id}/stock`, disabled transfer
  submit before product/quantity selection, no framework overlay, and zero
  relevant first-party console errors.
- Latest focused Inventory action Playwright check covered refreshed local
  bundle hash `d037ad59dbe3df46`: Inventory page load,
  `/api/inventory/products/search`, `/api/branches`, `/api/inventory/reasons`,
  Adjust modal, Transfer modal, Move Stock modal, Batch Session modal, batch
  transfer/move control switching, no framework overlay, and zero relevant
  first-party console errors.
- Latest focused Product stock-helper Playwright check covered refreshed local
  bundle hash `b79c04b453d1b469`: Products page load,
  `/api/products/search`, `/api/branches`, visible-page selection, bulk Add
  Stock modal, product stock tab Branch Stock Adjuster, no framework overlay,
  and zero relevant first-party console errors. Latest report:
  `ops/runtime/reports/phase84-product-stock-actions-live-check-2026-05-18T06-16-56-368Z/report.json`.
- Latest focused Users/Roles action Playwright check covered refreshed local
  bundle hash `ce3d41a537d09333`: Users page load, `/api/users`,
  `/api/roles`, `/api/action-history`, Add User modal, Change Password modal
  from a row action menu, Roles tab, role edit/delete control rendering, Create
  Role modal, no framework overlay, and zero relevant first-party console
  errors.
- Latest focused Files Providers action Playwright check covered refreshed
  local bundle hash `cba9bab9be5dd975`: Files page load, `/api/files`,
  `/api/ai/providers`, `/api/ai/responses`, `/api/action-history`, Providers
  tab, provider form with five provider options, 12 provider rows with
  Edit/Test/Delete controls, no framework overlay, and zero relevant
  first-party console errors.
- Latest focused Product category-manager action Playwright check covered
  refreshed local bundle hash `8115d343d5877c22`: Products page load,
  `/api/products/search`, `/api/categories`, `/api/products/lookups/usage`,
  product category action-history read, Manage Categories modal, Add/Delete
  selected controls, 24 category row Edit/Delete controls, no framework overlay,
  and zero relevant first-party console errors.
- Latest focused Product unit-manager action Playwright check covered refreshed
  local bundle hash `c9f8b88babd005ad`: Products page load,
  `/api/products/search`, `/api/units`, `/api/products/lookups/usage`, product
  unit action-history read, Manage Units modal, Add/Delete selected controls,
  24 unit row Edit/Delete controls, no framework overlay, and zero relevant
  first-party console errors.
- Latest focused Product brand-manager action Playwright check covered refreshed
  local bundle hash `34c73c8baad40cfa`: Products page load,
  `/api/products/search`, `/api/products/lookups/usage`, product-brand
  action-history read, Manage Brand modal, Add/Delete selected controls, 242
  row Edit controls, 242 row Delete controls, no framework overlay, and zero
  relevant first-party console errors.
- Latest focused Product variant action Playwright check covered refreshed local
  bundle hash `42378a84fc53ab2f`: Products page load,
  `/api/products/search`, row action menu, Add Variant modal, variant name/SKU/
  barcode/unit/branch fields, Add Variant submit button, no framework overlay,
  and zero relevant first-party console errors. Latest report:
  `ops/runtime/reports/phase84-product-variant-actions-live-check-2026-05-18T06-07-30-407Z/report.json`.
- Latest focused Product page action Playwright check covered refreshed local
  bundle hash `8e1cbcfe93564245`: Products page load, `/api/products/search`,
  Add Product modal, product name and Save controls, row action menu, Delete
  confirmation dismissal, zero product mutation requests, no framework overlay,
  and zero relevant first-party console errors. Latest report:
  `ops/runtime/reports/phase84-product-page-actions-live-check-2026-05-18T10-41-06-205Z/report.json`.
- Latest focused Product lookup organization Playwright checks covered refreshed
  local bundle hash `3296f6327bd7aa53`: Products page load, Manage Categories,
  Manage Units, Manage Brand, lookup usage reads, action-history reads, no
  framework overlay, and zero relevant first-party console errors.
- Latest broad Phase 8.4 UI Playwright check covered refreshed local bundle
  hash `0028bc915078664f`: authenticated bootstrap/settings, Dashboard
  analytics, Notifications, Branches, Sales export/import, Products search,
  Product import modal, product image picker, product lookup managers,
  Inventory, Contacts, Loyalty, Users/Roles, Profile, Audit, Settings OTP,
  Backup integration doctor, Server config/diagnostics, no framework overlay,
  and zero relevant first-party console errors. Latest report:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-18T06-26-02-433Z/report.json`.
- Latest focused Product scanner Playwright check covered refreshed local bundle
  hash `8e1cbcfe93564245`: Products page load, Add Product modal, Scan barcode
  modal, manual scanner entry, barcode value applied back to the product form,
  zero product mutation requests, no framework overlay, and zero relevant
  first-party console errors. Latest report:
  `ops/runtime/reports/phase84-product-scanning-actions-live-check-2026-05-18T10-41-06-734Z/report.json`.
- Sales export preview/CSV was added to the loader-recovery target set. The
  backend report query was corrected so product summary grouping is valid under
  Postgres, and the live Playwright path now clicks the export preview button
  and verifies `/api/sales/export` returns HTTP 200.
- Backup integration doctor and system-job status polling were added to the
  loader-recovery target set. Doctor reads now have quick/deep timeout budgets,
  and visible backup/restore job cards tolerate transient status-read failures
  with capped backoff before surfacing an error.
- Product bulk-import cancelled-job recovery was added to the loader-recovery
  target set. Cancelled/retry recovery status reads now have an explicit timeout,
  and the live checker opens the Product import modal through the real Import
  button without mutating product data.
- Product/import-tracker preflight reads were added to the loader-recovery
  target set. Product modal apply and tracker approve paths now use explicit
  preflight timeout budgets, and runtime smoke calls the preflight endpoint
  before approving a live import job.
- Product lookup manager snapshot/restore reads were rewired for resource
  efficiency. Category, Unit, and Brand flows now snapshot affected products
  with paged `/api/products/search` calls scoped to the lookup value, restore
  only affected products with batched by-id fetches, and backend product search
  supports `unit` filtering so Unit snapshots do not fall back to full-catalog
  product reads.
- Product bulk-import create/upload/start pipelines were added to the
  loader-recovery target set. CSV and image-only product imports now bound job
  creation, CSV manifest upload, ZIP/browser image uploads, and job start with
  explicit timeout constants while preserving cancel checks before preflight and
  start.
- Background Import Tracker action buttons were added to the action-stability
  target set. Cancel, retry, approve, error-download, and remove now use the
  shared same-tick action guard plus explicit timeout constants; source tests
  cover the buttons because live-clicking them would mutate jobs or download
  files.
- Shared Action History helper reads were added to the loader-recovery target
  set. Recent history and admin user-filter options now have explicit timeout
  constants, stale response guards, and a no-clear fallback for transient
  user-option failures. The focused Playwright check now asserts the Products
  page `/api/action-history` request returns HTTP 200, and runtime smoke still
  checks the action-history API path.
- AppContext bootstrap/settings reads were added to the loader-recovery target
  set. App settings and auth bootstrap now have explicit timeout constants
  across startup, login, OTP login, runtime refresh, and auth-recovery paths;
  transient settings refresh failures preserve the current shell settings. The
  focused Playwright check now probes `/api/auth/bootstrap`, `/api/settings`,
  and `/api/settings/meta` with the authenticated session.
- Notification Center summary reads were added to the loader-recovery target
  set. The app-shell bell now uses an explicit timeout contract and the focused
  Playwright check clicks the bell, waits for the panel, and verifies
  `/api/notifications/summary` returns HTTP 200.
- POS catalog bootstrap reads were added to the loader-recovery target set. The
  product search/category/branch/filter batch now has an explicit timeout
  contract, and the focused Playwright check verifies each POS catalog endpoint
  returns HTTP 200 before accepting the POS screen.
- POS membership lookup was added to the loader-recovery target set. POS now
  uses an explicit membership lookup timeout, keeps the last confirmed
  same-member panel visible through transient refresh failures, and the focused
  Playwright check selects a real member in POS and verifies the portal
  membership endpoint returns HTTP 200.
- Secondary import modal job pipelines were added to the loader-recovery target
  set. Contact, Sales, and Inventory import modals now use explicit timeouts for
  import-job creation, CSV upload, and job start while preserving same-tick
  submit guards. The focused Playwright check opens each modal from the real UI
  buttons without mutating data, and runtime smoke still proves the import-job
  create/upload/start/preflight/approval/completion path end to end.
- Contacts CRUD mutation paths were added to the action-stability target set.
  Customers, Suppliers, and Delivery save/delete/bulk delete plus undo/redo
  callbacks now use same-tick guards and explicit 12s mutation timeouts. The
  focused Contacts Playwright check exercises the tab/add/import button paths
  without running data-mutating saves or deletes.
- Sales status and membership mutation paths were added to the action-stability
  target set. Single-sale status changes, bulk status updates, membership attach,
  and undo/redo callbacks now use shared same-tick guards plus explicit 12s
  mutation timeouts. The focused Sales Playwright check exercises selection,
  bulk action visibility, and detail controls without submitting mutating
  status/membership changes.
- Branch CRUD and transfer mutation paths were added to the action-stability
  target set. Branch create/update/delete, bulk delete, branch undo/redo
  callbacks, and branch stock transfer submit now use shared same-tick guards
  plus explicit 12s mutation timeouts. The focused Branches Playwright check
  opens Add/Edit/Transfer controls and source-stock reads without submitting
  save/delete/transfer mutations.
- Inventory adjustment, move, transfer, and batch stock mutation paths were
  added to the action-stability target set. Single-product adjust/move/transfer,
  action-history undo/redo callbacks, and selected-product batch
  adjust/transfer/move rows now use shared same-tick guards plus explicit 12s
  mutation timeouts. The focused Inventory Playwright check opens the real
  action surfaces and batch mode switches without submitting stock mutations.
- Product stock helper mutation paths were added to the action-stability target
  set. The Products bulk add-stock modal and product-form branch stock adjuster
  now use shared same-tick guards plus explicit 12s mutation timeouts around
  `adjustStock`. The focused Products Playwright check opens both helper
  surfaces without submitting stock mutations.
- Users/Roles security mutation paths were added to the action-stability target
  set. User create/update, password change, role create/update/delete, and
  related undo/redo callbacks now use shared same-tick guards plus explicit 12s
  mutation timeouts. The focused Users/Roles Playwright check opens Add User,
  Change Password, Roles, and Create Role surfaces without submitting user or
  role mutations.
- Files AI provider mutation paths were added to the action-stability target
  set. Provider create/update, provider test, provider delete, and related
  undo/redo callbacks now use shared same-tick guards plus explicit
  mutation/test timeouts. The focused Files Providers Playwright check opens the
  Providers tab and verifies provider form/action controls without submitting
  provider writes, tests, or deletes.
- Product category manager mutation paths were added to the action-stability
  target set. Category create/update/delete, selected-category delete, and
  category undo/redo callbacks now use shared same-tick guards plus explicit 12s
  mutation timeouts. The focused Product category Playwright check opens Manage
  Categories and verifies Add/Delete selected/Edit/Delete controls without
  mutating category data.
- Product unit manager mutation paths were added to the action-stability target
  set. Unit create/update/delete, selected-unit delete, and unit undo/redo
  callbacks now use shared same-tick guards plus explicit 12s mutation timeouts.
  The focused Product unit Playwright check opens Manage Units and verifies
  Add/Delete selected/Edit/Delete controls without mutating unit data.
- Product brand manager mutation paths were added to the action-stability
  target set. Settings-backed brand create/update/delete, selected-brand delete,
  product brand rewiring, and brand undo/redo callbacks now use a shared
  named-action guard plus explicit 12s mutation timeouts. The focused Product
  brand Playwright check opens Manage Brand and verifies Add/Delete selected/
  Edit/Delete controls without mutating brand data.
- Product variant creation was added to the action-stability target set. The
  Add Variant modal now uses a shared same-tick save guard plus explicit 12s
  mutation timeout around `createProductVariant`. The focused Product variant
  Playwright check opens Add Variant from a row action menu and verifies the
  form controls without creating variant data.
- Main Products page save/delete/upload paths were added to the action-stability
  target set. Product create/update, gallery image upload, single delete, bulk
  delete, and delete redo callbacks now use shared same-tick guards plus
  explicit mutation timeouts. The focused Product page Playwright check opens
  Add Product and a row Delete confirmation without mutating product data.
- Inventory primary loaders were added to the loader-recovery target set. Branch
  options, SQL inventory stats, paged product summaries, movement history, and
  RFID status now use explicit timeout constants, and the focused Playwright
  check asserts product, stats, and movement API reads from the real Inventory
  tabs.

## Phase 25: Continuous Architecture Review And Rewire Candidates

Target:
- Keep improving system shape without making random large refactors.

Mini phases:
- 25.1 Maintain a rewire candidate register:
  - current pain
  - proposed design
  - expected gain
  - blast radius
  - data risk
  - rollback path
  - verification plan
- 25.2 Review candidates monthly or after major features.
- 25.3 Prioritize changes that remove repeated bugs, reduce resource load, or
  simplify data ownership.
- 25.4 Retire dead paths and duplicate abstractions after tests prove they are
  unused.
- 25.5 Keep architectural docs current with every accepted rewire.

Tests and analysis:
- Add dead-code scans and dependency audits to the recurring verification list.
- Add architecture decision records for major rewires.

Safety gate:
- Bold rewrites are allowed, but each must have proof of better correctness,
  speed, stability, security, or maintainability.

## Phase 26: Repository Organization And Folder Rewire

Target:
- Organize files into clearer ownership folders while preserving runtime
  behavior, lazy imports, release packaging, and documented script entrypoints.

Mini phases:
- 26.1 Add and maintain a repeatable organization audit:
  - file counts by extension
  - area counts
  - large-file list
  - relative-import hotspots
  - first-move recommendations
- 26.2 Split ops runtime scripts into grouped folders:
  - runtime audit scripts
  - live Playwright checks
  - runtime smoke checks
  - deployment/runtime helpers
  - compatibility wrappers for old entrypoints until every reference is updated
- 26.3 Split frontend feature folders internally:
  - `products/forms`
  - `products/lookups`
  - `products/import`
  - `products/history`
  - `products/scanning`
  - similar internal splits for inventory, catalog, dashboard, POS, and settings
- 26.4 Split backend domain code only behind tests:
  - keep route paths stable
  - keep table/queue/object-storage paths stable
  - move route helpers and service helpers near their domain owners
- 26.5 Keep generated docs and active plans separated:
  - active plans in `ops/docs`
  - generated references in `ops/docs/reference`
  - runtime reports in `ops/runtime/reports`

Tests and analysis:
- Run `node ops/scripts/architecture/organization-audit.ts` before and after
  moves.
- Use `rg` to update every old path reference.
- Run `npm.cmd run check:jsx`, focused source tests, `npm.cmd run build`, and
  focused Playwright checks for each frontend move.
- Run backend utility tests and route contract tests for each backend move.

Safety gate:
- No broad rename is accepted until all imports, docs, scripts, tests, and live
  checks point to the new location.

Checkpoint:
- `products/lookups` split is complete for lookup modals and lookup snapshot
  helpers. `products/forms` split has started with `VariantFormModal.tsx`,
  `BulkAddStockModal.tsx`, and `BranchStockAdjuster.tsx`. `products/import`
  split is complete for the import modal, planner, and worker.
  `products/scanning` split is complete for the barcode scanner modal and
  scanner helpers. `products/history` split has started with
  `productHistoryHelpers.mjs`. `products/surfaces` split has started with
  Product header, list, and detail presentation files. `products/shared` now
  owns the product image and form primitive helpers. `products/forms` now owns
  the main product form plus variant and stock helper forms. `products/config`
  now owns Products page constants and timeout budgets. `products/helpers` now
  owns Products page helper functions for debounced state, brand lookups, frame
  scheduling, gallery normalization, gallery fallback selection, and public
  image URL resolution. `products/surfaces` now also owns Product row
  presentation parts through `ProductRowParts.tsx`. `products/helpers` also
  owns Product filter/export data helpers through `productFilterHelpers.mjs`.
  `products/helpers` now also owns Product selection and pagination data helpers
  through `productSelectionHelpers.mjs`.
  Keep future product moves similarly scoped: move one cluster, update lazy
  imports/tests/generated docs, build, restart, then run focused Playwright.

## Phase 27: Language Conversion And Runtime Efficiency

Target:
- Convert code to stronger or more specialized languages only when correctness,
  speed, security, packaging, or maintenance improves measurably.

Mini phases:
- 27.1 Expand TypeScript in the frontend from pure helpers outward:
  - convert self-contained utility modules first
  - keep JSX components in JavaScript until React type dependencies and
    `tsconfig` coverage are ready
  - split large components before `.tsx` conversion
- 27.2 Keep backend JavaScript runtime until packaging supports compiled output:
  - add JSDoc and runtime boundary guards first
  - avoid `.ts` backend entrypoints until release packaging is proven
- 27.3 Prefer SQL/DuckDB SQL for set-based heavy data work:
  - import validation
  - report generation
  - backup verification
  - analytics snapshots
- 27.4 Keep PowerShell for Windows runtime orchestration where it is the native
  integration language.
- 27.5 Delay Rust, Go, Python, or native/WASM rewrites unless benchmarked:
  - use them only for CPU-heavy, isolated, packaging-safe workloads.

Tests and analysis:
- Every conversion needs a before/after behavior test.
- Performance-motivated conversions need a benchmark or smoke metric.
- Packaging-sensitive conversions need release/build verification.

Safety gate:
- Language conversion is authorized, but not indiscriminate: conversion must
  have measurable proof and a rollback path.

## Ideas We Should Avoid or Delay

These ideas are either risky for this architecture or not worth the complexity
right now.

### Avoid in the service worker

- API response caching
- HTML caching
- offline write replay in the service worker
- caching uploads/media that users may replace frequently

Why:
- stale business data
- hard-to-debug deploy mismatches
- greater risk of "works on one device, not another"

### Delay until architecture changes

- edge/serverless-first backend deployment for the full app
- micro-frontends
- GraphQL migration
- CDN-only assumptions for private/auth-heavy traffic

Why:
- the current app is still a stateful business system with local data, sync,
  uploads, and long-lived sessions

## Practical Order of Work

If we keep moving on this roadmap, the best order is:

1. Bootstrap endpoint to reduce post-login waterfall requests.
2. Split `CatalogPage` by workflow.
3. Split translations by namespace.
4. Virtualize large tables and lists.
5. Introduce table-level sync versions and delta sync.
6. Move CSV/report/sync-heavy work into web workers.
7. Finish the org-owned runtime data root migration.
8. Add diagnostics for slow loads, conflicts, and reconnect churn.

## Deployment Notes

- Keep backend compression on.
- If a CDN/proxy is added in front later, use it for static assets first.
- Keep Funnel/private app traffic conservative and predictable.
- Prefer asset caching plus local Dexie reads over aggressive network-layer
  caching of business data.

## Phase 28 - Storage Cleanup, Backup Retention, And Access Friction

Status: active. Core retention and cleanup guardrails are in place; follow-on
storage/access rewires must cite the generated Phase 29 references before
schema, folder, cleanup, or language/runtime changes are made.

Targets:
- Keep the repository/runtime folder small by pruning generated reports and
  timestamped backup packages automatically.
- Keep Cloudflare R2 backup mirrors bounded to the newest package unless an
  operator explicitly raises the retention count.
- Reduce Cloudflare Access friction for trusted admin browsers while preserving
  the protected public admin route.

Mini phases:
- 28.1 Measure disk use before deletion. Current largest local buckets were
  `ops/runtime/reports` (~11.4 GB), organization backup packages (~10.3 GB),
  root backup packages (~2.2 GB), ignored demo artifacts (~2.3 GB), and clean
  Codex worktrees (~5.6 GB).
- 28.2 Add automated generated-artifact retention:
  - latest 20 runtime report folders
  - latest 3 local datasync backup packages per backup root
  - latest 1 Cloudflare R2 backup package mirror
- 28.3 Run cleanup from full automation so repeated live tests and backup jobs
  do not grow without bound.
- 28.4 Keep ignored demo/video artifacts opt-in for deletion because they are
  large but not part of normal runtime.
- 28.5 Lengthen Cloudflare Access admin sessions to 720 hours for convenience;
  local Codex/live checks should continue using `http://127.0.0.1:4000`.

Safety gates:
- Do not delete `business-os-data/uploads`, source files, `.env`, or the newest
  backup package.
- Remote R2 deletion must be grouped by backup package prefix under
  `backups/<packageId>/`.
- Retention code must have planner/unit coverage before live cleanup runs.

## Phase 29: Whole-Codebase Multi-Sweep Schema, Cleanup, And Optimization Audit

Status: active as the recurring whole-codebase/schema/cleanup guardrail. The
first Phase 29 baseline was completed at Move 207; follow-on sweeps continue
through the repeatable Phase 29 audit commands and generated references.

Target:
- Coordinate repeated whole-codebase sweeps across backend, frontend, ops, run
  scripts, Cloudflare/runtime configuration, database schema, data flow,
  cleanup, loops, dead code, folder shape, and language/runtime choices.
- Keep generated/runtime bulk measured and pruned without treating it as source
  code.
- Turn findings into safe executable slices for Phase 6 schema hardening, Phase
  9 loop/function optimization, Phase 26 folder rewires, Phase 27 language
  conversion, and Phase 28 storage cleanup.

Required sweep loop:
- Repeat the full loop at least three times before any deep schema rewire,
  broad folder merge, source deletion, or language conversion.
- 29.1 File and folder inventory: scan tracked files and ownership across
  `backend`, `frontend`, `ops`, `run`, root config, Cloudflare docs/scripts,
  package scripts, Docker, and release packaging.
- 29.2 Generated bulk and cleanup inventory: measure but do not parse
  `node_modules`, `frontend/dist`, `ops/runtime`, `business-os-data`,
  generated `release` kits, Playwright artifacts, logs, and generated reports
  as maintainable source.
- 29.3 Schema extraction: read canonical Postgres DDL, runtime DDL, backup
  schema, route SQL, service SQL, Dexie stores, Redis queues/cache,
  object-storage references, custom tables, and JSON/text payload columns.
- 29.4 Relationship verification: cross-check `SCHEMA-RELATIONSHIPS.md`
  against `backend/src/db/postgresSchema.sql`, runtime DDL, `backupSchema.ts`,
  route/service joins, frontend API/Dexie, and generated `SCHEMA-AUDIT.md`.
- 29.5 Loop/function audit: scan loops, nested loops, repeated `O(n*m)`
  transforms, broad refreshes, repeated API waterfalls, oversized modules, and
  weak helper boundaries.
- 29.6 Dead-code/duplication audit: identify unused scripts, stale
  compatibility wrappers, duplicated helpers, abandoned generated references,
  and obsolete docs. Source deletion requires reference proof and passing
  tests.
- 29.7 Folder rewire candidates: rank merge/split candidates by ownership,
  import churn, testability, release packaging, and live-check coverage.
- 29.8 Language/runtime candidates: evaluate TypeScript, SQL/DuckDB, workers,
  PowerShell, Rust, Go, Python, or WASM only where benchmarks and packaging
  prove a correctness, speed, security, or maintenance gain.
- 29.9 Cloudflare/runtime pathway audit: verify public/admin routing,
  Cloudflare Tunnel, R2 backup mirrors, Access session friction, local runtime
  scripts, and release package paths.
- 29.10 Cleanup execution report: delete safe ignored/generated bulk, preserve
  secrets/current data/newest backups, and list bytes removed.
- 29.11 Final recommendation matrix: rank schema rewires, code-flow rewires,
  folder moves, dead-code removals, and language conversions by impact, risk,
  proof required, and rollback path.
- 29.12 Repeat verification: rerun the sweep after doc/reference updates to
  catch contradictions, missed relationships, stale cleanup assumptions, and
  broken path references.

Cleanup checkpoint:
- First Phase 29 cleanup pass removed generated local bulk and old runtime
  artifacts: `ops/node_modules`, `ops/scanbot-web-sdk-7.0.0`, `.playwright-cli`,
  `output`, generated `release` kits, root Vite logs, old runtime prune JSON
  files, temporary Khmer pass folders, old Docker disk migration snapshot,
  generated runtime build artifact, generated launch/demo media assets, and old
  Docker-release backup packages while keeping the newest three.
- The root workspace dropped from the earlier measured multi-GB state to about
  605 MB; `ops` dropped from roughly 753 MB to about 60 MB. Active runtime
  secrets, env files, current business data, uploaded media, and newest backup
  packages were preserved.
- Verification for this checkpoint passed with schema audit, organization
  audit, generated doc reference refresh, performance scan refresh, backend
  utility tests, frontend utility tests, typecheck, JSX check, production build,
  broad Phase 8.4 Playwright UI live check, public Cloudflare portal live check,
  and storage pruning. Latest frontend hash: `a6a634e7a29d6a46`. Reports:
  `ops/runtime/reports/phase84-ui-live-check-2026-05-18T23-15-11-176Z/report.json`
  and
  `ops/runtime/reports/phase84-public-portal-cloudflare-check-2026-05-18T23-15-10-727Z/report.json`.
- Docker-release timestamp backup folders are now covered by the normal local
  backup retention code, so Phase 29 cleanup no longer needs a one-off manual
  deletion pass for folders such as `20260509-065427`.
- Recovery reports are now covered by `prune-storage` with a latest-five
  retention default and support for generated folders and top-level generated
  files.
- Storage cleanup runtime code now lives under
  `ops/scripts/runtime/storage/prune-storage.ts`. The old root runtime
  storage wrapper was removed after package scripts, automation, and tests
  pointed at the grouped implementation.
- Cloudflare and R2 runtime helpers now live under
  `ops/scripts/runtime/cloudflare/`; the old root-level runtime script paths
  remain as compatibility wrappers, while `run/` wrappers, hardening policy,
  and full automation call the grouped implementation paths directly.
- Full-app and deep-live audit implementations now live under
  `ops/scripts/runtime/audits/`; root-level audit files remain as compatibility
  wrappers/re-export modules for existing live-check imports and direct command
  entrypoints.
- Public URL checks, route-contract checks, and the live smoke flow now live
  under `ops/scripts/runtime/smoke/`; root-level smoke files remain as
  compatibility wrappers while run scripts and backend package scripts call the
  grouped paths directly.
- Root-level ops `verify-*` implementations now live under
  `ops/scripts/verification/`; the old `ops/scripts/verify-*.js` paths remain
  compatibility wrappers while local verification and full automation call the
  grouped implementations directly.
- Documentation/reference generation and performance scan implementations now
  live under `ops/scripts/docs/`. Root-level generator compatibility wrappers
  were removed after generated reference headers and inventories were updated
  to use only grouped commands.
- Full-project documentation generation now uses the shared filesystem helper
  library for root resolution, path normalization, text reads, JSON reads,
  line counts, root-file collection, recursive source/folder walks, and text
  detection. This keeps documentation and performance scans aligned on the same
  source traversal behavior.
- Function/reference documentation generation now uses the same shared helper
  library for root resolution, relative paths, UTF-8 reads, JSON reads,
  root-file collection, and recursive source discovery. This removes another
  local docs walker and keeps reference outputs on one traversal policy.
- Phase 8.4 Playwright live-check scripts now share
  `ops/scripts/runtime/live-checks/live-check-utils.ts` for guarded JSON
  fetches. The route-specific live checks still own their action flows and
  assertions, but the repeated timeout/fetch/parse helper is now centralized.
- The public Cloudflare portal live check now records and asserts the real
  response CSP headers: enforced CSP must expose first-party script/connect
  sources and no report-only CSP header may be present. Browser report-only CSP
  console chatter is ignored only after those concrete header checks and the
  page/API/product checks pass.
- Phase 8.4 Playwright live-check scripts now also share the common
  ignored-console filter, latest observed response lookup, guarded
  `waitForRead` helper, and top-modal close helper through
  `ops/scripts/runtime/live-checks/live-check-utils.ts`. The route-specific
  scripts still own their button flows and endpoint assertions.
- Local Phase 8.4 Playwright checks now share console and page-error event
  wiring through `attachConsoleCollector`. The public Cloudflare portal check
  intentionally keeps its custom all-console capture for CSP diagnostics.
- The obsolete `ops/scripts/sync-firebase-release-env.ps1` helper was deleted
  after a reference scan found no first-party callers. Docker release and
  secret-hygiene verification cover the removal.
- Organization audit now includes compatibility-wrapper validation for root
  `ops/scripts` and `ops/scripts/runtime` entrypoints, including broken-target
  detection.
- Compatibility-wrapper validation is now a failing gate: the organization
  audit writes its report, then exits nonzero and prints every broken wrapper
  mapping if any old entrypoint points at a missing grouped implementation.
- Organization audit now scans `run/` and package/root configuration files for
  wrapper references, separates active references from generated-reference
  mentions, and reports removal candidates. The pre-deletion result found 22
  wrappers, zero broken targets, and 17 wrappers with no active first-party
  callers.
- The 17 generated-reference-only compatibility wrappers from that audit were
  deleted as a Phase 29 cleanup slice. Their grouped implementations remain in
  the owned `audits`, `smoke`, `cloudflare`, and `verification` folders. Latest
  organization audit after reference refresh reports 383 scanned files, 5
  remaining compatibility wrappers, zero broken targets, and zero
  wrapper-removal candidates.
- Backend utility verification exposed that tests must be part of the wrapper
  reference scan. Organization audit now includes `backend/test` and
  `frontend/tests`, and backend tests assert the grouped verification paths plus
  absence of deleted wrappers. Verification passed on frontend hash
  `201f436a6618c27e` with backend/frontend utility suites, production build,
  broad Phase 8.4 Playwright, public Cloudflare portal Playwright, stale-path
  scan, and storage pruning.
- Phase 8.4 live-check scripts now import the grouped auth helper directly from
  `ops/scripts/runtime/audits/audit-auth.ts`; the old
  `ops/scripts/runtime/audit-auth.ts` wrapper was deleted after the
  organization audit reported it had zero active references.
- Phase 29 cleanup continued with generated-artifact and Docker hygiene:
  `ops/.playwright-cli` and `run/cv-render-check-word` were deleted after
  exact-path scans found no live first-party references outside generated
  reference docs, freeing 71,657 bytes. `.gitignore`, `.dockerignore`, and
  `ops/scripts/powershell/clean-generated.ps1` now cover these paths plus root
  `output` so future cleanup and Docker build contexts stay smaller. Docker
  cleanup removed one stopped container and safe builder cache only, freeing
  about 105 MB while preserving all volumes and the current `business-os`
  release image tags.
- Current generated/runtime size checkpoint after this slice:
  `business-os-data` 203.77 MB preserved, `frontend/node_modules` 149.01 MB,
  `backend/node_modules` 114.98 MB, `ops/runtime` 54.77 MB, `frontend/dist`
  30.14 MB, and root `node_modules` 3.30 MB. The R2 remote prune follow-up was
  executed later through `npm --prefix ops run prune-storage`; the run retained
  the newest package policy and found no remote backup objects to delete.
- Storage pruning now has an opt-in Docker-safe lane:
  `--docker-safe-prune` runs only `docker container prune -f` and
  `docker builder prune -f`, records Docker `system df` before/after, and never
  runs image, volume, or full system prune commands. Full automation enables
  this through `cleanup.dockerSafePrune` so repeated release/check cycles clear
  dead containers and build cache without risking Postgres, Redis, MinIO, or
  release image state. The first live run after implementation found 0 bytes to
  reclaim because the previous manual safe prune had already cleared available
  cache; all Docker volumes and current app containers remained intact.
- Docker release verification now enforces the same cleanup boundary:
  `.dockerignore` must keep generated/runtime/data exclusions, `.gitignore`
  must keep the local generated-render cleanup rule, storage retention must keep
  the `--docker-safe-prune` implementation, full automation must pass the flag,
  and the automation policy must keep `cleanup.dockerSafePrune` enabled. The
  verifier fails if retention cleanup adds Docker volume, image, or full-system
  prune commands.
- Phase 29 generated-bulk measurements are now repeatable through
  `npm --prefix ops run generated-bulk-audit`. The audit writes
  `ops/docs/reference/GENERATED-BULK-AUDIT.md`, measures dependency/build/
  release/runtime/data folders without parsing them as source, checks ignore
  coverage, separates protected business data/uploads/secrets from cleanup
  candidates, and records the allowed cleanup method for each path.
- Full automation now runs the generated-bulk audit in its test gate after the
  frontend production build and before Docker release contract verification.
  Check/test/release automation therefore catches generated/runtime ignore drift
  and cleanup-boundary regressions without deleting protected data.
- The generated-bulk audit is policy-aware and machine-readable:
  `--policy ops/automation/business-os-automation.json` enables
  `cleanup.generatedBulkCandidateMaxBytes`, currently 536,870,912 bytes. The
  gate applies only to non-protected cleanup candidates and writes
  `ops/docs/reference/GENERATED-BULK-AUDIT.json` alongside the Markdown report.
- Generated cleanup preview is now aligned with the generated-bulk audit:
  `ops/package.json` exposes `clean-generated:preview`, `clean-generated.ps1`
  covers every non-protected generated-bulk cleanup candidate, and the audit
  fails if that coverage drifts. Runtime logs were removed from broad generated
  cleanup and remain under runtime/retention handling.
- Phase 29 has a one-command non-mutating audit loop:
  `npm --prefix ops run phase29:audit` runs generated-bulk, organization,
  schema, performance/code-flow, and Docker release guardrail checks, then writes
  `ops/docs/reference/PHASE29-AUDIT.md`. This is the default quick repeat pass
  before future folder moves, schema rewires, cleanup deletions, or language
  conversion candidates.
- Full automation now uses that combined Phase 29 audit as its regular
  cleanup/schema/organization/Docker guardrail after frontend build. The
  generated-bulk and Docker release checks still run, but through the combined
  audit, so the normal gate also gains organization and schema coverage without
  scattering separate commands.
- The Phase 29 audit now writes
  `ops/docs/reference/PHASE29-AUDIT.json` as a machine-readable companion to
  the Markdown report. It records non-mutating mode, policy path, check count,
  failures, per-check status, duration, command, and report outputs.
- The repeated sweep requirement is executable:
  `npm --prefix ops run phase29:audit:repeat` runs the Phase 29 audit for three
  cycles. The audit records cycle numbers in Markdown/JSON and caps repeat
  counts to avoid accidental runaway loops. Latest repeat run passed 12 checks
  with 0 failures.
- The repeat loop now validates cross-cycle consistency for structured audit
  outputs. Generated-bulk size/coverage fields and organization file/wrapper
  counts must stay stable across cycles; performance/code-flow source counts,
  largest-module markers, and oversized source/chunk candidate lists must also
  stay stable. Schema audit counts and entity lists must also stay stable,
  including static/runtime tables, Dexie stores, backup coverage, relationship
  coverage, and schema entity names. Any drift is reported as a Phase 29
  failure. Docker release guardrail fields must stay stable too, including
  release file counts, ignore coverage, safe-prune coverage, retired artifact
  lists, unsafe prune token lists, and automation policy state.
- The performance/code-flow scan now writes
  `ops/docs/reference/PERFORMANCE-SCAN.json` with source counts, total source
  size/line metrics, built asset counts, largest source/chunk markers, and
  oversized module/chunk candidate lists. This gives loop/function,
  large-module, and language-conversion work a machine-readable baseline before
  any risky rewrite.
- The performance/code-flow JSON also records ranked `topSourceBySize`,
  `topSourceByLines`, and `topBuiltChunks` rows, and Phase 29 repeat runs
  compare those ranked rows across cycles before large-module or chunk rewires.
- Phase 29 Markdown repeat output now summarizes long arrays and objects with
  item/key counts, stable SHA-256 digests, and previews while keeping exact
  values in `ops/docs/reference/PHASE29-AUDIT.json`. This keeps the repeated
  audit readable and lighter as the sweep adds richer evidence.
- Phase 29 console output is concise by default now: each child check prints a
  pass/fail line, duration, and report paths while the command still captures
  stdout for JSON parsing. Use `--verbose` when full child stdout/stderr is
  needed for debugging a failing sweep.
- Generated-bulk measurement now walks independent targets in parallel and
  records `measurementMode: parallel-targets` plus
  `measuredTargetsInParallel: true`. Phase 29 repeat checks those fields so the
  faster measurement strategy remains part of the workflow contract.
- Generated-bulk JSON also records ranked `largestProtectedTargets` and
  `largestCleanupTargets`, and Phase 29 repeat compares those rows. Cleanup
  planning can now focus on the biggest safe candidates while protected
  business data/runtime growth remains visible.
- Phase 29 now records duration profiling in `durationSummary`, including total
  child-check time, per-check totals/averages/max values, and `slowestRuns`.
  Runtime is reported for optimization targeting, but not used as a drift
  stability field because machine load naturally varies.
- Organization audit now walks scan roots in parallel and reads source files
  through a bounded parallel queue. Its JSON records `fileReadMode:
  bounded-parallel` and `fileReadConcurrency: 24`, and Phase 29 repeat compares
  those fields to keep the faster deterministic pathway stable.
- Generated-bulk audit now records per-target `measureMs` values and ranked
  `slowestTargetMeasurements`. Those timings are optimization evidence for
  future cleanup/resource work, not drift-stable fields, because disk and
  runtime load can vary naturally.
- Generated-bulk file stats now use bounded per-directory parallelism:
  `fileStatMode: bounded-per-directory` and `fileStatConcurrency: 32`. Exact
  byte counts remain the contract, while dependency-folder measurement avoids a
  fully sequential stat loop.
- Generated-bulk audit now also records nested target overlap evidence:
  `nestedTargetOverlaps`, `nestedOverlapBytes`, and adjusted non-overlap byte
  estimates. Raw totals remain available and stable, while cleanup planning can
  avoid misreading child targets that are already included inside parent
  folders.
- Phase 29 now includes an executable language/runtime audit:
  `ops/scripts/architecture/language-runtime-audit.ts` writes
  `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md` and JSON with language counts,
  TypeScript utility candidates, Web Worker candidates, SQL/DuckDB data-path
  candidates, runtime policy, and rejected Rust/Go/Python/WASM families.
  `phase29:audit:repeat` compares those fields across cycles before any
  language conversion or runtime split proceeds.
- That language/runtime audit now also carries a conversion proof matrix. The
  JSON and Markdown reports list first executable slices for TypeScript helper
  conversion, Web Worker extraction, and SQL/DuckDB data-path optimization,
  along with required proof commands, rollback expectations, and approval
  boundaries. Phase 29 repeat compares those proof fields across cycles.
- The proof matrix now validates command availability too:
  `proofCommandCoverage` resolves package scripts and local script files, while
  `missingProofCommands` fails the audit if a command-style gate disappears.
  Manual proof rows stay visible as manual evidence requirements.
- The first conversion slices now also carry focused test coverage:
  `focusedTestCoverage` verifies the candidate file and focused test files for
  the TypeScript, Web Worker, and SQL/DuckDB tracks, while
  `focusedTestCoverageGaps` fails Phase 29 if that safety coverage disappears.
- The first TypeScript helper slice is now complete: the CSV import
  implementation lives in `frontend/src/utils/csvImport.ts`, the old
  `csvImport.js` path initially remained as a compatibility wrapper, then was
  retired in Move 480 after callers moved to the TypeScript source. The
  obsolete `pricing.d.ts` shim was removed with the pricing wrapper. The
  language audit records `convertedTypeScriptSlices` and fails with
  `convertedTypeScriptCoverageGaps` if implementation proof disappears.
- The next TypeScript helper slice is also complete:
  `frontend/src/utils/formatters.ts` owns the formatter implementation,
  `formatters.js` remains as a compatibility wrapper, and
  `frontend/tests/formatters.test.ts` is part of the frontend utility suite.
  The language audit now lists both completed TypeScript slices and advances
  the next TypeScript candidate to `frontend/src/utils/groupedRecords.ts`.
- The grouped-record helper slice is now complete:
  `frontend/src/utils/groupedRecords.ts` owns the time/alphabet grouping
  implementation, `groupedRecords.ts` remains as the compatibility wrapper
  used by existing component and test imports, and `initials.ts` documents
  the typed boundary to `initials.ts`. The conversion also removes unused
  duplicated Khmer initial-order constants from the grouping helper.
- The initials helper slice is now complete:
  `frontend/src/utils/initials.ts` owns alphabet/Khmer initial classification,
  callers import the TypeScript implementation directly, and
  `frontend/tests/initials.test.ts` covers classification, aggregation,
  product-derived options, and stable sort order. The language audit records the
  implementation, wrapper, declaration, and proof commands as a completed
  TypeScript slice.
- The media upload helper slice is now complete:
  `frontend/src/utils/mediaUpload.ts` owns upload-state reduction, temporary
  preview sanitization, and cache-busted media paths, while `mediaUpload.js`
  remains as the compatibility wrapper for existing imports. The conversion
  added `mediaUploadHelpers.test.ts` to the utility suite and fixed duplicate
  `v` query parameters when an explicit upload cache version replaces the
  frontend build hash.
- The pricing helper slice is now complete:
  `frontend/src/utils/pricing.ts` owns shared price normalization and product
  discount calculation, while `pricing.js` initially remained as the
  compatibility wrapper for POS, products, catalog, inventory, app context, CSV
  import, and tests, then was retired in Move 480 after callers moved to the
  TypeScript source. The obsolete `pricing.d.ts` shim was removed with the
  wrapper.
- The product grouping helper slice is now complete:
  `frontend/src/utils/productGrouping.ts` owns product family expansion,
  same-name option grouping, variant ordering, section labels, and group
  summaries, while `productGrouping.ts` remains as the compatibility wrapper
  for Products, Inventory, POS, and focused tests. `productGrouping.ts`
  documents the stable `.mjs` boundary for converted TypeScript callers.
- The product display helper slice is now complete:
  `frontend/src/components/products/helpers/productDisplayHelpers.ts` owns row
  display state, stock-status classes, branch stock summary labels, brand
  option merging, and lookup maps, while `productDisplayHelpers.mjs` remains as
  the compatibility wrapper for Products and tests. The frontend TypeScript
  project now includes product helper `.ts` files so these component-helper
  conversions are checked before build.
- The product filter/export helper slice is now complete:
  `frontend/src/components/products/helpers/productFilterHelpers.ts` owns
  search-term parsing, product filter predicates, branch quantity lookup, and
  export-row formatting, while `productFilterHelpers.mjs` remains as the
  compatibility wrapper for Products and tests. `groupedRecords.ts` now
  documents the grouped-record wrapper used by TypeScript component helpers.
- The product menu helper slice is now complete:
  `frontend/src/components/products/helpers/productMenuHelpers.ts` owns export
  menu construction, supplier option normalization, active filter counting, and
  filter-section assembly, while `productMenuHelpers.mjs` remains as the
  compatibility wrapper for Products and tests. The source-inspection pagination
  test now reads the `.ts` implementation instead of the wrapper.
- The product write helper slice is now complete:
  `frontend/src/components/products/helpers/productWriteHelpers.ts` owns
  product write payloads, restore parent/branch planning, branch-stock
  adjustment deltas, stock-transfer payloads, bulk update summaries, and bulk
  info/pricing updates, while `productWriteHelpers.mjs` remains as the
  compatibility wrapper for Products and tests. `productGalleryHelpers.ts`
  documents the gallery helper boundary used by this typed module.
- The product import planner slice is now complete:
  `frontend/src/components/products/import/productImportPlanner.ts` owns CSV
  product import row normalization, identifier conflict analysis, same-name
  family grouping, blocking barcode/encoding issue checks, and summary counts.
  The former product import planner compatibility wrapper has been retired;
  `BulkImportModal`, the import worker, and tests read the TypeScript planner
  directly. Product import `.ts` modules are now part of the frontend typecheck
  gate.
- The action guard utility slice is now complete:
  `frontend/src/utils/actionGuards.ts` owns same-tick single-action,
  named-action, and keyed-action guards, while `actionGuards.mjs` remains as
  the compatibility wrapper for existing component imports and source
  inspection tests. The typed helper documents the mutable-ref and keyed-set
  contracts used by action stability checks.
- The color contrast utility slice is now complete:
  `frontend/src/utils/color.ts` owns hex normalization, relative luminance, and
  contrasting text color selection, while `color.js` remains as the
  compatibility wrapper for Products and ProductDetailModal imports.
- The dashboard date helper slice is now complete:
  `frontend/src/utils/dateHelpers.ts` owns local `todayStr` and `offsetDate`
  formatting, while `dateHelpers.js` remains as the compatibility wrapper for
  the utils barrel and Dashboard import. `frontend/tests/dateHelpers.test.ts`
  gives this slice focused local-date coverage.
- The client device metadata slice is now complete:
  `frontend/src/utils/deviceInfo.ts` owns browser/OS detection and client meta
  header construction, while `deviceInfo.js` remains as the compatibility
  wrapper for API, auth, POS, Sales, and app context imports. The helper now
  reads `globalThis.navigator` for safer non-browser execution.
- The report export package helper slice is now complete:
  `frontend/src/utils/exportPackage.ts` owns report manifest normalization and
  report package file assembly, while `exportPackage.js` initially remained as
  the compatibility wrapper for Dashboard, Inventory, and tests, then was
  retired in Move 480 after callers moved to the TypeScript source. The
  obsolete `csv.d.ts` shim was removed with the CSV wrapper.
- The history snapshot helper slice is now complete:
  `frontend/src/utils/historyHelpers.ts` owns action-history snapshot cloning,
  result-id extraction, and created-snapshot resolution, while
  `historyHelpers.mjs` remains as the compatibility wrapper for the existing
  undo/redo import boundary across business modules.
- The shared utility barrel slice is now complete:
  `frontend/src/utils/index.ts` owns formatter, CSV download, and local date
  helper re-exports, while `index.js` initially remained as the compatibility
  wrapper for the stable utility entrypoint, then was retired in Move 480 after
  callers moved to the TypeScript source.
- The permission parser utility slice is now complete:
  `frontend/src/utils/permissions.ts` owns permission map parsing, while
  `permissions.js` remains as the compatibility wrapper for AppContext and
  permission tests. The typed helper rejects malformed JSON and array payloads
  while preserving already-normalized permission object identity.
- The product batch preview utility slice is now complete:
  `frontend/src/utils/productBatches.ts` owns shared visible-batch filtering
  and preview counts, while `productBatches.mjs` remains as the compatibility
  wrapper for Inventory and Products surfaces. Focused coverage now checks
  all-branch totals, branch-specific stock totals, invalid batch payloads, and
  preview overflow counts.
- The script typography helper slice is now complete:
  `frontend/src/utils/scriptTypography.ts` owns Khmer script detection and
  text prop generation, while `scriptTypography.js` remains as the
  compatibility wrapper for Catalog, POS, Products, and Inventory surfaces.
  Focused coverage now checks Khmer-range detection, `khmer-text` class
  merging, non-Khmer passthrough, and `lang="km"` props.
- The settings refresh routing helper slice is now complete:
  `frontend/src/utils/settingsRefresh.ts` owns settings-to-refresh-channel
  mapping, and the retired `settingsRefresh.js` wrapper is no longer needed by
  API methods or tests. `appRefresh.ts` owns the app refresh utility
  boundary used by this typed module, and focused coverage protects
  setting-rule routing plus app refresh channel normalization.
- The product page config constants slice is now complete:
  `frontend/src/components/products/config/productPageConfig.ts` owns product
  page timeout constants and month options, while `productPageConfig.mjs`
  remains as the compatibility wrapper for the Products surface. Source-style
  coverage now reads the typed implementation for action stability and loading
  timeout contracts.
- The product gallery helper slice is now complete:
  `frontend/src/components/products/helpers/productGalleryHelpers.ts` owns
  gallery normalization, thumbnail state, public image URL resolution, lightbox
  input fallback, and lightbox index clamping, while
  `productGalleryHelpers.ts` remains as the compatibility wrapper for
  Products, typed write helpers, and focused tests.
- The product group view helper slice is now complete:
  `frontend/src/components/products/helpers/productGroupViewHelpers.ts` owns
  product group price labels and summary parts, while
  `productGroupViewHelpers.mjs` remains as the compatibility wrapper for
  Products and focused tests. The conversion keeps formatter/translator inputs
  explicit and narrows filtered summary parts with a type guard.
- The product selection and pagination helper slice is now complete:
  `frontend/src/components/products/helpers/productSelectionHelpers.ts` owns
  visible id extraction, product id maps, parent id sets, selected visible ids,
  pagination state, selected rows, letter jump targets, and selection-scope
  predicates, while `productSelectionHelpers.mjs` remains as the compatibility
  wrapper for Products and focused tests.
- The product history helper slice is now complete:
  `frontend/src/components/products/history/productHistoryHelpers.ts` owns
  deleted-product restore ordering and request-id generation, while
  `productHistoryHelpers.mjs` remains as the compatibility wrapper for Products
  and focused history tests. The conversion keeps parent-first restore ordering
  typed and leaves the public module boundary unchanged.
- The barcode image scanner helper slice is now complete:
  `frontend/src/components/products/scanning/barcodeImageScanner.ts` owns image
  data URL loading, browser image loading, native `BarcodeDetector` detection,
  and zxing fallback decoding. No `.mjs` scanner compatibility wrapper remains.
- The barcode scanner presentation-state helper slice is now complete:
  `frontend/src/components/products/scanning/barcodeScannerState.ts` owns the
  camera permission/status-to-UI-state mapping, labels, retry visibility, and
  empty-state messaging. No `.mjs` scanner compatibility wrapper remains.
- The concurrent bulk task helper slice is now complete:
  `frontend/src/utils/bulkOps.ts` owns concurrency bounds, ordered results,
  success/failure buckets, and per-item error capture, while `bulkOps.mjs`
  remains as the compatibility wrapper for product, inventory, branch, contact,
  and sales bulk-action surfaces. Focused tests now cover the helper directly.
- The app shell helper slice is now complete:
  `frontend/src/app/appShellUtils.ts` owns route normalization, admin/public
  path classification, mounted-page limits, warmup gating, and notification
  labels/colors. The temporary app-shell `.mjs` wrapper has been retired after
  the React shell and focused app-shell tests moved to the TypeScript source.
- The portal catalog display helper slice is now complete:
  `frontend/src/components/catalog/portalCatalogDisplay.ts` owns customer
  portal grid classes, branch matching, promotion display, price presentation,
  and highlight-badge ranking, while `portalCatalogDisplay.mjs` remains as the
  compatibility wrapper and Tailwind now scans TypeScript helper files.
- The portal content i18n helper slice is now complete:
  `frontend/src/components/catalog/portalContentI18n.ts` owns translation
  parsing/stringifying, config and product localization, FAQ exact/vocabulary
  fallback, and protected public-copy terms, while `portalContentI18n.mjs`
  remains as the compatibility wrapper and `portalLanguagePacks.ts` types
  the existing language-pack import.
- The portal editor utility helper slice is now complete:
  `frontend/src/components/catalog/portalEditorUtils.ts` owns about-block
  normalization/serialization, promotion item normalization/serialization,
  safe list reordering, and Google Maps embed URL normalization, while
  `portalEditorUtils.mjs` remains as the compatibility wrapper for the catalog
  editor surface and focused tests.
- The portal language pack helper slice is now complete:
  `frontend/src/components/catalog/portalLanguagePacks.ts` owns first-party
  portal language options, normalization, membership checks, and translated
  text lookup, while `portalLanguagePacks.ts` remains as the compatibility
  wrapper for catalog surfaces and focused portal vocabulary tests. The tiny
  `portalLanguagePacks.ts` declaration stays because TypeScript needs it to
  type imports through the stable `.mjs` wrapper.
- The contact option helper slice is now complete:
  `frontend/src/components/contacts/contactOptionUtils.ts` owns contact-option
  creation, stored JSON parsing, import-row parsing, summaries, and primary
  option selection for customers, suppliers, and delivery contacts, while
  `contactOptionUtils.js` initially remained as the compatibility wrapper, then
  was retired in Move 479 after callers moved to the TypeScript source. The
  typed boundary now normalizes unknown CSV/JSON values before they reach
  contact forms.
- The inventory movement group helper slice is now complete:
  `frontend/src/components/inventory/movementGroups.ts` owns movement timestamp
  normalization, transfer/purchase/adjustment grouping, signed and displayed
  totals, expanded-group pagination, and search haystacks, while
  `movementGroups.js` initially remained as the compatibility wrapper, then was
  retired in Move 479 after callers moved to the TypeScript source. The focused
  movement-group test now runs inside `test:utils`.
- The POS core helper slice is now complete:
  `frontend/src/components/pos/posCore.ts` owns product lookup maps, variant
  children, grouped POS cards, variant choices, cart pricing, cart line IDs,
  and matching logic, while `posCore.mjs` remains as the compatibility wrapper
  for the POS surface. The typed boundary keeps price converters and
  branch-aware line matching explicit.
- The product import worker slice is now complete:
  `frontend/src/components/products/import/productImportWorker.ts` owns the
  browser worker message boundary and progress/result/error posts. The retired
  product import worker wrapper is no longer needed by the bulk import modal,
  which resolves the TypeScript worker entry directly. This keeps main-thread
  import parsing relief intact while adding typechecked worker payload shapes.
- The receipt settings constants slice is now complete:
  `frontend/src/components/receipt-settings/constants.ts` owns the receipt
  default template and translated field metadata, while `constants.js`
  initially remained as the compatibility wrapper for receipt settings and
  template tests, then was retired in Move 478 after callers moved to the
  TypeScript source. The typed boundary makes receipt template keys and field
  item rows explicit.
- The customer membership number helper slice is now complete:
  `frontend/src/components/contacts/customerMembershipNumber.ts` owns the
  `LCMN` membership generator, while `customerMembershipNumber.js` initially
  remained as the compatibility wrapper for contacts imports and tests, then
  was retired in Move 479 after callers moved to the TypeScript source. The
  typed boundary names the prefix and entropy length constants, so the customer
  identifier format stays stable while the helper joins the checked TypeScript
  surface.
- The dashboard chart barrel slice is now complete:
  `frontend/src/components/dashboard/charts/index.ts` owns the chart exports,
  while `index.js` initially remained as the compatibility wrapper for
  dashboard and report-rendering imports, then was retired in Move 479 after
  callers moved to the TypeScript source. `frontend/src/types/jsx-modules.d.ts`
  keeps the existing JSX chart module boundary explicit until chart components
  are converted as separate visual slices.
- The receipt template helper slice is now complete:
  `frontend/src/components/receipt-settings/template.ts` owns parsing and
  serialization of persisted receipt templates, while `template.js` initially
  remained as the compatibility wrapper for receipt settings imports and tests,
  then was retired in Move 478 after callers moved to the TypeScript source.
  The typed boundary accepts `unknown`, narrows object payloads, and keeps
  malformed stored JSON on the default-template recovery path.
- The shared navigation configuration slice is now complete:
  `frontend/src/components/shared/navigationConfig.ts` owns the navigation item
  registry, mobile pinned defaults, stored-setting parser, and saved-order
  helper, while `navigationConfig.js` initially remained as the compatibility
  wrapper for sidebar and settings imports, then was retired in Move 478 after
  callers moved to the TypeScript source. The typed boundary names the allowed
  permission keys and keeps corrupt stored navigation settings on the existing
  fallback path.
- The utils-settings barrel slice is now complete:
  `frontend/src/components/utils-settings/index.ts` owns the admin utility
  component re-export boundary, while `index.js` initially remained as the
  compatibility wrapper for any folder-level imports, then was retired in Move
  479 after callers moved to the TypeScript source.
  `frontend/src/types/jsx-modules.d.ts` records the checked JSX boundary until
  the large settings, backup, audit, reset-data, OTP, and font-picker
  components move in separate slices.
- The settings conflict helper slice is now complete:
  `frontend/src/components/utils-settings/settingsConflict.ts` owns the
  stale-write conflict state and field-diff helpers, while
  `settingsConflict.js` initially remained as the compatibility wrapper for
  Settings page imports and focused conflict tests, then was retired in Move
  479 after callers moved to the TypeScript source. The typed boundary accepts
  `unknown` settings payloads and avoids repeated object normalization inside
  each field diff row.
- The storage policy helper slice is now complete:
  `frontend/src/platform/storage/storagePolicy.ts` owns the live-server local
  mirror allow/deny policy plus notification and Drive cooldown helpers, while
  `storagePolicy.mjs` remains as the compatibility wrapper for API methods and
  storage-policy tests. The typed boundary accepts unknown persisted values and
  keeps sensitive live-server table mirrors blocked.
- The first Web Worker extraction slice is now complete:
  `frontend/src/components/contacts/contactImportWorker.ts` counts contact CSV
  rows off the modal render path, with `frontend/src/utils/csvRowCounter.ts`
  kept as the synchronous fallback and correctness oracle. `ContactImportModal.tsx`
  preserves the existing server-side background import job contract while adding
  a 5 second worker timeout and stale-result guard for rapid file changes.
- The inventory import Web Worker slice is now complete:
  `frontend/src/components/inventory/inventoryImportWorker.ts` counts inventory
  CSV rows off the modal render path, while shared
  `frontend/src/utils/csvRowCounter.ts` keeps contact and inventory row counting
  on one quoted-record-aware parser. `InventoryImportModal.tsx` preserves the
  existing background import job contract and blocks submit while a row check is
  still in flight.
- The product import Web Worker path is now hardened:
  `BulkImportModal.tsx` uses
  `frontend/src/components/products/import/productImportWorker.ts` for heavier
  product CSV analysis, but now falls back to
  `productImportPlanner.ts` when Worker support is missing, worker startup or
  `postMessage` fails, the worker reports an error, or analysis exceeds the
  60 second guardrail. The worker now improves responsiveness without becoming
  a correctness dependency.
- The sales import Web Worker slice is now complete:
  `frontend/src/components/sales/salesImportWorker.ts` counts sales CSV rows
  off the modal render path, while shared
  `frontend/src/utils/csvRowCounter.ts` keeps sales, inventory, and contact row
  counting on one quoted-record-aware parser. `SalesImportModal.tsx` preserves
  the existing background import job contract and blocks submit while a row
  check is still in flight.
- Move 165 rejects `frontend/src/components/shared/BackgroundImportTracker.tsx`
  as a false-positive worker candidate. The tracker polls a bounded import-job
  list, dedupes a maximum of eight visible rows, dispatches completion
  refreshes, and coordinates UI actions, so moving it into a Worker would add
  message overhead without removing meaningful browser CPU work. The
  language/runtime audit now records this decision under
  `rejectedWebWorkerCandidates` and promotes the next real candidates:
  `frontend/src/utils/csv.ts` for export/ZIP work and
  `backend/src/services/backupPackages.js` for backup data-path optimization.
- Move 166 completes the `frontend/src/utils/csv.ts` worker slice:
  `csvExportWorker.ts` now builds export ZIP blobs away from the UI thread,
  `csvExportWorker.mjs` is the stable Vite worker wrapper, and `csv.ts` keeps
  `buildZip()` as the synchronous fallback. `downloadZipFilesAsync()` is now
  used by Dashboard, Inventory, and Contacts package exports, while row-based
  descriptors are normalized so Contacts all-export writes actual CSV files
  into the ZIP instead of passing inert `{ filename, rows }` objects.
- Move 167 completes the first backend data-path optimization slice:
  `backend/src/services/backupPackages.js` now prefers keyset pagination for
  backup table streaming when an `id` column is available, then keeps the
  existing `LIMIT ? OFFSET ?` query as the fallback. This makes large backup
  exports avoid progressively expensive offset scans without changing the
  backup package format, checksums, retention rules, or restore contract.
  `frontend/src/utils/csvImport.ts` is now recorded as a rejected standalone
  worker target because its heavy callers already run through focused workers
  and the remaining sync parser path is a compatibility/fallback boundary.
- Move 168 completes the first import-job data-path optimization slice:
  `backend/src/services/importJobs.js` now caches same-name product rows and
  supplier lookups inside the product import context, then updates that cache
  when rows create or update products. This reduces repeated per-row database
  lookups during reviewed product imports without changing row decisions,
  import-job tables, background queue behavior, media handling, or the apply
  contract. The scanner image helper and scanner modal are now recorded as
  rejected standalone Worker targets because they are bound to DOM image,
  camera permission, video, native detector, zxing browser-control, and React
  lifecycle APIs.
- Move 169 clears the remaining false-positive Web Worker candidates:
  `ImageGalleryLightbox.tsx` remains a React presentation/keyboard navigation
  component, and `importJobRefresh.js` remains a tiny main-thread event
  dispatcher for import completion refreshes. The language/runtime audit now
  filters those files so future worker slices focus on transferable CPU,
  parsing, image preprocessing, scanner-engine, or media work.
- Move 170 completes the schema-audit data-path parser optimization:
  `ops/scripts/backend/schema-audit.ts` now pre-parses ALTER TABLE primary-key
  constraints into a map before walking static table bodies. The audit keeps
  the same generated Markdown/JSON contract, but avoids one full-schema
  primary-key regex scan per parsed table as the schema grows.
- Move 171 completes the import-job route list optimization:
  `backend/src/routes/importJobs.ts` now computes the current user's permitted
  import types and passes that list into `listImportJobs()`, while
  `backend/src/services/importJobs.js` applies a SQL `type IN (...)` filter
  before decoration. This keeps the permission contract unchanged while avoiding
  wasted fetch/decorate/filter work for users who can only view one import
  domain.
- Move 172 consolidates the backup reliability verification script:
  `ops/scripts/verification/verify-backup-reliability.ts` now uses a source
  manifest and grouped required/forbidden text checks for backup package
  streaming, Drive resumable upload, cancellable system jobs, Backup UI
  controls, offline pause behavior, and automation wiring. This keeps the same
  guard strings while removing the repeated one-off assertion chain.
- Move 173 gates canonical schema rewires out of the language/runtime queue:
  `backend/src/db/postgresSchema.sql` is now recorded as a rejected data-path
  conversion candidate. Schema DDL can still change boldly later, but only
  through the schema protocol: backup, restore rehearsal, orphan checks,
  rollback SQL, schema audit, and relationship-doc updates.
- Move 174 optimizes the RFID stock-apply data path:
  `backend/src/routes/inventory.js` now reuses prepared branch, product,
  branch-stock, movement, product-summary, and session-finalization statements
  across confirmed product rows in one apply request. The slice avoids a
  language/runtime conversion because the route is still request orchestration
  with audit and stock-recalculation side effects, but it removes repeated
  statement setup from the loop. `backend/test/rfidRoutes.test.ts` guards the
  structure, and the language/runtime audit records the completed data-path
  optimization plus rollback path.
- Move 175 consolidates the portal catalog product data flow:
  `backend/src/routes/portal.js` now shares one helper for product image and
  branch-stock materialization and one helper for gallery/badge payload
  decoration across full catalog and paged search responses. The route stays in
  Node.js because it is request/response shaping, but the duplicate
  materialization blocks are gone and
  `backend/test/portalInventoryRegression.test.ts` guards the helper contract.
- Move 176 optimizes image-only product bulk import matching:
  `backend/src/routes/products.js` now builds one normalized product-name map
  before walking uploaded image filenames. Matching each filename to a product
  is now a direct map lookup instead of a repeated active-product scan, keeping
  the same name-based behavior while improving large image-import batches.
- Move 177 reuses sale creation movement statements:
  `backend/src/routes/sales.js` now prepares the inventory-movement insert and
  optional imported timestamp update once per sale creation transaction instead
  of inside each sold-item allocation block. Batch allocation, stock movement,
  audit, and imported timestamp behavior stay unchanged while per-item SQL
  setup is reduced.
- Move 178 reuses system settings delete statements:
  `backend/src/routes/system/index.js` now prepares the settings delete
  statement once beside the upsert statement in `writeSystemSettings()`.
  Null-valued settings still delete inside the same transaction, but repeated
  statement setup is removed.
- Move 179 closes the self-referential language/runtime candidate:
  `ops/scripts/architecture/language-runtime-audit.ts` now rejects itself from
  the SQL/DuckDB conversion queue. The remaining candidate was the Phase 29
  report generator ranking its own proof strings and completed-slice metadata,
  so the executable queue is clean without introducing a new runtime dependency
  into the audit bootstrap path.
- Move 180 deletes the generated root `output` folder:
  Phase 29 generated-bulk audit listed it as ignored/generated and safe to
  clean, and exact-path reference checks found only ignore, cleanup, and
  verification coverage references. Removing
  `C:\Users\user\Downloads\business-os\output` freed 870,964 bytes; the refreshed
  generated-bulk audit now reports the target as absent.
- Move 181 runs local retention cleanup after the generated-folder deletion:
  `npm.cmd --prefix ops run prune-storage -- --skip-remote` removed four old
  Phase 8.4 report directories and freed 817,705 bytes. Business uploads,
  secrets, newest backup packages, Docker volumes, and R2 remote storage were
  left untouched.
- Move 182 speeds up generated-bulk measurement:
  `ops/scripts/architecture/generated-bulk-audit.ts` now uses Node's
  recursive directory read as the fast path and keeps the old stack walker as a
  fallback. The generated-bulk report kept the same byte/file counts while
  lowering repeated Phase 29 measurement overhead for large generated folders.
- Move 183 parallelizes safe Phase 29 child checks:
  `ops/scripts/architecture/phase29-audit.ts` now runs generated-bulk, schema,
  performance, language/runtime, and Docker guardrail checks together, then runs
  `organization-audit.ts` after those report writers finish. This reduces
  orchestration wall time while preserving a coherent docs/reference tree for
  the organization scan.
- Move 184 preserves performance scan status notes:
  `ops/scripts/docs/performance-scan.ts` now carries forward a bounded Phase 29
  manual-notes block when `PERFORMANCE-SCAN.md` is regenerated. Repeat audits
  can refresh file-size and chunk metrics without losing the recent cleanup,
  performance, and orchestration move trail, and `PERFORMANCE-SCAN.json`
  records `manualNotesPreserved` plus the retained note-line count.
- Move 185 compares preserved notes in repeat consistency:
  `ops/scripts/architecture/phase29-audit.ts` now compares
  `manualNotesPreserved` and `manualNotesLines` across the three
  `Performance/code-flow scan` cycles. The repeat audit will flag drift if a
  future performance scan regeneration drops or truncates the Phase 29 status
  notes.
- Move 186 parallelizes performance scan file reads:
  `ops/scripts/docs/performance-scan.ts` now uses bounded parallel workers for
  source file stat/read work and built-chunk stat work. The generated summary
  records `sourceReadMode`, `sourceReadConcurrency`, and
  `chunkStatConcurrency`, and Phase 29 repeat consistency compares those fields
  so the faster scan path stays guarded.
- Move 187 shares the bounded worker-loop helper:
  `ops/scripts/lib/fs-utils.ts` now owns `mapLimit()`, and the generated-bulk,
  organization, and performance scan scripts use that shared helper. This
  removes duplicate bounded async loop implementations while keeping the
  script-specific concurrency limits intact.
- Move 188 shares architecture path normalization:
  `generated-bulk-audit.ts`, `organization-audit.ts`,
  `phase29-audit.ts`, and `language-runtime-audit.ts` now import `toPosix`
  from `ops/scripts/lib/fs-utils.ts` as `normalizePath`, removing repeated
  slash-normalization helpers while preserving report path output.
- Move 189 bounds language/runtime source reads:
  `ops/scripts/architecture/language-runtime-audit.ts` now reads scanned
  source files through the shared bounded `mapLimit()` helper instead of
  unbounded `Promise.all(files.map(...))`. Its summary records `fileReadMode`
  and `fileReadConcurrency`, and Phase 29 repeat consistency compares those
  fields.
- Move 190 shares audit existence checks:
  `ops/scripts/lib/fs-utils.ts` now owns `pathExists()`, and the organization,
  language/runtime, and Phase 29 audit scripts reuse that helper instead of
  carrying local `fs.access()` wrappers. This keeps repeat-sweep path checks
  consistent while reducing helper duplication in the audit layer.
- Move 191 bounds generated-bulk target measurement:
  `ops/scripts/architecture/generated-bulk-audit.ts` now measures cleanup and
  generated-bulk targets through the shared bounded `mapLimit()` helper instead
  of an unbounded `Promise.all(TARGETS.map(...))` pass. Its summary records
  `targetMeasureConcurrency`, and Phase 29 repeat consistency compares that
  field with the other generated-bulk measurement settings.
- Move 192 bounds organization audit root discovery:
  `ops/scripts/architecture/organization-audit.ts` now walks scan roots and
  root config files through shared bounded `mapLimit()` workers instead of
  unbounded `Promise.all(SCAN_ROOTS.map(...))` and `Promise.all(SCAN_FILES.map(...))`
  passes. Its summary records `rootWalkMode` and `rootWalkConcurrency`, and
  Phase 29 repeat consistency compares those fields.
- Move 193 bounds language/runtime proof sweeps:
  `ops/scripts/architecture/language-runtime-audit.ts` now uses shared bounded
  `mapLimit()` workers for scan-root discovery and proof-matrix existence
  checks instead of unbounded `Promise.all(...map(...))` passes over roots,
  focused tests, converted TypeScript slices, completed Worker slices, and data
  path slices. Its summary records `rootWalkMode`, `rootWalkConcurrency`,
  `matrixCheckMode`, and `matrixCheckConcurrency`, and Phase 29 repeat
  consistency compares those fields.
- Move 194 bounds Phase 29 child-check fan-out:
  `ops/scripts/architecture/phase29-audit.ts` now runs independent
  reference-producing child checks through shared bounded `mapLimit()` workers
  instead of `Promise.all(checks.map(...))`. The orchestrator keeps the
  organization audit after reference writers, records
  `executionMode: bounded-parallel-reference-writers-then-organization`, and
  exposes `parallelCheckConcurrency: 3` in the Phase 29 summary.
- Move 195 shares report-format helpers:
  `ops/scripts/lib/report-utils.ts` now owns the shared Markdown table,
  long-value summary, stable digest, and output-tail helpers used by the
  architecture audit scripts. `generated-bulk-audit.ts`,
  `organization-audit.ts`, `language-runtime-audit.ts`, and
  `phase29-audit.ts` import the shared helper instead of carrying local
  `markdownTable()` copies.
- Move 196 shares byte formatting:
  `ops/scripts/lib/report-utils.ts` now also owns `formatBytes()`, and
  `generated-bulk-audit.ts` imports it instead of carrying a local byte-size
  formatter. This keeps cleanup-size reporting consistent with the shared
  report utility layer.
- Move 197 shares async read helpers:
  `ops/scripts/lib/fs-utils.ts` now owns `readUtf8Async()` and
  `readJsonAsync()`, and `generated-bulk-audit.ts` uses those helpers instead
  of local `readText()` and `readJsonFile()` wrappers. This keeps generated
  cleanup inventory reads on the shared filesystem utility path.
- Move 198 shares verification read helpers:
  `ops/scripts/verification/verify-hardening-policy.ts` now imports
  `readJson()` and `readUtf8()` from `ops/scripts/lib/fs-utils.ts` instead of
  carrying local synchronous JSON/text read wrappers. This keeps full
  automation hardening checks on the same filesystem utility layer as the Phase
  29 audit scripts, and the hardening policy now points at the grouped
  Cloudflare verifier paths under `ops/scripts/runtime/cloudflare/`. The policy
  gate also accepts tracked or non-ignored pending source paths so grouped
  script moves can be verified before staging.
- Move 199 shares runtime report byte formatting:
  `ops/scripts/runtime/audits/audit-report-html.ts` now imports
  `formatBytes()` from `ops/scripts/lib/report-utils.ts` instead of carrying a
  local formatter. Runtime audit HTML and Phase 29 generated-bulk reports now
  use the same byte-size display helper.
- Move 200 shares runtime dependency JSON reads:
  `ops/scripts/verification/verify-runtime-deps.ts` now imports `readJson()`
  from `ops/scripts/lib/fs-utils.ts` instead of carrying a local package JSON
  reader. This keeps verification scripts on the shared filesystem utility
  path while preserving the `run/verify-local.bat` entrypoint.
- Move 201 shares frontend UI verifier reads:
  `ops/scripts/frontend/verify-ui.ts` now imports `readJson()` and
  `readUtf8()` from `ops/scripts/lib/fs-utils.ts` instead of carrying local
  text/JSON readers. This keeps UI verification file reads aligned with the
  shared ops filesystem utility layer while preserving the frontend
  `verify:ui` script.
- Move 202 shares language audit JSON reads:
  `ops/scripts/architecture/language-runtime-audit.ts` now imports
  `readJsonAsync()` from `ops/scripts/lib/fs-utils.ts` for package manifest
  reads instead of carrying a local async JSON helper. This keeps Phase 29's
  language/runtime audit on the same filesystem utility path as the generated
  bulk audit.
- Move 203 shares Cloudflare automation file reads:
  `ops/scripts/runtime/cloudflare/verify-cloudflare-automation.ts` now imports
  `readJson()` and `readUtf8()` from `ops/scripts/lib/fs-utils.ts` for policy,
  token, and allowed-email file reads instead of carrying local JSON/text read
  wrappers. The Cloudflare API request logic remains local to the verifier.
- Move 204 shares backup reliability source reads:
  `ops/scripts/verification/verify-backup-reliability.ts` now imports
  `readUtf8()` from `ops/scripts/lib/fs-utils.ts` for its source manifest reads
  instead of carrying a local root-relative `fs.readFileSync()` wrapper. The
  grouped backup, Drive, UI, offline, and automation guard strings remain
  unchanged.
- Move 205 shares Docker release guardrail reads:
  `ops/scripts/verification/verify-docker-release.ts` now imports `readUtf8()`
  from `ops/scripts/lib/fs-utils.ts` for tolerant source/config reads instead
  of carrying a local `fs.readFileSync()` wrapper. The generated
  `DOCKER-RELEASE-GUARDRAIL.json` output and release boundary checks remain
  unchanged.
- Move 206 shares secret hygiene source reads:
  `ops/scripts/verification/verify-secret-hygiene.ts` now imports `readUtf8()`
  from `ops/scripts/lib/fs-utils.ts` for tracked-file text reads after its
  existing size guard. The secret-pattern scan, tracked-file list, and
  skip-large-file behavior remain unchanged.
- Move 207 shares scale-service verifier reads and completes the first Phase
  29 baseline:
  `ops/scripts/verification/verify-scale-services.ts` now imports `readUtf8()`
  from `ops/scripts/lib/fs-utils.ts` for scale Compose reads after the existing
  file-existence check. Docker CLI discovery, secret/license ignore checks, and
  optional service reachability behavior remain unchanged. The first Phase 29
  baseline is complete, and Phase 29 remains active as the recurring guardrail
  with executable repeat audits, schema references, cleanup references,
  organization references, performance/code-flow scans, language/runtime
  evaluations, Docker guardrails, and shared verifier-helper consolidation in
  place.
- Move 208 closes final frontend i18n verification gaps:
  `frontend/src/lang/en.json` and `frontend/src/lang/km.json` now include the
  dashboard, contacts, import tracker, and settings keys that were still using
  fallback text. This keeps the final verification set green after the Phase 29
  closure without changing UI layout or data flow.
- Move 209 fixes scale-runtime R2 wiring and live R2 verification:
  `ops/docker/compose.scale.yml` now reads the R2 endpoint, region, bucket,
  access key, secret key, public base URL, Cloudflare account id, and
  Cloudflare API token from runtime environment instead of hardcoding the app
  container to `http://minio:9000` while declaring `OBJECT_STORAGE_DRIVER=r2`.
  `ops/scripts/powershell/start-runtime.ps1` bridges the ignored
  `ops/runtime/docker-release/docker-release.env` values into the scale Compose
  process, keeping secrets out of `docker-scale.env`. The R2 live verifier now
  tests the direct S3-compatible path first and, when those credentials return
  auth errors, verifies the Cloudflare API object-store fallback used by the
  backend runtime. The local app, workers, Cloudflare public/admin health, broad
  Phase 8.4 UI live check, and public portal live check passed after the tunnel
  connector was restarted.
- Move 210 rejects the final language/runtime false-positive:
  `ops/scripts/lib/report-utils.ts` stays as a small shared Node.js report
  helper for Markdown tables, digests, output tails, and byte labels. The
  language/runtime audit now records it as rejected from the SQL/DuckDB queue
  because it has no database reads, joins, import/export streaming, backup
  processing, analytics loop, or measurable data-volume bottleneck. The
  regenerated Phase 29 references now show zero remaining conversion
  candidates, and `npm --prefix ops run phase29:audit:repeat` passed across
  all 18 checks.
- Move 211 reconciles stale roadmap status after the storage/R2 and first
  Phase 29 baseline work:
  Phase 28 is now marked active for follow-on storage/access hardening, Phase
  29 keeps its first baseline marked complete while staying active as the
  ongoing guardrail, and the old R2 prune note now records that remote prune
  ran under the latest-package policy and had no remote backup objects to
  delete. This keeps future sessions from chasing already-closed cleanup
  follow-ups.
- Move 212 reconciles cleanup-reference public/R2 status:
  `ops/docs/reference/CLEANUP-SWEEP.md` now points at the later 2026-05-20
  public portal pass instead of the old Page Shield/CSP blocker, and records
  that the R2 remote prune path ran with zero remote backup objects to delete.
  The old Move 151 note was also clarified so future sessions do not reopen a
  source-code follow-up that the later Cloudflare live check closed.
- Move 213 refreshes the preserved performance-scan move trail:
  `ops/docs/reference/PERFORMANCE-SCAN.md` now carries Moves 208-212 in its
  preserved manual notes block and updates the Move 181 R2 wording to point at
  the later Phase 28 prune pass. Future performance scans can preserve the
  current optimization trail without reviving stale R2 or public portal status.
- Move 214 refreshes the whole-codebase generated-bulk checkpoint:
  `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md` now reflects the latest
  2026-05-20 generated-bulk audit measurements instead of the older
  2026-05-19 cleanup-slice checkpoint, keeping the human whole-codebase map in
  sync with the machine-readable Phase 29 generated-bulk baseline.
- Move 215 implements the Phase 24.3 runtime hash guard in the run-file
  verification path:
  `ops/scripts/verification/verify-runtime-deps.ts` now checks the full
  stale-bundle protection chain instead of only package/config manifests:
  Vite emits `business-os-build.json`, the service worker uses the build hash
  for cache versioning, frontend API code dispatches `runtime:version-mismatch`
  when served frontend metadata differs, `AppContext.tsx` listens for that
  event, backend runtime routes expose `getRuntimeVersion()`, and frontend
  performance verification still checks build metadata. Existing build
  manifests are validated for concrete `revision`, `hash`, and `builtAt`
  fields without forcing a pre-build dist folder to exist.
- Move 216 implements the Phase 24.4 post-start diagnostics checklist:
  `ops/scripts/runtime/smoke/post-start-diagnostics.ts` now writes a
  structured startup report covering local health, runtime version metadata,
  frontend build manifest metadata, service-worker availability, and optional
  public/admin health. `ops/scripts/powershell/start-runtime.ps1` writes the
  report to `ops/runtime/logs/post-start-diagnostics.json` after the route
  contract smoke, while `ops/scripts/powershell/docker-release.ps1` writes the
  same checklist to the Docker release runtime folder during release health
  checks. The Docker release verifier now treats the diagnostic script and
  wiring as required release files.
- Move 217 extends the post-start diagnostics checklist into local verification:
  `run/verify-local.bat` now calls
  `ops/scripts/runtime/smoke/post-start-diagnostics.ts` after the optional
  route-contract smoke and writes
  `ops/runtime/reports/verify-local-post-start-diagnostics.json` when a local
  app is running. The smoke script now supports `--skip-if-unavailable`, so
  full local verification can still run on a cold workspace while preserving a
  structured skipped report. The Docker release verifier guards the
  `verify-local.bat` wiring alongside the start-runtime and release wiring.
- Move 218 makes post-start diagnostics coverage machine-checkable in Phase 29:
  `ops/scripts/verification/verify-docker-release.ts` now writes
  `postStartDiagnosticsCoverage` to
  `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`, covering script presence,
  Docker release health-check wiring, normal start-runtime wiring, local
  `verify-local.bat` wiring, skip-if-unavailable support, and the health,
  runtime-version, build-manifest, and service-worker probes. The Phase 29
  repeat audit now compares that coverage object across cycles so diagnostics
  drift is caught automatically.
- Move 219 makes runtime dependency and stale-bundle guardrails
  machine-checkable in Phase 29:
  `ops/scripts/verification/verify-runtime-deps.ts` now writes
  `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json` with backend/frontend
  package versions, required scanner dependency coverage, forbidden legacy
  config coverage, and a `runtimeVersionGuardCoverage` object for Vite build
  metadata, service-worker build hash, frontend mismatch dispatch, AppContext
  listener wiring, backend runtime version route, backend frontend-build
  metadata reads, and frontend performance build-metadata verification.
  `phase29-audit.ts` now runs this guardrail as the seventh Phase 29 check and
  compares those fields across repeat cycles.
- Move 220 makes local verification coverage machine-checkable:
  `ops/scripts/verification/verify-runtime-deps.ts` now reads
  `run/verify-local.bat` and writes `localVerificationCoverage` into
  `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json`. The object covers the
  runtime dependency, Docker release, secret hygiene, Docker Doctor,
  route-contract, post-start diagnostics, frontend install/build/test/i18n/UI/
  performance, backend install/test, and backend integrity lanes. The Phase 29
  repeat audit compares that object across cycles so local verification drift is
  caught automatically before cleanup, folder rewires, or runtime changes.
- Move 221 clarifies local verification progress output:
  `run/verify-local.bat` now prints grouped `preflight`, `frontend`, and
  `backend` progress labels instead of stale `1a/6`-style labels. The command
  order remains unchanged, but failures during longer verification runs now
  point to the correct workflow lane immediately.
- Move 222 guards local verification progress labels:
  `ops/scripts/verification/verify-runtime-deps.ts` now records
  `progressLabelCoverage` inside `localVerificationCoverage`, including grouped
  `preflight`, `frontend`, and `backend` start/end labels plus a
  `staleFractionLabelsAbsent` check. Phase 29 repeat consistency compares that
  coverage object, so local verifier label drift is now caught automatically.
- Move 223 turns local verification coverage into a hard gate:
  `ops/scripts/verification/verify-runtime-deps.ts` now requires every nested
  `localVerificationCoverage` flag to be true and exits with an `is missing
  coverage` message naming the missing lane if a verifier step, diagnostic, or
  progress label disappears. The `distBuildManifestPresent` runtime field stays
  informational because clean workspaces run this guard before frontend build
  output exists.
- Move 224 audits dependency topology and removes orphan root dependencies:
  `ops/scripts/architecture/generated-bulk-audit.ts` now writes a
  `dependencyTopology` section that explains why frontend/backend/ops dependency
  trees remain separate and when root `node_modules` is safe to delete. The
  audit confirmed root `package.json` has no install dependencies, so the
  ignored generated root `node_modules` folder was deleted while preserving
  frontend/backend dependency folders used by build, tests, native packages, and
  Docker release packaging. Bytes removed: 3.30 MB.
- Move 225 adds byte accounting to generated cleanup:
  `ops/scripts/powershell/clean-generated.ps1` now measures each exact cleanup
  target before preview or deletion, prints per-target sizes, and reports
  either `Total bytes that would be removed` or `Total bytes removed`. Cleanup
  boundaries remain unchanged: source, `.env`, `business-os-data`, runtime
  secrets, and protected runtime state stay out of this path.
- Move 226 shares npm install freshness checks across run files:
  `ops/scripts/powershell/npm-install-mode.ps1` now owns the package-lock,
  package manifest, and `node_modules/.package-lock.json` timestamp decision
  used by `run/setup.bat` and `run/verify-local.bat`. This removes duplicated
  inline PowerShell from the run files while preserving skip/install behavior,
  and the runtime dependency guardrail now checks the shared helper wiring.
- Move 227 aligns and guards package versions:
  the ignored local root `package.json` was updated from `1.0.0` to `6.0.0` so
  local metadata matches backend, frontend, and ops. The runtime dependency
  guardrail now reads backend/frontend/ops package manifests and lockfiles,
  writes `versionConsistency`, and fails if any app-version declaration drifts.
  Phase 29 repeat consistency compares that version map across cycles.
- Move 228 guards Cloudflare runtime cleanup and retention paths:
  `ops/scripts/verification/verify-docker-release.ts` now writes
  `cloudflareRuntimeCoverage` into
  `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`. The object checks the
  Cloudflare token rotation script, origin switcher, Access/WAF automation, R2
  object-store verifier, stable `run/` wrappers, runtime-only token paths, long
  Access session policy, R2 backup retention, local report/backup pruning, and
  Docker-safe cleanup boundaries. Phase 29 repeat consistency compares this
  object so Cloudflare cleanup, Zero Trust convenience, and release/runtime
  safety drift are caught automatically.
- Move 229 runs bounded Cloudflare/runtime retention cleanup:
  `npm --prefix ops run prune-storage -- --reports-keep 20
  --recovery-reports-keep 5 --local-backups-keep 3 --remote-backups-keep 1
  --docker-safe-prune` removed two old Cloudflare public-portal report folders
  from `ops/runtime/reports`, freeing 416,466 bytes. The cleanup kept the
  newest 20 report folders, kept the latest local backup sets, found no R2
  backup objects to delete, and did not prune Docker images or volumes.
- Move 230 includes standalone report files in runtime retention:
  `ops/scripts/runtime/storage/prune-storage.ts` now applies
  `--reports-keep` to generated report files and report folders together. The
  Docker release guardrail checks this through `cloudflareRuntimeCoverage`.
  Running the updated cleanup removed three older Cloudflare report folders and
  four stale standalone screenshots from `ops/runtime/reports`, freeing
  1,199,593 bytes without touching secrets, uploads, latest backups, Docker
  images, or Docker volumes.
- Move 231 compacts generated runtime logs while preserving log paths:
  `ops/scripts/runtime/storage/prune-storage.ts` now accepts
  `--log-file-max-bytes` and compacts oversized `.log` files under
  `ops/runtime/logs` and `ops/runtime/pm2` by keeping the newest tail with a
  compaction header. Running the cleanup with a 1 MiB cap compacted four
  generated logs and freed 12,381,136 bytes while preserving PM2, Cloudflare,
  Docker, and startup log paths plus all protected data, secrets, backups,
  images, and volumes.
- Move 232 centralizes runtime cleanup defaults in the automation policy:
  `ops/scripts/runtime/storage/prune-storage.ts` now accepts `--policy` and
  reads report retention, recovery-report retention, local backup retention,
  Cloudflare R2 backup retention, demo cleanup, Docker-safe prune, and runtime
  log cap defaults from `ops/automation/business-os-automation.json`.
  `ops/scripts/powershell/full-automation.ps1` now passes the policy path
  instead of duplicating retention values in PowerShell, and the Docker release
  guardrail plus Phase 29 repeat audit check that policy-driven path.
- Move 233 writes the latest runtime cleanup ledger from automation:
  `ops/scripts/runtime/storage/prune-storage.ts` now accepts `--output` and
  writes the complete cleanup summary JSON to a workspace-bounded generated
  report path. `ops/scripts/powershell/full-automation.ps1` writes
  `ops/runtime/reports/prune-storage-latest.json`, so future sessions can
  inspect current report retention, recovery-report retention, local backup
  retention, R2 prune status, runtime log compaction, and Docker-safe prune
  planning without scrolling through prior terminal output. The generated
  ledger remains inside ignored runtime reports and does not copy secrets,
  uploads, env files, protected backups, Docker images, or Docker volumes.
- Move 234 makes the latest cleanup ledger machine-checkable:
  `ops/scripts/verification/verify-docker-release.ts` now records
  `pruneStorageOutputFlagSupported`,
  `latestCleanupReportWrittenByAutomation`, and
  `latestCleanupReportRuntimeOnly` under `cloudflareRuntimeCoverage`.
  Phase 29 repeat consistency compares that object, so cleanup/report rewires
  are checked for output support, full-automation wiring, and ignored-runtime
  report placement.
- Move 235 cleans accumulated QA/smoke business data and prevents repeat
  pollution: `ops/scripts/runtime/storage/cleanup-test-data.ts` adds a guarded
  `cleanup-test-data` dry-run/apply path for `QA Audit ...` smoke rows and
  generated full-audit import directories. A local Postgres dump was written
  under `ops/runtime/backups/test-data-cleanup` before applying. The live
  cleanup removed 2,283 QA products, 596 sales, 596 returns, 6,444 inventory
  movements, 610 audit import jobs, 752 action-history rows, 752 audit-log rows,
  related dependent rows, and 396 generated audit import directories while
  preserving imported/core data. Postcheck dry-runs report zero QA database
  matches and zero audit import files. `full-app-audit.ts` now runs this
  cleanup in `finally`, and a live undo/redo action-history check passed before
  its QA verification row was removed.
- Move 236 adds machine-readable QA/smoke cleanup guardrails:
  `ops/scripts/verification/verify-docker-release.ts` now writes
  `testDataCleanupCoverage` into
  `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`. The coverage verifies the
  cleanup script/package entry, dry-run default, explicit apply gate,
  QA-bounded selectors, dependent-row deletion coverage, workspace-bounded
  generated import cleanup, report output support, and `full-app-audit.ts`
  `finally` cleanup wiring. Phase 29 repeat compares this coverage object so
  future smoke/live-test changes must preserve cleanup behavior.
- Move 237 makes live smoke tests self-cleaning by prefix:
  `ops/scripts/runtime/smoke/live-smoke.ts` now runs
  `cleanup-test-data.ts --prefix "<QA Smoke seed>" --apply` in `finally` and
  writes `ops/runtime/reports/live-smoke-cleanup-latest.json`. The cleanup
  script now includes prefix-based import job file matching and generated
  import-directory cleanup, so ordinary smoke runs remove their own products,
  sales, returns, inventory movements, import jobs, action-history rows,
  audit-log rows, and generated import files while keeping the broader
  `--all-qa` cleanup reserved for full audits and manual cleanup passes.
  Docker release guardrails and Phase 29 repeat now verify this wiring through
  `testDataCleanupCoverage`.
- Move 238 adds no-leftover QA/smoke postcheck gates:
  `ops/scripts/runtime/storage/cleanup-test-data.ts` now supports
  `--fail-on-match` for dry-run cleanup checks. `ops/package.json` exposes
  `cleanup-test-data:check` and `cleanup-test-data:check-smoke`, and
  `ops/scripts/powershell/full-automation.ps1` runs both postchecks after its
  verification gate. These checks fail if `QA Audit ...` or `QA Smoke ...`
  database rows or generated import directories remain, while writing
  runtime-only latest reports under `ops/runtime/reports`. The Docker release
  guardrail records the postcheck support and Phase 29 repeat compares it.
- Move 239 codifies action-history undo/redo live verification:
  `ops/scripts/runtime/audits/action-history-undo-redo-check.ts` creates a
  reversible `QA Action History ...` server row, exercises `/undo` and `/redo`,
  verifies status transitions and payload round-trip, then cleans its own
  action-history and audit-log rows in `finally`. `ops/package.json` exposes
  `action-history:check`, full automation runs it before cleanup postchecks, and
  Docker release guardrails verify the script and wiring.
- Move 240 adds action-history read-path indexes:
  `idx_action_history_scope_updated_pg` and
  `idx_action_history_scope_user_updated_pg` are now created by Postgres startup
  and listed in the canonical schema dump. These indexes match the history bar
  and admin user-filter read queries, reducing ordered scans as action history
  grows. Backend schema tests and `SCHEMA-RELATIONSHIPS.md` now guard the
  completed DDL.
- Move 241 adds unique session-token indexing:
  after a live duplicate check reported zero duplicate `user_sessions.token_hash`
  values across 3,459 current sessions, Postgres startup and the canonical schema
  now create `idx_user_sessions_token_hash_unique_pg`. This hardens direct
  cookie-session lookup and prevents accidental duplicate token rows while
  leaving user-session foreign-key validation for a later cleanup-backed pass.
- Move 242 hardens auth security-flow verification:
  `backend/test/authSecurityFlow.test.ts` now runs mutable auth checks serially,
  starts child servers with an explicit local Postgres URL fallback, captures
  child-server output for diagnostics, and uses a disposable
  `bos_auth_security_*` user instead of depending on the live `admin` password.
  The Docker runtime check passes, verifies stale session-cookie revocation after
  password change, and the temporary user/audit/session rows are removed.
- Move 243 closes a schema-audit blind spot:
  runtime DDL parsing now counts `CREATE UNIQUE INDEX IF NOT EXISTS` as well as
  plain runtime indexes. `SCHEMA-AUDIT.json` includes `runtimeUniqueIndexes` and
  `runtimeIndexNames`, and Phase 29 repeat compares them so future security,
  idempotency, and uniqueness indexes cannot disappear from the generated schema
  evidence.
- Move 244 adds idempotency unique indexes:
  live duplicate checks found zero duplicate non-empty `client_request_id` values
  in `sales`, `returns`, and `products`; runtime startup and the canonical schema
  now create unique partial indexes for all three create-replay keys. This closes
  the database race window behind the existing route-level duplicate lookup and
  catchback logic.
- Move 245 adds parent-first detail-read indexes:
  runtime startup and the canonical schema now create indexes for
  `sale_items(sale_id, id)`, `return_items(return_id, id)`,
  `product_images(product_id, sort_order, id)`,
  `import_job_files(job_id, kind, id)`, and
  `import_job_errors(job_id, batch_id, id)`. These support common sale/return
  detail hydration, product gallery ordering, import review, and cleanup paths.
- Move 246 makes RFID event dedupe authoritative:
  live RFID checks found zero current event rows and zero duplicate non-empty
  dedupe keys. RFID event inserts now ignore duplicate `dedupe_key` conflicts,
  while `rfid_session_items.read_count` continues to track repeated reads. The
  runtime DDL and canonical schema now include the unique partial
  `idx_rfid_events_dedupe_key_unique` index.
- Move 247 broadens test-data residue guardrails:
  the cleanup scanner now treats `QA Audit`, `QA Smoke`, and
  `QA Action History` rows as generated verification residue in broad QA scans,
  detects smoke import folders by filename, adds an action-history postcheck
  package script, and has full automation write a latest action-history cleanup
  postcheck report before release validation can pass.
- Move 248 makes storage-prune preview commands safe:
  `prune-storage.ts` refuses preview-named output paths without `--dry-run`,
  and the ops package adds `prune-storage:preview` so operators can inspect
  report/backup/log cleanup plans without mutating generated runtime state.
- Move 249 makes the storage-prune preview command machine-checkable:
  Docker release guardrail output now includes `previewScriptDryRun` and
  `previewNameRequiresDryRun`, giving Phase 29 repeat a structured signal for
  both the package-script wiring and the low-level preview-name refusal.
- Move 250 makes live-smoke lookup cleanup prefix-scoped:
  the live smoke flow now writes its unique `QA Smoke ...` seed into product
  category and brand fields for direct product creation and imported CSV rows.
  The test-data cleanup script now reports and deletes empty QA-prefixed
  category/unit lookup rows, making no-leftover postchecks cover lookup residue
  as well as products, sales, returns, imports, action history, and audit logs.
- Move 251 makes action-history undo/redo verification self-postchecking:
  after the standalone live verifier creates, undoes, redoes, and applies
  cleanup for its `QA Action History ...` row, it immediately runs
  `cleanup-test-data.ts --dry-run --fail-on-match` for the same prefix and
  writes a latest postcheck report. This catches interrupted or partial
  undo/redo cleanup before the broader full-automation postcheck layer.
- Move 252 adds comprehensive relationship-orphan reporting:
  `verify-data-integrity.ts --comprehensive` now checks the schema FK-candidate
  backlog before any `NOT VALID` foreign-key migration proceeds, and
  `backend` exposes `verify:integrity:comprehensive` to write the latest report
  under ignored runtime reports. The first live report is non-mutating and
  records existing cleanup backlog: 22 return/sale over-return pairs,
  700 product-batch product orphans, 4 branch-batch branch orphans,
  22 return-item product orphans, 4 inventory-movement branch orphans, and
  20 stock-transfer product orphans.
- Move 253 adds bounded live-data integrity samples:
  comprehensive integrity output now includes the top over-return sale/product
  samples and capped child-row samples for each orphaned FK-candidate
  relationship. `--sample-limit` is bounded from 1 to 50, defaulting to 10, so
  cleanup/relink decisions have concrete evidence without broad data dumps or
  destructive repair behavior.
- Move 254 classifies integrity cleanup backlog:
  comprehensive integrity reports now summarize generated-like versus
  unclassified rows for each known cleanup bucket. The latest live report marks
  all over-return, branch-batch, return-item, inventory-movement, and
  stock-transfer backlog rows as generated-like, but product-batch product
  orphans remain mixed with 303 generated-like and 397 unclassified rows, so
  batch cleanup is still blocked on review/relink policy.
- Move 255 adds bounded cleanup candidate IDs:
  each comprehensive integrity classification now includes capped `candidateIds`
  for generated-like and unclassified rows. This makes cleanup/relink review
  precise enough to rehearse exact row sets while keeping the report bounded and
  non-mutating.
- Move 256 adds a guarded generated-integrity cleanup command:
  `cleanup-integrity-backlog` previews generated-like orphan/over-return residue
  and `cleanup-integrity-backlog:apply` requires an explicit apply command. A
  Docker-compatible backup was created at
  `ops/runtime/docker-release/backups/20260521-053131` before apply. The active
  release database after the backup/start cycle had no generated-integrity
  backlog, so the apply report deleted zero rows and the comprehensive
  integrity report passed. This closes the immediate generated-residue cleanup
  loop while preserving the caution that restore/import state must be verified
  from backup packages before any larger business-data cleanup.
- Move 257 applies the broad generated-QA cleanup after backup:
  `cleanup-test-data.ts --all-qa --apply` removed the active QA smoke/deep-audit
  residue from products, batches, branch stock, sales, returns, inventory
  movements, import jobs, action history, audit logs, and empty QA lookups.
  Broad QA, `QA Smoke`, and `QA Action History` postchecks now return zero
  matches, and comprehensive integrity still passes. The active transactional
  dataset is now empty for products/sales/returns/batches/movements, so any
  production dataset must be restored or re-imported from a verified source.
- Move 258 adds dataset readiness to comprehensive integrity:
  `verify-data-integrity.ts --comprehensive` now writes `datasetSummary` with
  transactional table counts and labels the current runtime as `empty` when
  products, batches, branch stock, sales, returns, movements, and transfers have
  no rows. This is a passing readiness signal for verification, but it keeps the
  restore/import warning visible in the latest runtime report.
- Move 259 adds a standalone dataset-readiness gate:
  `dataset-readiness` writes the latest core table-count report without failing,
  and `dataset-readiness:loaded` intentionally fails when transactional business
  tables are empty. This remains the production-readiness blocker for any
  cleaned or restored runtime until a verified business dataset is present.
- Move 260 adds a non-mutating restore-candidate scanner:
  `restore-candidates` validates local backup packages and estimates business
  table counts from `postgres.sql` without running Docker restore. It separates
  the newest loaded backup from the largest loaded backup and recommends the
  largest valid loaded package. Current recommendation:
  `ops/runtime/docker-release/backups/20260509-065427` with 22,050 business
  rows, while the newest `20260521-053131` package is only the small QA dataset.
- Move 261 adds temporary-database restore rehearsal:
  `restore-rehearsal` restores the recommended package into a temporary
  Postgres database, verifies restored counts against the SQL dump counts, and
  drops the temp database by default. The rehearsal for
  `ops/runtime/docker-release/backups/20260509-065427` passed with exact count
  matches for all tracked business tables and left no rehearsal database behind.
- Move 262 restores and verifies the real imported dataset:
  a fresh safety backup was written to
  `ops/runtime/docker-release/backups/20260521-060128`, then the rehearsed
  `20260509-065427` package was restored into the live Docker runtime. The
  restore flow surfaced stale runtime image metadata and a restored-role
  password mismatch; both were repaired without exposing secrets. The live stack
  now runs `business-os:v6.0.0-202605151537`, route contract checks pass, and
  `dataset-readiness` reports `loaded`. Restored QA smoke/deep-audit residue was
  removed through the existing cleanup path, and
  `cleanup-integrity-backlog` now also covers detached high-id product batches
  that have no sale/return allocations. Final comprehensive integrity passed
  with relationship orphan checks green for 49 FK candidates.
- Move 263 rebuilds the release app from current source:
  `run/docker/release.bat` built `business-os:v6.0.0-202605210625`, regenerated
  `release/business-os`, and `run/docker/start.bat` restarted the live Docker
  runtime on that image. This replaced the older May 15 package that still had a
  stale sales-export query. Broad Phase 8.4 Playwright now passes against the
  rebuilt app with frontend hash `5674b3321890179c`, public Cloudflare portal
  Playwright passes with restored upload assets returning 200, and live
  integrity/readiness remain green on the restored dataset. The branch-transfer
  UI checker now tolerates already-loaded modal stock requests by falling back
  to an authenticated route read.
- Move 264 removes the regenerated release kit after verification:
  the live runtime keeps the loaded `business-os:v6.0.0-202605210625` image and
  restored Postgres volume, so the ignored/regenerable `release` folder was safe
  to delete after the app and public portal passed. This removed 378,813,449
  bytes and brings Phase 29 generated-bulk cleanup candidates back under the
  policy threshold while preserving the ability to regenerate an offline kit
  with `run/docker/release.bat`.
- Move 265 adds a reusable post-live hygiene gate:
  `post-live-hygiene` and its `live-hygiene:check` alias now combine broad QA,
  `QA Smoke`, and `QA Action History` residue postchecks, generated-integrity
  residue checks, loaded-dataset readiness, and comprehensive backend integrity
  into one command. The generated-integrity preview is treated as a failing gate
  when it reports matches, and dataset readiness must be `loaded`, so future
  live/browser test sessions have an explicit guard before the plan can claim
  the runtime is clean.
- Move 266 adds an ordered Phase 8.4 live-suite runner:
  `phase84:live-suite` runs the broad UI check, public Cloudflare portal check,
  and post-live hygiene gate as one sequence. The runner writes a latest JSON
  report and supports skip flags for focused triage, but the default path now
  captures the intended workflow: use the buttons/actions, verify the public
  route, then prove cleanup, readiness, and integrity are still green.
- Move 267 compacts live-suite report output:
  successful child steps now attach their structured report path plus a concise
  summary instead of embedding large escaped child JSON output. The suite keeps
  failure output tails for debugging, while green runs stay readable enough to
  scan repeatedly during Phase 8.4/29 loops.
- Move 268 adds generated-bulk disposition totals:
  generated-bulk JSON and Markdown now summarize bytes/files/folders by
  disposition, and Phase 29 repeat compares that rollup. This keeps cleanup
  decisions focused on policy categories, such as preserved data,
  retention-managed runtime files, reinstallable dependencies, regenerable
  build output, and safe cleanup targets.
- Move 269 promotes schema primary-key gaps into generated evidence:
  schema audit JSON and Markdown now list static tables with no declared
  primary key, and Phase 29 repeat checks that backlog directly. Current gaps
  are `import_jobs` and `settings`; these stay recommendation-level until a
  duplicate/null check, backup, rollback SQL, focused tests, and restore
  rehearsal are in place.
- Move 270 adds a read-only primary-key migration preflight:
  `schema-pk-preflight` checks live Postgres for null and duplicate keys on
  `import_jobs.id` and `settings.key`, records existing unique/primary-key
  state, and writes a structured runtime report without applying DDL. The
  latest run found both tables data-ready, but the DDL remains gated by backup,
  rollback SQL, tests, and restore rehearsal.
- Move 271 adds intent-based route chunk warmup:
  authenticated navigation now publishes `bos:page-intent` on pointer, focus,
  and touch intent, and the app shell preloads only that exact route chunk with
  a short timeout, idle scheduling, and slow/save-data connection guards. This
  keeps first-load background work conservative while making the next clicked
  page feel faster and more stable. The frontend performance verifier and
  performance loading UX guard now enforce the pathway.
- Move 272 rebuilds and verifies the live runtime:
  `run/docker/release.bat` built `business-os:v6.0.0-202605211016`, and
  `run/docker/start.bat` restarted Docker onto that image. The full
  `phase84:live-suite` passed with frontend hash `7c013382f0323c21`, 72 broad
  UI signals, zero relevant console messages, a passing public Cloudflare
  portal with 40 rendered products and zero failed responses, and post-live
  hygiene showing `loaded` data with zero generated-integrity matches. The
  regenerated ignored `release` kit was deleted after image/runtime
  verification, removing 378,824,942 bytes while preserving Docker image,
  volumes, uploads, backups, and secrets.
- Move 273 applies guarded primary-key hardening:
  `import_jobs.id` and `settings.key` now have canonical primary-key
  declarations, runtime startup applies those constraints only after null,
  blank, duplicate, and existing-PK checks pass, and
  `ops/scripts/backend/schema-primary-key-rollback.sql` documents rollback SQL.
  A Docker-compatible backup was created first at
  `ops/runtime/docker-release/backups/20260521-103142`; the live stack was then
  rebuilt/restarted as `business-os:v6.0.0-202605211031`. Strict preflight now
  reports both primary keys present, and the full Phase 8.4 live suite passed
  afterward with frontend hash `dba6668a64b6912d`, public portal success,
  loaded dataset status, and zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,824,942 bytes.
- Move 274 runs post-migration retention cleanup:
  `prune-storage` kept the latest three Docker-compatible backup packages
  (`20260521-103142`, `20260521-060128`, `20260521-053131`), removed the older
  `20260509-065427` local package after the fresh loaded backup existed, and
  pruned two old Phase 8.4 report folders. Local backup/report cleanup removed
  5,971,653 bytes. R2 retention kept
  `datasync-2026-05-20T22-05-48-918Z` with no stale remote objects to delete.
  Docker cleanup reclaimed 2.503 GB of builder cache while preserving images,
  volumes, uploads, secrets, and retained backups.
- Move 275 removes redundant catalog language bundle imports:
  `CatalogPage.tsx` now uses `portalLanguagePacks` plus local fallbacks instead
  of importing full app `en.json` and `km.json` files. Performance guards now
  fail if the catalog route imports those full language packs again. Focused
  portal language/content tests, frontend typecheck, JSX check, performance
  verifier, and build pass; the built catalog chunk in this session moved from
  about 167.2 KB to about 166.6 KB.
- Move 276 deploys and verifies that catalog bundle cleanup:
  Docker image `business-os:v6.0.0-202605211053` is running. The full
  `phase84:live-suite` passed with frontend hash `534372c58260ddab`, 72 broad
  UI signals, zero relevant console messages, public Cloudflare portal success
  with 40 rendered products and zero failed responses, and post-live hygiene
  showing a loaded dataset with zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,825,966 bytes.
- Move 277 removes a redundant settings-meta frontend request:
  `getSettings()` now relies on the inline `updatedAt` returned by
  `/api/settings` and no longer calls `/api/settings/meta` on the settings load
  path. This keeps write-conflict metadata current while shaving one
  authenticated API request from app bootstrap and settings refreshes. The
  focused performance guards, frontend typecheck, JSX check, full frontend
  utility suite, and production build pass.
- Move 278 deploys and verifies that startup/settings cleanup:
  Docker image `business-os:v6.0.0-202605211116` is running. The full
  `phase84:live-suite` passed with frontend hash `474a0ea68e73d19f`, 72 broad
  UI signals, zero relevant console messages, public Cloudflare portal success
  with 40 rendered products and zero failed responses, and post-live hygiene
  showing a loaded dataset with zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,825,966 bytes.
- Move 279 runs post-deploy retention cleanup:
  `prune-storage` removed four older Phase 8.4 report folders for 702,494
  local bytes. R2 retention kept
  `datasync-2026-05-20T22-05-48-918Z` and found no stale remote objects.
  Docker-safe cleanup reclaimed 2.754 GB of builder cache while preserving
  images, volumes, uploads, secrets, and retained local/R2 backup packages.
- Move 280 caches backend settings schema metadata:
  the settings route now probes `information_schema.columns` for
  `settings.updated_at` once per process instead of on every settings read and
  write. This keeps the no-column fallback intact while reducing repeated
  metadata queries on the app bootstrap/settings pathway. Route-contract
  coverage, the full backend utility suite, and schema audit pass.
- Move 281 deploys and verifies the backend settings metadata cache:
  Docker image `business-os:v6.0.0-202605211130` is running. The full
  `phase84:live-suite` passed with frontend hash `add767b15d753fcb`, 72 broad
  UI signals, zero relevant console messages, public Cloudflare portal success
  with 40 rendered products and zero failed responses, and post-live hygiene
  showing a loaded dataset with zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,825,966 bytes.
- Move 282 runs post-deploy retention cleanup:
  `prune-storage` removed two older Phase 8.4 report folders for 362,565 local
  bytes. R2 retention kept `datasync-2026-05-20T22-05-48-918Z` and deleted no
  stale remote objects. Docker-safe cleanup reclaimed 2.503 GB of builder cache
  while preserving images, volumes, uploads, secrets, and retained backups.
- Move 283 caches more backend schema metadata probes:
  branch transfers, inventory transfers, and product import brand-setting
  writes now reuse process-lifetime schema-shape checks instead of querying
  `information_schema.columns` for every write. Route-contract coverage, full
  backend utility tests, schema audit, and frontend performance verification
  pass.
- Move 284 deploys and verifies those additional metadata caches:
  Docker image `business-os:v6.0.0-202605211148` is running. The full
  `phase84:live-suite` passed with frontend hash `fa19f4440a87c47c`, 72 broad
  UI signals, zero relevant console messages, public Cloudflare portal success
  with 40 rendered products and zero failed responses, and post-live hygiene
  showing a loaded dataset with zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,825,966 bytes.
- Move 285 runs post-deploy retention cleanup:
  `prune-storage` removed two older Phase 8.4 report folders for 450,818 local
  bytes. R2 retention kept `datasync-2026-05-20T22-05-48-918Z` and deleted no
  stale remote objects. Docker-safe cleanup reclaimed 2.503 GB of builder cache
  while preserving images, volumes, uploads, secrets, and retained backups.
- Move 286 caches custom-table managed-column metadata:
  custom-table row writes now cache stable `information_schema.columns` checks
  by normalized table and column name, and the cache is updated immediately
  when the route creates managed custom tables or adds the `updated_at`
  versioning column. This keeps legacy-schema fallbacks intact while avoiding
  repeated metadata queries on custom-table edit flows. Route-contract
  coverage, the full backend utility suite, and schema audit pass.
- Move 287 deploys and verifies the custom-table metadata cache:
  Docker image `business-os:v6.0.0-202605211213` is running. The full
  `phase84:live-suite` passed with frontend hash `a9b3dec481bf1b9f`, 72 broad
  UI signals, zero relevant console messages, public Cloudflare portal success
  with 40 rendered products and zero failed responses, and post-live hygiene
  showing a loaded dataset with zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,825,454 bytes.
- Move 288 runs post-deploy retention cleanup:
  `prune-storage` removed one older Phase 8.4 report folder plus one stale
  latest preflight report for 241,196 local bytes. R2 retention kept
  `datasync-2026-05-21T04-07-34-742Z` and deleted no stale remote objects.
  Docker-safe cleanup reclaimed 2.503 GB of builder cache while preserving
  images, volumes, uploads, secrets, and retained backups.
- Move 289 consolidates backend schema metadata caching:
  `backend/src/schemaMetadata.ts` now provides cached column-existence,
  ordered first-column selection, and mark-present helpers. Settings, product
  imports, branch transfers, inventory transfers, and custom-table managed rows
  reuse that single helper, removing duplicated route-local metadata cache
  state while preserving each route's fallback behavior and candidate order.
  Route-contract coverage, the full backend utility suite, and schema audit
  pass.
- Move 290 deploys and verifies the shared schema metadata helper:
  Docker image `business-os:v6.0.0-202605211242` is running. The full
  `phase84:live-suite` passed with frontend hash `b813e9a1b8dbf1df`, 72 broad
  UI signals, zero relevant console messages, public Cloudflare portal success
  with 40 rendered products and zero failed responses, and post-live hygiene
  showing a loaded dataset with zero generated-integrity matches. The generated
  `release` kit was deleted after verification, removing 378,825,966 bytes.
- Move 291 runs post-deploy retention cleanup:
  `prune-storage` removed two older Phase 8.4 report folders for 465,575 local
  bytes. R2 retention kept `datasync-2026-05-21T04-07-34-742Z` and deleted no
  stale remote objects. Docker-safe cleanup reclaimed 2.503 GB of builder cache
  while preserving images, volumes, uploads, secrets, and retained backups.
- Move 292 adds behavioral tests for shared schema metadata caching:
  `backend/test/schemaMetadata.test.ts` now verifies positive and negative
  cache hits, ordered candidate-column selection, custom-table
  `markColumnPresent` refresh behavior, and safe fallbacks when metadata probes
  fail, using a mocked database. The helper test is wired into
  `backend test:utils`, and focused helper tests, the full backend utility
  suite, and schema audit pass.
- Move 293 guards production routes against direct schema metadata probes:
  route contracts now scan `backend/src/routes/*.js` and fail if a production
  route bypasses `schemaMetadata.ts` with a direct `information_schema.columns`
  query. This keeps stable schema-shape checks on the shared cached helper
  path. Focused route contracts, full backend utility tests, and schema audit
  pass.
- Move 294 batches integrity verifier FK orphan counts:
  `ops/scripts/backend/verify-data-integrity.ts` now checks all relationship
  orphan counts with one generated `UNION ALL` query instead of one Docker
  `psql` call per FK candidate, while keeping bounded sample queries only for
  relationships that actually have orphans. Generated identifiers are quoted,
  metadata coverage uses `current_schema()`, and syntax check, focused
  automation coverage, live comprehensive integrity verification, full backend
  utility tests, and schema audit pass.
- Move 295 tightens and applies generated test-data cleanup:
  `ops/scripts/runtime/storage/cleanup-test-data.ts` now treats
  `QA Deep Audit` as part of the bounded `--all-qa` selector alongside
  `QA Audit`, `QA Smoke`, and `QA Action History`, so deep-audit action
  history, audit logs, import JSON, and lookup residue are caught by the same
  safe cleanup path. The live cleanup removed 20 generated QA sales, 20 sale
  items, 140 inventory movements, 279 action-history rows, and 279 audit-log
  rows, with zero products, uploads, import directories, categories, units, or
  backup data removed. Post-cleanup dry-run found zero QA residue, dataset
  readiness remained `loaded`, comprehensive integrity passed, full backend
  utility tests passed, and the Docker release cleanup guard passed.
- Move 296 makes post-live hygiene resource-aware:
  `ops/scripts/runtime/storage/post-live-hygiene.ts` now builds explicit
  check tasks and runs the Docker/Postgres hygiene checks as
  `contention-safe-sequential-checks`. A fully parallel trial made the live
  gate slower because multiple `docker exec psql` checks competed for the same
  runtime; the final scheduler keeps report validation, zero-residue checks,
  dataset readiness, and comprehensive integrity in a predictable low-contention
  order. Syntax check, focused automation coverage, and live post-hygiene
  verification pass with zero QA residue and dataset readiness still `loaded`.
- Move 297 bounds catalog submission image reads:
  `frontend/src/components/catalog/CatalogPage.tsx` now shares a single
  FileReader helper, caps portal submission screenshots at eight, and reads
  pasted/selected screenshots with `CATALOG_IMAGE_READ_CONCURRENCY = 2`
  instead of eagerly base64-reading every selected image with
  `Promise.all(files.map(...))`. Paste handling now reads only the remaining
  screenshot slots. Frontend utility tests, JSX check, performance verifier,
  production build, Docker release/start on
  `business-os:v6.0.0-202605211541`, and the full Phase 8.4 Playwright live
  suite pass on frontend hash `06a20c2b662bb3e2`; the public portal rendered
  40 products with zero failed responses, and post-live hygiene reported
  dataset `loaded` with zero generated-integrity matches.
- Move 298 bounds receipt export asset inlining:
  `frontend/src/utils/printReceipt.ts` now inlines receipt image and inline
  style assets through `mapReceiptAssets()` with
  `RECEIPT_ASSET_INLINE_CONCURRENCY = 3` instead of starting every
  fetch/blob/base64 conversion at once with `Promise.all(images.map(...))` and
  `Promise.all(nodes.map(...))`. This keeps printable receipt rendering
  compatible while reducing memory/network spikes for media-heavy receipts.
  Focused receipt tests, full frontend utility tests, JSX check, frontend
  performance verifier, and production build pass.
- Move 299 makes the Phase 29 repeat audit contention-safe:
  `ops/scripts/architecture/phase29-audit.ts` now runs reference-producing
  checks one at a time, then runs the small Docker/runtime guardrails with
  bounded parallelism before the organization scan. A live three-cycle repeat
  caught the previous Windows Markdown/JSON report write race, and the updated
  runner now passes all 21 checks with zero failures while preserving concise
  duration and repeat-consistency reporting.
- Move 300 bounds offline file-sync failure writes:
  `frontend/src/web-api.ts` now updates failed/pending offline file chunk rows
  through `mapOfflineFileChunkStatusUpdates()` with
  `OFFLINE_FILE_CHUNK_STATUS_WRITE_CONCURRENCY = 3` instead of issuing an
  unbounded `Promise.all(rows.map(...offline_file_chunks.update...))` burst
  after a large chunked upload fails or pauses. This keeps offline replay
  recovery responsive and reduces IndexedDB/Dexie pressure while preserving
  per-row status, error text, and retry behavior. Offline sync/security tests,
  full frontend utility tests, JSX check, performance verifier, and production
  build pass.
- Move 301 bounds lookup snapshot name scans:
  `frontend/src/components/products/lookups/productLookupSnapshots.mjs` now
  runs category/unit/brand undo snapshot scans through `mapLookupNames()` with
  `LOOKUP_PRODUCT_NAME_CONCURRENCY = 2`. Each lookup name still pages in order
  with `LOOKUP_PRODUCT_PAGE_SIZE`, but multiple names no longer block one
  another serially during larger lookup merges. Performance guards, full
  frontend utility tests, JSX check, performance verifier, and production build
  pass.
- Move 302 bounds stale app-shell cache deletion:
  `frontend/src/App.tsx` now clears old `business-os-app-shell-*` and
  `business-os-static-*` caches through `deleteStaleShellCaches()` with
  `STALE_SHELL_CACHE_DELETE_CONCURRENCY = 2` during chunk recovery reloads.
  This avoids deleting every matching browser cache at once while the app is
  trying to recover from an evicted/stale route bundle. Performance guards,
  full frontend utility tests, JSX check, performance verifier, and production
  build pass.
- Move 303 bounds full runtime-reset cleanup:
  `frontend/src/platform/runtime/clientRuntime.ts` now unregisters service
  workers and deletes Business OS browser caches through `mapRuntimeCleanup()`
  with `RUNTIME_CLEANUP_CONCURRENCY = 2`. This keeps manual/runtime reset
  recovery from fanning out every service-worker unregister and cache delete at
  once, while preserving the existing best-effort failure handling.
- Move 304 serializes runtime cache prefix invalidation:
  `backend/src/runtimeCache.ts` now deletes cache prefixes through
  `deletePrefixesInOrder()` instead of launching parallel Redis `SCAN`/`DEL`
  walks for every affected namespace. Product, inventory, sales, returns, and
  settings writes still invalidate the same prefixes, but the cache layer now
  avoids self-inflicted Redis contention during write bursts.
- Move 305 indexes lookup-manager bulk delete snapshots:
  `ManageCategoriesModal.tsx` and `ManageUnitsModal.tsx` now build
  `categoriesById` / `unitsById` maps with `useMemo()` and use those indexes
  for single and bulk delete snapshots. Bulk delete no longer repeatedly scans
  the visible lookup rows with `ids.map(...find(...))`, preserving undo/redo
  snapshots while making large lookup cleanup linear.
- Move 306 indexes brand lookup bulk delete impact:
  `ManageBrandsModal.tsx` now builds `brandsByLookup` with `useMemo()` and uses
  that index to calculate selected-brand usage impact. Bulk brand cleanup no
  longer filters the whole brand list for every selected name before asking for
  confirmation, keeping category, unit, and brand lookup cleanup on the same
  indexed path.
- Move 307 indexes POS cart product and branch lookups:
  `POS.tsx` now reuses the existing `productsById` map for cart quantity
  validation, cart branch changes, and cart detail opening, and adds a
  `branchesById` map for branch-name error messages. This removes repeated
  product and branch array scans from the active checkout path while preserving
  cart-line identity, stock validation, and branch-aware error copy.
- Move 308 indexes inventory branch labels and product summary lookups:
  `Inventory.tsx` now builds `branchesById`, `summaryById`, and `getBranchLabel`
  once from loaded data. RFID status labels, export metadata, branch comparison
  rows, adjustment target snapshots, adjustment header quantities, and movement
  product detail opening now use indexed lookups instead of repeated branch or
  product summary scans.
- Move 309 indexes product page branch moves and fresh history snapshots:
  `Products.tsx` now builds `branchesById` for bulk branch-change target
  resolution, and indexes freshly fetched product snapshots with
  `buildProductIdMap()` before save/variant history entries are created. This
  keeps Products, POS, and Inventory aligned on id-map lookups for active
  write/undo flows. The Phase 29 repeat audit also now treats
  `distBuildManifestPresent` as a volatile generated-artifact signal while
  still comparing stable runtime-version guardrail source wiring across repeat
  cycles.
- Move 310 indexes inventory transfer branch defaults:
  `Inventory.tsx` now precomputes `defaultTransferDestinationBySourceId` once
  per branch list and validates transfer source/destination ids through
  `branchesById`. Single transfer and batch-transfer draft creation no longer
  repeat branch-list scans for each opened product or selected row.
- Move 311 makes inventory return stats single-pass:
  the secondary stats refresh now builds one `nextReturnStats` accumulator while
  walking loaded returns once, separating customer and supplier return totals,
  refunds, restock count, and item quantities without repeated `filter()` and
  `reduce()` passes over the same response.
- Move 312 indexes inventory adjustment branch stock per submit:
  `Inventory.tsx` now builds `selectedBranchStockById` once for the selected
  adjustment product and reuses the resolved branch-stock row for undo quantity
  capture and remove-stock validation. This avoids duplicate branch-stock scans
  in adjustment writes while preserving the same undo/redo behavior.
- Move 313 makes Inventory visible stats single-pass:
  `Inventory.tsx` now builds one memoized `visibleInventoryStats` accumulator
  across `filteredSummary` and reuses it for visible stock value, low/out/in
  stock counts, net sold, revenue, COGS, and discount fallbacks. This removes
  repeated visible-product `filter()` / `reduce()` passes from the stat-card
  render path while preserving backend SQL stats as the primary source when
  available.
- Move 314 indexes backend inventory active branches per request:
  `backend/src/routes/inventory.js` now builds `activeBranchIndex` from the
  active branch query and reuses it for default branch fallback and branch-name
  resolution in inventory adjustment and product-row move flows. The route
  contract guard now blocks regressions to repeated active-branch scans in
  these stock write pathways.
- Move 315 indexes product-import branches by normalized name per job:
  `backend/src/services/importJobs.js` now adds `branchesByName` to the product
  import context and updates it when an import creates a branch. Product import
  stock rows now resolve branch names through the per-job map instead of
  rescanning `ctx.activeBranches` for every row, while preserving the existing
  Node import worker and SQL pathways.
- Move 316 makes bulk product-import conflict summaries single-pass:
  `frontend/src/components/products/import/BulkImportModal.tsx` now builds the
  review filter counts with one `conflictGroups` accumulator loop. The import
  review surface no longer filters the same conflict list separately for each
  badge count, and `productImportPlanner.test.ts` guards the single-pass shape.
- Move 317 precomputes Inventory visible product IDs:
  `frontend/src/components/inventory/Inventory.tsx` now builds one memoized
  `visibleInventoryProductIds` list from `visibleInventoryProducts` and reuses
  it for selection cleanup, select-all, and the visible-list signature. This
  trims repeated `map().filter()` passes in the Inventory product-selection
  workflow while preserving the existing React/JavaScript surface.
- Move 318 centralizes Inventory selection-scope ID normalization:
  `frontend/src/components/inventory/Inventory.tsx` now uses one
  `normalizeFiniteIds()` helper for section/group selection checks and toggles.
  This keeps scope checkbox reads and writes on the same single-pass numeric-ID
  path instead of repeating `ids.map(...).filter(...)` in each handler.
- Move 319 removes Inventory active-filter count allocations:
  `frontend/src/components/inventory/Inventory.tsx` now uses one
  `countActiveFlags()` helper for RFID, movement, and product filter badge
  counts. This replaces small `[].filter(Boolean).length` allocations in the
  filter render path with a direct counter loop.
- Move 320 reuses Inventory selection helpers for partial counts and retries:
  `frontend/src/components/inventory/Inventory.tsx` now shares
  `normalizeFiniteIdsFrom()` and `countSelectedIds()` across selection-scope
  checks, toggles, and batch failure recovery. This removes the remaining
  filtered selected-ID allocation and one-off failed-item ID normalization path.
- Current remote public-portal status:
  `phase84-public-portal-cloudflare-check.ts` passes against
  `https://leangcosmetics.dpdns.org/public`: the portal rendered customer
  content, loaded 40 products, all portal API requests returned 200, the
  enforced CSP header was present, no report-only CSP header was present, and
  there were no relevant console or page errors.
- The schema audit now writes `ops/docs/reference/SCHEMA-AUDIT.json` with
  static table counts/names, runtime DDL counts/names, Dexie store coverage,
  backup coverage gaps, and relationship documentation gaps. Phase 29 repeat
  runs compare those fields across cycles before schema rewires can proceed.
- The Docker release guardrail now writes
  `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json` with required release file
  counts, wrapper counts, retired artifact lists, ignore coverage, Docker prune
  safety coverage, and automation policy state. Phase 29 repeat runs compare
  those fields across cycles before cleanup or release rewires proceed.
- The organization audit now writes `ops/docs/reference/ORGANIZATION-AUDIT.json`
  with scanned file counts, large-file counts, compatibility-wrapper counts,
  scan roots/files, large-file paths, largest areas, and wrapper lists. Phase
  29 records that JSON as a durable folder/compatibility reference output.
- Phase 29 repeat runs now compare the full organization inventory baseline:
  scan roots, root files, large-file threshold, largest-area rows, large-file
  paths, wrapper files, broken wrapper files, and removable wrapper files. This
  catches folder/cleanup evidence drift before source moves or wrapper removal.

Reference outputs:
- `ops/docs/reference/WHOLE-CODEBASE-SWEEP.md`
- `ops/docs/reference/CLEANUP-SWEEP.md`
- `ops/docs/reference/GENERATED-BULK-AUDIT.md`
- `ops/docs/reference/PHASE29-AUDIT.md`
- `ops/docs/reference/PHASE29-AUDIT.json`
- `ops/docs/reference/ORGANIZATION-AUDIT.json`
- `ops/docs/reference/DEAD-CODE-DUPLICATION-SCAN.md`
- `ops/docs/reference/PERFORMANCE-SCAN.md`
- `ops/docs/reference/PERFORMANCE-SCAN.json`
- `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.md`
- `ops/docs/reference/LANGUAGE-RUNTIME-AUDIT.json`
- `ops/docs/reference/SCHEMA-AUDIT.md`
- `ops/docs/reference/SCHEMA-AUDIT.json`
- `ops/docs/reference/DOCKER-RELEASE-GUARDRAIL.json`
- `ops/docs/reference/RUNTIME-DEPS-GUARDRAIL.json`

Safety gates:
- No source deletion is accepted without `rg` proving no import/script/doc
  dependency plus focused tests, build, and affected live checks.
- No folder move is accepted unless the old path is updated in imports, package
  scripts, run wrappers, docs, generated references, and release tooling.
- No compatibility wrapper move is accepted unless the organization audit
  reports zero broken wrapper targets.
- No compatibility wrapper deletion is accepted unless the organization audit
  reports zero active references and generated references are refreshed after
  deletion.
- No schema migration is accepted without backup, restore rehearsal,
  count/relationship diff, orphan checks, and rollback SQL.
- No language conversion is accepted unless a benchmark or type/packaging proof
  shows a real gain and the old implementation can be restored.

Move 321 status:
- Move 321 removes Inventory destination-selector filter allocations:
  `frontend/src/components/inventory/Inventory.tsx` now shares
  `renderDestinationProductOptions()` for the single move modal and batch move
  lines. The helper skips the current product inline while mapping options, so
  large destination lists avoid allocating `summary.filter(...).map(...)`
  arrays during render. Focused coverage in
  `frontend/tests/performanceLoadingUx.test.ts` guards the helper and blocks
  the old filtered render pattern. No folder move or language conversion was
  needed.

Move 322 status:
- Move 322 hardens the public Cloudflare portal live check for intermittent
  Cloudflare Page Shield script-monitor report-only CSP injection:
  `ops/scripts/runtime/live-checks/phase84-public-portal-cloudflare-check.ts`
  now still fails app-origin report-only CSP regressions, but recognizes
  Cloudflare's own non-blocking `cdn-cgi/script_monitor` diagnostics when the
  enforced app CSP, rendered products, API statuses, console checks, and page
  error checks are otherwise clean. `backend/test/fullAutomation.test.ts`
  guards that distinction. Cloudflare API access can list the zone, but the
  Page Shield settings endpoint returned an authentication error, so source
  disabling remains a Cloudflare dashboard/token-permission follow-up.

Move 323 status:
- Move 323 reuses Sales selection and filter-count helpers:
  `frontend/src/components/sales/Sales.tsx` now builds one memoized visible sale
  ID list for selection cleanup/select-all, normalizes grouped selection IDs
  through `normalizeFiniteIds()`, counts partial selection state through
  `countSelectedIds()`, and counts active filters through `countActiveFlags()`.
  Focused coverage in `frontend/tests/performanceLoadingUx.test.ts` guards the
  helper paths and blocks the old repeated map/filter and filter-count
  allocation patterns. No folder move or language conversion was needed.

Move 324 status:
- Move 324 reuses Returns selection helpers and makes return stats single-pass:
  `frontend/src/components/returns/Returns.tsx` now builds one memoized visible
  return ID list for selection cleanup/select-all, normalizes grouped selection
  IDs through `normalizeFiniteIds()`, counts partial selection state through
  `countSelectedIds()`, counts active filters through `countActiveFlags()`, and
  builds customer/supplier row sets plus refund/restock/writeoff/refund-only/
  compensation/loss totals in a single `returnScopeSummary` pass over filtered
  returns. Focused coverage in `frontend/tests/performanceLoadingUx.test.ts`
  guards the helper paths and blocks the old repeated visible-ID, stats-filter,
  and filter-count allocation patterns. No folder move or language conversion
  was needed.

Move 325 status:
- Move 325 reuses Audit Log selection and filter-count helpers:
  `frontend/src/components/utils-settings/AuditLog.tsx` now builds one memoized
  visible log ID list for selection cleanup/select-all, normalizes section/group
  selection IDs through `normalizeFiniteIds()`, counts partial selection state
  through `countSelectedIds()`, and counts active filters through
  `countActiveFlags()`. Focused coverage in
  `frontend/tests/performanceLoadingUx.test.ts` guards the helper paths and
  blocks the old repeated visible-ID and filter-count allocation patterns. No
  folder move or language conversion was needed.
- Move 325 also hardens Docker release kit packaging after the first release
  attempt exposed a missing parent-directory guard while copying
  `ops\docker\compose.release.yml` into the generated kit. The release script
  now copies files through `Copy-FileEnsuringParent()`, and
  `ops/scripts/verification/verify-docker-release.ts` guards that compose and
  Dockerfile kit copies ensure their parent directories before copying. The
  rerun built, started, health-checked, live-tested, pruned, and cleaned the
  generated release kit successfully.

Move 326 status:
- Move 326 shares Contacts bulk-selection helpers:
  `frontend/src/components/contacts/shared.tsx` now exports
  `countActiveFlags()` and `buildSelectedSnapshots()`. Customer, supplier, and
  delivery contact tabs use those helpers to count active filters without
  allocating temporary boolean arrays and to build bulk-delete undo snapshots
  through Set membership instead of scanning selected IDs with
  `Array.includes()` for every visible row. The tabs also reuse a `failedIdSet`
  when filtering successful delete snapshots after partial failures. Focused
  coverage in `frontend/tests/performanceLoadingUx.test.ts` guards the shared
  helpers and blocks the old repeated filter/count and selected-id scan
  patterns. No folder move or language conversion was needed.
- Move 326 also hardens Docker release kit replacement after the first rerun
  exposed a Windows cleanup race while replacing the generated
  `release\business-os\run\docker` folder. The release script now removes
  generated release directories through `Remove-ReleaseDirectory()`, which
  verifies the target is under `release`, removes children first, and retries
  the final directory removal before rewriting the kit. The Docker release
  verifier guards this helper. The rerun built, started, health-checked,
  live-tested, pruned, and cleaned the generated release kit successfully.

Move 327 status:
- Move 327 removes the POS filter-panel active-count allocation:
  `frontend/src/components/pos/FilterPanel.tsx` now counts active category,
  brand, branch, stock, group, and supplier filters through a local
  `countActiveFlags()` loop instead of allocating a temporary boolean array and
  filtering it during render. Focused coverage in
  `frontend/tests/performanceLoadingUx.test.ts` guards the helper and blocks
  the old `.filter(Boolean).length` pattern. No folder move or language
  conversion was needed.

Move 328 status:
- Move 328 centralizes client API query-string construction:
  `frontend/src/api/methods.ts` now uses one `buildQueryString()` helper for
  paged/search/read query parameters across products, inventory, import jobs,
  contacts, files, audit logs, sales, returns, RFID, and portal catalog
  requests. The helper skips null/undefined and, by default, empty strings
  without allocating filtered `Object.entries()` arrays for each call; existing
  sales/returns calls that preserved empty values pass `skipEmpty: false`.
  Focused coverage in `frontend/tests/apiHttp.test.ts` guards the shared
  helper, the skip-empty exception, and blocks the old repeated
  `new URLSearchParams(Object.entries(...).filter(...))` pattern. No folder
  move or language conversion was needed.
- Move 328 also hardens Docker release cleanup for generated image tarball
  locks. After a rerun built `business-os:v6.0.0-202605221449` but hit a
  Windows file-lock race while replacing `.tmp-business-os-image.tar*`,
  `Remove-ReleaseDirectory()` now retries child-file removal before final
  directory removal. The Docker release verifier guards the retry policy. The
  rerun built `business-os:v6.0.0-202605221451`, started, health-checked,
  live-tested, pruned, and cleaned the generated release kit successfully.

Move 329 status:
- Move 329 centralizes client API query-path assembly:
  `frontend/src/api/methods.ts` now uses one `appendQuery()` helper for
  optional query suffixes across product, inventory, portal catalog, import
  job, file, action history, RFID, sales, analytics, contact, audit log,
  return, and export reads. This keeps the Move 328 query builder as the only
  parameter encoder and removes repeated `q ? ?q : ''` URL assembly from the
  hot read registry. Focused coverage in `frontend/tests/apiHttp.test.ts`
  guards the helper, required paged search routes, and the absence of the old
  query-suffix patterns. No folder move or language conversion was needed.

Move 330 status:
- Move 330 makes product ID lookup normalization single-pass:
  `frontend/src/api/methods.ts` now uses `normalizePositiveUniqueIds()` for
  `getProductsByIds()`, replacing the prior chained `map()`, `filter()`,
  `Set`, `Array.from()`, and `slice()` expression with one bounded loop that
  converts, validates, dedupes, and stops at the request limit. Focused
  coverage in `frontend/tests/apiHttp.test.ts` guards the helper and blocks
  the old intermediate array pattern. No folder move or language conversion
  was needed.

Move 331 status:
- Move 331 makes actor query and cache cleanup helpers direct-loop based:
  `frontend/src/api/methods.ts` now has `appendActorQuery()` iterate supplied
  extra-query keys directly instead of allocating `Object.entries()` plus a
  callback, and it caches `query.toString()` once before returning the final
  path. `clearCachedQueryResults()` now normalizes prefixes and scans matching
  local-storage query-cache keys with direct loops instead of chained
  `map()`/`filter()` passes. Focused coverage in
  `frontend/tests/apiHttp.test.ts` guards both helpers and blocks the old
  allocation patterns. No folder move or language conversion was needed.

Move 332 status:
- Move 332 makes local mirror table cleanup direct-loop based:
  `frontend/src/api/localDb.ts` now normalizes and deduplicates requested Dexie
  table names with one direct loop and resolves table objects with another
  direct loop, replacing the prior spread `Set` over `map().filter()` plus a
  second `map().filter()` table-resolution pass. Focused coverage in
  `frontend/tests/adminShellMediaGuards.test.ts` guards the in-place table
  cleanup strategy and blocks the old table-name allocation pattern. No folder
  move or language conversion was needed.

Move 333 status:
- Move 333 records the Rust deep-rewrite assessment:
  `ops/docs/RUST-REWRITE-ASSESSMENT.md` concludes that a full Rust rewrite is
  not a good next move without benchmark, packaging, rollback, and data-safety
  proof. The approved path is a narrow opt-in Rust spike only for pure,
  CPU-bound modules after SQL/DuckDB, Web Workers, Node streaming, and existing
  native packages are measured. Candidate future spikes include CSV/import
  analysis, backup manifest verification, bounded media metadata probes, and
  integrity report scanners; the current backend shell stays Node.js unless a
  real hot path proves at least a material speed/stability win.

Move 334 status:
- Move 334 removes visible page-description rows from the remaining admin
  title surfaces and keeps the context on native title hover text instead:
  Branches, Audit Log, Receipt Settings, Backup, Settings, Library, and Sync
  Server now keep page explanations off the visible layout and expose them on
  the page title. `frontend/src/components/shared/PageHeader.tsx` no longer
  renders the circular page-info button; the direct Audit Log and Receipt
  Settings headers use the same title-hover pattern. The branch and receipt
  inline hint rows were removed from the visible body. A targeted Playwright
  sweep verified that the affected pages have no visible page-info buttons, do
  not show the removed hint text inline, and still carry the expected title
  text on hover.
- Move 334 also reduces Docker release worker defaults from duplicate pairs to
  one import worker and one media worker. The defaults in
  `ops/scripts/powershell/docker-release.ps1`,
  `ops/scripts/powershell/start-runtime.ps1`, `run/setup.bat`, and the local
  generated Docker release env now use `IMPORT_WORKER_REPLICAS=1` and
  `MEDIA_WORKER_REPLICAS=1`. Docker Compose removed the extra worker
  containers during restart while preserving the app, Postgres, Redis,
  Cloudflare tunnel, runtime data volume, uploads, and secrets.
- Move 334 postcheck storage cleanup removed old Phase 8.4 reports, one older
  recovery report, and reclaimed Docker builder cache. The first Phase 29
  repeat run then correctly failed because the regenerated ignored `release`
  kit pushed cleanup candidates over the 512 MB policy threshold; that release
  folder was deleted after an absolute-path safety check, freeing 378,835,701
  bytes. The follow-up `npm --prefix ops run phase29:audit:repeat` passed all
  21 checks across three cycles.

Move 335 status:
- Move 335 fixes the Products and POS mid-width layout pressure found during
  live UI review. `frontend/src/components/products/surfaces/ProductsListSurface.tsx`
  now gives the desktop Products table a real minimum width and fixed column
  widths, with nowrap headers, so medium desktop widths use local horizontal
  scrolling instead of squeezing Product Details, Cost In, Selling Price, Stock,
  and Status together. `frontend/src/components/products/Products.tsx` also
  lets product names wrap inside their column without bleeding into adjacent
  cells. `frontend/src/components/pos/POS.tsx` now gives the desktop products
  pane and cart pane stable minimum widths inside a horizontally scrollable
  workspace, so POS product cards and cart controls stay readable at the
  awkward 810 px review width.
- Move 335 verified the console-noise split: clean Playwright sessions on
  Products and POS showed no app console errors, no failed app responses, and
  `businessos_sync_server` set to `http://127.0.0.1:4000`. The extension-stack
  errors reported from the in-app browser (`content.js`, `Grammarly-check.js`,
  extension `vendor.js`, `unsafe-eval`, and `cssRules`) are injected-extension
  scripts colliding with the app's strict CSP, not first-party bundle failures.
  The strict CSP remains in place; it was not weakened with `unsafe-eval`.
- Move 335 rebuilt and restarted the Docker release runtime with image
  `business-os:v6.0.0-202605261501`. Local health and both public/admin
  Cloudflare health endpoints returned 200, and `/public` returned the app
  shell. The regenerated ignored `release` kit was removed after the live image
  was loaded, freeing 378,838,897 bytes. No business data, uploads, runtime
  secrets, Postgres/Redis volumes, or retained backup packages were deleted.

Move 336 status:
- Move 336 refines POS product-card responsiveness below the desktop split.
  `frontend/src/styles/main.css` now keeps POS cards at a larger minimum width:
  phones around 360-430 px remain two readable columns, 640 px tablets render
  three readable columns, and 760 px narrow tablets render four readable
  columns. This avoids the previous 390-430 px three-column squeeze where
  product cards were only about 116-130 px wide and names/prices felt clipped.
- Move 336 Playwright checks covered POS at 360x800, 390x844, 430x932,
  640x860, and 760x900. Each viewport had no first-party console errors, no
  non-scroll overflow, `businessos_sync_server` pointed at
  `http://127.0.0.1:4000`, and tapping a product opened the product action
  modal. The Docker release runtime was rebuilt as
  `business-os:v6.0.0-202605261656`; the regenerated ignored `release` kit was
  deleted after deploy, freeing 378,837,873 bytes.

Move 337 status:
- Move 337 performs the old Docker version and reproducible cache cleanup
  requested in Phase 29 without touching data-bearing volumes. The live app,
  import worker, and media worker all kept running on
  `business-os:v6.0.0-202605261656`, and `business-os:latest` points at the
  same image ID. Two obsolete app image tags were removed:
  `business-os:v6.0.0-202605261501` and
  `business-os:v6.0.0-202605260636`. Docker builder cache was then pruned as
  reproducible generated bulk, reclaiming 4.082 GB. Post-cleanup Docker state
  has only the current business-os image, Cloudflared, Redis, and Postgres
  images; build cache is down to 1.518 GB. Local health on
  `http://127.0.0.1:4000/health` stayed `ok` with frontend hash
  `55cf7b8ef08a4b8d`. No Docker volumes, uploads, runtime secrets, `.env`
  files, or retained backup packages were deleted.

Move 338 status:
- Move 338 optimizes the schema primary-key preflight data path surfaced by the
  Phase 29 language/runtime audit. `ops/scripts/backend/schema-primary-key-preflight.ts`
  now materializes row/null counts, duplicate-key group counts, and unique-index
  names once through shared CTEs, then reuses those values in the read-only JSON
  report for `import_jobs` and `settings`. The report shape and table payloads
  matched the previous output exactly when compared against the live Postgres
  container, and the same-container timing sample improved from 832.9475 ms to
  771.5196 ms. `ops/scripts/architecture/language-runtime-audit.ts` now records
  this as a completed data-path optimization and classifies
  `ops/scripts/backend/schema-primary-key-rollback.sql` as rollback DDL under
  the schema safety protocol, so the next conversion queue no longer chases
  those already-handled files.

Move 339 status:
- Move 339 removes another Products render/action bookkeeping allocation path.
  `frontend/src/components/products/helpers/productSelectionHelpers.ts` now
  exposes `normalizePositiveProductIds()` and rewrites visible ID, product ID
  map, and parent ID set construction with direct loops instead of chained
  map/filter passes. `frontend/src/components/products/Products.tsx` reuses
  that helper for bulk delete redo IDs, bulk out-of-stock redo IDs, and bulk
  add-stock success/failure IDs. The focused product-selection helper test now
  covers primitive IDs and restored-entry IDs, and the full frontend utility
  suite, typecheck, JSX syntax check, and production build passed.

Move 340 status:
- Move 340 tightens POS core product lookup/card construction. `frontend/src/components/pos/posCore.ts`
  now builds the product lookup map with a direct loop that ignores invalid
  identifiers instead of materializing a map input array with possible `NaN`
  keys, and `buildVisibleProductCards()` now pushes valid lead cards directly
  instead of chaining `map(...).filter(Boolean)`. The focused POS core test now
  confirms invalid IDs are ignored. The focused test, frontend typecheck, JSX
  syntax check, full frontend utility suite, and production build all passed.

Move 341 status:
- Move 341 removes repeated import-service normalization allocations in
  `backend/src/services/importJobs.js`. Import job type filtering, review
  duplicate-group counting, incoming image-list parsing, setting option
  parsing, and cancel-wait job ID normalization now use direct loops and
  dedupe sets instead of chained `map/filter`, `Array.from(...).filter`, or
  temporary entry arrays. This keeps the import review/apply behavior unchanged
  while reducing transient allocations in large import and queue-management
  paths. Focused import tests, schema audit, and the full backend utility suite
  passed.

Move 342 status:
- Move 342 reuses direct-loop ID and token normalization in
  `backend/src/routes/products.js`. Product image map loading, product search
  `include` parsing, comma-separated search terms, ID filters, branch-stock
  hydration IDs, lookup replacement source values, and inline image-list
  parsing now avoid repeated chained map/filter/dedupe arrays. The route keeps
  the same query and response behavior while reducing transient allocations in
  product search, lookup maintenance, and import image reference handling.
  Product search tests, route-contract tests, import decision integrity tests,
  schema audit, and the full backend utility suite passed.

Move 343 status:
- Move 343 extracts settings conflict-attempt payload construction in
  `frontend/src/api/methods.ts`. Settings writes now reuse
  `buildAttemptedSettings()` and the shared conflict metadata-key set instead
  of rebuilding the same `Object.entries(...).filter(...)` chain on every
  conflict response. The API response shape, conflict draft preservation, and
  settings refresh behavior remain unchanged. Focused API/settings tests,
  frontend typecheck, the full frontend utility suite, and production build
  passed.

Move 344 status:
- Move 344 tightens shared API query and import-image upload loops in
  `frontend/src/api/methods.ts`. `buildQueryString()` now iterates parameter
  keys directly instead of allocating entry tuples, and
  `uploadImportJobImages()` collects browser files and relative paths with
  direct loops instead of filter/forEach chains. Request URLs, skip-empty
  behavior, upload form fields, and progress labels stay unchanged. Focused
  API/import/media tests, frontend typecheck, JSX syntax check, the full
  frontend utility suite, and production build passed.

Move 345 status:
- Move 345 removes more shared API allocation chains in
  `frontend/src/api/methods.ts`. XHR file uploads now apply non-empty headers
  with a direct key loop, offline sale queue retry eligibility is collected in
  one pass before sorting, and return conflict attempted-item snapshots use
  `buildAttemptedReturnItems()` instead of an inline `map()`. Upload headers,
  retry timing, conflict payload shape, and return behavior remain unchanged.
  Focused API, offline sales queue, media upload, and returns tests passed,
  followed by frontend typecheck, JSX syntax check, the full frontend utility
  suite, and production build.

Move 346 status:
- Move 346 centralizes shared sync-update and mirror serialization loops in
  `frontend/src/api/methods.ts`. Discarded queue and offline-sale synced
  refresh events now reuse `dispatchSyncUpdates()` with named channel lists,
  pending sync queue previews are built through a bounded serializer, and local
  mirror row cloning now uses a direct loop. Sync event names, preview shape,
  mirror policy, and offline queue behavior remain unchanged. Focused API,
  offline sales queue, offline sync architecture, and storage policy tests
  passed, followed by frontend typecheck, JSX syntax check, full frontend
  utility suite, and production build.

Move 347 status:
- Move 347 removes inventory-route normalization chains in
  `backend/src/routes/inventory.js`. Saved inventory reason loading and
  persistence now share `normalizeInventoryReasonList()` with direct-loop
  cleaning/deduping/sorting, and inventory search terms now use a bounded
  direct-loop splitter instead of `map/filter/slice` chains. The saved settings
  JSON shape, duplicate reason key, sort order, and search limit remain
  unchanged. Focused inventory settings/media, route contract, product search,
  portal inventory regression, schema-audit, and full backend utility tests
  passed. The standalone `branchStockSearch.test.ts` still cannot complete in
  this shell because its temporary server inherits Postgres mode without a
  usable `DATABASE_URL`, causing a test-server reset before assertions run.

Move 348 status:
- Move 348 makes inventory product hydration single-pass in
  `backend/src/routes/inventory.js`. `hydrateInventoryProducts()` now parses
  branch-stock JSON, removes the transport JSON column, and collects product
  IDs in one direct loop before attaching batch rows in a second loop. The
  inventory product response shape and branch-scoped batch lookup behavior
  remain unchanged. Focused inventory settings/media, product search, portal
  inventory regression, schema-audit, and full backend utility tests passed.

Move 349 status:
- Move 349 consolidates stock-adjustment allocation movement construction in
  `backend/src/routes/inventory.js`. Remove-stock and set-stock reductions now
  use `appendAllocationMovementEntries()` instead of three duplicated
  allocation `forEach` blocks, and inventory movement insertion now uses a
  direct loop. Movement type, branch, batch, cost, reason, and optional
  imported timestamp behavior remain unchanged. Focused inventory
  settings/media, product batch hierarchy, route contract, schema-audit, and
  full backend utility tests passed.

Move 350 status:
- Move 350 tightens inventory transfer insertion loops in
  `backend/src/routes/inventory.js`. Transfer allocation cloning and paired
  movement insertion now use direct loops, and dynamic transfer insert SQL uses
  `buildInsertColumnSql()` instead of separate `map()` chains for quoted
  columns and placeholders. Transfer idempotency, optional note column
  placement, stock movement rows, and batch rollups remain unchanged. Focused
  inventory settings/media, product batch hierarchy, route contract,
  schema-audit, and full backend utility tests passed.

Move 351 status:
- Move 351 tightens inventory row-move stock movement construction in
  `backend/src/routes/inventory.js`. Source and destination allocation
  movement rows now use direct loops with precomputed unit-cost fallbacks
  instead of callback blocks that recomputed the same cost expressions for
  every allocation. Movement type, branch, product, batch, quantity, stock
  transfer note, total-cost math, and inventory row-move behavior remain
  unchanged. Focused inventory settings/media, product batch hierarchy, route
  contract, schema-audit, and full backend utility tests passed.

Move 352 status:
- Move 352 tightens RFID inventory transaction loops in
  `backend/src/routes/inventory.js`. RFID event recording now collects
  successful `recordRfidEvent()` results in one direct transaction loop
  instead of `map().filter(Boolean)`, and RFID apply now iterates present rows
  with a direct loop plus precomputed purchase-price fallbacks for movement
  totals. Session validation, item return order, branch stock writes, product
  recalculation, audit payloads, and RFID movement behavior remain unchanged.
  Focused RFID route, route contract, schema-audit, and full backend utility
  tests passed.

Move 353 status:
- Move 353 tightens inventory product list assembly in
  `backend/src/routes/inventory.js`. Family root ID collection, family/base row
  merging, response sanitization, and brand filter extraction now use direct
  loops instead of `flatMap().filter()`, spread/`forEach`, response `map()`,
  and brand-row `map()` chains. Product search SQL, family expansion, sorting,
  branch-stock hydration, sanitized response fields, and filter metadata remain
  unchanged. Focused product search pagination, portal inventory regression,
  route contract, schema-audit, and full backend utility tests passed.

Move 354 status:
- Move 354 completes the obvious inventory route array-chain cleanup in
  `backend/src/routes/inventory.js`. Product-filter search clauses, inventory
  summary branch-stock parsing, and movement search clauses now use direct
  loops instead of `map()` chains. Generated SQL fragments, parameter names,
  branch-stock JSON parsing fallback, movement search behavior, and response
  payloads remain unchanged. Focused product search pagination, portal
  inventory regression, route contract, schema-audit, and full backend utility
  tests passed.

Move 355 status:
- Move 355 tightens shared product image and branch-stock helper loops in
  `backend/src/routes/products.js`. Branch-stock seeding, product image gallery
  persistence, image-map loading, and gallery attachment now use direct loops
  instead of `forEach()`/`map()` callback chains. Gallery order, primary image
  selection, product payload shape, branch-stock seed behavior, and SQL
  placeholders remain unchanged. Focused product search pagination, portal
  inventory regression, product batch hierarchy, route contract, and full
  backend utility tests passed.

Move 356 status:
- Move 356 tightens product lookup metadata assembly in
  `backend/src/routes/products.js`. Brand option parsing, lookup usage entry
  construction, product sample collection, and brand/category/unit row
  preparation now use direct loops instead of filter/map/forEach chains.
  Snapshot versioning, lookup sorting, unresolved counts, sample product
  limits, colors, and response payload shape remain unchanged. Focused product
  search pagination, product batch hierarchy, route contract, schema-audit,
  and full backend utility tests passed.

Move 357 status:
- Move 357 tightens product search filter and branch-stock attachment loops in
  `backend/src/routes/products.js`. Product ID bindings, search term clauses,
  lookup field filters, metadata distinct-value extraction, branch-stock SQL
  placeholders, branch-stock grouping, and branch-stock payload attachment now
  use direct loops instead of `map()`/`forEach()` chains. SQL parameter names,
  search-mode behavior, filter payloads, branch-stock ordering, and response
  shape remain unchanged. Focused product search pagination, portal inventory
  regression, product batch hierarchy, route contract, schema-audit, and full
  backend utility tests passed.

Move 358 status:
- Move 358 tightens product family expansion and search response assembly in
  `backend/src/routes/products.js`. Family source filtering, family row
  scanning, bounded bind-list construction, expanded row custom-field parsing,
  duplicate removal, paged search row parsing, batch ID collection, and batch
  payload attachment now use direct loops. The explicit `.slice(0, 100)` guard
  remains for family bind limits. Family include behavior, parent/variant SQL,
  pagination, custom field parsing, batch branch scoping, and response shape
  remain unchanged. Focused product search pagination, portal inventory
  regression, product batch hierarchy, route contract, schema-audit, and full
  backend utility tests passed.

Move 359 status:
- Move 359 tightens product lookup replacement and legacy product list response
  assembly in `backend/src/routes/products.js`. Lookup replacement placeholder
  construction, legacy product row parsing, product ID collection for batch
  lookup, and final product/batch payload assembly now use direct loops instead
  of `map()` chains. Lookup replacement SQL, audit payloads, raw branch-stock
  JSON removal, gallery attachment, batch lookup behavior, and legacy product
  response shape remain unchanged. Focused product search pagination, portal
  inventory regression, product batch hierarchy, route contract, schema-audit,
  and full backend utility tests passed.

Move 360 status:
- Move 360 tightens product edit stock adjustment movement loops in
  `backend/src/routes/products.js`. Batch allocation results for manual stock
  reductions now flow through direct loops, and inventory movement insertion
  now uses a direct loop with precomputed product name and purchase-price
  values. Branch-specific and all-branch removal checks, allocation order,
  movement type, branch, batch, lot, expiry, cost totals, audit/history, and
  product stock recalculation behavior remain unchanged. Focused product batch
  hierarchy, product search pagination, route contract, schema-audit, and full
  backend utility tests passed.

Move 361 status:
- Move 361 applies the guarded Phase 29 storage cleanup path. A dry-run first
  confirmed no QA smoke/action-history/test-data residue and no generated
  integrity backlog. The live prune then removed three old Phase 8.4 runtime
  report folders from `ops/runtime/reports`, freeing 703,101 bytes, while
  preserving business data, uploads, secrets, current backups, Docker images,
  and Docker volumes. Docker safe-prune ran in its restricted mode for stopped
  containers and builder cache only and reclaimed 0 bytes. Remote/R2 backup
  pruning was skipped for this local cleanup slice, leaving the Phase 28 R2
  follow-up active. Phase 29 repeated audit, cleanup postchecks, local health,
  Docker health, and Playwright public smoke passed after cleanup.

Move 362 status:
- Move 362 tightens the legacy product bulk-import setup path in
  `backend/src/routes/products.js`. Base64 image byte counting, image-only
  product matching, category/unit lookup maps, and brand option lookup maps now
  use direct loops instead of `reduce()`, `forEach()`, and chained `map()` /
  `filter()` allocations. Import size limits, image-only matching behavior,
  category/unit/brand normalization, setting persistence, SQL, audit payloads,
  and response shape remain unchanged. Focused CSV import, import integrity,
  product import policy, product batch hierarchy, product search pagination,
  portal inventory regression, route contract, and schema-audit tests passed.

Move 363 status:
- Move 363 completes the next obvious legacy product bulk-import callback-chain
  cleanup in `backend/src/routes/products.js`. Batch-stock reset ID/placeholder
  construction, image-reference parsing, current-gallery loading, pre-resolved
  import image collection, new-product branch-stock seeding, and final imported
  brand cleanup now use direct loops. Batch reset behavior, CSV image order and
  five-image cap, gallery normalization, branch-stock initialization,
  brand dedupe/sort behavior, SQL, audit payloads, and response shape remain
  unchanged. Focused import policy, import integrity, product batch hierarchy,
  product search pagination, route contract, portal inventory regression,
  schema-audit, and full backend utility tests passed.

Move 364 status:
- Move 364 closes the simple product import-signature projection cleanup and
  starts the backend sales checkout hot-path cleanup. `backend/src/routes/products.js`
  now builds import-detail signature parts with a direct loop, and
  `backend/src/routes/sales.js` now builds active-branch context, normalizes
  sale items, summarizes sale branches, dedupes checkout product IDs, maps
  product metadata, migrates product batches, and writes sale batch
  allocations/movements with direct loops. Import signature behavior, checkout
  branch validation, product cost lookup, stock deduction, batch allocation,
  movement creation, audit/history behavior, and response shape remain
  unchanged. Focused product import policy, import integrity, product search
  pagination, product batch hierarchy, portal inventory regression, route
  contract, schema-audit, and full backend utility tests passed.

Move 365 status:
- Move 365 continues the backend sales hot-path cleanup in
  `backend/src/routes/sales.js`. Sale status transition stock deduction and
  restoration now write batch allocations and inventory movements with direct
  loops, and `/api/sales` search token parsing plus response payload assembly
  now avoid callback chains. Status transition rules, stock availability
  checks, batch restore/deduction behavior, inventory movement fields, sales
  search SQL, response fields, audit/history behavior, and pagination limits
  remain unchanged. Focused product batch hierarchy, portal inventory
  regression, route contract, schema-audit, and full backend utility tests
  passed.

Move 366 status:
- Move 366 tightens the backend sales export/report path in
  `backend/src/routes/sales.js`. Export row hydration, item COGS calculation,
  completed-sale accounting totals, sales-detail payload construction, CSV row
  generation, and CSV summary line construction now use direct loops instead
  of repeated `map()`, `filter()`, and `reduce()` passes. Export period logic,
  accounting definitions, return/refund math, product/payment/status summary
  queries, CSV headers, CSV escaping, JSON response fields, and route contract
  behavior remain unchanged. Focused product batch hierarchy, portal inventory
  regression, route contract, schema-audit, and full backend utility tests
  passed.

Move 367 status:
- Move 367 tightens the backend returns stock-flow path in
  `backend/src/routes/returns.js`. Return search token parsing, include-items
  response assembly, customer-return product metadata prefetch, restored
  return allocation movement writes, supplier-return total-cost accumulation,
  supplier product-name lookup, supplier allocation/movement writes, edit
  return reversal/restock movement writes, and sale return-status
  recalculation now use direct loops instead of callback chains. Customer and
  supplier return validation, stock restoration/deduction semantics, batch
  allocation linkage, sale status outcomes, audit/history behavior, route
  payloads, and response shape remain unchanged. Focused product batch
  hierarchy, portal inventory regression, route contract, schema-audit, and
  full backend utility tests passed.

Move 368 status:
- Move 368 tightens the backend custom-table dynamic SQL path in
  `backend/src/routes/customTables.ts`. Table display-name humanization,
  schema normalization, custom-table list payloads, DDL column construction,
  row insert column/placeholders/value construction, and row update set/value
  construction now use direct loops instead of callback chains. The cleanup
  also removes an unused insert placeholder variable and centralizes ignored
  system row fields in one set. Custom table naming, allowed column types,
  created table SQL, row insert/update semantics, conflict checking,
  schema-metadata cache behavior, audit/broadcast behavior, and response shape
  remain unchanged. Focused route contract, schema metadata, schema-audit, and
  full backend utility tests passed.

Move 369 status:
- Move 369 tightens the backend settings save path in
  `backend/src/routes/settings.ts`. Brand option normalization, brand color
  map cleanup, settings snapshot assembly, attempted settings extraction,
  settings normalization/upsert, and settings audit key reporting now use
  direct loops and one shared metadata-key set instead of repeated
  `map()`, `filter()`, `forEach()`, `Object.entries()`, and `Object.keys()`
  passes. Settings conflict behavior, updated_at metadata cache checks, brand
  text integrity validation, color allowlisting, storage reconcile scheduling,
  audit payload fields, broadcasts, and response shape remain unchanged.
  Focused route contract, schema metadata, full automation, schema-audit, and
  full backend utility tests passed.

Move 370 status:
- Move 370 tightens the owned Google OAuth and integration doctor origin
  checklist path in `backend/src/services/googleOauth.ts` and
  `backend/src/services/integrationDoctor.ts`. Origin normalization now uses
  direct loops with stable de-duplication, Google login callback URI assembly
  is shared through one callback-path helper, and latest verified release
  backup directory discovery no longer uses `filter()`/`map()` chains.
  Authorized JavaScript origins, login redirect URIs, Drive redirect URIs,
  secret redaction, restore-needed detection, and public Google login config
  shape remain unchanged. Focused owned Google auth, integration doctor,
  schema-audit, and full backend utility tests passed.

Move 371 status:
- Move 371 tightens the public catalog product payload path in
  `backend/src/routes/catalog.ts`. Product ID collection, product image
  placeholder construction, product image grouping, and final catalog payload
  assembly now use direct loops and small named helpers instead of repeated
  `map()` and `forEach()` passes. Catalog product ordering, image-gallery
  five-item cap, fallback image behavior, branch-stock parsing, public API
  allowlisting, and response shape remain unchanged. Focused route contract,
  portal inventory regression, access-control, schema-audit, and full backend
  utility tests passed.

Move 372 status:
- Move 372 tightens the action history and user list response projection
  paths in `backend/src/routes/actionHistory.ts` and
  `backend/src/routes/users.js`. Action-history row serialization and user
  row sanitization now use direct-loop helper functions instead of endpoint
  `rows.map(...)` calls, keeping response shaping named and easier to profile.
  Action history ownership filters, sensitive-history checks, user permission
  merging, admin flags, role-system flags, and response shapes remain
  unchanged. Focused route contract and permission-policy tests, schema-audit,
  and full backend utility tests passed. A separate
  `authSecurityFlow.test.ts` run still fails before this change path because
  the harness resets the fetch connection and then cleanup requires missing
  native `libpq` bindings; this remains outside the standard utility suite.

Move 373 status:
- Move 373 tightens the notification summary route in
  `backend/src/routes/notifications.ts`. Notification settings placeholder
  construction, settings row map assembly, point-policy settings map assembly,
  inventory alert item assembly, expiry alert item/count assembly, and unread
  count summing now use direct loops and named helpers instead of repeated
  `map()`, `forEach()`, `filter()`, and `reduce()` passes. Existing summary
  separator text was left untouched because the source currently contains
  mojibake; the change avoids re-encoding those strings while keeping
  notification payloads stable. Inventory, expiry, sales, loyalty, portal,
  system notification semantics and response shapes remain unchanged. Focused
  product expiry, route contract, portal inventory regression, schema-audit,
  and full backend utility tests passed.

Move 374 status:
- Move 374 continues the notification summary cleanup in
  `backend/src/routes/notifications.ts`. Loyalty sales/refund/reward aggregate
  rows now build customer maps with direct loops, loyalty threshold matching
  now computes balances inside one direct loop, and the capped loyalty
  notification item payload now uses a bounded direct loop instead of
  `slice().map()`. Loyalty point policy math, customer sorting by balance,
  50-item cap, threshold behavior, notification fields, and response shape
  remain unchanged. Focused product expiry, route contract, portal inventory
  regression, schema-audit, and full backend utility tests passed.

Move 375 status:
- Move 375 completes the next notification summary item-construction cleanup
  in `backend/src/routes/notifications.ts`. Awaiting-payment and
  awaiting-delivery sales notification items now use one direct-loop helper,
  and pending customer portal submission items now use a direct-loop helper
  instead of inline `map()` response construction. Sales notification counts,
  sale labels, portal submission labels, platform-aware portal metadata,
  summary text, notification fields, and response shape remain unchanged.
  Focused syntax, product expiry, route contract, portal inventory regression,
  schema-audit, and full backend utility tests passed.

Move 376 status:
- Move 376 completes the notification summary loop and encoding cleanup in
  `backend/src/routes/notifications.ts`. Inventory, expiry, and sales summary
  strings now use one direct-loop `joinNotificationSummary()` helper and one
  `NOTIFICATION_SUMMARY_SEPARATOR` constant instead of three repeated
  `filter(Boolean).join(...)` passes. Sales and portal notification metadata
  now also use the same separator, removing the local mojibake/gibberish
  bullet text from this route. Notification counts, labels, summary
  parameters, item payload fields, permission gates, SQL, and response shape
  remain unchanged. Focused syntax, product expiry, route contract, portal
  inventory regression, schema-audit, and full backend utility tests passed.

Move 377 status:
- Move 377 tightens the portal AI request path in
  `backend/src/services/portalAi.ts`. Token parsing, visitor timestamp
  pruning, product preference filtering, product scoring/candidate projection,
  prompt candidate-line assembly, assistant recommendation normalization,
  provider ordering, provider usage summaries, max-input calculation, and
  failover provider selection now use named direct-loop helpers instead of
  repeated `map()`, `filter()`, `forEach()`, and `reduce()` chains. AI
  provider priority/cooldown behavior, prompt content/order, recommendation
  caps, citation caps, product scoring rules, rate limits, and response shape
  remain unchanged. Focused syntax, portal candidate-selection smoke, portal
  utility, route contract, portal inventory regression, schema-audit, and full
  backend utility tests passed.

Move 378 status:
- Move 378 tightens Google Drive sync version-retention selection in
  `backend/src/services/googleDriveSync/versioning.ts`. Version row
  normalization and date-expired selection now use direct-loop helpers instead
  of a `map().filter()` chain and a second filtered pass, while preserving the
  timestamp-first retention behavior, version-number fallback behavior, sort
  order, default retention days, and returned item shape. Focused syntax,
  callback-chain scan, Google Drive sync versioning tests, backup performance
  hardening tests, schema-audit, and full backend utility tests passed.

Move 379 status:
- Move 379 tightens the main Google Drive sync service in
  `backend/src/services/googleDriveSync/index.js`. Settings placeholder
  construction, settings row mapping, settings update entry selection, settings
  delete preparation, sync-entry mapping, multi-hash streaming, fetch-failure
  detail joining, snapshot directory sorting, duplicate sibling filtering, live
  path collection, and stale mapping selection now use named direct-loop
  helpers instead of repeated `map()`, `filter()`, `forEach()`, and `reduce()`
  chains. Google Drive sync configuration behavior, resumable upload hashing,
  duplicate remote cleanup, delete-missing cleanup order, folder sort order,
  error message shape, and database writes remain unchanged. Focused syntax,
  callback-chain scan, Google Drive sync versioning tests, backup performance
  hardening tests, schema-audit, and full backend utility tests passed.

Move 380 status:
- Move 380 tightens backup package retention and listing in
  `backend/src/services/backupPackages.js`. Backup version cache cloning,
  writable drain/error waiter notifications, object-manifest construction,
  local backup directory discovery, retention planning, local kept-ID
  summaries, remote delete-key collection, remote removal summaries, local
  version listing, R2 object aggregation, and final version sorting now use
  named direct-loop helpers instead of repeated `map()`, `filter()`,
  `forEach()`, and `reduce()` chains. Backup retention order, local/R2 pruning
  behavior, bytes-removed totals, cache behavior, reusable backup metadata,
  object manifest shape, and public version listing shape remain unchanged.
  Focused syntax, callback-chain scan, backup retention tests, backup schema
  tests, backup performance hardening tests, schema-audit, and full backend
  utility tests passed.

Move 381 status:
- Move 381 tightens the AI provider gateway and settings route in
  `backend/src/services/aiGateway.ts` and `backend/src/routes/ai.ts`.
  Supported-model normalization, Google request content construction, Google
  response text joining, provider-list serialization, and AI response-log
  serialization now use named direct-loop helpers instead of repeated
  `map()`/`filter()` chains. Provider metadata defaults, API-key masking,
  endpoint safety checks, Google role mapping, response text separators,
  provider list ordering, response log fields, and route payload shapes remain
  unchanged. Focused syntax, callback-chain scan, route contract tests, owned
  Google auth tests, schema-audit, and full backend utility tests passed.

Move 382 status:
- Move 382 tightens backend branch stock integrity and transfer helpers in
  `backend/src/routes/branches.ts`. Stock-integrity preview payload and total
  quantity calculation now share one direct-loop helper, repair movement
  updates and touched-product recalculation use direct loops, and transfer
  insert placeholders/quoted columns use shared SQL helper functions instead
  of repeated `map()`, `forEach()`, and `reduce()` chains. Preview token input
  order, total quantity math, default-branch repair behavior, transfer column
  order, inventory movement writes, audit payloads, broadcasts, and response
  shapes remain unchanged. Focused syntax, callback-chain scan, route contract
  tests, schema-audit, and full backend utility tests passed. The standalone
  `branchStockSearch.test.ts` harness still fails before assertions on this
  machine with `ECONNRESET`, matching the known spawned-server harness
  instability outside the standard backend utility suite.

Move 383 status:
- Move 383 tightens runtime catalog-integrity diagnostics in
  `backend/src/routes/runtime.ts`. Product field counting and suspicious
  product sampling now share named direct-loop helpers, and brand-option
  suspicious-text sampling now uses a bounded direct-loop helper instead of
  chained `map()`/`filter()` passes. Runtime version payloads,
  suspicious-field counters, sample limits, scanner status, permission gates,
  and response shape remain unchanged. Focused syntax, callback-chain scan,
  runtime version tests, route contract tests, schema-audit, and full backend
  utility tests passed.

Move 384 status:
- Move 384 tightens offline sync outbox normalization and digest helpers in
  `backend/src/routes/sync.ts`. Stable payload stringification now uses
  explicit ordered loops for arrays and sorted object keys, and outbox batch
  normalization now uses one direct-loop helper instead of a route-local
  `map()` pass. Payload digest semantics, object-key ordering, array ordering,
  operation metadata normalization, replay gates, chunked file sync behavior,
  Cloudflare Access diagnostics, and response shape remain unchanged. Focused
  syntax, callback-chain scan, offline security tests, route contract tests,
  schema-audit, and full backend utility tests passed.

Move 385 status:
- Move 385 converts the import-job refresh helper from JavaScript to
  TypeScript. `frontend/src/utils/importJobRefresh.ts` now owns the typed
  event-dispatch logic for completed import-job refresh channels, while
  `frontend/src/utils/importJobRefresh.js` remains a compatibility wrapper for
  existing imports. The language-runtime audit generator now recognizes named
  TypeScript re-export wrappers and records this helper as a completed
  TypeScript slice, while still rejecting Worker/Python/Rust-style rewrites
  for this main-thread event dispatcher. Import refresh channel ordering,
  terminal-status transition checks, `sync:update` event payloads, existing
  `.js` import paths, and build output behavior remain unchanged. Focused
  import-job refresh tests, frontend typecheck, full frontend utility tests,
  frontend production build, language-runtime audit, and wrapper reference
  scans passed.

Move 386 status:
- Move 386 clears stale host Node background processes and adds a repeatable
  cleanup guard. The host sweep stopped 25 non-Business-OS `node.exe`
  processes: 14 old `C:\Users\user\Downloads\LEARN` Next servers listening on
  ports 3211, 3212, 4317, 4318, 4319, 4320, 4337, 4342, 4344, 4345, 4347,
  4351, 4352, and 4353; one old temporary `learn-one` runner; and 10 duplicated
  Codex `xcodebuildmcp` helper processes that were not needed for this Business
  OS session. Approximate stopped working set was 953.4 MB, and a follow-up
  process scan showed zero remaining host `node.exe` processes after the cleanup
  commands completed. `ops/scripts/powershell/clear-stale-node-processes.ps1`
  now provides a guarded preview/apply path that excludes the Business OS
  workspace by default, and `ops/package.json` exposes preview/apply scripts.
  Docker app, Postgres, Redis, workers, and Cloudflare containers were left
  untouched and stayed healthy; `/health` remained OK.

Move 387 status:
- Move 387 tightens the stale Node cleanup helper reporting. The cleanup script
  now walks its own process ancestry and excludes the current PowerShell/npm
  launcher family from external Node counts, so
  `npm --prefix ops run cleanup-node-processes:preview` reports zero remaining
  external Node processes when the only visible `node.exe` belongs to the
  preview command itself. This keeps the background-process check actionable
  without accidentally targeting Business OS Docker services or short-lived
  verification runners. Direct PowerShell preview, npm preview, process scan,
  Phase 29 repeated audit, `/health`, Docker status, and Playwright public
  smoke passed.

Move 388 status:
- Move 388 tightens the auth bootstrap settings snapshot helper in
  `backend/src/routes/auth.js`. The settings row projection now uses a direct
  loop instead of a `forEach()` callback while preserving the settings query,
  sanitized settings payload, bootstrap response shape, session behavior, and
  existing OAuth callback changes already present in the route. Focused syntax,
  callback-chain scan, route contract tests, owned Google auth tests, offline
  security tests, schema-audit, and full backend utility tests passed.

Move 389 status:
- Move 389 tightens the contacts point-policy settings helper in
  `backend/src/routes/contacts.js`. The point policy settings map now uses a
  direct loop instead of a `forEach()` callback while preserving the settings
  query, point-basis defaults, USD/KHR point calculations, customer point
  summary behavior, and existing customer points pagination work already
  present in the route. Focused syntax, contact options tests, route contract
  tests, import CSV tests, schema-audit, and full backend utility tests passed.

Move 390 status:
- Move 390 tightens customer portal config normalization helpers in
  `backend/src/routes/portal.js`. FAQ normalization now stops after the
  accepted 24 public entries without building intermediate mapped/filtered
  arrays, portal translation and recommended-product ID normalization now use
  direct loops, and the portal settings map uses a direct row loop. Public
  config payload shape, sanitized settings behavior, FAQ IDs, translation
  blocks, recommended-product de-duplication, membership lookup behavior, and
  catalog payloads remain unchanged. Focused syntax, callback-chain scan,
  route contract tests, portal membership hardening tests, and portal inventory
  regression tests passed.

Move 391 status:
- Move 391 tightens customer portal product asset and payload materialization in
  `backend/src/routes/portal.js`. Product ID collection, SQL placeholder
  construction, image-map assembly, branch-stock-map assembly, and final
  portal payload list decoration now use named direct-loop helpers instead of
  callback chains, while preserving the shared asset query path, image gallery
  fallback, branch stock payloads, top-seller/new-arrival/recommended ranks,
  full portal product list behavior, and paged catalog search behavior.
  `backend/test/portalInventoryRegression.test.ts` now guards the shared
  direct-loop payload helper instead of the prior inline `map()` shape.
  Focused syntax, route contract tests, portal inventory regression tests, and
  portal membership hardening tests passed.

Move 392 status:
- Move 392 tightens customer portal loyalty point summarization in
  `backend/src/routes/portal.js`. `summarizePoints()` now walks sales, returns,
  and approved share submissions with one direct pass per input list instead of
  building filtered arrays and reducing eligible sales twice. Earned,
  deducted, redeemed, rewarded, balance, redeemable units, next-redeem math,
  USD/KHR redemption values, cancelled-sale exclusions, awaiting-payment
  exclusions, cancelled-return exclusions, and approved-reward handling remain
  unchanged. Focused syntax, route contract tests, portal inventory regression
  tests, and portal membership hardening tests passed.

Move 393 status:
- Move 393 tightens customer portal catalog search/filter parsing in
  `backend/src/routes/portal.js`. Search-term splitting, filter-value
  splitting, branch ID parsing, named SQL placeholder construction,
  brand/category filter assembly, and stock-state normalization now use named
  direct-loop helpers instead of callback chains. Query limits, NFC
  normalization, `all` filtering, search parameter names, branch-stock
  filtering, initial filtering, stock-state behavior, and paged catalog response
  shape remain unchanged. Focused syntax, route contract tests, portal inventory
  regression tests, and portal membership hardening tests passed.

Move 394 status:
- Move 394 tightens customer portal catalog metadata assembly in
  `backend/src/routes/portal.js`. Distinct brand/category row extraction,
  product-brand metadata extraction, persisted library-brand normalization, and
  merged brand de-duplication now use named direct-loop helpers instead of
  `map()`/`filter()` chains and spread-based `Set` construction. Category
  rows, branch rows, brand ordering, blank-brand filtering, persisted
  `product_brand_options` parsing, search metadata filters, and initials
  aggregation remain unchanged. Focused syntax, route contract tests, portal
  inventory regression tests, and portal membership hardening tests passed.

Move 395 status:
- Move 395 tightens customer portal membership lookup and submission review
  response shaping in `backend/src/routes/portal.js`. Membership SQL clause
  wrapping, share-submission screenshot normalization, and membership totals
  now use shared direct-loop helpers instead of callback chains and repeated
  `reduce()` passes. Customer matching, empty-clause fallback to `FALSE`,
  sales/returns/submission query SQL, screenshot JSON parsing, review response
  fields, sales/return totals, membership discount totals, point summaries, and
  public membership response shape remain unchanged.
  `backend/test/portalInventoryRegression.test.ts` now guards the shared
  clause-wrapping helper. Focused syntax, route contract tests, portal
  inventory regression tests, and portal membership hardening tests passed.

Move 396 status:
- Move 396 tightens customer portal screenshot and AI citation collection in
  `backend/src/routes/portal.js`. Screenshot sanitization now uses a bounded
  direct loop that stops at the existing eight-entry cap while preserving
  trimming, blank rejection, 2 MB entry-size rejection, and safe media-reference
  checks. Portal AI recommendation citations now use a direct nested loop
  helper instead of `flatMap()`, preserving recommendation payloads, AI log
  storage, and response fields. Focused syntax, route contract tests, portal
  inventory regression tests, and portal membership hardening tests passed.

Move 397 status:
- Move 397 tightens customer portal product signal ranking in
  `backend/src/routes/portal.js`. Product rank map construction, sale metric
  ingestion, return metric ingestion, net signal row collection, new-arrival
  rank construction, and recommended-product rank construction now use named
  direct-loop helpers instead of `map()`/`filter()`/`forEach()` chains and
  `Array.from(...).map()`. Top-seller ordering, top-product ordering,
  tie-breaking by product ID, returned quantity/revenue subtraction,
  new-arrival ordering, recommended rank order, badge payload fields, and
  catalog responses remain unchanged. Focused syntax, route contract tests,
  portal inventory regression tests, and portal membership hardening tests
  passed.

Move 398 status:
- Move 398 tightens import job route wrapper loops in
  `backend/src/routes/importJobs.ts`. Import permission checks, permitted type
  collection, job file response serialization, and multi-image upload
  persistence now use named direct-loop helpers instead of route-level
  `some()`/`filter()`/`map()` chains. Import type ordering, permission
  semantics, file response fields, relative-path fallback behavior, image
  upload ordering, audit payloads, and import job responses remain unchanged.
  Focused syntax, route contract tests, CSV parser tests, import decision
  integrity tests, product import policy tests, and 10k-row import scale smoke
  tests passed.

Move 399 status:
- Move 399 tightens import job service list/update loops in
  `backend/src/services/importJobs.js`. Import job listing now uses a reusable
  SQL placeholder builder and a direct row decoration helper instead of
  `map()`/`filter()` chains, and import job patch updates now collect allowed
  fields, assignments, and named parameters in one direct pass. Type filtering,
  pagination limits, decorated job payloads, allowed patch fields, updated_at
  writes, and named SQL parameter behavior remain unchanged. Focused syntax,
  route contract tests, CSV parser tests, import decision integrity tests,
  product import policy tests, and 10k-row import scale smoke tests passed.

Move 400 status:
- Move 400 tightens import image-reference and product-gallery loops in
  `backend/src/services/importJobs.js`. Incoming image key collection now uses
  shared key lists and direct loops, product gallery synchronization now
  de-duplicates and stops at the existing five-image cap during one pass, image
  insert ordering now uses a direct indexed loop, and current-gallery loading
  avoids `map()`/`filter()` chains. Direct image keys, list-field parsing,
  upload path normalization, duplicate suppression, first-image product
  preview behavior, and five-image caps remain unchanged. Focused syntax, CSV
  parser, product import policy, 10k-row import scale, product batch hierarchy,
  and media optimization tests passed.

Move 401 status:
- Move 401 tightens import product review grouping loops in
  `backend/src/services/importJobs.js`. Duplicate-name review groups now share
  direct-loop helpers for set ingestion, set serialization, subgroup
  finalization, and group sorting instead of nested `forEach()` and
  `Array.from().filter().map().sort()` chains. Group inclusion rules,
  row-number ordering, subgroup signatures, field/issue payload order,
  existing-match payloads, row summaries, and suggested actions remain
  unchanged. Focused syntax, import decision integrity, product import policy,
  CSV parser, 10k-row import scale, and route contract tests passed.

Move 402 status:
- Move 402 tightens import review decision and label loops in
  `backend/src/services/importJobs.js`. Identifier filter checks, product
  conflict labels, contact conflict labels, generic empty-row detection,
  decision field copying, field override copying, and product signature
  serialization now use named direct-loop helpers instead of local
  `some()`/`filter()`/`forEach()`/`map()` chains. Label order, empty-row
  semantics, decision override precedence, copied decision keys, field override
  keys, and signature string format remain unchanged. Focused syntax, import
  decision integrity, product import policy, CSV parser, 10k-row import scale,
  and route contract tests passed.

Move 403 status:
- Move 403 tightens import review count and group-decision loops in
  `backend/src/services/importJobs.js`. Review conflict count accumulation now
  runs through a named direct-loop helper, and group decision normalization now
  replaces the local `Object.entries().forEach()` callback with a direct helper
  that preserves `name:` key stripping and invalid-value rejection. Count keys,
  identifier counting, issue counting, visible row filtering, row pagination,
  group decision merge order, and policy persistence remain unchanged. Focused
  syntax, import decision integrity, product import policy, CSV parser,
  10k-row import scale, and route contract tests passed.

Move 404 status:
- Move 404 tightens import product parent and lookup-map helpers in
  `backend/src/services/importJobs.js`. Parent product selection now scans once
  with `compareParentProductCandidate()` instead of cloning and sorting the
  full candidate list, settings option maps now build options and normalized
  lookup entries in one pass, and product context category/unit/supplier/branch
  indexes now share `buildLookupMap()`. Default branch selection also uses a
  direct helper instead of an inline `find()`. Parent selection priority,
  option order, normalized lookup keys, cached supplier/branch behavior,
  default-branch fallback, and product import context fields remain unchanged.
  Focused syntax, import decision integrity, product import policy, product
  batch hierarchy, CSV parser, and 10k-row import scale tests passed.

Move 405 status:
- Move 405 tightens import product row-cache ordering in
  `backend/src/services/importJobs.js`. The per-job same-name product cache now
  updates through `insertProductImportRow()`, which removes any existing row for
  the same product ID and inserts the replacement in sorted position instead of
  filtering and re-sorting the whole list. Product import ordering by group,
  parent, created_at, and id; same-name cache contents; imported product
  remembering; and source integrity guards remain unchanged. Focused syntax,
  import decision integrity, product import policy, product batch hierarchy,
  CSV parser, and 10k-row import scale tests passed.

Move 406 status:
- Move 406 tightens import branch-batch stock cleanup in
  `backend/src/services/importJobs.js`. Product batch IDs now flow through a
  shared direct-loop `collectRowIds()` helper, and replacement stock cleanup now
  uses `clearBranchBatchStockForProduct()` plus the existing SQL placeholder
  builder instead of duplicated `map()` chains. Replacement behavior for rows
  with and without a target branch, batch stock zeroing, product stock rollups,
  and positive-quantity batch increases remain unchanged. Focused syntax,
  product batch hierarchy, product import policy, import decision integrity,
  CSV parser, and 10k-row import scale tests passed.

Move 407 status:
- Move 407 tightens import cancellation placeholder and ID loops in
  `backend/src/services/importJobs.js`. Cancellable-job queries, active-job wait
  polling, cancel-all updates, import file cancellation, and delete-all job ID
  collection now reuse `buildSqlPlaceholders()` and `collectRowIds()` instead
  of repeated `map()` chains. Cancellable status coverage, duplicate job ID
  collapse, wait polling, cancel-all merge order, queued job removal, file
  cancellation, delete-all behavior, and runtime broadcasts remain unchanged.
  Focused syntax, import decision integrity, system jobs, backup performance
  hardening, route contract, and 10k-row import scale tests passed.

Move 408 status:
- Move 408 reconciles obsolete Phase 29 status wording and tightens import
  image/CSV lookup construction in `backend/src/services/importJobs.js`.
  Roadmap docs now say the first Phase 29 baseline is complete while Phase 29
  remains active as the recurring guardrail. Image lookup keys, image-only
  product matching keys, inventory product/branch lookup maps, sales
  product/branch lookup maps, and default-branch selection now use named
  direct-loop helpers instead of `forEach()`/temporary array callback chains.
  Image filename matching, first-match product semantics, branch overwrite
  semantics, inventory import behavior, sales import grouping, and default
  branch fallback remain unchanged.

Move 409 status:
- Move 409 tightens import error CSV export in
  `backend/src/services/importJobs.js`. Error CSV generation now appends rows
  with a direct helper loop instead of nested `map()` chains and spread
  materialization. The UTF-8 BOM, header order, 5,000-row error limit, quote
  escaping, empty-field fallback, row ordering, and public download contract
  remain unchanged.

Move 410 status:
- Move 410 tightens remaining import product signature and ZIP-file selection
  callbacks in `backend/src/services/importJobs.js`. Same-name product
  signature matching now uses `findProductWithSignature()` in review,
  preflight, and apply paths, and ZIP extraction now uses
  `getUnprocessedJobFiles()` instead of an inline `filter()` callback. Product
  signature equality, imported-signature fallback, merge-target validation,
  review conflict classification, ZIP processed-file skipping, and import
  queue behavior remain unchanged. One suspicious-catalog warning text
  `map().filter()` chain remains intentionally queued for a later semantic
  cleanup pass.

Move 411 status:
- Move 411 clears the final import-service callback chain in
  `backend/src/services/importJobs.js`. Brand-option cleanup after product
  imports now uses `buildSafeCatalogOptionList()` to normalize option text,
  drop blanks, and reject suspicious catalog text before the existing
  `normalizeOptionList()` de-duplication. Brand option persistence,
  suspicious-text rejection, settings broadcasts, product import accounting,
  and catalog update behavior remain unchanged. A callback-chain scan now
  reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`, or
  `Array.from()` hits in `backend/src/services/importJobs.js`.

Move 412 status:
- Move 412 tightens product-route branch, import-signature, and sorted-map
  helper paths in `backend/src/routes/products.js`. Default-branch selection,
  branch-by-id lookup, branch-by-name lookup, product import same-detail
  matching, bounded set materialization, category usage sorting, and clean
  brand option sorting now use named direct-loop helpers instead of
  `find()`/`Array.from()` materialization. Default branch fallback, branch
  creation, movement branch names, product import merge/link decisions,
  category usage ordering, brand setting persistence, and route contracts
  remain unchanged. A callback-chain scan now reports no `map()`, `filter()`,
  `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in
  `backend/src/routes/products.js`.

Move 413 status:
- Move 413 tightens inventory product family expansion in
  `backend/src/routes/inventory.js`. Family root ID collection and merged
  family-row sorting now use direct-loop helpers instead of `Array.from()`
  materialization and inline sort callbacks. Family expansion SQL inputs,
  parent/variant inclusion, merged row de-duplication, inventory product
  ordering by name then ID, branch-stock hydration, and response sanitization
  remain unchanged. A callback-chain scan now reports no `map()`, `filter()`,
  `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in
  `backend/src/routes/inventory.js`.

Move 414 status:
- Move 414 tightens sale stock availability sampling in
  `backend/src/routes/sales.js`. The insufficient-stock error path now uses
  `findSaleItemForProduct()` instead of an inline `find()` callback when
  choosing the product name to display in validation errors. Required quantity
  aggregation, branch scoping, available-stock checks, error wording,
  product-name fallback, stock deduction, and sales route contracts remain
  unchanged. A callback-chain scan now reports no `map()`, `filter()`,
  `forEach()`, `reduce()`, `find()`, or `Array.from()` hits in
  `backend/src/routes/sales.js`.

Move 415 status:
- Move 415 tightens contact import, search, scoped-ID, and point-summary
  helpers in `backend/src/routes/contacts.js`. Provided import rows, search
  haystack SQL, scoped customer ID parsing, point-summary scope placeholders,
  customer summary row maps, summary source ID collection, customer response
  decoration, and point-summary list responses now use named direct-loop
  helpers instead of `map()`/`filter()`/`forEach()` chains and spread-based set
  construction. Import row numbers, search SQL shape, scoped ID de-duplication,
  points policy math, summary defaults, paged customer responses, and
  points-summary API behavior remain unchanged. A callback-chain scan now
  reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`,
  `flatMap()`, or `Array.from()` hits in `backend/src/routes/contacts.js`.

Move 416 status:
- Move 416 tightens the remaining small auth/user route callback scans.
  Password-reset redirect selection in `backend/src/routes/auth.js` now uses
  `findFirstHttpUrl()`, while provider identity UUID and linked-provider
  selection in `backend/src/routes/users.js` now use `findFirstUuid()` and
  `findProviderIdentity()`. Redirect priority, URL validation, UUID trimming,
  provider-name normalization, unlink guard behavior, and auth/user route
  contracts remain unchanged. Callback scans now report no `map()`, `filter()`,
  `forEach()`, `reduce()`, `find()`, `flatMap()`, or `Array.from()` hits in
  `backend/src/routes/auth.js` or `backend/src/routes/users.js`.

Move 417 status:
- Move 417 clears the remaining backend route callback-chain scan by tightening
  `backend/src/routes/system/index.js`. Import-stop ID messages, migration
  table counts, system setting reads/writes, scale-migration row totals,
  custom-table discovery, reset/factory-reset broadcasts, sync push response
  shaping, integrity-repair broadcasts, folder root listing, visible directory
  listing, and folder-picker script assembly now use named direct-loop helpers
  instead of `map()`/`filter()`/`forEach()`/`reduce()` chains or `Array.from()`.
  Backup/reset/restore SQL order, custom-table drop guards, broadcast channel
  lists, folder browsing payloads, and picker PowerShell text remain unchanged.
  A callback-chain scan now reports no `map()`, `filter()`, `forEach()`,
  `reduce()`, `find()`, `flatMap()`, or `Array.from()` hits anywhere under
  `backend/src/routes`.

Move 418 status:
- Move 418 clears the backend service callback-chain scan by tightening
  `backend/src/services/backupPackages.js` and
  `backend/src/services/googleDriveSync/index.js`. Backup writable waiters,
  concurrent object-copy worker startup, grouped remote backup package
  materialization, backup-version sorting inputs, and Google Drive reusable
  non-folder sibling selection now use named direct-loop helpers instead of
  `Array.from()` or inline `find()`. Writable error/drain behavior, object
  copy concurrency, remote package grouping, retention sorting, and Drive file
  reuse/update fallback behavior remain unchanged. A callback-chain scan now
  reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`,
  `flatMap()`, or `Array.from()` hits anywhere under `backend/src/services`.

Move 419 status:
- Move 419 tightens backup summary and catalog text utility loops in
  `backend/src/backupSchema.ts` and `backend/src/catalogTextIntegrity.js`.
  Backup table row counts, custom-table row totals, normalized backup counts,
  suspicious catalog field detection, and normalized option-list de-duplication
  now use direct loops instead of `reduce()`/`map()`/`filter()`/`forEach()` or
  `Array.from()`. Backup version metadata, table count keys, custom-table
  counting, suspicious text detection rules, locale sorting, and first-seen
  option capitalization remain unchanged.

Move 420 status:
- Move 420 tightens contact option normalization in
  `backend/src/contactOptions.ts`. Stored structured options, legacy string
  options, fallback options, serialization cleanup, primary-option selection,
  and option data checks now use direct-loop helpers instead of
  `map()`/`filter()`/`find()` chains. The three-option cap, address-vs-area
  field rules, default labels, legacy migration behavior, serialization shape,
  and primary contact fallback remain unchanged.

Move 421 status:
- Move 421 tightens startup/runtime infrastructure helper loops in
  `backend/src/config/index.ts`, `backend/src/dataPath/index.ts`,
  `backend/src/organizationContext/index.ts`, `backend/src/settingsSnapshot.ts`,
  and `backend/src/runtimeVersion.ts`. Env candidate filtering, runtime/data
  folder creation, organization folder creation, settings snapshot sanitizing,
  first existing runtime directory selection, and source-hash file filtering
  now use direct loops. Directory names, env precedence, organization folder
  guardrails, media sanitization, runtime revision behavior, and source hash
  ordering remain unchanged.

Move 422 status:
- Move 422 tightens CSV import parsing in `backend/src/importCsv.ts`.
  Delimiter detection, header normalization, parsed row materialization,
  streaming header setup, row-content checks, and CSV value-to-row projection
  now use direct-loop helpers instead of `map()`/`filter()`/`forEach()` chains.
  UTF-8 BOM handling, delimiter priority, quote/CRLF parsing, Khmer text and
  digit preservation, `_rowNumber` values, batch sizing, and empty-row
  filtering remain unchanged.

Move 423 status:
- Move 423 tightens product import policy list helpers in
  `backend/src/productImportPolicies.ts`. Array/JSON/string list
  normalization, lowercase uniqueness set construction, and append-unique
  merging now use direct-loop helpers instead of `map()`/`filter()`/`forEach()`
  chains. JSON-array support, `|`/`;`/newline splitting, case-insensitive
  de-duplication, imported item ordering, and ` | ` serialization remain
  unchanged.

Move 424 status:
- Move 424 tightens schema/security/runtime helper loops in
  `backend/src/schemaMetadata.ts`, `backend/src/middleware.ts`,
  `backend/src/security.ts`, `backend/src/netSecurity.ts`, and
  `backend/src/storage/organizationFolders.js`. Column candidate
  normalization, column presence caching, permission key collection,
  any-permission checks, rate/abuse timestamp pruning, private IPv4 parsing,
  blocked host suffix checks, and organization folder discovery now use direct
  loops instead of callback chains. Cache keys, permission responses,
  retry-after behavior, private network blocking, and exact/canonical
  organization folder precedence remain unchanged.

Move 425 status:
- Move 425 tightens system job lifecycle helpers in `backend/src/systemJobs.ts`.
  Runtime migration statement execution, finished-job collection, old finished
  job cleanup, persisted job row serialization, and in-memory job listing now
  use direct-loop helpers instead of `forEach()`/`Array.from()`/`filter()`/
  `map()` chains. Stale recovery, persistence throttling, completed-job cap,
  database listing order, in-memory fallback order, and public job shape remain
  unchanged.

Move 426 status:
- Move 426 tightens file-asset reference, orphan, and usage helpers in
  `backend/src/fileAssets.js`. Upload-reference recursion, persisted reference
  collection, reference backfill registration, tracked upload path collection,
  object/local orphan scans, storage-delete key collection, usage map seeding,
  settings/submission usage expansion, and asset-row serialization now use
  named direct-loop helpers instead of callback chains. R2 key normalization,
  local upload deletion rules, reference backfill metadata, usage labels,
  `canDelete` behavior, and browser public-path resolution remain unchanged.

Move 427 status:
- Move 427 tightens product-batch stock hierarchy helpers in
  `backend/src/productBatches.ts`. Product ID normalization, placeholder
  construction, batch ID extraction, tracked-batch detection, product-batch
  grouping, branch rollup aggregation, legacy batch zeroing, branch quantity
  seeding, force-migration ID listing, and availability totals now use named
  direct-loop helpers instead of callback chains. FEFO ordering, branch rollup
  math, legacy synthetic batch behavior, allocation restore behavior, and
  public helper exports remain unchanged.

Move 428 status:
- Move 428 tightens shared backend helper loops in `backend/src/helpers.ts`.
  CSV non-empty line filtering, header normalization, parsed-row construction,
  backup import placeholder/value construction, returned-item quantity maps,
  fully-returned sale detection, integrity success checks, and sale profit COGS
  totals now use named direct-loop helpers instead of callback chains. CSV row
  numbering, backup import ignore behavior, sale status repair semantics,
  integrity response shape, and profit calculations remain unchanged.

Move 429 status:
- Move 429 tightens object-store helper loops in `backend/src/objectStore.ts`.
  Cloudflare R2 API query construction, delete-key normalization and
  de-duplication, bulk delete object descriptors, Cloudflare object-list
  serialization, and S3 object-list serialization now use named direct-loop
  helpers instead of callback chains. S3/R2 driver selection, R2 API fallback
  conditions, timeout handling, delete chunk sizing, and list payload shape
  remain unchanged.

Move 430 status:
- Move 430 tightens server utility host and sanitizer helpers in
  `backend/src/serverUtils.ts`. Configured public host collection, customer
  portal host de-duplication, and recursive array key sanitization now use
  direct-loop helpers instead of callback chains. Origin allowlist behavior,
  customer portal host precedence, WebSocket origin checks, CSP/cache headers,
  and prototype-pollution key stripping remain unchanged.

Move 431 status:
- Move 431 tightens portal about-block normalization in
  `backend/src/portalUtils.js`. About-block creation and meaningful-block
  filtering now use a direct-loop helper instead of `map()`/`filter()` chains.
  JSON string parsing, fallback IDs, supported block types, media/title/body
  trimming, Google Maps embed normalization, and public helper exports remain
  unchanged.

Move 432 status:
- Move 432 tightens permission definition helpers in
  `backend/src/permissions.ts`. Permission definition expansion and
  definition lookup now use direct-loop helpers instead of `flatMap()`/`map()`
  and `find()` chains. Section labels, sensitivity metadata, default role
  permissions, action-history permission mapping, sensitive action detection,
  and public exports remain unchanged.

Move 433 status:
- Move 433 tightens initial-key aggregation helpers in
  `backend/src/initials.js`. Khmer order map construction, row aggregation,
  sorted entry materialization, and aggregate response construction now use
  direct-loop helpers instead of callback chains. Khmer collation, Latin/number
  ordering, symbol handling, count accumulation, and public helper exports
  remain unchanged.

Move 434 status:
- Move 434 tightens small security and maintenance predicates in
  `backend/src/accessControl.ts`, `backend/src/maintenanceLock.js`, and
  `backend/src/uploadSecurity.ts`. Public API allowlist matching,
  maintenance-lock write allowlisting, read-only method checks, and upload
  magic-byte matching now use direct loops or named predicates instead of
  callback chains. Public route allowlisting, maintenance 423 behavior, upload
  file-kind detection, and security test behavior remain unchanged.

Move 435 status:
- Move 435 tightens Postgres compatibility and cutover-readiness scans in
  `backend/src/db/postgresQueryCompat.ts` and
  `backend/src/db/cutoverReadiness.ts`. Numeric field matching, coerced-row
  materialization, forbidden-pattern scanning, blocker counting, summary row
  construction, and multi-file analysis now use named direct-loop helpers
  instead of callback chains. SQL translation, numeric coercion exceptions,
  cutover blockers, packaged-runtime gating, and report shapes remain
  unchanged.

Move 436 status:
- Move 436 tightens the synchronous Postgres runtime bridge in
  `backend/src/postgresDatabase.ts`. Query-row coercion, semicolon-split exec
  statement materialization, runtime schema/index statement execution, and
  default role seeding now use named direct-loop helpers instead of callback
  chains. Statement translation, transaction boundaries, runtime DDL order,
  default organization/bootstrap behavior, and role seed updates remain
  unchanged.

Move 437 status:
- Move 437 tightens small route predicate helpers in
  `backend/src/routes/branches.ts`, `backend/src/routes/inventory.js`,
  `backend/src/routes/portal.js`, `backend/src/routes/settings.ts`, and
  `backend/src/routes/sync.ts`. Paged branch-stock query detection, inventory
  stats filter detection, portal AI profile preference checks, suspicious brand
  option checks, sync conflict detection, and replay success checks now use
  named direct-loop helpers instead of callback predicates. Route registration,
  validation messages, conflict status codes, and offline replay behavior
  remain unchanged.

Move 438 status:
- Move 438 tightens upload reference cleanup in
  `backend/src/uploadReferenceCleanup.ts`. Settings, product image, product,
  user avatar, file asset, and customer-share screenshot repair passes now use
  direct row loops instead of callback iteration. Sanitization rules,
  gallery-primary fallback behavior, delete-vs-update decisions, summary
  counters, and public cleanup exports remain unchanged.

Move 439 status:
- Move 439 clears the remaining backend source callback-chain scan in
  `backend/src/importCsv.ts`, `backend/src/services/integrationDoctor.ts`, and
  `backend/src/services/googleDriveSync/index.js`. CSV row-content checks,
  integration critical-check aggregation, and Google Drive canonical layout
  detection now use named direct-loop predicates. CSV parsing, Khmer text
  preservation, integration report shape, Drive versioning, mapping reset
  behavior, and sync retention behavior remain unchanged. A backend source scan
  now reports no `map()`, `filter()`, `forEach()`, `reduce()`, `find()`,
  `some()`, `every()`, `flatMap()`, or `Array.from()` hits under
  `backend/src`.

Move 440 status:
- Move 440 starts the frontend test-runner TypeScript conversion. The first
  five focused helper tests now live at `frontend/tests/initials.test.ts`,
  `frontend/tests/groupedRecords.test.ts`,
  `frontend/tests/productGrouping.test.ts`,
  `frontend/tests/productGalleryHelpers.test.ts`, and
  `frontend/tests/portalLanguagePacks.test.ts`. `frontend/tsconfig.json`
  typechecks converted tests, `frontend/package.json` runs the `.ts` files
  directly with Node 24, and `@types/node` is pinned to the Node 24 line. The
  product grouping test also replaces mojibake Khmer fixtures with valid Khmer
  Unicode escapes. This reduces the remaining first-party `.mjs` count while
  keeping the broader test suite on its existing path until each next batch is
  typed, imported, and verified.

Move 441 status:
- Move 441 converts a larger frontend utility-test batch to TypeScript in one
  session. The converted `.ts` tests cover action guards, bounded bulk tasks,
  local date helpers, device metadata headers, timestamp/number formatters,
  history snapshots, loader timeout helpers, navigation config, permission
  parsing, settings conflict diffs, settings refresh routing, storage policy,
  Khmer script typography, product batch previews, and the utils-settings
  barrel wrapper. The batch reduces frontend test `.mjs` files from 71 to 56
  while increasing typed tests from 5 to 20, and it intentionally combines
  related conversion moves so future sessions can make larger verified slices.

Move 442 status:
- Move 442 converts the app-shell/runtime/dashboard/portal test cluster to
  TypeScript in one session. The converted `.ts` tests cover app shell path
  helpers, public DOM recovery, injected-runtime error suppression, section
  navigation, dashboard reliability guards, source asset size budgets, portal
  translation controller DOM behavior, portal content localization, FAQ
  vocabulary fallback, portal editor helpers, and portal catalog display
  helpers. Frontend tests now stand at 45 `.mjs` and 31 `.ts`, and the batch
  deliberately merges small conversion moves while keeping each harness typed,
  directly executable, and covered by the frontend utility suite.

Move 443 status:
- Move 443 converts the product, POS, and scanner helper test cluster to
  TypeScript in one session. The converted `.ts` tests cover product filtering,
  selection, grouped-card summaries, row display state, export/filter menus,
  write payloads, restore ordering, page helper normalization, POS grouping and
  price-mode identity, scanner presentation state, Scanbot mode choice, and
  image barcode scanning. Frontend tests now stand at 33 `.mjs` and 43 `.ts`,
  and the batch keeps fake DOM/scanner fixtures typed without relaxing strict
  compiler checks.

Move 444 status:
- Move 444 converts the import, CSV, export, and refresh test cluster to
  TypeScript in one session. The converted `.ts` tests cover CSV decoding and
  Khmer preservation, product import planning and worker fallback, contact,
  inventory, and sales import row-count workers, media upload reducer state,
  export package/zip fallback behavior, import-completion refresh channels,
  and app refresh events. Frontend tests now stand at 23 `.mjs` and 53 `.ts`,
  and the batch keeps fake browser-event globals and intentionally malformed
  import fixtures typed without relaxing strict compiler checks.

Move 445 status:
- Move 445 converts the layout, receipt, permission, product UX, inventory
  movement, pricing/contact, notification, and scroll test cluster to
  TypeScript in one session. The converted `.ts` tests cover Returns layout,
  notification badge persistence, inventory mobile cards and movement groups,
  product/POS pagination and discount surfaces, permission labels, receipt
  template/settings/print behavior, pricing/contact helpers, and global scroll
  targeting. Frontend tests now stand at 11 `.mjs` and 65 `.ts`, with helper
  assertions pointed at TypeScript implementations where wrappers already
  exist.

Move 446 status:
- Move 446 converts the frontend build configuration from `.mjs` to
  TypeScript. `frontend/vite.config.ts` and `frontend/tailwind.config.ts` are
  now the canonical config files, and `frontend/tsconfig.json` typechecks
  them. The Vite config owns the PostCSS pipeline directly, avoiding a new
  `ts-node` dependency for CSS builds. The Vite manual chunk map no longer
  points at retired `.mjs` helper wrappers, Tailwind no longer scans `.mjs`
  source globs, and the runtime dependency/performance guard scripts now
  verify the `.ts` config paths.

Move 447 status:
- Move 447 converts the schema primary-key preflight entrypoint to TypeScript.
  `ops/scripts/backend/schema-primary-key-preflight.ts` keeps the same
  read-only Docker `psql` behavior and npm command names, but now carries typed
  argument parsing, table-result payloads, and summary output. Backend
  automation tests and the language/runtime audit now point at the `.ts`
  entrypoint.

Move 448 status:
- Move 448 converts the storage readiness and restore verification entrypoints
  to TypeScript. `ops/scripts/runtime/storage/dataset-readiness.ts`,
  `restore-candidates.ts`, and `restore-rehearsal.ts` preserve their npm
  command names while adding typed argument, business-count, backup-package,
  and Docker option shapes. `post-live-hygiene.ts` now calls the TypeScript
  dataset readiness script.

Move 449 status:
- Move 449 converts the local smoke check entrypoints for route contracts and
  post-start diagnostics to TypeScript. `check-route-contract.ts` and
  `post-start-diagnostics.ts` keep the same CLI behavior and JSON diagnostics
  output while updating `run/verify-local.bat`, runtime/release PowerShell
  launchers, dependency/release guardrails, and backend full-automation tests
  to the new paths.

Move 450 status:
- Move 450 converts the action-history undo/redo live audit to TypeScript.
  `action-history-undo-redo-check.ts` keeps the same login, create, undo,
  redo, history visibility, and cleanup postcheck behavior while adding typed
  session, response, cleanup, and report contracts. Full automation, Docker
  release guardrails, and the `action-history:check` package script now point
  at the TypeScript entrypoint.

Move 451 status:
- Move 451 converts the Phase 29 architecture audit entrypoints to TypeScript.
  `generated-bulk-audit.ts`, `organization-audit.ts`,
  `language-runtime-audit.ts`, and `phase29-audit.ts` now own the generated
  bulk, organization, language/runtime, and repeated audit orchestration paths.
  Package scripts, full automation, backend guardrails, and the Phase 29 child
  process list now call the TypeScript entrypoints while retaining direct
  Node execution and bounded audit concurrency.

Move 452 status:
- Move 452 converts the Cloudflare runtime operations to TypeScript.
  `rotate-cloudflare-tunnel-token.ts`, `update-cloudflare-tunnel-origin.ts`,
  `verify-cloudflare-automation.ts`, and `verify-r2-object-store.ts` keep the
  same Cloudflare API, tunnel origin, Access/WAF, token rotation, and R2
  verification behavior while the run wrappers, full automation, hardening
  policy, and Docker release guardrail move to the TypeScript paths.

Move 453 status:
- Move 453 converts the storage cleanup and retention entrypoints to
  TypeScript. `cleanup-test-data.ts`, `cleanup-integrity-backlog.ts`,
  `post-live-hygiene.ts`, and `prune-storage.ts` keep the same QA residue
  cleanup, generated integrity cleanup, post-live hygiene, runtime report
  pruning, and local/R2 backup retention behavior while ops package scripts,
  full automation, smoke/audit cleanup callers, Docker release guardrails, and
  backend automation tests move to the TypeScript paths.

Move 454 status:
- Move 454 converts runtime smoke entrypoints to TypeScript.
  `check-public-url.ts` keeps the same local/public URL and optional public
  ingress probes, while `live-smoke.ts` keeps the same authenticated
  product/inventory/sale/return flow and finally-scoped cleanup. Start-server
  wrappers, backend `verify:live-smoke`, Docker release guardrails, and backend
  automation tests now point at the TypeScript smoke paths.

Move 455 status:
- Move 455 converts the shared live-audit helper modules to TypeScript.
  `audit-auth.ts`, `audit-manifest.ts`, and `audit-report-html.ts` now carry
  typed session, storage-state, manifest route, profile, report-summary, and
  audit-row contracts. The Phase 8.4 focused live checks, deep live audit,
  full-app audit, browser-action smoke, action-history undo/redo check, and
  backend full-automation source assertions now import the TypeScript helpers
  directly, reducing the remaining `.mjs` surface without changing live audit
  behavior.

Move 456 status:
- Move 456 converts the shared Phase 8.4 live-check utility helper to
  TypeScript. `live-check-utils.ts` now owns typed fetch/read helpers, console
  collection, observed-request status lookup, read-response waits, and modal
  close behavior for the route-specific live checks. This keeps the repeated
  Playwright checks on one typed helper path before the individual live-check
  entrypoints are converted.

Move 457 status:
- Move 457 converts the Phase 8.4 live-suite orchestrator to TypeScript.
  `phase84-live-suite.ts` keeps the same ordered UI/public/hygiene execution
  model and package script while adding typed CLI options, suite-step records,
  child report summaries, skipped-step handling, and workspace-safe report
  output. This leaves the large route-specific Playwright entrypoints as the
  remaining Phase 8.4 `.mjs` conversion surface.

Move 458 status:
- Move 458 converts the public Cloudflare portal live check to TypeScript.
  `phase84-public-portal-cloudflare-check.ts` preserves the remote portal
  render, API status, CSP, response, console, page-error, and screenshot
  assertions while adding typed portal check/report shapes. The Phase 8.4
  suite now calls the TypeScript public portal check directly.

Move 459 status:
- Move 459 converts the manifest-driven browser action smoke audit to
  TypeScript. `browser-action-smoke.ts` keeps the same route navigation,
  search, button, menu, dialog, screenshot, and HTML report behavior while
  adding typed profile, route, summary, health, action, finding, navigation,
  and console-entry records. The ops package command now calls the TypeScript
  entrypoint directly.

Move 460 status:
- Move 460 converts the focused product lookup live checks to TypeScript.
  `phase84-product-categories-actions-live-check.ts`,
  `phase84-product-units-actions-live-check.ts`, and
  `phase84-product-brands-actions-live-check.ts` preserve the product Manage
  modal, lookup usage, action-history, row controls, screenshot, and console
  assertions while adding typed health, console-entry, observed-request, and
  request-context shapes.

Move 461 status:
- Move 461 converts the Branch, Contacts, and Users focused live checks to
  TypeScript. `phase84-branches-actions-live-check.ts`,
  `phase84-contacts-live-check.ts`, and
  `phase84-users-actions-live-check.ts` preserve add/edit/transfer,
  customer/supplier/delivery/import, and user/role/password modal workflows
  while adding typed health, console-entry, observed-request, and user-record
  shapes.

Move 462 status:
- Move 462 converts the focused product action live checks to TypeScript.
  `phase84-product-page-actions-live-check.ts`,
  `phase84-product-scanning-actions-live-check.ts`,
  `phase84-product-stock-actions-live-check.ts`, and
  `phase84-product-variant-actions-live-check.ts` preserve add-product,
  action menu, delete-confirm dismissal, manual barcode, bulk stock, branch
  stock, and variant modal workflows while adding typed health, console-entry,
  observed-request, dialog, and Playwright page shapes.

Move 463 status:
- Move 463 converts the Library, Inventory, and Sales focused live checks to
  TypeScript. `phase84-files-providers-actions-live-check.ts`,
  `phase84-inventory-actions-live-check.ts`, and
  `phase84-sales-actions-live-check.ts` preserve provider management,
  inventory adjust/transfer/move/batch controls, and sales bulk/detail
  workflows while adding typed health, console-entry, observed-request,
  provider response, sale candidate, and Playwright page shapes.

Move 464 status:
- Move 464 converts the broad Phase 8.4 UI live check to TypeScript.
  `phase84-ui-live-check.ts` preserves the route-suite dashboard,
  notification, branch stock, sales, product, portal, POS, inventory,
  contacts, loyalty, users, profile, audit/settings, backup, and sync-server
  probes while `phase84-live-suite.ts` now points at the TypeScript entrypoint.

Move 465 status:
- Move 465 converts the full app audit to TypeScript. `full-app-audit.ts`
  preserves the HTML route, API read, FEFO, import, file, backup, cleanup,
  remote public, health, and HTML-report audit flow while Docker release
  verification, backend source assertions, and the deep live audit launcher now
  reference the TypeScript entrypoint.

Move 466 status:
- Move 466 converts the deep live audit to TypeScript. `deep-live-audit.ts`
  preserves the route profiling, browser interaction, remote read-only,
  full-app audit launch, Docker log scan, baseline comparison, and HTML-report
  flow while the ops package command now references the TypeScript entrypoint.

Move 467 status:
- Move 467 converts ops verification guardrails to TypeScript.
  `verify-backup-reliability.ts`, `verify-docker-release.ts`,
  `verify-hardening-policy.ts`, `verify-runtime-deps.ts`,
  `verify-scale-services.ts`, and `verify-secret-hygiene.ts` preserve Docker,
  runtime dependency, hardening policy, backup reliability, scale-service, and
  secret hygiene verification while run wrappers, full automation, Phase 29,
  backend source assertions, and generated audits reference the TypeScript
  entrypoints.

Move 468 status:
- Move 468 converts docs and frontend verification utilities to TypeScript.
  `generate-doc-reference.ts`, `generate-full-project-docs.ts`,
  `performance-scan.ts`, `verify-i18n.ts`, `verify-ui.ts`, and
  `verify-performance.ts` preserve reference generation, performance scan,
  i18n, UI, and performance checks while frontend package scripts, Phase 29,
  runtime dependency guards, docs, and backend source assertions now reference
  the TypeScript entrypoints. The converted i18n verifier also closed the
  missing Khmer branch stat/detail keys it exposed.

Move 469 status:
- Move 469 converts the shared ops script helper layer to TypeScript.
  `ops/scripts/lib/fs-utils.ts` and `ops/scripts/lib/report-utils.ts`
  replace their `.js` entrypoints and are referenced by architecture audits,
  docs generation, frontend verifiers, runtime Cloudflare/audit-report helpers,
  backend full automation assertions, and verification guardrails. Because the
  current ops runner executes `.ts` files directly with Node/CommonJS, these
  helpers preserve runtime-compatible JavaScript syntax and add JSDoc type
  contracts around filesystem walking, bounded parallel mapping, JSON reads,
  Markdown tables, digest summaries, output tailing, and byte formatting. A
  later runner move can promote those boundaries to native TypeScript syntax
  once package scripts use a compiled or `tsx` execution path.

Move 470 status:
- Move 470 converts the backend ops audit entrypoints to TypeScript.
  `ops/scripts/backend/schema-audit.ts` and
  `ops/scripts/backend/verify-data-integrity.ts` replace their `.js`
  entrypoints. Phase 29, backend package verification scripts,
  post-live-hygiene, schema docs, language/runtime audit proof references, and
  backend full automation assertions now reference the TypeScript paths. This
  keeps the schema and data-integrity loop on the direct Node/CommonJS path
  while removing two more JavaScript source entrypoints from the recurring
  verification surface.

Move 471 status:
- Move 471 converts the first backend utility test tranche to TypeScript.
  `backupDefaultDestination.test.ts`, `productSearchPagination.test.ts`,
  `initials.test.ts`, `idempotency.test.ts`, `permissionPolicy.test.ts`,
  `portalUtils.test.ts`, `importJobPerformanceHardening.test.ts`,
  `netSecurity.test.ts`, `analyticsRuntime.test.ts`, and
  `integrationDoctor.test.ts` replace their `.js` test entrypoints. The
  backend `test:utils` command and language/runtime proof references now call
  the TypeScript paths, keeping production backend runtime files stable while
  reducing the remaining JavaScript test surface.

Move 472 status:
- Move 472 converts the second backend utility test tranche to TypeScript.
  `runtimeVersion.test.ts`, `postgresCutoverReadiness.test.ts`,
  `fileAssetStorageReconcile.test.ts`, `uploadSecurity.test.ts`,
  `rfidRoutes.test.ts`, `inventorySettingsMediaContracts.test.ts`,
  `runtimeCache.test.ts`, `authOtpGuards.test.ts`, `productExpiry.test.ts`,
  `productImportPolicies.test.ts`, `importScaleSmoke.test.ts`,
  `contactOptions.test.ts`, `dataPath.test.ts`, `importCsv.test.ts`, and
  `offlineSecurity.test.ts` replace their `.js` test entrypoints. Backend
  `test:utils` and the language/runtime proof matrix now reference the
  TypeScript paths; production backend runtime files and release packaging are
  intentionally unchanged in this test-only conversion batch.

Move 473 status:
- Move 473 converts the third backend utility test tranche to TypeScript.
  `backupRetention.test.ts`, `notificationSummaryCache.test.ts`,
  `systemJobs.test.ts`, `postgresQueryCompat.test.ts`,
  `portalInventoryRegression.test.ts`, `ownedGoogleAuth.test.ts`,
  `productBatchHierarchy.test.ts`, `backupSchema.test.ts`,
  `schemaMetadata.test.ts`, `mediaOptimization.test.ts`,
  `postgresDatabase.test.ts`, and `googleDriveSyncVersioning.test.ts` replace
  their `.js` test entrypoints. The backend `test:utils` command and
  language/runtime proof references now call the TypeScript paths, keeping the
  production runtime and release packaging unchanged.

Move 474 status:
- Move 474 converts the remaining non-fullAutomation backend tests to
  TypeScript. `fileAssetUsageCache.test.ts`, `accessControl.test.ts`,
  `defaultRoles.test.ts`, `settingsSnapshotObjectStorage.test.ts`,
  `importDecisionIntegrity.test.ts`, `backupPerformanceHardening.test.ts`,
  `fileRouteSecurityFlow.test.ts`, `routeContracts.test.ts`,
  `serverUtils.test.ts`, `branchStockSearch.test.ts`,
  `authSecurityFlow.test.ts`, and `importJobStateMachine.test.ts` replace
  their `.js` entrypoints. The backend `test:utils` suite passed with the
  converted files. Standalone live/security/state-machine harnesses remain
  gated by their existing runtime prerequisites (`DATABASE_URL`,
  pg-native/libpq, or a live server), so this move records those as residual
  environment requirements rather than source-conversion failures.

Move 475 status:
- Move 475 converts the backend full automation guardrail test to TypeScript.
  `backend/test/fullAutomation.test.ts` replaces the last `.js` file in
  `backend/test`, and the backend `test:utils` command plus language/runtime
  proof references now call the TypeScript path. This closes the backend test
  directory conversion without changing backend production runtime packaging.

Move 476 status:
- Move 476 retires four tiny frontend utility compatibility wrappers after
  callers moved to TypeScript source imports. `appRefresh.ts`,
  `settingsRefresh.ts`, `publicAssetUrls.ts`, and `favicon.ts` now serve
  React, API, media, product-gallery, and settings callers directly, while
  `appRefresh.js`, `settingsRefresh.js`, `publicAssetUrls.js`, and
  `favicon.js` plus obsolete declaration shims are removed.

Move 477 status:
- Move 477 retires seven leaf frontend utility wrappers after callers moved to
  TypeScript source imports. `color.ts`, `dateHelpers.ts`, `deviceInfo.ts`,
  `formatters.ts`, `mediaUpload.ts`, `permissions.ts`, and
  `scriptTypography.ts` now serve callers directly, while their one-line `.js`
  wrappers are removed.

Move 478 status:
- Move 478 retires seven frontend shared/runtime/config wrappers after exact
  caller rewrites. `globalScroll.ts`, `navigationConfig.ts`, `pageActivity.ts`,
  root `constants.ts`, `clientRuntime.ts`, and receipt settings
  `constants.ts`/`template.ts` now serve direct TypeScript imports, while the
  matching one-line `.js` wrappers are removed.

Move 479 status:
- Move 479 retires six frontend helper/barrel wrappers after exact caller and
  test rewrites. `contactOptionUtils.ts`, `customerMembershipNumber.ts`,
  `movementGroups.ts`, dashboard `charts/index.ts`,
  `utils-settings/index.ts`, and `utils-settings/settingsConflict.ts` now serve
  direct TypeScript imports, while the matching one-line `.js` wrappers are
  removed.

Move 480 status:
- Move 480 retires seven frontend utility/export wrappers after exact caller
  rewrites. `csv.ts`, `csvImport.ts`, `exportPackage.ts`,
  `importJobRefresh.ts`, `pricing.ts`, `printReceipt.ts`, and `utils/index.ts`
  now serve direct TypeScript imports, while the matching one-line `.js`
  wrappers and obsolete `csv.d.ts`/`pricing.d.ts` shims are removed.

Move 481 status:
- Move 481 retires the frontend API/bootstrap wrappers after exact caller
  rewrites. `api/http.ts`, `api/websocket.ts`, `api/localDb.ts`, and
  `web-api.ts` now serve direct imports, while the matching one-line `.js`
  wrappers are removed and runtime dependency verification points at the typed
  HTTP source.

Move 482 status:
- Move 482 opens the strict TSX conversion lane by converting five small
  presentational/context components: POS `ProductImage.tsx`, catalog
  `CatalogPageContext.tsx`, inventory `DualMoney.tsx`, dashboard
  `NoData.tsx`, and receipt-settings `ErrorBoundary.tsx`. The frontend now
  carries real React type packages and the old local hook-only React shim is
  removed, so future JSX-to-TSX moves use the actual React public API.

Move 483 status:
- Move 483 converts the next small shared UI batch to TSX: shared
  `ExportMenu.tsx` and `Modal.tsx`, POS `QuickAddModal.tsx`, sales
  `StatusBadge.tsx`, and dashboard `MiniStat.tsx`. These files now expose
  typed props for menu triggers, quick-add actions, sale-status labels, KPI
  stats, and modal sizing, while replacing a stale mojibake modal close glyph
  with an accessible plain `x`.

Move 484 status:
- Move 484 converts shared preference, loader, header, and section controls to
  TSX. `QuickPreferenceToggles.tsx`, `LoadingWatchdog.tsx`,
  `PageHeader.tsx`, and `SectionSwitcher.tsx` now carry explicit prop types
  and typed app preference/action contracts.

Move 485 status:
- Move 485 prunes generated runtime reports through the retention command and
  records the future-framework guardrail for direct Node config files: keep
  `next.config.mjs` as `.mjs` if a Next.js surface is ever introduced unless
  a production-build proof replaces that rule.

Move 486 status:
- Move 486 converts receipt preview, receipt field panel, filter menu, and
  gallery lightbox surfaces to TSX. The typed boundaries cover receipt
  settings/template data, app translation access, filter sections/options, and
  lightbox navigation callbacks.

Move 487 status:
- Move 487 converts `PortalMenu.tsx`, `ActionHistoryBar.tsx`, and
  `UserDetailSheet.tsx`. The typed contracts cover body-portal menu items,
  undo/redo/server-history rows, admin user filters, user roles, and
  permission boundaries while preserving the current `PermissionEditor.tsx`
  source.

Move 488 status:
- Move 488 converts `PaginationControls.tsx`, `WriteConflictModal.tsx`, and
  dashboard `BarChart.tsx`, `LineChart.tsx`, and `DonutChart.tsx`. The typed
  contracts cover pagination helpers and callbacks, conflict payload rows,
  chart data records, resize refs, hover tooltip state, and SVG event handlers.
  Callers now use extensionless imports for the converted pagination and chart
  modules.

Move 489 status:
- Move 489 converts POS `CartItem.tsx` and `FilterPanel.tsx`, receipt-settings
  `FieldOrderManager.tsx` and `PrintSettings.tsx`, and product shared
  `primitives.tsx`. The typed contracts cover cart line ids, branch/filter
  options, allocation-free filter counting, receipt field drag ordering,
  print-setting persistence, preview refs, product image loading, placeholders,
  margin display, dual-price input, and numeric parsing helpers. Source-reading
  tests now target the TSX paths.

Move 490 status:
- Move 490 converts utility settings `ResetData.tsx`, `OtpModal.tsx`, and
  `FontFamilyPicker.tsx`. The typed contracts cover destructive reset modes,
  factory-reset API fallbacks, action-history payloads, OTP setup/disable
  request state, OTP API payloads, font option records, and settings callbacks.
  The utils-settings barrel now exports the converted TSX modules directly,
  source-reading tests target the TSX paths, and obsolete named `.jsx`
  declaration shims for reset exports were removed.

Move 491 status:
- Move 491 converts product presentation `HeaderActions.tsx` and
  `ProductRowParts.tsx`. The typed contracts cover product header actions,
  export menu entries, translation fallback behavior, product promotions,
  batch preview rows, row action menu callbacks, money formatting, and detail
  pill rendering. The conversion also removes corrupted fallback strings from
  the product header and replaces loose detail-pill filtering with an explicit
  typed accumulator.

Move 492 status:
- Move 492 converts `ProductsListSurface.tsx` and `ProductDetailModal.tsx`.
  The list surface now has typed product section/group contracts, selection
  callbacks, desktop select-all refs, and row/card render callbacks. The detail
  modal now has typed product, color-map, formatter, branch-stock, lightbox,
  and action contracts, with nullable gallery, batch preview, and branch
  quantity values normalized before rendering.

Move 493 status:
- Move 493 converts product stock form leaves `BranchStockAdjuster.tsx` and
  `BulkAddStockModal.tsx`. The branch stock adjuster now has typed row,
  product, user, translation, and adjust-stock payload boundaries. The bulk
  add modal now has typed product selection, branch selection, mutation result,
  and stock API contracts, with product ids, branch ids, and quantities
  normalized before mutation calls.

Move 494 status:
- Move 494 converts product variant creation `VariantFormModal.tsx`. The typed
  boundary now covers parent products, units, branches, users, translation
  fallbacks, mutation responses, and completion snapshots. The conversion also
  restores valid Khmer fallback text, keeps the shared single-action guard and
  loader timeout, and routes the create mutation through a typed app API
  accessor.

Move 495 status:
- Move 495 converts product unit lookup manager `ManageUnitsModal.tsx`. The
  typed boundary now covers unit rows, lookup usage rows, virtual cleanup rows,
  selected ids, app sync context, lookup snapshot APIs, and unit mutation
  results. The conversion keeps bulk delete and undo/redo loops explicit,
  routes unit API calls through a typed accessor, and updates source-reading
  tests to the TSX path.

Move 496 status:
- Move 496 converts product category lookup manager
  `ManageCategoriesModal.tsx`. The typed boundary now covers category rows,
  lookup usage rows, virtual cleanup rows, selected ids, app sync context,
  lookup snapshot APIs, and category mutation results. The conversion keeps
  bulk delete and undo/redo loops explicit, routes category API calls through a
  typed accessor, and updates source-reading tests to the TSX path.

Move 497 status:
- Move 497 converts product brand lookup manager `ManageBrandsModal.tsx`. The
  typed boundary now covers settings-backed brand options, color maps, usage
  rows, review rules, selected-brand sets, lookup snapshot APIs, and the
  settings/product-rewrite mutation surface. The conversion keeps the indexed
  delete-impact path, routes settings plus product brand rewrite calls through
  a typed accessor, and updates source-reading tests to the TSX path.

Move 498 status:
- Move 498 converts product barcode scanner modal `BarcodeScannerModal.tsx`.
  The typed boundary now covers modal props, camera permission states, media
  streams, native `BarcodeDetector`, ZXing reader/controls, file input events,
  scanner labels, and state-badge rendering. The conversion keeps camera,
  manual, and photo scan flows in the browser UI lifecycle and preserves the
  existing scanner presentation helper.

Move 499 status:
- Move 499 converts the main product form `ProductForm.tsx`. The typed boundary
  now covers product form state, save payload normalization, category/unit/
  branch/group candidates, supplier suggestion rows, product image upload API
  responses, the file-picker modal contract, scanner fields, and tab state. The
  conversion keeps multipart File uploads, synchronous upload/save refs,
  scanner modal behavior, branch stock adjustment wiring, and product discount
  preview logic intact.

Move 500 status:
- Move 500 converts the bulk product import modal `BulkImportModal.tsx`. The
  typed boundary now covers product-import rows, existing product candidates,
  conflict groups/subgroups, import job payloads, progress updates, server
  preflight responses, browser/ZIP image maps, file-picker assets, review
  undo snapshots, and bulk decision maps. The conversion keeps the worker-first
  CSV planner plus synchronous fallback, image upload paths, inline review
  editing, and import-job lifecycle intact while moving product import API calls
  behind a typed accessor.

Move 501 status:
- Move 501 converts the catalog shared UI primitives `catalogUi.tsx`. The typed
  boundary now covers portal section shell props, summary metric tile props,
  status pill copy callbacks, stock status strings, tone names, icon component
  props, actions, and children. The conversion keeps the shared catalog
  presentation behavior unchanged while updating UI verification to the TSX
  source path.

Move 502 status:
- Move 502 converts the catalog image field `CatalogImageField.tsx`. The typed
  boundary now covers catalog image labels, values, upload/choose/clear/preview
  callbacks, upload progress state, processing state, cancellation hooks, and
  preview image rendering. The conversion keeps data/blob masking, upload
  status messages, error display, and catalog editor imports unchanged.

Move 503 status:
- Move 503 converts the catalog preview surface `CatalogPreviewSurface.tsx`.
  The typed boundary now covers portal tabs, icon components, display config,
  preview refs, sticky-nav metrics, gallery state, file-picker state,
  translation options, scroll commands, and lazy JSX modal imports. The
  conversion preserves the public preview shell, pinned navigation, translation
  menu, theme toggle, scroll controls, gallery modals, and Vite catalog-preview
  chunk placement.

Move 504 status:
- Move 504 converts branch, return detail, and permission leaves:
  `BranchForm.tsx`, `ReturnDetailModal.tsx`, and `PermissionEditor.tsx`. The
  typed boundaries now cover branch form values and save payloads, return
  records and line items, return scope/currency display, permission sections,
  sensitivity labels, parsed permission state, and change callbacks. The branch
  form also removes the stale visible default-branch helper text, and
  `UserDetailSheet.tsx` imports the TSX permission definitions directly.

Move 505 status:
- Move 505 converts the app entry, inventory RFID surface, and file response
  tab: `index.tsx`, `InventoryRfidSurface.tsx`, and `FilesResponsesTab.tsx`.
  The typed boundaries now cover React root bootstrapping, service-worker
  registration, form-field accessibility wiring, CSSStyleSheet startup-noise
  guards, app/provider JSX shims, RFID gateway/workflow state, section switcher
  contracts, AI response rows, recommendation citations, expansion state, and
  refresh/date callbacks. `index.html`, app-shell tests, and frontend source
  docs now point at the TSX entry path.

Move 506 status:
- Move 506 converts the file picker and branch transfer modals:
  `FilePickerModal.tsx` and `TransferModal.tsx`. The typed boundaries now
  cover file asset rows, media-type filters, upload/delete API calls, selected
  file paths, file-input events, branch options, branch-stock rows, transfer
  mutation payloads, transfer API responses, selected-product state, and
  tracked branch-stock refreshes. Catalog/product modal imports plus stability
  and loading tests now point at the TSX modal paths.

Move 507 status:
- Move 507 converts the standalone export-report renderer to
  `exportReports.tsx`. The typed boundary now covers summary cards, metadata
  groups, chart descriptors, table rows, notes, and report-build options. The
  conversion keeps dynamic report imports extensionless, renders the existing
  dashboard SVG charts through typed component boundaries, and tightens HTML
  escaping for generated self-contained reports.

Move 508 status:
- Move 508 converts the shared notification and background import trackers:
  `NotificationCenter.tsx` and `BackgroundImportTracker.tsx`. The typed
  boundaries now cover notification summary sections/items, tone dictionaries,
  localized copy renderers, visibility state, import-job rows, progress labels,
  import action guards, and API result normalization. The conversion preserves
  app-shell lazy imports and keeps shared background polling/refresh behavior
  unchanged.

Move 509 status:
- Move 509 converts the sales export and import modal cluster:
  `ExportModal.tsx`, `SalesImportModal.tsx`, and `InventoryImportModal.tsx`.
  The typed boundaries now cover export periods/date ranges, sales export
  summaries, status/product breakdown rows, CSV fallback rows, import job
  payloads, CSV dialog results, worker row-count messages, queued import
  results, and app-context notification access. The conversion keeps the
  worker-first import row counting, loader timeouts, synchronous parser
  fallbacks, sales CSV export fallback, and lazy route imports unchanged.

Move 510 status:
- Move 510 converts the contact form and shared contacts surfaces:
  `CustomerFormModal.tsx` and `shared.tsx`. The typed boundaries now cover
  customer form records, structured contact options, save payloads, selection
  sets, selected-snapshot cloning, row action menus, detail modal fields,
  select-all checkbox refs, and generic table/card render callbacks. The
  conversion removes stale exact `.jsx` lazy imports from the customer tab and
  keeps contact pagination, selection cleanup, and mobile/desktop table
  rendering unchanged.

Move 511 status:
- Move 511 converts the contacts page shell to `Contacts.tsx`. The typed
  boundary now covers tab ids/icons, import contact types, import picker state,
  app-context access, lazy supplier/delivery tab modules, contact export API
  calls, ZIP export rows, and paged export response normalization. The move
  keeps customer/supplier/delivery tab behavior, export timeout guards, import
  modal flow, and route-level lazy loading unchanged.

Move 512 status:
- Move 512 converts the contact import modal to `ContactImportModal.tsx`. The
  typed boundary now covers contact import kinds and job types, conflict modes,
  field-rule presets, CSV dialog results, worker row-count messages, file
  picker assets, import job responses, app-context notifications, and queued
  import results. The move keeps the worker-first row counter, synchronous
  parser fallback, stale row-count request guard, and bounded import-job
  create/upload/start calls unchanged.

Move 513 status:
- Move 513 converts the inventory product detail modal to
  `frontend/src/components/inventory/ProductDetailModal.tsx`. The typed
  boundary now covers inventory product rows, branch-stock rows, batch preview
  rows, formatter callbacks, translation callbacks, and stock action callbacks.
  The move keeps stock, price, promotion, performance, branch, and batch
  rendering unchanged while refreshing the Vite manual chunk rule to the
  current TSX product-detail paths.

Move 514 status:
- Move 514 converts the customer edit return modal to
  `frontend/src/components/returns/EditReturnModal.tsx`. The typed boundary now
  covers editable return rows, update payloads, API access, app user context,
  notification callbacks, money coercion, bounded quantity edits, and
  unknown-safe write-conflict handling. The move keeps submit guards, explicit
  update timeout coverage, conflict recovery, and returns/inventory/sales
  refresh events unchanged while updating source-path guard tests.

Move 515 status:
- Move 515 converts the navigation sidebar shell to
  `frontend/src/components/navigation/Sidebar.tsx`. The typed boundary now
  covers app-context navigation state, user/profile fields, settings-driven
  sidebar styles, navigation permission checks, navigation items plus Lucide
  icons, mobile pinned/drawer rows, and page-intent event sources. The move
  keeps desktop, mobile header, bottom bar, drawer, sync status, profile modal,
  and route warmup behavior unchanged while updating performance guards.

Move 516 status:
- Move 516 converts the sales detail modal to
  `frontend/src/components/sales/SaleDetailModal.tsx`. The typed boundary now
  covers sale detail rows, parsed line items, status/membership callbacks,
  print callbacks, money formatters, translation fallback helpers, and
  numeric coercion for totals and item quantities. The move keeps print,
  status update, membership attach, totals, item breakdown, and lazy sales-page
  loading behavior unchanged.

Move 517 status:
- Move 517 converts the files AI providers tab to
  `frontend/src/components/files/FilesProvidersTab.tsx`. The typed boundary now
  covers provider rows, provider status values, provider metadata, provider
  form state, label text, save/test/delete callbacks, and provider-form state
  updates. The move keeps library-provider lazy loading, refresh, edit, test,
  delete, create, save, and bounded action-guard behavior unchanged while
  moving source-path guards to the TSX file.

Move 518 status:
- Move 518 converts the returns list surface to
  `frontend/src/components/returns/ReturnsListSurface.tsx`. The typed boundary
  now covers return records, grouped return sections, selection scope ids,
  checkbox refs, viewport-deferred row/card styles, amount renderers, detail
  callbacks, and breakpoint-gated rendering state. The move keeps desktop
  table rows, mobile cards, collapse toggles, group selection, and returns
  layout guard behavior unchanged.

Move 519 status:
- Move 519 converts the sales list surface to
  `frontend/src/components/sales/SalesListSurface.tsx`. The typed boundary now
  covers sale rows, sale item arrays, grouped sales sections, selection scope
  ids, checkbox refs, money/time formatters, status rendering, branch labels,
  detail callbacks, and reprint callbacks. The move keeps desktop table rows,
  mobile cards, collapse toggles, group selection, revenue footer, and the
  sales page's extensionless import unchanged.

Move 520 status:
- Move 520 converts the supplier return modal to
  `frontend/src/components/returns/NewSupplierReturnModal.tsx`. The typed
  boundary now covers branch rows, supplier rows, inventory product rows,
  settlement methods, selected supplier-return items, app user context,
  notification callbacks, money formatters, and supplier-return API methods.
  The move keeps setup/inventory/create timeouts, stale request invalidation,
  same-tick submit guards, branch-stock quantity clamps, compensation/loss
  calculations, and returns/inventory/products sync events unchanged.

Move 521 status:
- Move 521 converts the customer return modal to
  `frontend/src/components/returns/NewReturnModal.tsx`. The typed boundary now
  covers sale rows, sale item rows, selected return items, previous-return
  rows, create-return payloads, return handling methods, app user context,
  notification callbacks, money formatting, numeric coercion, and return API
  methods. The move keeps sale search/history/create timeouts, stale request
  invalidation, same-tick search and submit guards, quantity clamps, refund
  totals, partial-return indicators, and returns/inventory/sales sync events
  unchanged.

Move 522 status:
- Move 522 converts the receipt overlay to
  `frontend/src/components/receipt/Receipt.tsx`. The typed boundary now covers
  receipt sale payloads, receipt line items, receipt settings, app-context
  formatters/translations, language modes, export modes, row props, section
  maps, numeric coercion, and export root refs. The move keeps POS/Sales
  extensionless lazy imports, ReceiptPreview's bounded dynamic import,
  PDF/print/image actions, receipt template application, Khmer/bilingual
  labels, totals, and receipt settings sync contracts unchanged.

Move 523 status:
- Move 523 converts the receipt settings page to
  `frontend/src/components/receipt-settings/ReceiptSettings.tsx`. The typed
  boundary now covers receipt template state, settings save/load callbacks,
  notification callbacks, app-context settings, auto-save queue options,
  section ids/icons, local section/toggle props, preview refs, and save option
  payloads. The move keeps silent debounced auto-save, manual save feedback,
  timeout-bounded refresh, field order management, print settings, all-fields
  controls, desktop/sidebar preview, mobile preview drawer, and receipt
  settings sync contracts unchanged.

Move 524 status:
- Move 524 converts the custom tables page to
  `frontend/src/components/custom-tables/CustomTables.tsx`. The typed boundary
  now covers custom table metadata, dynamic column schemas, arbitrary custom
  row payloads, typed custom-table API calls, app/sync context access, row
  modal state, row-form values, delete ids, history result extraction, and
  display/input value coercion. The move keeps bounded reads, same-tick table
  and row mutation guards, active-table refresh, dynamic row forms, undo/redo
  row history, and horizontal table scrolling unchanged.

Move 525 status:
- Move 525 converts the catalog products section to
  `frontend/src/components/catalog/CatalogProductsSection.tsx`. The typed
  boundary now covers customer-portal copy helpers, server/local product
  paging, initial filter options, category/brand/branch/stock filters,
  promotion cards, preview config flags, stock/price helper callbacks, gallery
  callbacks, highlight badge rendering, metadata chips, and pagination
  callbacks. The move keeps the CatalogPage extensionless lazy import, Vite
  catalog-preview manual chunk grouping, portal UI verifier coverage,
  customer-safe rendering, promotion cards, and product-gallery entry points
  unchanged.

Move 526 status:
- Move 526 converts the inventory products surface to
  `frontend/src/components/inventory/InventoryProductsSurface.tsx`. The typed
  boundary now covers inventory product rows, branch stock chips, grouped
  section data, group summary callbacks, stock quantity callbacks, selection
  scope toggles, selected product ids, formatter/translator functions,
  injected discount and batch preview components, product detail/adjust
  callbacks, and desktop/mobile reveal gates. The move keeps Inventory's
  extensionless import, grouped desktop table, compact mobile cards,
  indeterminate selection states, stock status badges, price/sales metrics,
  and mobile-card layout guard behavior unchanged.

Move 527 status:
- Move 527 converts the inventory movements surface to
  `frontend/src/components/inventory/InventoryMovementsSurface.tsx`. The typed
  boundary now covers movement records, grouped movement sections, action
  groups, expanded movement page state, movement metadata, action history,
  export menu entries, date-filter callbacks, selection scope toggles,
  selected movement ids, product detail callbacks, and injected pagination
  controls. The move keeps Inventory's extensionless lazy import, mobile
  movement cards, desktop grouped movement table, date range controls,
  selection/export actions, product detail links, and RFID movement guard
  behavior unchanged.

Move 528 status:
- Move 528 converts the loyalty points page to
  `frontend/src/components/loyalty-points/LoyaltyPointsPage.tsx`. The typed
  boundary now covers loyalty settings form state, USD/KHR basis ids, section
  ids, app-context settings/save/notify/format callbacks, local `window.api`
  customer and membership lookup calls, customer point rows, membership lookup
  result totals, copy fallback helpers, error handling, and numeric policy
  coercion helpers. The move keeps the extensionless app lazy import, section
  switcher persistence, loading watchdog retry behavior, bounded customer
  reads, bounded membership lookup, same-tick point-rule save guard, customer
  leaderboard, policy preview, and loading/action/navigation source guards
  behavior unchanged.

Move 529 status:
- Move 529 converts the sync server page to
  `frontend/src/components/server/ServerPage.tsx`. The typed boundary now
  covers sync-server app context access, copy fallbacks, connection info props,
  diagnostics tabs, client/server log rows, write-error events, pending sync
  queue state, system debug payloads, security config, connection test
  results, and the local server API gateway. The move keeps the extensionless
  app lazy import, queue retry/discard same-tick guards, timeout-bounded
  pending queue/config/debug/test calls, sync-center copy, offline-security
  guard coverage, and pending offline-work diagnostics behavior unchanged.

Move 530 status:
- Move 530 converts the returns page shell to
  `frontend/src/components/returns/Returns.tsx`. The typed boundary now covers
  return rows, line-item snapshots, history restore payloads, mutation result
  payloads, app/sync context access, the local return API gateway, selection
  ids, grouped return sections, filter/group/sort state, watchdog timers, and
  export/stat calculations. The move keeps return list/detail/snapshot/restore
  timeouts, same-tick history restore guards, customer/supplier summary math,
  grouped selection helpers, the Returns list-surface lazy import, and layout
  guard behavior unchanged.

Move 531 status:
- Move 531 converts the customers contact tab to
  `frontend/src/components/contacts/CustomersTab.tsx`. The typed boundary now
  covers customer rows, grouped section rows, modal state, app/sync context
  access, local customer API calls, mutation result payloads, exported
  contact-option helpers, filter/group/sort state, watchdog timers,
  undo/redo history payloads, and bulk restore bookkeeping. The move keeps
  the Contacts page import, POS `parseContactOptions` import contract,
  include-points customer loading, grouped selection helpers, same-tick
  save/delete/bulk guards, CSV export, and contact pricing/loading source
  guard behavior unchanged.

Move 532 status:
- Move 532 converts the sales page shell to
  `frontend/src/components/sales/Sales.tsx`. The typed boundary now covers sale
  rows, sale line items, user filter options, app/sync context access, local
  sales API calls, status and membership mutation payloads, grouped sale
  sections, selection ids, export rows, loading watchdog timers, and
  action-history payloads. The move keeps receipt/detail/export/import modal
  lazy imports, same-tick status and bulk guards, bounded user filter reads,
  grouped selection helpers, CSV export, and sales action/performance source
  guard behavior unchanged.

Move 533 status:
- Move 533 converts the delivery contact tab to
  `frontend/src/components/contacts/DeliveryTab.tsx`. The typed boundary now
  covers delivery contact rows, grouped section rows, modal state,
  contact-option payloads, app/sync context access, the local delivery API
  gateway, mutation result payloads, filter/group/sort state, watchdog timers,
  undo/redo history payloads, and bulk restore bookkeeping. The move keeps the
  Contacts page extensionless lazy import, delivery import modal handoff,
  grouped selection helpers, same-tick save/delete/bulk guards, CSV export,
  contact option display, and action/performance source guard behavior
  unchanged.

Move 534 status:
- Move 534 converts the suppliers contact tab to
  `frontend/src/components/contacts/SuppliersTab.tsx`. The typed boundary now
  covers supplier rows, grouped section rows, modal state, contact-option
  payloads, app/sync context access, the local supplier API gateway, mutation
  result payloads, filter/group/sort state, watchdog timers, undo/redo history
  payloads, and bulk restore bookkeeping. The move keeps the Contacts page
  extensionless lazy import, supplier import modal handoff, grouped selection
  helpers, same-tick save/delete/bulk guards, CSV export, supplier contact
  option display, and action/performance source guard behavior unchanged.

Move 535 status:
- Move 535 converts the branches page shell to
  `frontend/src/components/branches/Branches.tsx`. The typed boundary now
  covers branch rows, branch summaries, branch stock page payloads, transfer
  history rows, app/sync context access, the local branch API gateway,
  mutation result payloads, selection ids, tab/modal state, watchdog timers,
  stat detail payloads, and bulk restore bookkeeping. The move keeps the
  extensionless app lazy import, branch list/summary/transfer/stock timeout
  contracts, same-tick save/delete/bulk guards, transfer modal handoff,
  compact three-per-row mobile branch stats, and action/performance source
  guard behavior unchanged.

Move 536 status:
- Move 536 converts the files/library page shell to
  `frontend/src/components/files/FilesPage.tsx`. The typed boundary now covers
  file assets, paged file responses, AI provider metadata, provider forms,
  provider mutation/test results, saved AI responses, app/sync context access,
  the local files API gateway, active tab state, selected asset ids, loading
  request guards, and upload/delete/provider action guards. The move keeps the
  extensionless app lazy import, asset upload/delete timeouts,
  library/provider/response read timeouts, provider undo/redo actions, compact
  mobile asset controls, child tab contracts, and action/performance source
  guard behavior unchanged.

Move 537 status:
- Move 537 converts the login/auth shell to
  `frontend/src/components/auth/Login.tsx`. The typed boundary now covers auth
  users, login results, OAuth callback payloads, organization matches,
  verification capability payloads, password reset responses, app context
  access, the local auth API gateway, OTP pending user ids, DOM refs, form
  submit events, OAuth provider state, and error extraction. The move keeps
  the extensionless app import, owned Google OAuth source checks,
  login/bootstrap/OTP/reset/OAuth flows, session duration persistence, and
  organization selector behavior unchanged.

Move 538 status:
- Move 538 converts the catalog secondary tabs shell to
  `frontend/src/components/catalog/CatalogSecondaryTabs.tsx`. The typed
  boundary now covers portal copy functions, preview config, membership
  customer/points/totals, purchase/return rows, share submission rows,
  submission draft state, business facts, social links, about blocks, FAQ
  items, assistant profile, usage policy, assistant references, assistant
  recommendations, and tab-dispatch props. The move keeps the extensionless
  Catalog page lazy import, catalog preview chunking rule, portal UI verifier
  coverage, membership lookup, About, FAQ, and AI assistant surfaces
  unchanged.

Move 539 status:
- Move 539 converts the users administration shell to
  `frontend/src/components/users/Users.tsx`. The typed boundary now covers
  user rows, role rows, user/role/password form state, app/sync context
  access, the local users API gateway, mutation result payloads, modal/tab
  state, loading watchdog timers, permission maps, and undo/redo payload
  construction. The move keeps the extensionless app lazy import, users/roles
  load timeout contracts, same-tick user/password/role/delete guards, profile
  modal handoff, user detail sheet handoff, and action/performance source
  guard behavior unchanged while tightening shared action-history and
  user-detail nullability types exposed by the conversion.

Move 540 status:
- Move 540 converts the user profile modal to
  `frontend/src/components/users/UserProfileModal.tsx`. The typed boundary now
  covers profile user rows, profile settings, verification capability payloads,
  sign-in method state, profile mutation results, app context access, the local
  profile API gateway, avatar editor props, file input events, OTP modal mode,
  active section state, and stored organization fallback parsing. The move
  removes the temporary profile modal shim from Move 539 and keeps
  the sidebar/profile extensionless import path, profile/OTP/auth-method
  timeout contracts, avatar CORS guardrails, Google OAuth source checks, and
  same-tick profile/password/avatar upload guards unchanged.

Move 541 status:
- Move 541 converts the audit log shell to
  `frontend/src/components/utils-settings/AuditLog.tsx`. The typed boundary
  now covers audit log rows, paged audit responses, audit user filters, app
  context access, the local audit API gateway, detail-row props, export items,
  grouped selection ids, sort/group modes, animation-frame refs, loader
  watchdog refs, and error extraction. The move keeps the extensionless app
  lazy import, utils-settings barrel export, audit read and retention cleanup
  timeout contracts, same-tick retention cleanup guard, grouped selection
  helpers, CSV export behavior, and source guard behavior unchanged while
  making refresh click handling explicit.

Move 542 status:
- Move 542 converts the backup shell to
  `frontend/src/components/utils-settings/Backup.tsx`. The typed boundary now
  covers backup jobs, job metrics/results, integration doctor payloads, Google
  Drive sync status/forms, app context access, action-history rows, the local
  backup API gateway, section ids, action locks, retry timers, job watcher
  handlers, overview cards, and backup/Drive button props. The move keeps the
  extensionless utils-settings barrel export, queued export and restore flows,
  Drive sync action timeouts, cancellable job polling, overview-only default
  section, backup reliability verifier, and source guard behavior unchanged
  while centralizing direct `window.api` backup access behind a typed
  `getBackupApi()` boundary.

Move 543 status:
- Move 543 converts the settings shell to
  `frontend/src/components/utils-settings/Settings.tsx`. The typed boundary
  now covers the settings record shape, app context access, local settings API
  gateway, OTP status reads, image upload payloads/progress, upload controller
  maps, conflict state, color swatches, navigation items, section ids, payment
  method state, and favicon sanitization. The move keeps the extensionless
  utils-settings barrel export, settings save same-tick guard, OTP status
  timeout, favicon preview timeout, image upload timeout,
  cancellation/cleanup behavior, section navigation source checks, and admin
  media guard behavior unchanged while centralizing direct `window.api`
  settings access behind `getSettingsApi()`.

Move 544 status:
- Move 544 converts the dashboard shell to
  `frontend/src/components/dashboard/Dashboard.tsx`. The typed boundary now
  covers dashboard summary and analytics payloads, period/payment/branch/hour
  rows, stock alert products, customer/product/sale detail rows, app/sync
  context access, range and granularity state, chart/top mode unions, KPI
  detail modal payloads, export dependency loading, and the local dashboard API
  gateway. The move keeps the extensionless app lazy import, summary/analytics
  timeout contracts, stale-data handling, compact range/chart controls,
  stock-alert inventory handoff, dashboard export flows, and dashboard source
  guard behavior unchanged while centralizing direct `window.api` dashboard
  reads behind `getDashboardApi()`.

Move 545 status:
- Move 545 converts the app shell to `frontend/src/App.tsx`. The typed
  boundary now covers page ids, lazy route importers, app context access,
  notification payloads, sync/offline event details, pending-sync state,
  app-shell API calls, network-information reads, page-error boundary
  props/state, page slot props, route warmup loaders, timer/idle handles,
  scroll direction, and chunk recovery helpers. The move keeps route chunk
  retry/reload recovery, bounded stale cache deletion, mounted-page retention,
  navigation-intent warmup, offline sale notices, global sync banners, public
  catalog routing, favicon shaping, and app-shell source guard behavior
  unchanged while moving startup imports, focused tests, and performance
  verification to the TSX shell.

Move 546 status:
- Move 546 converts the app context provider to `frontend/src/AppContext.tsx`.
  The typed boundary now covers app settings, authenticated user/session
  payloads, bootstrap organization/system payloads, notification state,
  write-conflict details, sync-channel events, app/sync context values,
  storage helpers, translation packs, permission maps, and the local runtime
  API gateway for bootstrap, auth, settings, Google OAuth, session-duration
  refreshes, public asset URLs, and sync URL updates. The move keeps settings
  and auth timeout contracts, runtime mismatch recovery, Cloudflare Access
  reachability handling, websocket polling, device-local UI settings,
  permission gating, Khmer fallback cleanup, source-inspection tests, and
  receipt/settings save guard behavior unchanged while replacing direct
  `window.api` reads with typed `getAppApi()` gateway calls.

Move 547 status:
- Move 547 converts the POS shell to `frontend/src/components/pos/POS.tsx`.
  The typed boundary now covers POS product rows, grouped product metadata,
  cart lines, open-order state, customer and delivery contacts, contact-option
  selection, membership lookup state, receipt queue entries, image lightbox
  state, app/sync context access, and the local POS API gateway. The move keeps
  catalog/contact/membership/quick-add/checkout timeout contracts, same-tick
  quick-add and checkout guards, cart branch validation, grouped product
  cards, promotion/special price handling, and source guard behavior unchanged
  while centralizing POS runtime calls behind typed `getPosApi()` access.

Move 548 status:
- Move 548 converts the catalog editor surface to
  `frontend/src/components/catalog/CatalogEditorSurface.tsx`. The typed
  boundary now covers the catalog page context value, draft settings record,
  editor sections, recommended-product options, promo/about/FAQ/review rows,
  upload state, preview config, drag/drop ids, media picker/gallery callbacks,
  draft writes, and review submission statuses. The move keeps the
  extensionless catalog lazy import, catalog-editor Vite chunk, portal grid
  source checks, media upload controls, drag/drop reorder flows, review queue
  actions, and public portal editor behavior unchanged while making
  `useCatalogPageContext<T>()` explicit for typed context consumers.

Move 549 status:
- Move 549 converts the products page shell to
  `frontend/src/components/products/Products.tsx`. The typed boundary now
  covers product rows, lookup rows, branch stock rows, filter metadata,
  modal state, search/sort/bulk-edit unions, action-history restore payloads,
  lightbox state, app/sync context access, and the local products API gateway
  for bounded product search, by-id recovery, product writes, stock moves,
  transfers, filter metadata, and image upload. The move keeps the
  extensionless app lazy import, product grouping/pagination helpers, compact
  products controls, undo/redo stock restore flow, same-tick save/delete/bulk
  guards, timeout source checks, product import handoff, detail/lightbox
  modals, and product source-inspection tests unchanged while replacing direct
  `window.api` calls with typed `getProductApi()` access. Product modal
  boundaries now normalize database-ish optional values before rendering, and
  focused source tests were adjusted to verify behavior instead of pre-TS
  syntax. The current source extension count is `.js: 95`, `.jsx: 2`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 268`, `.tsx: 105` outside generated/runtime
  folders.

Move 550 status:
- Move 550 converts the catalog page shell to
  `frontend/src/components/catalog/CatalogPage.tsx`. The typed boundary now
  covers portal config/draft records, product/filter option shapes, portal
  cache payloads, media upload state, file picker state, gallery state,
  Google Translate globals, app/sync context access, and the local catalog API
  gateway for portal bootstrap, metadata, search, AI, media uploads,
  membership lookup, share submissions, and submission review. The move keeps
  catalog lazy chunk imports, portal timeout contracts, bounded screenshot
  reads, customer membership lookup, public portal translation flow, and review
  actions unchanged while replacing direct catalog `window.api` calls with
  `getCatalogApi()`. The current source extension count is `.js: 95`,
  `.jsx: 1`, `.mjs: 0`, `.cjs: 0`, `.ts: 268`, `.tsx: 106` outside
  generated/runtime folders.

Move 551 status:
- Move 551 converts the inventory page shell to
  `frontend/src/components/inventory/Inventory.tsx`. The typed boundary now
  covers inventory products, branch rows, movement rows, saved reasons, stat
  details, batch stock sessions, filter state, RFID status reads, app/sync
  context access, and the local inventory API gateway for bounded stats,
  product, movement, branch, RFID, detail, and stock-mutation calls. The move
  keeps the extensionless app lazy import, inventory surface imports, product
  and movement selection helpers, RFID and import flows, undo/redo stock
  history, loader timeout contracts, same-tick stock mutation guards, and
  source-inspection tests unchanged while replacing direct inventory
  `window.api` calls with `getInventoryApi()`. This completes the frontend
  JSX-to-TSX source lane: the current source extension count is `.js: 95`,
  `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 268`, `.tsx: 107` outside
  generated/runtime folders.

Move 552 status:
- Move 552 converts the frontend domain API registry to
  `frontend/src/api/methods.ts`. The move keeps the lazy `web-api.ts`
  bootstrap contract, source-inspection API tests, offline sync queue,
  backup/import/POS/product gateway behavior, and Vite chunking intact while
  removing the last first-party frontend app `.js` module. Because this file is
  still a large legacy registry with dynamic Dexie tables and broad payload
  shapes, it is marked as a temporary `ts-nocheck` TypeScript boundary; future
  slices should extract typed domain groups from it before removing that
  marker. The current source extension count is `.js: 94`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 269`, `.tsx: 107` outside generated/runtime
  folders.

Move 569 status:
- Move 569 converts `backend/src/permissions.ts` and
  `backend/src/settingsSnapshot.ts` to package-safe TypeScript paths. Permission
  policy now carries JSDoc contracts for permission definitions, default role
  maps, action-history permission mapping, and sensitive-permission checks.
  Settings snapshots now carry JSDoc contracts for upload path normalization,
  object-key projection, media list sanitization, local/object existence
  checks, and settings snapshot sanitization. Middleware, Postgres seeding,
  action-history, auth/catalog/portal/product/settings routes, file assets,
  upload reference cleanup, and focused tests use explicit `.ts` paths.
  Focused permission-policy, settings snapshot object-storage,
  portal-regression, file asset usage/cache, file asset storage/reconcile,
  route-contract, offline-security, and performance verifier checks passed, as
  did the full backend utility suite, schema audit, and Linux packaging proof.
  `pkg` continues to warn for direct `.ts` scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is
  `.js: 64`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 299`, `.tsx: 107` outside
  generated/runtime folders.

Move 553 status:
- Move 553 starts the backend source TypeScript lane by converting
  `backend/src/initials.ts` into a package-safe `.ts` module. The helper now
  carries JSDoc classifier, aggregation row, aggregate result, and Khmer order
  map types while retaining valid JavaScript syntax and the CommonJS export
  shape required by current backend routes. Inventory, portal, products, and
  focused tests import the explicit `.ts` path, and the backend Linux packaging
  script list now includes `src/**/*.ts` alongside remaining JavaScript. The
  focused initials test also uses ASCII Unicode escapes for Khmer assertions so
  the test remains stable across Windows consoles and generated docs. The
  current source extension count is `.js: 93`, `.jsx: 0`, `.mjs: 0`,
  `.cjs: 0`, `.ts: 270`, `.tsx: 107` outside generated/runtime folders.

Move 554 status:
- Move 554 converts two more backend helpers to package-safe TypeScript paths:
  `backend/src/money.ts` and `backend/src/idempotency.ts`. Money normalization
  now carries JSDoc input/output contracts for finite-number coercion,
  round-up decimal handling, and normalized price values; idempotency now
  carries a nullable string return contract for bounded client request ids.
  Product, inventory, sales, returns, import parsing, product discount, import
  job, and focused test imports now point at explicit `.ts` helper paths.
  Focused import/idempotency/route tests, the full backend utility suite, and
  Linux packaging proof passed. `pkg` still warns for backend `.ts` scripts, so
  the next larger backend conversion should add a compile/staging pipeline
  before route/service files use TypeScript-only syntax. The current source
  extension count is `.js: 91`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 272`,
  `.tsx: 107` outside generated/runtime folders.

Move 555 status:
- Move 555 converts `backend/src/authOtpGuards.ts` and
  `backend/src/optionalSharp.ts` to package-safe TypeScript paths. OTP guard
  functions now carry JSDoc actor/target/password contracts while keeping the
  same CommonJS exports for auth routes, and optional Sharp loading now carries
  a typed cached-module boundary while preserving runtime fallback lookup
  order. Auth, upload security, file asset, and focused tests import explicit
  `.ts` paths. Focused auth/upload/media/route tests, the full backend utility
  suite, and Linux packaging proof passed. `pkg` still warns for backend `.ts`
  scripts, so direct TypeScript syntax in larger route/service files remains
  gated on a compile/staging package lane. The current source extension count
  is `.js: 89`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 274`, `.tsx: 107`
  outside generated/runtime folders.

Move 556 status:
- Move 556 converts `backend/src/requestContext.ts` and
  `backend/src/storage/organizationFolders.ts` to package-safe TypeScript
  paths. Request context now carries JSDoc request metadata/header contracts
  while preserving CommonJS middleware exports, and organization folder helpers
  now carry string/path contracts for safe folder labels, public ids, and
  folder lookup. Server, helper, config, and organization-context imports use
  explicit `.ts` paths. Focused server/route/data/runtime/automation tests, the
  full backend utility suite, and Linux packaging proof passed. `pkg` continues
  to warn for direct `.ts` scripts, so larger backend route/service conversion
  still waits for a compile/staging package lane. The current source extension
  count is `.js: 87`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 276`,
  `.tsx: 107` outside generated/runtime folders.

Move 557 status:
- Move 557 converts `backend/src/catalogTextIntegrity.ts` and
  `backend/src/conflictControl.ts` to package-safe TypeScript paths. Catalog
  text integrity now carries JSDoc contracts for normalization options,
  suspicious-field records, and option-list normalization while preserving the
  Khmer/mojibake protection used by products, inventory, settings, imports, and
  runtime checks. Conflict control now carries JSDoc contracts for updated-at
  records and JSON conflict responses while preserving structured
  write-conflict/settings-conflict payloads. Affected route/service imports and
  the settings/media source contract test use explicit `.ts` paths. Focused
  route/import/product/settings tests, the full backend utility suite, and
  Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so larger backend route/service conversion still waits for a
  compile/staging package lane. The current source extension count is `.js: 85`,
  `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 278`, `.tsx: 107` outside
  generated/runtime folders.

Move 558 status:
- Move 558 converts `backend/src/runtimeState/index.ts`,
  `backend/src/maintenanceLock.ts`, and `backend/src/portalUtils.ts` to
  package-safe TypeScript paths. Runtime state now carries JSDoc
  state/descriptor contracts for storage-version state and health/bootstrap
  descriptors. Maintenance lock now carries JSDoc lock/request/response
  contracts for restore/backup write guarding and scoped lock execution.
  Portal utilities now carry about-block contracts while preserving Google Maps
  embed normalization. Server, auth, system, portal, Google Drive sync,
  offline-security, portal utility, and backup-reliability verification imports
  use explicit `.ts` paths. Focused portal/offline/route/runtime/
  backup-reliability checks, the full backend utility suite, and Linux
  packaging proof passed. `pkg` continues to warn for direct `.ts` scripts, so
  larger backend route/service conversion still waits for a compile/staging
  package lane. The current source extension count is `.js: 82`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 281`, `.tsx: 107` outside generated/runtime
  folders.

Move 559 status:
- Move 559 converts `backend/src/workers/importWorker.ts`,
  `backend/src/workers/mediaWorker.ts`, and `backend/src/systemFsWorker.ts` to
  package-safe TypeScript paths. The dedicated import/media worker entrypoints
  now carry JSDoc start/shutdown contracts, and the system filesystem worker now
  carries payload/response contracts for child-process backup export and data
  relocation work. Backend worker npm scripts, server worker-role dispatch, PM2
  config, Docker scale health checks, Windows run scripts, PowerShell runtime
  readiness checks, the system route worker spawn path, and performance
  verification all use explicit `.ts` paths. Focused worker-entrypoint loading,
  system filesystem export smoke, route/full-automation/performance checks, the
  full backend utility suite, and Linux packaging proof passed. `pkg` continues
  to warn for direct `.ts` scripts, so larger backend route/service conversion
  still waits for a compile/staging package lane. The current source extension
  count is `.js: 79`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 284`,
  `.tsx: 107` outside generated/runtime folders.

Move 560 status:
- Move 560 converts `backend/src/contactOptions.ts`,
  `backend/src/productImportPolicies.ts`, and
  `backend/src/productDiscounts.ts` to package-safe TypeScript paths. Contact
  option normalization now carries JSDoc mode/source/normalized-option
  contracts, import policy helpers now carry numeric/flag/field-rule/
  append-unique/image-conflict contracts, and product discount helpers now carry
  discount-source and normalized-discount contracts. Contacts routes,
  product/inventory routes, import-job services, and focused backend tests use
  explicit `.ts` paths. Focused contact/import-policy/route/product/
  import-decision checks, the full backend utility suite, and Linux packaging
  proof passed. `pkg` continues to warn for direct `.ts` scripts, so larger
  backend route/service conversion still waits for a compile/staging package
  lane. The current source extension count is `.js: 76`, `.jsx: 0`, `.mjs: 0`,
  `.cjs: 0`, `.ts: 287`, `.tsx: 107` outside generated/runtime folders.

Move 561 status:
- Move 561 converts `backend/src/schemaMetadata.ts` to a package-safe
  TypeScript path. The shared schema metadata helper now carries JSDoc
  column-row and cache-key helper contracts while preserving cached
  table/column probing. Branch, custom-table, inventory, product, and settings
  routes use explicit `.ts` imports, and the route-contract test now guards
  `schemaMetadata.ts` as the shared probe boundary. Focused schema metadata,
  route-contract, RFID, product-search, and full-automation checks passed, as
  did the full backend utility suite and Linux packaging proof. `pkg` continues
  to warn for direct `.ts` scripts, so larger backend route/service conversion
  still waits for a compile/staging package lane. The current source extension
  count is `.js: 75`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 288`,
  `.tsx: 107` outside generated/runtime folders.

Move 562 status:
- Move 562 converts `backend/src/runtimeVersion.ts` to a package-safe
  TypeScript path. Runtime/build metadata now carries JSDoc runtime and
  frontend build-info contracts, and the source-hash collector now includes
  `.ts` files so converted backend source participates in stale-bundle
  detection. Server startup, runtime routes, Google Drive sync manifests,
  runtime-version tests, and runtime dependency guardrails use explicit `.ts`
  paths. Focused runtime, route-contract, Drive sync, runtime-dependency, and
  full-automation checks passed, as did the full backend utility suite and Linux
  packaging proof. `pkg` continues to warn for direct `.ts` scripts, so larger
  backend route/service conversion still waits for a compile/staging package
  lane. The current source extension count is `.js: 74`, `.jsx: 0`, `.mjs: 0`,
  `.cjs: 0`, `.ts: 289`, `.tsx: 107` outside generated/runtime folders.

Move 563 status:
- Move 563 converts `backend/src/runtimeCache.ts` to a package-safe TypeScript
  path. The Redis-backed runtime cache helper now carries JSDoc cache-status
  and invalidation contracts while preserving safe no-op behavior when disabled
  and ordered prefix invalidation. Portal/runtime routes, shared helper
  invalidation, and runtime cache tests use explicit `.ts` imports. Focused
  runtime-cache, route-contract, portal regression, and full-automation checks
  passed, as did the full backend utility suite and Linux packaging proof.
  `pkg` continues to warn for direct `.ts` scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is `.js: 73`, `.jsx: 0`, `.mjs: 0`,
  `.cjs: 0`, `.ts: 290`, `.tsx: 107` outside generated/runtime folders.

Move 564 status:
- Move 564 converts `backend/src/accessControl.ts` to a package-safe TypeScript
  path. The request access helper now carries JSDoc request/access contracts
  for host, remote address, public API allowlist, legacy Tailscale identity,
  and sync-token presentation behavior. Middleware, auth routes, system routes,
  and access-control tests use explicit `.ts` imports, and a stale unused
  security import was removed from the helper. Focused access-control, auth
  OTP, route-contract, offline-security, and full-automation checks passed, as
  did the full backend utility suite, schema audit, and Linux packaging proof.
  `pkg` continues to warn for direct `.ts` scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is
  `.js: 72`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 291`, `.tsx: 107`
  outside generated/runtime folders.

Move 565 status:
- Move 565 converts `backend/src/backupSchema.ts` to a package-safe TypeScript
  path. The backup schema helper now carries JSDoc row/count/upload summary
  contracts while preserving backup version, backup table coverage, restore
  clear order, non-backup table exclusions, and summary totals. System backup
  routes, backup package services, backup schema tests, schema relationship
  docs, and schema audit source loading use explicit `.ts` paths. Focused
  backup-schema, backup-performance, backup-retention, route-contract,
  schema-audit, and full-automation checks passed, as did the full backend
  utility suite and Linux packaging proof. `pkg` continues to warn for direct
  `.ts` scripts, so larger backend route/service conversion still waits for a
  compile/staging package lane. The current source extension count is `.js: 71`, `.jsx: 0`, `.mjs: 0`,
  `.cjs: 0`, `.ts: 292`, `.tsx: 107` outside generated/runtime folders.

Move 566 status:
- Move 566 converts `backend/src/businessMetrics.ts` to a package-safe
  TypeScript path. The business metrics helper now carries JSDoc metric-row and
  query option contracts while preserving sellable product SQL predicates,
  effective-cost expressions, stock metric aggregation, low/out stock alerts,
  and expiry alert queries. Branch, inventory, notification, product, and sales
  routes use explicit `.ts` imports, and source-inspection tests read the
  TypeScript helper. Focused product-expiry, product-batch hierarchy,
  route-contract, notification-cache, portal-regression, and full-automation
  checks passed, as did the full backend utility suite, schema audit, and Linux
  packaging proof. `pkg` continues to
  warn for direct `.ts` scripts, so larger backend route/service conversion
  still waits for a compile/staging package lane. The current source extension
  count is `.js: 70`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 293`, `.tsx: 107`
  outside generated/runtime folders.

Move 567 status:
- Move 567 converts `backend/src/importCsv.ts` and
  `backend/src/importParsing.ts` to package-safe TypeScript paths. The CSV
  helper now carries JSDoc CSV option/row contracts for delimiter detection,
  row parsing, streaming batch parsing, and key normalization, while the import
  parsing helper carries number option contracts for localized numeric text and
  money normalization. The duplicated `hasDelimitedRowContent` helper was
  removed while preserving behavior. Import-job services, product import
  policies, import CSV tests, import scale smoke tests, and the performance
  verifier use explicit `.ts` paths. Focused import CSV, import-scale,
  import-policy, import-decision, route-contract, performance verifier, and
  full-automation checks passed, as did the full backend utility suite, schema
  audit, and Linux packaging proof. `pkg` continues to warn for direct `.ts`
  scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is `.js: 68`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
  `.ts: 295`, `.tsx: 107` outside generated/runtime folders.

Move 568 status:
- Move 568 converts `backend/src/netSecurity.ts` and
  `backend/src/uploadSecurity.ts` to package-safe TypeScript paths. Network
  security now carries JSDoc URL option contracts for outbound URL validation,
  blocked-host checks, and safe external image references. Upload security now
  carries uploaded-file contracts for buffer kind detection, file-kind
  expectations, image metadata checks, and upload validation. File assets,
  middleware, AI gateway, import jobs, portal/products routes, and focused
  security tests use explicit `.ts` paths. Focused net-security,
  upload-security, route-contract, offline-security, upload-reference,
  import-decision, and performance verifier checks passed, as did the full
  backend utility suite, schema audit, and Linux packaging proof. `pkg`
  continues to warn for direct `.ts` scripts, so
  larger backend route/service conversion still waits for a compile/staging
  package lane. The current source extension count is `.js: 66`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 297`, `.tsx: 107` outside generated/runtime
  folders.

Move 570 status:
- Move 570 converts `backend/src/database.ts` to a package-safe TypeScript
  path. The database entrypoint remains a minimal CommonJS passthrough to the
  Postgres adapter, while the backend server, routes, services, workers,
  source-inspection tests, and docs use explicit `.ts` imports. Focused
  database load, schema-metadata, file-asset usage/cache, route-contract,
  Postgres database, Postgres cutover-readiness, data-path, and performance
  verifier checks are the required proof slice before this move is accepted,
  followed by the full backend utility suite, schema audit, and Linux packaging
  proof. `pkg` continues to warn for direct `.ts` scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is `.js: 63`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
  `.ts: 300`, `.tsx: 107` outside generated/runtime folders.

Move 571 status:
- Move 571 converts `backend/src/analytics/duckdbRuntime.ts` to a package-safe
  TypeScript path. The helper keeps optional DuckDB package probing unchanged
  and adds JSDoc option/probe contracts for analytics runtime diagnostics. The
  backend server, system routes, integration doctor, and analytics runtime test
  use explicit `.ts` imports. Focused helper load, analytics runtime,
  route-contract, and stale-path scans passed, as did the full backend utility
  suite, schema audit, and Linux packaging proof. `pkg` continues to warn for
  direct `.ts` scripts, so larger
  backend route/service conversion still waits for a compile/staging package
  lane. The current source extension count is `.js: 62`, `.jsx: 0`, `.mjs: 0`,
  `.cjs: 0`, `.ts: 301`, `.tsx: 107` outside generated/runtime folders.

Move 572 status:
- Move 572 converts `backend/src/services/googleDriveSync/versioning.ts` to a
  package-safe TypeScript path. The helper keeps version rotation and retention
  behavior unchanged while adding JSDoc input and version item contracts. The
  main Google Drive sync service and focused versioning test use explicit `.ts`
  imports, and older roadmap references were normalized to avoid stale path
  drift. Focused helper load, Google Drive sync versioning, integration-doctor,
  and stale-path scans passed, as did the full backend utility suite, schema
  audit, and Linux packaging proof. `pkg` continues to warn for direct `.ts`
  scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is `.js: 61`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
  `.ts: 302`, `.tsx: 107` outside generated/runtime folders.

Move 573 status:
- Move 573 converts `backend/src/db/cutoverReadiness.ts` to a package-safe
  TypeScript path. The helper keeps the forbidden-pattern and packaged-runtime
  readiness report shape unchanged while adding a JSDoc options contract and
  scanning both `.js` and `.ts` backend source files. System routes, the
  cutover-readiness test, and the Docker release PowerShell verifier use
  explicit `.ts` imports. Focused helper load, Postgres cutover-readiness,
  route-contract, Docker release guardrail, and stale-path scans passed, as did
  the full backend utility suite, schema audit, and Linux packaging proof. `pkg`
  continues to warn for direct `.ts` scripts, so larger backend route/service
  conversion still waits for a
  compile/staging package lane. The current source extension count is
  `.js: 60`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 303`, `.tsx: 107` outside
  generated/runtime folders.

Move 574 status:
- Move 574 converts `backend/src/db/postgresQueryCompat.ts` to a package-safe
  TypeScript path. The helper keeps SQL parameter translation, portable SQL
  normalization, INSERT OR IGNORE conversion, RETURNING behavior, and row
  coercion unchanged while adding a JSDoc translation-options contract. The
  Postgres adapter and focused query compatibility test use explicit `.ts`
  imports, and older roadmap references were normalized to avoid stale path
  drift. Focused helper load, Postgres query compatibility, Postgres database,
  route-contract, and stale-path scans passed, as did the full backend utility
  suite, schema audit, and Linux packaging proof. `pkg` continues to warn for direct `.ts` scripts,
  so larger backend route/service conversion still waits for a compile/staging
  package lane. The current source extension count is `.js: 59`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 304`, `.tsx: 107` outside generated/runtime
  folders.

Move 575 status:
- Move 575 converts `backend/src/dataPath/index.ts` to a package-safe
  TypeScript path. The helper keeps path comparison, data-root layout creation,
  file walking, summarization, copy, archive, and relocation behavior unchanged
  while adding JSDoc contracts for file visitors, summaries, and relocation
  options. Organization context, system routes, Google Drive sync, the system
  filesystem worker, and the focused data-path test now import the explicit
  `dataPath/index.ts` path so directory index resolution is not implicit.
  Focused helper load, data-path, system-jobs, Google Drive sync versioning,
  route-contract, and stale-path scans passed, as did the full backend utility
  suite, schema audit, and Linux packaging proof. `pkg` continues to warn for direct `.ts` scripts,
  so larger backend route/service conversion still waits for a compile/staging
  package lane. The current source extension count is `.js: 58`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 305`, `.tsx: 107` outside generated/runtime
  folders.

Move 576 status:
- Move 576 converts `backend/src/security.ts` to a package-safe TypeScript
  path. The helper keeps secret encryption/decryption fallback, rate limiting,
  timing-safe comparison, and abuse-lock behavior unchanged while adding JSDoc
  contracts for rate-limit and abuse-lock result shapes. Auth, portal, system,
  middleware, AI gateway, and Google Drive sync callers now import the explicit
  `.ts` path. `backend/test/security.test.ts` was added to the backend utility
  suite to protect plaintext fallback, rate-limit blocking/reset, safe
  comparison, and abuse-lock clear behavior directly. Focused security,
  route-contract, offline-security, owned-Google-auth, integration-doctor, and
  stale-path scans passed, as did the full backend utility suite, schema audit,
  and Linux packaging proof. `pkg` continues to warn for direct `.ts` scripts, so larger backend
  route/service conversion still waits for a compile/staging package lane. The
  current source extension count is `.js: 57`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`,
  `.ts: 306`, `.tsx: 107` outside generated/runtime folders.

Move 577 status:
- Move 577 converts `backend/src/routes/organizations.ts` to a package-safe
  TypeScript path. Bootstrap, organization search, and current organization
  context responses remain unchanged while the backend server and
  route-contract tests now import the explicit `.ts` route entrypoint.
  `backend/test/routeContracts.test.ts` asserts the `/bootstrap`, `/search`,
  and `/current` organization routes directly. Focused route contracts,
  organization route load, auth/security-adjacent smoke, and stale-path scans
  passed, as did the full backend utility suite, schema audit, and Linux
  packaging proof. `pkg`
  continues to warn for direct `.ts` scripts, so larger backend route/service
  conversion still waits for a compile/staging package lane. The current source
  extension count is `.js: 56`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 307`,
  `.tsx: 107` outside generated/runtime folders.

Move 578 status:
- Move 578 converts `backend/src/routes/catalog.ts` to a package-safe
  TypeScript path. Internal catalog metadata and product payload responses stay
  unchanged while the backend server imports the explicit `.ts` route
  entrypoint. Backend route docs and `backend/src/routes/README.md` now point
  at the TypeScript path, and `backend/test/routeContracts.test.ts` asserts the
  `/meta` and `/products` catalog routes directly. Focused route-contract,
  catalog route load, backend utility, schema audit, stale-path, and Linux
  packaging proof passed. `pkg` continues to warn for direct `.ts` scripts, so
  larger backend route/service conversion still waits for a compile/staging
  package lane. The current source extension count is
  `.js: 55`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 308`, `.tsx: 107` outside
  generated/runtime folders.

Move 579 status:
- Move 579 converts `backend/src/websocket.ts` to a package-safe TypeScript
  path. The shared `attachWss()` server hook, origin/session checks,
  per-connection rate-limit counters, ping/pong response, and `wss_clients`
  boundary remain unchanged while `backend/server.js` imports the explicit
  `.ts` entrypoint. `backend/test/websocket.test.ts` now guards the exported
  server hook and is part of backend `test:utils`. Focused WebSocket module
  load, server utility, backend utility, schema audit, stale-path, and Linux
  packaging proof passed. `pkg` continues to warn for direct `.ts` scripts, so
  larger backend route/service conversion still waits for a compile/staging
  package lane. The current source extension count is
  `.js: 54`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 309`, `.tsx: 107` outside
  generated/runtime folders.

Move 580 status:
- Move 580 converts `backend/src/routes/runtime.ts` to a package-safe
  TypeScript path. Runtime version, queue/cache status, and catalog-integrity
  diagnostics remain unchanged while `backend/server.js` imports the explicit
  `.ts` route and `ops/scripts/verification/verify-runtime-deps.ts` verifies
  the current route file. `backend/test/routeContracts.test.ts` now asserts
  `/version`, `/queues/status`, and `/catalog-integrity` registration directly.
  Focused route-contract, runtime route load, runtime-deps guardrail, backend
  utility, schema audit, stale-path, and Linux packaging proof passed. `pkg`
  continues to warn for direct `.ts` scripts, so larger backend route/service
  conversion still waits for a compile/staging package lane. The current source
  extension count is `.js: 53`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 310`, `.tsx: 107` outside generated/runtime
  folders.

Move 581 status:
- Move 581 converts `backend/src/routes/notifications.ts` to a package-safe
  TypeScript path. Notification summary cache behavior, effective-permission
  cache keys, inventory/expiry/sales/loyalty/portal/system section builders,
  and the `_test` cache hook remain unchanged while `backend/server.js` imports
  the explicit `.ts` route. The notification summary separator now uses a
  plain ASCII separator to avoid glyph/encoding drift in generated labels.
  `backend/test/notificationSummaryCache.test.ts`,
  `backend/test/productExpiry.test.ts`, and
  `backend/test/routeContracts.test.ts` now cover the TypeScript route.
  Focused notification cache, product-expiry, route-contract, backend utility,
  schema audit, stale-path, and Linux packaging proof passed. `pkg` continues
  to warn for direct `.ts` scripts, so larger backend route/service conversion
  still waits for a compile/staging package lane. The current source extension
  count is `.js: 52`, `.jsx: 0`,
  `.mjs: 0`, `.cjs: 0`, `.ts: 311`, `.tsx: 107` outside generated/runtime
  folders.

Move 582 status:
- Move 582 converts `backend/src/routes/files.ts` to a package-safe TypeScript
  path. File listing, upload, media optimization enqueueing, write-conflict
  delete handling, rate limiting, synchronous image compression, and upload
  validation remain unchanged while `backend/server.js` imports the explicit
  `.ts` route. The hardening policy and media contract tests now point at the
  TypeScript path, and `backend/test/routeContracts.test.ts` asserts list,
  upload, and delete route registration directly. Focused route-contract,
  media-contract, route-load, backend utility, schema audit, stale-path, and
  Linux packaging proof passed. The older temp-server file-route flow remains
  environment-blocked in this shell because the Postgres-only runtime needs the
  native libpq bridge available inside the scaled runtime container. `pkg`
  continues to warn for direct `.ts` scripts, so larger backend route/service
  conversion still waits for a compile/staging package lane. The current source
  extension count is `.js: 51`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 312`,
  `.tsx: 107` outside generated/runtime folders.

Move 583 status:
- Move 583 converts `backend/src/routes/categories.ts` to a package-safe
  TypeScript path. Category list/create/update/delete behavior, catalog text
  integrity checks, merge-on-duplicate rename, product category rewrites,
  write-conflict handling, audit entries, and sync broadcasts remain unchanged
  while `backend/server.js` imports the explicit `.ts` route. Backend route docs
  and the route folder guide now point at the TypeScript path, and
  `backend/test/routeContracts.test.ts` asserts category CRUD route
  registration directly. Focused route-contract, category route-load, backend
  utility, schema audit, stale-path, and Linux packaging proof passed. `pkg`
  continues to warn for direct `.ts` scripts, so larger backend route/service
  conversion still waits for a compile/staging package lane. The current source
  extension count is `.js: 50`, `.jsx: 0`, `.mjs: 0`, `.cjs: 0`, `.ts: 313`,
  `.tsx: 107` outside generated/runtime folders.

Move 584 status:
- Move 584 converts `backend/src/routes/units.ts` to a package-safe TypeScript
  path. Unit list/create/update/delete behavior, catalog text integrity checks,
  merge-on-duplicate rename, product unit rewrites, write-conflict handling,
  audit entries, and sync broadcasts remain unchanged while
  `backend/server.js` imports the explicit `.ts` route. Backend route docs and
  the route folder guide now point at the TypeScript path, and
  `backend/test/routeContracts.test.ts` asserts unit CRUD route registration
  directly. Focused route-contract, unit route-load, backend utility, schema
  audit, stale-path, and Linux packaging proof passed. `pkg` continues to warn
  for direct `.ts` scripts, so larger backend route/service conversion still
  waits for a compile/staging package lane. The generated language audit now
  reports `JavaScript: 38`, `TypeScript: 273`, and `React TSX: 107` across the
  active scan roots.

Move 585 status:
- Move 585 converts `backend/src/routes/settings.ts` to a package-safe
  TypeScript path. Settings read/write, metadata, brand option normalization,
  write-conflict responses, snapshot sanitation, audit entries,
  upload-reference reconcile scheduling, and sync broadcasts remain unchanged
  while `backend/server.js` imports the explicit `.ts` route. Backend route
  docs and the route folder guide now point at the TypeScript path, and the
  route-contract and media/settings contract tests read the TypeScript source.
  Focused route-contract, settings/media contract, settings route-load, backend
  utility, schema audit, stale-path, and Linux packaging proof passed. `pkg`
  continues to warn for direct `.ts` scripts, so larger backend route/service
  conversion still waits for a compile/staging package lane. The generated
  language audit now reports `JavaScript: 37`, `TypeScript: 274`, and
  `React TSX: 107` across the active scan roots.

Move 586 status:
- Move 586 converts `backend/src/sessionAuth.ts` to a package-safe TypeScript
  path. Cookie-only session transport, session expiry selection, secure-cookie
  detection, token hashing, presented cookie parsing, session lookup, last-seen
  updates, session revocation, and user-session revocation remain unchanged on
  the existing CommonJS helper style. Middleware, WebSocket, auth route, user
  route, offline security tests, and the hardening policy now point at the
  explicit `.ts` helper. Focused session helper load, offline security,
  WebSocket, route-contract, backend utility, schema audit, stale-path, and
  Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The generated language audit now reports `JavaScript: 36`,
  `TypeScript: 275`, and `React TSX: 107` across the active scan roots.

Move 587 status:
- Move 587 converts `backend/src/services/mediaQueue.ts` to a package-safe
  TypeScript path. BullMQ initialization, Redis connection probing,
  cancellation-aware media optimization, import-file status updates, local
  fallback execution, enqueueing, worker startup, and queue status reporting
  remain unchanged on the existing CommonJS service style. Runtime, file upload,
  import job, media worker, and import job state-machine callers now point at
  the explicit `.ts` service. Focused media queue load, import job
  state-machine, route-contract, backend utility, schema audit, stale-path, and
  Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The generated language audit now reports `JavaScript: 35`,
  `TypeScript: 276`, and `React TSX: 107` across the active scan roots.

Move 588 status:
- Move 588 converts `backend/src/organizationContext/index.ts` to a
  package-safe TypeScript path. Organization lookup, search, group lookup, user
  context joins, portal public path construction, organization filesystem layout
  creation, metadata file writing, and storage alignment status reporting
  remain unchanged on the existing CommonJS helper style. Auth, organizations,
  portal, users, and system routes now require the explicit `.ts` index so
  directory resolution does not depend on the retired `index.js` file. Focused
  organization helper load, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 34`, `TypeScript: 277`, and `React TSX: 107` across the active
  scan roots.

Move 589 status:
- Move 589 converts `backend/src/uploadReferenceCleanup.ts` to a package-safe
  TypeScript path. Sync and async settings, product-image,
  product-primary-image, user-avatar, file-asset, and portal-submission media
  reference repair behavior remain unchanged on the existing CommonJS helper
  style. File asset warmup/reconcile callers and focused
  object-storage/source-contract tests now point at the explicit `.ts` helper.
  Focused upload-reference repair, portal inventory regression, upload helper
  load, backend utility, schema audit, stale-path, and Linux packaging proof
  passed. `pkg` continues to warn for direct `.ts` scripts, so broader backend
  conversions still wait for a compile/staging package lane. The generated
  language audit now reports `JavaScript: 33`, `TypeScript: 278`, and
  `React TSX: 107` across the active scan roots.

Move 590 status:
- Move 590 converts `backend/src/services/verification.ts` to a package-safe
  TypeScript path. Verification capability reporting, email/phone
  normalization, destination masking, disabled-code request responses, and
  active-code verification helpers remain unchanged on the existing CommonJS
  service style. Auth and users routes now point at the explicit `.ts` service,
  and the backend service index doc names the TypeScript file. Focused
  verification helper load, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 32`, `TypeScript: 279`, and `React TSX: 107` across the active
  scan roots.

Move 591 status:
- Move 591 converts `backend/src/services/googleOauth.ts` to a package-safe
  TypeScript path. Google login public config, return-target normalization,
  OAuth state signing/verification, OAuth start URL construction, token
  exchange, profile fetch, and disabled-runtime behavior remain unchanged on
  the existing CommonJS service style. Auth, users, integration-doctor, and
  owned Google auth tests now point at the explicit `.ts` service, and the
  backend service index doc names the TypeScript file. Focused OAuth helper
  load, route-contract, owned Google auth, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 31`, `TypeScript: 280`, and `React TSX: 107` across the active
  scan roots.

Move 592 status:
- Move 592 converts `backend/src/routes/actionHistory.ts` to a package-safe
  TypeScript path. Action-history list, record, status update, server-backed
  undo/redo, permission checks, sensitive payload checks, payload-size guards,
  and JSON payload normalization remain unchanged on the existing CommonJS
  route style. The server mount, route-contract source probe, and backend route
  docs now point at the explicit `.ts` route. Focused route load,
  route-contract, backend utility, schema audit, stale-path, and Linux
  packaging proof passed. `pkg` continues to warn for direct `.ts` scripts, so
  broader backend conversions still wait for a compile/staging package lane.
  The generated language audit now reports `JavaScript: 30`, `TypeScript: 281`,
  and `React TSX: 107` across the active scan roots.

Move 593 status:
- Move 593 converts `backend/src/routes/ai.ts` to a package-safe TypeScript
  path. AI provider listing, create/update/delete, provider test status
  persistence, response-log listing, permission checks, write-conflict guards,
  auditing, broadcasts, and response serialization remain unchanged on the
  existing CommonJS route style. The server mount and roadmap docs point at
  the explicit `.ts` route; Move 599 later converts the AI gateway service
  itself to an explicit `.ts` path. Focused route load, route-contract,
  backend utility, schema audit, stale-path, and Linux
  packaging proof passed. `pkg` continues to warn for direct `.ts` scripts, so
  broader backend conversions still wait for a compile/staging package lane.
  The generated language audit now reports `JavaScript: 29`, `TypeScript: 282`,
  and `React TSX: 107` across the active scan roots.

Move 594 status:
- Move 594 converts `backend/src/routes/customTables.ts` to a package-safe
  TypeScript path. Custom-table listing, table creation, dynamic table
  row-versioning, schema normalization, row create/update/delete, write-conflict
  checks, audit entries, broadcasts, and dynamic `ct_*` table documentation
  remain unchanged on the existing CommonJS route style. The server mount,
  route-contract source probe, backend route docs, route folder guide, schema
  relationship note, and roadmap docs now point at the explicit `.ts` route.
  Focused route load, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 28`, `TypeScript: 283`, and `React TSX: 107` across the active
  scan roots.

Move 595 status:
- Move 595 converts `backend/src/middleware.ts` to a package-safe TypeScript
  path. Session auth binding, public-route network guard behavior,
  upload/file-type filtering, upload compression and validation, route rate
  limits, permission merging, admin-control checks, any-permission checks, and
  audit actor extraction remain unchanged on the existing CommonJS middleware
  style. The server and every route caller now point at the explicit `.ts`
  middleware path so Node/package resolution does not rely on extension
  inference. Focused middleware load, route-contract, backend utility, schema
  audit, stale-path, and Linux packaging proof passed. `pkg` continues to warn
  for direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 27`, `TypeScript: 284`, and `React TSX: 107` across the active
  scan roots.

Move 596 status:
- Move 596 converts `backend/src/services/integrationDoctor.ts` to a
  package-safe TypeScript path. Database, object-storage, queue, analytics,
  Google Drive, Google login, backup, runtime-data, secret-redaction, OAuth
  checklist, and restore-needed report behavior remain unchanged on the
  existing CommonJS service style. The system route and owned integration
  tests now point at the explicit `.ts` service path, and the owned Google auth
  source check reads the TypeScript file. Focused integration doctor and owned
  Google auth tests, route-contract, backend utility, schema audit, stale-path,
  and Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The generated language audit now reports `JavaScript: 26`,
  `TypeScript: 285`, and `React TSX: 107` across the active scan roots.

Move 597 status:
- Move 597 converts `backend/src/config/index.ts` to a package-safe TypeScript
  path. Dotenv selection, runtime/data root discovery, organization folder
  bootstrapping, upload/import directory creation, driver validation,
  queue/cache/media/import limits, frontend dist selection, public/admin URL
  resolution, Google OAuth secret-file fallback, data-location helpers, and
  exported config names remain unchanged on the existing CommonJS style. Every
  first-party config caller now points at the explicit `config/index.ts` path
  so Node/package resolution does not rely on directory `index.js` inference.
  Focused config load, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 25`, `TypeScript: 286`, and `React TSX: 107` across the active
  scan roots.

Move 598 status:
- Move 598 converts `backend/src/routes/sync.ts` to a package-safe TypeScript
  path. Outbox digest validation, stable payload stringification, allowlisted
  replay targets, write-conflict rejection, Cloudflare Access diagnostics,
  chunked offline file upload manifests, per-chunk hash validation, upload
  completion assembly, and upload-buffer validation remain unchanged on the
  existing CommonJS route style. The server mount and offline-security source
  assertions now point at the explicit `.ts` route. Focused route load,
  route-contract, offline-security, backend utility, schema audit, stale-path,
  and Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The generated language audit now reports `JavaScript: 24`,
  `TypeScript: 287`, and `React TSX: 107` across the active scan roots.

Move 599 status:
- Move 599 converts `backend/src/services/aiGateway.ts` to a package-safe
  TypeScript path. Provider metadata, provider payload normalization, secret
  encryption/decryption exports, provider row serialization, outbound URL
  validation, HTTP error shaping, Google message conversion, chat provider
  calls, embedding provider health checks, web-research eligibility, and safe
  JSON parsing remain unchanged on the existing CommonJS service style. The AI
  route and portal AI service now point at the explicit `.ts` service path.
  Focused service load, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 23`, `TypeScript: 288`, and `React TSX: 107` across the active
  scan roots.

Move 600 status:
- Move 600 converts `backend/src/services/firebaseAuth.ts` to a package-safe
  TypeScript path. Firebase Identity Toolkit capability checks,
  service-account JSON/file/base64/env fallback loading, Google service JWT
  signing, OAuth access-token caching, provider error normalization,
  public/admin Firebase request wrappers, email/E.164 normalization, user
  create/update, password update, active-state update, and password
  verification remain unchanged on the existing CommonJS service style. The
  services folder guide now points at the explicit `.ts` service path while
  preserving the note that this is legacy rollback/reference code, not the
  active auth route. Focused service load, route-contract, backend utility,
  schema audit, stale-path, and Linux packaging proof passed. `pkg` continues
  to warn for direct `.ts` scripts, so broader backend conversions still wait
  for a compile/staging package lane. The generated language audit now reports
  `JavaScript: 22`, `TypeScript: 289`, and `React TSX: 107` across the active
  scan roots.

Move 601 status:
- Move 601 converts `backend/src/systemJobs.ts` to a package-safe TypeScript
  path. Job id generation, public job serialization, active-job dedupe,
  runtime table creation/migration, stale queued/running/cancelling job
  recovery, throttled persistence, progress persistence steps, cancellation
  errors, cancellable worker lifecycle, queued/running/completed/failed/
  cancelled status transitions, retention cleanup, and database-backed job
  listing remain unchanged on the existing CommonJS helper style. The system
  route, backend tests, frontend action-stability source probe, backup
  reliability verifier, schema audit, hardening policy, schema relationship
  doc, and roadmap docs now point at the explicit `.ts` helper path. Focused
  helper load, system-jobs, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The generated language audit now reports
  `JavaScript: 21`, `TypeScript: 290`, and `React TSX: 107` across the active
  scan roots.

Move 602 status:
- Move 602 converts `backend/src/objectStore.ts` to a package-safe TypeScript
  path. R2/MinIO driver detection, R2 API fallback token/account discovery,
  Cloudflare object URL building, timeout-wrapped API calls, S3 client reuse,
  object-key normalization/dedupe, bucket checks, put/read/head/delete/list
  operations, stream conversion, and the object-store doctor test remain
  unchanged on the existing CommonJS helper style. Server upload serving, file
  asset storage, settings snapshot sanitization, backup packages, integration
  doctor, system route, R2 verifier, backend source probes, and backend docs
  now point at the explicit `.ts` helper path. Focused helper load, settings object-storage,
  backup hardening, route-contract, backend utility, schema audit, stale-path,
  and Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The generated language audit now reports `JavaScript: 20`,
  `TypeScript: 291`, and `React TSX: 107` across the active scan roots.

Move 603 status:
- Move 603 converts `backend/src/serverUtils.ts` to a package-safe TypeScript
  path. Origin/host normalization, configured public/customer portal host
  detection, CORS policy, WebSocket origin checks, Cloudflare Access
  diagnostics, prototype-pollution key cleanup, request string sanitization,
  SPA fallback eligibility, no-store and HTML headers, tunnel CSP/permissions
  headers, static/upload cache headers, customer portal route detection, and
  server error mapping remain unchanged on the existing CommonJS helper style.
  Server bootstrap, WebSocket setup, sync route diagnostics, server/offline
  security tests, hardening policy, and roadmap docs now point at the explicit
  `.ts` helper path. Focused helper load, server-utils, websocket,
  offline-security, route-contract, backend utility, schema audit, stale-path,
  and Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The generated language audit now reports `JavaScript: 19`,
  `TypeScript: 292`, and `React TSX: 107` across the active scan roots.

Move 604 status:
- Move 604 converts `backend/src/routes/importJobs.ts` to a package-safe
  TypeScript path. Import type permission mapping, permitted-type filtering,
  upload directory safety, CSV/TSV/ZIP/image file filtering, policy and
  relative-path parsing, forced-delete parsing, audit event payloads, queue
  status, job listing, job creation, review/decision/preflight routes,
  CSV/ZIP/image uploads, start/approve/cancel/delete/retry flows, and error
  CSV download remain unchanged on the existing CommonJS route style. Server
  route mounting, import-decision source assertions, backend route docs,
  language runtime audit metadata, and roadmap docs now point at the explicit
  `.ts` route path. Focused route load, import-decision, route-contract,
  backend utility, schema audit, stale-path, and Linux packaging proof passed.
  `pkg` continues to warn for direct `.ts` scripts, so broader backend
  conversions still wait for a compile/staging package lane. The generated
  language audit now reports `JavaScript: 18`, `TypeScript: 293`, and
  `React TSX: 107` across the active scan roots.

Move 605 status:
- Move 605 converts `backend/src/routes/branches.ts` to a package-safe
  TypeScript path. Branch listing, summary metrics, stock-integrity preview and
  repair, create/update/delete flows, default-branch handling, paged
  branch-stock search, stock transfer listing, stock transfer writes, audit
  payloads, broadcast channels, cached stock-transfer note-column selection,
  and direct-loop SQL helper behavior remain unchanged on the existing
  CommonJS route style. Server route mounting, product-expiry and
  route-contract source assertions, backend route docs, and roadmap docs now
  point at the explicit `.ts` route path. Focused route load, branch-stock,
  product-expiry, route-contract, backend utility, schema audit, stale-path,
  and Linux packaging proof passed. `pkg` continues to warn for direct `.ts`
  scripts, so broader backend conversions still wait for a compile/staging
  package lane. The expected generated language audit now reports
  `JavaScript: 17`, `TypeScript: 294`, and `React TSX: 107` across the active
  scan roots.

Move 606 status:
- Move 606 converts `backend/src/helpers.ts` to a package-safe TypeScript path.
  HTTP response helpers, audit logging, action-history payload safety,
  WebSocket broadcast fanout, runtime cache and Drive sync invalidation hooks,
  CSV parsing/import helpers, stock/sale/cost verification helpers, safe cost
  lookup, and sale profit calculation remain unchanged on the existing
  CommonJS helper style. All first-party route, service, and WebSocket imports
  now point at the explicit `.ts` helper path. Focused helper load,
  route-contract, backend utility, schema audit, stale-path, and Linux
  packaging proof passed. `pkg` continues to warn for direct `.ts` scripts, so
  broader backend conversions still wait for a compile/staging package lane.
  The expected generated language audit now reports `JavaScript: 16`,
  `TypeScript: 295`, and `React TSX: 107` across the active scan roots.

Move 607 status:
- Move 607 converts `backend/src/productBatches.ts` to a package-safe
  TypeScript path. Legacy batch backfill scheduling, batch-key construction,
  sellable-product guards, batch stock reads/writes, FEFO allocation,
  sale/return allocation lookup and release helpers, branch rollups,
  clone/restore behavior, and product rollup sync remain unchanged on the
  existing CommonJS helper style. Server startup, import jobs, products,
  inventory, sales, returns, backend source assertions, and roadmap docs now
  point at the explicit `.ts` helper path. Focused helper load,
  product-batch hierarchy, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The expected generated language audit now
  reports `JavaScript: 15`, `TypeScript: 296`, and `React TSX: 107` across the
  active scan roots.

Move 608 status:
- Move 608 converts `backend/src/services/portalAi.ts` to a package-safe
  TypeScript path. Provider runtime state, visitor activity throttling,
  product preference filtering, scoring/candidate projection, prompt assembly,
  assistant JSON normalization, provider failover/cooldown, usage summaries,
  and portal response policy remain unchanged on the existing CommonJS service
  style. The portal route now points at the explicit `.ts` service path.
  Focused service load, route-contract, backend utility, schema audit,
  stale-path, and Linux packaging proof passed. `pkg` continues to warn for
  direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The expected generated language audit now
  reports `JavaScript: 14`, `TypeScript: 297`, and `React TSX: 107` across the
  active scan roots.

Move 609 status:
- Move 609 converts `backend/src/postgresDatabase.ts` to a package-safe
  TypeScript path. The pg-native loader, SQLite-like statement bridge, SQL
  translation boundary, transaction/savepoint behavior, runtime schema/index
  bootstrap, default organization/branch/role seeding, lazy database proxy, and
  maintenance no-op compatibility exports remain unchanged on the existing
  CommonJS module style. The database facade, schema audit, source assertions,
  backend README/map, schema relationship docs, and roadmap docs now point at
  the explicit `.ts` runtime bridge path. Focused Postgres bridge, RFID,
  product-expiry, product-batch, owned-Google-auth, backend utility, schema
  audit, stale-path, and Linux packaging proof passed. `pkg` continues to warn
  for direct `.ts` scripts, so broader backend conversions still wait for a
  compile/staging package lane. The expected generated language audit now
  reports `JavaScript: 13`, `TypeScript: 298`, and `React TSX: 107` across the
  active scan roots.
