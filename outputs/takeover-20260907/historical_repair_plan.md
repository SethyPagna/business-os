# Historical Shop metadata correction plan

Prepared 2026-09-07 from sealed read-only production evidence. The user has already authorized correction of this past branch metadata. Execution remains gated by current-state checks, a reviewed execution confirmation, a Time Travel bookmark, the fixed maintenance service identity, and verification of the Cloudflare API token identity that performs the operation. A low-write period is preferred, but the operator does not claim or require a global application pause. Preparing and testing this bundle did not update D1, deploy code, run a migration, or synchronize secrets.

## Frozen correction

| Target | Exact before state | Change | Rows |
|---|---|---|---:|
| `fees` IDs sealed in `historical-repair-evidence/fee-null-branch-page-01.json` through `-18.json` | `branch_id IS NULL`; 2,536 delivery and 1,719 expense rows | `branch_id = 2` | 4,255 |
| `sales` IDs 16842–16863 | `branch_id IS NULL AND branch_name IS NULL`; all 22 completed | `branch_id = 2, branch_name = 'Shop'` | 22 |
| `sale_items` IDs 40134–40189 sealed in the line snapshot | `branch_id IS NULL`; each belongs to sale 16842–16863 | `branch_id = 2` | 56 |

The correction changes 4,333 rows and only those branch columns. It preserves timestamps, prices, totals, statuses, delivery fields, stock, batches, allocations, movements, returns, driver IDs, and every `sale_id`.

`branches.id = 2` is the active default branch named `Shop`. The user's rule that sales and expenses originate from Shop supplies the business provenance. No sale, driver, stock, return, or transfer relationship is inferred from that rule.

## Sealed candidate evidence

`historical-repair-evidence/integrity.json` records these identities:

- fee `id:fee_type` SHA-256: `fa9ff710593bb8b2e87c158847364499e3760664b27044a651a22b30d39e3c18`
- ordered fee ID SHA-256: `88c2f2ac33825c86dcffa77a510a30fae99b013a70b861a104deb339d7bf2b0e`
- sale-header projection SHA-256: `e7a5cd2827b20059348c82c1d4c0dd39d67be7a86ad24d0682974e1a473ba472`
- sale-line projection SHA-256: `d49e074c731d3fa96380784e2b481049c51d1b925e17fe84a350ac44a23852e9`

The earlier fee pages contain only `id` and `fee_type`; the sale files are also projections. These hashes prove candidate identity but are not full-row preconditions. A runnable bundle therefore cannot be generated from them alone.

[`repair-manifest.json`](historical-repair-evidence/repair-manifest.json) is the machine-readable frozen target. [`build-repair-bundle.mjs`](historical-repair-evidence/build-repair-bundle.mjs) verifies every sealed file hash and ID before generating anything. It validates all IDs as positive safe integers and creates 43 fee update chunks of at most 99 IDs, followed by one 22-ID sale update and one 56-ID sale-item update. The old 250-ID parameter design is retired.

## Execution identity and fresh full-row preconditions

This one private, owner-authorized historical correction uses a truthful maintenance service identity rather than impersonating a Business OS user:

- `user_id = NULL`
- `user_name = 'Codex maintenance (owner-authorized)'`
- actor key `codex-maintenance-owner-authorized`
- origin `private_historical_repair_operator`
- task `historical-shop-branch-metadata-20260907`
- the verified Cloudflare account ID and API token ID used for the run

The service identity is compiled into the builder and operator as a one-entry allowlist. Execution input cannot supply an arbitrary actor object, user ID, display name, origin, task, or account. `audit_logs.user_id` and `audit_logs.user_name` are nullable in `cloudflare/migrations/0001_init.sql`, and no later migration adds a constraint to those columns. Normal duplicate merging and other application changes continue through the authenticated Business OS UI; this service identity is limited to this reviewed branch-metadata plan.

After the release is verified, preferably during a low-write period:

