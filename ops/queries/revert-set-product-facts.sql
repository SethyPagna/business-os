-- REVERT-SET (6 Oct 2026, owner report "SK-II Gentle Cleanser 20g"): every
-- stock fact of ONE product, reached through movement 48026 by primary key.
-- Read-only and light (product_id / batch_id / movement_id / PK lookups only),
-- safe while the store is open.
--   product        products row (stock_quantity, both cost columns)
--   branch_stock   per-branch aggregate
--   lots           product_batches (received qty/cost, unit cost, supplier)
--   lot_stock      branch_batch_stock per lot x branch
--   movements      every inventory_movements row of the product, by id:
--                  [id, created_at, type, qty, branch, batch, reference, reason,
--                   user_id, user_name, unit_cost_usd, total_cost_usd]
--   set_ops        stock_lot_adjustment_operations named by a stock-set: row
--   session_rows   stock_session_members of the product + their operations
--   history        action_history rows of those set and session operations
--   audit          audit_logs of the product since 28 Sep (stock_revert etc.)
--   cost_entries   manual cost overrides
-- ops:min-rows 1
-- ops:max-rows 1
WITH p AS (SELECT product_id AS id FROM inventory_movements WHERE id = 48026),
setops AS (
  SELECT DISTINCT substr(CAST(m.reference_id AS TEXT), 11, 36) AS id
  FROM inventory_movements m
  WHERE m.product_id = (SELECT id FROM p) AND substr(CAST(m.reference_id AS TEXT), 1, 10) = 'stock-set:'
),
members AS (
  SELECT sm.operation_id, sm.line_id, sm.command_kind, sm.branch_id, sm.batch_id, sm.movement_id, sm.quantity, sm.unit_cost_usd
  FROM stock_session_members sm WHERE sm.product_id = (SELECT id FROM p)
),
sessionops AS (
  SELECT o.rowid AS rid, o.id, o.history_id, o.generation, o.created_at FROM stock_session_operations o
  WHERE o.id IN (SELECT operation_id FROM members)
)
SELECT
  (SELECT json_object('id', pr.id, 'name', pr.name, 'barcode', pr.barcode, 'stock_quantity', pr.stock_quantity,
     'cost_price_usd', pr.cost_price_usd, 'purchase_price_usd', pr.purchase_price_usd, 'is_active', pr.is_active, 'updated_at', pr.updated_at)
   FROM products pr WHERE pr.id = (SELECT id FROM p)) AS product,
  (SELECT json_group_array(json_object('branch', bs.branch_id, 'qty', bs.quantity))
   FROM branch_stock bs WHERE bs.product_id = (SELECT id FROM p)) AS branch_stock,
  (SELECT json_group_array(json_object('id', b.id, 'key', b.batch_key, 'lot', b.lot_code, 'received_at', b.received_at, 'active', b.is_active,
     'received_qty', b.received_quantity, 'received_cost', b.received_cost_usd, 'unit_cost', b.unit_cost_usd, 'supplier_id', b.supplier_id,
     'supplier', b.supplier_name, 'pay', b.payment_status, 'received_branch', b.received_branch_id, 'created', b.created_at, 'updated', b.updated_at))
   FROM product_batches b WHERE b.variant_product_id = (SELECT id FROM p)) AS lots,
  (SELECT json_group_array(json_object('batch', s.batch_id, 'branch', s.branch_id, 'qty', s.quantity, 'updated', s.updated_at))
   FROM branch_batch_stock s WHERE s.batch_id IN (SELECT b.id FROM product_batches b WHERE b.variant_product_id = (SELECT id FROM p))) AS lot_stock,
  (SELECT json_group_array(json_array(m.id, m.created_at, m.movement_type, m.quantity, m.branch_id, m.batch_id, m.reference_id, m.reason,
     m.user_id, m.user_name, m.unit_cost_usd, m.total_cost_usd))
   FROM (SELECT * FROM inventory_movements WHERE product_id = (SELECT id FROM p) ORDER BY id) m) AS movements,
  (SELECT json_group_array(json_object('id', o.id, 'actor', o.actor_id, 'request', json(o.request_json), 'before', json(o.before_json),
     'after', json(o.after_json), 'revision', json(o.revision_json), 'history_id', o.history_id, 'generation', o.generation, 'state', o.state,
     'created', o.created_at))
   FROM stock_lot_adjustment_operations o WHERE o.id IN (SELECT id FROM setops)) AS set_ops,
  (SELECT json_group_array(json_object('member', json_array(mb.operation_id, mb.line_id, mb.command_kind, mb.branch_id, mb.batch_id, mb.movement_id,
     mb.quantity, mb.unit_cost_usd), 'op_rowid', so.rid, 'op_history', so.history_id, 'op_generation', so.generation, 'op_created', so.created_at))
   FROM members mb LEFT JOIN sessionops so ON so.id = mb.operation_id) AS session_rows,
  (SELECT json_group_array(json_object('id', h.id, 'scope', h.scope, 'entity', h.entity, 'entity_id', h.entity_id, 'label', h.label,
     'reversible', h.reversible, 'status', h.status, 'undo', h.undo_payload, 'last_error', h.last_error, 'by', h.created_by_name,
     'created', h.created_at, 'updated', h.updated_at))
   FROM action_history h WHERE h.id IN (SELECT history_id FROM stock_lot_adjustment_operations WHERE id IN (SELECT id FROM setops))
     OR h.id IN (SELECT history_id FROM sessionops)) AS history,
  (SELECT json_group_array(json_object('id', a.id, 'action', a.action, 'details', a.details, 'user', a.user_name, 'device', a.device_name,
     'created', a.created_at, 'client_time', a.client_time))
   FROM audit_logs a WHERE a.entity = 'product' AND a.entity_id = CAST((SELECT id FROM p) AS TEXT) AND a.created_at >= '2026-09-28') AS audit,
  (SELECT json_group_array(json_object('id', e.id, 'cost_usd', e.cost_usd, 'source', e.source, 'user', e.user_name, 'baseline', e.baseline_batch_id,
     'created', e.created_at))
   FROM product_cost_entries e WHERE e.product_id = (SELECT id FROM p)) AS cost_entries
