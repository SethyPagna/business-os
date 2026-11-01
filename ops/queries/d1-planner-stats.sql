-- d1-planner-stats: facts the Free-plan read plan depends on (1 Nov 2026).
-- stat_tables > 0 means the query planner has statistics: several measured
-- plans (Inventory Check stock, sales stats) turn into full scans with them.
-- action_history_over_ttl is the backlog the first undo-history retention run
-- would scan (ACTION_HISTORY_TTL_DAYS = 180 in lib/ephemeralRetention.ts).
-- One row of counts only: no names, money or notes.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'sqlite_stat%') AS stat_tables,
  (SELECT COUNT(*) FROM action_history) AS action_history_rows,
  (SELECT COUNT(*) FROM action_history
    WHERE created_at < datetime('now', '-180 days')) AS action_history_over_ttl,
  (SELECT COUNT(*) FROM branch_batch_stock WHERE quantity > 0) AS positive_lot_rows,
  (SELECT COUNT(*) FROM branch_stock) AS branch_stock_rows,
  (SELECT COUNT(*) FROM product_batches) AS product_batch_rows,
  (SELECT COUNT(*) FROM sales) AS sales_rows,
  (SELECT COUNT(*) FROM sale_items) AS sale_item_rows,
  (SELECT COUNT(*) FROM customers) AS customer_rows,
  (SELECT COUNT(*) FROM products) AS product_rows;