1. Record a fresh D1 Time Travel bookmark.
2. Run the operator's read-only identity check through the existing Wrangler token wrapper. Record only the returned Cloudflare account ID and API token ID; never copy the token into an input, artifact, command argument, or log.
3. Export `SELECT *` for the exact fee, sale, and sale-item IDs from the manifest, ordered by `id`. Large fee exports may be paged, but each page must use exact manifest IDs rather than `OFFSET` over a changing predicate.
4. Repeat the three full-row exports immediately before apply.
5. Run the local builder with an execution input that names both reads, the fixed service actor key, the verified Cloudflare operator identity, a unique run ID, and the Time Travel bookmark.

The builder recursively sorts object keys, preserves JSON scalar types and null, sorts rows by numeric `id`, then hashes the UTF-8 `JSON.stringify` value with SHA-256 and no trailing line feed. It also requires the exact complete column sets captured in `production-schema.json`. It stops on a missing/extra ID, duplicate ID, altered sealed projection, non-null target field, incomplete `SELECT *`, or any hash difference between read 1 and read 2.

Execution input shape:

```json
{
  "run_id": "historical-shop-branch-20260907-<unique-id>",
  "service_actor": "codex-maintenance-owner-authorized",
  "cloudflare_operator": {
    "account_id": "743e5b727d139e85ed11679097f6f99e",
    "api_token_id": "<verified-active-token-id>"
  },
  "time_travel_bookmark": "<fresh-bookmark>",
  "full_row_exports": {
    "read_1": {
      "fees": "fees-full-read-1.json",
      "sales": "sales-full-read-1.json",
      "sale_items": "sale-items-full-read-1.json"
    },
    "read_2": {
      "fees": "fees-full-read-2.json",
      "sales": "sales-full-read-2.json",
      "sale_items": "sale-items-full-read-2.json"
    }
  }
}
```

Paths are relative to the execution-input file. Each export may be a plain JSON row array or one D1 query response. If fee reads are captured in multiple small API files, concatenate them locally in manifest order before building; do not change or retype values.

Generate a runnable, reviewable local bundle:

```powershell
node outputs/takeover-20260907/historical-repair-evidence/build-repair-bundle.mjs `
  --execution-input <local-execution-input.json> `
  --output-dir <local-output-directory>
```

Without `--execution-input`, the builder regenerates the manifest and the two checked-in review templates. Those templates deliberately fail at their first statement so they cannot be mistaken for an approved execution bundle.

Run the local synthetic transaction, rollback, drift, and hash-gate rehearsal with:

```powershell
node outputs/takeover-20260907/historical-repair-evidence/verify-repair-bundle.mjs
```

The verifier uses local SQLite and a mocked D1 binding. It verifies the repair and recovery row counts, full-row hashes, guard rollback, actor allowlist, token-error redaction, bundle tamper rejection, confirmation gates, and exactly one 91-statement `batch()` call containing 45 guards followed by the 46 hash-bound writes. It does not open a remote binding.

## Private operator

[`run-historical-repair.mjs`](historical-repair-evidence/run-historical-repair.mjs) uses Wrangler's official `getPlatformProxy()` API with [`operator-wrangler.toml`](historical-repair-evidence/operator-wrangler.toml). That configuration contains exactly one binding: the reviewed production D1 database, explicitly marked `remote = true`. It contains no variables, secrets, routes, KV, R2, AI, queues, services, or deploy configuration.

The default operator mode validates the frozen manifest, execution-manifest fingerprint, batch-envelope fingerprint, direct 46-statement-array fingerprint, statement allowlist, service identity, Cloudflare operator metadata, and Time Travel bookmark. It then exits with `remote_binding_opened: false` and `production_write: false`:

```powershell
node outputs/takeover-20260907/historical-repair-evidence/run-historical-repair.mjs `
  --bundle <local-execution-bundle>
```

The existing wrapper may be used for the separate read-only token identity check. It loads the token from the gitignored `cloudflare/.wrangler-auth.local`; the operator never prints the token or Cloudflare's upstream error body:

```powershell
node cloudflare/scripts/with-wrangler-auth.cjs node `
  outputs/takeover-20260907/historical-repair-evidence/run-historical-repair.mjs --identify
```

