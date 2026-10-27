-- The text shapes returns.created_at is stored in, with counts (lane 6.0.995).
-- Read-only. Judges how a day-range filter over returns behaves when the column
-- mixes 'YYYY-MM-DD HH:MM:SS' with ISO 'YYYY-MM-DDTHH:MM:SS[.fff]Z' text.
--
-- One row per shape, then one summary row. The shape is a fixed label built
-- from the text's form (length, the character at position 11, the suffix),
-- never from its content, so no id or customer value is returned:
--   NULL, not text, empty, len N: <sep> + suffix, where <sep> is
--   'space at 11', 'T at 11' or 'other at 11' and the suffix is
--   'Z', '+HH:MM', '-HH:MM' or 'no suffix', or 'not an ISO date'.
--   row_count            rows in the shape
--   first_seen/last_seen MIN / MAX(created_at) in the shape
--   example              one value of the shape (MIN)
-- The last row, 'DAY-CHANGE ...', counts rows whose business day (Asia/Phnom_Penh,
-- +7h) differs between the raw text date (first 10 characters) and
-- date(created_at, '+7 hours'); its row_count is those rows. A second row,
-- 'UNPARSEABLE ...', counts values datetime() cannot read (they would drop out).
-- Three compound arms (shapes, day change, unparseable): under D1's limit of 5.
-- ops:min-rows 1
-- ops:max-rows 40
WITH shaped AS (
  SELECT
    created_at,
    CASE
      WHEN created_at IS NULL THEN 'NULL'
      WHEN typeof(created_at) <> 'text' THEN 'not text'
      WHEN created_at = '' THEN 'empty'
      WHEN created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN 'not an ISO date'
      ELSE 'len ' || length(created_at) || ': '
        || CASE substr(created_at, 11, 1)
             WHEN ' ' THEN 'space at 11'
             WHEN 'T' THEN 'T at 11'
             WHEN '' THEN 'date only'
             ELSE 'other at 11'
           END
        || ' + '
        || CASE
             WHEN created_at GLOB '*Z' THEN 'Z'
             WHEN created_at GLOB '*+[0-9][0-9]:[0-9][0-9]' THEN '+HH:MM'
             WHEN created_at GLOB '*-[0-9][0-9]:[0-9][0-9]' AND length(created_at) > 10 THEN '-HH:MM'
             ELSE 'no suffix'
           END
    END AS shape
  FROM returns
)
SELECT shape, COUNT(*) AS row_count, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen, MIN(created_at) AS example
FROM shaped
GROUP BY shape
UNION ALL
SELECT
  'DAY-CHANGE raw date vs +7h',
  COUNT(*),
  MIN(created_at),
  MAX(created_at),
  MIN(created_at)
FROM returns
WHERE datetime(created_at) IS NOT NULL
  AND substr(created_at, 1, 10) <> date(created_at, '+7 hours')
UNION ALL
SELECT
  'UNPARSEABLE by datetime()',
  COUNT(*),
  MIN(created_at),
  MAX(created_at),
  MIN(created_at)
FROM returns
WHERE created_at IS NOT NULL AND created_at <> '' AND datetime(created_at) IS NULL
