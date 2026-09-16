-- 0175: recompute every active product's catalog cost from its active lots
-- with the P10-4 formula, and mirror it into purchase_price_usd.
--
-- PREPARED FOR THE PROGRAM 10 CHECKPOINT B APPLY (announced in the status).
-- Append-only chain: 0174 is the prior migration. DDL is limited to this
-- file's own work table. Owner message F (2026-09-16): "make sure you fix
-- previous data because of these issues" -- the P10-4 code fix (a5a2169f,
-- live since checkpoint A) recomputes the cost on every stock-add writer
-- from now on; this file brings the rows written BEFORE that fix to the
-- same figure.
--
-- ============================== RULE =====================================
-- Exactly lib/catalogCostRecompute.ts (catalogCostRecomputeStatement):
-- over the product row's own ACTIVE lots (product_batches.is_active = 1),
-- take the DISTINCT non-zero unit_cost_usd values; if the dearest is more
-- than twice the cheapest keep the dearest (outlier rule), otherwise the
-- mean rounded to 4 decimals. Write it to cost_price_usd AND
-- purchase_price_usd (mirror). A product with no costed active lot is left
-- exactly as it is (never zeroed). KHR columns untouched (no lot ever
-- recorded a KHR cost). Product-row scoped, never name-group scoped.
--
-- Audit 2026-09-16 against production: 5,918 active products have a costed
-- active lot; 859 of them carry a cost_price_usd that differs from the
-- formula, and purchase_price_usd is 0 on all of them (it was never
-- mirrored before P10-4), so every one of the 5,918 rows is rewritten.
--
-- ============================== IDEMPOTENCE ==============================
-- The work table only receives rows whose stored value differs from the
-- derived one; after the first run nothing differs, so a re-run inserts
-- nothing and updates nothing. Empty database: no-op.
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT COUNT(*) FROM products p JOIN (
--     SELECT variant_product_id AS pid,
--       CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4) END AS v
--     FROM (SELECT DISTINCT variant_product_id, unit_cost_usd AS cost FROM product_batches
--           WHERE is_active = 1 AND unit_cost_usd IS NOT NULL AND unit_cost_usd <> 0)
--     GROUP BY variant_product_id) d ON d.pid = p.id
--   WHERE p.is_active = 1
--     AND (ABS(COALESCE(p.cost_price_usd, 0) - d.v) > 0.00005 OR ABS(COALESCE(p.purchase_price_usd, 0) - d.v) > 0.00005);
--   -- expect about 5,918 (5,914 after 0174 removed four losers)
--
-- ============================== POST-ASSERTION ===========================
--   (same query) -- expect 0
--   SELECT COUNT(*), SUM(cost_before <> cost_after) FROM catalog_cost_recompute_0175 WHERE applied = 1; -- ~5,914 / ~859
--   SELECT COUNT(*) FROM products WHERE is_active = 1 AND cost_price_usd <> purchase_price_usd
--     AND id IN (SELECT product_id FROM catalog_cost_recompute_0175); -- 0
--
-- ============================== RECOVERY =================================
-- catalog_cost_recompute_0175 keeps cost_before / purchase_before per
-- product (also in the undo_snapshots row of kind
-- 'catalog.cost_recompute_backfill', source 'repair-0175'):
--   UPDATE products SET cost_price_usd = (SELECT cost_before FROM catalog_cost_recompute_0175 w WHERE w.product_id = products.id),
--     purchase_price_usd = (SELECT purchase_before FROM catalog_cost_recompute_0175 w WHERE w.product_id = products.id)
--   WHERE id IN (SELECT product_id FROM catalog_cost_recompute_0175);

CREATE TABLE IF NOT EXISTS catalog_cost_recompute_0175 (
  product_id INTEGER PRIMARY KEY,
  cost_before REAL,
  purchase_before REAL,
  cost_after REAL NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

INSERT OR IGNORE INTO catalog_cost_recompute_0175 (product_id, cost_before, purchase_before, cost_after)
SELECT p.id, p.cost_price_usd, p.purchase_price_usd, d.v
FROM products p
JOIN (
  SELECT variant_product_id AS pid,
    CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(SUM(cost) * 1.0 / COUNT(*), 4) END AS v
  FROM (SELECT DISTINCT variant_product_id, unit_cost_usd AS cost FROM product_batches
        WHERE is_active = 1 AND unit_cost_usd IS NOT NULL AND unit_cost_usd <> 0)
  GROUP BY variant_product_id
) d ON d.pid = p.id
WHERE p.is_active = 1
  AND d.v > 0
  AND (ABS(COALESCE(p.cost_price_usd, 0) - d.v) > 0.00005 OR ABS(COALESCE(p.purchase_price_usd, 0) - d.v) > 0.00005)
  AND NOT EXISTS (SELECT 1 FROM catalog_cost_recompute_0175 w WHERE w.product_id = p.id);

-- Before-values snapshot (recovery), only when there is something to apply.
INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
SELECT
  'catalog.cost_recompute_backfill', 'applied',
  json_object(
    'source', 'repair-0175',
    'rule', 'mean of distinct non-zero active-lot costs; dearest if > 2x cheapest; purchase_price_usd mirrored',
    'products', json_group_array(json_object(
      'id', w.product_id, 'cost_before', w.cost_before, 'purchase_before', w.purchase_before, 'cost_after', w.cost_after))
  ),
  NULL, 'migration:0175_catalog_cost_recompute_backfill'
FROM catalog_cost_recompute_0175 w
WHERE w.applied = 0
GROUP BY w.applied;

UPDATE products SET
  cost_price_usd = (SELECT w.cost_after FROM catalog_cost_recompute_0175 w WHERE w.product_id = products.id AND w.applied = 0),
  purchase_price_usd = (SELECT w.cost_after FROM catalog_cost_recompute_0175 w WHERE w.product_id = products.id AND w.applied = 0),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT w.product_id FROM catalog_cost_recompute_0175 w WHERE w.applied = 0);

INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT NULL, 'migration:0175_catalog_cost_recompute_backfill', 'catalog_cost_recompute_backfill', 'product', 'bulk',
  json_object('source', 'repair-0175', 'products', COUNT(*), 'cost_changed', SUM(CASE WHEN ABS(COALESCE(w.cost_before, 0) - w.cost_after) > 0.00005 THEN 1 ELSE 0 END)),
  'products', 'bulk', NULL, NULL
FROM catalog_cost_recompute_0175 w
WHERE w.applied = 0
GROUP BY w.applied;

UPDATE catalog_cost_recompute_0175 SET applied = 1, applied_at = CURRENT_TIMESTAMP WHERE applied = 0;
