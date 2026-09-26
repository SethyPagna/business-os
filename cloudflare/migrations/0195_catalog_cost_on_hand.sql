-- 0195: products.cost_price_usd is the quantity-weighted cost of the stock
-- ON HAND, kept current by the database.
--
-- Owner rulings (2026-09-25): the catalog cost is
--   SUM(on-hand qty x unit cost) / SUM(on-hand qty)
-- over the lots that still hold stock, on-hand quantity summed over every
-- branch (2 left at 12.00 + 8 left at 12.50 -> 12.40), rounded to the nearest
-- 4dp. A unit cost of 0 means "not recorded" and is left out of both sums.
-- With nothing on hand, the most recently received lot with a recorded cost
-- stands in. A manual cost entry still resets the baseline: lots received
-- before it count at the entry's cost, lots received after it at their own.
-- The formula is CATALOG_COST_DERIVE_SQL in cloudflare/src/lib/catalogCostRecompute.ts.
--
-- Every statement below is generated from that file and pinned equal to it by
-- cloudflare/scripts/test-migration-0195-on-hand-cost-pure.cjs:
--   1. catalog_cost_repair_0195_backup: a copy of EVERY product's
--      cost_price_usd and purchase_price_usd, written BEFORE any UPDATE. Its
--      value columns are declared without a type, so SQLite stores each value
--      exactly as read (no affinity conversion) and recovery is byte-exact.
--   2. The one-time repair (catalogCostRepairAllSql): writes ONLY the two cost
--      columns, and only on ACTIVE rows where the derived figure differs from
--      either of them (purchase_price_usd mirrors cost_price_usd). Inactive
--      (removed / merged-away) rows are frozen history and are left alone.
--      Each written row fires stock_revision_products_update (0124), so open
--      stock sessions and product editors see a new product revision. The KV
--      cache version cannot be bumped from SQL; the D1 fallback version is
--      bumped below, and the KV-keyed product reads are max-age 20s (portal
--      60s), so they age out.
--   3. repaired_cost_price_usd records what the repair wrote (diagnostics).
--   4. Five triggers (catalogCostOnHandTriggerSql): re-derive one product when
--      a branch_batch_stock row's quantity changes / is inserted positive /
--      deleted positive / re-pointed, or a lot row is inserted or deleted. The
--      write is guarded: only the two cost columns, only when the figure
--      moves, only active products. All stand down in backup-restore mode.
-- Sale and return line cost snapshots (sale_items.cost_price_usd, ...) are
-- never touched.
--
-- PRE ASSERTIONS (read-only, immediately before applying):
--   SELECT COUNT(*) FROM products;                                  -- N
--   SELECT COUNT(*), ROUND(SUM(cost_price_usd), 4) FROM sale_items;  -- S
--   SELECT COUNT(*) FROM products WHERE is_active = 1 AND <CHANGED>; -- C, the rows the repair writes
-- where <CHANGED> is:
--   EXISTS (SELECT 1 FROM (SELECT COALESCE(
--       (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
--         FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
--           WHERE pb.variant_product_id = products.id AND pb.is_active = 1
--           AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
--           AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
--           UNION ALL
--           SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
--               JOIN product_batches ob ON ob.id = bbs.batch_id
--             WHERE ob.variant_product_id = products.id AND ob.is_active = 1
--               AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
--           WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
--             AND pce.cost_usd IS NOT NULL AND pce.cost_usd > 0)),
--       (SELECT pb.unit_cost_usd FROM product_batches pb
--         WHERE pb.variant_product_id = products.id AND pb.is_active = 1
--           AND pb.unit_cost_usd IS NOT NULL AND pb.unit_cost_usd > 0
--           AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
--         ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
--       WHERE d.derived IS NOT NULL
--         AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived))
--
-- POST ASSERTIONS:
--   SELECT COUNT(*) FROM catalog_cost_repair_0195_backup;                        -- N
--   SELECT COUNT(*) FROM catalog_cost_repair_0195_backup
--     WHERE repaired_cost_price_usd IS NOT NULL;                                 -- C
--   SELECT COUNT(*) FROM products WHERE is_active = 1 AND <CHANGED>;             -- 0
--   SELECT COUNT(*), ROUND(SUM(cost_price_usd), 4) FROM sale_items;              -- S, unchanged
--   SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
--     AND name LIKE 'catalog_cost_on_hand_%_0195';                               -- 5
--
-- RECOVERY (owner-approved only). Removes the triggers, then puts EVERY
-- backed-up product's two cost columns back exactly as they were before 0195.
-- Any cost change made after 0195 (receipts, manual edits, sales under the
-- weighted rule) is reverted with them; preview with
--   SELECT COUNT(*) FROM products p JOIN catalog_cost_repair_0195_backup b ON b.product_id = p.id
--     WHERE p.cost_price_usd IS NOT b.cost_price_usd OR p.purchase_price_usd IS NOT b.purchase_price_usd;
-- Statements:
--   DROP TRIGGER IF EXISTS catalog_cost_on_hand_stock_insert_0195;
--   DROP TRIGGER IF EXISTS catalog_cost_on_hand_stock_update_0195;
--   DROP TRIGGER IF EXISTS catalog_cost_on_hand_stock_delete_0195;
--   DROP TRIGGER IF EXISTS catalog_cost_on_hand_lot_insert_0195;
--   DROP TRIGGER IF EXISTS catalog_cost_on_hand_lot_delete_0195;
--   UPDATE products SET
--       cost_price_usd = (SELECT b.cost_price_usd FROM catalog_cost_repair_0195_backup b WHERE b.product_id = products.id),
--       purchase_price_usd = (SELECT b.purchase_price_usd FROM catalog_cost_repair_0195_backup b WHERE b.product_id = products.id)
--     WHERE id IN (SELECT b.product_id FROM catalog_cost_repair_0195_backup b
--       WHERE b.cost_price_usd IS NOT products.cost_price_usd
--          OR b.purchase_price_usd IS NOT products.purchase_price_usd
--          OR typeof(b.cost_price_usd) <> typeof(products.cost_price_usd)
--          OR typeof(b.purchase_price_usd) <> typeof(products.purchase_price_usd));
-- The backup table is never dropped by code; it is the audit trail.
-- D1 applies the migration transactionally. No explicit transaction statements.

CREATE TABLE catalog_cost_repair_0195_backup (
  product_id INTEGER PRIMARY KEY,
  cost_price_usd,
  purchase_price_usd,
  repaired_cost_price_usd,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO catalog_cost_repair_0195_backup (product_id, cost_price_usd, purchase_price_usd)
SELECT id, cost_price_usd, purchase_price_usd FROM products;

UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));

