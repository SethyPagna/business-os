-- health-legacy-ledgers: the old system's invoices, carried twice (DATA-MATCH DM-13).
-- sales (legacy_receipt_number 'NNNNNN@YYYY-MM-DD') and customer_receivables
-- (invoice_no 'NNNNNN' + invoice_date) are two imports of the same invoices; the
-- only key is the composite one below (invoice_no alone is shared by ~80% of rows
-- across years). Owner rule 2026-09-18: every imported balance is settled.
--   ar_not_settled / ap_not_settled   status not 'Paid' or outstanding above half a cent
--   ar_paid_ne_total / ap_paid_ne_total
--   ar_taxable_ne_total, ar_vat_nonzero   the measured import convention
--   ar_joined          POSITIVE CONTROL: receivables that find their sale (must stay > 0;
--                      0 means the join broke, not that the data is clean)
--   ar_join_total_mismatch   joined pairs whose totals differ by more than half a cent
--   ar_join_customer_mismatch  both sides linked to different customers (a merge moved one)
--   ar_join_multi      receivables matching more than one sale
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH j AS MATERIALIZED (
  SELECT r.id, r.customer_id AS r_customer, COALESCE(r.total_amount_usd, 0) AS r_total,
    COUNT(s.id) AS matches, MIN(s.customer_id) AS s_customer, MIN(COALESCE(s.total_usd, 0)) AS s_total
  FROM customer_receivables r
  LEFT JOIN sales s ON s.legacy_receipt_number = r.invoice_no || '@' || substr(r.invoice_date, 1, 10)
  WHERE COALESCE(r.invoice_no, '') <> ''
  GROUP BY r.id
)
SELECT
  (SELECT COUNT(*) FROM customer_receivables) AS ar_rows,
  (SELECT COUNT(*) FROM customer_receivables WHERE COALESCE(status, '') <> 'Paid' OR ABS(COALESCE(outstanding_balance_usd, 0)) > 0.005) AS ar_not_settled,
  (SELECT COUNT(*) FROM customer_receivables WHERE ABS(COALESCE(amount_paid_usd, 0) - COALESCE(total_amount_usd, 0)) > 0.005) AS ar_paid_ne_total,
  (SELECT COUNT(*) FROM customer_receivables WHERE ABS(COALESCE(taxable_amount_usd, 0) - COALESCE(total_amount_usd, 0)) > 0.005) AS ar_taxable_ne_total,
  (SELECT COUNT(*) FROM customer_receivables WHERE ABS(COALESCE(vat_amount_usd, 0)) > 0.005) AS ar_vat_nonzero,
  (SELECT COUNT(*) FROM j WHERE matches >= 1) AS ar_joined,
  (SELECT COUNT(*) FROM j WHERE matches = 0) AS ar_unjoined,
  (SELECT COUNT(*) FROM j WHERE matches > 1) AS ar_join_multi,
  (SELECT COUNT(*) FROM j WHERE matches = 1 AND ABS(s_total - r_total) > 0.005) AS ar_join_total_mismatch,
  (SELECT COUNT(*) FROM j WHERE matches = 1 AND r_customer IS NOT NULL AND s_customer IS NOT NULL AND r_customer <> s_customer) AS ar_join_customer_mismatch,
  (SELECT COUNT(*) FROM supplier_invoices) AS ap_rows,
  (SELECT COUNT(*) FROM supplier_invoices WHERE COALESCE(status, '') <> 'Paid' OR ABS(COALESCE(outstanding_balance_usd, 0)) > 0.005) AS ap_not_settled,
  (SELECT COUNT(*) FROM supplier_invoices WHERE ABS(COALESCE(amount_paid_usd, 0) - COALESCE(total_amount_usd, 0)) > 0.005) AS ap_paid_ne_total,
  (SELECT COUNT(*) FROM supplier_invoices WHERE supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.id = supplier_invoices.supplier_id)) AS ap_orphan_supplier
