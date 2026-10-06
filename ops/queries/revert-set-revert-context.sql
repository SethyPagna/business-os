-- REVERT-SET (6 Oct 2026): the context of revert #48197 (1 Oct 14:35:45 UTC,
-- "Revert of #48026"). Light: reference_id index, audit (action, created_at)
-- index and an inventory_movements created_at range of one hour.
--   session_rows   every movement written under 48026's session reference
--                  1790667050013 (other products of the same stock-in), with
--                  the revert row of each, if any
--   reverts_hour   every revert:% movement created 14:00-15:00 UTC on 1 Oct
--   audit_reverts  stock_revert / stock adjust audit rows 13:30-15:30 UTC on 1 Oct
--   history_hour   action_history rows created or updated 13:30-15:30 UTC on 1 Oct
--   branches       id + name of every branch
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT json_group_array(json_array(m.id, m.product_id, m.product_name, m.movement_type, m.quantity, m.batch_id, m.created_at,
     (SELECT r.id FROM inventory_movements r WHERE r.reference_id = 'revert:' || CAST(m.id AS TEXT))))
   FROM inventory_movements m WHERE CAST(m.reference_id AS TEXT) = '1790667050013') AS session_rows,
  (SELECT json_group_array(json_array(m.id, m.product_id, m.product_name, m.movement_type, m.quantity, m.reference_id, m.reason, m.user_name, m.created_at))
   FROM inventory_movements m WHERE m.created_at >= '2026-10-01 14:00:00' AND m.created_at < '2026-10-01 15:00:00'
     AND substr(CAST(m.reference_id AS TEXT), 1, 7) = 'revert:') AS reverts_hour,
  (SELECT json_group_array(json_object('id', a.id, 'action', a.action, 'entity', a.entity, 'entity_id', a.entity_id, 'details', a.details,
     'user', a.user_name, 'device', a.device_name, 'created', a.created_at, 'client_time', a.client_time))
   FROM audit_logs a WHERE a.action IN ('stock_revert', 'adjust', 'stock_adjust', 'undo', 'redo', 'action_undo', 'action_redo')
     AND a.created_at >= '2026-10-01 13:30:00' AND a.created_at < '2026-10-01 15:30:00') AS audit_reverts,
  (SELECT json_group_array(json_object('id', h.id, 'entity', h.entity, 'entity_id', h.entity_id, 'label', h.label, 'status', h.status,
     'last_error', h.last_error, 'created', h.created_at, 'updated', h.updated_at))
   FROM action_history h WHERE h.scope = 'inventory' AND h.updated_at >= '2026-10-01 13:30:00' AND h.updated_at < '2026-10-01 15:30:00') AS history_hour,
  (SELECT json_group_array(json_array(b.id, b.name, b.is_active)) FROM branches b) AS branches
