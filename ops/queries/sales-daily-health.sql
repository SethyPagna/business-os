-- sales-daily-health: the stored daily sales totals (migration 0308) at a glance, counts and dates only, no figure. One row.
--   clean_days / dirty_days / claimed_days   rows by state (0, 1, 2); a dirty day is waiting for the sales-daily-recompute cron step
--   oldest_unfinished_day                    the oldest dated day that is not clean (empty when none)
--   old_kernel_days / old_epoch_days         clean days a reader would refuse: another kernel version than the coverage row, another data epoch than now
--   refused_days                             clean days stored with a refusal code (the kernel refused that day's records, or the payload was too large)
--   coverage_ok                              1 when the coverage row names the current data epoch (readers use stored days only then)
--   quarantined                              1 while the reconcile's quarantine row is set (every stored read is stopped until an administrator rebuilds)
--   triggers_present                         must be 4 (the mark-only triggers)
--   recent_days_without_row                  days with a sale in the last 9 days that have no row at all (must be 0)
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 6000
SELECT
  COALESCE(SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END), 0) AS clean_days,
  COALESCE(SUM(CASE WHEN state = 1 THEN 1 ELSE 0 END), 0) AS dirty_days,
  COALESCE(SUM(CASE WHEN state = 2 THEN 1 ELSE 0 END), 0) AS claimed_days,
  COALESCE(MIN(CASE WHEN state <> 0 AND business_date <> '' THEN business_date END), '') AS oldest_unfinished_day,
  COALESCE(SUM(CASE WHEN state = 0 AND kernel_version <> COALESCE((SELECT json_extract(value, '$.kernel') FROM system_flags WHERE key = 'sales_daily_coverage'), -1) THEN 1 ELSE 0 END), 0) AS old_kernel_days,
  COALESCE(SUM(CASE WHEN state = 0 AND data_epoch <> COALESCE((SELECT value FROM system_flags WHERE key = 'data_epoch'), '') THEN 1 ELSE 0 END), 0) AS old_epoch_days,
  COALESCE(SUM(CASE WHEN state = 0 AND refusal IS NOT NULL THEN 1 ELSE 0 END), 0) AS refused_days,
  (SELECT COUNT(*) FROM system_flags c WHERE c.key = 'sales_daily_coverage' AND json_extract(c.value, '$.epoch') = (SELECT value FROM system_flags WHERE key = 'data_epoch')) AS coverage_ok,
  (SELECT COUNT(*) FROM system_flags WHERE key = 'sales_daily_quarantine') AS quarantined,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sales_daily_mark_%') AS triggers_present,
  (SELECT COUNT(*) FROM (SELECT DISTINCT COALESCE(date(created_at, '+7 hours'), '') AS d FROM sales WHERE created_at >= date('now', '-9 days')) recent
    WHERE recent.d NOT IN (SELECT business_date FROM sales_daily_totals)) AS recent_days_without_row
FROM sales_daily_totals
