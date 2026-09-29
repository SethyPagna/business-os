-- health-sale-stock-parity: sales rung through Business OS whose stock did not
-- move by exactly the line quantity (DATA-MATCH DM-06; owner rule 2026-09-17
-- "if it is through the system, it needs to match correctly"). Window: sales
-- created at or after max(now - 35 days, 2026-09-05) -- before the S4-3 deploy
-- (2026-09-04) a Not Paid sale held no stock at creation (migration 0173).
-- Legacy imports (legacy_receipt_number), stock_skipped sales and exchange
-- replacement sales (source_return_id) are out of scope.
-- Per (sale, product, branch):
--   line_qty      SUM(sale_items.quantity)
--   deducted_now  'sale' movements on the sale id minus 'return' movements on the
--                 sale id whose reason is not a customer-return reason (the
--                 classifier forensics-r0 uses)
--   alloc_held    SUM(quantity - released_quantity) of the lines' lot allocations
--   class         undeducted | over_deducted | cancelled_still_deducted |
--                 alloc_over_line | cancelled_alloc_held
-- Ids, dates and quantities only. RATCHET on the first runs; once a run is clean,
-- set ops:max-rows 0 so any new row fails in the public log.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH ss AS MATERIALIZED (
  SELECT id, COALESCE(NULLIF(sale_status, ''), 'completed') AS st, branch_id,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at) AS at
  FROM sales
  WHERE created_at >= max(date('now', '-35 days'), '2026-09-05')
    AND COALESCE(legacy_receipt_number, '') = '' AND COALESCE(stock_skipped, 0) = 0 AND source_return_id IS NULL
),
ln AS MATERIALIZED (
  SELECT si.sale_id, si.product_id, COALESCE(si.branch_id, ss.branch_id) AS branch_id,
    SUM(si.quantity) AS line_qty,
    SUM((SELECT COALESCE(SUM(a.quantity - COALESCE(a.released_quantity, 0)), 0)
         FROM sale_item_batch_allocations a WHERE a.sale_item_id = si.id)) AS alloc_held
  FROM ss JOIN sale_items si ON si.sale_id = ss.id
  GROUP BY si.sale_id, si.product_id, COALESCE(si.branch_id, ss.branch_id)
),
mv AS MATERIALIZED (
  SELECT m.reference_id AS sale_id, m.product_id, m.branch_id,
    SUM(CASE WHEN m.movement_type = 'sale' THEN ABS(COALESCE(m.quantity, 0))
      WHEN m.movement_type = 'return' AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
        OR m.reason IN ('Apply grouped return status', 'Undo grouped return status')) THEN -ABS(COALESCE(m.quantity, 0))
      ELSE 0 END) AS deducted_now
  FROM ss JOIN inventory_movements m ON m.reference_id = ss.id AND m.movement_type IN ('sale', 'return')
  GROUP BY m.reference_id, m.product_id, m.branch_id
),
cmp AS MATERIALIZED (
  SELECT ss.id AS sale_id, ss.st, ss.at, l.product_id, l.branch_id, l.line_qty, l.alloc_held,
    COALESCE(v.deducted_now, 0) AS deducted_now
  FROM ss JOIN ln l ON l.sale_id = ss.id
  LEFT JOIN mv v ON v.sale_id = ss.id AND v.product_id = l.product_id AND v.branch_id = l.branch_id
)
SELECT sale_id, at AS sale_created_at, st AS sale_status, product_id, branch_id, line_qty, deducted_now, alloc_held,
  CASE
    WHEN st = 'cancelled' AND ABS(deducted_now) > 0.000001 THEN 'cancelled_still_deducted'
    WHEN st = 'cancelled' AND alloc_held > 0.000001 THEN 'cancelled_alloc_held'
    WHEN st <> 'cancelled' AND deducted_now < line_qty - 0.000001 THEN 'undeducted'
    WHEN st <> 'cancelled' AND deducted_now > line_qty + 0.000001 THEN 'over_deducted'
    WHEN alloc_held > line_qty + 0.000001 THEN 'alloc_over_line'
  END AS class
FROM cmp
WHERE (st = 'cancelled' AND (ABS(deducted_now) > 0.000001 OR alloc_held > 0.000001))
   OR (st <> 'cancelled' AND ABS(deducted_now - line_qty) > 0.000001)
   OR alloc_held > line_qty + 0.000001
ORDER BY sale_id, product_id, branch_id
LIMIT 2000
