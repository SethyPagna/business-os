-- DATA-AUDIT lane B (stock & cost), query 6 of 14: does every sale line's stock movement match its sale status?
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Rule (progress.md, "Owner correction: Not Paid must deduct stock -- 9 Sep 2026", in the owner's words: awaiting_payment / Not Paid
-- deducts stock exactly once, like a completed sale; cancellation restores it): the statuses that HOLD stock are completed,
-- awaiting_payment and awaiting_delivery (lib/salesStatus.ts STOCK_DEDUCTED_STATUSES) plus partial_return / returned, which keep the
-- original deduction (the customer-return restock is a separate movement that names the RETURN); cancelled holds nothing
-- (lib/saleTransitions.ts heldQuantity). Verified in source 7 Oct: STOCK_DEDUCTED_STATUSES = {completed, awaiting_payment,
-- awaiting_delivery} and heldQuantity()'s only early return is `cancelled`.
-- Per (sale, product, branch) the stock the SALE's own movements took out is
--     net_out = - SUM(quantity) over 'sale' and 'return' movements whose reference_id is the sale id
--               (a 'return' that names a sale is a cancel / un-cancel / line-removal restock; the 'return' rows of a customer return name the
--                return and carry the reason 'Return: ...' / 'Return #...' / '... grouped return status', and are left out)
-- and what it must be is
--     expected = SUM(line quantity)                                    for every holding status
--     expected = MIN(line quantity, units customer returns took back)  for a cancelled sale (the cancel restores only the units no return restocked)
-- Only SYSTEM sales are held to it (zero-expected). Left out and counted: stock_skipped sales (never deducted; audit-b-stock-skipped-sales.sql),
-- sales-import: and legacy-sale: sales (their stock rules differ; mismatches are info columns), replacement sales (source_return_id is set; their
-- hand-out is the return's replacement_out movement; audit-b-returns-restock.sql), lines on a damaged lot (the units live in damaged_stock_lots).
-- The lot view is checked too: units a line still holds in its lot allocations (quantity - released_quantity) must equal expected.
-- Related, not repeated: forensics-r0-return-on-undeducted-sale.sql (returns restocking more than a sale deducted), forensics-s2-over-returned-lines.sql.
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column; counts are LINES = (sale, product, branch)):
--   deducted_never_deducted        a holding sale whose stock was never taken (net_out 0, expected above 0): the unit is on the shelf AND sold
--   deducted_under_deducted        net_out between 0 and expected
--   deducted_over_deducted         net_out above expected (taken twice, or an un-cancel that re-took more)
--   cancelled_still_out            a cancelled sale whose stock was not (fully) given back
--   cancelled_over_restored        a cancelled sale that gave back MORE than it took (phantom stock; the cancel of a return-restocked sale)
--   allocation_outstanding_mismatch  lines whose lot allocations hold another figure than expected (only lines that have allocation rows)
--   Info columns:
--   lines_checked / system_lines / import_lines / legacy_lines / replacement_lines / skipped_lines / damaged_lot_lines   line counts by class
--   import_lines_mismatch / legacy_lines_mismatch   lines of those classes whose net_out is not expected (their rules differ; sizing only)
--   system_mismatch_first_sale_at / _last_sale_at   the earliest and latest sales.created_at among the system mismatches (the era)
--   examples_system                up to 5 [sale_id, product_id, branch_id, status, expected, net_out], the largest gap first
-- Measured cost: one grouped pass each over sale_items, sale_item_batch_allocations (joined to its line) and inventory_movements (sale/return types
-- with a numeric reference), then a join of the three on (sale, product, branch); see the scale test output (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero deducted_never_deducted,deducted_under_deducted,deducted_over_deducted,cancelled_still_out,cancelled_over_restored,allocation_outstanding_mismatch
WITH ln AS MATERIALIZED (
  SELECT si.sale_id, si.product_id, si.branch_id, SUM(si.quantity) AS q
  FROM sale_items si
  WHERE si.product_id IS NOT NULL AND si.branch_id IS NOT NULL AND si.damaged_lot_id IS NULL
  GROUP BY si.sale_id, si.product_id, si.branch_id
), al AS MATERIALIZED (
  SELECT si.sale_id, si.product_id, si.branch_id, SUM(a.quantity - a.released_quantity) AS out_q
  FROM sale_item_batch_allocations a
  JOIN sale_items si ON si.id = a.sale_item_id
  WHERE si.product_id IS NOT NULL AND si.branch_id IS NOT NULL AND si.damaged_lot_id IS NULL
  GROUP BY si.sale_id, si.product_id, si.branch_id
), mv AS MATERIALIZED (
  SELECT m.reference_id AS sale_id, m.product_id, m.branch_id, -SUM(m.quantity) AS net
  FROM inventory_movements m
  WHERE m.movement_type IN ('sale', 'return') AND typeof(m.reference_id) = 'integer'
    AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
      OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))
  GROUP BY m.reference_id, m.product_id, m.branch_id
), rt AS MATERIALIZED (
  SELECT r.sale_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id) AS branch_id, SUM(ri.quantity) AS rq
  FROM returns r
  JOIN return_items ri ON ri.return_id = r.id
  WHERE r.sale_id IS NOT NULL AND COALESCE(r.status, 'completed') <> 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'
  GROUP BY r.sale_id, ri.product_id, COALESCE(ri.branch_id, r.branch_id)
), keys AS MATERIALIZED (
  SELECT sale_id, product_id, branch_id FROM ln
  UNION
  SELECT sale_id, product_id, branch_id FROM mv
), x AS MATERIALIZED (
  SELECT k.sale_id, k.product_id, k.branch_id, s.sale_status AS status, s.created_at AS sale_at,
    CASE WHEN s.id IS NULL THEN 'missing'
      WHEN COALESCE(s.stock_skipped, 0) <> 0 THEN 'skipped'
      WHEN s.source_return_id IS NOT NULL THEN 'replacement'
      WHEN s.client_request_id >= 'sales-import:' AND s.client_request_id < 'sales-import;' THEN 'import'
      WHEN s.client_request_id >= 'legacy-sale:' AND s.client_request_id < 'legacy-sale;' THEN 'legacy'
      ELSE 'system' END AS cls,
    COALESCE(ln.q, 0) AS q, COALESCE(mv.net, 0) AS net, COALESCE(rt.rq, 0) AS rq, al.out_q AS out_q,
    CASE WHEN COALESCE(s.sale_status, 'completed') = 'cancelled' THEN MIN(COALESCE(ln.q, 0), COALESCE(rt.rq, 0)) ELSE COALESCE(ln.q, 0) END AS expected
  FROM keys k
  LEFT JOIN sales s ON s.id = k.sale_id
  LEFT JOIN ln ON ln.sale_id = k.sale_id AND ln.product_id = k.product_id AND ln.branch_id = k.branch_id
  LEFT JOIN mv ON mv.sale_id = k.sale_id AND mv.product_id = k.product_id AND mv.branch_id = k.branch_id
  LEFT JOIN rt ON rt.sale_id = k.sale_id AND rt.product_id = k.product_id AND rt.branch_id = k.branch_id
  LEFT JOIN al ON al.sale_id = k.sale_id AND al.product_id = k.product_id AND al.branch_id = k.branch_id
), bad AS MATERIALIZED (
  SELECT sale_id, product_id, branch_id, status, expected, net, sale_at FROM x
  WHERE cls = 'system' AND (ABS(net - expected) > 0.000001 OR (out_q IS NOT NULL AND ABS(out_q - expected) > 0.000001))
)
SELECT
  (SELECT COUNT(*) FROM x WHERE cls = 'system' AND COALESCE(status, 'completed') <> 'cancelled' AND expected > 0 AND ABS(net) <= 0.000001) AS deducted_never_deducted,
  (SELECT COUNT(*) FROM x WHERE cls = 'system' AND COALESCE(status, 'completed') <> 'cancelled' AND net > 0.000001 AND net < expected - 0.000001) AS deducted_under_deducted,
  (SELECT COUNT(*) FROM x WHERE cls = 'system' AND COALESCE(status, 'completed') <> 'cancelled' AND net > expected + 0.000001) AS deducted_over_deducted,
  (SELECT COUNT(*) FROM x WHERE cls = 'system' AND status = 'cancelled' AND net > expected + 0.000001) AS cancelled_still_out,
  (SELECT COUNT(*) FROM x WHERE cls = 'system' AND status = 'cancelled' AND net < expected - 0.000001) AS cancelled_over_restored,
  (SELECT COUNT(*) FROM x WHERE cls = 'system' AND out_q IS NOT NULL AND ABS(out_q - expected) > 0.000001) AS allocation_outstanding_mismatch,
  (SELECT COUNT(*) FROM x) AS lines_checked,
  (SELECT COUNT(*) FROM x WHERE cls = 'system') AS system_lines,
  (SELECT COUNT(*) FROM x WHERE cls = 'import') AS import_lines,
  (SELECT COUNT(*) FROM x WHERE cls = 'legacy') AS legacy_lines,
  (SELECT COUNT(*) FROM x WHERE cls = 'replacement') AS replacement_lines,
  (SELECT COUNT(*) FROM x WHERE cls = 'skipped') AS skipped_lines,
  (SELECT COUNT(*) FROM sale_items WHERE damaged_lot_id IS NOT NULL) AS damaged_lot_lines,
  (SELECT COUNT(*) FROM x WHERE cls = 'import' AND ABS(net - expected) > 0.000001) AS import_lines_mismatch,
  (SELECT COUNT(*) FROM x WHERE cls = 'legacy' AND ABS(net - expected) > 0.000001) AS legacy_lines_mismatch,
  (SELECT MIN(sale_at) FROM bad) AS system_mismatch_first_sale_at,
  (SELECT MAX(sale_at) FROM bad) AS system_mismatch_last_sale_at,
  (SELECT COALESCE(json_group_array(json_array(sale_id, product_id, branch_id, status, expected, net)), '[]')
    FROM (SELECT sale_id, product_id, branch_id, status, expected, net FROM bad ORDER BY ABS(net - expected) DESC, sale_id, product_id LIMIT 5)) AS examples_system
