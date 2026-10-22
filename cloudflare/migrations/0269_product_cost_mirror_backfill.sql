-- 0269 product cost mirror backfill (lane 6.0.944).
-- products.purchase_price_usd/khr is the legacy twin of cost_price_usd/khr: one figure, written together by every
-- writer of a cost (lib/catalogCostRecompute.ts COST_MIRROR_COLUMNS). An unknown (NULL) cost mirrors as 0 or NULL: both
-- read as "unfilled". A twin is ALIGNED when
--   cost_price_<c> IS purchase_price_<c>  OR  (cost_price_<c> IS NULL AND COALESCE(purchase_price_<c>, 0) = 0)
-- Production (read 21 Oct 2026, health-catalog-cost active_mirror_drift 21, forensics-catalog-mirror-drift-rows): 18 products
-- from the 29 Aug import (cost set, twin 0), product 51 (manual cost override 2 Oct: cost 12, twin kept the lot cost 9) and
-- 2 precision rows (4 dp noise). The cost-only writers that left them behind are fixed in the Worker (same lane).
--
-- Shape rule: wrangler's statement splitter opens a compound statement at whitespace + CASE and closes it only at END followed by
-- whitespace or ';', so a CASE inside an expression is written (CASE ... END) and the file still splits into 16 statements.
--
-- Scope: ACTIVE products where either currency's twin is not aligned. Each gets its twin set to COALESCE(cost, 0); an
-- aligned twin of the same row is left as it is. The cost columns, updated_at, inactive rows and aligned rows are not touched.
-- Each written row fires stock_revision_products_update (0124), so an open product editor sees a new revision;
-- the D1 products cache version is bumped below (the KV-keyed reads age out in seconds).
-- The write needs the stock-transaction permit (0258 guards the four cost columns); the file inserts it and removes it again
-- before its POST checks, exactly as lib/stockTransaction.ts does. A database with no stock epoch has no 0258 guard either (the
-- stock-bridge test harnesses apply 0243 and 0258 after every other file), so no permit is inserted there.
--
-- PRE:  the stock epoch, when there is one, is legacy-separate-pool-v1; no maintenance flag and no permit; the scope is at most
--       100 rows (production: 21), or the file aborts before any write. Record SELECT COUNT(*) FROM products and the scope count.
-- POST: no ACTIVE product has a non-aligned twin; the ledger holds one row per product written, each landed on its after
--       value with its cost unchanged and still active; the products row count, every cost column, is_active, and the
--       twins outside the scope are unchanged (integer checksums taken after the ledger fixes the scope and re-read
--       after the write); no permit is left behind. A failed check reads a malformed JSON path and aborts the file.
-- Ledger product_cost_mirror_0269 (product id, cost at repair, before and after twin, USD and KHR) makes it reversible;
-- its value columns carry no type so each value is stored exactly as read. Not backed up (a restore replaces products
-- with its own copy); excluded in test-backup-tables-completeness-pure.cjs.
-- Pinned by scripts/test-migration-0269-cost-mirror-native.cjs.
--
-- RECOVERY (owner-approved only): put the old twins back where nothing has moved them since, inside the permit:
--   INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP
--     FROM system_flags WHERE key = 'stock_schema_epoch';
--   UPDATE products SET
--     purchase_price_usd = (SELECT before_purchase_usd FROM product_cost_mirror_0269 WHERE product_id = products.id),
--     purchase_price_khr = (SELECT before_purchase_khr FROM product_cost_mirror_0269 WHERE product_id = products.id)
--   WHERE EXISTS (SELECT 1 FROM product_cost_mirror_0269 l WHERE l.product_id = products.id
--     AND products.purchase_price_usd IS l.after_purchase_usd AND products.purchase_price_khr IS l.after_purchase_khr);
--   DELETE FROM system_flags WHERE key = 'stock_transaction_permit';
--   UPDATE cache_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE namespace = 'products';
-- A row edited after this file keeps its newer twin. DROP TABLE product_cost_mirror_0269 only after the restore is checked.

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'stock_schema_epoch' AND value IS NOT 'legacy-separate-pool-v1')
    AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit'))
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_pre_state]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE is_active = 1 AND (
    NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0))
    OR NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0)))) <= 100
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_pre_scope_over_100]') END;

