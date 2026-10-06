-- DATA-AUDIT lane B (stock & cost), query 6 of 16: does every sale line's stock movement match its sale status?
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
-- The lot view of the same rule (units a line still holds in its lot allocations) is audit-b-sale-allocations.sql, kept apart so each statement stays cheap.
-- Related, not repeated: forensics-r0-return-on-undeducted-sale.sql (returns restocking more than a sale deducted), forensics-s2-over-returned-lines.sql.
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column; counts are LINES = (sale, product, branch)):
--   deducted_never_deducted        a holding sale whose stock was never taken (net_out 0, expected above 0): the unit is on the shelf AND sold
--   deducted_under_deducted        net_out between 0 and expected
--   deducted_over_deducted         net_out above expected (taken twice, or an un-cancel that re-took more)
--   cancelled_still_out            a cancelled sale whose stock was not (fully) given back
--   cancelled_over_restored        a cancelled sale that gave back MORE than it took (phantom stock; the cancel of a return-restocked sale)
--   Info columns:
--   lines_checked / system_lines / import_lines / legacy_lines / replacement_lines / skipped_lines / damaged_lot_lines   line counts by class
--   import_lines_mismatch / legacy_lines_mismatch   lines of those classes whose net_out is not expected (their rules differ; sizing only)
--   system_mismatch_first_sale_at / _last_sale_at   the earliest and latest sales.created_at among the system mismatches (the era)
--   examples_system                up to 5 [sale_id, product_id, branch_id, status, expected, net_out], the largest gap first
-- Needs migration: 0106 (source_return_id), 0114 (sales.stock_skipped); production has applied them (a missing table makes the statement fail loudly, never report 0).
-- Measured cost: ONE grouped pass over the sale_items lines and the sale / return movements (UNION ALL, one packed integer key (sale, branch, product): a grouping on
-- several columns, or a random-access probe per line into the movement log, costs seconds at production scale), one primary-key probe into sales per line, a
-- probe into the customer returns for cancelled sales only, and one aggregate pass; see the scale test output (test-audit-b-scale-workerd.cjs).
-- Lines are taken from sale_items. A sale / return movement of a sale that has NO line for its product is not seen here: audit-b-movement-references.sql
-- (sale_movements_line_missing, ambiguous_reference_unowned) owns that shape.
-- Measured at production scale (workerd D1, ~230 ms best of 5 on an idle host, 458k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero deducted_never_deducted,deducted_under_deducted,deducted_over_deducted,cancelled_still_out,cancelled_over_restored
WITH g AS MATERIALIZED (
  SELECT k, SUM(q) AS q, SUM(net) AS net, SUM(is_line) AS is_line
  FROM (
    SELECT (si.sale_id * 4096 + si.branch_id) * 1048576 + si.product_id AS k, si.quantity AS q, 0 AS net, 1 AS is_line
    FROM sale_items si
    WHERE +si.product_id IS NOT NULL AND si.branch_id IS NOT NULL AND si.damaged_lot_id IS NULL
    UNION ALL
    SELECT (m.reference_id * 4096 + m.branch_id) * 1048576 + m.product_id, 0, -m.quantity, 0
    FROM inventory_movements m
    WHERE m.movement_type IN ('sale', 'return') AND typeof(m.reference_id) = 'integer' AND m.branch_id IS NOT NULL AND m.product_id IS NOT NULL
      AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
        OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))
  )
  GROUP BY k
  HAVING SUM(is_line) > 0
), gk AS (
  -- the packed key unpacked: sale = k / 2^32, branch = (k / 2^20) mod 2^12, product = k mod 2^20
  SELECT k / 4294967296 AS sale_id, (k / 1048576) % 4096 AS branch_id, k % 1048576 AS product_id, q, net FROM g
), x AS MATERIALIZED (
  SELECT g.sale_id AS sale_id, g.product_id AS product_id, g.branch_id AS branch_id, s.sale_status AS status, s.created_at AS sale_at,
    CASE WHEN s.id IS NULL THEN 'missing'
      WHEN COALESCE(s.stock_skipped, 0) <> 0 THEN 'skipped'
      WHEN s.source_return_id IS NOT NULL THEN 'replacement'
      WHEN s.client_request_id >= 'sales-import:' AND s.client_request_id < 'sales-import;' THEN 'import'
      WHEN s.client_request_id >= 'legacy-sale:' AND s.client_request_id < 'legacy-sale;' THEN 'legacy'
      ELSE 'system' END AS cls,
    g.q AS q, g.net AS net,
    CASE WHEN COALESCE(s.sale_status, 'completed') = 'cancelled' THEN MIN(g.q, COALESCE((
      SELECT SUM(ri.quantity) FROM returns r JOIN return_items ri ON ri.return_id = r.id
      WHERE r.sale_id = g.sale_id AND ri.product_id = g.product_id AND COALESCE(ri.branch_id, r.branch_id) = g.branch_id
        AND COALESCE(r.status, 'completed') <> 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'), 0)) ELSE g.q END AS expected
  FROM gk g
  LEFT JOIN sales s ON s.id = g.sale_id
), ag AS MATERIALIZED (
  SELECT
    COALESCE(SUM(CASE WHEN cls = 'system' AND COALESCE(status, 'completed') <> 'cancelled' AND expected > 0 AND ABS(net) <= 0.000001 THEN 1 ELSE 0 END), 0) AS deducted_never_deducted,
    COALESCE(SUM(CASE WHEN cls = 'system' AND COALESCE(status, 'completed') <> 'cancelled' AND net > 0.000001 AND net < expected - 0.000001 THEN 1 ELSE 0 END), 0) AS deducted_under_deducted,
    COALESCE(SUM(CASE WHEN cls = 'system' AND COALESCE(status, 'completed') <> 'cancelled' AND net > expected + 0.000001 THEN 1 ELSE 0 END), 0) AS deducted_over_deducted,
    COALESCE(SUM(CASE WHEN cls = 'system' AND status = 'cancelled' AND net > expected + 0.000001 THEN 1 ELSE 0 END), 0) AS cancelled_still_out,
    COALESCE(SUM(CASE WHEN cls = 'system' AND status = 'cancelled' AND net < expected - 0.000001 THEN 1 ELSE 0 END), 0) AS cancelled_over_restored,
    COUNT(*) AS lines_checked,
    COALESCE(SUM(CASE WHEN cls = 'system' THEN 1 ELSE 0 END), 0) AS system_lines,
    COALESCE(SUM(CASE WHEN cls = 'import' THEN 1 ELSE 0 END), 0) AS import_lines,
    COALESCE(SUM(CASE WHEN cls = 'legacy' THEN 1 ELSE 0 END), 0) AS legacy_lines,
    COALESCE(SUM(CASE WHEN cls = 'replacement' THEN 1 ELSE 0 END), 0) AS replacement_lines,
    COALESCE(SUM(CASE WHEN cls = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped_lines,
    COALESCE(SUM(CASE WHEN cls = 'import' AND ABS(net - expected) > 0.000001 THEN 1 ELSE 0 END), 0) AS import_lines_mismatch,
    COALESCE(SUM(CASE WHEN cls = 'legacy' AND ABS(net - expected) > 0.000001 THEN 1 ELSE 0 END), 0) AS legacy_lines_mismatch,
    MIN(CASE WHEN cls = 'system' AND (ABS(net - expected) > 0.000001) THEN sale_at END) AS system_mismatch_first_sale_at,
    MAX(CASE WHEN cls = 'system' AND (ABS(net - expected) > 0.000001) THEN sale_at END) AS system_mismatch_last_sale_at
  FROM x
)
SELECT ag.*,
  (SELECT COUNT(*) FROM sale_items WHERE damaged_lot_id IS NOT NULL) AS damaged_lot_lines,
  (SELECT COALESCE(json_group_array(json_array(sale_id, product_id, branch_id, status, expected, net)), '[]')
    FROM (SELECT sale_id, product_id, branch_id, status, expected, net FROM x
      WHERE cls = 'system' AND (ABS(net - expected) > 0.000001)
      ORDER BY ABS(net - expected) DESC, sale_id, product_id LIMIT 5)) AS examples_system
FROM ag
