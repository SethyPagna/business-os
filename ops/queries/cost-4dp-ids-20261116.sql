-- cost-4dp-ids-20261116: the products whose stored cost has more than 4 decimals, with the evidence that separates the candidate writers.
-- Predicate: the census predicate cost_usd_over_4dp (stock-state-census-exactness-20261116.sql) verbatim, ABS(c * 10000 - ROUND(c * 10000)) > 0.000001
-- on a numeric value, applied to the four cost columns (cost_price_usd, purchase_price_usd, cost_price_khr, purchase_price_khr).
-- Per product: active or not, whether it holds stock (stock_quantity and the sum over branch_stock), its lot count, its lot costs over 4 decimals
-- (ids and values), its manual cost-entry count and the entries over 4 decimals, and the last audit row that touched a cost.
-- Ids and numbers only: no name, supplier, phone, barcode, note or user column. No helper table of an applied migration is read, so it cannot fail
-- on a database that dropped one. The whole-database counts of lots and cost entries are in cost-4dp-counts-20261116.sql.
-- Never ANALYZE, never a write.
-- ops:min-rows 0
-- ops:max-rows 1000
-- ops:max-rows-read 150000
WITH p AS MATERIALIZED (
  SELECT id, is_active, stock_quantity AS qty,
    cost_price_usd AS cu, purchase_price_usd AS pu, cost_price_khr AS ck, purchase_price_khr AS pk,
    cost_review_key IS NOT NULL AS in_review, updated_at
  FROM products
  WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001)
     OR (typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001)
     OR (typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001)
     OR (typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001)
)
SELECT
  p.id, p.is_active, p.qty AS stock_quantity,
  (SELECT SUM(s.quantity) FROM branch_stock s WHERE s.product_id = p.id) AS branch_stock_units,
  CASE WHEN COALESCE(p.qty, 0) > 0 OR COALESCE((SELECT SUM(s.quantity) FROM branch_stock s WHERE s.product_id = p.id), 0) > 0 THEN 1 ELSE 0 END AS holds_stock,
  p.cu AS cost_usd, p.pu AS purchase_usd, p.ck AS cost_khr, p.pk AS purchase_khr,
  CASE WHEN typeof(p.cu) IN ('integer', 'real') AND ABS(p.cu * 10000 - ROUND(p.cu * 10000)) > 0.000001 THEN 1 ELSE 0 END AS cost_usd_over_4dp,
  CASE WHEN typeof(p.pu) IN ('integer', 'real') AND ABS(p.pu * 10000 - ROUND(p.pu * 10000)) > 0.000001 THEN 1 ELSE 0 END AS purchase_usd_over_4dp,
  CASE WHEN typeof(p.ck) IN ('integer', 'real') AND ABS(p.ck * 10000 - ROUND(p.ck * 10000)) > 0.000001 THEN 1 ELSE 0 END AS cost_khr_over_4dp,
  CASE WHEN typeof(p.pk) IN ('integer', 'real') AND ABS(p.pk * 10000 - ROUND(p.pk * 10000)) > 0.000001 THEN 1 ELSE 0 END AS purchase_khr_over_4dp,
  p.in_review, p.updated_at,
  (SELECT COUNT(*) FROM product_batches b WHERE b.variant_product_id = p.id) AS lots,
  (SELECT COUNT(*) FROM product_batches b WHERE b.variant_product_id = p.id AND b.is_active = 1 AND b.unit_cost_usd > 0) AS active_costed_lots,
  (SELECT COUNT(*) FROM product_batches b WHERE b.variant_product_id = p.id
     AND ((typeof(b.unit_cost_usd) IN ('integer', 'real') AND ABS(b.unit_cost_usd * 10000 - ROUND(b.unit_cost_usd * 10000)) > 0.000001)
       OR (typeof(b.received_cost_usd) IN ('integer', 'real') AND ABS(b.received_cost_usd * 10000 - ROUND(b.received_cost_usd * 10000)) > 0.000001))) AS lots_over_4dp,
  (SELECT group_concat(x.id || ':' || x.unit_cost_usd || ':' || COALESCE(x.received_cost_usd, ''), ' ')
     FROM (SELECT b.id, b.unit_cost_usd, b.received_cost_usd FROM product_batches b WHERE b.variant_product_id = p.id
             AND ((typeof(b.unit_cost_usd) IN ('integer', 'real') AND ABS(b.unit_cost_usd * 10000 - ROUND(b.unit_cost_usd * 10000)) > 0.000001)
               OR (typeof(b.received_cost_usd) IN ('integer', 'real') AND ABS(b.received_cost_usd * 10000 - ROUND(b.received_cost_usd * 10000)) > 0.000001))
             ORDER BY b.id DESC LIMIT 6) x) AS lot_costs_over_4dp,
  (SELECT COUNT(*) FROM product_cost_entries e WHERE e.product_id = p.id) AS manual_entries,
  (SELECT COUNT(*) FROM product_cost_entries e WHERE e.product_id = p.id
     AND typeof(e.cost_usd) IN ('integer', 'real') AND ABS(e.cost_usd * 10000 - ROUND(e.cost_usd * 10000)) > 0.000001) AS entries_over_4dp,
  (SELECT e.cost_usd FROM product_cost_entries e WHERE e.product_id = p.id ORDER BY e.id DESC LIMIT 1) AS last_manual_cost,
  a.id AS last_cost_audit_id, a.action AS last_cost_audit_action, a.created_at AS last_cost_audit_at,
  CASE WHEN json_valid(a.new_value) THEN json_extract(a.new_value, '$.cost_price_usd') END AS audit_new_cost,
  CASE WHEN json_valid(a.old_value) THEN json_extract(a.old_value, '$.cost_price_usd') END AS audit_old_cost
FROM p
LEFT JOIN audit_logs a ON a.id = (
  SELECT x.id FROM audit_logs x
  WHERE x.entity = 'product' AND x.entity_id = CAST(p.id AS TEXT)
    AND (x.action IN ('cost_override', 'catalog_cost_recompute_backfill', 'product_leading_zero_twin_merge')
      OR instr(COALESCE(x.old_value, ''), 'cost_price') > 0 OR instr(COALESCE(x.new_value, ''), 'cost_price') > 0)
  ORDER BY x.id DESC LIMIT 1)
ORDER BY p.id
