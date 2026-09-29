-- Analytics Engine SQL, not D1. Error responses are counted per route and status, apart from the latency
-- query, so a fast 401 or a slow 500 never moves a route's p95.
SELECT blob2 AS route, blob3 AS method, blob4 AS status,
       SUM(_sample_interval * double6) AS requests,
       count() AS stored_rows
FROM Business_OS_Analytics
WHERE index1 = 'req_metrics' AND blob1 = 'api'
  AND ({{WINDOW}}){{REVISION}}
  AND NOT (blob4 >= '200' AND blob4 < '400')
GROUP BY route, method, status
ORDER BY requests DESC
