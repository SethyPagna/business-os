-- health-catalog-cost: products.cost_price_usd (and its mirror purchase_price_usd)
-- against the catalog-cost formula the database itself maintains (DATA-MATCH DM-16).
-- Migration 0195's triggers re-derive a product whenever its lots or lot stock
-- change, using CATALOG_COST_DERIVE_SQL (lib/catalogCostRecompute.ts); the
-- expression below is that constant VERBATIM (the test pins it). Only ACTIVE rows
-- (inactive rows are frozen history, 0195 header), and only where the formula
-- yields a figure (NULL keeps the stored value by design).
--   active_cost_drift     rows the formula would move (ZERO: the triggers stand down
--                         only during a backup restore)
--   active_mirror_drift   purchase_price_usd <> cost_price_usd on active rows
--   active_with_formula   rows the formula has a figure for (context)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH d AS MATERIALIZED (
  SELECT products.id, products.cost_price_usd, products.purchase_price_usd, COALESCE(
    (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
      FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        UNION ALL
        SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
            JOIN product_batches ob ON ob.id = bbs.batch_id
          WHERE ob.variant_product_id = products.id AND ob.is_active = 1
            AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
        WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
          AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
    (SELECT pb.unit_cost_usd FROM product_batches pb
      WHERE pb.variant_product_id = products.id AND pb.is_active = 1
        AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
        AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived
  FROM products WHERE products.is_active = 1
)
SELECT
  (SELECT COUNT(*) FROM d WHERE derived IS NOT NULL AND (cost_price_usd IS NOT derived OR purchase_price_usd IS NOT derived)) AS active_cost_drift,
  (SELECT COUNT(*) FROM d WHERE cost_price_usd IS NOT purchase_price_usd) AS active_mirror_drift,
  (SELECT COUNT(*) FROM d WHERE derived IS NOT NULL) AS active_with_formula
