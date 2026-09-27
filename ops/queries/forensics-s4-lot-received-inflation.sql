-- F-forensics S4: supplier lots whose received_quantity was inflated by
-- customer returns. lib/productBatches.ts planReceiveBatchStock's explicit-lot
-- path adds the quantity to product_batches.received_quantity; the return
-- create and edit restocks (routes/returns.ts) use that path for the sale's own
-- lot, and nothing (return cancel, edit reversal) ever takes it back off.
-- Lots the return itself created (batch_key ' event:...') are excluded: their
-- received figure IS the returned units.
--
-- inflation_qty = alloc_qty + edit_reversed_qty + legacy_single_lot_qty
--   alloc_qty              current return_item_batch_allocations into the lot,
--                          every status (a cancel never un-receives)
--   edit_reversed_qty      earlier versions of edited returns (each edit
--                          reversed them, their receive stayed), lot-stamped rows
--   legacy_single_lot_qty  restocked lines with a lot and no allocation rows
--   unattributed_edit_rows edit reversals of this product with no lot stamp
--                          (multi-lot; not counted -- review)
-- receipts_qty is the lot's own add / stock_in / in movements, and
-- received_minus_receipts compares the stored figure with it (corroboration
-- only: imports, merges and pre-0067 lots make it approximate).
-- Only returns from 2026-08-28 (migration 0067 added received_quantity).
-- Read-only. Ids, dates and quantities only.
-- ops:min-rows 0
-- ops:max-rows 3000
WITH ret AS (
  SELECT rba.batch_id, SUM(rba.quantity) AS alloc_qty, COUNT(DISTINCT ri.return_id) AS return_count,
    MIN(COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at)) AS first_at, MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at)) AS last_at,
    json_group_array(DISTINCT ri.return_id) AS return_ids
  FROM return_item_batch_allocations rba
  JOIN return_items ri ON ri.id = rba.return_item_id
  JOIN returns r ON r.id = ri.return_id
  WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND r.created_at >= '2026-08-28'
  GROUP BY rba.batch_id
),
edit_rev AS (
  SELECT m.batch_id, SUM(ABS(COALESCE(m.quantity, 0))) AS q
  FROM inventory_movements m
  WHERE m.movement_type = 'return_reversal' AND m.reason LIKE 'Return #% updated - reversing previous restock'
    AND m.batch_id IS NOT NULL
  GROUP BY m.batch_id
),
legacy AS (
  SELECT ri.batch_id, SUM(ri.quantity) AS q
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE ri.batch_id IS NOT NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND r.created_at >= '2026-08-28'
    AND COALESCE(ri.stock_action, CASE WHEN ri.return_to_stock = 1 THEN 'restock' END) = 'restock'
    AND NOT EXISTS (SELECT 1 FROM return_item_batch_allocations z WHERE z.return_item_id = ri.id)
  GROUP BY ri.batch_id
),
lots AS (
  SELECT pb.id AS batch_id, pb.variant_product_id AS product_id, pb.received_quantity, pb.received_branch_id,
    pb.supplier_id, pb.received_at, pb.unit_cost_usd, pb.received_cost_usd,
    COALESCE(ret.alloc_qty, 0) AS alloc_qty, COALESCE(edit_rev.q, 0) AS edit_reversed_qty, COALESCE(legacy.q, 0) AS legacy_single_lot_qty,
    ret.return_count, ret.first_at, ret.last_at, ret.return_ids
  FROM product_batches pb
  LEFT JOIN ret ON ret.batch_id = pb.id
  LEFT JOIN edit_rev ON edit_rev.batch_id = pb.id
  LEFT JOIN legacy ON legacy.batch_id = pb.id
  WHERE pb.batch_key NOT LIKE ' event:%'
    AND (ret.batch_id IS NOT NULL OR edit_rev.batch_id IS NOT NULL OR legacy.batch_id IS NOT NULL)
)
SELECT
  l.batch_id, l.product_id, l.supplier_id, l.received_at, l.received_branch_id,
  l.received_quantity, l.unit_cost_usd, l.received_cost_usd,
  l.alloc_qty, l.edit_reversed_qty, l.legacy_single_lot_qty,
  l.alloc_qty + l.edit_reversed_qty + l.legacy_single_lot_qty AS inflation_qty,
  (SELECT COUNT(*) FROM inventory_movements m WHERE m.product_id = l.product_id AND m.movement_type = 'return_reversal'
    AND m.reason LIKE 'Return #% updated - reversing previous restock' AND m.batch_id IS NULL) AS unattributed_edit_rows,
  (SELECT COALESCE(SUM(ABS(COALESCE(m.quantity, 0))), 0) FROM inventory_movements m
    WHERE m.batch_id = l.batch_id AND m.movement_type IN ('add', 'stock_in', 'in')) AS receipts_qty,
  COALESCE(l.received_quantity, 0) - (SELECT COALESCE(SUM(ABS(COALESCE(m.quantity, 0))), 0) FROM inventory_movements m
    WHERE m.batch_id = l.batch_id AND m.movement_type IN ('add', 'stock_in', 'in')) AS received_minus_receipts,
  (SELECT COALESCE(SUM(bbs.quantity), 0) FROM branch_batch_stock bbs WHERE bbs.batch_id = l.batch_id) AS lot_on_hand,
  (SELECT COALESCE(SUM(sia.quantity), 0) FROM sale_item_batch_allocations sia WHERE sia.batch_id = l.batch_id) AS lot_sold_alloc,
  l.return_count, l.return_ids, l.first_at, l.last_at
FROM lots l
WHERE l.alloc_qty + l.edit_reversed_qty + l.legacy_single_lot_qty > 0
ORDER BY l.batch_id
LIMIT 3000
