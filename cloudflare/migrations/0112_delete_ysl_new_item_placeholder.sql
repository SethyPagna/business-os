-- 0112: delete the `Ysl New Item` placeholder product (id 10185).
--
-- The owner's ruling (Sep 4 2026, verbatim): "`Ysl New Item`, no barcode, zero
-- cost, nothing to average against -- placeholder to delete." It is NOT a merge
-- candidate: it has no barcode and no cost, so there is nothing for the merge
-- rule to average it against and no sibling row it belongs to. Every other row
-- this lane touches goes through POST /api/products/merge-duplicates, which
-- carries stock, batches, sale_items, movements, images, an audit_logs row and
-- a reversible undo_snapshots entry. That route folds a duplicate INTO a
-- keeper; a lone placeholder has no keeper, so this one row is the only part of
-- the ruling that a migration has to do.
--
-- Measured on production (SELECT-only, 2026-09-04) before writing this:
--   sale_items 0, return_items 0, inventory_movements 0, stock_transfers 0,
--   product_images 0, branch_stock 2 rows totalling quantity 0,
--   product_batches 1 (id 55409) with 2 branch_batch_stock rows totalling 0.
-- So the row is genuinely unreferenced and a hard delete loses no history.
--
-- Every statement below repeats the SAME guard, so this migration is a no-op
-- unless id 10185 is still exactly that placeholder AND still carries nothing.
-- If someone reuses the id, renames the row, sells it, or puts stock on it
-- between now and the day this is applied, the migration silently does nothing
-- rather than destroying real data. It is also idempotent and safe to run
-- against a database that never had the row at all -- which matters because
-- the pure-test harness replays every migration into a fresh in-memory SQLite.

DELETE FROM branch_batch_stock
WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id = 10185)
  AND (SELECT COUNT(*) FROM products p WHERE p.id = 10185
        AND lower(trim(p.name)) = 'ysl new item'
        AND COALESCE(trim(p.barcode), '') = ''
        AND COALESCE(p.cost_price_usd, 0) = 0
        AND COALESCE(p.cost_price_khr, 0) = 0) = 1
  AND (SELECT COUNT(*) FROM sale_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM return_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM stock_transfers WHERE product_id = 10185) = 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = 10185) = 0
  AND (SELECT COALESCE(SUM(bbs.quantity), 0) FROM branch_batch_stock bbs
        JOIN product_batches pb ON pb.id = bbs.batch_id
        WHERE pb.variant_product_id = 10185) = 0;

DELETE FROM product_batches
WHERE variant_product_id = 10185
  AND (SELECT COUNT(*) FROM products p WHERE p.id = 10185
        AND lower(trim(p.name)) = 'ysl new item'
        AND COALESCE(trim(p.barcode), '') = ''
        AND COALESCE(p.cost_price_usd, 0) = 0
        AND COALESCE(p.cost_price_khr, 0) = 0) = 1
  AND (SELECT COUNT(*) FROM sale_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM return_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM stock_transfers WHERE product_id = 10185) = 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM branch_batch_stock bbs
        JOIN product_batches pb ON pb.id = bbs.batch_id
        WHERE pb.variant_product_id = 10185) = 0;

DELETE FROM branch_stock
WHERE product_id = 10185
  AND (SELECT COUNT(*) FROM products p WHERE p.id = 10185
        AND lower(trim(p.name)) = 'ysl new item'
        AND COALESCE(trim(p.barcode), '') = ''
        AND COALESCE(p.cost_price_usd, 0) = 0
        AND COALESCE(p.cost_price_khr, 0) = 0) = 1
  AND (SELECT COUNT(*) FROM sale_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM return_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM stock_transfers WHERE product_id = 10185) = 0
  AND (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM product_batches WHERE variant_product_id = 10185) = 0;

DELETE FROM products
WHERE id = 10185
  AND lower(trim(name)) = 'ysl new item'
  AND COALESCE(trim(barcode), '') = ''
  AND COALESCE(cost_price_usd, 0) = 0
  AND COALESCE(cost_price_khr, 0) = 0
  AND (SELECT COUNT(*) FROM sale_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM return_items WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM stock_transfers WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM branch_stock WHERE product_id = 10185) = 0
  AND (SELECT COUNT(*) FROM product_batches WHERE variant_product_id = 10185) = 0;
