-- merge-lot-line-product-census-20261117: read-only census before the merge-by-date fold ships (deploy 4). Counts only, one row, no figure and no customer data.
-- The fold re-points a folded lot's sale lines with "product_id = <discarded product>" so it can use the product index. That is exact only while every sale line
-- that names a lot also names that lot's own product. Current writers enforce it; rows written before those checks (legacy imports, repair 0153) are not proven.
--   sale_lines_with_lot           sale_items rows with a batch_id
--   sale_lot_missing              of those, batch_id names no product_batches row
--   sale_mismatch                 MUST BE 0: the line's product_id differs from its lot's variant_product_id (the fold would miss the line)
--   sale_mismatch_active_lot      of sale_mismatch, the lot is still active (the case a future fold could reach)
--   return_lines_with_lot         return_items rows with a batch_id
--   return_mismatch               return lines whose product_id differs from their lot's product (the fold reads return lines without a product filter, so this is information only)
--   sale_alloc_mismatch           sale allocations whose line's product differs from the allocation lot's product (information; allocations are read without a product filter)
-- Cost: one pass over sale_items, return_items and sale_item_batch_allocations with primary-key seeks into product_batches and sale_items.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 600000
SELECT
  (SELECT COUNT(*) FROM sale_items s WHERE s.batch_id IS NOT NULL) AS sale_lines_with_lot,
  (SELECT COUNT(*) FROM sale_items s LEFT JOIN product_batches b ON b.id = s.batch_id WHERE s.batch_id IS NOT NULL AND b.id IS NULL) AS sale_lot_missing,
  (SELECT COUNT(*) FROM sale_items s JOIN product_batches b ON b.id = s.batch_id WHERE s.product_id IS NOT b.variant_product_id) AS sale_mismatch,
  (SELECT COUNT(*) FROM sale_items s JOIN product_batches b ON b.id = s.batch_id WHERE s.product_id IS NOT b.variant_product_id AND COALESCE(b.is_active, 1) = 1) AS sale_mismatch_active_lot,
  (SELECT COUNT(*) FROM return_items r WHERE r.batch_id IS NOT NULL) AS return_lines_with_lot,
  (SELECT COUNT(*) FROM return_items r JOIN product_batches b ON b.id = r.batch_id WHERE r.product_id IS NOT b.variant_product_id) AS return_mismatch,
  (SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items s ON s.id = a.sale_item_id JOIN product_batches b ON b.id = a.batch_id WHERE s.product_id IS NOT b.variant_product_id) AS sale_alloc_mismatch
