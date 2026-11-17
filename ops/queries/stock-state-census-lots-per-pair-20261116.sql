-- stock-state-census-lots-per-pair-20261116: stock-state design Phase 0, census C5 and the stocked-lot counts per pair.
-- A lot "holds stock" when branch_batch_stock.quantity > 0 (design D2; migration 0154 keeps such a lot active). One row per
-- branch id, then one row with branch_id = -1 for all branches together:
--   pairs               (variant product, branch) pairs with at least one stocked lot: the rows stock_state would hold at
--                       branch_id > 0 and the products the tracked-ids reader returns at that branch (R5)
--   stocked_lots        stocked lots at that branch (the -1 row counts every one)
--   max_lots_per_pair   the largest stocked_lots on one pair
--   pairs_1/2/3_5/6_up  how many pairs hold 1, 2, 3-5 or 6+ stocked lots: the T5 trigger's recount cost per touched lot
--   distinct_products   products with a stocked lot (the -1 row: across branches)
--   pairs_on_inactive_lot  pairs whose only stocked lots sit on an inactive product_batches row (0154 says none)
-- Plus, on the -1 row only, positive lots whose product_batches row is missing (orphans no pair can count).
-- Counts only; branch ids are numbers, never names. Reads the partial positive-lot index, then one seek per lot.
-- ops:min-rows 1
-- ops:max-rows 200
-- ops:max-rows-read 50000
WITH lots AS MATERIALIZED (
  SELECT pb.variant_product_id AS v, bbs.branch_id AS b, COUNT(*) AS n,
    MAX(CASE WHEN pb.is_active = 1 THEN 1 ELSE 0 END) AS has_active
  FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
  JOIN product_batches pb ON pb.id = bbs.batch_id
  WHERE bbs.quantity > 0
  GROUP BY pb.variant_product_id, bbs.branch_id
),
per AS (
  SELECT b AS branch_id, COUNT(*) AS pairs, SUM(n) AS stocked_lots, MAX(n) AS max_lots_per_pair,
    SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS pairs_1,
    SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END) AS pairs_2,
    SUM(CASE WHEN n BETWEEN 3 AND 5 THEN 1 ELSE 0 END) AS pairs_3_5,
    SUM(CASE WHEN n >= 6 THEN 1 ELSE 0 END) AS pairs_6_up,
    COUNT(*) AS distinct_products,
    SUM(CASE WHEN has_active = 0 THEN 1 ELSE 0 END) AS pairs_on_inactive_lot,
    0 AS orphan_positive_lots
  FROM lots GROUP BY b
)
SELECT * FROM per
UNION ALL
SELECT -1, COUNT(*), COALESCE(SUM(n), 0), COALESCE(MAX(n), 0),
  COALESCE(SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN n = 2 THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN n BETWEEN 3 AND 5 THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN n >= 6 THEN 1 ELSE 0 END), 0),
  COUNT(DISTINCT v), COALESCE(SUM(CASE WHEN has_active = 0 THEN 1 ELSE 0 END), 0),
  (SELECT COUNT(*) FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
     WHERE bbs.quantity > 0 AND NOT EXISTS (SELECT 1 FROM product_batches x WHERE x.id = bbs.batch_id))
FROM lots
ORDER BY 1
