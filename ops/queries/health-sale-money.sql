-- health-sale-money: sale headers against their own lines and the payment rule
-- (DATA-MATCH DM-07, DM-08). v1 = money_precision_version 1, written by
-- lib/saleTotals.ts computeSaleTotalsV1 and checked by
-- lib/saleMoneyPrecision.ts validateSaleMoneySnapshot, so every v1_* column must be 0.
-- Needs migrations 0158, 0260 (returns.refund_currency / owed_reduction_usd) and 0271 (sales.payments_version,
-- sale_payment_events).
-- The payment state is the two-status reading of lib/saleStatusResolution.ts
-- saleStoredState: awaiting_payment, or a retired return label (partial_return,
-- returned; live rows keep them until the held 0264) whose status_before_return
-- was awaiting_payment, reads Not Paid; every other non-cancelled sale reads paid.
-- Historical imports (legacy_receipt_number, or the sales import's own
-- client_request_id 'sales-import:...') carry the source system's money and are out
-- of every column but the v1_* and negative/rate ones.
--   v1_subtotal_ne_lines   subtotal_usd vs SUM(sale_items.total_usd)            (4dp)
--   v1_calc_ne_components  calculated_total_usd vs subtotal - discount - membership
--                          discount + tax + the delivery fee billed to the customer (4dp)
--   v1_payable_equation    total_usd <> calculated + rounding_adjustment, |adj| > 0.005,
--                          or total_usd not whole cents (DB-enforced by 0158/0161: fires
--                          only after a restore or a bypass)
--   v1_khr_twin            total_khr vs total_usd x exchange_rate (4dp, never 100-riel steps)
--   v0_header_drift        legacy headers off their lines + components by more than a cent (INFO)
--   completed_short        paid-reading sales short by more than half a cent at the sale's rate,
--                          after the debt its active returns lowered (lib/returnRefundSplit.ts
--                          returnDebtLoweredSql; lib/saleStatusResolution.ts coverage rule)
--   not_paid_but_covered   Not Paid sales the TENDER alone already covers (a return that
--                          lowered the debt to 0 leaves a legitimate Not Paid sale owing 0)
--   system_sales_without_lines, negative_totals, bad_rate
--   payment_events_mismatch  payments_version 1 sales whose sale_payment_events (in minus out) differ from
--                          amount_paid_usd (more than 0.00005) or amount_paid_khr (more than half a riel);
--                          a version 1 sale with no event and money paid counts. Drill-down:
--                          forensics-payment-events-mismatch-rows.sql. 0 until a Worker writes events.
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH li AS MATERIALIZED (
  SELECT sale_id, SUM(COALESCE(total_usd, 0)) AS lines_usd, COUNT(*) AS n FROM sale_items GROUP BY sale_id
),
rr AS MATERIALIZED (
  SELECT sale_id, SUM(COALESCE(owed_reduction_usd, 0)) AS lowered
  FROM returns
  WHERE refund_currency IS NOT NULL AND COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled'
  GROUP BY sale_id
),
s AS MATERIALIZED (
  SELECT x.id, COALESCE(NULLIF(x.sale_status, ''), 'completed') AS st,
    CASE WHEN x.sale_status = 'awaiting_payment' OR (x.sale_status IN ('partial_return', 'returned') AND x.status_before_return = 'awaiting_payment')
      THEN 'awaiting_payment' WHEN x.sale_status = 'cancelled' THEN 'cancelled' ELSE 'completed' END AS pay,
    COALESCE(x.money_precision_version, 0) AS mpv,
    COALESCE(x.subtotal_usd, 0) AS subtotal, COALESCE(x.discount_usd, 0) AS disc, COALESCE(x.membership_discount_usd, 0) AS mdisc,
    COALESCE(x.tax_usd, 0) AS tax,
    CASE WHEN x.is_delivery = 1 AND COALESCE(NULLIF(x.delivery_fee_paid_by, ''), 'customer') = 'customer' THEN COALESCE(x.delivery_fee_usd, 0) ELSE 0 END AS cust_fee,
    x.calculated_total_usd AS calc, COALESCE(x.rounding_adjustment_usd, 0) AS adj, COALESCE(x.total_usd, 0) AS total,
    COALESCE(x.total_khr, 0) AS total_khr, x.exchange_rate AS rate,
    COALESCE(x.amount_paid_usd, 0) AS paid_usd, COALESCE(x.amount_paid_khr, 0) AS paid_khr,
    COALESCE(l.lines_usd, 0) AS lines_usd, COALESCE(l.n, 0) AS n_lines,
    CASE WHEN COALESCE(x.legacy_receipt_number, '') <> '' OR (x.client_request_id >= 'sales-import:' AND x.client_request_id < 'sales-import;') THEN 1 ELSE 0 END AS imported,
    COALESCE(r.lowered, 0) AS lowered
  FROM sales x LEFT JOIN li l ON l.sale_id = x.id LEFT JOIN rr r ON r.sale_id = x.id
),
pe AS MATERIALIZED (
  SELECT x.id, COALESCE(x.amount_paid_usd, 0) AS paid_usd, COALESCE(x.amount_paid_khr, 0) AS paid_khr,
    COALESCE(e.usd, 0) AS ev_usd, COALESCE(e.khr, 0) AS ev_khr
  FROM sales x LEFT JOIN (
    SELECT sale_id, SUM(CASE WHEN direction = 'out' THEN -amount_paid_usd ELSE amount_paid_usd END) AS usd,
      SUM(CASE WHEN direction = 'out' THEN -amount_paid_khr ELSE amount_paid_khr END) AS khr
    FROM sale_payment_events GROUP BY sale_id
  ) e ON e.sale_id = x.id
  WHERE x.payments_version = 1
)
SELECT
  (SELECT COUNT(*) FROM s WHERE mpv = 1) AS v1_sales,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND ABS(subtotal - lines_usd) > 0.00005) AS v1_subtotal_ne_lines,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND (calc IS NULL
     OR ABS(calc - (subtotal - disc - mdisc + tax + cust_fee)) > 0.00005)) AS v1_calc_ne_components,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND (calc IS NULL OR ABS(total - calc - adj) > 0.00005 OR ABS(adj) > 0.00505
     OR ABS(total * 100 - ROUND(total * 100)) > 0.00005)) AS v1_payable_equation,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND rate > 0 AND ABS(total_khr - total * rate) > 0.00005) AS v1_khr_twin,
  (SELECT COUNT(*) FROM s WHERE mpv = 0 AND pay <> 'cancelled' AND n_lines > 0
     AND ABS(total - (lines_usd - disc - mdisc + tax + cust_fee)) > 0.01) AS v0_header_drift,
  (SELECT COUNT(*) FROM s WHERE pay = 'completed' AND imported = 0 AND rate > 0
     AND total - lowered - paid_usd - paid_khr / rate > 0.005000001) AS completed_short,
  (SELECT COUNT(*) FROM s WHERE pay = 'awaiting_payment' AND rate > 0
     AND total - paid_usd - paid_khr / rate <= 0.005000001) AS not_paid_but_covered,
  (SELECT COUNT(*) FROM s WHERE imported = 0 AND n_lines = 0 AND pay <> 'cancelled') AS system_sales_without_lines,
  (SELECT COUNT(*) FROM s WHERE total < 0 OR subtotal < 0) AS negative_totals,
  (SELECT COUNT(*) FROM s WHERE rate IS NULL OR rate <= 0) AS bad_rate,
  (SELECT COUNT(*) FROM pe WHERE ABS(ev_usd - paid_usd) > 0.00005 OR ABS(ev_khr - paid_khr) > 0.5) AS payment_events_mismatch
