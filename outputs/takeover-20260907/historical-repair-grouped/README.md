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

## Wrangler file-import transport

`wrangler-file-import-transport.mjs` is the reviewed fallback for the unreliable `getPlatformProxy` remote-binding bridge. It does not use that bridge. Read-only state inspection goes through single-`SELECT` D1 REST calls; each write unit is passed separately to the installed Wrangler 4.116.0 CLI as `d1 execute --remote --file`.

This distinction is deliberate. In Wrangler 4.116.0, local file execution splits SQL and calls a binding batch, while remote file execution hashes and uploads the raw file and drives the D1 `/import` `init`, `ingest`, and `poll` protocol. Cloudflare documents that imports block D1 for their duration. Wrangler and Cloudflare's D1 getting-started guide state that an import which fails to complete returns the database to its original state. Cloudflare's import guide also requires removing `BEGIN TRANSACTION` and `COMMIT` because D1 owns the transaction.

Primary references:

- [Wrangler 4.116.0 remote file implementation](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.116.0/packages/wrangler/src/d1/execute.ts#L2287-L2489)
- [Wrangler transaction handling](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.116.0/packages/wrangler/src/d1/trimmer.ts#L289-L322)
- [Cloudflare D1 remote file example and rollback message](https://developers.cloudflare.com/d1/get-started/#5-deploy-your-application)
- [Cloudflare D1 import API and blocking behavior](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/)
- [Cloudflare D1 import transaction restriction](https://developers.cloudflare.com/d1/best-practices/import-export-data/#convert-sqlite-database-files)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

The transport preserves the 44 reviewed business groups. It materializes only the single positional-JSON guard parameter into a quoted SQL string, rejects every remaining unbound placeholder and transaction/attachment statement, enforces LF-only output, and hashes the exact ephemeral SQL bytes. It uses these atomic file shapes:

- first fee group: guard, plan-start audit, group audit, update (4 statements);
- remaining fee groups: guard, group audit, update (3 statements each);
- related Sales and sale-item group: two guards, group audit, two updates (5 statements);
- completion: 45 exact full-row/audit guards and one completion audit (46 statements).

Recovery adds a leading atomic guard that requires the plan-completion audit to be absent, followed by the existing exact post-state guard or guards, recovery audit, and updates. A fee recovery therefore has 4 statements and the related Sales/item recovery has 6. A completed plan is terminal for this operator; it will not create a recovery audit or restore pre-state beneath an immutable completion record.

The current reviewed inputs materialize to at most 37,800 bytes per apply-group file and 40,460 bytes per recovery-group file. The largest apply-group statement is 23,978 bytes and the largest recovery statement is 26,517 bytes. The completion file is 809,002 bytes and its largest statement is 24,907 bytes. These are below the operator's 1,000,000-byte file ceiling and Cloudflare's documented 100,000-byte per-statement and 5 GB file-import limits.

Wrangler returns aggregate import metadata, not per-statement change counts. The transport therefore requires the exact core audit and full-row classification after every import. A confirmed CLI response must report the exact query count and a final bookmark, then the post-state must be exact. A process, network, polling, malformed-output, or post-read failure pauses the operator before the next group. It never blind-retries an ambiguous file. The independent REST postchecker remains the authority for manual reconciliation before an explicit resume.

Wrangler 4.116's installed command source disables its banner and progress logs in JSON mode, then restores the inherited logger level before writing one pretty-printed JSON array through the logger. An inherited `WRANGLER_LOG=error` or `none` can therefore suppress that final JSON even when the import succeeds. The transport pins only the child process to `WRANGLER_LOG=log`, `WRANGLER_WRITE_LOGS=false`, and `NO_COLOR=1`; this preserves the authenticated environment, emits the result, prevents a Wrangler disk log, and keeps progress suppressed during JSON execution.

The transport accepts that JSON document directly. As a narrow compatibility fallback, it also accepts exactly the standard Wrangler 4.116 banner bytes followed by that one document, plus an optional leading UTF-8 BOM. It rejects arbitrary prefixes, altered banners, trailing output, and multiple JSON documents. An unrecognized successful-process framing reports only its byte count, SHA-256, and a fixed framing class; it never returns the raw stdout.

Every write invocation requires the reviewed manifest/source pins, the existing token-identity check, the run ID, manifest hash, recovery bookmark, and explicit acknowledgement that file import temporarily makes D1 unavailable. SQL files exist only in a restricted temporary directory and are deleted after the Wrangler process exits. The operator never prints SQL, row contents, or the API token.

Local adversarial verification:

```powershell
node outputs/takeover-20260907/historical-repair-grouped/verify-wrangler-file-import-transport.mjs
```

This verifier covers apostrophes, Khmer text, JSON/control characters, SQL-injection sentinels, placeholder and transaction refusal, LF-only hashing, guard and later-statement rollback, independent group boundaries, aggregate-only result handling, temporary-file cleanup, and pause behavior after ambiguous responses. It mocks Wrangler and never opens a remote binding or performs a production write.
