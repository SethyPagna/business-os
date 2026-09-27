-- (product, branch) pairs whose lot stock is MORE than their branch stock.
--
-- Lot stock is SUM(branch_batch_stock.quantity) over every lot of the product
-- at that branch (product_batches.variant_product_id is the product), exactly
-- as transferOperation.ts's untracked-stock guard computes it: that guard
-- refuses a transfer when branch_stock.quantity minus the lot sum is below
-- the untracked quantity, so a pair counted here cannot transfer at all. A
-- pair with lots and no branch_stock row counts as branch stock 0.
--
-- One row of counts; the counts reach only the encrypted artifact.
--   pairs_lots_exceed_branch      pairs where lot stock > branch stock
--   products_lots_exceed_branch   distinct products among them
--   pairs_without_branch_row      of those, pairs with no branch_stock row
--   pairs_exceed_below_0_000001   of those, pairs over by less than 0.000001
--                                 (float residue; the guard refuses them too)
--   pairs_with_lots               every (product, branch) pair holding lots
-- ops:min-rows 1
-- ops:max-rows 1
WITH lots AS (
  SELECT pb.variant_product_id AS product_id, bbs.branch_id AS branch_id, SUM(bbs.quantity) AS lot_quantity
  FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id
  GROUP BY pb.variant_product_id, bbs.branch_id
),
excess AS (
  SELECT l.product_id, l.branch_id, l.lot_quantity, bs.quantity AS branch_quantity
  FROM lots l
  LEFT JOIN branch_stock bs ON bs.product_id = l.product_id AND bs.branch_id = l.branch_id
  WHERE l.lot_quantity > COALESCE(bs.quantity, 0)
)
SELECT
  COUNT(*) AS pairs_lots_exceed_branch,
  COUNT(DISTINCT product_id) AS products_lots_exceed_branch,
  COALESCE(SUM(CASE WHEN branch_quantity IS NULL THEN 1 ELSE 0 END), 0) AS pairs_without_branch_row,
  COALESCE(SUM(CASE WHEN lot_quantity - COALESCE(branch_quantity, 0) < 0.000001 THEN 1 ELSE 0 END), 0) AS pairs_exceed_below_0_000001,
  (SELECT COUNT(*) FROM lots) AS pairs_with_lots
FROM excess
