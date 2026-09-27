-- F-forensics S7: products whose catalog-wide products.stock_quantity differs
-- from the sum of their branch_stock rows. saleTransitions.ts clamps the
-- deduct (MAX(0, ...)) but not the restore, so once a product is below its
-- branch sum each cancel/un-cancel ratchets it upward; many other writers
-- recompute it from branch_stock, which heals it on their next write.
-- products.stock_quantity is what the dashboard stock value (compat.ts),
-- stock stats (familyStockStats) and the customer portal availability read.
--   product_id, is_active, is_group, stock_quantity, branch_sum, drift (+ = rollup too high)
--   branch_rows, updated_at, last_integrity_repair_at (Branches -> Stock integrity -> Repair)
-- ops:min-rows 0
-- ops:max-rows 5000
SELECT
  p.id AS product_id, p.is_active, p.is_group,
  COALESCE(p.stock_quantity, 0) AS stock_quantity,
  COALESCE(b.branch_sum, 0) AS branch_sum,
  COALESCE(p.stock_quantity, 0) - COALESCE(b.branch_sum, 0) AS drift,
  COALESCE(b.branch_rows, 0) AS branch_rows,
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.updated_at), p.updated_at) AS updated_at,
  (SELECT COALESCE(strftime('%Y-%m-%d %H:%M:%S', MAX(a.created_at)), MAX(a.created_at)) FROM audit_logs a WHERE a.action = 'repair' AND a.entity = 'branch_stock_integrity') AS last_integrity_repair_at
FROM products p
LEFT JOIN (SELECT product_id, SUM(quantity) AS branch_sum, COUNT(*) AS branch_rows FROM branch_stock GROUP BY product_id) b
  ON b.product_id = p.id
WHERE ABS(COALESCE(p.stock_quantity, 0) - COALESCE(b.branch_sum, 0)) > 0.000001
ORDER BY ABS(COALESCE(p.stock_quantity, 0) - COALESCE(b.branch_sum, 0)) DESC, p.id
LIMIT 5000
