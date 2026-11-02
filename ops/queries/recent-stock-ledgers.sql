-- recent-stock-ledgers: Tier A "recent" check of the two on-hand ledgers (RELIABILITY-PLAN 5.2, P0.6).
-- The cheap daily and after-every-deploy twin of health-stock-ledgers: the same four definitions, read only for the
-- (product, branch) pairs that had a stock movement in the last two business days. The whole table is never scanned.
--   window            yesterday 00:00 and today in Cambodia (UTC+7): datetime(date('now','+7 hours','-1 day'),'-7 hours').
--                     A value written in the ISO 'T' form compares greater than the space form, so a mixed-format row
--                     is read too often, never missed.
--   pairs_checked     context: how many pairs moved in the window (0 on a quiet day)
--   rollup_drift_products              products.stock_quantity vs SUM(branch_stock) for a moved product
--   pairs_lots_exceed_branch           SUM(lot stock) above branch_stock on a moved pair (a transfer refuses it)
--   tracked_pairs_unlotted / _units    branch_stock above the lot sum on a pair the POS treats as lot-tracked
--   damaged_remaining_on_inactive_product  tagged damaged units left on a missing or inactive row of a moved product
--   info_pairs_without_branch_row      context: a moved pair with no branch_stock row (not an alarm: legacy ids)
-- Blind spots, by design: (1) stock written WITHOUT any movement (a products import snapshot, the old STK-C drain) is not in the
-- window. (2) Stock written NOW under a BACKDATED movement is not in it either: a dated stock count stamps its movement
-- "<date> 00:00:00" (datedStockCountApply.ts) and a stock-in import stamps its movement date (importEngine.ts), yet both write
-- branch_stock and the lots now, so a drift they leave on a pair whose movements are all older than the window reads as
-- pairs_checked 0 and PASS here. The weekly full pack (health-stock-ledgers, health-movement-balance) covers both, and so Tier B
-- is to be run after every import and every dated count (RELIABILITY-PLAN 5.2).
-- Every plan is pinned (INDEXED BY): without statistics the planner read the whole movement table for the pair list.
-- Counts only; ids stay in the encrypted file.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero rollup_drift_products,pairs_lots_exceed_branch,tracked_pairs_unlotted,tracked_units_unlotted,damaged_remaining_on_inactive_product
-- Ceiling rule (pinned by test-ops-query-budget-native.cjs): at least 3 x the rows the production-sized seed reads in a day (the larger of plain and
-- ANALYZE), never under 2,000, never over the plan's 20,000 for one Tier A file. A busy trading day or the day after a large import must not
-- fail the run with read-ceiling-exceeded; a plan that flips to a table scan (36k to 540k rows on these tables) still does.
-- Seed day 4,470 rows, so 13,410; 14,000 leaves the measurement room to drift.
-- ops:max-rows-read 14000
WITH win AS MATERIALIZED (
  SELECT datetime(date('now', '+7 hours', '-1 day'), '-7 hours') AS cut
),
tp AS MATERIALIZED (
  SELECT product_id AS pid, branch_id AS bid
  FROM inventory_movements INDEXED BY idx_inventory_movements_created_pg
  WHERE created_at >= (SELECT cut FROM win) AND product_id IS NOT NULL AND branch_id IS NOT NULL
  GROUP BY product_id, branch_id
),
tprod AS MATERIALIZED (
  SELECT DISTINCT pid FROM tp
),
roll AS MATERIALIZED (
  SELECT p.id AS id,
    COALESCE(p.stock_quantity, 0) - COALESCE((SELECT SUM(b.quantity) FROM branch_stock b INDEXED BY idx_branch_stock_product_branch_unique
      WHERE b.product_id = p.id), 0) AS drift
  FROM tprod t CROSS JOIN products p ON p.id = t.pid
),
lots AS MATERIALIZED (
  SELECT tp.pid AS pid, tp.bid AS bid, SUM(bbs.quantity) AS lot_qty,
    MAX(CASE WHEN pb.is_active = 1 OR bbs.quantity > 0 THEN 1 ELSE 0 END) AS tracked
  FROM tp
  CROSS JOIN product_batches pb INDEXED BY idx_product_batches_variant_number ON pb.variant_product_id = tp.pid
  CROSS JOIN branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_batch_branch_unique ON bbs.batch_id = pb.id AND bbs.branch_id = tp.bid
  GROUP BY tp.pid, tp.bid
),
pr AS MATERIALIZED (
  SELECT tp.pid AS pid, tp.bid AS bid, b.quantity AS qty, l.lot_qty AS lot_qty, l.tracked AS tracked
  FROM tp
  LEFT JOIN branch_stock b INDEXED BY idx_branch_stock_product_branch_unique ON b.product_id = tp.pid AND b.branch_id = tp.bid
  LEFT JOIN lots l ON l.pid = tp.pid AND l.bid = tp.bid
)
SELECT
  x.pairs_checked, (SELECT COALESCE(SUM(ABS(drift) > 0.000001), 0) FROM roll) AS rollup_drift_products,
  x.pairs_lots_exceed_branch, x.tracked_pairs_unlotted, x.tracked_units_unlotted,
  (SELECT COUNT(*) FROM tprod t CROSS JOIN damaged_stock_lots d INDEXED BY idx_damaged_lots_product_branch ON d.product_id = t.pid
     LEFT JOIN products p ON p.id = d.product_id
     WHERE COALESCE(d.quantity_remaining, 0) > 0 AND (p.id IS NULL OR p.is_active = 0)) AS damaged_remaining_on_inactive_product,
  x.info_pairs_without_branch_row
FROM (
  SELECT COUNT(*) AS pairs_checked,
    COALESCE(SUM(lot_qty IS NOT NULL AND lot_qty > COALESCE(qty, 0)), 0) AS pairs_lots_exceed_branch,
    COALESCE(SUM(tracked = 1 AND qty - lot_qty > 0.000001), 0) AS tracked_pairs_unlotted,
    ROUND(COALESCE(SUM(CASE WHEN tracked = 1 AND qty - lot_qty > 0.000001 THEN qty - lot_qty END), 0), 4) AS tracked_units_unlotted,
    COALESCE(SUM(qty IS NULL), 0) AS info_pairs_without_branch_row
  FROM pr
) x
