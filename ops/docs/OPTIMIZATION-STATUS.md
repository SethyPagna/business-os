# Business OS Optimization Status

Last updated: 2026-05-16

## Phase Board

- Phase 0: strong
- Phase 1: strong
- Phase 2: in progress
- Phase 3: in progress
- Phase 4: ongoing

## Current Baseline

Latest restored runtime health:

- local health: `http://127.0.0.1:4000/health`
- latest restored frontend hash: `d42ed61d1530abc6`

Latest restored reports:

- deep audit:
  `C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T06-03-16-094Z\summary.html`
- latest clean full-app audit before the rejected public-catalog candidate:
  `C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\full-app-audit-2026-05-16T05-05-27-132Z\summary.html`

Current honest pockets are still somewhat ambient after the restore reruns:

- `desktop/backup` document-time wobble
- `mobile/public_catalog` document-time wobble

Recent stable repeatable route-level target before the rejected mobile catalog
experiment:

- `mobile/public_catalog:section-tabs`

## Current Working Rules

- Keep UI shape stable unless evidence forces a visible change.
- Prefer hidden-work reduction, derived-data tightening, and helper reuse.
- Use route-scoped audits before whole-app reruns.
- Reject any route-local win that wakes unrelated warm whole-app findings.
- Preserve the dirty local workspace; use the clean worktree for validation.

## Recently Accepted Wins

- Returns filter sections now build only when the menu opens.
- Import tracker settled job lists now reuse a short-lived cache.
- Inventory filter selectors now open behind summary rows.
- POS global filter metadata now waits until Filters opens.
- Dashboard export helpers now load on demand.
- Backup version list and route hot paths were hardened in earlier passes.

## Recently Rejected Candidates

- hard-capped backup version fallback path:
  targeted API improved, but warm exhaustive reruns woke unrelated route noise
- mobile public-catalog hidden-panel unmounting:
  route-scoped win, but warm whole-app reruns drifted
- broad returns section repagination:
  looked tidy locally, but whole-app timing shape worsened

## Next Best Moves

1. Reconfirm whether the current public-catalog mobile pocket is truly
   repeatable after the restore drift settles.
2. If it is not repeatable, shift to the next stable shared seam instead of
   forcing a catalog fix.
3. Keep trimming hidden work and repeated derived-data assembly before broader
   refactors.
