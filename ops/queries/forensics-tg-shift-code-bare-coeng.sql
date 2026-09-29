-- TG-FIX: shift IDs whose cashier part ends on a bare Khmer coeng (U+17D2, char(6098)).
-- routes/shifts.ts shiftCodeBase caps the cashier name at 24 code points with telegramLang.ts
-- firstCharacters, which cut with Intl.Segmenter before TG-FIX; workerd's segmenter splits a coeng
-- cluster, so a long Khmer name could be stored cut after the coeng. A stored shift_code is never
-- rewritten (audit rows, amendments and Telegram quote it), so this only lists them for the owner.
-- Read-only; one pass over shift_sessions.
--   shift_id, shift_code, user_id, user_name, branch_id, business_date, opened_at,
--   suffixed                 1 when a -N suffix follows the cut name
-- ops:min-rows 0
-- ops:max-rows 500
SELECT
  id AS shift_id, shift_code, user_id, user_name, branch_id, business_date, opened_at,
  CASE WHEN substr(shift_code, -1) = char(6098) THEN 0 ELSE 1 END AS suffixed
FROM shift_sessions
WHERE substr(shift_code, -1) = char(6098)
   OR shift_code GLOB ('*' || char(6098) || '-[0-9]*')
ORDER BY id
LIMIT 500
