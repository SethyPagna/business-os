# Business OS Optimization Master Plan

Last updated: 2026-06-11

This document is the source of truth for the whole-app live audit and
optimization program. It exists so progress is trackable in-repo instead of
only in chat.

## Current Execution Position

- Latest completed move: Move 911, remove the remaining Products first-load
  false-zero labels from the desktop table footer and mobile select-all row
  while keeping real post-load counts unchanged.
- Active plan position: Phase 8.4 live verification/performance remains
  active; Phase 26 stays at 51 completed organization moves; Phase 28 remains
  active with the R2/access follow-up open; Phase 29 remains active as the
  recurring whole-codebase/schema/cleanup guardrail.
- Current external blocker: Cloudflare `/public` HTML still returns
  `CF-Cache-Status: DYNAMIC` until the API token has `Zone Cache Rules Edit`
  and `npm --prefix ops run cloudflare:apply-cache` succeeds.
- Latest admin/public proof: Docker image `business-os:v6.0.0-202606111821`
  is healthy with frontend hash `b2c6359b55be09e5` and source hash
  `23b9745c64a0714f`. Local Products trace measured ready in 454 ms with
  532 ms LCP, zero failed requests, and zero app errors. Public admin Products
  trace measured ready in 3.802 s and LCP in 2.672 s with zero failed
  requests/errors; its first-render text now shows neutral `Loading` and
  `Select all` labels instead of false `0 / 0 Products` or `Select all (0)`.
  Public admin remains slightly above the 2.5 s LCP target because the document
  and route chunks are still tunnel/edge-transfer bound, not because of an
  extra artificial loading delay. Broad all-pages control audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-11T10-01-00-315Z/summary.json`
  passed 34 desktop/mobile routes, 386 tested controls, 0 failed controls, and
  0 findings. Guarded storage prune removed 14,387,727 bytes of old runtime
  reports, reclaimed about 3.037 GB of Docker builder cache, removed only the
  old `business-os:v6.0.0-202606111328` tag, and kept active
  `business-os:v6.0.0-202606111750`.

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
   - `ops/scripts/runtime/smoke/live-smoke.ts`
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

- `Inventory.tsx`
- `Products.tsx`
- `POS.tsx`
- `Dashboard.tsx`
- `CatalogPage.tsx`
- `Settings.tsx`
- `Backup.tsx`
- `FilesPage.tsx`
- `Returns.tsx`

Preferred tactics:

- remove hidden work from first render
- build derived data only when the surface actually opens
- reuse already-built grouped structures instead of recomputing them
- memoize only where measured rerender churn exists
- avoid broad UI changes when a helper-level or surface-level seam will do

## Phase 3: Backend Hotspot Program

Status target: `in progress`

Priority areas:

- `backend/src/services/importJobs.ts`
- `backend/src/routes/products.ts`
- `backend/src/routes/inventory.ts`
- `backend/src/routes/sales.ts`
- `backend/src/routes/system/index.ts`
- `backend/src/services/googleDriveSync/index.ts`
- `backend/src/routes/contacts.ts`
- `backend/src/routes/returns.ts`

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
