# Business OS Optimization Master Plan

Last updated: 2026-05-16

This document is the source of truth for the whole-app live audit and
optimization program. It exists so progress is trackable in-repo instead of
only in chat.

## Program Goals

- Keep the app fast, stable, and verifiably correct under real authenticated
  usage.
- Optimize hidden work, render churn, request waterfalls, and repeated
  computation before reaching for broad UI rewrites.
- Preserve business behavior for sales, returns, inventory, files, backups,
  imports, permissions, and public catalog flows while we improve performance.
- Prefer boring, measurable improvements over clever changes that disturb the
  rest of the app.

## Session Rules

Every implementation session should follow this loop:

1. Reconfirm the current baseline on the affected route or shared flow.
2. Make one narrow change at a clear file or helper seam.
3. Run local gates first:
   - frontend `test:utils` when frontend code changes
   - frontend build when frontend code changes
   - backend `test:utils` when backend code changes
   - focused unit or utility tests for the changed area
4. Force-recreate the runtime:
   - `app`
   - `import-worker`
   - `media-worker`
5. Run live verification:
   - `ops/scripts/runtime/live-smoke.mjs`
   - route-scoped deep audit on the affected route
   - route-scoped browser action smoke when the route has clicks, tabs, filters,
     or write-entry actions
6. Run warm whole-app verification:
   - exhaustive deep audit
   - full app audit when the change can affect API flows, runtime health, or
     cross-route behavior
7. Keep the change only if the route win survives the warm whole-app view.

## Acceptance Gates

- No dead navigation, dead buttons, or broken write-entry flows on audited
  routes.
- No indefinite loading states.
- No first-party console or page errors relevant to the changed flow.
- No visible out-of-bounds or clipped UI in desktop/mobile screenshots.
- No route-local win that causes broader route churn on warm reruns.

## Phase Status Model

- `strong`: the phase has a stable process and recent keeper results.
- `in progress`: the phase is active and still harvesting or validating wins.
- `ongoing`: the phase is long-running, incremental, or sweep-oriented.

## Phase 0: Canonical Audit Harness And Evidence Pipeline

Status target: `strong`

Scope:

- Keep the runtime audit tooling canonical inside this repo.
- Maintain a route/action manifest for admin and public surfaces.
- Produce HTML and JSON reports plus screenshots.
- Keep route-scoped audits and browser action smoke easy to run.
- Keep docker-log scanning scoped to the audited run window.

## Phase 1: Whole-App Live Audit Baseline

Status target: `strong`

Scope:

- Repeated authenticated audits over the core admin and public routes.
- Track cold and warm timings, route-ready, interaction timings, and notable
  layout or session issues.
- Keep explicit before/after comparisons for each accepted change.

## Phase 2: Frontend Hotspot Program

Status target: `in progress`

Priority surfaces:

- `Inventory.jsx`
- `Products.jsx`
- `POS.jsx`
- `Dashboard.jsx`
- `CatalogPage.jsx`
- `Settings.jsx`
- `Backup.jsx`
- `FilesPage.jsx`
- `Returns.jsx`

Preferred tactics:

- remove hidden work from first render
- build derived data only when the surface actually opens
- reuse already-built grouped structures instead of recomputing them
- memoize only where measured rerender churn exists
- avoid broad UI changes when a helper-level or surface-level seam will do

## Phase 3: Backend Hotspot Program

Status target: `in progress`

Priority areas:

- `backend/src/services/importJobs.js`
- `backend/src/routes/products.js`
- `backend/src/routes/inventory.js`
- `backend/src/routes/sales.js`
- `backend/src/routes/system/index.js`
- `backend/src/services/googleDriveSync/index.js`
- `backend/src/routes/contacts.js`
- `backend/src/routes/returns.js`

Preferred tactics:

- trim repeated response assembly
- cache short-lived repeated same-session reads when safe
- bound hot-path waits
- reduce redundant hydration and parsing
- tighten payloads before changing architecture

## Phase 4: Session-By-Session Folder Sweep

Status target: `ongoing`

Sweep order:

1. app shell, auth, shared loaders, navigation, runtime helpers
2. dashboard, inventory, products, POS
3. sales, returns, contacts, files, backup, settings, users, branches, audit
   log, server, loyalty
4. public/catalog and portal surfaces
5. backend routes, backend services, backend core utilities

Guardrails:

- no style churn
- no dead-code removals without caller search evidence
- no helper merges without tests/build and live reports staying clean

## Migration Track

The long-range migration track stays active alongside the optimization work:

- expand TypeScript in the frontend where it strengthens contracts, shared
  helpers, and high-churn surfaces
- only introduce Python or other runtime languages where they clearly improve a
  bounded workflow without raising deployment or support risk
- do not mix language migration into an unrelated hot-path fix when it would
  muddy verification

## Branching And Commit Discipline

- Use descriptive branch names tied to the work, not tool names.
- Keep validated changes small and push them to `main`.
- Preserve dirty local user workspaces by using clean worktrees for validation.
- Reject tempting changes when the whole-app picture stops being calm.
