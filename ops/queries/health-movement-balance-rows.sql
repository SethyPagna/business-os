-- health-movement-balance-rows: the drill-down for health-movement-balance
-- (DATA-MATCH DM-05). One row
-- per (product, branch) whose implied opening stock (on-hand minus signed
-- movements, sign by type as the Stock Change ledger derives it) is not 0.
-- Diff two runs' decrypted files by (product_id, branch_id): a pair whose
-- implied_opening changed between runs is where stock moved without a movement
-- (or the reverse) in between; last_movement_id / last_movement_at date it.
-- A products import writes stock with no movement (a new product's first stock,
-- and the branch snapshot, lib/productBatches.ts planReconcileBranchSnapshot):
-- import_lot_id is the newest lot those writers left at the pair. NULL does not
-- rule an import out: a snapshot that lowered stock creates no lot.
-- unbalanced_pairs_total is on every row so a truncated list is visible.
-- Ids, dates and quantities only.
-- ops:min-rows 0
-- ops:max-rows 5000
WITH mv AS MATERIALIZED (
  SELECT COALESCE(product_id, -1) AS pid, COALESCE(branch_id, -1) AS bid,
    SUM(CASE WHEN movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
        'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out')
      THEN -ABS(COALESCE(quantity, 0)) ELSE ABS(COALESCE(quantity, 0)) END) AS net,
    COUNT(*) AS n, MAX(id) AS last_id
  FROM inventory_movements
  GROUP BY COALESCE(product_id, -1), COALESCE(branch_id, -1)
),
pair_imp AS MATERIALIZED (
  SELECT pid, bid, SUM(onhand) AS onhand, SUM(net) AS net, SUM(n) AS n, MAX(last_id) AS last_id
  FROM (
    SELECT product_id AS pid, branch_id AS bid, quantity AS onhand, 0 AS net, 0 AS n, NULL AS last_id FROM branch_stock
    UNION ALL
    SELECT pid, bid, 0, net, n, last_id FROM mv
  ) GROUP BY pid, bid
),
bad AS MATERIALIZED (
  SELECT pid, bid, onhand, net, onhand - net AS implied, n, last_id FROM pair_imp WHERE ABS(onhand - net) > 0.000001
)
SELECT b.pid AS product_id, b.bid AS branch_id, ROUND(b.implied, 6) AS implied_opening, b.onhand AS on_hand,
  ROUND(b.net, 6) AS movement_net, b.n AS movement_rows, b.last_id AS last_movement_id,
  (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) FROM inventory_movements m WHERE m.id = b.last_id) AS last_movement_at,
  (SELECT MAX(pb.id) FROM product_batches pb
    JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = b.bid
    WHERE pb.variant_product_id = b.pid
      AND pb.notes IN ('Received via product import', 'Stock reconciled from product import snapshot')) AS import_lot_id,
  (SELECT COUNT(*) FROM bad) AS unbalanced_pairs_total
FROM bad b
ORDER BY b.pid, b.bid
LIMIT 5000
