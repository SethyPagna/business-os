-- d1-quota-usage: the app's own quota counters (one row per resource per
-- window), the baseline for a daily read-budget governor. Counts only.
-- ops:min-rows 0
-- ops:max-rows 200
SELECT resource, window_key, used, updated_at
FROM quota_usage
ORDER BY window_key DESC, resource
LIMIT 60;
