-- F-forensics S5: sale lines whose returned units went back to the wrong lot.
-- A return reverse-walks the sale's lot allocations capped at
-- quantity - released_quantity, but no return ever raises released_quantity,
-- so a second return (or a cancel after a return) lands in the same, most
-- recently drawn lot again. Totals stay right; per-lot stock does not.
-- Per (sale line, lot): drawn = sale_item_batch_allocations.quantity,
-- back = released_quantity + units ACTIVE customer returns put into that lot.
--   excess_qty = back - drawn: > 0 the lot holds units it never sold
--   (over-credited), < 0 the lot is missing units that are on the shelf.
-- Rows are returned only for sale lines with at least one over-credited lot;
-- lots the return created itself (batch_key ' event:...') are excluded.
-- Lot-level compensation: later lot-stamped manual movements on the lot
-- (lot set / remove / adjustment) after the last return, and whether the lot
-- is empty now (moot: the misattribution is gone with the units).
-- Read-only. Ids, dates and quantities only.
-- ops:min-rows 0
-- ops:max-rows 3000
WITH sold AS (
  SELECT sale_item_id, batch_id, SUM(quantity) AS drawn, SUM(COALESCE(released_quantity, 0)) AS released, MAX(branch_id) AS branch_id
  FROM sale_item_batch_allocations GROUP BY sale_item_id, batch_id
),
back AS (
  SELECT rba.sale_item_id, rba.batch_id, SUM(rba.quantity) AS returned, MAX(COALESCE(rba.branch_id, ri.branch_id, r.branch_id)) AS branch_id,
    MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at)) AS last_return_at, json_group_array(DISTINCT r.id) AS return_ids
  FROM return_item_batch_allocations rba
  JOIN return_items ri ON ri.id = rba.return_item_id
  JOIN returns r ON r.id = ri.return_id
  JOIN product_batches pb ON pb.id = rba.batch_id AND pb.batch_key NOT LIKE ' event:%'
  WHERE rba.sale_item_id IS NOT NULL
    AND COALESCE(r.status, 'completed') <> 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'
  GROUP BY rba.sale_item_id, rba.batch_id
),
keys AS (
  SELECT sale_item_id, batch_id FROM sold WHERE sale_item_id IN (SELECT sale_item_id FROM back)
  UNION
  SELECT sale_item_id, batch_id FROM back WHERE sale_item_id IN (SELECT sale_item_id FROM sold)
),
per AS (
  SELECT k.sale_item_id, k.batch_id,
    COALESCE(s.drawn, 0) AS drawn, COALESCE(s.released, 0) AS released, COALESCE(b.returned, 0) AS returned,
    COALESCE(s.released, 0) + COALESCE(b.returned, 0) - COALESCE(s.drawn, 0) AS excess_qty,
    COALESCE(b.branch_id, s.branch_id) AS branch_id, b.last_return_at, b.return_ids
  FROM keys k
  LEFT JOIN sold s ON s.sale_item_id = k.sale_item_id AND s.batch_id = k.batch_id
  LEFT JOIN back b ON b.sale_item_id = k.sale_item_id AND b.batch_id = k.batch_id
),
hit AS (SELECT DISTINCT sale_item_id FROM per WHERE excess_qty > 0.000001),
rows_ AS (
  SELECT p.*, si.sale_id, si.product_id,
    (SELECT MAX(q.last_return_at) FROM per q WHERE q.sale_item_id = p.sale_item_id) AS event_at
  FROM per p JOIN hit h ON h.sale_item_id = p.sale_item_id JOIN sale_items si ON si.id = p.sale_item_id
)
SELECT
  r.sale_id, r.sale_item_id, r.product_id, r.batch_id, r.branch_id,
  pb.received_at, pb.expiry_date,
  r.drawn, r.released, r.returned, r.excess_qty, r.return_ids, r.event_at,
  (SELECT bbs.quantity FROM branch_batch_stock bbs WHERE bbs.batch_id = r.batch_id AND bbs.branch_id = r.branch_id) AS lot_on_hand_now,
  (SELECT COUNT(*) FROM inventory_movements m WHERE m.batch_id = r.batch_id AND m.branch_id = r.branch_id
    AND m.movement_type IN ('remove', 'adjustment', 'set', 'write_off', 'damage_out', 'add')
    AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) > r.event_at) AS later_lot_corrections,
  (SELECT COALESCE(SUM(CASE WHEN m.movement_type IN ('remove', 'write_off', 'damage_out') THEN -ABS(m.quantity)
      WHEN m.movement_type = 'set' THEN 0 ELSE ABS(m.quantity) END), 0)
    FROM inventory_movements m WHERE m.batch_id = r.batch_id AND m.branch_id = r.branch_id
    AND m.movement_type IN ('remove', 'adjustment', 'set', 'write_off', 'damage_out', 'add')
    AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) > r.event_at) AS later_lot_correction_net,
  (SELECT COUNT(*) FROM inventory_movements m WHERE m.batch_id = r.batch_id AND m.branch_id = r.branch_id
    AND m.movement_type = 'sale' AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) > r.event_at) AS later_lot_sales
FROM rows_ r
LEFT JOIN product_batches pb ON pb.id = r.batch_id
ORDER BY r.event_at, r.sale_item_id, r.batch_id
LIMIT 3000
