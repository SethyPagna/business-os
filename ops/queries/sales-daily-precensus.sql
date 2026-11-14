-- sales-daily-precensus: the read-only census to run BEFORE migration 0308 (stored daily sales totals) is applied. Counts only, one row, no figure and no customer data.
--   sales                         all sales rows
--   created_at_null               sales with no created_at (they key the '' day, excluded by every dated window)
--   created_at_unreadable         sales whose created_at SQLite cannot read as a date (also the '' day)
--   shape_canonical               'YYYY-MM-DD HH:MM:SS'
--   shape_iso                     'YYYY-MM-DDT...'
--   shape_date_only               'YYYY-MM-DD'
--   shape_other                   readable by date() but none of the three shapes above
--   raw_bound_violations          MUST BE 0: sales whose date(created_at,'+7 hours') the raw-column bound of the window test (businessDateWindow.ts) would exclude. The stored
--                                 day key is the same SQL expression as the window test; a non-zero count means a day key and a window could disagree.
--   distinct_days                 how many rows the migration seed will write (3 x this = rows written incl. indexes, about)
--   sales_with_other_line_branch  sales with a line whose branch differs from the sale header's (the /sales/stats branch filter is header OR line; the kernel's is header only)
--   last_migration_id             the highest id in d1_migrations: confirm the migration number is still free before applying
-- Cost: one pass over sales plus one sale_items seek per sale. At production size (about 16K sales) that is well under the directive below; at 300 sales a day for three
-- years (about 330K sales) it would not be: run it on Paid, or count it against the day's reads.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 250000
SELECT
  COUNT(*) AS sales,
  COALESCE(SUM(CASE WHEN created_at IS NULL THEN 1 ELSE 0 END), 0) AS created_at_null,
  COALESCE(SUM(CASE WHEN created_at IS NOT NULL AND date(created_at, '+7 hours') IS NULL THEN 1 ELSE 0 END), 0) AS created_at_unreadable,
  COALESCE(SUM(CASE WHEN (length(created_at) = 19 AND substr(created_at, 11, 1) = ' ') THEN 1 ELSE 0 END), 0) AS shape_canonical,
  COALESCE(SUM(CASE WHEN substr(created_at, 11, 1) = 'T' THEN 1 ELSE 0 END), 0) AS shape_iso,
  COALESCE(SUM(CASE WHEN length(created_at) = 10 THEN 1 ELSE 0 END), 0) AS shape_date_only,
  COALESCE(SUM(CASE WHEN date(created_at, '+7 hours') IS NOT NULL
    AND NOT (length(created_at) = 19 AND substr(created_at, 11, 1) = ' ')
    AND substr(created_at, 11, 1) IS NOT 'T'
    AND length(created_at) <> 10 THEN 1 ELSE 0 END), 0) AS shape_other,
  COALESCE(SUM(CASE WHEN date(created_at, '+7 hours') IS NOT NULL
    AND NOT (created_at >= date(date(created_at, '+7 hours'), '-1 day') AND created_at < date(date(created_at, '+7 hours'), '+1 day')) THEN 1 ELSE 0 END), 0) AS raw_bound_violations,
  COUNT(DISTINCT COALESCE(date(created_at, '+7 hours'), '')) AS distinct_days,
  COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = sales.id AND i.branch_id IS NOT sales.branch_id) THEN 1 ELSE 0 END), 0) AS sales_with_other_line_branch,
  COALESCE((SELECT MAX(id) FROM d1_migrations), 0) AS last_migration_id
FROM sales
