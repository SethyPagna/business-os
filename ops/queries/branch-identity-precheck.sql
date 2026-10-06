-- Branch identity precheck for migration 0229_branch_identity_backfill (cutover
-- lane LA). Read-only; run it through the Ops d1-export task before the release
-- that carries 0229 deploys. One row per branch.
--   name_key     lower-cased name trimmed of the Worker's whitespace set
--   would_set    the role/canonical_key 0229 would give the row (NULL: left as is)
--   unfinished_cutovers, cutover_rows   branch_cutovers rows (not done / all)
--   blocks_0229  the 0229 guards that would abort it; empty means it applies
-- Expected on production before 0229: rows 1 Warehouse and 2 Shop, both active,
-- role, canonical_key and successor_branch_id NULL, would_set warehouse / shop,
-- unfinished_cutovers 0, cutover_rows 0, blocks_0229 empty. Anything else: stop
-- and report before deploying 0229. Paired test:
-- cloudflare/scripts/test-branch-identity-precheck-query-pure.cjs
-- ops:min-rows 1
WITH k AS (
  SELECT b.id, b.name, b.is_active, b.is_default, b.role, b.canonical_key, b.successor_branch_id,
    CASE WHEN typeof(b.name) = 'text' THEN lower(trim(b.name, char(9, 10, 11, 12, 13, 32, 160, 5760,
      8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287,
      12288, 65279))) END AS name_key
  FROM branches b
), g AS (
  SELECT
    (SELECT COUNT(*) FROM branch_cutovers WHERE phase NOT IN ('completed', 'aborted')) AS unfinished_cutovers,
    (SELECT COUNT(*) FROM branch_cutovers) AS cutover_rows,
    (SELECT COUNT(*) FROM k WHERE name_key IN ('shop', 'warehouse')
      AND (is_active IS NULL OR is_active NOT IN (0, 1))) AS bad_active_flags,
    (SELECT COALESCE(MAX(n), 0) FROM (SELECT COUNT(*) AS n FROM k
      WHERE is_active = 1 AND name_key IN ('shop', 'warehouse') GROUP BY name_key)) AS max_active_per_name,
    (SELECT COUNT(*) FROM k WHERE (role IS NULL) <> (canonical_key IS NULL)) AS half_set_rows,
    (SELECT COUNT(*) FROM k WHERE successor_branch_id IS NOT NULL OR (canonical_key IS NOT NULL
      AND NOT (role IS canonical_key AND canonical_key IS name_key AND is_active = 1))) AS foreign_identity_rows
)
SELECT k.id, k.name, k.is_active, k.is_default, k.role, k.canonical_key, k.successor_branch_id, k.name_key,
  CASE WHEN k.role IS NULL AND k.canonical_key IS NULL AND k.successor_branch_id IS NULL AND k.is_active = 1
      AND k.name_key IN ('shop', 'warehouse')
      AND NOT EXISTS (SELECT 1 FROM branches o WHERE o.canonical_key = k.name_key)
    THEN k.name_key END AS would_set,
  g.unfinished_cutovers, g.cutover_rows,
  trim(CASE WHEN g.unfinished_cutovers > 0 THEN 'pre_no_unfinished_cutover ' ELSE '' END
    || CASE WHEN g.bad_active_flags > 0 THEN 'pre_active_flag_known ' ELSE '' END
    || CASE WHEN g.max_active_per_name > 1 THEN 'pre_one_active_per_name ' ELSE '' END
    || CASE WHEN g.half_set_rows > 0 THEN 'pre_identity_whole ' ELSE '' END
    || CASE WHEN g.cutover_rows = 0 AND g.foreign_identity_rows > 0
      THEN 'pre_identity_is_this_backfill_before_cutover' ELSE '' END) AS blocks_0229
FROM k CROSS JOIN g
ORDER BY k.id