CREATE TABLE product_cost_mirror_0269 (
  product_id INTEGER PRIMARY KEY,
  cost_price_usd,
  cost_price_khr,
  before_purchase_usd,
  before_purchase_khr,
  after_purchase_usd,
  after_purchase_khr,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO product_cost_mirror_0269 (product_id, cost_price_usd, cost_price_khr, before_purchase_usd, before_purchase_khr, after_purchase_usd, after_purchase_khr)
SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr,
  (CASE WHEN cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0)
    THEN purchase_price_usd ELSE COALESCE(cost_price_usd, 0) END),
  (CASE WHEN cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0)
    THEN purchase_price_khr ELSE COALESCE(cost_price_khr, 0) END)
FROM products WHERE is_active = 1 AND (
  NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0))
  OR NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0)));

CREATE TABLE _product_cost_mirror_0269_fingerprint (
  k INTEGER PRIMARY KEY CHECK (k = 1),
  products_total, products_active, all_cost_usd, all_cost_khr, outside_rows, outside_purchase_usd, outside_purchase_khr
);

INSERT INTO _product_cost_mirror_0269_fingerprint
SELECT 1, COUNT(*), COALESCE(SUM(is_active), 0),
  COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_usd, 0) * 10000.0) AS INTEGER)), 0),
  COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_khr, 0) * 10000.0) AS INTEGER)), 0),
  COALESCE(SUM(CASE WHEN id NOT IN (SELECT product_id FROM product_cost_mirror_0269) THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN id NOT IN (SELECT product_id FROM product_cost_mirror_0269)
    THEN CAST(ROUND(COALESCE(purchase_price_usd, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN id NOT IN (SELECT product_id FROM product_cost_mirror_0269)
    THEN CAST(ROUND(COALESCE(purchase_price_khr, 0) * 10000.0) AS INTEGER) ELSE 0 END), 0)
FROM products;

INSERT INTO system_flags (key, value, updated_at)
SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch';

UPDATE products SET
  purchase_price_usd = (SELECT after_purchase_usd FROM product_cost_mirror_0269 WHERE product_id = products.id),
  purchase_price_khr = (SELECT after_purchase_khr FROM product_cost_mirror_0269 WHERE product_id = products.id)
WHERE id IN (SELECT product_id FROM product_cost_mirror_0269);

DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';

UPDATE cache_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE namespace = 'products';

SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'stock_transaction_permit')
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_post_permit_left]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE is_active = 1 AND (
    NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0))
    OR NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0)))) = 0
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_post_active_drift]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM product_cost_mirror_0269 l JOIN products p ON p.id = l.product_id
    WHERE p.is_active = 1 AND p.purchase_price_usd IS l.after_purchase_usd AND p.purchase_price_khr IS l.after_purchase_khr
      AND p.cost_price_usd IS l.cost_price_usd AND p.cost_price_khr IS l.cost_price_khr) = (SELECT COUNT(*) FROM product_cost_mirror_0269)
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_post_ledger]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products) = (SELECT products_total FROM _product_cost_mirror_0269_fingerprint)
  AND (SELECT COALESCE(SUM(is_active), 0) FROM products) = (SELECT products_active FROM _product_cost_mirror_0269_fingerprint)
  AND (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_usd, 0) * 10000.0) AS INTEGER)), 0) FROM products) = (SELECT all_cost_usd FROM _product_cost_mirror_0269_fingerprint)
  AND (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(cost_price_khr, 0) * 10000.0) AS INTEGER)), 0) FROM products) = (SELECT all_cost_khr FROM _product_cost_mirror_0269_fingerprint)
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_post_rows_or_costs_changed]') END;

SELECT CASE WHEN (SELECT COUNT(*) FROM products WHERE id NOT IN (SELECT product_id FROM product_cost_mirror_0269)) = (SELECT outside_rows FROM _product_cost_mirror_0269_fingerprint)
  AND (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(purchase_price_usd, 0) * 10000.0) AS INTEGER)), 0) FROM products
    WHERE id NOT IN (SELECT product_id FROM product_cost_mirror_0269)) = (SELECT outside_purchase_usd FROM _product_cost_mirror_0269_fingerprint)
  AND (SELECT COALESCE(SUM(CAST(ROUND(COALESCE(purchase_price_khr, 0) * 10000.0) AS INTEGER)), 0) FROM products
    WHERE id NOT IN (SELECT product_id FROM product_cost_mirror_0269)) = (SELECT outside_purchase_khr FROM _product_cost_mirror_0269_fingerprint)
THEN 1 ELSE json_extract('[]', '$[cost_mirror_0269_post_outside_scope_changed]') END;

DROP TABLE _product_cost_mirror_0269_fingerprint;
