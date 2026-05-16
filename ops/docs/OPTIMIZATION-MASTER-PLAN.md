# Business OS Whole-App Optimization Master Plan

This document is the canonical working plan for the live audit, optimization,
correctness, and migration program. It folds the original whole-app live audit
program together with the later workflow-hardening, receipt/settings
correctness, and frontend-first TypeScript migration tracks.

The goal is not generic "cleanup". The goal is measured, session-by-session
improvement of:

- route readiness
- interaction reliability
- hidden-work/resource efficiency
- runtime stability
- cross-surface correctness
- maintainable migration paths

## Program Rules

1. Measure first, keep only real wins.
2. Validate in live runtime conditions, not just local code paths.
3. Prefer smaller commits and descriptive branches.
4. Validated work may use branches, but must also land on `main`.
5. Do not disturb unrelated dirty workspace edits.
6. Favor hidden-work reduction, data-flow tightening, and shared helper
   improvements over cosmetic UI churn.
7. The user is currently happy with inventory and the overall product UI shape,
   so optimize behavior and efficiency without reshaping those surfaces unless a
   measured bug requires it.

## Standing Session Workflow

This is the default execution loop for optimization sessions.

1. Start from a clean verification worktree based on `origin/main` whenever the
   main workspace is dirty.
2. Identify the next route, interaction, or backend hotspot from the latest
   clean report.
3. Make the narrowest change that can reasonably improve the measured hotspot.
4. Run local gates first:
   - focused tests where available
   - `frontend: npm.cmd run test:utils` when frontend changes
   - `frontend: npm.cmd run build` when frontend changes
   - `backend: npm.cmd run test:utils` when backend changes
5. Recreate the runtime when code changes affect the running app or workers.
6. Re-check health and verify app/worker bind mounts before trusting smoke.
7. Run live verification:
   - `live-smoke`
   - route-scoped deep audit on the touched route first
   - route-scoped browser action smoke when buttons/menus/search/flows changed
   - warm exhaustive deep audit
   - warm full-app audit
8. Keep the change only if:
   - the target route or backend path improves or remains safely healthy
   - the warm whole-app picture stays calm
   - there are no meaningful behavior regressions
9. Push the validated commit to a descriptive branch and to `main`.
10. Update `OPTIMIZATION-STATUS.md` and `OPTIMIZATION-SESSION-LOG.md`.

## Verification Gates

Every implementation session should end with the strongest applicable subset of
the following:

- focused unit/integration tests
- `frontend: npm.cmd run test:utils`
- `frontend: npm.cmd run build`
- `backend: npm.cmd run test:utils` when backend changed
- runtime health check
- runtime recreate when needed
- authenticated live smoke
- route-scoped deep audit on affected routes
- browser action smoke for affected routes and controls
- warm exhaustive deep audit
- warm full-app audit
- screenshot review for bounds/overflow/layout issues on touched screens

## Acceptance Targets

- no dead navigation or dead primary buttons on audited routes
- no indefinite loading states
- no relevant console or page errors in audited flows
- no visible gibberish or broken payload text in audited DOM/API paths
- no meaningful regression in write flows:
  - auth
  - imports
  - inventory adjustments
  - sales
  - returns
  - files/library
  - backup
  - settings
- hot routes should trend toward sub-500 ms mobile route-ready or route-local
  LCP when feasible; misses require measured blocker evidence

## Phase 0: Canonical Audit Harness And Evidence Pipeline

Make the runtime audit tooling canonical in the active repo and keep one source
of truth for live testing.

### Deliverables

- canonical route/action manifest for admin and public surfaces
- HTML report generation alongside JSON summaries
- screenshots for desktop and mobile
- interaction timing evidence for primary controls
- API timing breakdown for critical read/write flows
- authenticated browser runner that logs in once and reuses session state
- route-scoped audit support for faster, cheaper verification
- browser action smoke for real navigation and button-use checks
- smarter Docker log scan windows so startup noise does not contaminate route
  findings

## Phase 1: Whole-App Live Audit Baseline

Maintain a reproducible baseline over major routes and sub-views:

- dashboard
- products
- inventory
- POS
- sales
- returns
- contacts
- files
- backup
- branches
- users
- audit log
- settings
- receipt settings
- server
- loyalty points
- public catalog

