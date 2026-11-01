-- recent-sale-money: Tier A "recent" check of the sale header, its lines, its payments and its stock (RELIABILITY-PLAN 5.2, P0.6).
-- The cheap twin of health-sale-money and health-sale-stock-parity, read only for the sales TOUCHED in the last two business
-- days (see recent-stock-ledgers for the window). A sale is touched when it was created in the window, took a payment event
-- in the window (sale_payment_events.received_at, so a late payment on an old sale counts), moved a 'sale' or 'return' stock
-- movement in the window (a cancel, an amendment or a restock of an old sale), or has an action_history row in the window
-- (a settlement or a customer change, which write neither movements nor events while payments_version is 0).
-- The payment state, v1 definitions and the legacy / stock-skipped / replacement exclusions are the ones in
-- health-sale-money and health-sale-stock-parity; read their headers. Money columns:
--   v1_subtotal_ne_lines, v1_calc_ne_components, v1_payable_equation, v1_khr_twin, completed_short, not_paid_but_covered,
--   system_sales_without_lines, negative_totals, bad_rate, payment_events_mismatch (events in minus out vs the header;
--   a payments_version 1 sale with money paid and no event counts).
-- Stock columns, per (sale, product, branch): parity_undeducted, parity_over_deducted, parity_cancelled_still_deducted,
-- parity_cancelled_alloc_held, parity_alloc_over_line. Context, not alarms: sales_checked, lines_checked, info_v0_header_drift.
-- Pinned plans: sales by idx_sales_created_pg, events by idx_sale_payment_events_received, movements by
-- idx_inventory_movements_created_type_user_branch_id and then idx_inventory_movements_reference_type_id (migration 0104).
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero v1_subtotal_ne_lines,v1_calc_ne_components,v1_payable_equation,v1_khr_twin,completed_short,not_paid_but_covered,system_sales_without_lines,negative_totals,bad_rate,payment_events_mismatch,parity_undeducted,parity_over_deducted,parity_cancelled_still_deducted,parity_cancelled_alloc_held,parity_alloc_over_line
-- ops:max-rows-read 8138
WITH win AS MATERIALIZED (
  SELECT datetime(date('now', '+7 hours', '-1 day'), '-7 hours') AS cut
),
ts AS MATERIALIZED (
  SELECT id AS sid FROM sales INDEXED BY idx_sales_created_pg WHERE created_at >= (SELECT cut FROM win)
  UNION
  SELECT sale_id FROM sale_payment_events INDEXED BY idx_sale_payment_events_received WHERE received_at >= (SELECT cut FROM win)
  UNION
  SELECT reference_id FROM inventory_movements INDEXED BY idx_inventory_movements_created_type_user_branch_id
    WHERE created_at >= (SELECT cut FROM win) AND movement_type IN ('sale', 'return') AND reference_id IS NOT NULL
  UNION
  SELECT CAST(entity_id AS INTEGER) FROM action_history INDEXED BY idx_action_history_created_pg
    WHERE created_at >= (SELECT cut FROM win) AND entity = 'sale'
),
sl AS MATERIALIZED (
  SELECT x.id AS id, COALESCE(NULLIF(x.sale_status, ''), 'completed') AS st,
    CASE WHEN x.sale_status = 'awaiting_payment' OR (x.sale_status IN ('partial_return', 'returned') AND x.status_before_return = 'awaiting_payment')
      THEN 'awaiting_payment' WHEN x.sale_status = 'cancelled' THEN 'cancelled' ELSE 'completed' END AS pay,
    COALESCE(x.money_precision_version, 0) AS mpv,
    COALESCE(x.subtotal_usd, 0) AS subtotal, COALESCE(x.discount_usd, 0) AS disc, COALESCE(x.membership_discount_usd, 0) AS mdisc,
    COALESCE(x.tax_usd, 0) AS tax,
    CASE WHEN x.is_delivery = 1 AND COALESCE(NULLIF(x.delivery_fee_paid_by, ''), 'customer') = 'customer' THEN COALESCE(x.delivery_fee_usd, 0) ELSE 0 END AS cust_fee,
    x.calculated_total_usd AS calc, COALESCE(x.rounding_adjustment_usd, 0) AS adj, COALESCE(x.total_usd, 0) AS total,
    COALESCE(x.total_khr, 0) AS total_khr, x.exchange_rate AS rate,
    COALESCE(x.amount_paid_usd, 0) AS paid_usd, COALESCE(x.amount_paid_khr, 0) AS paid_khr,
    COALESCE((SELECT SUM(COALESCE(i.total_usd, 0)) FROM sale_items i INDEXED BY idx_sale_items_sale_id_pg WHERE i.sale_id = x.id), 0) AS lines_usd,
    (SELECT COUNT(*) FROM sale_items i INDEXED BY idx_sale_items_sale_id_pg WHERE i.sale_id = x.id) AS n_lines,
    CASE WHEN COALESCE(x.legacy_receipt_number, '') <> '' OR (x.client_request_id >= 'sales-import:' AND x.client_request_id < 'sales-import;') THEN 1 ELSE 0 END AS imported,
    COALESCE((SELECT SUM(COALESCE(r.owed_reduction_usd, 0)) FROM returns r INDEXED BY idx_returns_sale_id
      WHERE r.sale_id = x.id AND r.refund_currency IS NOT NULL AND COALESCE(r.return_scope, 'customer') = 'customer'
        AND COALESCE(r.status, 'completed') <> 'cancelled'), 0) AS lowered,
    x.payments_version AS pv,
    CASE WHEN x.payments_version = 1 THEN COALESCE((SELECT SUM(CASE WHEN e.direction = 'out' THEN -e.amount_paid_usd ELSE e.amount_paid_usd END)
      FROM sale_payment_events e INDEXED BY idx_sale_payment_events_sale WHERE e.sale_id = x.id), 0) ELSE 0 END AS ev_usd,
    CASE WHEN x.payments_version = 1 THEN COALESCE((SELECT SUM(CASE WHEN e.direction = 'out' THEN -e.amount_paid_khr ELSE e.amount_paid_khr END)
      FROM sale_payment_events e INDEXED BY idx_sale_payment_events_sale WHERE e.sale_id = x.id), 0) ELSE 0 END AS ev_khr,
    CASE WHEN COALESCE(x.legacy_receipt_number, '') = '' AND COALESCE(x.stock_skipped, 0) = 0 AND x.source_return_id IS NULL THEN 1 ELSE 0 END AS in_scope,
    x.branch_id AS branch_id
  FROM ts CROSS JOIN sales x ON x.id = ts.sid
),
pl AS MATERIALIZED (
  SELECT sl.id AS sid, si.product_id AS pid, COALESCE(si.branch_id, sl.branch_id) AS bid, SUM(si.quantity) AS line_qty,
    SUM((SELECT COALESCE(SUM(a.quantity - COALESCE(a.released_quantity, 0)), 0)
      FROM sale_item_batch_allocations a INDEXED BY idx_sale_item_batch_allocations_sale_item WHERE a.sale_item_id = si.id)) AS alloc_held
  FROM sl CROSS JOIN sale_items si INDEXED BY idx_sale_items_sale_id_pg ON si.sale_id = sl.id
  WHERE sl.in_scope = 1 AND si.damaged_lot_id IS NULL
  GROUP BY sl.id, si.product_id, COALESCE(si.branch_id, sl.branch_id)
),
pm AS MATERIALIZED (
  SELECT m.reference_id AS sid, m.product_id AS pid, m.branch_id AS bid,
    SUM(CASE WHEN m.movement_type = 'sale' THEN ABS(COALESCE(m.quantity, 0))
      WHEN m.movement_type = 'return' AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
        OR m.reason IN ('Apply grouped return status', 'Undo grouped return status')) THEN -ABS(COALESCE(m.quantity, 0))
      ELSE 0 END) AS deducted_now
  FROM sl CROSS JOIN inventory_movements m INDEXED BY idx_inventory_movements_reference_type_id
    ON m.reference_id = sl.id AND m.movement_type IN ('sale', 'return')
  WHERE sl.in_scope = 1
  GROUP BY m.reference_id, m.product_id, m.branch_id
),
cls AS MATERIALIZED (
  SELECT CASE
      WHEN sl.st = 'cancelled' AND ABS(COALESCE(v.deducted_now, 0)) > 0.000001 THEN 'cancelled_still_deducted'
      WHEN sl.st = 'cancelled' AND l.alloc_held > 0.000001 THEN 'cancelled_alloc_held'
      WHEN sl.st <> 'cancelled' AND COALESCE(v.deducted_now, 0) < l.line_qty - 0.000001 THEN 'undeducted'
      WHEN sl.st <> 'cancelled' AND COALESCE(v.deducted_now, 0) > l.line_qty + 0.000001 THEN 'over_deducted'
      WHEN l.alloc_held > l.line_qty + 0.000001 THEN 'alloc_over_line'
    END AS class
  FROM sl JOIN pl l ON l.sid = sl.id LEFT JOIN pm v ON v.sid = sl.id AND v.pid = l.pid AND v.bid = l.bid
)
SELECT
  a.sales_checked, (SELECT COUNT(*) FROM pl) AS lines_checked,
  a.v1_subtotal_ne_lines, a.v1_calc_ne_components, a.v1_payable_equation, a.v1_khr_twin, a.completed_short, a.not_paid_but_covered,
  a.system_sales_without_lines, a.negative_totals, a.bad_rate, a.payment_events_mismatch,
  p.parity_undeducted, p.parity_over_deducted, p.parity_cancelled_still_deducted, p.parity_cancelled_alloc_held, p.parity_alloc_over_line,
  a.info_v0_header_drift
