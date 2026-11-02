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
-- ops:max-rows-read 43907
WITH j AS MATERIALIZED (
  SELECT r.id, r.customer_id AS r_customer, COALESCE(r.total_amount_usd, 0) AS r_total,
    COUNT(s.id) AS matches, MIN(s.customer_id) AS s_customer, MIN(COALESCE(s.total_usd, 0)) AS s_total
  FROM customer_receivables r
  LEFT JOIN sales s INDEXED BY idx_sales_legacy_receipt_number ON s.legacy_receipt_number = r.invoice_no || '@' || substr(r.invoice_date, 1, 10)
  WHERE COALESCE(r.invoice_no, '') <> ''
  GROUP BY r.id
)
SELECT
  g0.ar_rows,
  g0.ar_not_settled,
  g0.ar_paid_ne_total,
  g0.ar_taxable_ne_total,
  g0.ar_vat_nonzero,
  g1.ar_joined,
  g1.ar_unjoined,
  g1.ar_join_multi,
  g1.ar_join_total_mismatch,
  g1.ar_join_customer_mismatch,
  g2.ap_rows,
  g2.ap_not_settled,
  g2.ap_paid_ne_total,
  g2.ap_orphan_supplier
FROM (SELECT
    COUNT(*) AS ar_rows,
    COALESCE(SUM(COALESCE(status, '') <> 'Paid' OR ABS(COALESCE(outstanding_balance_usd, 0)) > 0.005), 0) AS ar_not_settled,
    COALESCE(SUM(ABS(COALESCE(amount_paid_usd, 0) - COALESCE(total_amount_usd, 0)) > 0.005), 0) AS ar_paid_ne_total,
    COALESCE(SUM(ABS(COALESCE(taxable_amount_usd, 0) - COALESCE(total_amount_usd, 0)) > 0.005), 0) AS ar_taxable_ne_total,
    COALESCE(SUM(ABS(COALESCE(vat_amount_usd, 0)) > 0.005), 0) AS ar_vat_nonzero
  FROM customer_receivables) g0,
  (SELECT
    COALESCE(SUM(matches >= 1), 0) AS ar_joined,
    COALESCE(SUM(matches = 0), 0) AS ar_unjoined,
    COALESCE(SUM(matches > 1), 0) AS ar_join_multi,
    COALESCE(SUM(matches = 1 AND ABS(s_total - r_total) > 0.005), 0) AS ar_join_total_mismatch,
    COALESCE(SUM(matches = 1 AND r_customer IS NOT NULL AND s_customer IS NOT NULL AND r_customer <> s_customer), 0) AS ar_join_customer_mismatch
  FROM j) g1,
  (SELECT
    COUNT(*) AS ap_rows,
    COALESCE(SUM(COALESCE(status, '') <> 'Paid' OR ABS(COALESCE(outstanding_balance_usd, 0)) > 0.005), 0) AS ap_not_settled,
    COALESCE(SUM(ABS(COALESCE(amount_paid_usd, 0) - COALESCE(total_amount_usd, 0)) > 0.005), 0) AS ap_paid_ne_total,
    COALESCE(SUM(supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.id = supplier_invoices.supplier_id)), 0) AS ap_orphan_supplier
  FROM supplier_invoices) g2
