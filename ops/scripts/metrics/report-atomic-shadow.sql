-- Analytics Engine SQL, not D1. lib/reportAtomicSwitch.ts shadowCompare writes one datapoint per sampled shadow comparison through recordAnalytics:
-- index1 'report_atomic_shadow', blob1 = route, blob2 = outcome (match, mismatch, write_between, error, refused:<code>), blob3.. = up to 6 differing
-- paths (names only, a mismatch only), double1 = bytes of the served JSON. These rows carry no request-metrics revision in blob8, so this query has no
-- {{REVISION}} filter. Every stored row is one comparison (weight 1 unless Analytics Engine samples it), so SUM(_sample_interval) counts them.
-- Flip rule: 0 mismatch and 0 error over >= 3 trading days, then report_atomic goes on.
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS route, blob2 AS outcome, blob3 AS first_diff_path,
       SUM(_sample_interval) AS comparisons,
       SUM(_sample_interval * double1) AS served_bytes,
       count() AS stored_rows
FROM Business_OS_Analytics
WHERE index1 = 'report_atomic_shadow'
  AND ({{WINDOW}})
GROUP BY day, route, outcome, first_diff_path
ORDER BY day, route, outcome
