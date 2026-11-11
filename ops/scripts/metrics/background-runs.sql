-- Analytics Engine SQL, not D1. Background work (cron steps, the Telegram drain, runBackground in lib/requestMetrics.ts) is blob1 'bg' with the label in blob2,
-- so route-latency and route-errors, which read 'api' only, never see it. One row per business day, label and status: runs, D1 calls, statements, rows read and written.
-- Every background run is stored (weight 1), so SUM(_sample_interval) counts the runs. The window is the trading window like the other queries: a step that runs
-- only outside it (a backup after close) is counted only on the days it also ran inside.
SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob2 AS label, blob4 AS status,
       SUM(_sample_interval * double6) AS runs,
       SUM(_sample_interval * double6 * double9) AS d1_calls,
       SUM(_sample_interval * double6 * double5) AS statements,
       SUM(_sample_interval * double6 * double3) AS rows_read,
       SUM(_sample_interval * double6 * double4) AS rows_written,
       SUM(_sample_interval * double6 * double7) AS failed_calls,
       SUM(_sample_interval * double6 * double8) AS late_calls,
       SUM(_sample_interval * double6 * double3) / SUM(_sample_interval * double6) AS rows_read_per_run,
       SUM(_sample_interval * double6 * double4) / SUM(_sample_interval * double6) AS rows_written_per_run,
       quantileExactWeighted(0.95)(double1, _sample_interval) AS wall_p95_ms
FROM Business_OS_Analytics
WHERE index1 = 'req_metrics' AND blob1 = 'bg'
  AND ({{WINDOW}}){{REVISION}}
GROUP BY day, label, status
ORDER BY day, rows_read DESC
