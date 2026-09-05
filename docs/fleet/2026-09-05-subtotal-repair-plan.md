# Sep 2-3 zero-subtotal repair plan

Status: local planner and fixture proof only. No production or remote database action is included or authorized by this document.

## Outcome and boundary

Repair exactly sales `16842` through `16863` by setting only `sales.subtotal_usd` to each sale's captured net `SUM(sale_items.total_usd)`. The cohort contains 22 paid legacy sales totaling USD 3,462.00. It excludes sale `16827` and every other sale.

The canonical field interpretation is:

- `sale_items.base_price_usd`: gross unit price before a line discount.
- `sale_items.applied_price_usd`: normally the net unit price actually charged. The affected historical rows do not consistently follow this convention, so it is not repair authority.
- `sale_items.total_usd`: authoritative net line amount for this bounded repair.
- `sales.subtotal_usd`: sum of net product-line totals, before sale-header discounts.
- Report pre-line-discount total: `subtotal_usd + item_discount_usd`. The item discount is then subtracted once.

The repair must not update `sale_items`, `sales.total_*`, paid/change/payment fields, discounts, tax, delivery, stock flags, products, branch stock, lots, allocations, movements, returns, receivables, or fees. It must not synthesize revenue inside a report query.

## Confirmed control totals

These values are validation controls, not a substitute for a fresh preflight manifest:

| Business date (UTC+7) | Sale IDs | Net line subtotal | Item discount |
|---|---:|---:|---:|
| 2026-09-03 | 16842-16858 | USD 1,470.0000 | USD 61.0000 |
| 2026-09-02 | 16859-16863 | USD 1,992.0000 | USD 5.0000 |
| Total | 22 sales | USD 3,462.0000 | USD 66.0000 |

The last read supplied by main also found header subtotal 0, header discount/tax/delivery 0, total USD 3,462, paid USD 3,462, `stock_skipped=0`, exchange rate 4,100, and no `sale_write_revisions` rows. Those observations can become stale. The generated payload is valid only for the exact manifest fingerprint it embeds.

## Artifacts

- `ops/scripts/migration/repair-sep23-subtotals.cjs` validates a fresh JSON manifest and emits an inert JSON payload containing prepared statements.
- `ops/scripts/migration/test-repair-sep23-subtotals.cjs` runs only against an in-memory SQLite fixture through the repository's D1 compatibility batch wrapper.

The planner does not import Wrangler, spawn a command, read credentials, open a database, call a network endpoint, or expose an apply flag. Its CLI can only validate a manifest or create a new payload file with exclusive-create semantics.

Example local validation:

```powershell
node ops/scripts/migration/repair-sep23-subtotals.cjs --manifest C:\absolute\fresh-manifest.json --validate-only
```

Example local payload generation:

```powershell
node ops/scripts/migration/repair-sep23-subtotals.cjs --manifest C:\absolute\fresh-manifest.json --out C:\absolute\reviewed-payload.json
```

Neither command contacts D1 or applies SQL.

## Fresh manifest contract

The operator must obtain all 22 rows from the primary database immediately before review. A suitable read-only query shape is below. It deliberately names only `16842` through `16863`.

