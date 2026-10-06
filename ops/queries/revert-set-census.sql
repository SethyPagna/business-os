-- REVERT-SET census (6 Oct 2026): every Revert / History-undo counter row
-- (reference_id 'revert:<id>') beside the row it claims to reverse.
-- Bounded: a range seek on idx_inventory_movements_reference_type_id
-- ('revert:' <= reference_id < 'revert;'), then primary-key and
-- (product_id, created_at) range lookups between the two rows' dates only.
--
--   revert_id .. revert_cost      the compensating row
--   original_id .. original_ref   the row named by revert:<id>
--   original_kind                 receipt | stock_set | set_undo | revert | other
--   qty_mismatch                  1 when |revert qty| <> |original qty|
--   direction_mismatch            1 when both rows move stock the same way
--   lot_mismatch                  1 when the original names a lot and the revert another
--   later_sets_open               Set forward rows (stock-set:%) on the same product
--                                 and branch written AFTER the original and BEFORE the
--                                 revert that are still not undone: json [id, qty, type, lot]
--   later_changes                 other add/remove/adjustment rows on the pair in between
--   sales_between                 sale rows on the pair in between
--   lot_now                       the original lot's quantity at the branch today
--   lot_received_now              that lot's received_quantity / received_cost_usd today
--   suspect                       'arith' (qty/direction/lot mismatch),
--                                 'target' (a receipt reverted while a later, still
--                                 applied Set on the same pair sits in between:
--                                 the owner's SK-II pattern), else ''
-- ops:min-rows 0
-- ops:max-rows 5000
WITH rv AS (
  SELECT m.id, m.product_id, m.product_name, m.branch_id, m.batch_id, m.movement_type, m.quantity, m.reason, m.user_name,
    m.created_at, m.total_cost_usd, CAST(substr(m.reference_id, 8) AS INTEGER) AS original_id
  FROM inventory_movements m
  WHERE m.reference_id >= 'revert:' AND m.reference_id < 'revert;'
),
pair AS (
  SELECT rv.*, o.movement_type AS o_type, o.quantity AS o_qty, o.batch_id AS o_batch, o.reference_id AS o_ref,
    o.created_at AS o_at, o.total_cost_usd AS o_cost,
    CASE WHEN o.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'move_out',
        'write_off', 'damage_out', 'replacement_out', 'out') THEN -1 ELSE 1 END AS o_dir,
    CASE WHEN rv.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'move_out',
        'write_off', 'damage_out', 'replacement_out', 'out') THEN -1 ELSE 1 END AS r_dir
  FROM rv LEFT JOIN inventory_movements o ON o.id = rv.original_id
)
SELECT
  p.id AS revert_id, p.created_at AS revert_at, p.movement_type AS revert_type, p.quantity AS revert_qty, p.batch_id AS revert_lot,
  p.total_cost_usd AS revert_cost, p.user_name AS revert_user, p.product_id, p.product_name, p.branch_id,
  p.original_id, p.o_type AS original_type, p.o_qty AS original_qty, p.o_batch AS original_lot, p.o_ref AS original_ref,
  p.o_at AS original_at, p.o_cost AS original_cost,
  CASE WHEN p.o_type IS NULL THEN 'missing'
    WHEN substr(CAST(p.o_ref AS TEXT), 1, 10) = 'stock-set:' THEN 'stock_set'
    WHEN substr(CAST(p.o_ref AS TEXT), 1, 7) = 'revert:' THEN 'revert'
    WHEN p.o_type IN ('add', 'stock_in') THEN 'receipt'
    ELSE 'other' END AS original_kind,
  CASE WHEN ABS(ABS(COALESCE(p.quantity, 0)) - ABS(COALESCE(p.o_qty, 0))) > 0.000001 THEN 1 ELSE 0 END AS qty_mismatch,
  CASE WHEN p.o_type IS NOT NULL AND p.o_dir = p.r_dir THEN 1 ELSE 0 END AS direction_mismatch,
  CASE WHEN p.o_batch IS NOT NULL AND p.batch_id IS NOT NULL AND p.o_batch <> p.batch_id THEN 1 ELSE 0 END AS lot_mismatch,
  (SELECT json_group_array(json_array(s.id, s.quantity, s.movement_type, s.batch_id))
   FROM inventory_movements s
   WHERE s.product_id = p.product_id AND s.created_at >= substr(p.o_at, 1, 10) AND s.created_at < substr(p.created_at, 1, 10) || '~'
     AND s.branch_id = p.branch_id AND s.id > p.original_id AND s.id < p.id
     AND substr(CAST(s.reference_id AS TEXT), 1, 10) = 'stock-set:'
     AND NOT EXISTS (SELECT 1 FROM inventory_movements u WHERE u.reference_id = 'revert:' || CAST(s.id AS TEXT) AND u.id < p.id)) AS later_sets_open,
  (SELECT COUNT(*) FROM inventory_movements s
   WHERE s.product_id = p.product_id AND s.created_at >= substr(p.o_at, 1, 10) AND s.created_at < substr(p.created_at, 1, 10) || '~'
     AND s.branch_id = p.branch_id AND s.id > p.original_id AND s.id < p.id
     AND s.movement_type IN ('add', 'remove', 'adjustment', 'set', 'in', 'out', 'stock_in')) AS later_changes,
  (SELECT COUNT(*) FROM inventory_movements s
   WHERE s.product_id = p.product_id AND s.created_at >= substr(p.o_at, 1, 10) AND s.created_at < substr(p.created_at, 1, 10) || '~'
     AND s.branch_id = p.branch_id AND s.id > p.original_id AND s.id < p.id
     AND s.movement_type IN ('sale', 'sale_from_damaged')) AS sales_between,
  (SELECT bbs.quantity FROM branch_batch_stock bbs WHERE bbs.batch_id = p.o_batch AND bbs.branch_id = p.branch_id) AS lot_now,
  (SELECT json_array(b.received_quantity, b.received_cost_usd, b.is_active) FROM product_batches b WHERE b.id = p.o_batch) AS lot_received_now,
  CASE
    WHEN p.o_type IS NULL
      OR ABS(ABS(COALESCE(p.quantity, 0)) - ABS(COALESCE(p.o_qty, 0))) > 0.000001
      OR p.o_dir = p.r_dir
      OR (p.o_batch IS NOT NULL AND p.batch_id IS NOT NULL AND p.o_batch <> p.batch_id) THEN 'arith'
    WHEN p.o_type IN ('add', 'stock_in') AND EXISTS (
      SELECT 1 FROM inventory_movements s
      WHERE s.product_id = p.product_id AND s.created_at >= substr(p.o_at, 1, 10) AND s.created_at < substr(p.created_at, 1, 10) || '~'
     AND s.branch_id = p.branch_id AND s.id > p.original_id AND s.id < p.id
        AND substr(CAST(s.reference_id AS TEXT), 1, 10) = 'stock-set:'
        AND NOT EXISTS (SELECT 1 FROM inventory_movements u WHERE u.reference_id = 'revert:' || CAST(s.id AS TEXT) AND u.id < p.id)) THEN 'target'
    ELSE '' END AS suspect
FROM pair p
ORDER BY p.id
LIMIT 5000
