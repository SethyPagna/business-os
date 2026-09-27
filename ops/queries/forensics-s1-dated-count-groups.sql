-- F-forensics S1: per (product, branch, run) the surviving dated stock-count
-- movements, which run wrote them, and the size of the double-apply.
--
-- Run attribution: a dated row's created_at is the COUNT date, so its write
-- time is bracketed by the nearest non-dated movements either side of its id
-- (and is exact when dated_stock_count_batch_actions has a row for it). The
-- run is the latest dated_stock_count_import audit row inside that bracket.
-- candidate_runs > 1 means two runs sat in the same bracket (review).
--
-- Error: a re-run (movements_deleted > 0) doubled what the deleted rows had
-- done. The deleted rows are gone, so the size is estimated as
--   estimated_error = rerun_net + intervening_net
-- which is exact when the same file was re-applied (the plan re-derives the
-- same deltas from a baseline that already contains the intervening
-- movements); a corrected file needs the deleted rows from a backup taken
-- between the runs (see the plan). For a first run (not a re-run) the error
-- is 0 and the row is context only.
--   run_audit_id, run_at, run_movements_deleted, candidate_runs
--   product_id, branch_id, movement_ids (json [id, count_date, signed, batch_id])
--   rerun_net               signed sum of this run's surviving rows for the pair
--   prior_run_at            previous dated-count run before this one (any pair)
--   intervening_net         net of every other movement on the pair between the two runs
--   estimated_error         the stock the pair holds too many (+) / too few (-)
--   current_branch_qty, current_lot_qty
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
-- ops:max-rows 3000
WITH runs AS (
  SELECT id AS audit_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at) AS at,
    COALESCE(CAST(json_extract(details, '$.movementsDeleted') AS INTEGER), 0) AS deleted
  FROM audit_logs
  WHERE action = 'dated_stock_count_import' AND json_valid(details)
),
dm AS (
  SELECT m.id, m.product_id, m.branch_id, substr(m.created_at, 1, 10) AS count_date, m.batch_id,
    CASE WHEN m.movement_type = 'remove' THEN -ABS(COALESCE(m.quantity, 0)) ELSE ABS(COALESCE(m.quantity, 0)) END AS signed,
    COALESCE(
      (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', MIN(a.created_at)), MIN(a.created_at)) FROM dated_stock_count_batch_actions a WHERE a.movement_id = m.id),
      (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p WHERE p.id < m.id AND COALESCE(p.reason, '') <> 'Dated stock count import' ORDER BY p.id DESC LIMIT 1),
      '0000-00-00 00:00:00') AS after_at,
    (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p WHERE p.id > m.id AND COALESCE(p.reason, '') <> 'Dated stock count import' ORDER BY p.id ASC LIMIT 1) AS before_at
  FROM inventory_movements m
  WHERE m.reason = 'Dated stock count import'
),
dmr AS (
  SELECT dm.*,
    (SELECT r.audit_id FROM runs r WHERE r.at >= dm.after_at AND (dm.before_at IS NULL OR r.at <= datetime(dm.before_at, '+5 seconds'))
      ORDER BY r.at DESC, r.audit_id DESC LIMIT 1) AS run_audit_id,
    (SELECT COUNT(*) FROM runs r WHERE r.at >= dm.after_at AND (dm.before_at IS NULL OR r.at <= datetime(dm.before_at, '+5 seconds'))) AS candidate_runs
  FROM dm
),
grp AS (
  SELECT d.run_audit_id, d.product_id, d.branch_id, MAX(d.candidate_runs) AS candidate_runs,
    SUM(d.signed) AS rerun_net,
    json_group_array(json_array(d.id, d.count_date, d.signed, d.batch_id)) AS movement_ids,
    MIN(d.id) AS min_id, MAX(d.id) AS max_id
  FROM dmr d
  GROUP BY d.run_audit_id, d.product_id, d.branch_id
),
grp2 AS (
  SELECT g.*, r.at AS run_at, COALESCE(r.deleted, 0) AS run_movements_deleted,
    (SELECT MAX(p.at) FROM runs p WHERE r.at IS NOT NULL AND p.at < r.at) AS prior_run_at
  FROM grp g LEFT JOIN runs r ON r.audit_id = g.run_audit_id
),
grp3 AS (
  SELECT g.*,
    CASE WHEN g.prior_run_at IS NULL THEN 0 ELSE COALESCE((
      SELECT SUM(CASE WHEN o.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out',
          'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out')
        THEN -ABS(COALESCE(o.quantity, 0)) ELSE ABS(COALESCE(o.quantity, 0)) END)
      FROM inventory_movements o
      WHERE o.product_id = g.product_id AND o.branch_id = g.branch_id
        AND COALESCE(o.reason, '') <> 'Dated stock count import' AND o.movement_type <> 'set'
        AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', o.created_at), o.created_at) > g.prior_run_at AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', o.created_at), o.created_at) < g.run_at), 0) END AS intervening_net
  FROM grp2 g
),
own AS (SELECT id FROM dm),
affected AS (
  SELECT CAST(COALESCE(g.run_audit_id, 0) AS TEXT) || ':' || g.product_id || ':' || g.branch_id AS item_key,
    g.product_id, g.branch_id, COALESCE(g.run_at, '0000-00-00 00:00:00') AS event_at,
    CASE WHEN g.run_movements_deleted > 0 THEN g.rerun_net + g.intervening_net ELSE 0 END AS error_qty
  FROM grp3 g
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
  g.run_audit_id, g.run_at, g.run_movements_deleted, g.candidate_runs,
  g.product_id, g.branch_id, g.movement_ids, g.rerun_net, g.prior_run_at, g.intervening_net,
  a.error_qty AS estimated_error,
  (SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id = g.product_id AND bs.branch_id = g.branch_id) AS current_branch_qty,
  (SELECT COALESCE(SUM(bbs.quantity), 0) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id
    WHERE pb.variant_product_id = g.product_id AND bbs.branch_id = g.branch_id) AS current_lot_qty,
  k.opposite_rows, k.opposite_net, k.same_direction_net, k.count_rows, k.exact_id, k.exact_at, k.sales_between, k.suggested_class
FROM grp3 g
JOIN affected a ON a.item_key = CAST(COALESCE(g.run_audit_id, 0) AS TEXT) || ':' || g.product_id || ':' || g.branch_id
JOIN classified k ON k.item_key = a.item_key
ORDER BY g.run_at, g.product_id, g.branch_id
LIMIT 3000
