# Business OS Optimization Status

Last updated: 2026-05-16

## Whole-Plan Status

- Phase 0: strong
- Phase 1: strong
- Phase 2: in progress
- Phase 3: in progress
- Phase 4: ongoing

## Current Baseline

Primary clean verification worktree:

- `C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta`

Latest verified reports:

- Deep audit:
  [C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T02-03-59-309Z\summary.html](C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T02-03-59-309Z\summary.html)
- Full app audit:
  [C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\full-app-audit-2026-05-16T02-03-59-631Z\summary.html](C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\full-app-audit-2026-05-16T02-03-59-631Z\summary.html)

Current verified runtime health:

- local health: [http://127.0.0.1:4000/health](http://127.0.0.1:4000/health)
- frontend hash: `2c792eec27cb6b02`

Current notable findings:

- warm exhaustive deep audit is currently clean
- warm full app audit is currently clean
- Returns route-specific checks are currently clean after trimming a redundant
  post-load selection cleanup render

Fresh route-scoped inventory evidence from the current clean runtime:

- Deep audit:
  [C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T01-28-47-769Z\summary.html](C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T01-28-47-769Z\summary.html)
- Browser action smoke:
  [C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\browser-action-smoke-2026-05-16T01-28-48-582Z\summary.html](C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\browser-action-smoke-2026-05-16T01-28-48-582Z\summary.html)

Current inventory route-only status:

- focused Inventory route checks are clean
- desktop Inventory Filters interaction no longer shows up in the warm whole-app
  warning set after collapsing branch/group/stock pickers behind summary selectors

## Phase Details

### Phase 0: Canonical Audit Harness

Status: strong

Completed/working:

- canonical deep live audit in repo
- canonical full app audit in repo
- route/action manifest in repo
- HTML and JSON report output
- desktop and mobile screenshots
- route-scoped audit support
- Playwright browser action smoke
- Docker log scan scoped to audit window

Open follow-through:

- keep action expectations current as route behavior evolves
- continue adding route-specific action coverage where it improves signal

### Phase 1: Live Baseline

Status: strong

Completed/working:

- reproducible live smoke loop
- warm rerun discipline
- whole-app baseline comparisons through stored report artifacts
- remote public/admin checks included in full app audit

Open follow-through:

- keep baseline references refreshed as real keepers land

### Phase 2: Frontend Hotspots

Status: in progress

Confirmed keepers already landed include:

- Products:
  - reuse grouped product sections
  - build filter sections only when Filters opens
- Dashboard:
  - memoize KPI detail models
  - defer export helpers until Export actions run
- POS:
  - defer global filter metadata until Filters opens
- Catalog:
  - skip redundant desktop/mobile tab scroll cases
- Returns:
  - below-the-fold row/card deferral improvements
- Inventory:
  - collapse heavy filter pickers behind lighter selectors

Current direction:

- continue shared hidden-work reduction
- prefer helper/data-flow improvements over UI reshaping
- keep checking screenshots for overflow/out-of-bounds regressions
- current strongest follow-through lane is product/shared workflow efficiency now
  that Inventory and Returns are quiet on the latest warm baseline

### Phase 3: Backend Hotspots

Status: in progress

Confirmed keepers already landed include:

- backup version listing cache
- backup version route bounded wait
- file asset usage cache improvements
- object-storage-aware stale upload reference cleanup
- Google Drive write-scope recovery
- scaled runtime worker dependency self-heal

Current direction:

- keep reducing repeated work on first-hit and repeated-hit server paths
- prefer bounded waits, cache discipline, and payload trimming over broad
  rewrites

### Phase 4: Folder Sweep

Status: ongoing

Current approach:

- measured slice-by-slice changes only
- no style churn
- only remove dead code when search evidence and live verification agree

## Current Workflow Rules

- main workspace may remain dirty and must not be trampled
- use clean worktrees for keeper work
- descriptive branches only
- validated work also lands on `main`
- many small commits preferred
- after frontend/runtime changes:
  1. build
  2. force-recreate `app`, `import-worker`, `media-worker`
  3. verify bind mounts
  4. health check
  5. smoke
  6. route-scoped audit
  7. warm exhaustive deep audit
  8. warm full app audit

## Current Focus

Primary optimization lane:

- shared workflow tightening
- hidden-work reduction
- derived-data churn cleanup
- resource-efficiency wins that do not disturb accepted UI shapes

Immediate next measured target:

- product/shared workflow tightening from the new clean baseline
- likely seams:
  - derived-data churn
  - hidden post-load rerenders
  - cross-surface refresh/update flow

Secondary lane:

- frontend-first TypeScript migration where it helps shared contract safety
- correctness vertical slices when they unblock cross-surface reliability

## Deferred / Guarded Migration Notes

- TypeScript migration remains frontend-first
- backend JS remains acceptable unless a measured reason justifies more
- Python should stay out of runtime paths unless a later phase clearly needs it
