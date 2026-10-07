-- REVERT-SET repair DRY RUN (read-only): what
-- ops/scripts/migration/held/revert_set_sk2_cleanser_repair.sql would change
-- if applied now (owner ruling 6 Oct 2026: delivery back, Set reverted, the 3
-- on the 02/09 slot removed as the only loss). Primary-key lookups on product
-- 5357 only; safe while open.
--   state            pre  = production as planned on (newest movement 48197)
--                    ab   = steps 1-2 done in the app (the file adds the Remove only)
--                    done = all three done (the file writes nothing)
--                    stale = anything else (the file aborts; re-plan)
--   planned_loss_usd 3 x the 02/09 lot's unit cost (the only loss the repair books)
--   rows             json [table, key, column, current, planned]
-- ops:min-rows 1
-- ops:max-rows 1
WITH s AS (
  SELECT
    (SELECT quantity FROM branch_batch_stock WHERE batch_id = 56725 AND branch_id = 2) AS lot_adj,
    (SELECT quantity FROM branch_batch_stock WHERE batch_id = 61482 AND branch_id = 2) AS lot_delivery,
    (SELECT quantity FROM branch_stock WHERE product_id = 5357 AND branch_id = 2) AS shop,
    (SELECT stock_quantity FROM products WHERE id = 5357) AS product_total,
    (SELECT cost_price_usd FROM products WHERE id = 5357) AS catalog_cost,
    (SELECT received_quantity FROM product_batches WHERE id = 61482) AS delivery_received,
    (SELECT received_cost_usd FROM product_batches WHERE id = 61482) AS delivery_received_cost,
    (SELECT is_active FROM product_batches WHERE id = 61482) AS delivery_active,
    (SELECT unit_cost_usd FROM product_batches WHERE id = 61482) AS delivery_unit_cost,
    (SELECT variant_product_id FROM product_batches WHERE id = 56725) AS adj_product,
    (SELECT unit_cost_usd FROM product_batches WHERE id = 56725) AS adj_unit_cost,
    (SELECT received_quantity FROM product_batches WHERE id = 56725) AS adj_received,
    (SELECT received_cost_usd FROM product_batches WHERE id = 56725) AS adj_received_cost,
    (SELECT generation FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') AS op_generation,
    (SELECT state FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') AS op_state,
    (SELECT status FROM action_history WHERE id = 1318) AS history_status,
    (SELECT MAX(id) FROM inventory_movements WHERE product_id = 5357) AS newest_movement,
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id >= 'revert:48034' AND reference_id < 'revert:48035') AS set_reverted,
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id >= 'revert:48197' AND reference_id < 'revert:48198') AS delivery_restored,
    (SELECT MAX(id) FROM inventory_movements WHERE (reference_id >= 'revert:48034' AND reference_id < 'revert:48035')
      OR (reference_id >= 'revert:48197' AND reference_id < 'revert:48198')) AS newest_repair_row
),
f AS (
  SELECT s.*,
    CASE
      WHEN lot_adj = 30 AND lot_delivery = 0 AND shop = 30 AND product_total = 30 AND delivery_received = 0 AND adj_product = 5357
        AND op_generation = 0 AND op_state = 'applied' AND history_status = 'undoable' AND newest_movement = 48197
        AND set_reverted = 0 AND delivery_restored = 0 THEN 'pre'
      WHEN set_reverted = 1 AND delivery_restored = 1 AND lot_adj = 3 AND lot_delivery = 30 AND shop = 33 AND product_total = 33
        AND newest_movement = newest_repair_row THEN 'ab'
      WHEN set_reverted = 1 AND delivery_restored = 1 AND lot_adj = 0 THEN 'done'
      ELSE 'stale' END AS state
  FROM s
)
SELECT state, newest_movement, catalog_cost,
  ROUND(3 * adj_unit_cost, 4) AS planned_loss_usd,
  json_array(
    json_array('branch_batch_stock', '56725@2', 'quantity', lot_adj, 0),
    json_array('branch_batch_stock', '61482@2', 'quantity', lot_delivery, 30),
    json_array('branch_stock', '5357@2', 'quantity', shop, 30),
    json_array('products', '5357', 'stock_quantity', product_total, 30),
    json_array('products', '5357', 'cost_price_usd (0195 trigger)', catalog_cost, delivery_unit_cost),
    json_array('product_batches', '61482', 'received_quantity', delivery_received, 30),
    json_array('product_batches', '61482', 'received_cost_usd', delivery_received_cost, 210),
    json_array('product_batches', '61482', 'is_active', delivery_active, 1),
    json_array('product_batches', '56725', 'received_quantity/cost (unchanged)', adj_received || '/' || adj_received_cost, adj_received || '/' || adj_received_cost),
    json_array('stock_lot_adjustment_operations', 'c7b78789', 'generation/state', op_generation || '/' || op_state, '1/reversed'),
    json_array('action_history', '1318', 'status', history_status, 'redoable'),
    json_array('inventory_movements', 'new', 'add 30 lot 61482', 'revert:48197', CASE WHEN state = 'pre' THEN 'insert' ELSE 'exists' END),
    json_array('inventory_movements', 'new', 'remove 27 lot 56725', 'revert:48034', CASE WHEN state = 'pre' THEN 'insert' ELSE 'exists' END),
    json_array('inventory_movements', 'new', 'remove 3 lot 56725 (loss)', ROUND(3 * adj_unit_cost, 4), CASE WHEN state IN ('pre', 'ab') THEN 'insert' ELSE 'exists' END),
    json_array('audit_logs', 'new', 'stock_revert_repair', '', CASE WHEN state IN ('pre', 'ab') THEN 'insert' ELSE 'none' END)
  ) AS rows
FROM f
