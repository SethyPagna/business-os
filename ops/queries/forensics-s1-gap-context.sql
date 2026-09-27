-- F-forensics S1 follow-up: what deleted the inventory_movements ids in each
-- hole, when no dated stock-count run exists. Three sections, one row shape:
--   movement  the surviving rows from 3 ids before to 3 ids after each hole
--             (kind = movement_type, detail = a fixed reason CLASS, never text)
--   audit     audit_logs actions inside the hole's time window, grouped
--             (n = count, detail = json of up to 20 entity ids)
--   return    returns created inside the window (+/- 1 hour) and the first
--             one after it; n = ids missing just before this return id
--             (a rolled-back POST /returns consumes a return id AND deletes
--             its own movements -- routes/returns.ts catch block at the time)
-- Read-only. Ids, dates, types and quantities only.
--   section, gap_after_id, gap_before_id, row_id, at, kind, entity,
--   product_id, branch_id, quantity, reference_id, batch_id, n, detail
-- ops:min-rows 0
-- ops:max-rows 2000
WITH seq AS (
  SELECT id, LAG(id) OVER (ORDER BY id) AS prev_id FROM inventory_movements
),
gaps AS MATERIALIZED (
  SELECT s.prev_id AS lo, s.id AS hi,
    (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p WHERE p.id = s.prev_id) AS lo_at,
    (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', q.created_at), q.created_at) FROM inventory_movements q WHERE q.id = s.id) AS hi_at
  FROM seq s WHERE s.prev_id IS NOT NULL AND s.id - s.prev_id > 1
)
SELECT 'movement' AS section, g.lo AS gap_after_id, g.hi AS gap_before_id, m.id AS row_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) AS at,
  m.movement_type AS kind, NULL AS entity, m.product_id, m.branch_id, m.quantity, m.reference_id, m.batch_id, NULL AS n,
  CASE
    WHEN m.reason IS NULL THEN 'null'
    WHEN m.reason LIKE 'Return: %' THEN 'return_create'
    WHEN m.reason LIKE 'Return #% updated%' THEN 'return_edit'
    WHEN m.reason IN ('Apply grouped return status', 'Undo grouped return status') THEN 'grouped_return_status'
    WHEN m.reason = 'Dated stock count import' THEN 'dated_count'
    WHEN m.reason LIKE 'Revert of #%' THEN 'revert'
    WHEN m.reason LIKE '%into this product%' THEN 'merge'
    WHEN m.reason LIKE '%(Set to %' THEN 'set_to'
    ELSE 'other' END AS detail
FROM gaps g JOIN inventory_movements m ON m.id BETWEEN g.lo - 3 AND g.hi + 3
UNION ALL
SELECT 'audit', g.lo, g.hi, NULL, MIN(COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at)), a.action, a.entity, NULL, NULL, NULL, NULL, NULL, COUNT(*),
  (SELECT json_group_array(x.entity_id) FROM (SELECT DISTINCT a2.entity_id FROM audit_logs a2
     WHERE a2.action = a.action AND COALESCE(a2.entity, '') = COALESCE(a.entity, '')
       AND a2.created_at >= date(g.lo_at, '-1 day') AND a2.created_at < date(g.hi_at, '+2 days')
       AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', a2.created_at), a2.created_at) >= g.lo_at AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', a2.created_at), a2.created_at) <= g.hi_at LIMIT 20) x)
FROM gaps g JOIN audit_logs a ON a.created_at >= date(g.lo_at, '-1 day') AND a.created_at < date(g.hi_at, '+2 days')
  AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) >= g.lo_at AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) <= g.hi_at
GROUP BY g.lo, g.hi, a.action, a.entity
UNION ALL
SELECT 'return', g.lo, g.hi, r.id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at), r.status, COALESCE(r.return_scope, 'customer'), NULL, r.branch_id, NULL, r.sale_id, NULL,
  r.id - COALESCE((SELECT MAX(r2.id) FROM returns r2 WHERE r2.id < r.id), 0) - 1, NULL
FROM gaps g JOIN returns r ON (COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) >= datetime(g.lo_at, '-1 hour') AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) <= datetime(g.hi_at, '+1 hour'))
  OR r.id = (SELECT MIN(r3.id) FROM returns r3 WHERE COALESCE(strftime('%Y-%m-%d %H:%M:%S', r3.created_at), r3.created_at) > g.hi_at)
ORDER BY 2, 1, 4
LIMIT 2000
