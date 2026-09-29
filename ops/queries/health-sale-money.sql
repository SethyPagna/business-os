-- health-sale-money: sale headers against their own lines and the payment rule
-- (DATA-MATCH DM-07, DM-08). v1 = money_precision_version 1, written by
-- lib/saleTotals.ts computeSaleTotalsV1 and checked by
-- lib/saleMoneyPrecision.ts validateSaleMoneySnapshot, so every v1_* column must be 0.
--   v1_subtotal_ne_lines   subtotal_usd vs SUM(sale_items.total_usd)            (4dp)
--   v1_calc_ne_components  calculated_total_usd vs subtotal - discount - membership
--                          discount + tax + the delivery fee billed to the customer (4dp)
--   v1_payable_equation    total_usd <> calculated + rounding_adjustment, |adj| > 0.005,
--                          or total_usd not whole cents
--   v1_khr_twin            total_khr vs total_usd x exchange_rate (4dp, never 100-riel steps)
--   v0_header_drift        legacy headers off their lines + components by more than a cent (INFO)
--   completed_short        completed sales short by more than half a cent at the sale's
--                          rate (lib/saleStatusResolution.ts PAID_STATUS_SHORTFALL_TOLERANCE_UNITS)
--   not_paid_but_covered   awaiting_payment sales the tender already covers
--   system_sales_without_lines, negative_totals, bad_rate
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH li AS MATERIALIZED (
  SELECT sale_id, SUM(COALESCE(total_usd, 0)) AS lines_usd, COUNT(*) AS n FROM sale_items GROUP BY sale_id
),
s AS MATERIALIZED (
  SELECT x.id, COALESCE(NULLIF(x.sale_status, ''), 'completed') AS st, COALESCE(x.money_precision_version, 0) AS mpv,
    COALESCE(x.subtotal_usd, 0) AS subtotal, COALESCE(x.discount_usd, 0) AS disc, COALESCE(x.membership_discount_usd, 0) AS mdisc,
    COALESCE(x.tax_usd, 0) AS tax,
    CASE WHEN x.is_delivery = 1 AND x.delivery_fee_paid_by = 'customer' THEN COALESCE(x.delivery_fee_usd, 0) ELSE 0 END AS cust_fee,
    x.calculated_total_usd AS calc, COALESCE(x.rounding_adjustment_usd, 0) AS adj, COALESCE(x.total_usd, 0) AS total,
    COALESCE(x.total_khr, 0) AS total_khr, x.exchange_rate AS rate,
    COALESCE(x.amount_paid_usd, 0) AS paid_usd, COALESCE(x.amount_paid_khr, 0) AS paid_khr,
    COALESCE(l.lines_usd, 0) AS lines_usd, COALESCE(l.n, 0) AS n_lines,
    CASE WHEN COALESCE(x.legacy_receipt_number, '') <> '' THEN 1 ELSE 0 END AS legacy
  FROM sales x LEFT JOIN li l ON l.sale_id = x.id
)
SELECT
  (SELECT COUNT(*) FROM s WHERE mpv = 1) AS v1_sales,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND ABS(subtotal - lines_usd) > 0.00005) AS v1_subtotal_ne_lines,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND (calc IS NULL
     OR ABS(calc - (subtotal - disc - mdisc + tax + cust_fee)) > 0.00005)) AS v1_calc_ne_components,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND (calc IS NULL OR ABS(total - calc - adj) > 0.00005 OR ABS(adj) > 0.00505
     OR ABS(total * 100 - ROUND(total * 100)) > 0.00005)) AS v1_payable_equation,
  (SELECT COUNT(*) FROM s WHERE mpv = 1 AND rate > 0 AND ABS(total_khr - total * rate) > 0.00005) AS v1_khr_twin,
  (SELECT COUNT(*) FROM s WHERE mpv = 0 AND st <> 'cancelled' AND n_lines > 0
     AND ABS(total - (lines_usd - disc - mdisc + tax + cust_fee)) > 0.01) AS v0_header_drift,
  (SELECT COUNT(*) FROM s WHERE st = 'completed' AND legacy = 0 AND rate > 0
     AND total - paid_usd - paid_khr / rate > 0.005000001) AS completed_short,
  (SELECT COUNT(*) FROM s WHERE st = 'awaiting_payment' AND rate > 0
     AND total - paid_usd - paid_khr / rate <= 0.005000001) AS not_paid_but_covered,
  (SELECT COUNT(*) FROM s WHERE legacy = 0 AND n_lines = 0 AND st <> 'cancelled') AS system_sales_without_lines,
  (SELECT COUNT(*) FROM s WHERE total < 0 OR subtotal < 0) AS negative_totals,
  (SELECT COUNT(*) FROM s WHERE rate IS NULL OR rate <= 0) AS bad_rate
