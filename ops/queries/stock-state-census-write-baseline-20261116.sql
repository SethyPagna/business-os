-- stock-state-census-write-baseline-20261116: stock-state design Phase 0, census C13: the daily write baseline the trigger and
-- fill writes are judged against (design sections 4 and 9: "write baseline unknown"). One row per Cambodia day (UTC+7) for the
-- last 14 days, oldest first; a day with no activity still has its row.
--   sales_rows / sale_lines     sales created that day and their sale_items (the POS stock write per line: 1 product update,
--                               1 branch_stock upsert, 1 movement, lot rows)
--   returns_rows                returns created that day
--   movement_rows               inventory_movements rows that day: every stock change writes one
--   movement_products           distinct products with a movement: the product-row stock changes the design's section 4 estimated
--   movement_pairs              distinct (product, branch) pairs with a movement
--   movement_types              type:count list, so sale / stock-in / adjust / transfer / return are separable
--   audit_rows / history_rows   audit_logs and action_history rows created that day
-- The window is the last 14 Cambodia days including today (a partial day at the end). Counts only. Never a write.
-- ops:min-rows 14
-- ops:max-rows 14
-- ops:max-rows-read 60000
WITH RECURSIVE days(d, k) AS (
  SELECT date('now', '+7 hours', '-13 days'), 1
  UNION ALL
  SELECT date(d, '+1 day'), k + 1 FROM days WHERE k < 14
),
win AS MATERIALIZED (
  SELECT datetime(date('now', '+7 hours', '-13 days'), '-7 hours') AS cut
),
sl AS MATERIALIZED (
  SELECT date(s.created_at, '+7 hours') AS d, COUNT(*) AS n,
    SUM((SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)) AS lines
  FROM sales s INDEXED BY idx_sales_created_pg
  WHERE s.created_at >= (SELECT cut FROM win)
  GROUP BY d
),
rt AS MATERIALIZED (
  SELECT date(created_at, '+7 hours') AS d, COUNT(*) AS n
  FROM returns INDEXED BY idx_returns_created_pg
  WHERE created_at >= (SELECT cut FROM win)
  GROUP BY d
),
mvt AS MATERIALIZED (
  SELECT date(created_at, '+7 hours') AS d, COALESCE(movement_type, '') AS t, COUNT(*) AS n,
    COUNT(DISTINCT product_id) AS products
  FROM inventory_movements INDEXED BY idx_inventory_movements_created_pg
  WHERE created_at >= (SELECT cut FROM win)
  GROUP BY d, t
),
mv AS MATERIALIZED (
  SELECT date(created_at, '+7 hours') AS d, COUNT(*) AS n, COUNT(DISTINCT product_id) AS products,
    COUNT(DISTINCT product_id * 1000000 + COALESCE(branch_id, 0)) AS pairs
  FROM inventory_movements INDEXED BY idx_inventory_movements_created_pg
  WHERE created_at >= (SELECT cut FROM win)
  GROUP BY d
),
au AS MATERIALIZED (
  SELECT date(created_at, '+7 hours') AS d, COUNT(*) AS n
  FROM audit_logs INDEXED BY idx_audit_logs_created
  WHERE created_at >= (SELECT cut FROM win)
  GROUP BY d
),
ah AS MATERIALIZED (
  SELECT date(created_at, '+7 hours') AS d, COUNT(*) AS n
  FROM action_history INDEXED BY idx_action_history_created_pg
  WHERE created_at >= (SELECT cut FROM win)
  GROUP BY d
)
SELECT days.d AS day,
  COALESCE((SELECT n FROM sl WHERE sl.d = days.d), 0) AS sales_rows,
  COALESCE((SELECT lines FROM sl WHERE sl.d = days.d), 0) AS sale_lines,
  COALESCE((SELECT n FROM rt WHERE rt.d = days.d), 0) AS returns_rows,
  COALESCE((SELECT n FROM mv WHERE mv.d = days.d), 0) AS movement_rows,
  COALESCE((SELECT products FROM mv WHERE mv.d = days.d), 0) AS movement_products,
  COALESCE((SELECT pairs FROM mv WHERE mv.d = days.d), 0) AS movement_pairs,
  (SELECT group_concat(t || ':' || n, ',') FROM mvt WHERE mvt.d = days.d) AS movement_types,
  COALESCE((SELECT n FROM au WHERE au.d = days.d), 0) AS audit_rows,
  COALESCE((SELECT n FROM ah WHERE ah.d = days.d), 0) AS history_rows
FROM days
ORDER BY days.d
