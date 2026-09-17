-- Repair the 367 imported customer_receivables rows whose paid amount was
-- multiplied by the old system's own AR-export defect, so the "customer
-- balance" the Customers/Suppliers surfaces render never again shows a
-- customer as owed (negative outstanding) money the shop actually collected.
--
-- Owner (Sep 18 2026, program 11 message P): "there seems to be a status
-- called customer balance...it should all be paid no owed. also, these are
-- all imported from old system. check the data."
--
-- ROOT CAUSE (verified read-only against production Sep 18 2026, P11-12).
-- The old system's "account-receivable-report-2021-2026.xls" export lists one
-- row per INVOICE LINE, not one row per invoice: "Taxable Amount"/"VAT
-- Amount" are correctly split per line, but "Amount Paid" repeats the FULL
-- invoice-level payment on every one of that invoice's lines. The importer
-- that turned each report row into its own customer_receivables row
-- (ops/scripts/migration/import-aug31-legacy-reports.mjs) took that repeated
-- "Amount Paid" figure at face value, so a multi-line invoice's paid amount
-- landed multiplied by its own line count: 367 rows across 243 customers came
-- out with amount_paid_usd an exact integer multiple of total_amount_usd
-- (e.g. total 5370 paid 10740 = 2x; total 780 paid 4680 = 6x; total 624 paid
-- 3744 = 6x -- 355 of the 367 are a clean integer multiple), every one of
-- them already carrying status='Paid', and a NEGATIVE outstanding_balance_usd
-- summing to -$98,742.52 across the 367. The true state these rows represent
-- is "paid in full, nothing outstanding" -- matching the project rule that
-- everything carried over from the old system arrived settled (see
-- docs/history/session-log.md and the customer_receivables ledger's own
-- migration 0094 note). cloudflare/src/lib/receivablesPaidGuard.ts is the
-- reusable guard a future AR (re-)import must route through so this cannot
-- recur; this migration is the one-time repair of the rows already imported.
--
-- SCOPE, DELIBERATELY NARROW. Only `status = 'Paid' AND outstanding_balance_
-- usd < 0` customer_receivables rows are touched -- exactly the shape
-- verified above, and exactly 367 rows in production. Nothing else on the
-- ledger (including the 0 rows with a genuinely positive/owed balance) is
-- touched.
--
-- SUPPLIER SIDE -- FLAGGED, NOT TOUCHED. supplier_invoices has 4 rows still
-- marked 'Outstanding' totalling $489 from 'shop-account-payable-report-all
-- .xls'. These are NOT the same defect: the source report itself recorded
-- them as outstanding, so this migration deliberately leaves them alone and
-- flags them to the owner for a ruling rather than silently zeroing a balance
-- the old system itself said was unpaid.
--
-- REVERSIBILITY. customer_receivables_paid_multiple_repair keeps the pre-
-- repair amount_paid_usd/outstanding_balance_usd beside the id of every row
-- touched, so a single UPDATE joining that table restores the previous state
-- exactly (see the reversal statement in the header of this file's companion
-- test, cloudflare/scripts/test-migration-0181-receivables-paid-repair-pure
-- .cjs). The mapping is computed in ONE INSERT ... SELECT before any
-- customer_receivables row changes, so it reads the pre-repair values and
-- cannot drift while the UPDATE runs. Re-running this migration against an
-- already-repaired database changes nothing (guarded by the mapping table).
--
-- PRE ASSERTION (run read-only immediately before applying):
--   SELECT COUNT(*), ROUND(SUM(outstanding_balance_usd), 2)
--     FROM customer_receivables WHERE status = 'Paid' AND outstanding_balance_usd < 0;
--   -- expected: 367 | -98742.52
-- POST ASSERTION (same query): expected 0 | NULL (no matching rows), and
--   SELECT COUNT(*) FROM customer_receivables_paid_multiple_repair;  -- expected 367
--   SELECT COUNT(*) FROM customer_receivables WHERE outstanding_balance_usd < 0;  -- expected 0
--   SELECT COUNT(*) FROM supplier_invoices WHERE status = 'Outstanding';  -- expected 4 (untouched)
--
-- RECOVERY. If this repair needs to be undone in full:
--   UPDATE customer_receivables
--      SET amount_paid_usd = (SELECT r.old_amount_paid_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id),
--          outstanding_balance_usd = (SELECT r.old_outstanding_balance_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id)
--    WHERE id IN (SELECT receivable_id FROM customer_receivables_paid_multiple_repair);

CREATE TABLE IF NOT EXISTS customer_receivables_paid_multiple_repair (
  receivable_id INTEGER PRIMARY KEY,
  old_amount_paid_usd REAL NOT NULL,
  old_outstanding_balance_usd REAL NOT NULL,
  new_amount_paid_usd REAL NOT NULL,
  new_outstanding_balance_usd REAL NOT NULL,
  reason TEXT NOT NULL,
  repaired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO customer_receivables_paid_multiple_repair
  (receivable_id, old_amount_paid_usd, old_outstanding_balance_usd, new_amount_paid_usd, new_outstanding_balance_usd, reason)
SELECT id, amount_paid_usd, outstanding_balance_usd, total_amount_usd, 0,
       'legacy_ar_export_per_line_paid_multiple_repair_2026_09_18'
  FROM customer_receivables
 WHERE status = 'Paid'
   AND outstanding_balance_usd < 0
   AND id NOT IN (SELECT receivable_id FROM customer_receivables_paid_multiple_repair);

-- The repair itself. Guarded by the mapping table (joined by id and by the
-- pre-repair amount_paid_usd it captured), so re-running this migration
-- against an already-repaired database changes nothing.
UPDATE customer_receivables
   SET amount_paid_usd = (SELECT r.new_amount_paid_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id),
       outstanding_balance_usd = (SELECT r.new_outstanding_balance_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id)
 WHERE id IN (SELECT receivable_id FROM customer_receivables_paid_multiple_repair)
   AND amount_paid_usd = (SELECT r.old_amount_paid_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id)
   AND outstanding_balance_usd = (SELECT r.old_outstanding_balance_usd FROM customer_receivables_paid_multiple_repair r WHERE r.receivable_id = customer_receivables.id);

INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT NULL, 'migration:0181_customer_receivables_paid_multiple_repair', 'repair_receivable_paid_multiple',
  'customer_receivables', CAST(r.receivable_id AS TEXT),
  json_object('source', 'repair-0181', 'reason', r.reason),
  'customer_receivables', CAST(r.receivable_id AS TEXT),
  json_object('amount_paid_usd', r.old_amount_paid_usd, 'outstanding_balance_usd', r.old_outstanding_balance_usd),
  json_object('amount_paid_usd', r.new_amount_paid_usd, 'outstanding_balance_usd', r.new_outstanding_balance_usd)
FROM customer_receivables_paid_multiple_repair r
WHERE r.reason = 'legacy_ar_export_per_line_paid_multiple_repair_2026_09_18'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs l
    WHERE l.action = 'repair_receivable_paid_multiple' AND l.entity_id = CAST(r.receivable_id AS TEXT)
  );