```sql
SELECT
  s.id,
  s.receipt_number,
  s.created_at,
  s.updated_at,
  date(datetime(s.created_at, '+7 hours')) AS business_date,
  s.notes,
  COALESCE(s.sale_status, 'completed') AS sale_status,
  printf('%.4f', COALESCE(s.subtotal_usd, 0)) AS expected_subtotal_usd,
  printf('%.4f', COALESCE(s.subtotal_khr, 0)) AS expected_subtotal_khr,
  printf('%.4f', COALESCE((SELECT SUM(COALESCE(si.total_usd, 0)) FROM sale_items si WHERE si.sale_id=s.id), 0)) AS target_subtotal_usd,
  printf('%.4f', COALESCE(s.total_usd, 0)) AS total_usd,
  printf('%.4f', COALESCE(s.total_khr, 0)) AS total_khr,
  printf('%.4f', COALESCE(s.amount_paid_usd, 0)) AS amount_paid_usd,
  printf('%.4f', COALESCE(s.amount_paid_khr, 0)) AS amount_paid_khr,
  printf('%.4f', COALESCE(s.discount_usd, 0)) AS discount_usd,
  printf('%.4f', COALESCE(s.discount_khr, 0)) AS discount_khr,
  printf('%.4f', COALESCE(s.tax_usd, 0)) AS tax_usd,
  printf('%.4f', COALESCE(s.tax_khr, 0)) AS tax_khr,
  printf('%.4f', COALESCE(s.delivery_fee_usd, 0)) AS delivery_fee_usd,
  printf('%.4f', COALESCE(s.delivery_fee_khr, 0)) AS delivery_fee_khr,
  printf('%.4f', COALESCE(s.exchange_rate, 0)) AS exchange_rate,
  COALESCE(s.stock_skipped, 0) AS stock_skipped,
  s.payment_method,
  s.payment_details,
  v.revision AS expected_revision,
  (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id=s.id) AS item_count,
  printf('%.4f', COALESCE((SELECT SUM(COALESCE(si.total_usd, 0)) FROM sale_items si WHERE si.sale_id=s.id), 0)) AS item_total_usd,
  printf('%.4f', COALESCE((SELECT SUM(COALESCE(si.total_khr, 0)) FROM sale_items si WHERE si.sale_id=s.id), 0)) AS item_total_khr,
  printf('%.4f', COALESCE((SELECT SUM(COALESCE(si.product_discount_usd, 0) + COALESCE(si.manual_discount_usd, 0)) FROM sale_items si WHERE si.sale_id=s.id), 0)) AS item_discount_usd,
  printf('%.4f', COALESCE((SELECT SUM(COALESCE(si.product_discount_khr, 0) + COALESCE(si.manual_discount_khr, 0)) FROM sale_items si WHERE si.sale_id=s.id), 0)) AS item_discount_khr
FROM sales s
LEFT JOIN sale_write_revisions v ON v.sale_id=s.id
WHERE s.id BETWEEN 16842 AND 16863
ORDER BY s.id;
```

Place those rows in a JSON object with:

- `schema_version: 1`
- a stable `plan_id` beginning `sep23-subtotal-`
- `generated_at_utc`
- `operator_name`
- a source/provenance explanation in `source_note`
- the exact query rows in `sales`

All money values must remain JSON strings with no more than four decimal places. The planner uses scaled `BigInt` arithmetic for manifest control totals; it does not aggregate money through JavaScript `Number`.

Validation refuses:

- fewer or more than 22 rows, duplicate IDs, any ID outside `16842-16863`, or ID `16827`;
- a date outside the confirmed ID/date partition;
- a target not equal to the net line total and the unchanged sale total;
- total or paid controls other than USD 3,462.0000;
- item discounts other than USD 61.0000 on Sep 3 and USD 5.0000 on Sep 2;
- a nonzero header USD discount, tax, delivery charge, or stock-skipped value;
- an exchange rate other than the observed 4,100.0000;
- missing or malformed notes, timestamps, payment snapshots, item counts, native-currency values, or revision state.

## Atomic execution contract

The payload is designed for the existing `getDb(env).batch(payload.apply.statements)` path. It must be submitted as one complete array to the primary operational database. It must never be split into per-sale calls, wrapped in handwritten `BEGIN`/`COMMIT`, converted to a Wrangler SQL file, or retried statement-by-statement.

This mechanism is evidence-based:

