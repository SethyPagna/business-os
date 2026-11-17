-- stock-state-census-shape-20261116: stock-state design Phase 0, census C6, C7 and the products x branches sizing.
-- Sizes every derived table the design would hold:
--   products_*            rows of stock_state with branch_id = 0 (visible = active, or inactive but still holding stock; the
--                         design's stockVisibleProductSql / productHasStockSql, evaluated only for the inactive rows)
--   visible_inactive      C7: inactive products that are still visible because they hold stock (branch, lot or damaged)
--   headers_*             is_group = 1 AND parent_id = 0 rows (C6); children_visible are parent_id > 0 rows
--   families_*            distinct family keys over visible rows (C6): all, and header-only (counted = header rule) and the
--                         largest family; the family_key is the design's FAMILY_ROOT_KEY_SQL
--   branches_*, branch_stock_*   products x branches: branches, branch_stock rows, active products with no branch row, and the
--                         upper bound products_visible x branches_total a per-branch fill would reach
--   max_*                 C8: largest product and branch id
-- Counts only: no product name, no key text, no branch name. Never ANALYZE, never a write. One row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 110000
WITH base AS MATERIALIZED (
  SELECT p.id AS id,
    COALESCE(p.is_active, 0) AS act,
    CASE WHEN COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0 THEN 1 ELSE 0 END AS hdr,
    CASE WHEN COALESCE(p.parent_id, 0) > 0 THEN 1 ELSE 0 END AS child,
    CASE WHEN p.is_active = 1 THEN 1
         WHEN COALESCE(p.stock_quantity, 0) <> 0
           OR EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.quantity <> 0)
           OR EXISTS (SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
                      WHERE pb.variant_product_id = p.id AND bbs.quantity <> 0)
           OR EXISTS (SELECT 1 FROM damaged_stock_lots dl WHERE dl.product_id = p.id AND dl.quantity_remaining <> 0)
         THEN 1 ELSE 0 END AS vis,
    CASE WHEN p.is_active = 1 AND NOT EXISTS (SELECT 1 FROM branch_stock b WHERE b.product_id = p.id) THEN 1 ELSE 0 END AS no_branch_row,
    COALESCE(NULLIF(COALESCE(parent.name_key, p.name_key), ''), 'id:' || COALESCE(parent.id, p.id)) AS fk
  FROM products p
  LEFT JOIN products parent ON parent.id = p.parent_id
),
tot AS MATERIALIZED (
  SELECT COUNT(*) AS products_total,
    SUM(CASE WHEN act = 1 THEN 1 ELSE 0 END) AS products_active,
    SUM(CASE WHEN act <> 1 THEN 1 ELSE 0 END) AS products_inactive,
    SUM(vis) AS products_visible,
    SUM(CASE WHEN vis = 1 AND act <> 1 THEN 1 ELSE 0 END) AS visible_inactive,
    SUM(hdr) AS headers_total,
    SUM(CASE WHEN hdr = 1 AND vis = 1 THEN 1 ELSE 0 END) AS headers_visible,
    SUM(CASE WHEN child = 1 AND vis = 1 THEN 1 ELSE 0 END) AS children_visible,
    SUM(no_branch_row) AS active_products_without_branch_row,
    MAX(id) AS max_product_id
  FROM base
),
fam AS MATERIALIZED (
  SELECT fk, SUM(CASE WHEN hdr = 0 THEN 1 ELSE 0 END) AS nh, COUNT(*) AS n
  FROM base WHERE vis = 1 GROUP BY fk
),
fa AS MATERIALIZED (
  SELECT COUNT(*) AS families_visible, SUM(CASE WHEN nh = 0 THEN 1 ELSE 0 END) AS families_header_only,
    MAX(n) AS largest_family_rows
  FROM fam
)
SELECT tot.products_total, tot.products_active, tot.products_inactive, tot.products_visible, tot.visible_inactive,
  tot.headers_total, tot.headers_visible, tot.children_visible,
  fa.families_visible, COALESCE(fa.families_header_only, 0) AS families_header_only, COALESCE(fa.largest_family_rows, 0) AS largest_family_rows,
  (SELECT COUNT(*) FROM branches) AS branches_total,
  (SELECT COUNT(*) FROM branches WHERE is_active = 1) AS branches_active,
  (SELECT COUNT(*) FROM branch_stock) AS branch_stock_rows,
  tot.active_products_without_branch_row,
  tot.products_visible * (SELECT COUNT(*) FROM branches) AS visible_x_branches_upper_bound,
  tot.max_product_id,
  (SELECT MAX(id) FROM branches) AS max_branch_id
FROM tot, fa
