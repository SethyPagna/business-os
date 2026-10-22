-- health-catalog-cost: products.cost_price_usd (and its mirror purchase_price_usd)
-- against the catalog-cost formula the database itself maintains (DATA-MATCH DM-16).
-- Migration 0195's triggers (re-created by 0256 with the validated input policy and by 0261
-- with the primary-key plan) re-derive a product whenever its lots or lot stock
-- change, using CATALOG_COST_DERIVE_SQL (lib/catalogCostRecompute.ts, the 'validated'
-- policy: a recorded cost is an integer or real, above 0 and finite); the
-- expression below is that constant VERBATIM (the test pins it). Only ACTIVE rows
-- (inactive rows are frozen history, 0195 header), and only where the formula
-- yields a figure (NULL keeps the stored value by design).
--   active_cost_drift     rows the formula would move (ZERO: the triggers stand down
--                         only during a backup restore)
--   active_mirror_drift   active rows whose purchase_price_usd twin is not aligned with cost_price_usd: the
--                         same value, or an unknown (NULL) cost with a twin of 0 or NULL (the mirror rule,
--                         COST_MIRROR_COLUMNS in lib/catalogCostRecompute.ts; ZERO after 0269). Drilled down by
--                         forensics-catalog-mirror-drift-rows
--   active_mirror_drift_khr  the same rule for the KHR pair (no drill-down; 0269 repairs both)
--   active_with_formula   rows the formula has a figure for (context)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH d AS MATERIALIZED (
  SELECT products.id, products.cost_price_usd, products.purchase_price_usd, products.cost_price_khr, products.purchase_price_khr, COALESCE(
      (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
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
      (SELECT pb.unit_cost_usd FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
          AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
          AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived
  FROM products WHERE products.is_active = 1
)
SELECT
  (SELECT COUNT(*) FROM d WHERE derived IS NOT NULL AND (cost_price_usd IS NOT derived OR purchase_price_usd IS NOT derived)) AS active_cost_drift,
  (SELECT COUNT(*) FROM d WHERE NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0))) AS active_mirror_drift,
  (SELECT COUNT(*) FROM d WHERE NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0))) AS active_mirror_drift_khr,
  (SELECT COUNT(*) FROM d WHERE derived IS NOT NULL) AS active_with_formula