- Cloudflare's current `D1Database.batch()` documentation states that batched statements form a SQL transaction and a failing statement aborts or rolls back the entire sequence: <https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>.
- `cloudflare/src/lib/db.ts` translates every statement to a prepared D1 statement and makes one native `this.d1.batch(prepared)` call.
- `cloudflare/scripts/harness/d1compat.cjs` mirrors that all-or-none behavior for local SQLite tests.
- The focused fixture installs a late failing trigger after several updates would have run and proves that every earlier subtotal and automatic revision is rolled back.

The apply batch contains:

1. A repository-standard `sale_bulk_guards` constraint assertion that accepts only either all 22 exact pre-states with no audit, or all 22 exact post-states with one matching audit. Mixed, missing, stale, or partially audited state throws.
2. Twenty-two prepared `UPDATE sales SET subtotal_usd=...` statements, each additionally guarded by its captured subtotal and revision state.
3. One non-reversible `action_history` record and one aggregate `audit_logs` record containing the manifest SHA-256, all IDs, before/after totals, source note, and the sole changed column.
4. A final constraint assertion requiring all 22 exact post-states and exactly one matching audit/history pair.
5. Guard cleanup inside the same batch.

There is no zero-row-success assumption: the final constraint assertion turns an incomplete update or audit into a thrown error, which makes native D1 roll back the complete batch.

## Idempotency, concurrency, and undo invalidation

The exact same payload is safe to submit again after a lost acknowledgement. Its entry guard recognizes all 22 post-states and the matching manifest digest; the per-sale updates affect zero rows, the audit inserts remain singletons, the final guard succeeds, and revisions do not increment again.

A changed sale, item aggregate, note, payment snapshot, timestamp, currency value, status, stock flag, or revision causes the entire batch to fail. Refreshing the manifest is mandatory; editing a guard to force it through is not permitted.

Migration `0120_sale_bulk_status_actions.sql` defines an `AFTER UPDATE ON sales` trigger that inserts or increments `sale_write_revisions`. Because this repair updates `sales` normally and refuses maintenance/restore mode, every repaired sale's revision advances exactly once. Existing bulk undo members retain their prior revision and therefore fail the established replay guard automatically. The repair does not rewrite or delete earlier `action_history` records.

## Postflight acceptance

Run the payload's read-only `inspect` statement against the primary immediately after the one batch call. Acceptance requires:

- `manifest_rows=22`, `database_cohort_rows=22`, `exact_after_rows=22`, `exact_before_rows=0`;
- current subtotal, sale total, and paid total all `3462.0000`;
- current item discount `66.0000`;
- exactly one matching apply `action_history` row and one matching `audit_logs` row;
- each captured revision advanced by exactly one;
- byte-for-byte snapshots of protected sale fields and all item/stock/payment tables unchanged;
- Sep 3 item discount still `61.0000` and Sep 2 still `5.0000`;
- reports show net sales USD 3,462.00 for the cohort and reconstruct pre-line-discount sales as USD 3,528.00 without subtracting USD 66 twice.

Do not infer deployment or repair completion from payload generation, a commit, or local fixture results.

## Recovery payload

The generated JSON also contains a separate `recovery.statements` array. Recovery is intentionally another forward, audited batch; it is not automatic undo. It may run only after an owner explicitly chooses recovery and a fresh read proves:

- the matching apply audit exists exactly once;
- every sale still matches the captured post-state;
- each revision is exactly the captured revision plus one;
- no matching recovery audit exists, unless this is the identical lost-ack retry.

Recovery changes only `sales.subtotal_usd` back to each captured pre-value, advances each revision once more, and records separate non-reversible recovery history/audit rows. Any intervening write makes recovery fail all-or-none. It never deletes the repair audit or attempts to restore revision counters.

## Not authorized or not done

- No remote reads or writes were performed by this planner task.
- No manifest containing live row details is committed here.
- No payload was applied to local persistent storage or production.
- No change was made to Sales, Returns, report kernels, import writers, stock, payments, migrations, secrets, deployment files, or main-owned progress/scope documents.
- Main must provide and independently review the final fresh manifest and choose whether to authorize any later execution.
