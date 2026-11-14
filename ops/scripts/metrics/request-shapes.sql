-- Analytics Engine SQL, not D1. How the routes that carry a shape label (lib/requestMetrics.ts SHAPED_ROUTES) are called:
-- blob6 is 'shape=<label>', then a semicolon and the flags when the request has flags (flagsWithShape). The label is a constant of a fixed
-- set per route (12 characters at most); never a search text or an id. The query groups by the 13 characters after shape= and ops-metrics.mjs
-- mergeShapeRows cuts that at the first semicolon and merges the groups: no label list lives here, because 16 nested if() hit the Analytics
-- Engine SQL parser recursion limit (HTTP 422, metrics runs 43564080244 and 43584970254), and the query guard refuses any semicolon.
-- Weighted by both samplings like route-latency; one cache state per group keeps double6 constant inside it.
SELECT blob2 AS route, blob3 AS method,
       substring(blob6, 7, 13) AS shape,
       blob5 AS cache,
       SUM(_sample_interval * double6) AS requests,
       count() AS stored_rows,
       SUM(_sample_interval * double6 * double3) AS rows_read_total,
       SUM(_sample_interval * double6 * double3) / SUM(_sample_interval * double6) AS rows_read_avg,
       SUM(_sample_interval * double6 * double9) / SUM(_sample_interval * double6) AS d1_calls_avg,
       quantileExactWeighted(0.95)(double1, _sample_interval) AS wall_p95_ms
FROM Business_OS_Analytics
WHERE index1 = 'req_metrics' AND blob1 = 'api' AND blob6 LIKE 'shape=%'
  AND ({{WINDOW}}){{REVISION}}
  AND blob4 >= '200' AND blob4 < '400'
GROUP BY route, method, shape, cache
ORDER BY rows_read_total DESC
