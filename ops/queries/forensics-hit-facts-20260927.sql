-- F-forensics follow-up facts for the 27 Sep hits, by id:
--   product 10223  (S7: inactive, stock_quantity 8, no branch_stock rows)
--   lot 51291 / product 4276 (S4 +2, S5 hit), sale 16835, return 2
-- Four sections, one row shape (section, key, branch_id, n, net_qty, min_at, max_at, value):
--   ledger   movements grouped by (product or lot, type, branch): count, signed net, first/last
--   audit    audit_logs actions on product 10223 / 4276, sale 16835, return 2: count, first/last
--   lot      lot 51291's stored columns and per-branch on hand
--   fact     single values: sale 16835 and return 2 status / times / money, line quantities
-- Read-only. Ids, dates, quantities and USD amounts only.
-- ops:min-rows 1
-- ops:max-rows 500
SELECT 'ledger' AS section,
  CASE WHEN m.batch_id = 51291 THEN 'lot51291:' ELSE 'product' || m.product_id || ':' END || m.movement_type AS key,
  m.branch_id, COUNT(*) AS n,
  SUM(CASE WHEN m.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out',
      'move_out', 'write_off', 'damage_out', 'replacement_out', 'out') THEN -ABS(COALESCE(m.quantity, 0))
    WHEN m.movement_type = 'set' THEN NULL ELSE ABS(COALESCE(m.quantity, 0)) END) AS net_qty,
  MIN(COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at)) AS min_at, MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at)) AS max_at, NULL AS value
FROM inventory_movements m
WHERE m.product_id IN (10223, 4276)
GROUP BY 2, m.branch_id
UNION ALL
SELECT 'audit', a.entity || ':' || a.entity_id || ':' || a.action, NULL, COUNT(*), NULL,
  MIN(COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at)), MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at)), NULL
FROM audit_logs a
WHERE (a.entity = 'product' AND a.entity_id IN ('10223', '4276'))
   OR (a.entity = 'sale' AND a.entity_id = '16835')
   OR (a.entity = 'return' AND a.entity_id = '2')
GROUP BY a.entity, a.entity_id, a.action
UNION ALL
SELECT 'lot', 'lot51291', bbs.branch_id, NULL, bbs.quantity, NULL, NULL,
  json_object('received_quantity', pb.received_quantity, 'received_cost_usd', pb.received_cost_usd, 'unit_cost_usd', pb.unit_cost_usd,
    'received_branch_id', pb.received_branch_id, 'is_active', pb.is_active)
FROM product_batches pb LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
WHERE pb.id = 51291
UNION ALL
SELECT 'fact', f.column1, NULL, NULL, NULL, NULL, NULL, f.column2
FROM (VALUES
  ('sale16835.status', (SELECT sale_status FROM sales WHERE id = 16835)),
  ('sale16835.created_at', (SELECT created_at FROM sales WHERE id = 16835)),
  ('sale16835.updated_at', (SELECT updated_at FROM sales WHERE id = 16835)),
  ('sale16835.total_usd', (SELECT total_usd FROM sales WHERE id = 16835)),
  ('sale16835.amount_paid_usd', (SELECT amount_paid_usd FROM sales WHERE id = 16835)),
  ('sale16835.lines', (SELECT json_group_array(json_array(si.id, si.product_id, si.quantity, si.batch_id)) FROM sale_items si WHERE si.sale_id = 16835)),
  ('sale16835.allocations', (SELECT json_group_array(json_array(a.id, a.sale_item_id, a.batch_id, a.branch_id, a.quantity, a.released_quantity, a.released_at))
     FROM sale_item_batch_allocations a WHERE a.sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = 16835))),
  ('sale16835.movements', (SELECT json_group_array(json_array(m.id, m.created_at, m.movement_type, m.product_id, m.branch_id, m.quantity, m.batch_id))
     FROM inventory_movements m WHERE m.reference_id = 16835 AND m.movement_type IN ('sale', 'return', 'return_reversal'))),
  ('return2.row', (SELECT json_array(r.status, r.created_at, r.updated_at, r.sale_id, r.branch_id, r.total_refund_usd, r.return_type, r.money_precision_version) FROM returns r WHERE r.id = 2)),
  ('return2.items', (SELECT json_group_array(json_array(ri.id, ri.sale_item_id, ri.product_id, ri.quantity, ri.stock_action, ri.return_to_stock, ri.batch_id, ri.total_usd)) FROM return_items ri WHERE ri.return_id = 2)),
  ('return2.movements', (SELECT json_group_array(json_array(m.id, m.created_at, m.movement_type, m.product_id, m.branch_id, m.quantity, m.batch_id))
     FROM inventory_movements m WHERE m.reference_id = 2 AND m.movement_type IN ('return', 'return_reversal') AND (m.reason LIKE 'Return: %' OR m.reason LIKE 'Return #%' OR m.reason IN ('Apply grouped return status', 'Undo grouped return status')))),
  ('product10223.row', (SELECT json_array(p.is_active, p.stock_quantity, p.created_at, p.updated_at) FROM products p WHERE p.id = 10223))
) f
ORDER BY 1, 2, 3
LIMIT 500