FROM (
  SELECT COUNT(*) AS sales_checked,
    COALESCE(SUM(mpv = 1 AND ABS(subtotal - lines_usd) > 0.00005), 0) AS v1_subtotal_ne_lines,
    COALESCE(SUM(mpv = 1 AND (calc IS NULL OR ABS(calc - (subtotal - disc - mdisc + tax + cust_fee)) > 0.00005)), 0) AS v1_calc_ne_components,
    COALESCE(SUM(mpv = 1 AND (calc IS NULL OR ABS(total - calc - adj) > 0.00005 OR ABS(adj) > 0.00505
      OR ABS(total * 100 - ROUND(total * 100)) > 0.00005)), 0) AS v1_payable_equation,
    COALESCE(SUM(mpv = 1 AND rate > 0 AND ABS(total_khr - total * rate) > 0.00005), 0) AS v1_khr_twin,
    COALESCE(SUM(pay = 'completed' AND imported = 0 AND rate > 0 AND total - lowered - paid_usd - paid_khr / rate > 0.005000001), 0) AS completed_short,
    COALESCE(SUM(pay = 'awaiting_payment' AND rate > 0 AND total - paid_usd - paid_khr / rate <= 0.005000001), 0) AS not_paid_but_covered,
    COALESCE(SUM(imported = 0 AND n_lines = 0 AND pay <> 'cancelled'), 0) AS system_sales_without_lines,
    COALESCE(SUM(total < 0 OR subtotal < 0), 0) AS negative_totals,
    COALESCE(SUM(rate IS NULL OR rate <= 0), 0) AS bad_rate,
    COALESCE(SUM(pv = 1 AND (ABS(ev_usd - paid_usd) > 0.00005 OR ABS(ev_khr - paid_khr) > 0.5)), 0) AS payment_events_mismatch,
    COALESCE(SUM(mpv = 0 AND pay <> 'cancelled' AND n_lines > 0 AND ABS(total - (lines_usd - disc - mdisc + tax + cust_fee)) > 0.01), 0) AS info_v0_header_drift
  FROM sl
) a,
(
  SELECT COALESCE(SUM(class = 'undeducted'), 0) AS parity_undeducted, COALESCE(SUM(class = 'over_deducted'), 0) AS parity_over_deducted,
    COALESCE(SUM(class = 'cancelled_still_deducted'), 0) AS parity_cancelled_still_deducted,
    COALESCE(SUM(class = 'cancelled_alloc_held'), 0) AS parity_cancelled_alloc_held, COALESCE(SUM(class = 'alloc_over_line'), 0) AS parity_alloc_over_line
  FROM cls
) p
