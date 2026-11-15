-- ic-history-census-20261115: read-only size of the Inventory Check history (design census S0). The ic_simple
-- list grows with item history, so these counts decide how soon the ic_wired path must take over.
-- One row of scalar counts: D1 refuses compound SELECTs over 5 terms.
-- ops:min-rows 1
-- ops:max-rows-read 120000
SELECT
  (SELECT COUNT(*) FROM inventory_check_items) AS items_total,
  (SELECT COUNT(*) FROM inventory_check_items WHERE state = 'done') AS items_done,
  (SELECT COUNT(*) FROM inventory_check_items WHERE state = 'issue') AS items_issue,
  (SELECT COUNT(*) FROM inventory_check_items WHERE state = 'unstarted') AS items_unstarted,
  (SELECT COUNT(*) FROM (SELECT 1 FROM inventory_check_items WHERE state IN ('done', 'issue') GROUP BY product_id, branch_id)) AS checked_pairs,
  (SELECT COUNT(*) FROM inventory_check_sessions) AS sessions_total,
  (SELECT COUNT(DISTINCT date(updated_at, '+7 hours')) FROM inventory_check_items WHERE state IN ('done', 'issue')) AS check_days,
  (SELECT MIN(updated_at) FROM inventory_check_items WHERE state IN ('done', 'issue')) AS first_check_at,
  (SELECT COUNT(*) FROM inventory_check_items WHERE updated_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z') AS items_odd_timestamp
