# Branch cutover operator path (Shop -> LC Store)

Lane CUTOVER-RUNNER, 7 Oct 2026. The certified cutover library (lane LB: `branchCutoverParent/Child/Journal/Capture/History.ts`)
needs the Worker's D1 binding, so the production path is the Worker itself, driven from an Ops task.

## Design

| Piece | File | Rule |
|---|---|---|
| Endpoint | `cloudflare/src/routes/branchCutoverOperator.ts`, `cloudflare/src/lib/branchCutoverOperator.ts` | `POST /api/internal/branch-cutover/{inspect,begin,resume,status,abort,finalize}`. Dark (404) unless the Worker secret `BRANCH_CUTOVER_OPERATOR_TOKEN` (32+ characters) exists. Header `X-Cutover-Operator-Token` is compared by SHA-256 digest with no early exit; a missing or wrong token is 401 before the body is read. |
| One step per call | same | `resume` runs exactly one durable library step (a capture/snapshot page, a seal, one product child, a verify page) and answers the journal phase, revision, counters. Every step needs `operationId`, `expectedRevision` and `requestId = bcr_<operationId>_<revision>`; a call whose revision is behind the journal replays (reads) and does nothing. `finalize` runs only at `ready`; at `completed` it only reads. `abort` is the library's effect-free abort (refused after the first child). |
| Fence | `lib/maintenance.ts` `isBranchCutoverOperatorPath`, one condition in the `/api/*` gate in `index.ts` | While the journal holds the `branch-cutover` maintenance flag, exactly these six paths pass the gate; every other write is 503. In restore mode they are blocked too. |
| Actor | request (`actorUserId`, begin and inspect) then the journal's `actor_id` | The library re-checks the actor's grants (`backup_restore`, branches edit + transfer at full tier) on every step. No browser session is involved. |
| Control incarnation | `begin` | Created in `system_flags` when absent (the journal requires it), read back, never rewritten. |
| Named admission refusals | `begin` | Before the library's own (authoritative) in-batch guard: `import_job_active`, `bulk_delete_active`, `open_shift_exists`, `pending_actions_open`, `active_branch_count`, `maintenance_already_held`. |
| Loop | `ops/scripts/branch-cutover-loop.mjs` | Shared by the Ops script and the tests. The request text is built once per call and re-sent unchanged after a timeout, 429, 5xx or `retryable` (D1 7429, unconfirmed batch). Any refusal, 401, 404 stops at once with a fixed code and leaves the fence held. 25 attempts per call (15 s backoff cap), 4 for begin. Each response must advance the revision. |
| Ops task | `.github/workflows/ops.yml` job `branch-cutover`, `ops/scripts/ops-branch-cutover.mjs` | `environment: production` approval, confirm word `branch-cutover`, `github.ref == refs/heads/main` (job `if` and script), 360 min job / 330 min step, resume budget 300 min. Public log: mode, operation id, phase names, revision and step counts, PASS/FAIL, fixed refusal codes. Inspect's preimages and every refusal detail are only in the encrypted report. Only the production origins (`admin.leangbeauty.com`, `leangbeauty.com`) are accepted. |

The Worker must be on the Paid plan for the run (the certified child needs it, LB report E2). No deploy and no migration may happen between
`start` and `finalize` (LB report E7: `contract_changed_since_begin`; redeploy the begin build and continue the same operation).

## Secret (create once, before the night)

`BRANCH_CUTOVER_OPERATOR_TOKEN`: the same random value (48+ characters) as
1. a Worker secret on `business-os` (owner terminal or the deploy kit, never in the repo), and
2. a GitHub environment secret of that name in the `production` environment.

Delete both after the cutover completes; the endpoint is dark without the Worker secret.

## Operator commands (Actions > Ops > Run workflow, ref `main`, `task` = `branch-cutover`, `confirm` = `branch-cutover`)

| Runbook | Run | Inputs |
|---|---|---|
| (day before) reachability, capabilities, schema/registry digests | `cutover_mode` inspect | `actor_user_id` = administrator id |
| P1 | task `d1-export`, query `deploy-trading-check` | open_today = 0 |
| P2 | `d1-export` `migrations-applied`; deploy provenance | exact |
| P3 | `inspect` with `approved_folds` = `7091:1529` (blocking capability codes, the inactive-stock plan and the named refusals of `start`) | none open; the approved pair is listed as a fold, nothing refused |
| P4 | `bookmark` (Time Travel bookmark, encrypted) plus `d1-physical-export` | both recorded |
| P5 | `d1-export` `branch-cutover-inventory`, `branch-identity-precheck`, `cutover-fold-preview` | informational, anomalies 0, `inexact_pairs` 0 |
| P5b | `repair-sk2-check`, then `repair-sk2`, `actor_user_id` = 5 (SK2-REPAIR, owner 7 Oct 2026: product 5357 at Shop, `lib/sk2CleanserRepair.ts`) | check: state `pre` (or `done` on a re-run); repair: state `done`. A re-run writes nothing. Any other state refuses with nothing written: stop and re-plan |
| P6 | `start` with the same `approved_folds` = `7091:1529` (takes a fresh bookmark first, then inspect, then begin; begin folds the approved and exact-twin inactive stock under the fence). Only `inspect` and `start` read `approved_folds`; `resume-until-ready` uses the list sealed in the run. A fold is a committed product merge with its own undo (Products history), so `abort` ends the fence and does not undo it; the run's record is the `branch_cutover_approved_fold` / `branch_cutover_inactive_fold` audit rows. A re-run after a crash is idempotent | phase capturing, revision 0; note the operation id |
| P7 | `d1-export` `branch-cutover-inventory` immediately after `start` (read under the fence) | equals the sealed manifest |
| P8 | `resume-until-ready` with `operation_id` (blank = the one unfinished operation) | phase ready; re-run the same inputs after any stop |
| P9 | `finalize` | phase completed |
| P10 | `d1-export` `branch-cutover-post-checks`, `-post-stock`, `-post-labels` | all PASS |
| P11 | live app check | PASS |
| Stop before the first child | `abort` | phase aborted, fence released |
| Stop at any time | `status` | phase, revision |

Expected runtime: about 9,080 steps at 0.5 to 0.8 s each, 1.3 to 2.0 h (2.5 h with the x1.25 rule), inside one 300 min budget; a
re-dispatch continues the same operation from the journal.
