-- F-forensics S6: ledger rows reverted more than once. lib/stockRevert.ts's
-- double-revert guard is a SELECT followed by a separate write, with no
-- UNIQUE index on reference_id = 'revert:<id>', so two concurrent Revert
-- presses both pass and both move the stock. Every revert row after the first
-- for the same original is an S6 duplicate.
--   original_id, original_type, product_id, branch_id, batch_id
--   revert_count, revert_ids (json [id, at, signed, batch_id]), first_at, last_at
--   error_qty              signed stock the duplicates added (+) or removed (-)
--   duplicates_reverted    duplicate revert rows that were themselves reverted later
--   original_was_receipt   1 when the original was a receipt (the duplicate also
--                          un-received the lot: received_quantity too low)
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
WITH rv AS (
  SELECT m.id, CAST(substr(CAST(m.reference_id AS TEXT), 8) AS INTEGER) AS original_id, m.product_id, m.branch_id, m.batch_id,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) AS at,
    CASE WHEN m.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
        'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out')
      THEN -ABS(COALESCE(m.quantity, 0)) ELSE ABS(COALESCE(m.quantity, 0)) END AS signed
  FROM inventory_movements m
  WHERE CAST(m.reference_id AS TEXT) LIKE 'revert:%'
),
dup AS (
  SELECT original_id, COUNT(*) AS revert_count, MIN(at) AS first_at, MAX(at) AS last_at,
    json_group_array(json_array(id, at, signed, batch_id)) AS revert_ids,
    SUM(signed) - (SELECT r2.signed FROM rv r2 WHERE r2.original_id = rv.original_id ORDER BY r2.id LIMIT 1) AS error_qty,
    MAX(product_id) AS product_id, MAX(branch_id) AS branch_id
  FROM rv GROUP BY original_id HAVING COUNT(*) > 1
),
own AS (SELECT id FROM rv WHERE original_id IN (SELECT original_id FROM dup)),
affected AS (
  SELECT CAST(d.original_id AS TEXT) AS item_key, d.product_id, d.branch_id, d.last_at AS event_at, d.error_qty FROM dup d
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
  d.original_id, o.movement_type AS original_type, d.product_id, d.branch_id, o.batch_id,
  d.revert_count, d.revert_ids, d.first_at, d.last_at, d.error_qty,
  (SELECT COUNT(*) FROM inventory_movements x WHERE CAST(x.reference_id AS TEXT) IN
    (SELECT 'revert:' || r.id FROM rv r WHERE r.original_id = d.original_id
      AND r.id <> (SELECT MIN(r3.id) FROM rv r3 WHERE r3.original_id = d.original_id))) AS duplicates_reverted,
  CASE WHEN o.movement_type IN ('add', 'stock_in') THEN 1 ELSE 0 END AS original_was_receipt,
  k.opposite_rows, k.opposite_net, k.same_direction_net, k.count_rows, k.exact_id, k.exact_at, k.sales_between, k.suggested_class
FROM dup d
LEFT JOIN inventory_movements o ON o.id = d.original_id
JOIN classified k ON k.item_key = CAST(d.original_id AS TEXT)
ORDER BY d.last_at
LIMIT 2000
