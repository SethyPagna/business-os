-- Analytics Engine SQL, not D1. Weighted by both samplings (_sample_interval x double6); one cache state per
-- group keeps double6 constant inside it, so _sample_interval alone is the right quantile weight.
SELECT blob2 AS route, blob3 AS method, blob5 AS cache,
       SUM(_sample_interval * double6) AS requests,
       count() AS stored_rows,
       quantileExactWeighted(0.50)(double1, _sample_interval) AS wall_p50_ms,
       quantileExactWeighted(0.95)(double1, _sample_interval) AS wall_p95_ms,
       quantileExactWeighted(0.95)(double10, _sample_interval) AS d1_wall_p95_ms,
       SUM(_sample_interval * double6 * double9) / SUM(_sample_interval * double6) AS d1_calls_avg,
       SUM(_sample_interval * double6 * double5) / SUM(_sample_interval * double6) AS statements_avg,
       SUM(_sample_interval * double6 * double3) / SUM(_sample_interval * double6) AS rows_read_avg
FROM Business_OS_Analytics
WHERE index1 = 'req_metrics' AND blob1 = 'api'
  AND ({{WINDOW}}){{REVISION}}
  AND blob4 >= '200' AND blob4 < '400'
GROUP BY route, method, cache
ORDER BY requests DESC
