# Business OS Optimization Master Plan

Last updated: 2026-06-11

This document is the source of truth for the whole-app live audit and
optimization program. It exists so progress is trackable in-repo instead of
only in chat.

## Current Execution Position

- Latest completed move: Move 917, delete the empty shell warmup scaffolding
  left behind after broad route/data warmups were disabled. Explicit
  navigation-intent chunk preloading remains the only shell route warmup path.
- Active plan position: Phase 8.4 live verification/performance remains
  active; Phase 26 stays at 51 completed organization moves; Phase 28 remains
  active with the R2/access follow-up open; Phase 29 remains active as the
  recurring whole-codebase/schema/cleanup guardrail.
- Current external blocker: Cloudflare `/public` HTML still returns
  `CF-Cache-Status: DYNAMIC` until the API token has `Zone Cache Rules Edit`
  and `npm --prefix ops run cloudflare:apply-cache` succeeds.
- Latest admin/public proof: Docker image `business-os:v6.0.0-202606112037`
  is healthy with frontend hash `d1b4010fc17587c2` and source hash
  `3b68f7362c866cc6`. Local LCP trace
  `ops/runtime/reports/lcp-route-trace-2026-06-11T12-39-11-540Z.json`
  measured Dashboard 292 ms, Products 268 ms, Inventory 252 ms, POS 212 ms,
  Files 228 ms, Branches 212 ms, Audit Log 336 ms, Settings 260 ms, and Public
  Catalog 236 ms with zero failed requests/errors. Admin Cloudflare LCP trace
  `ops/runtime/reports/lcp-route-trace-2026-06-11T12-44-02-665Z.json`
  measured all 9 checked routes at or below 320 ms, and direct public-host LCP
  trace `ops/runtime/reports/lcp-route-trace-2026-06-11T12-44-32-924Z.json`
  also stayed at or below 320 ms. Browser action smoke
  `ops/runtime/reports/browser-action-smoke-2026-06-11T12-39-39-097Z/summary.json`
  passed 34 routes and 28 actions with 0 findings. Broad all-pages control
  audit
  `ops/runtime/reports/all-pages-control-audit-2026-06-11T12-40-23-750Z/summary.json`
  passed 34 desktop/mobile routes, 460 controls, 404 tested controls, 0 failed
  controls, and 0 findings.
- Latest cleanup proof: ignored regenerable `release/` and `frontend/dist/`
  were deleted after Docker/live proof, reclaiming 412,841,583 bytes. Guarded
  storage prune removed 10,760,267 bytes of old reports, reclaimed Docker
  builder cache, and removed only old `business-os:v*` tags while keeping the
  running image and newest rollback tags. Phase 29 audit
  `ops/docs/reference/PHASE29-AUDIT.md` then passed 9 checks with 0 failures;
  generated-bulk cleanup candidates are below the 512 MB threshold.

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