There is no generic SQL option. Apply requires `--apply` plus all five exact confirmations: reviewed execution, run ID, manifest SHA-256, direct write-batch SHA-256, and Time Travel bookmark. The reviewed-execution flag confirms the exact prepared inputs; it does not assert that all application writes are paused. The active token ID must equal the ID frozen in the execution manifest before `getPlatformProxy()` opens the remote D1 binding. Before any apply invocation, the release owner must independently review the exact committed operator and newly generated execution bundle. The apply command must be constructed from that reviewed bundle at the authorized maintenance window; it is deliberately omitted from this prepared plan so no placeholder can be copied into a production command.

## Atomic apply and audit

The generated repair SQL is executable against a local SQLite rehearsal database. Production execution preserves the hash-bound 46 descriptors in `d1-batch.json.statements` as the write plan. Immediately after reading and validating the current target rows, the operator builds 45 full-row read guards: 43 fee chunks of at most 99 rows, one sales guard, and one sale-items guard. Each guard binds one JSON row-array parameter through `json_each(?)` and compares every column from the pinned production-schema allowlist with SQLite `IS`. Row values never enter SQL text.

The operator prepends those 45 guards to the 46 prepared write statements and submits all 91 statements through one `D1Database.batch()` call. Every guard must report zero changes. If any target row changes after the pre-read, the corresponding guard raises an error before the audit insert or branch updates, rolling back the whole batch. Unrelated application writes can continue; a legitimate concurrent edit to one of the target rows is preserved and causes this repair attempt to refuse cleanly. D1 batch is the transaction boundary; the operator never sends the local `BEGIN IMMEDIATE` or `COMMIT` lines to D1. Cloudflare documents that `D1Database.batch()` runs statements sequentially as a transaction and aborts or rolls back the entire sequence when a statement fails: <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>.

Before apply, prove that the exact account, database, remote-binding proxy, and `D1Database.batch()` transport accept at least 91 statements by running the dedicated read-only probe through the existing token wrapper:

```powershell
node cloudflare/scripts/with-wrangler-auth.cjs node `
  outputs/takeover-20260907/historical-repair-evidence/probe-historical-repair-capacity.mjs
```

The probe accepts no arguments and submits one batch of 91 parameterized `SELECT` statements. It checks all returned markers, requires every statement to report zero changes, and disposes the proxy on success or failure. This reliably exercises the same per-invocation statement-count boundary and remote D1 batch path as the operator's 91-statement atomic call. It does not prove write permission, repair SQL correctness, payload size, or execution duration; those remain covered by the reviewed bundle and apply-time gates. Cloudflare currently documents a 50-query limit for Workers Free and 1,000 for Workers Paid: <https://developers.cloudflare.com/d1/platform/limits/>. Do not split the repair batch to fit a lower limit, because that would remove the atomic race protection.

Cloudflare documents that `getPlatformProxy()` is a Node.js API, accepts an exact Wrangler `configPath`, supports D1 bindings, and can enable remote bindings: <https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy>. The REST D1 query endpoint accepts a batch-shaped request but its API reference does not state the same rollback guarantee, so this plan does not use the REST query endpoint, dashboard SQL, `wrangler d1 execute --remote`, or `D1Database.exec()` as its production transaction boundary: <https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/>.

The first write statement, after all 45 guards, inserts one `historical_branch_metadata_repair` audit row containing:

- nullable maintenance service actor ID and fixed name;
- maintenance origin, plan/task ID, and owner-authorization basis;
- verified Cloudflare account ID and API token ID, without the token value;
- unique run ID;
- repair-manifest SHA-256;
- Time Travel bookmark;
- all three exact before full-row hashes;
- exact row counts and columns changed.

That audit statement retains its branch-state guard. The preceding full-row guards additionally protect every expected column against changes between pre-read and batch execution. Any guard or later SQL failure rolls back the audit row and all branch updates.

Expected results are 45 zero-change full-row guards, one audit insert, fee update counts matching the 43 manifest chunks, 22 changed sales, and 56 changed sale items. Treat any transport ambiguity or per-statement count mismatch as a failed run and follow recovery assessment before retrying. Never broaden a predicate to make a count pass.

## Postchecks

Immediately after the batch:

```sql
SELECT COUNT(*) FROM fees
WHERE id IN (<exact manifest fee IDs>) AND branch_id = 2;
-- 4255

