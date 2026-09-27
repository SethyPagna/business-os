-- F-forensics S1 follow-up: classify the cause of each inventory_movements id
-- hole that no dated stock-count run explains (27 Sep: 44516..44521 and
-- 46197..46199; the dated-count audit has no run at all).
-- inventory_movements.id is AUTOINCREMENT: a rolled-back write never leaves a
-- hole, so every hole is rows that were WRITTEN between gap_after_at and
-- gap_before_at and DELETED later. The only deleters in the Worker since
-- 1 Sep (git grep "DELETE FROM inventory_movements" at 6abd34da, 426b2344 and
-- HEAD; no migration deletes movements):
--   dated_rerun     datedStockCountApply.ts (a re-run deletes the earlier run's rows)
--   merge_undo      undoAppliers.ts applyMergeReversal (deletes the merge's
--                   'adjustment' fold rows; ids kept in the snapshot's
--                   adjustmentMovementIds, or matched by a reason marker)
--   return_rollback routes/returns.ts POST catch block (before the atomic
--                   create): deletes the failed return's 'return' /
--                   replacement_out / damage_in rows AND its returns row, whose
--                   AUTOINCREMENT id is then a hole in returns.id
--   system wipe     routes/system.ts (deletes every movement; not a hole)
-- Anything else is an out-of-band delete (manual SQL) -> 'unexplained'.
-- One row per hole. Read-only. Ids, dates, types and counts only.
--   gap_after_id, gap_before_id, missing_ids, gap_after_at, gap_before_at,
--   after_type, after_ref, before_type, before_ref   (the surviving neighbours)
--   dated_runs_total             audit dated_stock_count_import rows, all time
--   merge_snapshot_hits          json [snapshot_id, status, movement_id] for a
--                                product.merge* snapshot listing a missing id
--   merges_in_window / merges_undone   merge_duplicate audits inside the window
--                                (+5 minutes: the audit is written after the fold),
--                                and how many of those products have a later
--                                action_undo (covers marker-based merges)
--   return_holes                 json [first_missing, last_missing] of returns.id
--                                holes whose neighbours' created_at bracket the window
--   rollback_incomplete          return_rollback_incomplete audits on those ids
--   next_return_id / next_return_at    first return created at/after gap_after_at
--   window_actions               json of up to 15 [action, entity, count] audited
--                                inside the window (what else wrote at the time)
--   suggested_cause              merge_undo | return_rollback | dated_rerun |
--                                unexplained (owner review; the deleted rows are
--                                only readable from a Time Travel restore to a
--                                scratch database)
-- ops:min-rows 0
-- ops:max-rows 500
WITH RECURSIVE seq AS (
  SELECT id, LAG(id) OVER (ORDER BY id) AS prev_id FROM inventory_movements
),
gaps AS MATERIALIZED (
  SELECT s.prev_id AS lo, s.id AS hi, s.id - s.prev_id - 1 AS missing_ids,
    (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p WHERE p.id = s.prev_id) AS lo_at,
    (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', q.created_at), q.created_at) FROM inventory_movements q WHERE q.id = s.id) AS hi_at,
    (SELECT p.movement_type FROM inventory_movements p WHERE p.id = s.prev_id) AS after_type,
    (SELECT p.reference_id FROM inventory_movements p WHERE p.id = s.prev_id) AS after_ref,
    (SELECT q.movement_type FROM inventory_movements q WHERE q.id = s.id) AS before_type,
    (SELECT q.reference_id FROM inventory_movements q WHERE q.id = s.id) AS before_ref
  FROM seq s WHERE s.prev_id IS NOT NULL AND s.id - s.prev_id > 1
  ORDER BY s.id LIMIT 500
),
miss(lo, id, hi) AS (
  SELECT lo, lo + 1, hi FROM gaps WHERE missing_ids <= 1000
  UNION ALL
  SELECT lo, id + 1, hi FROM miss WHERE id + 1 < hi
),
msnap AS MATERIALIZED (
  SELECT s.id, s.kind, s.status, s.payload_json FROM undo_snapshots s
  WHERE s.kind IN ('product.merge', 'product.merge.bulk', 'product.merge.group.child')
    AND EXISTS (SELECT 1 FROM miss x WHERE instr(s.payload_json, CAST(x.id AS TEXT)) > 0)
    AND json_valid(s.payload_json)
),
madj AS MATERIALIZED (
  SELECT s.id AS snapshot_id, s.status, CAST(a.value AS INTEGER) AS movement_id
  FROM msnap s
  JOIN json_each(CASE WHEN s.kind = 'product.merge.bulk' THEN s.payload_json ELSE json_array(json(s.payload_json)) END,
    CASE WHEN s.kind = 'product.merge.bulk' THEN '$.reversals' ELSE '$' END) r
  JOIN json_each(r.value, '$.adjustmentMovementIds') a
),
rseq AS MATERIALIZED (
  SELECT id, LAG(id) OVER (ORDER BY id) AS prev_id,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at) AS at,
    LAG(COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at)) OVER (ORDER BY id) AS prev_at
  FROM returns
),
rholes AS MATERIALIZED (
  SELECT COALESCE(prev_id, 0) + 1 AS first_missing, id - 1 AS last_missing, prev_at, at AS next_at
  FROM rseq WHERE id - COALESCE(prev_id, 0) > 1
),
merges AS MATERIALIZED (
  SELECT g.lo, a.entity_id,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) AS at
  FROM gaps g
  JOIN audit_logs a ON a.action = 'merge_duplicate'
    AND a.created_at >= date(g.lo_at, '-1 day') AND a.created_at < date(g.hi_at, '+2 days')
  WHERE COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) BETWEEN g.lo_at AND datetime(g.hi_at, '+5 minutes')
),
wact AS MATERIALIZED (
  SELECT g.lo, a.action, a.entity, COUNT(*) AS n
  FROM gaps g
  JOIN audit_logs a ON a.created_at >= date(g.lo_at, '-1 day') AND a.created_at < date(g.hi_at, '+2 days')
  WHERE COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) BETWEEN g.lo_at AND datetime(g.hi_at, '+5 minutes')
  GROUP BY g.lo, a.action, a.entity
),
facts AS (
  SELECT g.*,
    (SELECT COUNT(*) FROM audit_logs a WHERE a.action = 'dated_stock_count_import') AS dated_runs_total,
    (SELECT json_group_array(json_array(m.snapshot_id, m.status, m.movement_id)) FROM madj m WHERE m.movement_id > g.lo AND m.movement_id < g.hi) AS merge_snapshot_hits,
    (SELECT COUNT(*) FROM madj m WHERE m.movement_id > g.lo AND m.movement_id < g.hi) AS merge_snapshot_n,
    (SELECT COUNT(*) FROM merges x WHERE x.lo = g.lo) AS merges_in_window,
    (SELECT COUNT(*) FROM merges x WHERE x.lo = g.lo AND EXISTS (SELECT 1 FROM audit_logs u
      WHERE u.entity = 'product' AND u.entity_id = x.entity_id AND u.action = 'action_undo'
        AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', u.created_at), u.created_at) > x.at)) AS merges_undone,
    (SELECT json_group_array(json_array(h.first_missing, h.last_missing)) FROM rholes h
      WHERE (h.prev_at IS NULL OR h.prev_at <= g.hi_at) AND h.next_at >= g.lo_at) AS return_holes,
    (SELECT COUNT(*) FROM rholes h
      WHERE (h.prev_at IS NULL OR h.prev_at <= g.hi_at) AND h.next_at >= g.lo_at) AS return_holes_n,
    (SELECT COUNT(*) FROM rholes h JOIN audit_logs a ON a.entity = 'return'
        AND CAST(a.entity_id AS INTEGER) BETWEEN h.first_missing AND h.last_missing AND a.action = 'return_rollback_incomplete'
      WHERE (h.prev_at IS NULL OR h.prev_at <= g.hi_at) AND h.next_at >= g.lo_at) AS rollback_incomplete,
    (SELECT r.id FROM rseq r WHERE r.at >= g.lo_at ORDER BY r.at, r.id LIMIT 1) AS next_return_id,
    (SELECT r.at FROM rseq r WHERE r.at >= g.lo_at ORDER BY r.at, r.id LIMIT 1) AS next_return_at,
    (SELECT json_group_array(json_array(w.action, w.entity, w.n)) FROM (SELECT * FROM wact w WHERE w.lo = g.lo ORDER BY w.n DESC LIMIT 15) w) AS window_actions
  FROM gaps g
)
SELECT f.lo AS gap_after_id, f.hi AS gap_before_id, f.missing_ids, f.lo_at AS gap_after_at, f.hi_at AS gap_before_at,
  f.after_type, f.after_ref, f.before_type, f.before_ref,
  f.dated_runs_total, f.merge_snapshot_hits, f.merges_in_window, f.merges_undone,
  f.return_holes, f.rollback_incomplete, f.next_return_id, f.next_return_at, f.window_actions,
  CASE
    WHEN f.merge_snapshot_n > 0 OR f.merges_undone > 0 THEN 'merge_undo'
    WHEN f.return_holes_n > 0 THEN 'return_rollback'
    WHEN f.dated_runs_total > 0 THEN 'dated_rerun'
    ELSE 'unexplained'
  END AS suggested_cause
FROM facts f
ORDER BY f.lo
LIMIT 500
