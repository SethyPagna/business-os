-- cost-4dp-0313-precheck-20261117: read-only pre-check for migration 0313_cost_4dp_repair.sql, run on production BEFORE the deploy that carries it.
-- One row of scalars that restates the PRE block of 0313 and the caps its POST relies on, with the same predicate (census predicate
-- c IS NOT (CAST(ROUND((c) * 10000.0000000000036) AS INTEGER) / 10000.0) on a numeric value) and the same rounding (CAST(ROUND(c * 10000.0000000000036) AS INTEGER) / 10000.0):
--   products_to_round, lots_to_round, entries_to_round   rows 0313 would write (products by four columns, lots by unit and received cost, entries by three)
--   inactive_lots_holding_stock                          in-scope lots that are inactive and still hold branch stock; MUST be 0 (PRE cost_4dp_0313_pre_inactive_lot_holds_stock,
--                                                        because trigger positive_lot_reject_inactive_update_0154 aborts the update of such a lot)
--   active_products_to_rederive                          active products with an in-scope lot or cost entry: the products whose catalog cost 0313 re-derives (an upper bound;
--                                                        0313 writes only those whose derived cost differs)
--   *_cap and *_cap_ok                                   the PRE caps (products 500, lots 5000, entries 5000) and whether the count is within them
--   *_value_out_of_range                                 in-scope values of 1e9 or more in magnitude (PRE); MUST be 0
--   max_lot_or_entry_change, change_cap_ok               the largest rounding change of a lot or entry value and whether it is within 0.00005 (POST)
--   blocking_flags, epoch_ok                             a maintenance or stock_transaction_permit flag (PRE), MUST be 0; epoch_ok is 0 when stock_schema_epoch is not legacy-separate-pool-v1, MUST be 1
--   post_active_cost_drift_now                           active products whose stored cost is not the catalog-cost formula's figure now, over ALL active products with the
--                                                        predicate of health-catalog-cost.sql (what active_cost_drift reads today; 0313 fixes the re-derived ones)
--   post_drift_after_apply                               the drift 0313's POST would see: active products OUTSIDE the re-derive set (no in-scope lot or entry), with their own
--                                                        in-scope cost columns rounded. MUST be 0, or 0313 aborts at cost_4dp_0313_post_active_cost_drift
--   active_branch_cutovers                               branch_cutovers rows not completed or aborted (PRE cost_4dp_0313_pre_branch_cutover_active); MUST be 0
--   max_product_rederive_change                          the largest change the re-derive would make to an active product's cost (information; the formula is run over the lots
--                                                        and entries as 0313 will leave them)
--   positive_cost_rounds_to_zero                         values in scope that are above 0 and would round to 0 (PRE cost_4dp_0313_pre_positive_cost_rounds_to_zero); MUST be 0,
--                                                        otherwise a tiny cost becomes unknown/$0: an owner decision
--   pre_holds                                            1 only when every PRE check above passes (including cutover and positive-to-zero)
--   apply_holds                                          1 only when 0313 would apply: pre_holds and its POST checks (drift outside the re-derive set, change cap) would pass
-- One pass over products, product_batches and product_cost_entries, a lookup of branch_batch_stock for each in-scope inactive lot, and system_flags.
-- No id, name, phone or customer column; every figure is a count or a maximum. No helper table of an applied migration. Never ANALYZE, never a write.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 130000
WITH ps AS MATERIALIZED (
  SELECT id,
    CASE WHEN (typeof(cost_price_usd) IN ('integer', 'real') AND cost_price_usd IS NOT (CAST(ROUND((cost_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(cost_price_usd) >= 1000000000)
        OR (typeof(cost_price_khr) IN ('integer', 'real') AND cost_price_khr IS NOT (CAST(ROUND((cost_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(cost_price_khr) >= 1000000000)
        OR (typeof(purchase_price_usd) IN ('integer', 'real') AND purchase_price_usd IS NOT (CAST(ROUND((purchase_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(purchase_price_usd) >= 1000000000)
        OR (typeof(purchase_price_khr) IN ('integer', 'real') AND purchase_price_khr IS NOT (CAST(ROUND((purchase_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(purchase_price_khr) >= 1000000000)
      THEN 1 ELSE 0 END AS out_of_range
  FROM products
  WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND cost_price_usd IS NOT (CAST(ROUND((cost_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0))
     OR (typeof(cost_price_khr) IN ('integer', 'real') AND cost_price_khr IS NOT (CAST(ROUND((cost_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0))
     OR (typeof(purchase_price_usd) IN ('integer', 'real') AND purchase_price_usd IS NOT (CAST(ROUND((purchase_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0))
     OR (typeof(purchase_price_khr) IN ('integer', 'real') AND purchase_price_khr IS NOT (CAST(ROUND((purchase_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0))
),
ls AS MATERIALIZED (
  SELECT pb.variant_product_id AS pid,
    CASE WHEN pb.is_active IS NOT 1 AND EXISTS (SELECT 1 FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) THEN 1 ELSE 0 END AS inactive_holds_stock,
    CASE WHEN (typeof(pb.unit_cost_usd) IN ('integer', 'real') AND pb.unit_cost_usd IS NOT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(pb.unit_cost_usd) >= 1000000000)
        OR (typeof(pb.received_cost_usd) IN ('integer', 'real') AND pb.received_cost_usd IS NOT (CAST(ROUND((pb.received_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(pb.received_cost_usd) >= 1000000000)
      THEN 1 ELSE 0 END AS out_of_range,
    MAX(
      CASE WHEN typeof(pb.unit_cost_usd) IN ('integer', 'real') AND pb.unit_cost_usd IS NOT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0)
        THEN ABS(CAST(ROUND(pb.unit_cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - pb.unit_cost_usd) ELSE 0 END,
      CASE WHEN typeof(pb.received_cost_usd) IN ('integer', 'real') AND pb.received_cost_usd IS NOT (CAST(ROUND((pb.received_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0)
        THEN ABS(CAST(ROUND(pb.received_cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - pb.received_cost_usd) ELSE 0 END) AS change
  FROM product_batches pb
  WHERE (typeof(pb.unit_cost_usd) IN ('integer', 'real') AND pb.unit_cost_usd IS NOT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0))
     OR (typeof(pb.received_cost_usd) IN ('integer', 'real') AND pb.received_cost_usd IS NOT (CAST(ROUND((pb.received_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0))
),
es AS MATERIALIZED (
  SELECT e.product_id AS pid,
    CASE WHEN (typeof(e.cost_usd) IN ('integer', 'real') AND e.cost_usd IS NOT (CAST(ROUND((e.cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(e.cost_usd) >= 1000000000)
        OR (typeof(e.cost_khr) IN ('integer', 'real') AND e.cost_khr IS NOT (CAST(ROUND((e.cost_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(e.cost_khr) >= 1000000000)
        OR (typeof(e.previous_cost_usd) IN ('integer', 'real') AND e.previous_cost_usd IS NOT (CAST(ROUND((e.previous_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) AND ABS(e.previous_cost_usd) >= 1000000000)
      THEN 1 ELSE 0 END AS out_of_range,
    MAX(
      CASE WHEN typeof(e.cost_usd) IN ('integer', 'real') AND e.cost_usd IS NOT (CAST(ROUND((e.cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0)
        THEN ABS(CAST(ROUND(e.cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - e.cost_usd) ELSE 0 END,
      CASE WHEN typeof(e.cost_khr) IN ('integer', 'real') AND e.cost_khr IS NOT (CAST(ROUND((e.cost_khr) * 10000.0000000000036) AS INTEGER) / 10000.0)
        THEN ABS(CAST(ROUND(e.cost_khr * 10000.0000000000036) AS INTEGER) / 10000.0 - e.cost_khr) ELSE 0 END,
      CASE WHEN typeof(e.previous_cost_usd) IN ('integer', 'real') AND e.previous_cost_usd IS NOT (CAST(ROUND((e.previous_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0)
        THEN ABS(CAST(ROUND(e.previous_cost_usd * 10000.0000000000036) AS INTEGER) / 10000.0 - e.previous_cost_usd) ELSE 0 END) AS change
  FROM product_cost_entries e
  WHERE (typeof(e.cost_usd) IN ('integer', 'real') AND e.cost_usd IS NOT (CAST(ROUND((e.cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0))
     OR (typeof(e.cost_khr) IN ('integer', 'real') AND e.cost_khr IS NOT (CAST(ROUND((e.cost_khr) * 10000.0000000000036) AS INTEGER) / 10000.0))
     OR (typeof(e.previous_cost_usd) IN ('integer', 'real') AND e.previous_cost_usd IS NOT (CAST(ROUND((e.previous_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0))
),
ac AS MATERIALIZED (
  SELECT products.id AS id, products.cost_price_usd AS c, products.purchase_price_usd AS p, COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN (CAST(ROUND((SUM(qty * cost) / SUM(qty)) * 10000.0000000000036) AS INTEGER) / 10000.0) END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived
  FROM products WHERE products.is_active = 1
),
rd AS MATERIALIZED (
  SELECT products.id AS id, products.cost_price_usd AS c, COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN (CAST(ROUND((SUM(qty * cost) / SUM(qty)) * 10000.0000000000036) AS INTEGER) / 10000.0) END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM (SELECT id, variant_product_id, is_active, received_at, CASE WHEN typeof(unit_cost_usd) IN ('integer', 'real') THEN (CAST(ROUND((unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) ELSE unit_cost_usd END AS unit_cost_usd FROM product_batches) pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM (SELECT id, product_id, baseline_batch_id, CASE WHEN typeof(cost_usd) IN ('integer', 'real') THEN (CAST(ROUND((cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) ELSE cost_usd END AS cost_usd FROM product_cost_entries) pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
    (SELECT (CAST(ROUND((pb.unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) FROM (SELECT id, variant_product_id, is_active, received_at, CASE WHEN typeof(unit_cost_usd) IN ('integer', 'real') THEN (CAST(ROUND((unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) ELSE unit_cost_usd END AS unit_cost_usd FROM product_batches) pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived_after
  FROM products WHERE products.is_active = 1 AND (products.id IN (SELECT pid FROM ls) OR products.id IN (SELECT pid FROM es))
),
r AS (
  SELECT
    (SELECT COUNT(*) FROM ps) AS products_to_round,
    (SELECT COUNT(*) FROM ls) AS lots_to_round,
    (SELECT COUNT(*) FROM es) AS entries_to_round,
    (SELECT COALESCE(SUM(inactive_holds_stock), 0) FROM ls) AS inactive_lots_holding_stock,
    (SELECT COUNT(*) FROM products p WHERE p.is_active = 1 AND (p.id IN (SELECT pid FROM ls) OR p.id IN (SELECT pid FROM es))) AS active_products_to_rederive,
    (SELECT COALESCE(SUM(derived IS NOT NULL AND (c IS NOT derived OR p IS NOT derived)), 0) FROM ac) AS post_active_cost_drift_now,
    (SELECT COALESCE(SUM(derived IS NOT NULL AND (CASE WHEN typeof(c) IN ('integer', 'real') THEN (CAST(ROUND((c) * 10000.0000000000036) AS INTEGER) / 10000.0) ELSE c END IS NOT derived OR CASE WHEN typeof(p) IN ('integer', 'real') THEN (CAST(ROUND((p) * 10000.0000000000036) AS INTEGER) / 10000.0) ELSE p END IS NOT derived)), 0) FROM ac
      WHERE id NOT IN (SELECT pid FROM ls) AND id NOT IN (SELECT pid FROM es)) AS post_drift_after_apply,
    (SELECT COUNT(*) FROM branch_cutovers WHERE phase NOT IN ('completed', 'aborted')) AS active_branch_cutovers,
    COALESCE((SELECT MAX(ABS(derived_after - COALESCE(c, 0))) FROM rd WHERE derived_after IS NOT NULL), 0) AS max_product_rederive_change,
    (SELECT COUNT(*) FROM products WHERE (typeof(cost_price_usd) IN ('integer', 'real') AND cost_price_usd > 0 AND (CAST(ROUND((cost_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0) OR (typeof(cost_price_khr) IN ('integer', 'real') AND cost_price_khr > 0 AND (CAST(ROUND((cost_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0) OR (typeof(purchase_price_usd) IN ('integer', 'real') AND purchase_price_usd > 0 AND (CAST(ROUND((purchase_price_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0) OR (typeof(purchase_price_khr) IN ('integer', 'real') AND purchase_price_khr > 0 AND (CAST(ROUND((purchase_price_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0))
      + (SELECT COUNT(*) FROM product_batches WHERE (typeof(unit_cost_usd) IN ('integer', 'real') AND unit_cost_usd > 0 AND (CAST(ROUND((unit_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0) OR (typeof(received_cost_usd) IN ('integer', 'real') AND received_cost_usd > 0 AND (CAST(ROUND((received_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0))
      + (SELECT COUNT(*) FROM product_cost_entries WHERE (typeof(cost_usd) IN ('integer', 'real') AND cost_usd > 0 AND (CAST(ROUND((cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0) OR (typeof(cost_khr) IN ('integer', 'real') AND cost_khr > 0 AND (CAST(ROUND((cost_khr) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0) OR (typeof(previous_cost_usd) IN ('integer', 'real') AND previous_cost_usd > 0 AND (CAST(ROUND((previous_cost_usd) * 10000.0000000000036) AS INTEGER) / 10000.0) = 0)) AS positive_cost_rounds_to_zero,
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
  post_active_cost_drift_now, post_drift_after_apply, active_branch_cutovers, max_product_rederive_change, positive_cost_rounds_to_zero,
  CASE WHEN products_to_round <= 500 AND lots_to_round <= 5000 AND entries_to_round <= 5000
      AND inactive_lots_holding_stock = 0
      AND products_value_out_of_range = 0 AND lots_value_out_of_range = 0 AND entries_value_out_of_range = 0
      AND blocking_flags = 0 AND epoch_ok = 1
      AND active_branch_cutovers = 0 AND positive_cost_rounds_to_zero = 0
    THEN 1 ELSE 0 END AS pre_holds,
  CASE WHEN products_to_round <= 500 AND lots_to_round <= 5000 AND entries_to_round <= 5000
      AND inactive_lots_holding_stock = 0
      AND products_value_out_of_range = 0 AND lots_value_out_of_range = 0 AND entries_value_out_of_range = 0
      AND blocking_flags = 0 AND epoch_ok = 1
      AND active_branch_cutovers = 0 AND positive_cost_rounds_to_zero = 0
      AND post_drift_after_apply = 0 AND max_lot_or_entry_change <= 0.00005 + 1e-9
    THEN 1 ELSE 0 END AS apply_holds
FROM r
