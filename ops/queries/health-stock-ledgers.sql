-- health-stock-ledgers: the two on-hand ledgers and the product roll-up, as one
-- row of counts (DATA-MATCH DM-01, DM-03, DM-04, DM-19b, DM-21).
--   rollup_drift_products / _active / _units   products.stock_quantity vs SUM(branch_stock)
--   active_products_without_branch_row         coreDataInvariants backfills these on every
--                                              cold isolate, so it must be 0
--   pairs_lots_exceed_branch                    SUM(lot stock) > branch_stock (a transfer refuses)
--   tracked_pairs_unlotted / _units             branch_stock above the lot sum on a pair the POS
--                                              treats as lot-tracked (getTrackedProductIds, branch
--                                              scope): the till shows and sells less than Stock
--   damaged_remaining_on_inactive_product       tagged damaged units left on a missing or inactive row
--   group_headers_with_stock                    is_group=1 AND parent_id=0 rows holding branch stock
-- Counts only; values stay in the encrypted file.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero active_products_without_branch_row
WITH bs AS MATERIALIZED (
  SELECT product_id, SUM(quantity) AS qty FROM branch_stock GROUP BY product_id
),
lots AS MATERIALIZED (
  SELECT pb.variant_product_id AS product_id, bbs.branch_id AS branch_id, SUM(bbs.quantity) AS lot_qty,
    MAX(CASE WHEN pb.is_active = 1 OR bbs.quantity > 0 THEN 1 ELSE 0 END) AS tracked
  FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id
  GROUP BY pb.variant_product_id, bbs.branch_id
),
roll AS MATERIALIZED (
  SELECT p.id, p.is_active, COALESCE(p.stock_quantity, 0) - COALESCE(bs.qty, 0) AS drift
  FROM products p LEFT JOIN bs ON bs.product_id = p.id
)
SELECT
  (SELECT COUNT(*) FROM roll WHERE ABS(drift) > 0.000001) AS rollup_drift_products,
  (SELECT COUNT(*) FROM roll WHERE ABS(drift) > 0.000001 AND is_active = 1) AS rollup_drift_active,
  (SELECT ROUND(COALESCE(SUM(ABS(drift)), 0), 4) FROM roll WHERE ABS(drift) > 0.000001) AS rollup_drift_units,
  (SELECT COUNT(*) FROM products p WHERE p.is_active = 1
     AND NOT EXISTS (SELECT 1 FROM branch_stock b WHERE b.product_id = p.id)) AS active_products_without_branch_row,
  (SELECT COUNT(*) FROM lots l LEFT JOIN branch_stock b ON b.product_id = l.product_id AND b.branch_id = l.branch_id
     WHERE l.lot_qty > COALESCE(b.quantity, 0)) AS pairs_lots_exceed_branch,
  (SELECT COUNT(*) FROM branch_stock b JOIN lots l ON l.product_id = b.product_id AND l.branch_id = b.branch_id
     WHERE l.tracked = 1 AND b.quantity - l.lot_qty > 0.000001) AS tracked_pairs_unlotted,
  (SELECT ROUND(COALESCE(SUM(b.quantity - l.lot_qty), 0), 4) FROM branch_stock b
     JOIN lots l ON l.product_id = b.product_id AND l.branch_id = b.branch_id
     WHERE l.tracked = 1 AND b.quantity - l.lot_qty > 0.000001) AS tracked_units_unlotted,
  (SELECT COUNT(*) FROM damaged_stock_lots d LEFT JOIN products p ON p.id = d.product_id
     WHERE COALESCE(d.quantity_remaining, 0) > 0 AND (p.id IS NULL OR p.is_active = 0)) AS damaged_remaining_on_inactive_product,
  (SELECT COUNT(*) FROM products p WHERE COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0
     AND EXISTS (SELECT 1 FROM branch_stock b WHERE b.product_id = p.id AND ABS(b.quantity) > 0.000001)) AS group_headers_with_stock
