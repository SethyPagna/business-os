-- F-forensics S7 follow-up: was inactive product 10223 (stock_quantity 8, no
-- branch_stock rows, updated_at 2026-09-03 03:24:55; its movement count is
-- read by the 'dup' section, not assumed) folded into a keeper by a merge?
-- Until b13b57b4 (2026-09-07) foldDuplicateProductInto (routes/products.ts at
-- d558dcfb and 426b2344) deleted the duplicate's branch_stock, re-parented
-- its movements and set is_active = 0. It never recomputed the duplicate's
-- stock_quantity ("callers recompute the keeper's"). The keeper received the
-- units through 'adjustment' rows whose reason reads
-- 'Merged duplicate product "<name>" (#10223) into this product -- ...'.
-- If those rows (or the snapshot's dupStockBefore) sum to 8, the 8 units are
-- already in the keeper's stock. 10223's rollup is then a stale value, not
-- missing stock, and placing 8 units would count them twice.
-- Read-only. Ids, times and quantities only (the reason text is not output).
-- One row shape: section, id, product_id, branch_id, quantity, at, detail
--   fold      each adjustment row naming (#10223): id, keeper, branch, quantity, created_at
--   snapshot  undo_snapshots product.merge* rows whose dupId is 10223: id, keeper,
--             quantity = SUM(dupStockBefore), at = created_at,
--             detail = {kind, status, updated_at, adjustment_ids, reparented_movements,
--             reparented_sale_items}
--   keeper    each keeper found above: product_id, quantity = stock_quantity,
--             detail = {is_active, branches: [[branch_id, quantity]]}
--   dup       product 10223: quantity = stock_quantity, at = updated_at,
--             detail = {is_active, branch_rows, movements, sale_items}
-- ops:min-rows 1
-- ops:max-rows 200
WITH fold AS MATERIALIZED (
  SELECT m.id, m.product_id, m.branch_id, m.quantity,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) AS at
  FROM inventory_movements m
  WHERE m.movement_type = 'adjustment' AND m.reason LIKE '%(#10223) into this product%'
),
snap AS MATERIALIZED (
  SELECT s.id, s.kind, s.status, s.created_at, s.updated_at, r.value AS rev
  FROM undo_snapshots s
  JOIN json_each(CASE WHEN s.kind = 'product.merge.bulk' THEN s.payload_json ELSE json_array(json(s.payload_json)) END,
    CASE WHEN s.kind = 'product.merge.bulk' THEN '$.reversals' ELSE '$' END) r
  WHERE s.kind IN ('product.merge', 'product.merge.bulk', 'product.merge.group.child')
    AND instr(s.payload_json, '10223') > 0 AND json_valid(s.payload_json)
    AND CAST(json_extract(r.value, '$.dupId') AS INTEGER) = 10223
)
SELECT 'fold' AS section, f.id, f.product_id, f.branch_id, f.quantity, f.at, NULL AS detail
FROM fold f
UNION ALL
SELECT 'snapshot', s.id, CAST(json_extract(s.rev, '$.keeperId') AS INTEGER), NULL,
  (SELECT SUM(CAST(json_extract(d.value, '$.quantity') AS REAL)) FROM json_each(s.rev, '$.dupStockBefore') d),
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at),
  json_object('kind', s.kind, 'status', s.status,
    'updated_at', COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.updated_at), s.updated_at),
    'adjustment_ids', COALESCE(json_array_length(s.rev, '$.adjustmentMovementIds'), 0),
    'reparented_movements', COALESCE(json_array_length(s.rev, '$.reparentedMovementIds'), 0),
    'reparented_sale_items', COALESCE(json_array_length(s.rev, '$.reparentedSaleItemIds'), 0))
FROM snap s
UNION ALL
SELECT 'keeper', NULL, p.id, NULL, p.stock_quantity, NULL,
  json_object('is_active', p.is_active,
    'branches', (SELECT json_group_array(json_array(bs.branch_id, bs.quantity)) FROM branch_stock bs WHERE bs.product_id = p.id))
FROM products p
WHERE p.id IN (SELECT product_id FROM fold)
   OR p.id IN (SELECT CAST(json_extract(rev, '$.keeperId') AS INTEGER) FROM snap)
UNION ALL
SELECT 'dup', NULL, p.id, NULL, p.stock_quantity, COALESCE(strftime('%Y-%m-%d %H:%M:%S', p.updated_at), p.updated_at),
  json_object('is_active', p.is_active,
    'branch_rows', (SELECT COUNT(*) FROM branch_stock bs WHERE bs.product_id = p.id),
    'movements', (SELECT COUNT(*) FROM inventory_movements m WHERE m.product_id = p.id),
    'sale_items', (SELECT COUNT(*) FROM sale_items si WHERE si.product_id = p.id))
FROM products p
WHERE p.id = 10223
LIMIT 200
