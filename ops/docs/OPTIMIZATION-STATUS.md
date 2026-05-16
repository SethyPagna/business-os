# Business OS Optimization Status

Last updated: 2026-05-16

## Phase Board

- Phase 0: strong
- Phase 1: strong
- Phase 2: in progress
- Phase 3: in progress
- Phase 4: ongoing

## Current Baseline

Latest verified runtime health:

- local health: `http://127.0.0.1:4000/health`
- latest verified frontend hash: `989b285f0957ef6e`

Latest verified reports:

- deep audit:
  `C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T09-10-25-077Z\summary.html`
- route-scoped dashboard/products/inventory audit:
  `C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\deep-live-audit-2026-05-16T09-08-49-057Z\summary.html`
- full-app audit:
  `C:\Users\user\Downloads\business-os\.codex-worktrees\pos-background-filter-meta\ops\runtime\reports\full-app-audit-2026-05-16T09-12-46-013Z\summary.html`

Current honest pockets:

- no repeatable app-side hard findings on the latest warm exhaustive rerun
- the previous `api/notifications/summary` pressure on inventory is no longer a
  live warm-baseline finding after the backend cache pass
- the remaining mobile inventory browser-action nav miss is harness-shaped and
  did not reproduce as a deep-audit route failure

Recent route-level win:

- `inventory`
- `dashboard/products/inventory` shared summary path

## Current Working Rules

- Keep UI shape stable unless evidence forces a visible change.
- Prefer hidden-work reduction, derived-data tightening, and helper reuse.
- Use route-scoped audits before whole-app reruns.
- Reject any route-local win that wakes unrelated warm whole-app findings.
- Preserve the dirty local workspace; use the clean worktree for validation.

## Recently Accepted Wins

- Notification summary now reuses a short-lived server-side cache keyed by
  effective section access and summary preferences, which removed the shared
  inventory-side summary hotspot from the warm baseline.
- Inventory no longer builds product-tab filter sections off movement-only state,
  and admin user options now wait for the Movements tab.
- Public catalog keeps chunk preloading but no longer pre-mounts hidden
  secondary tab panels after priming.
- Products no longer schedules an orphaned desktop reveal state update after load.
- Returns filter sections now build only when the menu opens.
- Import tracker settled job lists now reuse a short-lived cache.
- Inventory filter selectors now open behind summary rows.
- POS global filter metadata now waits until Filters opens.
- Dashboard export helpers now load on demand.
- Backup version list and route hot paths were hardened in earlier passes.

## Recently Rejected Candidates

- Notification-center summary deferral:
  looked like a reasonable shared-background delay, but real route timing on
  Products regressed and did not hold the gate
- Returns cached display-field reuse:
  reduced repeated formatting locally, but warm route reruns got slower instead
- products loadPromise bookkeeping removal:
  the code was dead-looking, but the real route metrics got worse after proper
  worktree-targeted runtime verification
- hard-capped backup version fallback path:
  targeted API improved, but warm exhaustive reruns woke unrelated route noise
- mobile public-catalog hidden-panel unmounting:
  route-scoped win, but warm whole-app reruns drifted
- broad returns section repagination:
  looked tidy locally, but whole-app timing shape worsened

## Next Best Moves

1. Reconfirm the next repeatable shared hotspot before touching code again.
2. Favor helper-level or dead-state cleanup over route-specific guesswork.
3. Keep trimming hidden work and repeated derived-data assembly before broader
   refactors.
