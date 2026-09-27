-- F-forensics S2: sale lines whose ACTIVE customer returns add up to more
-- than was sold. lib/returnBulkAction.ts validates a cancelled -> completed
-- restore only for money_precision_version 1 returns (the `continue` at the
-- v1 check), so restoring a cancelled return on a legacy sale after a newer
-- return covered the same units counts them twice: stock restocked twice,
-- refund counted twice. The line match is the app's own rule
-- (returnBulkAction.ts saleStatusStatement): same sale_item_id, or a
-- sale_item_id-less return line of the same product.
-- Read-only. Ids, dates, quantities and USD amounts only.
--   sale_id, sale_item_id, sale_created_at, sale_status, sale_mpv, product_id, branch_id
--   sold_qty, returned_qty, excess_qty, excess_restocked_qty (what stock holds too many)
--   return_ids (json), return_mpvs (json), returns_refund_usd (active refunds on the line)
--   excess_refund_usd       excess_qty x the average refunded unit price on the line
--   restore_events          grouped status operations that moved one of these returns
--                           cancelled -> completed (applied) or undid a cancel
--   last_restore_at, event_at (restore, else the newest return)
--   same_product_lines      >1 means a sale_item_id-less line may be matched twice (review)
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
WITH ari AS (
  SELECT ri.id, ri.return_id, ri.sale_item_id, ri.product_id, ri.quantity,
    CASE WHEN COALESCE(ri.stock_action, CASE WHEN ri.return_to_stock = 1 THEN 'restock' END) = 'restock' THEN ri.quantity ELSE 0 END AS restocked,
    COALESCE(ri.total_usd, 0) AS total_usd,
    COALESCE(ri.branch_id, r.branch_id) AS branch_id,
    r.sale_id, r.money_precision_version AS mpv, COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) AS created_at
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE COALESCE(r.status, 'completed') <> 'cancelled'
    AND COALESCE(r.return_scope, 'customer') = 'customer'
    AND r.sale_id IS NOT NULL
),
line AS (
  SELECT si.id AS sale_item_id, si.sale_id, si.product_id, si.quantity AS sold_qty,
    SUM(a.quantity) AS returned_qty, SUM(a.restocked) AS restocked_qty, SUM(a.total_usd) AS refund_usd,
    MAX(a.branch_id) AS branch_id, MAX(a.created_at) AS last_return_at,
    json_group_array(DISTINCT a.return_id) AS return_ids,
    json_group_array(DISTINCT a.mpv) AS return_mpvs
  FROM sale_items si
  JOIN ari a ON a.sale_id = si.sale_id
    AND (a.sale_item_id = si.id OR (a.sale_item_id IS NULL AND a.product_id = si.product_id))
  GROUP BY si.id
  HAVING SUM(a.quantity) > si.quantity + 0.000001
),
bulk AS (
  SELECT CAST(json_extract(mem.value, '$.id') AS INTEGER) AS return_id,
    json_extract(mem.value, '$.before.status') AS before_status,
    json_extract(mem.value, '$.after.status') AS after_status,
    a.action, COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) AS at
  FROM audit_logs a
  JOIN return_bulk_operations o ON o.id = a.entity_id
  JOIN undo_snapshots s ON s.id = o.snapshot_id
  JOIN json_each(s.payload_json, '$.members') mem
  WHERE a.entity = 'return' AND a.action IN ('return_fields_bulk', 'action_undo', 'action_redo')
    AND json_valid(s.payload_json)
    AND json_extract(mem.value, '$.changed') = 1
    AND json_extract(s.payload_json, '$.field') = 'status'
),
restores AS (
  SELECT b.return_id, b.at FROM bulk b
  WHERE (b.action IN ('return_fields_bulk', 'action_redo') AND b.before_status = 'cancelled' AND b.after_status = 'completed')
     OR (b.action = 'action_undo' AND b.before_status = 'completed' AND b.after_status = 'cancelled')
),
line2 AS (
  SELECT l.*,
    (SELECT COUNT(*) FROM restores x WHERE x.return_id IN (SELECT value FROM json_each(l.return_ids))) AS restore_events,
    (SELECT MAX(x.at) FROM restores x WHERE x.return_id IN (SELECT value FROM json_each(l.return_ids))) AS last_restore_at
  FROM line l
),
own AS (
  SELECT m.id FROM inventory_movements m
  WHERE m.movement_type IN ('return', 'return_reversal')
    AND CAST(m.reference_id AS TEXT) IN (SELECT CAST(j.value AS TEXT) FROM line l JOIN json_each(l.return_ids) j)
),
affected AS (
  SELECT CAST(l.sale_item_id AS TEXT) AS item_key, l.product_id, l.branch_id,
    COALESCE(l.last_restore_at, l.last_return_at) AS event_at,
    MIN(l.returned_qty - l.sold_qty, l.restocked_qty) AS error_qty
  FROM line2 l
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
  l.sale_id, l.sale_item_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) AS sale_created_at, s.sale_status, s.money_precision_version AS sale_mpv,
  l.product_id, l.branch_id,
  l.sold_qty, l.returned_qty, l.returned_qty - l.sold_qty AS excess_qty, a.error_qty AS excess_restocked_qty,
  l.return_ids, l.return_mpvs, ROUND(l.refund_usd, 2) AS returns_refund_usd,
  ROUND(CASE WHEN l.returned_qty > 0 THEN l.refund_usd * (l.returned_qty - l.sold_qty) / l.returned_qty ELSE 0 END, 2) AS excess_refund_usd,
  l.restore_events, l.last_restore_at, a.event_at,
  (SELECT COUNT(*) FROM sale_items z WHERE z.sale_id = l.sale_id AND z.product_id = l.product_id) AS same_product_lines,
  k.opposite_rows, k.opposite_net, k.same_direction_net, k.count_rows, k.exact_id, k.exact_at, k.sales_between, k.suggested_class
FROM line2 l
JOIN sales s ON s.id = l.sale_id
JOIN affected a ON a.item_key = CAST(l.sale_item_id AS TEXT)
JOIN classified k ON k.item_key = a.item_key
ORDER BY a.event_at, l.sale_item_id
LIMIT 2000
