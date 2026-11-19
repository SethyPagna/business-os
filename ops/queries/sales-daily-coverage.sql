-- sales-daily-coverage: does sales_daily_totals (migration 0308) hold a row for EVERY Cambodia business day that has a sale, over all history,
-- and so for every branch? Counts and dates only, no figure, no name. One row. A stored row is per business day (date(created_at, '+7 hours'),
-- the kernel's day); every branch of that day rides inside its one payload, so a (day, branch) pair is covered exactly when its day has a row.
--   sales / undated_sales                          all sales; sales whose created_at gives no date (they belong to business_date '')
--   sale_days / sale_day_branches                  distinct business days with a sale; distinct (day, header branch) pairs with a sale
--   days_without_row / day_branches_without_row    sale days, and (day, branch) pairs, whose day has no row: both MUST be 0
--   first_day_without_row / last_day_without_row  the range of the gap, empty when there is none
--   first_sale_day / last_sale_day                 the dated range of the sales
--   stored_rows / rows_without_sale                rows in the table; rows whose day has no sale now (all its sales deleted or moved): allowed
--   clean_days / dirty_days / claimed_days         rows by state (0, 1, 2)
--   computed_days                                  rows the recompute has ever written (computed_at set); 0 while no kernel is wired
--   quarantined                                    1 while the reconcile's quarantine row is set
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero days_without_row,day_branches_without_row
-- ops:max-rows-read 100000
WITH days AS (
  SELECT COALESCE(date(created_at, '+7 hours'), '') AS day, COUNT(*) AS sales, COUNT(DISTINCT COALESCE(branch_id, -1)) AS branches
  FROM sales
  GROUP BY 1
),
judged AS (
  SELECT d.day, d.sales, d.branches, CASE WHEN t.business_date IS NULL THEN 1 ELSE 0 END AS missing
  FROM days d LEFT JOIN sales_daily_totals t ON t.business_date = d.day
)
SELECT
  COALESCE(SUM(sales), 0) AS sales,
  COALESCE(SUM(CASE WHEN day = '' THEN sales ELSE 0 END), 0) AS undated_sales,
  COUNT(*) AS sale_days,
  COALESCE(SUM(branches), 0) AS sale_day_branches,
  COALESCE(SUM(missing), 0) AS days_without_row,
  COALESCE(SUM(CASE WHEN missing = 1 THEN branches ELSE 0 END), 0) AS day_branches_without_row,
  COALESCE(MIN(CASE WHEN missing = 1 THEN day END), '') AS first_day_without_row,
  COALESCE(MAX(CASE WHEN missing = 1 THEN day END), '') AS last_day_without_row,
  COALESCE(MIN(CASE WHEN day <> '' THEN day END), '') AS first_sale_day,
  COALESCE(MAX(day), '') AS last_sale_day,
  (SELECT COUNT(*) FROM sales_daily_totals) AS stored_rows,
  (SELECT COUNT(*) FROM sales_daily_totals WHERE business_date NOT IN (SELECT day FROM days)) AS rows_without_sale,
  (SELECT COALESCE(SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END), 0) FROM sales_daily_totals) AS clean_days,
  (SELECT COALESCE(SUM(CASE WHEN state = 1 THEN 1 ELSE 0 END), 0) FROM sales_daily_totals) AS dirty_days,
  (SELECT COALESCE(SUM(CASE WHEN state = 2 THEN 1 ELSE 0 END), 0) FROM sales_daily_totals) AS claimed_days,
  (SELECT COUNT(*) FROM sales_daily_totals WHERE computed_at IS NOT NULL) AS computed_days,
  (SELECT COUNT(*) FROM system_flags WHERE key = 'sales_daily_quarantine') AS quarantined
FROM judged