UPDATE catalog_cost_repair_0195_backup
SET repaired_cost_price_usd = (SELECT p.cost_price_usd FROM products p WHERE p.id = catalog_cost_repair_0195_backup.product_id)
WHERE product_id IN (SELECT p.id FROM products p
  WHERE p.id = catalog_cost_repair_0195_backup.product_id
    AND (p.cost_price_usd IS NOT catalog_cost_repair_0195_backup.cost_price_usd
      OR p.purchase_price_usd IS NOT catalog_cost_repair_0195_backup.purchase_price_usd));

UPDATE cache_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE namespace = 'products';

CREATE TRIGGER catalog_cost_on_hand_stock_insert_0195
AFTER INSERT ON branch_batch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_update_0195
AFTER UPDATE OF quantity, batch_id ON branch_batch_stock
WHEN (COALESCE(OLD.quantity, 0) <> COALESCE(NEW.quantity, 0) OR OLD.batch_id IS NOT NEW.batch_id)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id, NEW.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
END;

CREATE TRIGGER catalog_cost_on_hand_stock_delete_0195
AFTER DELETE ON branch_batch_stock
WHEN COALESCE(OLD.quantity, 0) > 0
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id IN (SELECT variant_product_id FROM product_batches WHERE id IN (OLD.batch_id)) AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
END;

CREATE TRIGGER catalog_cost_on_hand_lot_insert_0195
AFTER INSERT ON product_batches
WHEN NEW.variant_product_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id = NEW.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
END;

CREATE TRIGGER catalog_cost_on_hand_lot_delete_0195
AFTER DELETE ON product_batches
WHEN OLD.variant_product_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE products SET
        cost_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), cost_price_usd),
        purchase_price_usd = COALESCE(COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)), purchase_price_usd)
      WHERE is_active = 1 AND id = OLD.variant_product_id AND EXISTS (SELECT 1 FROM (SELECT COALESCE(
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
      ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived) d
        WHERE d.derived IS NOT NULL
          AND (products.cost_price_usd IS NOT d.derived OR products.purchase_price_usd IS NOT d.derived));
END;
