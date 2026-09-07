# Grouped historical branch metadata repair

This private operator replaces the earlier 91-statement global write transaction. The old sealed evidence and failed execution bundles remain preserved in their original directories.

The approved transaction model has 44 independently atomic data groups:

- 43 fee groups contain at most 99 rows. Each group executes one full-row guard, immutable audit inserts, and one exact-ID update in one `D1Database.batch()`.
- One related group contains all 22 Sales headers and 56 sale items. Its two full-row guards, immutable audit, Sales update, and sale-item update execute in one `D1Database.batch()`.
- Completion uses all 45 exact post-state guards and one immutable completion audit in a final batch.

The first fee group also records the immutable plan-start audit. Every group audit stores the overall manifest hash, the group hash, exact pre/post full-row hashes, fixed maintenance attribution, and verified Cloudflare token identity. Audit records are append-only within this workflow.

## Current execution gate

`run-grouped-historical-repair.mjs` intentionally contains null reviewed-manifest and source-lineage pins. Review mode works locally, but apply and recovery modes fail before operator identity verification or remote binding startup. After the active UI merge checkpoint is stable, the execution owner must:

1. Export two fresh full rows reads for the exact fee, Sales, and sale-item targets.
2. Verify the 65-column Sales schema and `creation_snapshot_json = NULL` for every target.
3. Reconcile changed Sales or sale-item product fields against the authenticated merge audit/actions. Changed rows without that proof block the repair.
4. Generate a new grouped manifest with `build-grouped-repair-bundle.mjs`.
5. Independently review the manifest, source lineage, exact ID census, pre/post hashes, groups, and recovery behavior.
6. Pin that exact manifest SHA-256 and source commit in the runner in a separate reviewed commit.

The builder requires two reads for every table and rejects any difference. Its output contains IDs and hashes, not complete row contents. It will not overwrite an existing output directory.

## Resume and ambiguity rules

Before each group, the operator reads only that group and classifies it:

- no apply/recovery audit and exact pre-state: pending;
- exactly one apply audit and exact post-state: applied;
- exactly one apply and recovery audit and exact pre-state: recovered;
- any other combination: inconsistent and blocked.

If the binding response is ambiguous, the operator reads that exact group again. A persisted audit plus exact post-state is accepted as committed, but the invocation pauses before the next group. Exact pre-state with no audit also stops and requires a new explicit operator invocation. Every other outcome requires manual investigation. It never retries or advances after ambiguity within the same invocation.

## Recovery

Recovery is explicit per group and additionally requires `--confirm-recovery`. The recovery batch requires the exact post-state and one apply audit, appends a recovery audit, and restores only the reviewed branch fields. It does not delete the original audit. The related Sales and sale-item group recovers atomically.

Time Travel remains the database-wide disaster-recovery mechanism. Per-group logical recovery is preferable for a verified partial execution because it avoids reverting unrelated business writes.

## Local verification

```powershell
node outputs/takeover-20260907/historical-repair-grouped/verify-grouped-repair.mjs
```

The verifier uses a local SQLite fixture with all 4,333 targets and Sales column 65. It never loads Wrangler, opens a remote binding, or contacts Cloudflare.
