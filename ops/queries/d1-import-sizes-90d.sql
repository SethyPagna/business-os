-- d1-import-sizes-90d: import jobs in the last 90 days by type, with the
-- largest file size, to size the chunked import design for the Free plan.
-- ops:min-rows 0
SELECT type, MAX(total_rows) AS max_rows, COUNT(*) AS jobs
FROM import_jobs
WHERE created_at >= date('now', '-90 days')
GROUP BY type
ORDER BY type;
