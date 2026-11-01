-- recent-prepared-figures: Tier A "recent" check of the prepared (stored) figures against the oracle that derives them (RELIABILITY-PLAN 5.2, P0.6).
-- A prepared figure is one the database or the Worker stores so that readers need not recompute it. Today that is the catalog cost:
-- products.cost_price_usd and its mirror purchase_price_usd, kept by the migration 0195 / 0256 / 0261 triggers and the receipt
-- writers from CATALOG_COST_DERIVE_SQL (lib/catalogCostRecompute.ts). The expression below is that constant VERBATIM, as in
-- health-catalog-cost (test-ops-health-tiers-native.cjs pins it). Only active products that had a stock movement in the last two
-- business days are read (window: see recent-stock-ledgers); inactive rows are frozen history (0195 header).
--   cost_drift         rows the formula would move (the triggers stand down only during a backup restore)
--   mirror_drift       the purchase_price_usd twin not aligned with cost_price_usd
--   mirror_drift_khr   the same rule for the KHR pair
-- Context, not alarms: products_checked, products_with_formula.
-- EXTENSION POINT: when a read slice turns a prepared aggregate ON (for example the Dashboard stock overview of P1.8b, or the
-- per-sale facts of P3.1), its oracle recompute for the products or sales touched in the window is added to this file as one more
-- CTE and one more expect-zero column, in the same commit that turns its read switch on. Until then nothing else is stored.
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero cost_drift,mirror_drift,mirror_drift_khr
-- ops:max-rows-read 3508
WITH win AS MATERIALIZED (
  SELECT datetime(date('now', '+7 hours', '-1 day'), '-7 hours') AS cut
),
tprod AS MATERIALIZED (
  SELECT DISTINCT product_id AS pid
  FROM inventory_movements INDEXED BY idx_inventory_movements_created_pg
  WHERE created_at >= (SELECT cut FROM win) AND product_id IS NOT NULL
),
d AS MATERIALIZED (
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
  FROM tprod CROSS JOIN products ON products.id = tprod.pid
  WHERE products.is_active = 1
)
SELECT
  (SELECT COUNT(*) FROM d) AS products_checked,
  (SELECT COUNT(*) FROM d WHERE derived IS NOT NULL) AS products_with_formula,
  (SELECT COUNT(*) FROM d WHERE derived IS NOT NULL AND (cost_price_usd IS NOT derived OR purchase_price_usd IS NOT derived)) AS cost_drift,
  (SELECT COUNT(*) FROM d WHERE NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0))) AS mirror_drift,
  (SELECT COUNT(*) FROM d WHERE NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0))) AS mirror_drift_khr
