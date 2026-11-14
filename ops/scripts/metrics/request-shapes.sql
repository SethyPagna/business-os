-- Analytics Engine SQL, not D1. How the routes that carry a shape label (lib/requestMetrics.ts SHAPED_ROUTES) are called:
-- blob6 starts with 'shape=<label>;'. The label is a constant of a fixed set per route; never a search text or an id.
-- Nested if() instead of multiIf (A2): insurance in case the Analytics Engine SQL dialect rejects multiIf; same labels, same result.
-- Weighted by both samplings like route-latency; one cache state per group keeps double6 constant inside it.
SELECT blob2 AS route, blob3 AS method,
       if(blob6 LIKE 'shape=default%', 'default', if(blob6 LIKE 'shape=filter%', 'filter', if(blob6 LIKE 'shape=text%', 'text',
             if(blob6 LIKE 'shape=barcode%', 'barcode', if(blob6 LIKE 'shape=ids%', 'ids', if(blob6 LIKE 'shape=rank_le20%', 'rank_le20',
             if(blob6 LIKE 'shape=rank_lt300%', 'rank_lt300', if(blob6 LIKE 'shape=rank_le1500%', 'rank_le1500', if(blob6 LIKE 'shape=rank_gt1500%', 'rank_gt1500',
             if(blob6 LIKE 'shape=search%', 'search', if(blob6 LIKE 'shape=all%', 'all', if(blob6 LIKE 'shape=day%', 'day',
             if(blob6 LIKE 'shape=range%', 'range', if(blob6 LIKE 'shape=picker_empty%', 'picker_empty', if(blob6 LIKE 'shape=picker_text%', 'picker_text',
             if(blob6 LIKE 'shape=list%', 'list', 'other')))))))))))))))) AS shape,
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
