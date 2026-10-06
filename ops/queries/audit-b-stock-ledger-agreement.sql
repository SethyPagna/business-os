-- DATA-AUDIT lane B (stock & cost), query 1 of 13: do the stock ledgers agree, and do their rows point at things that exist?
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Stock is recorded in three places (memory two-stock-ledgers-diverge): products.stock_quantity (the all-branch
-- rollup), branch_stock (per product and branch) and branch_batch_stock (per lot and branch; the lot belongs to a
-- product through product_batches.variant_product_id). The Products page and inventory stats read branch_stock; the POS
-- reads the LOT total whenever a product is batch-tracked at that branch (lib/productBatches.ts getTrackedProductIds:
-- an active lot with a branch_batch_stock row there, empty or not), so a fork shows only at the till.
-- Not repeated here (run them as they are): lots-exceed-branch-stock.sql (lots MORE than branch stock),
-- forensics-s7-product-rollup-drift.sql (the per-product list); this file adds the other direction and the orphans.
--
-- One row of counts and two example lists (ids and quantities only; no names, no money).
--   Info columns (not zero-expected; untracked stock is legitimate, see transferOperation.ts):
--   tracked_pairs_branch_exceeds_lots  (product, branch) pairs the POS reads from lots where the branch holds MORE than
--                                      the lots do: the till shows the smaller figure
--   tracked_pairs_till_shows_zero      of those, pairs whose lots hold nothing while the shelf holds stock ("28 here, 0 there")
--   tracked_units_hidden_from_till     the units the till cannot see on those pairs
--   rollup_drift_active / _inactive    products whose stock_quantity differs from the sum of their branch_stock rows
--                                      (the list is forensics-s7; the app's own repair is Branches -> Stock integrity)
--   Zero-expected columns (a non-zero value is a defect, named by the column):
--   branch_stock_orphan_product        branch_stock rows whose product no longer exists
--   branch_stock_orphan_branch         branch_stock rows whose branch does not exist
--   lot_stock_orphan_lot               branch_batch_stock rows whose lot (product_batches row) does not exist
--   lot_stock_orphan_branch            branch_batch_stock rows whose branch does not exist
--   lots_orphan_product                product_batches rows whose product does not exist
--   stock_at_inactive_branch           branch_stock or lot rows holding stock at a disabled branch (nothing can sell it)
--   positive_stock_in_inactive_lot     lot rows with stock whose lot is inactive (migration 0154 forbids new ones)
--   active_stock_without_branch_row    active products with a rollup above 0 and no branch_stock row at all
--                                      (Branches -> Stock integrity "missing_branch_stock")
--   rollup_negative                    products with a negative stock_quantity (the column has no CHECK)
--   examples_till_fork                 up to 5 [product_id, branch_id, shelf, lots], largest gap first
--   example_*                          the lowest orphan id of each kind (a product id, a lot id, a lot id), NULL when none
-- Measured cost: see the header of test-audit-b-scale-workerd.cjs output (one pass over branch_stock, branch_batch_stock
-- and product_batches; no per-row sub-query).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero branch_stock_orphan_product,branch_stock_orphan_branch,lot_stock_orphan_lot,lot_stock_orphan_branch,lots_orphan_product,stock_at_inactive_branch,positive_stock_in_inactive_lot,active_stock_without_branch_row,rollup_negative
WITH bl AS MATERIALIZED (
  -- one pass over the lot rows: per (product, branch) the lot total and every lot-side defect flag
  SELECT pb.variant_product_id AS product_id, bbs.branch_id AS branch_id, SUM(bbs.quantity) AS lot_q,
    MAX(CASE WHEN pb.is_active = 1 OR bbs.quantity > 0 THEN 1 ELSE 0 END) AS tracked,
    SUM(CASE WHEN pb.id IS NULL THEN 1 ELSE 0 END) AS no_lot,
    SUM(CASE WHEN bbs.branch_id NOT IN (SELECT id FROM branches) THEN 1 ELSE 0 END) AS no_branch,
    SUM(CASE WHEN bbs.quantity > 0.000001 AND bbs.branch_id IN (SELECT id FROM branches WHERE COALESCE(is_active, 0) <> 1) THEN 1 ELSE 0 END) AS at_inactive_branch,
    SUM(CASE WHEN bbs.quantity > 0 AND pb.id IS NOT NULL AND pb.is_active IS NOT 1 THEN 1 ELSE 0 END) AS positive_inactive,
    MIN(CASE WHEN pb.id IS NULL THEN bbs.batch_id END) AS ex_lot
  FROM branch_batch_stock bbs
  LEFT JOIN product_batches pb ON pb.id = bbs.batch_id
  GROUP BY pb.variant_product_id, bbs.branch_id
), bsx AS MATERIALIZED (
  -- one pass over branch_stock
  SELECT bs.product_id, bs.branch_id, bs.quantity AS shelf, p.id AS pid,
    CASE WHEN bs.branch_id NOT IN (SELECT id FROM branches) THEN 1 ELSE 0 END AS no_branch,
    CASE WHEN bs.quantity > 0.000001 AND bs.branch_id IN (SELECT id FROM branches WHERE COALESCE(is_active, 0) <> 1) THEN 1 ELSE 0 END AS at_inactive_branch
  FROM branch_stock bs
  LEFT JOIN products p ON p.id = bs.product_id
), fork AS MATERIALIZED (
  SELECT x.product_id, x.branch_id, x.shelf, l.lot_q
  FROM bsx x
  JOIN bl l ON l.product_id = x.product_id AND l.branch_id = x.branch_id
  WHERE l.tracked = 1 AND x.shelf > l.lot_q + 0.000001
), sums AS MATERIALIZED (
  SELECT product_id, SUM(shelf) AS s FROM bsx GROUP BY product_id
), roll AS MATERIALIZED (
  SELECT p.id, p.is_active, COALESCE(p.stock_quantity, 0) AS q, COALESCE(m.s, 0) AS s, m.product_id AS has_rows
  FROM products p LEFT JOIN sums m ON m.product_id = p.id
), lp AS (
  SELECT COUNT(*) AS n, MIN(pb.id) AS ex FROM product_batches pb LEFT JOIN products p ON p.id = pb.variant_product_id WHERE p.id IS NULL
)
SELECT
  (SELECT COUNT(*) FROM fork) AS tracked_pairs_branch_exceeds_lots,
  (SELECT COUNT(*) FROM fork WHERE lot_q <= 0.000001) AS tracked_pairs_till_shows_zero,
  (SELECT COALESCE(SUM(shelf - lot_q), 0) FROM fork) AS tracked_units_hidden_from_till,
  (SELECT COUNT(*) FROM roll WHERE is_active = 1 AND ABS(q - s) > 0.000001) AS rollup_drift_active,
  (SELECT COUNT(*) FROM roll WHERE COALESCE(is_active, 0) <> 1 AND ABS(q - s) > 0.000001) AS rollup_drift_inactive,
  (SELECT COUNT(*) FROM bsx WHERE pid IS NULL) AS branch_stock_orphan_product,
  (SELECT COALESCE(SUM(no_branch), 0) FROM bsx) AS branch_stock_orphan_branch,
  (SELECT COALESCE(SUM(no_lot), 0) FROM bl) AS lot_stock_orphan_lot,
  (SELECT COALESCE(SUM(no_branch), 0) FROM bl) AS lot_stock_orphan_branch,
  (SELECT n FROM lp) AS lots_orphan_product,
  (SELECT COALESCE(SUM(at_inactive_branch), 0) FROM bsx) + (SELECT COALESCE(SUM(at_inactive_branch), 0) FROM bl) AS stock_at_inactive_branch,
  (SELECT COALESCE(SUM(positive_inactive), 0) FROM bl) AS positive_stock_in_inactive_lot,
  (SELECT COUNT(*) FROM roll WHERE is_active = 1 AND q > 0.000001 AND has_rows IS NULL) AS active_stock_without_branch_row,
  (SELECT COUNT(*) FROM roll WHERE q < -0.000001) AS rollup_negative,
  (SELECT COALESCE(json_group_array(json_array(product_id, branch_id, shelf, lot_q)), '[]') FROM (SELECT product_id, branch_id, shelf, lot_q FROM fork ORDER BY shelf - lot_q DESC, product_id LIMIT 5)) AS examples_till_fork,
  (SELECT MIN(product_id) FROM bsx WHERE pid IS NULL) AS example_branch_stock_orphan_product,
  (SELECT MIN(ex_lot) FROM bl) AS example_lot_stock_orphan_lot,
  (SELECT ex FROM lp) AS example_lots_orphan_product
