-- cost-4dp-counts-20261116: whole-database counts of stored costs with more than 4 decimals (census predicate
-- ABS(c * 10000 - ROUND(c * 10000)) > 0.000001 on a numeric value), so the data repair is sized before it is written.
-- One row of scalar counts: products by column, lots (unit and received cost), manual cost entries, and the totals they are counted against.
-- One pass over each of the three tables. No id, name or personal column. Never ANALYZE, never a write.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 60000
WITH pr AS MATERIALIZED (
  SELECT
    COUNT(*) AS products_total,
    SUM(CASE WHEN typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS products_cost_usd_over_4dp,
    SUM(CASE WHEN typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS products_purchase_usd_over_4dp,
    SUM(CASE WHEN typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS products_cost_khr_over_4dp,
    SUM(CASE WHEN typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS products_purchase_khr_over_4dp
  FROM products
),
lt AS MATERIALIZED (
  SELECT
    COUNT(*) AS lots_total,
    SUM(CASE WHEN typeof(unit_cost_usd) IN ('integer', 'real') AND ABS(unit_cost_usd * 10000 - ROUND(unit_cost_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS lots_unit_cost_over_4dp,
    SUM(CASE WHEN typeof(received_cost_usd) IN ('integer', 'real') AND ABS(received_cost_usd * 10000 - ROUND(received_cost_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS lots_received_cost_over_4dp,
    SUM(CASE WHEN is_active = 1 AND typeof(unit_cost_usd) IN ('integer', 'real') AND ABS(unit_cost_usd * 10000 - ROUND(unit_cost_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS active_lots_unit_cost_over_4dp
  FROM product_batches
),
en AS MATERIALIZED (
  SELECT
    COUNT(*) AS cost_entries_total,
    SUM(CASE WHEN typeof(cost_usd) IN ('integer', 'real') AND ABS(cost_usd * 10000 - ROUND(cost_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS cost_entries_over_4dp,
    SUM(CASE WHEN typeof(cost_khr) IN ('integer', 'real') AND ABS(cost_khr * 10000 - ROUND(cost_khr * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS cost_entries_khr_over_4dp,
    SUM(CASE WHEN typeof(previous_cost_usd) IN ('integer', 'real') AND ABS(previous_cost_usd * 10000 - ROUND(previous_cost_usd * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS cost_entries_previous_over_4dp
  FROM product_cost_entries
)
SELECT
  pr.products_total, pr.products_cost_usd_over_4dp, pr.products_purchase_usd_over_4dp, pr.products_cost_khr_over_4dp, pr.products_purchase_khr_over_4dp,
  lt.lots_total, lt.lots_unit_cost_over_4dp, lt.lots_received_cost_over_4dp, lt.active_lots_unit_cost_over_4dp,
  en.cost_entries_total, en.cost_entries_over_4dp, en.cost_entries_khr_over_4dp, en.cost_entries_previous_over_4dp
FROM pr, lt, en
