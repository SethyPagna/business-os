-- d1-sales-per-hour-7d: sales per Cambodia hour over the last 7 days, to
-- check the busy-day model behind the Free read budget. Counts only.
-- ops:min-rows 0
-- ops:max-rows-read 730
SELECT date(created_at, '+7 hours') AS d,
       strftime('%H', created_at, '+7 hours') AS h,
       COUNT(*) AS n
FROM sales
WHERE created_at >= datetime('now', '-7 days')
GROUP BY d, h
ORDER BY d, h;
