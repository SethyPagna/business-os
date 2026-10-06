-- DATA-AUDIT lane B (stock & cost), query 16 of 16: the lot view of a sale's stock -- the units each sale line still holds in its lot allocations.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Rule (progress.md, "Owner correction: Not Paid must deduct stock -- 9 Sep 2026"; lib/salesStatus.ts STOCK_DEDUCTED_STATUSES; lib/saleTransitions.ts heldQuantity):
-- batch identity (29 Aug) -- stock keeps its lot AND branch identity end to end -- so a sale that holds stock holds it in a LOT. sale_item_batch_allocations
-- records, per sale item, the lots it drew (quantity) and what was given back (released_quantity); the units still outstanding on an item are
-- SUM(quantity - released_quantity). For a sale in a holding status (completed, awaiting_payment, awaiting_delivery, partial_return, returned) every item that has
-- allocation rows must still hold exactly its own quantity. For a CANCELLED sale the cancel released everything except the units a customer return had already
-- taken back, so per line (sale, product, branch) the outstanding units must equal MIN(line quantity, units customer returns took back) -- the same figure
-- audit-b-sale-deductions.sql expects of the movement log. Items without any allocation row (legacy / untracked lines) and lines on a damaged lot are not held to it.
-- Only SYSTEM sales are checked: stock_skipped sales (audit-b-stock-skipped-sales.sql), sales-import: / legacy-sale: sales and replacement sales (source_return_id)
-- have other stock rules. Not repeated: audit-b-negative-and-shape.sql (allocation rows with quantity <= 0 or released above drawn).
--
-- One row. Zero-expected (a non-zero value is a defect, named by the column):
--   allocation_held_items_mismatch      items of a holding-status sale whose lot allocations hold another figure than the item's quantity
--   allocation_cancelled_lines_mismatch lines of a cancelled sale whose lot allocations hold another figure than MIN(quantity, returned)
--   Info columns:
--   items_with_allocations              system, non-cancelled items that have allocation rows (the denominator)
--   items_without_allocations           system, non-cancelled items with none (legacy or untracked; not a defect by itself)
--   cancelled_lines_with_allocations    lines of cancelled system sales that have allocation rows
--   examples                            up to 5 [sale_id, item_id, quantity, outstanding], the largest gap first (held items only)
-- Needs migration: 0106 (source_return_id), 0114 (sales.stock_skipped); production has applied them (a missing table makes the statement fail loudly, never report 0).
-- Measured cost: one pass over sale_item_batch_allocations grouped by item (index order, no sort), one pass over sale_items joined to sales by primary key, and a
-- small grouping of the cancelled sales' lines; see the scale test output (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 162 ms best of 5 on an idle host, 432k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero allocation_held_items_mismatch,allocation_cancelled_lines_mismatch
WITH al AS MATERIALIZED (
  SELECT sale_item_id, SUM(quantity - released_quantity) AS out_q FROM sale_item_batch_allocations GROUP BY sale_item_id
), sys AS MATERIALIZED (
  SELECT s.id AS sale_id, s.sale_status AS status
  FROM sales s
  WHERE COALESCE(s.stock_skipped, 0) = 0 AND s.source_return_id IS NULL
    AND NOT (COALESCE(s.client_request_id, '') >= 'sales-import:' AND COALESCE(s.client_request_id, '') < 'sales-import;')
    AND NOT (COALESCE(s.client_request_id, '') >= 'legacy-sale:' AND COALESCE(s.client_request_id, '') < 'legacy-sale;')
), it AS MATERIALIZED (
  SELECT si.sale_id AS sale_id, si.id AS item_id, si.quantity AS q, al.out_q AS out_q
  FROM sale_items si
  JOIN sys ON sys.sale_id = si.sale_id AND COALESCE(sys.status, 'completed') <> 'cancelled'
  LEFT JOIN al ON al.sale_item_id = si.id
  WHERE si.damaged_lot_id IS NULL
), cl AS MATERIALIZED (
  SELECT si.sale_id AS sale_id, si.product_id AS product_id, si.branch_id AS branch_id, SUM(si.quantity) AS q, SUM(al.out_q) AS out_q, COUNT(al.sale_item_id) AS n_al
  FROM sys
  JOIN sale_items si ON si.sale_id = sys.sale_id
  LEFT JOIN al ON al.sale_item_id = si.id
  WHERE sys.status = 'cancelled' AND si.damaged_lot_id IS NULL AND si.product_id IS NOT NULL AND si.branch_id IS NOT NULL
  GROUP BY si.sale_id, si.product_id, si.branch_id
), clx AS MATERIALIZED (
  SELECT cl.*, MIN(cl.q, COALESCE((
    SELECT SUM(ri.quantity) FROM returns r JOIN return_items ri ON ri.return_id = r.id
    WHERE r.sale_id = cl.sale_id AND ri.product_id = cl.product_id AND COALESCE(ri.branch_id, r.branch_id) = cl.branch_id
      AND COALESCE(r.status, 'completed') <> 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'), 0)) AS expected
  FROM cl
), ia AS MATERIALIZED (
  SELECT COALESCE(SUM(CASE WHEN out_q IS NOT NULL AND ABS(out_q - q) > 0.000001 THEN 1 ELSE 0 END), 0) AS bad,
    COALESCE(SUM(CASE WHEN out_q IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_alloc,
    COALESCE(SUM(CASE WHEN out_q IS NULL THEN 1 ELSE 0 END), 0) AS without_alloc
  FROM it
)
SELECT
  ia.bad AS allocation_held_items_mismatch,
  (SELECT COUNT(*) FROM clx WHERE n_al > 0 AND ABS(out_q - expected) > 0.000001) AS allocation_cancelled_lines_mismatch,
  ia.with_alloc AS items_with_allocations,
  ia.without_alloc AS items_without_allocations,
  (SELECT COUNT(*) FROM clx WHERE n_al > 0) AS cancelled_lines_with_allocations,
  (SELECT COALESCE(json_group_array(json_array(sale_id, item_id, q, out_q)), '[]')
    FROM (SELECT sale_id, item_id, q, out_q FROM it WHERE out_q IS NOT NULL AND ABS(out_q - q) > 0.000001 ORDER BY ABS(out_q - q) DESC, item_id LIMIT 5)) AS examples
FROM ia
