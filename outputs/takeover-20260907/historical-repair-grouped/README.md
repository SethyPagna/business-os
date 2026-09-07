# Grouped historical branch metadata repair

This private operator replaces the earlier 91-statement global write transaction. The old sealed evidence and failed execution bundles remain preserved in their original directories.

The approved transaction model has 44 independently atomic data groups:

- 43 fee groups contain at most 99 rows. Each group executes one full-row guard, immutable audit inserts, and one exact-ID update in one `D1Database.batch()`.
- One related group contains all 22 Sales headers and 56 sale items. Its two full-row guards, immutable audit, Sales update, and sale-item update execute in one `D1Database.batch()`.
- Completion uses all 45 exact post-state guards, the exact plan-start and per-group apply audit payloads, absence of recovery audits, and one immutable completion audit in a final batch.

The first fee group also records the immutable plan-start audit. Every group audit stores the overall manifest hash, the group hash, exact pre/post full-row hashes, fixed maintenance attribution, and verified Cloudflare token identity. Audit records are append-only within this workflow.

## Reviewed execution pins

`run-grouped-historical-repair.mjs` pins reviewed manifest `dcef2e38be7ccd7eb7c2cc4524a122a6b10770202cdb78e1cf787af2a2444e1d` and source lineage `02eecbe3833bbcee112b4af424a7582dcbb11b22`. Every other manifest fails before operator identity verification or remote binding startup. Accounting review confirmed the exact ID census, 65-column Sales schema, null target creation snapshots, full pre/post hashes, and unchanged target fields after the eight completed UI merge groups.

Immediately before execution, the execution owner must verify that the current production schema still matches the reviewed schema hash and that no migration is running concurrently. The operator then checks the pinned manifest, exact command confirmations, Cloudflare operator identity, and fresh full-row state. Any target drift or audit mismatch blocks that group atomically.

The builder used two reads for every table and rejected any difference. Its output contains IDs and hashes, not complete row contents. It cannot overwrite an existing output directory.

## Resume and ambiguity rules

Before each group, the operator reads only that group and classifies it:

- no apply/recovery audit, no terminal completion, and exact pre-state: pending;
- exactly one expected apply audit payload and exact post-state: applied;
- exactly one expected apply and recovery audit payload and exact pre-state: recovered;
- any other combination: inconsistent and blocked.

If the binding response is ambiguous, the operator reads that exact group again. A persisted audit plus exact post-state is accepted as committed, but the invocation pauses before the next group. Exact pre-state with no audit also stops and requires a new explicit operator invocation. Every other outcome requires manual investigation. It never retries or advances after ambiguity within the same invocation.

## Recovery

Recovery is explicit per group and additionally requires `--confirm-recovery`. The recovery batch requires the exact post-state and exactly one apply audit with the reviewed payload, appends a recovery audit, and restores only the reviewed branch fields. It does not delete the original audit. The related Sales and sale-item group recovers atomically.

The related group updates 22 Sales rows and 56 sale-item rows. Migration 0120 revision triggers therefore advance `sale_write_revisions` 78 times on apply and another 78 times if that group is recovered. Those monotonic increments intentionally invalidate stale compare-and-swap inputs and undo snapshots. Recovery must not reset, decrement, or otherwise rewrite revision counters.

Time Travel remains the database-wide disaster-recovery mechanism. Per-group logical recovery is preferable for a verified partial execution because it avoids reverting unrelated business writes.

## Local verification

```powershell
node outputs/takeover-20260907/historical-repair-grouped/verify-grouped-repair.mjs
```

The verifier uses a local SQLite fixture with all 4,333 targets and Sales column 65. It never loads Wrangler, opens a remote binding, or contacts Cloudflare.
