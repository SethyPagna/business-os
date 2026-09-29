-- SCAN2 PP-2: product discount dates stored in a shape the till and SQL read
-- differently. The products import (lib/importEngine.ts) and stock sessions
-- (lib/stockSession.ts) store discount_starts_at / discount_ends_at as raw
-- text. The till parses it with JavaScript Date (lib/promotionRules.ts), where
-- an unparseable end reads as "never ends" and '05/10/2026' reads as 10 May;
-- SQL (lib/promotionRulesSql.ts) uses datetime(), where the same text reads NULL.
-- One row per non-blank field that is not a plain 'YYYY-MM-DD' date:
--   unparseable      date() is NULL: 'DD/MM/YYYY', '2026-1-5', words, month 13
--   not_iso_date     date() reads it, but not as a calendar date: a bare number
--                    (SQL: a Julian day; JavaScript: a year), 'now' (JavaScript:
--                    never ends)
--   impossible_date  'YYYY-MM-DD' shaped but not a real day ('2026-02-30'): both
--                    sides roll it over into the next month
--   date_with_time   a date followed by a time: read the same by both sides,
--                    listed because the form only ever writes a date
-- Columns: product_id, is_active, discount_enabled, field, shape, stored_value
--   (the first 32 characters), product_updated_at
-- Repair (proposed, not run): re-enter the date on the product form (it writes
-- 'YYYY-MM-DD'); never by SQL.
-- Ids, dates and the stored date text only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 5000
WITH fields AS MATERIALIZED (
  SELECT id, is_active, discount_enabled, updated_at, 'discount_starts_at' AS field, trim(discount_starts_at) AS v
  FROM products WHERE COALESCE(trim(discount_starts_at), '') <> ''
  UNION ALL
  SELECT id, is_active, discount_enabled, updated_at, 'discount_ends_at', trim(discount_ends_at)
  FROM products WHERE COALESCE(trim(discount_ends_at), '') <> ''
),
shaped AS MATERIALIZED (
  SELECT id, is_active, discount_enabled, updated_at, field, v,
    CASE
      WHEN date(v) IS NULL THEN 'unparseable'
      WHEN v NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN 'not_iso_date'
      WHEN date(v) <> substr(v, 1, 10) THEN 'impossible_date'
      WHEN length(v) > 10 THEN 'date_with_time'
    END AS shape
  FROM fields
)
SELECT id AS product_id, is_active, discount_enabled, field, shape, substr(v, 1, 32) AS stored_value,
  updated_at AS product_updated_at
FROM shaped
WHERE shape IS NOT NULL
ORDER BY id, field
LIMIT 5000
