-- d1-free-sizes: the largest real write sizes (lines per sale and per return)
-- and table sizes by MAX(rowid), which decide which write paths must be
-- chunked to fit the Free plan's per-request limits. One row of counts only.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 126513
SELECT
  (SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM sale_items GROUP BY sale_id)) AS max_lines_per_sale,
  (SELECT ROUND(AVG(n), 2) FROM (SELECT COUNT(*) AS n FROM sale_items GROUP BY sale_id)) AS avg_lines_per_sale,
  (SELECT COUNT(*) FROM (SELECT sale_id FROM sale_items GROUP BY sale_id HAVING COUNT(*) >= 10)) AS sales_with_10_plus_lines,
  (SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM return_items GROUP BY return_id)) AS max_lines_per_return,
  (SELECT MAX(rowid) FROM inventory_movements) AS movements_maxid,
  (SELECT MAX(rowid) FROM audit_logs) AS audit_logs_maxid,
  (SELECT MAX(rowid) FROM sale_payment_events) AS payment_events_maxid,
  (SELECT MAX(rowid) FROM returns) AS returns_maxid,
  (SELECT MAX(rowid) FROM return_items) AS return_items_maxid,
  (SELECT MAX(rowid) FROM customer_receivables) AS receivables_maxid;
