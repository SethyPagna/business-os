-- F-forensics S3: customer returns whose own stock movements do not net to
-- what their status says, and edits made while the return was cancelled.
-- PATCH /api/returns/:id (routes/returns.ts) has no status guard: editing a
-- CANCELLED return reverses the old restock (already reversed by the cancel)
-- and restocks the new lines, so sellable stock moves by (new - old) while the
-- return is cancelled; a later restore then adds the new lines again.
--
-- Invariant per (return, product, branch), over the return's own movements
-- (types return / return_reversal with a return reason: 'Return: ...',
-- 'Return #N updated...', 'Apply/Undo grouped return status'):
--   movement_net must be 0 when the return is cancelled, and the restocked
--   quantity of its current lines when it is completed.
--   error_qty = movement_net - expected_net   (the S3 error; + = too much stock)
-- Status timeline: the grouped status operations (audit_logs + the operation's
-- undo snapshot). edits_while_cancelled counts edit movements written while
-- the timeline said cancelled.
-- Read-only. Ids, dates and quantities only.
--   return_id, return_created_at, status, sale_id, product_id, branch_id
--   movement_net, expected_net, error_qty, edit_rows, edits_while_cancelled,
--   first_cancelled_edit_at, event_at
--
-- Compensation columns (shared by every forensics-* stock query):
--   A "manual correction" is a later movement of type add, remove,
--   adjustment, set, write_off, damage_out, in or out on the same product and
--   branch, excluding the bug's own rows. Direction comes from the type
--   (remove/write_off/damage_out/out are downward); a legacy 'set' row has no
--   stored direction and counts only as a count row. A dated stock-count row
--   is timed by the movement written just before it (its created_at is the
--   count date, not the time it was applied).
--   window: event_at < correction <= event_at + 60 days.
--   opposite_rows / opposite_net   corrections in the direction that undoes the error
--   same_direction_net             corrections that deepen it
--   count_rows                     counts / set-to / lot-set / legacy set rows (absorb any error)
--   exact_id / exact_at            first opposite correction whose size equals |error|
--   sales_between                  sale movements on the pair between the event and exact_at
--                                  (or the window end)
--   suggested_class                a: exact opposite correction, no sale in between
--                                  b: opposite corrections smaller than the error, no count
--                                  c: nothing opposite and no count in the window
--                                  d: anything else (owner review)
-- ops:min-rows 0
-- ops:max-rows 2000
WITH rmov AS (
  SELECT m.id, CAST(m.reference_id AS INTEGER) AS return_id, m.product_id, m.branch_id,
    CASE WHEN m.movement_type = 'return_reversal' THEN -ABS(COALESCE(m.quantity, 0)) ELSE ABS(COALESCE(m.quantity, 0)) END AS signed,
    CASE WHEN m.reason LIKE 'Return #% updated%' THEN 1 ELSE 0 END AS is_edit,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) AS at
  FROM inventory_movements m
  WHERE m.movement_type IN ('return', 'return_reversal')
    AND (m.reason LIKE 'Return: %' OR m.reason LIKE 'Return #%'
      OR m.reason IN ('Apply grouped return status', 'Undo grouped return status'))
),
bulk AS (
  SELECT CAST(json_extract(mem.value, '$.id') AS INTEGER) AS return_id,
    CASE WHEN a.action = 'action_undo' THEN json_extract(mem.value, '$.before.status')
      ELSE json_extract(mem.value, '$.after.status') END AS new_status,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) AS at
  FROM audit_logs a
  JOIN return_bulk_operations o ON o.id = a.entity_id
  JOIN undo_snapshots s ON s.id = o.snapshot_id
  JOIN json_each(s.payload_json, '$.members') mem
  WHERE a.entity = 'return' AND a.action IN ('return_fields_bulk', 'action_undo', 'action_redo')
    AND json_valid(s.payload_json)
    AND json_extract(mem.value, '$.changed') = 1
    AND json_extract(s.payload_json, '$.field') = 'status'
),
edits AS (
  SELECT e.return_id, e.at,
    COALESCE((SELECT b.new_status FROM bulk b WHERE b.return_id = e.return_id AND b.at <= e.at ORDER BY b.at DESC LIMIT 1), 'completed') AS status_then
  FROM (SELECT DISTINCT return_id, at FROM rmov WHERE is_edit = 1) e
),
net AS (
  SELECT x.return_id, x.product_id, x.branch_id, SUM(x.signed) AS movement_net, SUM(x.is_edit) AS edit_rows
  FROM rmov x GROUP BY x.return_id, x.product_id, x.branch_id
),
expected AS (
  SELECT ri.return_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id) AS branch_id,
    SUM(CASE WHEN COALESCE(ri.stock_action, CASE WHEN ri.return_to_stock = 1 THEN 'restock' END) = 'restock' THEN ri.quantity ELSE 0 END) AS restock_qty
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  GROUP BY ri.return_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id)
),
chk AS (
  SELECT n.return_id, n.product_id, n.branch_id, n.movement_net, n.edit_rows,
    r.status, r.sale_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) AS return_created_at,
    CASE WHEN COALESCE(r.status, 'completed') = 'cancelled' THEN 0 ELSE COALESCE(e.restock_qty, 0) END AS expected_net,
    (SELECT COUNT(*) FROM edits d WHERE d.return_id = n.return_id AND d.status_then = 'cancelled') AS edits_while_cancelled,
    (SELECT MIN(d.at) FROM edits d WHERE d.return_id = n.return_id AND d.status_then = 'cancelled') AS first_cancelled_edit_at,
    (SELECT MAX(x.at) FROM rmov x WHERE x.return_id = n.return_id) AS last_movement_at
  FROM net n
  JOIN returns r ON r.id = n.return_id AND COALESCE(r.return_scope, 'customer') = 'customer'
  LEFT JOIN expected e ON e.return_id = n.return_id AND e.product_id = n.product_id AND e.branch_id = n.branch_id
),
bad AS (
  SELECT c.*, c.movement_net - c.expected_net AS error_qty
  FROM chk c
  WHERE ABS(c.movement_net - c.expected_net) > 0.000001 OR c.edits_while_cancelled > 0
),
own AS (SELECT x.id FROM rmov x WHERE x.return_id IN (SELECT return_id FROM bad)),
affected AS (
  SELECT b.return_id || ':' || b.product_id || ':' || b.branch_id AS item_key, b.product_id, b.branch_id,
    COALESCE(b.first_cancelled_edit_at, b.last_movement_at) AS event_at, b.error_qty
  FROM bad b
),
manual AS (
  SELECT m.id, m.product_id, m.branch_id,
    CASE WHEN m.reason = 'Dated stock count import' THEN COALESCE((SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p
        WHERE p.id < m.id AND COALESCE(p.reason, '') <> 'Dated stock count import' ORDER BY p.id DESC LIMIT 1), '0000-00-00 00:00:00')
      ELSE COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) END AS at,
    CASE WHEN m.movement_type = 'set' THEN NULL
      WHEN m.movement_type IN ('remove', 'write_off', 'damage_out', 'out') THEN -ABS(COALESCE(m.quantity, 0))
      ELSE ABS(COALESCE(m.quantity, 0)) END AS signed,
    CASE WHEN m.movement_type = 'set' OR m.reason = 'Dated stock count import' OR m.reason LIKE '%(Set to %'
      OR CAST(m.reference_id AS TEXT) LIKE 'stock-set:%' THEN 1 ELSE 0 END AS is_count
  FROM inventory_movements m
  WHERE m.movement_type IN ('add', 'remove', 'adjustment', 'set', 'write_off', 'damage_out', 'in', 'out')
    AND m.id NOT IN (SELECT id FROM own WHERE id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM affected a WHERE a.product_id = m.product_id AND a.branch_id = m.branch_id)
),
win AS (
  SELECT a.item_key, x.id, x.at, x.signed, x.is_count, a.error_qty
  FROM affected a JOIN manual x ON x.product_id = a.product_id AND x.branch_id = a.branch_id
  WHERE x.at > a.event_at AND x.at <= datetime(a.event_at, '+60 days')
),
comp AS (
  SELECT a.item_key, a.product_id, a.branch_id, a.event_at, a.error_qty,
    (SELECT COUNT(*) FROM win w WHERE w.item_key = a.item_key AND w.signed * a.error_qty < 0) AS opposite_rows,
    (SELECT COALESCE(SUM(w.signed), 0) FROM win w WHERE w.item_key = a.item_key AND w.signed * a.error_qty < 0) AS opposite_net,
    (SELECT COALESCE(SUM(w.signed), 0) FROM win w WHERE w.item_key = a.item_key AND w.signed * a.error_qty > 0) AS same_direction_net,
    (SELECT COUNT(*) FROM win w WHERE w.item_key = a.item_key AND (w.is_count = 1 OR w.signed IS NULL)) AS count_rows,
    (SELECT w.id FROM win w WHERE w.item_key = a.item_key AND w.signed * a.error_qty < 0
      AND ABS(ABS(w.signed) - ABS(a.error_qty)) < 0.000001 ORDER BY w.at, w.id LIMIT 1) AS exact_id,
    (SELECT w.at FROM win w WHERE w.item_key = a.item_key AND w.signed * a.error_qty < 0
      AND ABS(ABS(w.signed) - ABS(a.error_qty)) < 0.000001 ORDER BY w.at, w.id LIMIT 1) AS exact_at
  FROM affected a
),
comp2 AS (
  SELECT c.*,
    (SELECT COUNT(*) FROM inventory_movements s
      WHERE s.product_id = c.product_id AND s.branch_id = c.branch_id
        AND s.movement_type IN ('sale', 'sale_from_damaged')
        AND s.created_at >= date(c.event_at, '-1 day')
        AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) > c.event_at
        AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) < COALESCE(c.exact_at, datetime(c.event_at, '+60 days'))) AS sales_between
  FROM comp c
),
classified AS (
  SELECT c.*,
    CASE
      WHEN ABS(c.error_qty) < 0.000001 THEN 'none'
      WHEN c.exact_id IS NOT NULL AND c.sales_between = 0 THEN 'a'
      WHEN c.exact_id IS NOT NULL THEN 'd'
      WHEN c.opposite_rows = 0 AND c.count_rows = 0 THEN 'c'
      WHEN c.count_rows = 0 AND ABS(c.opposite_net) < ABS(c.error_qty) THEN 'b'
      ELSE 'd'
    END AS suggested_class
  FROM comp2 c
)
SELECT
  b.return_id, b.return_created_at, b.status, b.sale_id, b.product_id, b.branch_id,
  b.movement_net, b.expected_net, b.error_qty, b.edit_rows, b.edits_while_cancelled, b.first_cancelled_edit_at,
  a.event_at,
  k.opposite_rows, k.opposite_net, k.same_direction_net, k.count_rows, k.exact_id, k.exact_at, k.sales_between, k.suggested_class
FROM bad b
JOIN affected a ON a.item_key = b.return_id || ':' || b.product_id || ':' || b.branch_id
JOIN classified k ON k.item_key = a.item_key
ORDER BY a.event_at, b.return_id
LIMIT 2000
