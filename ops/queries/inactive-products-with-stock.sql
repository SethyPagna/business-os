-- ops:max-rows 0
-- Ledger flags are independent evidence, never additive inventory totals.
SELECT p.id AS product_id,
  COALESCE(p.stock_quantity,0)<>0 AS cache_has_stock,
  EXISTS(SELECT 1 FROM branch_stock s WHERE s.product_id=p.id AND s.quantity<>0) AS branch_has_stock,
  EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=p.id AND s.quantity<>0) AS lot_has_stock,
  EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.product_id=p.id AND d.quantity_remaining<>0) AS damaged_has_stock
FROM products p
WHERE p.is_active IS NOT 1 AND (
  COALESCE(p.stock_quantity,0)<>0
  OR EXISTS(SELECT 1 FROM branch_stock s WHERE s.product_id=p.id AND s.quantity<>0)
  OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=p.id AND s.quantity<>0)
  OR EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.product_id=p.id AND d.quantity_remaining<>0))
ORDER BY p.id;
