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
SELECT
  (SELECT COUNT(*) FROM sale_items c WHERE NOT EXISTS (SELECT 1 FROM sales p WHERE p.id = c.sale_id)) AS sale_items_orphans,
  (SELECT COUNT(*) FROM return_items c WHERE NOT EXISTS (SELECT 1 FROM returns p WHERE p.id = c.return_id)) AS return_items_orphans,
  (SELECT COUNT(*) FROM sale_item_batch_allocations c WHERE NOT EXISTS (SELECT 1 FROM sale_items p WHERE p.id = c.sale_item_id)) AS sale_allocations_orphans,
  (SELECT COUNT(*) FROM sale_item_batch_allocations c WHERE c.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_batches p WHERE p.id = c.batch_id)) AS sale_allocations_lot_orphans,
  (SELECT COUNT(*) FROM return_item_batch_allocations c WHERE NOT EXISTS (SELECT 1 FROM return_items p WHERE p.id = c.return_item_id)) AS return_allocations_orphans,
  (SELECT COUNT(*) FROM branch_batch_stock c WHERE NOT EXISTS (SELECT 1 FROM product_batches p WHERE p.id = c.batch_id)) AS lot_stock_orphans,
  (SELECT COUNT(*) FROM branch_batch_stock c WHERE NOT EXISTS (SELECT 1 FROM branches p WHERE p.id = c.branch_id)) AS lot_stock_branch_orphans,
  (SELECT COUNT(*) FROM branch_stock c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)) AS branch_stock_product_orphans,
  (SELECT COUNT(*) FROM branch_stock c WHERE NOT EXISTS (SELECT 1 FROM branches p WHERE p.id = c.branch_id)) AS branch_stock_branch_orphans,
  (SELECT COUNT(*) FROM product_batches c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.variant_product_id)) AS lot_product_orphans,
  (SELECT COUNT(*) FROM product_batches c WHERE c.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers p WHERE p.id = c.supplier_id)) AS lot_supplier_orphans,
  (SELECT COUNT(*) FROM sales c WHERE c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)) AS sale_customer_orphans,
  (SELECT COUNT(*) FROM returns c WHERE c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)) AS return_customer_orphans,
  (SELECT COUNT(*) FROM returns c WHERE c.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers p WHERE p.id = c.supplier_id)) AS return_supplier_orphans,
  (SELECT COUNT(*) FROM sales c WHERE c.cancel_fee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fees p WHERE p.id = c.cancel_fee_id)) AS sale_cancel_fee_orphans,
  (SELECT COUNT(*) FROM fees c WHERE c.sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales p WHERE p.id = c.sale_id)) AS fee_sale_orphans,
  (SELECT COUNT(*) FROM loyalty_point_adjustments c WHERE NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)) AS loyalty_customer_orphans,
  (SELECT COUNT(*) FROM customer_receivables c WHERE c.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers p WHERE p.id = c.customer_id)) AS receivable_customer_orphans,
  (SELECT COUNT(*) FROM product_images c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)) AS image_product_orphans,
  (SELECT COUNT(*) FROM damaged_stock_lots c WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)) AS damaged_product_orphans,
  (SELECT COUNT(*) FROM products c WHERE COALESCE(c.parent_id, 0) > 0 AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.parent_id)) AS variant_parent_orphans,
  (SELECT COUNT(*) FROM users c WHERE c.role_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM roles p WHERE p.id = c.role_id)) AS user_role_orphans,
  (SELECT COUNT(*) FROM sale_items c WHERE c.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)) AS soft_sale_item_product,
  (SELECT COUNT(*) FROM inventory_movements c WHERE c.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = c.product_id)) AS soft_movement_product,
  (SELECT COUNT(*) FROM branches WHERE is_active = 1 AND is_default = 1) AS core_active_default_branches,
  (SELECT COUNT(DISTINCT code) FROM roles WHERE code IN ('admin', 'manager', 'employee')) AS core_system_roles,
  (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' AND u.is_active = 1 AND u.deleted_at IS NULL) AS core_active_admins
