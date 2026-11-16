-- cost-4dp-0313-precheck-20261117: read-only pre-check for migration 0313_cost_4dp_repair.sql, run on production BEFORE the deploy that carries it.
-- One row of scalars that restates the PRE block of 0313 and the caps its POST relies on, with the same predicate (census predicate
-- ABS(c * 10000 - ROUND(c * 10000)) > 0.000001 on a numeric value) and the same rounding (CAST(ROUND(c * 10000.0000000000036) AS INTEGER) / 10000.0):
--   products_to_round, lots_to_round, entries_to_round   rows 0313 would write (products by four columns, lots by unit and received cost, entries by three)
--   inactive_lots_holding_stock                          in-scope lots that are inactive and still hold branch stock; MUST be 0 (PRE cost_4dp_0313_pre_inactive_lot_holds_stock,
--                                                        because trigger positive_lot_reject_inactive_update_0154 aborts the update of such a lot)
--   active_products_to_rederive                          active products with an in-scope lot or cost entry: the products whose catalog cost 0313 re-derives (an upper bound;
--                                                        0313 writes only those whose derived cost differs)
--   *_cap and *_cap_ok                                   the PRE caps (products 500, lots 5000, entries 5000) and whether the count is within them
--   *_value_out_of_range                                 in-scope values of 1e9 or more in magnitude (PRE); MUST be 0
--   max_lot_or_entry_change, change_cap_ok               the largest rounding change of a lot or entry value and whether it is within 0.00005 (POST)
--   blocking_flags, epoch_ok                             a maintenance or stock_transaction_permit flag (PRE), MUST be 0; epoch_ok is 0 when stock_schema_epoch is not legacy-separate-pool-v1, MUST be 1
--   pre_holds                                            1 only when every PRE check above passes: the deploy can apply 0313
-- One pass over products, product_batches and product_cost_entries, a lookup of branch_batch_stock for each in-scope inactive lot, and system_flags.
-- No id, name, phone or customer column; every figure is a count or a maximum. No helper table of an applied migration. Never ANALYZE, never a write.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 60000
WITH ps AS MATERIALIZED (
  SELECT id,
    CASE WHEN (typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001 AND ABS(cost_price_usd) >= 1000000000)
        OR (typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001 AND ABS(cost_price_khr) >= 1000000000)
        OR (typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001 AND ABS(purchase_price_usd) >= 1000000000)
        OR (typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001 AND ABS(purchase_price_khr) >= 1000000000)
      THEN 1 ELSE 0 END AS out_of_range
  FROM products
  WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND ABS(cost_price_usd * 10000 - ROUND(cost_price_usd * 10000)) > 0.000001)
     OR (typeof(cost_price_khr) IN ('integer', 'real') AND ABS(cost_price_khr * 10000 - ROUND(cost_price_khr * 10000)) > 0.000001)
     OR (typeof(purchase_price_usd) IN ('integer', 'real') AND ABS(purchase_price_usd * 10000 - ROUND(purchase_price_usd * 10000)) > 0.000001)
     OR (typeof(purchase_price_khr) IN ('integer', 'real') AND ABS(purchase_price_khr * 10000 - ROUND(purchase_price_khr * 10000)) > 0.000001)
),
ls AS MATERIALIZED (
  SELECT pb.variant_product_id AS pid,
    CASE WHEN pb.is_active IS NOT 1 AND EXISTS (SELECT 1 FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) THEN 1 ELSE 0 END AS inactive_holds_stock,
    CASE WHEN (typeof(pb.unit_cost_usd) IN ('integer', 'real') AND ABS(pb.unit_cost_usd * 10000 - ROUND(pb.unit_cost_usd * 10000)) > 0.000001 AND ABS(pb.unit_cost_usd) >= 1000000000)
        OR (typeof(pb.received_cost_usd) IN ('integer', 'real') AND ABS(pb.received_cost_usd * 10000 - ROUND(pb.received_cost_usd * 10000)) > 0.000001 AND ABS(pb.received_cost_usd) >= 1000000000)
      THEN 1 ELSE 0 END AS out_of_range,
    MAX(
      CASE WHEN typeof(pb.unit_cost_usd) IN ('integer', 'real') AND ABS(pb.unit_cost_usd * 10000 - ROUND(pb.unit_cost_usd * 10000)) > 0.000001
        THEN ABS(CAST(ROUND(pb.unit_cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - pb.unit_cost_usd) ELSE 0 END,
      CASE WHEN typeof(pb.received_cost_usd) IN ('integer', 'real') AND ABS(pb.received_cost_usd * 10000 - ROUND(pb.received_cost_usd * 10000)) > 0.000001
        THEN ABS(CAST(ROUND(pb.received_cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - pb.received_cost_usd) ELSE 0 END) AS change
  FROM product_batches pb
  WHERE (typeof(pb.unit_cost_usd) IN ('integer', 'real') AND ABS(pb.unit_cost_usd * 10000 - ROUND(pb.unit_cost_usd * 10000)) > 0.000001)
     OR (typeof(pb.received_cost_usd) IN ('integer', 'real') AND ABS(pb.received_cost_usd * 10000 - ROUND(pb.received_cost_usd * 10000)) > 0.000001)
),
es AS MATERIALIZED (
  SELECT e.product_id AS pid,
    CASE WHEN (typeof(e.cost_usd) IN ('integer', 'real') AND ABS(e.cost_usd * 10000 - ROUND(e.cost_usd * 10000)) > 0.000001 AND ABS(e.cost_usd) >= 1000000000)
        OR (typeof(e.cost_khr) IN ('integer', 'real') AND ABS(e.cost_khr * 10000 - ROUND(e.cost_khr * 10000)) > 0.000001 AND ABS(e.cost_khr) >= 1000000000)
        OR (typeof(e.previous_cost_usd) IN ('integer', 'real') AND ABS(e.previous_cost_usd * 10000 - ROUND(e.previous_cost_usd * 10000)) > 0.000001 AND ABS(e.previous_cost_usd) >= 1000000000)
      THEN 1 ELSE 0 END AS out_of_range,
    MAX(
      CASE WHEN typeof(e.cost_usd) IN ('integer', 'real') AND ABS(e.cost_usd * 10000 - ROUND(e.cost_usd * 10000)) > 0.000001
        THEN ABS(CAST(ROUND(e.cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - e.cost_usd) ELSE 0 END,
      CASE WHEN typeof(e.cost_khr) IN ('integer', 'real') AND ABS(e.cost_khr * 10000 - ROUND(e.cost_khr * 10000)) > 0.000001
        THEN ABS(CAST(ROUND(e.cost_khr * 10000.0000000000036) AS INTEGER) / 10000.0 - e.cost_khr) ELSE 0 END,
      CASE WHEN typeof(e.previous_cost_usd) IN ('integer', 'real') AND ABS(e.previous_cost_usd * 10000 - ROUND(e.previous_cost_usd * 10000)) > 0.000001
        THEN ABS(CAST(ROUND(e.previous_cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - e.previous_cost_usd) ELSE 0 END) AS change
  FROM product_cost_entries e
  WHERE (typeof(e.cost_usd) IN ('integer', 'real') AND ABS(e.cost_usd * 10000 - ROUND(e.cost_usd * 10000)) > 0.000001)
     OR (typeof(e.cost_khr) IN ('integer', 'real') AND ABS(e.cost_khr * 10000 - ROUND(e.cost_khr * 10000)) > 0.000001)
     OR (typeof(e.previous_cost_usd) IN ('integer', 'real') AND ABS(e.previous_cost_usd * 10000 - ROUND(e.previous_cost_usd * 10000)) > 0.000001)
),
r AS (
  SELECT
    (SELECT COUNT(*) FROM ps) AS products_to_round,
    (SELECT COUNT(*) FROM ls) AS lots_to_round,
    (SELECT COUNT(*) FROM es) AS entries_to_round,
    (SELECT COALESCE(SUM(inactive_holds_stock), 0) FROM ls) AS inactive_lots_holding_stock,
    (SELECT COUNT(*) FROM products p WHERE p.is_active = 1 AND (p.id IN (SELECT pid FROM ls) OR p.id IN (SELECT pid FROM es))) AS active_products_to_rederive,
    (SELECT COALESCE(SUM(out_of_range), 0) FROM ps) AS products_value_out_of_range,
    (SELECT COALESCE(SUM(out_of_range), 0) FROM ls) AS lots_value_out_of_range,
    (SELECT COALESCE(SUM(out_of_range), 0) FROM es) AS entries_value_out_of_range,
    MAX(COALESCE((SELECT MAX(change) FROM ls), 0), COALESCE((SELECT MAX(change) FROM es), 0)) AS max_lot_or_entry_change,
    (SELECT COUNT(*) FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit')) AS blocking_flags,
    CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'stock_schema_epoch' AND value IS NOT 'legacy-separate-pool-v1') THEN 1 ELSE 0 END AS epoch_ok
)
SELECT
  products_to_round, lots_to_round, entries_to_round, inactive_lots_holding_stock, active_products_to_rederive,
  500 AS products_cap, CASE WHEN products_to_round <= 500 THEN 1 ELSE 0 END AS products_cap_ok,
  5000 AS lots_cap, CASE WHEN lots_to_round <= 5000 THEN 1 ELSE 0 END AS lots_cap_ok,
  5000 AS entries_cap, CASE WHEN entries_to_round <= 5000 THEN 1 ELSE 0 END AS entries_cap_ok,
  products_value_out_of_range, lots_value_out_of_range, entries_value_out_of_range,
  max_lot_or_entry_change, CASE WHEN max_lot_or_entry_change <= 0.00005 + 1e-9 THEN 1 ELSE 0 END AS change_cap_ok,
  blocking_flags, epoch_ok,
  CASE WHEN products_to_round <= 500 AND lots_to_round <= 5000 AND entries_to_round <= 5000
      AND inactive_lots_holding_stock = 0
      AND products_value_out_of_range = 0 AND lots_value_out_of_range = 0 AND entries_value_out_of_range = 0
      AND blocking_flags = 0 AND epoch_ok = 1
    THEN 1 ELSE 0 END AS pre_holds
FROM r
