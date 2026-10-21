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
-- The other two explained sources are counted per pair: merge_rows ('adjustment' rows a
-- product merge wrote onto this keeper) and held_rows / held_remaining (damaged-pool movements
-- and units still held in damaged_stock_lots at the pair); see health-movement-balance.
-- unbalanced_pairs_total is on every row so a truncated list is visible.
-- Ids, dates and quantities only.
-- ops:min-rows 0
-- ops:max-rows 5000
WITH mv AS MATERIALIZED (
  SELECT COALESCE(product_id, -1) AS pid, COALESCE(branch_id, -1) AS bid,
    SUM(CASE WHEN movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
        'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out')
      THEN -ABS(COALESCE(quantity, 0)) ELSE ABS(COALESCE(quantity, 0)) END) AS net,
    COUNT(*) AS n, MAX(id) AS last_id,
    SUM(CASE WHEN movement_type IN ('damage_in', 'damage_out', 'damage_reversal') OR COALESCE(reference_id, '') LIKE 'damaged_lot:%' THEN 1 ELSE 0 END) AS held_rows,
    SUM(CASE WHEN movement_type = 'adjustment' AND COALESCE(reason, '') LIKE 'Merged duplicate product %' THEN 1 ELSE 0 END) AS merge_rows
  FROM inventory_movements
  GROUP BY COALESCE(product_id, -1), COALESCE(branch_id, -1)
),
pair_imp AS MATERIALIZED (
  SELECT pid, bid, SUM(onhand) AS onhand, SUM(net) AS net, SUM(n) AS n, MAX(last_id) AS last_id, SUM(held_rows) AS held_rows, SUM(merge_rows) AS merge_rows
  FROM (
    SELECT product_id AS pid, branch_id AS bid, quantity AS onhand, 0 AS net, 0 AS n, NULL AS last_id, 0 AS held_rows, 0 AS merge_rows FROM branch_stock
    UNION ALL
    SELECT pid, bid, 0, net, n, last_id, held_rows, merge_rows FROM mv
  ) GROUP BY pid, bid
),
bad AS MATERIALIZED (
  SELECT pid, bid, onhand, net, onhand - net AS implied, n, last_id, held_rows, merge_rows FROM pair_imp WHERE ABS(onhand - net) > 0.000001
)
SELECT b.pid AS product_id, b.bid AS branch_id, ROUND(b.implied, 6) AS implied_opening, b.onhand AS on_hand,
  ROUND(b.net, 6) AS movement_net, b.n AS movement_rows, b.last_id AS last_movement_id,
  (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) FROM inventory_movements m WHERE m.id = b.last_id) AS last_movement_at,
  b.merge_rows, b.held_rows,
  (SELECT ROUND(COALESCE(SUM(d.quantity_remaining), 0), 6) FROM damaged_stock_lots d WHERE d.product_id = b.pid AND COALESCE(d.branch_id, -1) = b.bid) AS held_remaining,
  (SELECT MAX(pb.id) FROM product_batches pb
    JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = b.bid
    WHERE pb.variant_product_id = b.pid
      AND pb.notes IN ('Received via product import', 'Stock reconciled from product import snapshot')) AS import_lot_id,
  (SELECT COUNT(*) FROM bad) AS unbalanced_pairs_total
FROM bad b
ORDER BY b.pid, b.bid
LIMIT 5000
