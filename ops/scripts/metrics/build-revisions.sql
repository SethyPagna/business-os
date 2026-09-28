-- Analytics Engine SQL, not D1. Which builds served the window (blob8), so a before/after split can be made
-- by build; it also proves the reader saw datapoints at all (an empty result fails the run).
SELECT blob8 AS revision,
       SUM(_sample_interval * double6) AS requests,
       count() AS stored_rows,
       min(timestamp) AS first_seen,
       max(timestamp) AS last_seen
FROM Business_OS_Analytics
WHERE index1 = 'req_metrics'
  AND ({{WINDOW}})
GROUP BY revision
ORDER BY first_seen
