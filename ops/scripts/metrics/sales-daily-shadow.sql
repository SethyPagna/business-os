-- Analytics Engine SQL, not D1. The sales_daily shadow (stored daily sales totals, read switch sales_daily) writes one datapoint per sampled comparison through recordAnalytics:
-- index1 'sales_daily_shadow', blob1 = route, blob2 = outcome (match, mismatch, write_between, error, refused:<code>), blob3.. = up to 6 differing paths (names only, a mismatch only),
-- double1 = bytes of the served JSON. Same layout as report-atomic-shadow.sql on purpose, under its own kind so the report_atomic flip evidence stays clean. These rows carry no
-- request-metrics revision in blob8, so this query has no {{REVISION}} filter. SUM(_sample_interval) counts the comparisons.
-- ops-metrics.mjs runs this once per Cambodia business day (the whole day, not trading hours) and adds business_date to each row. Flat on purpose: no nested if() and no
-- semicolon, the Analytics Engine parser has a nesting limit (see request-shapes.sql).
-- Flip rule (summarizeShadow): >= 3 days, comparisons on every day, 0 mismatch, 0 error, write_between + refused <= 10% of comparisons.
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS route, blob2 AS outcome, blob3 AS first_diff_path,
       SUM(_sample_interval) AS comparisons,
       SUM(_sample_interval * double1) AS served_bytes,
       count() AS stored_rows
FROM Business_OS_Analytics
WHERE index1 = 'sales_daily_shadow'
  AND ({{WINDOW}})
GROUP BY day, route, outcome, first_diff_path
ORDER BY day, route, outcome
