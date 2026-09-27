-- F-forensics R0: customer returns that restocked more of a product than
-- its sale currently has deducted -- a return against a sale whose stock was
-- never taken (a Not Paid sale created before 50d43de4 released its lots at
-- creation and wrote no 'sale' movement; see migration 0173) or was given back
-- by a cancel. Every such restock is phantom stock, and its refund may be
-- money paid back on a sale that was never paid. Found by the S5 hit
-- (sale 16835, cancelled Not Paid, returned by return 2).
-- Per (sale, product, branch), driven from ACTIVE customer restock lines:
--   sale_movement_qty    units the sale's own 'sale' movements took out
--   cancel_restore_qty   units a sale cancel put back ('return' movements on the
--                        sale id whose reason is not a customer-return reason)
--   deducted_now         sale_movement_qty - cancel_restore_qty
--   alloc_drawn / alloc_released   the lot allocation view of the same line(s)
--   returned_restocked_qty         active customer returns' restocked units
--   excess_qty = returned_restocked_qty - deducted_now   (> 0: phantom stock)
--   returns_refund_usd, sale_amount_paid_usd, sale_total_usd
-- Read-only. Ids, dates, quantities and USD amounts only.
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
WITH rl AS MATERIALIZED (
  SELECT r.id AS return_id, r.sale_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id) AS branch_id,
    ri.quantity, COALESCE(ri.total_usd, 0) AS refund_usd, COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) AS at
  FROM returns r
  JOIN return_items ri ON ri.return_id = r.id
  WHERE r.sale_id IS NOT NULL
    AND COALESCE(r.return_scope, 'customer') = 'customer'
    AND COALESCE(r.status, 'completed') <> 'cancelled'
    AND COALESCE(ri.stock_action, CASE WHEN ri.return_to_stock = 1 THEN 'restock' END) = 'restock'
),
grp AS MATERIALIZED (
  SELECT sale_id, product_id, branch_id, SUM(quantity) AS returned_restocked_qty, SUM(refund_usd) AS returns_refund_usd,
    json_group_array(DISTINCT return_id) AS return_ids, MIN(at) AS first_return_at, MAX(at) AS last_return_at
  FROM rl GROUP BY sale_id, product_id, branch_id
),
mv AS MATERIALIZED (
  SELECT g.sale_id, g.product_id, g.branch_id,
    COALESCE(SUM(CASE WHEN m.movement_type = 'sale' THEN -COALESCE(m.quantity, 0) ELSE 0 END), 0) AS sale_movement_qty,
    COALESCE(SUM(CASE WHEN m.movement_type = 'return' AND NOT (m.reason LIKE 'Return: %' OR m.reason LIKE 'Return #%' OR m.reason IN ('Apply grouped return status', 'Undo grouped return status')) THEN ABS(COALESCE(m.quantity, 0)) ELSE 0 END), 0) AS cancel_restore_qty
  FROM grp g
  LEFT JOIN inventory_movements m ON m.reference_id = g.sale_id AND m.movement_type IN ('sale', 'return')
    AND m.product_id = g.product_id AND m.branch_id = g.branch_id
  GROUP BY g.sale_id, g.product_id, g.branch_id
),
al AS MATERIALIZED (
  SELECT g.sale_id, g.product_id, g.branch_id,
    SUM(a.quantity) AS alloc_drawn, SUM(COALESCE(a.released_quantity, 0)) AS alloc_released
  FROM grp g
  JOIN sale_items si ON si.sale_id = g.sale_id AND si.product_id = g.product_id
  JOIN sale_item_batch_allocations a ON a.sale_item_id = si.id
  GROUP BY g.sale_id, g.product_id, g.branch_id
),
bad AS MATERIALIZED (
  SELECT g.*, s.sale_status, COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) AS sale_created_at, s.amount_paid_usd AS sale_amount_paid_usd, s.total_usd AS sale_total_usd,
    (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = g.sale_id AND si.product_id = g.product_id) AS sold_qty,
    v.sale_movement_qty, v.cancel_restore_qty, v.sale_movement_qty - v.cancel_restore_qty AS deducted_now,
    l.alloc_drawn, l.alloc_released,
    g.returned_restocked_qty - (v.sale_movement_qty - v.cancel_restore_qty) AS excess_qty
  FROM grp g
  JOIN sales s ON s.id = g.sale_id
  JOIN mv v ON v.sale_id = g.sale_id AND v.product_id = g.product_id AND v.branch_id = g.branch_id
  LEFT JOIN al l ON l.sale_id = g.sale_id AND l.product_id = g.product_id AND l.branch_id = g.branch_id
  WHERE g.returned_restocked_qty - (v.sale_movement_qty - v.cancel_restore_qty) > 0.000001
),
own AS MATERIALIZED (
  SELECT m.id FROM bad b JOIN inventory_movements m ON m.reference_id IN (SELECT return_id FROM rl WHERE rl.sale_id = b.sale_id)
    AND m.movement_type IN ('return', 'return_reversal') AND m.product_id = b.product_id AND (m.reason LIKE 'Return: %' OR m.reason LIKE 'Return #%' OR m.reason IN ('Apply grouped return status', 'Undo grouped return status'))
),
affected AS MATERIALIZED (
  SELECT b.sale_id || ':' || b.product_id || ':' || b.branch_id AS item_key, b.product_id, b.branch_id,
    b.first_return_at AS event_at, b.excess_qty AS error_qty
  FROM bad b
),
pairs AS MATERIALIZED (SELECT DISTINCT product_id, branch_id FROM affected),
manual AS MATERIALIZED (
  SELECT m.id, m.product_id, m.branch_id,
    CASE WHEN m.reason = 'Dated stock count import' THEN COALESCE((SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p
        WHERE p.id < m.id AND COALESCE(p.reason, '') <> 'Dated stock count import' ORDER BY p.id DESC LIMIT 1), '0000-00-00 00:00:00')
      ELSE COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) END AS at,
    CASE WHEN m.movement_type = 'set' THEN NULL
      WHEN m.movement_type IN ('remove', 'write_off', 'damage_out', 'out') THEN -ABS(COALESCE(m.quantity, 0))
      ELSE ABS(COALESCE(m.quantity, 0)) END AS signed,
    CASE WHEN m.movement_type = 'set' OR m.reason = 'Dated stock count import' OR m.reason LIKE '%(Set to %'
      OR CAST(m.reference_id AS TEXT) LIKE 'stock-set:%' THEN 1 ELSE 0 END AS is_count
  FROM pairs pp
  JOIN inventory_movements m ON m.product_id = pp.product_id AND m.branch_id = pp.branch_id
  WHERE m.movement_type IN ('add', 'remove', 'adjustment', 'set', 'write_off', 'damage_out', 'in', 'out')
    AND m.id NOT IN (SELECT id FROM own)
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
  b.sale_id, b.sale_created_at, b.sale_status, b.sale_amount_paid_usd, b.sale_total_usd,
  b.product_id, b.branch_id, b.sold_qty, b.sale_movement_qty, b.cancel_restore_qty, b.deducted_now,
  b.alloc_drawn, b.alloc_released, b.returned_restocked_qty, b.excess_qty,
  b.return_ids, b.returns_refund_usd, b.first_return_at, b.last_return_at,
  k.opposite_rows, k.opposite_net, k.same_direction_net, k.count_rows, k.exact_id, k.exact_at, k.sales_between, k.suggested_class
FROM bad b
JOIN classified k ON k.item_key = b.sale_id || ':' || b.product_id || ':' || b.branch_id
ORDER BY b.first_return_at, b.sale_id
LIMIT 2000