SELECT COUNT(*) FROM sales
WHERE id IN (16842,16843,16844,16845,16846,16847,16848,16849,16850,16851,
             16852,16853,16854,16855,16856,16857,16858,16859,16860,16861,
             16862,16863)
  AND branch_id = 2 AND branch_name = 'Shop';
-- 22

SELECT COUNT(*) FROM sale_items
WHERE id BETWEEN 40134 AND 40189 AND branch_id = 2;
-- 56; additionally compare the exact manifest ID set

SELECT COUNT(*) FROM sale_item_batch_allocations a
JOIN sale_items i ON i.id = a.sale_item_id
WHERE i.id BETWEEN 40134 AND 40189;
-- still 0
```

Export the exact three `SELECT *` sets again. Record their full-row hashes. Normalize only the corrected fields back to their before values in memory (`fees.branch_id = null`, `sales.branch_id = null`, `sales.branch_name = null`, `sale_items.branch_id = null`) and require all three normalized hashes to equal the execution manifest's before hashes. This proves that no other target value changed. Confirm one audit row matches the exact run ID and manifest hash.

## Recovery

There is no application `action_history` undo for this direct metadata repair.

The initial execution bundle contains a recovery file that deliberately aborts. To generate the runnable logical recovery batch, supply the execution manifest and two fresh post-state `SELECT *` reads:

```json
{
  "execution_manifest": "execution-bundle/execution-manifest.json",
  "full_row_exports": {
    "read_1": { "fees": "post-fees-1.json", "sales": "post-sales-1.json", "sale_items": "post-items-1.json" },
    "read_2": { "fees": "post-fees-2.json", "sales": "post-sales-2.json", "sale_items": "post-items-2.json" }
  }
}
```

```powershell
node outputs/takeover-20260907/historical-repair-evidence/build-repair-bundle.mjs `
  --recovery-input <local-recovery-input.json> `
  --output-dir <local-recovery-output-directory>
```

The builder requires both post reads to match, rebases the corrected branch fields to null in memory, and requires the resulting full-row hashes to equal the recorded before hashes. It also verifies the execution-manifest fingerprint. The generated recovery batch uses the same exact ID chunks, restores only the branch columns, and appends a `historical_branch_metadata_repair_recovery` audit row; it does not delete the original audit evidence.

If the post-state hashes differ, a target received a later branch edit, or the audit marker is absent, do not run logical recovery. Use the recorded Time Travel bookmark only after assessing unrelated writes since the bookmark, because a restore rewinds the whole database. A failed D1 batch should already be atomic; Time Travel is for an ambiguous transport result or a failed postcondition, not routine rollback.

## Excluded and unresolved records

- Sale 16894 and its line 40268 have Warehouse return, allocation, and movement provenance. Leave them unchanged.
- Sale 16896 has mixed line provenance: Shop lines 40270/40272 and Warehouse line 40271. Leave its header and lines unchanged until primary evidence determines the intended mixed-fulfillment header.
- All sealed fee rows have `sale_id IS NULL`. No deterministic sale mapping exists. Do not invent sale IDs.
- The 21 delivery sales without drivers have no exact driver provenance. Do not assign drivers.
- Sales 16827, 16830, 16831, 16832, 16833, and 16917 have no item lines. Do not fabricate products, totals, stock, or status.

These unresolved mappings are excluded from this authorized branch-only correction. They do not require delaying the proven 4,333-row metadata repair once its current-state gates pass.
