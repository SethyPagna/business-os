-- REVERT-SET repair DRY RUN (read-only): what
-- ops/scripts/migration/held/revert_set_sk2_cleanser_repair.sql would change
-- if applied now. Primary-key lookups on product 5357 only; safe while open.
--   pre_state_ok      1 = production is exactly the state the repair was planned on
--   already_repaired  1 = both compensating rows exist (the file is then a no-op)
--   would_apply       pre_state_ok AND NOT already_repaired
--   newest_movement   must be 48197 for pre_state_ok (a later sale = re-plan)
--   rows              json [table, key, column, current, planned]
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
    (SELECT variant_product_id FROM product_batches WHERE id = 56725) AS adj_product,
    (SELECT generation FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') AS op_generation,
    (SELECT state FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') AS op_state,
    (SELECT status FROM action_history WHERE id = 1318) AS history_status,
    (SELECT MAX(id) FROM inventory_movements WHERE product_id = 5357) AS newest_movement,
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ('revert:48197', 'revert:48034')) AS repair_rows
),
f AS (
  SELECT s.*,
    CASE WHEN lot_adj = 30 AND lot_delivery = 0 AND shop = 30 AND product_total = 30 AND delivery_received = 0 AND adj_product = 5357
      AND op_generation = 0 AND op_state = 'applied' AND history_status = 'undoable' AND newest_movement = 48197 AND repair_rows = 0
      THEN 1 ELSE 0 END AS pre_state_ok,
    CASE WHEN repair_rows = 2 THEN 1 ELSE 0 END AS already_repaired
  FROM s
)
SELECT pre_state_ok, already_repaired, CASE WHEN pre_state_ok = 1 AND already_repaired = 0 THEN 1 ELSE 0 END AS would_apply,
  newest_movement, catalog_cost,
  json_array(
    json_array('branch_batch_stock', '56725@2', 'quantity', lot_adj, lot_adj - 27),
    json_array('branch_batch_stock', '61482@2', 'quantity', lot_delivery, lot_delivery + 30),
    json_array('branch_stock', '5357@2', 'quantity', shop, shop + 3),
    json_array('products', '5357', 'stock_quantity', product_total, product_total + 3),
    json_array('product_batches', '61482', 'received_quantity', delivery_received, delivery_received + 30),
    json_array('product_batches', '61482', 'received_cost_usd', delivery_received_cost, delivery_received_cost + 210),
    json_array('product_batches', '61482', 'is_active', delivery_active, 1),
    json_array('stock_lot_adjustment_operations', 'c7b78789', 'generation/state', op_generation || '/' || op_state, '1/reversed'),
    json_array('action_history', '1318', 'status', history_status, 'redoable'),
    json_array('inventory_movements', 'new', 'add 30 lot 61482', 'revert:48197', 'insert'),
    json_array('inventory_movements', 'new', 'remove 27 lot 56725', 'revert:48034', 'insert'),
    json_array('audit_logs', 'new', 'stock_revert_repair', '', 'insert')
  ) AS rows
FROM f