### Baseline Evidence

- cold and warm route timings
- first visible shell timing
- first interactive control timing
- critical button/interaction timing
- visible clipping/overflow/layout-shift review
- dead-button, stale-loading, invalid-session, and navigation mismatch checks
- route "hot path" summaries that classify whether the dominant cost is:
  - API/server latency
  - chunk/load cost
  - render cost
  - post-render layout churn
  - interaction/state churn

## Phase 2: Frontend Hotspot Program

Focus first on the highest-value route and interaction hotspots.

### Priority Areas

- `Inventory.jsx`
- `Products.jsx`
- `POS.jsx`
- `Dashboard.jsx`
- `CatalogPage.jsx`
- `Settings.jsx`
- `Backup.jsx`
- `FilesPage.jsx`

### Methods

- map data flow and render flow before editing
- remove repeated transforms and duplicate grouping/flattening work
- move expensive work off hot render paths
- prefer `Map`/`Set`/indexed lookups where repeated linear scans dominate
- add memoization only where measured rerender churn exists
- lazy-load non-critical helpers and feature branches by user intent
- virtualize or window large lists where measured rendering cost justifies it
- preserve stable shells during refreshes
- avoid helper text or loading placeholders becoming LCP
- remove dead branches, duplicate helpers, stale loaders, and broken fallbacks

### Shared Frontend Policy

- stable shell first
- route-critical content eager enough to avoid blank or stalled first paint
- non-critical enrichments deferred until after first useful render
- no indefinite loading without clear timeout/failure classification

## Phase 3: Backend Hotspot Program

Focus on request flow, payload shape, and repeated server-side work.

### Priority Areas

- `services/importJobs.js`
- `routes/products.js`
- `routes/inventory.js`
- `routes/sales.js`
- `routes/system/index.js`
- `services/googleDriveSync/index.js`
- `routes/contacts.js`
- `routes/returns.js`

### Methods

- trace request -> query -> transform -> response
- measure endpoint latency and payload size before refactors
- trim query projection and enrichment where payloads are too broad
- reduce repeated parsing/joining/hydration passes
- batch or defer expensive work where synchronous paths are too heavy
- prefer response-boundary normalization over UI-side repair
- verify index and cache strategy for hot domains

## Phase 4: Systematic Folder Sweep

After hotspot work, sweep the repo in measured ownership slices:

1. app shell, auth, shared loaders, navigation, runtime helpers
2. dashboard, inventory, products, POS
3. sales, returns, contacts, files, backup, settings, users, branches, audit
   log, server, loyalty
4. public/catalog and portal surfaces
5. backend routes, backend services, backend core utilities

### Sweep Rules

- review files line by line inside the active slice
- keep changes scoped to measured or clearly broken behavior
- no style churn
- dead code removal requires search evidence, passing tests/build, and no live
  report regression

## Cross-Cutting Correctness Track

This track runs alongside performance work when the measured evidence shows
shared correctness issues.

### Current High-Value Correctness Themes

- settings-backed writes use one shared refresh contract
- receipt template, print settings, preview, and export flows consume one
  applied config path
- import review/apply flows update dependent product/inventory surfaces without
  manual reload
- permission/session payloads must keep navigation and access checks consistent
- upload/media references must be sanitized before stale object paths leak to
  the UI

## Frontend-First TypeScript Migration Track

Migration is allowed only when it improves safety, correctness, or velocity
without destabilizing runtime verification.

### Rules

- TypeScript-first on frontend/shared contracts
- backend remains runtime-stable JS unless a measured reason justifies more
  migration
- Python is not introduced into runtime paths casually; reserve it for tooling,
  reporting, or clearly justified background workflows
- no language churn for its own sake

### Near-Term Migration Targets

- shared settings write contracts
- receipt/print/applied-config contracts
- route audit manifest contracts
- shared helper modules where types improve correctness and reduce regressions

## Resource-Efficiency And Workflow Tightening

This program explicitly includes refinement of:

- loops and nested loops
- repeated transforms
- hidden helper work
- cache use
- same-session refresh behavior
- audit verification loops
- worker/runtime bring-up discipline

The desired outcome is software that is stronger, more stable, more efficient,
and better at using resources without wasting them.
