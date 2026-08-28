-- 0079: reconcile branch_batch_stock to branch_stock for single-lot products
-- (Z1b -- "batch per row shows 0").
--
-- The catalog import created product_batches + branch_stock but did NOT
-- create a branch_batch_stock row for every product/branch, so the lot
-- detail read 0 stock even though branch_stock held the units. Measured on
-- production: every one of the ~6,100 products has exactly ONE active lot,
-- 1,253 branch_stock rows had no matching branch_batch_stock row, and 4 had
-- drifted. With exactly one lot, all of a product's per-branch stock belongs
-- to that lot, so the lot's per-branch quantity must equal the product's.
--
-- Scoped to single-lot products only (the guard subquery), so a product that
-- later carries multiple lots -- where attribution is ambiguous -- is left
-- untouched. Idempotent: re-running sets the same values.

-- 1. Insert a lot-stock row wherever branch_stock has units but the lot has
--    no row at that branch yet.
INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
SELECT sl.lot_id, bs.branch_id, bs.quantity
FROM branch_stock bs
JOIN (
  SELECT variant_product_id AS pid, MIN(id) AS lot_id, COUNT(*) AS n
  FROM product_batches WHERE is_active = 1 GROUP BY variant_product_id
) sl ON sl.pid = bs.product_id AND sl.n = 1
LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = sl.lot_id AND bbs.branch_id = bs.branch_id
WHERE bbs.batch_id IS NULL AND bs.quantity > 0;

-- 2. Correct any existing single-lot row that drifted from its product's
--    branch_stock (a branch with no branch_stock row means 0 at that lot).
UPDATE branch_batch_stock
SET quantity = COALESCE((
      SELECT bs.quantity FROM branch_stock bs
      WHERE bs.product_id = (SELECT variant_product_id FROM product_batches WHERE id = branch_batch_stock.batch_id)
        AND bs.branch_id = branch_batch_stock.branch_id
    ), 0),
    updated_at = datetime('now')
WHERE batch_id IN (
  SELECT lot_id FROM (
    SELECT MIN(id) AS lot_id, COUNT(*) AS n
    FROM product_batches WHERE is_active = 1 GROUP BY variant_product_id
  ) WHERE n = 1
);
