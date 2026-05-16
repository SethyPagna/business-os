# Business OS Optimization Session Log

Last updated: 2026-05-16

This is a concise running log of what actually happened in recent sessions.

## 2026-05-16

### Accepted

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
