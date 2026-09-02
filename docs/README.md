# docs/ index

One line per file. For the project's live status and open work, read
`../progress.md`, not this folder.

## This directory

- [`release-audit-2026-09-02.md`](release-audit-2026-09-02.md) — the consolidated release checklist: requested behavior, runtime paths included, and evidence gathered before deployment, across the accumulated Business OS sessions.
- [`linked-data-ripple-audit-2026-09-02.md`](linked-data-ripple-audit-2026-09-02.md) — Stage-1 audit (scope UXA-04) verifying rename/merge effects ripple correctly across lists, nested details, filters, reports, exports, receipts, search/read caches, and live refresh. Does not authorize deployment or migration application.
- [`nested-ui-action-audit-2026-09-01.md`](nested-ui-action-audit-2026-09-01.md) — audit of all 14 registered admin pages' nested sections, folded/overflow actions, dialogs, pagination, filter layers, and mobile viewport boundaries. Does not certify backend rename cascades, migration semantics, or stock-in report data.
- [`system-migration-polish-audit-2026-09-01.md`](system-migration-polish-audit-2026-09-01.md) — persistent source of truth for the old-system migration audit and related app polish; item-by-item with evidence/implementation/verification status (`OPEN`/`AUDITING`/`IMPLEMENTING`/`VERIFYING`/`DONE`/`BLOCKED`).
- [`DATA-VISIBILITY-AND-CREDIT-AUDIT.md`](DATA-VISIBILITY-AND-CREDIT-AUDIT.md) — investigation-only (Aug 31 2026): "awaiting payment" vs. "on credit", what captured data never reaches the UI, and a related question; nothing in it was implemented as part of writing it.

## Subdirectories

- [`plans/`](plans/) — active coordination plans. Currently
  [`coordinated-plan-2026-09-02.md`](plans/coordinated-plan-2026-09-02.md), the
  isolated release-candidate effort's plan of record (worktree layout, gates,
  per-section briefs).
- [`history/`](history/) — closed-out record, append-only in spirit:
  - [`session-log.md`](history/session-log.md) — the per-session narrative log, `## Part N` entries, Parts 1–578 as of 2026-09-02. Read a specific Part for the reasoning behind a past decision; do not read it end-to-end.
  - [`progress-archive-2026-09-02.md`](history/progress-archive-2026-09-02.md) — everything moved out of `progress.md`'s DONE archive, older backlog, and old request batches during the 2026-09-02 hygiene pass, plus a "what moved where" table.
  - [`coordinator-notes-2026-08-31-to-09-02.md`](history/coordinator-notes-2026-08-31-to-09-02.md) — the raw Aug-31→Sep-1 live-coordination transcript (lane claims, hazards, Part-number collisions), moved out of `progress.md`'s "Current status" section.
  - [`checkpoints/`](history/checkpoints/) — sandbox checkpoint artifacts captured from the main checkout; see its own `README.md`.

## Elsewhere (not duplicated here)

- Project overview, repo layout, how to run/verify: [`../README.md`](../README.md).
- Deploy pipeline: [`../DEPLOY.md`](../DEPLOY.md).
- Live status, open work, Golden Rules, engineering standards: [`../progress.md`](../progress.md).
- Backend layout: [`../cloudflare/README.md`](../cloudflare/README.md).
- Frontend layout: [`../frontend/README.md`](../frontend/README.md), [`../frontend/src/README.md`](../frontend/src/README.md), [`../frontend/src/components/README.md`](../frontend/src/components/README.md).
- Release-pipeline scripts: [`../run/README.md`](../run/README.md).
