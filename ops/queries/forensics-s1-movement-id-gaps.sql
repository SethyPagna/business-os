-- F-forensics S1: holes in inventory_movements.id. The table is
-- AUTOINCREMENT and a rolled-back D1 batch leaves no hole, so a hole means
-- rows were DELETED. Only two app paths delete movements: a dated stock-count
-- re-run (lib/datedStockCountApply.ts, the S1 double-apply: the deleted rows
-- are the earlier run's, whose stock effect was never reversed) and a product
-- merge undo (lib/undoAppliers.ts, deletes 'adjustment' rows). The neighbours
-- date each hole and show what was written around it.
-- Read-only. Ids, times, types and sizes only.
--   gap_after_id / gap_before_id   the surviving rows either side of the hole
--   missing_ids                    how many ids are missing
--   prev_at / next_at, prev_type / next_type, prev_reason_is_dated / next_reason_is_dated
--   next_dated_rows_in_20          dated stock-count rows among the 20 ids after the hole
-- ops:min-rows 0
-- ops:max-rows 3000
WITH seq AS (
  SELECT id, movement_type, reason, created_at,
    LAG(id) OVER (ORDER BY id) AS prev_id
  FROM inventory_movements
)
SELECT
  s.prev_id AS gap_after_id,
  s.id AS gap_before_id,
  s.id - s.prev_id - 1 AS missing_ids,
  (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.created_at), p.created_at) FROM inventory_movements p WHERE p.id = s.prev_id) AS prev_at,
  (SELECT p.movement_type FROM inventory_movements p WHERE p.id = s.prev_id) AS prev_type,
  (SELECT CASE WHEN p.reason = 'Dated stock count import' THEN 1 ELSE 0 END FROM inventory_movements p WHERE p.id = s.prev_id) AS prev_reason_is_dated,
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) AS next_at,
  s.movement_type AS next_type,
  CASE WHEN s.reason = 'Dated stock count import' THEN 1 ELSE 0 END AS next_reason_is_dated,
  (SELECT COUNT(*) FROM inventory_movements q WHERE q.id >= s.id AND q.id < s.id + 20 AND q.reason = 'Dated stock count import') AS next_dated_rows_in_20
FROM seq s
WHERE s.prev_id IS NOT NULL AND s.id - s.prev_id > 1
ORDER BY s.id
LIMIT 3000
