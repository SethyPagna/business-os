-- recent-returns-money: Tier A "recent" check of customer refunds against their rule and their sale (RELIABILITY-PLAN 5.2, P0.6).
-- The cheap twin of health-returns-money, read only for the returns CREATED in the last two business days (idx_returns_created_pg)
-- and the sales they are on (idx_returns_sale_id for every active return of those sales). Window: see recent-stock-ledgers.
-- Per-return columns, as in health-returns-money: v1_refund_equation, v1_refund_khr_twin, v1_refund_khr_paid (the riel payout
-- is never above the twin and less than 100 riel below it), riel_only_customer_returns, returns_on_missing_sale.
-- Per-sale columns: sales_refunded_over_total, debt_lowered_over_total, return_tag_without_evidence, return_evidence_without_tag
-- (an active customer return must tag its sale, a tag must have a return or an import-recorded returned unit).
-- cash_out_over_paid is the owner rule of 5-6 Oct in one inequality: a return on a Not Paid sale lowers the debt and takes no cash
-- out of the drawer, so the cash a sale's active post-0260 returns paid out (total_refund_usd - owed_reduction_usd) can never be
-- more than the sale took in (amount_paid_usd + amount_paid_khr / exchange_rate). A returns row from before 0260
-- (refund_currency NULL) is left out: it reads as all debt or all cash depending on the sale (returnDebtLoweredSql).
-- Context, not alarms: returns_checked, sales_checked.
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero v1_refund_equation,v1_refund_khr_twin,v1_refund_khr_paid,riel_only_customer_returns,returns_on_missing_sale,sales_refunded_over_total,debt_lowered_over_total,return_tag_without_evidence,return_evidence_without_tag,cash_out_over_paid
-- Ceiling rule (pinned by test-ops-query-budget-native.cjs): at least 3 x the rows the production-sized seed reads in a day (the larger of plain and
-- ANALYZE), never under 2,000, never over the plan's 20,000 for one Tier A file. A busy trading day or the day after a large import must not
-- fail the run with read-ceiling-exceeded; a plan that flips to a table scan (36k to 540k rows on these tables) still does.
-- Seed day 69 rows (the seed holds 9 returns): 3 x would be 207, too tight for a day with a return import, so the floor of 2,000.
-- ops:max-rows-read 2000
WITH win AS MATERIALIZED (
  SELECT datetime(date('now', '+7 hours', '-1 day'), '-7 hours') AS cut
),
rt AS MATERIALIZED (
  SELECT id, sale_id, COALESCE(return_scope, 'customer') AS scope, COALESCE(NULLIF(status, ''), 'completed') AS st,
    COALESCE(money_precision_version, 0) AS mpv, COALESCE(total_refund_usd, 0) AS usd, COALESCE(total_refund_khr, 0) AS khr,
    calculated_refund_usd AS calc, COALESCE(rounding_adjustment_usd, 0) AS adj, exchange_rate AS rate,
    refund_currency AS cur, COALESCE(owed_reduction_usd, 0) AS owed
  FROM returns INDEXED BY idx_returns_created_pg
  WHERE created_at >= (SELECT cut FROM win)
),
rsale AS MATERIALIZED (
  SELECT DISTINCT sale_id AS sid FROM rt WHERE scope = 'customer' AND sale_id IS NOT NULL
),
act AS MATERIALIZED (
  SELECT r.sale_id AS sid,
    SUM(CASE WHEN COALESCE(r.money_precision_version, 0) = 1 THEN COALESCE(r.total_refund_usd, 0) ELSE 0 END) AS v1_refunded,
    SUM(CASE WHEN r.refund_currency IS NULL THEN COALESCE(r.total_refund_usd, 0) ELSE 0 END) AS value_before_0260,
    SUM(CASE WHEN r.refund_currency IS NULL THEN 0 ELSE COALESCE(r.owed_reduction_usd, 0) END) AS lowered_0260,
    SUM(CASE WHEN r.refund_currency IS NULL THEN 0 ELSE COALESCE(r.total_refund_usd, 0) - COALESCE(r.owed_reduction_usd, 0) END) AS cash_out
  FROM rsale d CROSS JOIN returns r INDEXED BY idx_returns_sale_id ON r.sale_id = d.sid
  WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND COALESCE(NULLIF(r.status, ''), 'completed') <> 'cancelled'
  GROUP BY r.sale_id
),
sl AS MATERIALIZED (
  SELECT s.id AS id, s.sale_status AS sale_status, COALESCE(s.total_usd, 0) AS total,
    COALESCE(s.amount_paid_usd, 0) AS paid_usd, COALESCE(s.amount_paid_khr, 0) AS paid_khr, s.exchange_rate AS rate,
    CASE WHEN s.sale_status = 'awaiting_payment' OR (s.sale_status IN ('partial_return', 'returned') AND s.status_before_return = 'awaiting_payment') THEN 1 ELSE 0 END AS not_paid,
    CASE s.sale_status WHEN 'returned' THEN 'full' WHEN 'partial_return' THEN 'partial' ELSE s.return_state END AS tag,
    EXISTS (SELECT 1 FROM sale_items i INDEXED BY idx_sale_items_sale_id_pg WHERE i.sale_id = s.id AND COALESCE(i.returned_quantity, 0) > 0) AS imp
  FROM rsale d CROSS JOIN sales s ON s.id = d.sid
)
SELECT
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer') AS returns_checked,
  (SELECT COUNT(*) FROM sl) AS sales_checked,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND (calc IS NULL OR ABS(usd - calc - adj) > 0.00005
     OR ABS(adj) >= 0.01 OR ABS(usd * 100 - ROUND(usd * 100)) > 0.00005)) AS v1_refund_equation,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND cur IS NOT 'KHR' AND rate > 0
     AND ABS(khr - usd * rate) > 0.00005) AS v1_refund_khr_twin,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND cur = 'KHR' AND rate > 0
     AND (khr > usd * rate + 0.00005 OR khr <= usd * rate - 100)) AS v1_refund_khr_paid,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND usd = 0 AND khr <> 0) AS riel_only_customer_returns,
  (SELECT COUNT(*) FROM rt r WHERE r.scope = 'customer' AND r.sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = r.sale_id)) AS returns_on_missing_sale,
  (SELECT COUNT(*) FROM act a JOIN sl ON sl.id = a.sid WHERE a.v1_refunded > sl.total + 0.005) AS sales_refunded_over_total,
  (SELECT COUNT(*) FROM act a JOIN sl ON sl.id = a.sid
     WHERE a.lowered_0260 + CASE WHEN sl.not_paid = 1 THEN a.value_before_0260 ELSE 0 END > sl.total + 0.005) AS debt_lowered_over_total,
  (SELECT COUNT(*) FROM sl LEFT JOIN act a ON a.sid = sl.id
     WHERE sl.sale_status IS NOT 'cancelled' AND sl.tag IS NOT NULL AND a.sid IS NULL AND sl.imp = 0) AS return_tag_without_evidence,
  (SELECT COUNT(*) FROM sl LEFT JOIN act a ON a.sid = sl.id
     WHERE sl.sale_status IS NOT 'cancelled' AND sl.tag IS NULL AND (a.sid IS NOT NULL OR sl.imp = 1)) AS return_evidence_without_tag,
  (SELECT COUNT(*) FROM act a JOIN sl ON sl.id = a.sid
     WHERE sl.rate > 0 AND a.cash_out > sl.paid_usd + sl.paid_khr / sl.rate + 0.005) AS cash_out_over_paid
