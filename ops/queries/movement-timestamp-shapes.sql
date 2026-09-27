-- The formats inventory_movements.created_at is stored in, with counts.
-- Record paging assumes UTC written as 'YYYY-MM-DD HH:MM:SS' with no offset;
-- this shows how many rows carry an offset (+HH:MM / -HH:MM) or a trailing Z,
-- and which movement types wrote them.
--
-- A row per (shape, offset_bearing, movement_type). The shape is built only
-- from fixed labels -- never from the stored text -- so it carries no data:
--   YYYY-MM-DD<sep>HH:MM:SS[.fff][+HH:MM|-HH:MM|Z], where <sep> is ' ' or T,
--   or one of: NULL, not text, empty, not an ISO date, YYYY-MM-DD,
--   unrecognised time, unrecognised suffix.
-- offset_bearing is 1 when created_at ends in [+-]HH:MM or in Z.
-- first_seen / last_seen are MIN / MAX(created_at) within the group. Every
-- value reaches only the encrypted artifact.
-- ops:min-rows 1
WITH shaped AS (
  SELECT
    movement_type,
    created_at,
    CASE
      WHEN created_at IS NULL THEN 'NULL'
      WHEN typeof(created_at) <> 'text' THEN 'not text'
      WHEN created_at = '' THEN 'empty'
      WHEN created_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN 'not an ISO date'
      WHEN length(created_at) = 10 THEN 'YYYY-MM-DD'
      WHEN substr(created_at, 11, 1) NOT IN (' ', 'T')
        OR substr(created_at, 12, 8) NOT GLOB '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' THEN 'unrecognised time'
      ELSE 'YYYY-MM-DD'
        || CASE WHEN substr(created_at, 11, 1) = 'T' THEN 'T' ELSE ' ' END
        || 'HH:MM:SS'
        || CASE WHEN substr(created_at, 20, 1) = '.' THEN '.fff' ELSE '' END
        || CASE
             WHEN created_at GLOB '*+[0-9][0-9]:[0-9][0-9]' THEN '+HH:MM'
             WHEN created_at GLOB '*-[0-9][0-9]:[0-9][0-9]' THEN '-HH:MM'
             WHEN created_at GLOB '*Z' THEN 'Z'
             WHEN created_at GLOB '*[0-9]' THEN ''
             ELSE ' unrecognised suffix'
           END
    END AS shape,
    CASE
      WHEN created_at GLOB '*[+-][0-9][0-9]:[0-9][0-9]' OR created_at GLOB '*Z' THEN 1
      ELSE 0
    END AS offset_bearing
  FROM inventory_movements
)
SELECT
  shape,
  offset_bearing,
  movement_type,
  COUNT(*) AS row_count,
  MIN(created_at) AS first_seen,
  MAX(created_at) AS last_seen
FROM shaped
GROUP BY shape, offset_bearing, movement_type
ORDER BY offset_bearing DESC, row_count DESC, shape, movement_type
