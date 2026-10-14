-- Release 2e postflight, review checklist item 7: which drawer formula do the
-- shift closes stored by the live Worker carry? READ-ONLY: one SELECT, ids,
-- timestamps, the formula number and counts; no names, cash figures or notes.
--
-- Formula 2 (SHIFT_FIGURES_FORMULA, lib/shiftReconciliation.ts) is what the
-- 2e Worker writes into shift_close_figures.figures_json at $.formula; a row
-- with no $.formula was closed under formula 1 and is never rewritten.
-- Rows (kind column):
--   recent    the 5 newest shift_close_figures rows (by shift_session_id):
--             shift_session_id, closed_at, formula (raw; NULL = formula 1),
--             formula_effective (NULL read as 1)
--   since_2e  one row per formula over the closes made at or after
--             2026-10-14T15:33:00Z (closed_at read as UTC; both the
--             'YYYY-MM-DD HH:MM:SS' and the ISO forms are normalised),
--             with the count of closes in closes_n
-- After release 2e, every since_2e row must be formula 2.
-- ops:min-rows 1
SELECT
  'recent' AS kind,
  shift_session_id,
  closed_at,
  formula,
  COALESCE(formula, 1) AS formula_effective,
  NULL AS closes_n
FROM (
  SELECT shift_session_id, closed_at, json_extract(figures_json, '$.formula') AS formula
  FROM shift_close_figures
  ORDER BY shift_session_id DESC
  LIMIT 5
)
UNION ALL
SELECT
  'since_2e' AS kind,
  NULL AS shift_session_id,
  NULL AS closed_at,
  json_extract(figures_json, '$.formula') AS formula,
  COALESCE(json_extract(figures_json, '$.formula'), 1) AS formula_effective,
  COUNT(*) AS closes_n
FROM shift_close_figures
WHERE COALESCE(strftime('%Y-%m-%d %H:%M:%S', closed_at), closed_at) >= '2026-10-14 15:33:00'
GROUP BY json_extract(figures_json, '$.formula')
