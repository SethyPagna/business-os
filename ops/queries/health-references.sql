-- health-references: links that must point at a live row (DATA-MATCH DM-19, and the
-- owner rule that a conflict resolution MOVES every linked record, never orphans it).
-- D1 enforces almost none of these (no foreign keys on the core tables), so a merge,
-- reset or import that misses one leaves a dangling id nobody sees until a report.
-- *_orphans are counts of child rows whose parent id is set but missing. The soft_*
-- columns are by design after a products reset (lib/coreDataInvariants.ts
-- PRODUCTS_RESET_TABLES keeps history rows) and are RATCHET, not ZERO.
-- core_* are the invariants lib/coreDataInvariants.ts restores on a cold isolate.
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 641418
SELECT
  g0.sale_items_orphans,
  g1.return_items_orphans,
  g2.sale_allocations_orphans,
  g2.sale_allocations_lot_orphans,
  g3.return_allocations_orphans,
  g4.lot_stock_orphans,
  g4.lot_stock_branch_orphans,
  g5.branch_stock_product_orphans,
  g5.branch_stock_branch_orphans,
  g6.lot_product_orphans,
  g6.lot_supplier_orphans,
  g7.sale_customer_orphans,
  g8.return_customer_orphans,
  g8.return_supplier_orphans,
  g7.sale_cancel_fee_orphans,
  g9.fee_sale_orphans,
  g10.loyalty_customer_orphans,
  g11.receivable_customer_orphans,
  g12.image_product_orphans,
  g13.damaged_product_orphans,
  g14.variant_parent_orphans,
  g15.user_role_orphans,
  g0.soft_sale_item_product,
  g16.soft_movement_product,
  g17.core_active_default_branches,
  (SELECT COUNT(DISTINCT code) FROM roles WHERE code IN ('admin', 'manager', 'employee')) AS core_system_roles,
  (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' AND u.is_active = 1 AND u.deleted_at IS NULL) AS core_active_admins
FROM (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM sales p WHERE p.id = c.sale_id)), 0) AS sale_items_orphans,
    COALESCE(SUM(c.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)), 0) AS soft_sale_item_product
  FROM sale_items c) g0,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM returns p WHERE p.id = c.return_id)), 0) AS return_items_orphans
  FROM return_items c) g1,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM sale_items p WHERE p.id = c.sale_item_id)), 0) AS sale_allocations_orphans,
    COALESCE(SUM(c.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_batches p WHERE p.id = c.batch_id)), 0) AS sale_allocations_lot_orphans
  FROM sale_item_batch_allocations c) g2,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM return_items p WHERE p.id = c.return_item_id)), 0) AS return_allocations_orphans
  FROM return_item_batch_allocations c) g3,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM product_batches p WHERE p.id = c.batch_id)), 0) AS lot_stock_orphans,
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM branches p WHERE p.id = c.branch_id)), 0) AS lot_stock_branch_orphans
  FROM branch_batch_stock c) g4,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)), 0) AS branch_stock_product_orphans,
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM branches p WHERE p.id = c.branch_id)), 0) AS branch_stock_branch_orphans
  FROM branch_stock c) g5,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.variant_product_id)), 0) AS lot_product_orphans,
    COALESCE(SUM(c.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers p WHERE p.id = c.supplier_id)), 0) AS lot_supplier_orphans
  FROM product_batches c) g6,
  (SELECT
    COALESCE(SUM(c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)), 0) AS sale_customer_orphans,
    COALESCE(SUM(c.cancel_fee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fees p WHERE p.id = c.cancel_fee_id)), 0) AS sale_cancel_fee_orphans
  FROM sales c) g7,
  (SELECT
    COALESCE(SUM(c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)), 0) AS return_customer_orphans,
    COALESCE(SUM(c.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers p WHERE p.id = c.supplier_id)), 0) AS return_supplier_orphans
  FROM returns c) g8,
  (SELECT
    COALESCE(SUM(c.sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales p WHERE p.id = c.sale_id)), 0) AS fee_sale_orphans
  FROM fees c) g9,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)), 0) AS loyalty_customer_orphans
  FROM loyalty_point_adjustments c) g10,
  (SELECT
    COALESCE(SUM(c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)), 0) AS receivable_customer_orphans
  FROM customer_receivables c) g11,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)), 0) AS image_product_orphans
  FROM product_images c) g12,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)), 0) AS damaged_product_orphans
  FROM damaged_stock_lots c) g13,
  (SELECT
    COALESCE(SUM(COALESCE(c.parent_id, 0) > 0 AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.parent_id)), 0) AS variant_parent_orphans
  FROM products c) g14,
  (SELECT
    COALESCE(SUM(c.role_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM roles p WHERE p.id = c.role_id)), 0) AS user_role_orphans
  FROM users c) g15,
  (SELECT
    COALESCE(SUM(c.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)), 0) AS soft_movement_product
  FROM inventory_movements c) g16,
  (SELECT
    COALESCE(SUM(is_active = 1 AND is_default = 1), 0) AS core_active_default_branches
  FROM branches) g17
