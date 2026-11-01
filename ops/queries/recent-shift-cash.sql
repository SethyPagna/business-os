-- recent-shift-cash: Tier A "recent" check of the drawer: its inputs and the three-line shift cash it stored (RELIABILITY-PLAN 5.2, P0.6).
-- Shifts are the ones whose business_date is in the last 7 days (idx_shift_sessions_business_date). A shift left open longer is
-- read by open_shifts_before_today alone (idx_shift_sessions_open) and then trips that alarm. Window of events: see recent-stock-ledgers.
-- Coverage, the inputs of lib/shiftReconciliation.ts (as in health-shift-coverage): a sale, a customer return, an expense with a
-- creator, or a drawer payment event (sale_payment_events.drawer_effect = 1, received in the window) that falls inside no shift of
-- its branch and cashier. The payment event line is owner rule 21 Oct: a later payment counts in the shift that took it.
--   sales_outside_shift, returns_outside_shift, fees_outside_shift, payment_events_outside_shift
--   open_shifts_before_today, closed_before_opened
-- Stored close (shift_close_figures.figures_json, formula 2 and later): the three-line arithmetic the close wrote must hold,
-- per currency, as computeShiftReconciliation does it: expected = opening + additional cash + cash sales - refunds - expenses -
-- courier (dollars to the cent, riel whole) and difference = counted - expected. A line stored off by 100 riel breaks it.
--   close_expected_ne_parts_usd, close_expected_ne_parts_khr, close_difference_ne_counted_usd, close_difference_ne_counted_khr
-- Context, not alarms: shifts_checked, closes_checked, events_checked, info_closed_without_count (two old closes carry none).
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero sales_outside_shift,returns_outside_shift,fees_outside_shift,payment_events_outside_shift,open_shifts_before_today,closed_before_opened,close_expected_ne_parts_usd,close_expected_ne_parts_khr,close_difference_ne_counted_usd,close_difference_ne_counted_khr
-- Ceiling rule (pinned by test-ops-query-budget-native.cjs): at least 3 x the rows the production-sized seed reads in a day (the larger of plain and
-- ANALYZE), never under 2,000, never over the plan's 20,000 for one Tier A file. A busy trading day or the day after a large import must not
-- fail the run with read-ceiling-exceeded; a plan that flips to a table scan (36k to 540k rows on these tables) still does.
-- Seed day 5,933 rows (4,260 of them one seed artefact: 4,240 old-system expenses stamped with a migration time that is inside the
-- window on a seed built today), so 17,799; 19,000 leaves the measurement room to drift.
-- ops:max-rows-read 19000
WITH win AS MATERIALIZED (
  SELECT datetime(date('now', '+7 hours', '-1 day'), '-7 hours') AS cut, date('now', '+7 hours', '-7 days') AS bd
),
sh AS MATERIALIZED (
  SELECT s.id AS id, s.user_id AS user_id, s.branch_id AS branch_id, s.scope_mode AS scope_mode, s.business_date AS business_date,
    COALESCE(datetime(s.opened_at), s.opened_at) AS o,
    COALESCE(datetime(COALESCE(s.closed_at, s.cancelled_at)), COALESCE(s.closed_at, s.cancelled_at), '9999-12-31 00:00:00') AS c,
    s.closed_at AS closed_at, s.cancelled_at AS cancelled_at, s.opened_at AS opened_at,
    s.closing_counted_usd AS counted_usd, s.closing_counted_khr AS counted_khr
  FROM shift_sessions s INDEXED BY idx_shift_sessions_business_date
  WHERE s.business_date >= (SELECT bd FROM win)
),
ev AS MATERIALIZED (
  SELECT 'sale' AS kind, id, cashier_id AS actor, branch_id, COALESCE(datetime(created_at), created_at) AS at
    FROM sales INDEXED BY idx_sales_created_pg
    WHERE created_at >= (SELECT cut FROM win) AND COALESCE(legacy_receipt_number, '') = ''
      AND COALESCE(CASE WHEN json_valid(creation_snapshot_json) THEN json_extract(creation_snapshot_json, '$.origin') END, 'pos') NOT IN ('sales_import', 'stock_action_import')
  UNION ALL
  SELECT 'return', id, cashier_id, branch_id, COALESCE(datetime(created_at), created_at)
    FROM returns INDEXED BY idx_returns_created_pg
    WHERE created_at >= (SELECT cut FROM win) AND COALESCE(return_scope, 'customer') = 'customer'
  UNION ALL
  SELECT 'fee', id, created_by, branch_id, COALESCE(datetime(created_at), created_at)
    FROM fees INDEXED BY idx_fees_created_dt
    WHERE datetime(created_at) >= (SELECT cut FROM win) AND created_by IS NOT NULL
  UNION ALL
  SELECT 'event', id, cashier_id, branch_id, COALESCE(datetime(received_at), received_at)
    FROM sale_payment_events INDEXED BY idx_sale_payment_events_received
    WHERE received_at >= (SELECT cut FROM win) AND drawer_effect = 1
),
miss AS MATERIALIZED (
  SELECT e.kind AS kind FROM ev e WHERE NOT EXISTS (
    SELECT 1 FROM sh WHERE e.at >= sh.o AND e.at < sh.c
      AND (sh.branch_id IS NULL OR e.branch_id IS NULL OR e.branch_id = sh.branch_id)
      AND (sh.scope_mode = 'shop_wide' OR e.actor IS sh.user_id))
),
fg AS MATERIALIZED (
  SELECT f.shift_session_id AS id, f.figures_json AS j, sh.counted_usd AS counted_usd, sh.counted_khr AS counted_khr
  FROM sh CROSS JOIN shift_close_figures f ON f.shift_session_id = sh.id
  WHERE COALESCE(json_extract(f.figures_json, '$.formula'), 1) >= 2
),
fx AS MATERIALIZED (
  SELECT id,
    json_extract(j, '$.reconciliation.opening.usd') AS o_usd, json_extract(j, '$.reconciliation.opening.khr') AS o_khr,
    COALESCE(json_extract(j, '$.reconciliation.additional_cash.usd'), 0) AS a_usd, COALESCE(json_extract(j, '$.reconciliation.additional_cash.khr'), 0) AS a_khr,
    COALESCE(json_extract(j, '$.reconciliation.cash_sales.usd'), 0) AS c_usd, COALESCE(json_extract(j, '$.reconciliation.cash_sales.khr'), 0) AS c_khr,
    COALESCE(json_extract(j, '$.reconciliation.refunds.usd'), 0) AS r_usd, COALESCE(json_extract(j, '$.reconciliation.refunds.khr'), 0) AS r_khr,
    COALESCE(json_extract(j, '$.reconciliation.expenses.usd'), 0) AS x_usd, COALESCE(json_extract(j, '$.reconciliation.expenses.khr'), 0) AS x_khr,
    COALESCE(json_extract(j, '$.reconciliation.courier.usd'), 0) AS k_usd, COALESCE(json_extract(j, '$.reconciliation.courier.khr'), 0) AS k_khr,
    json_extract(j, '$.reconciliation.expected.usd') AS e_usd, json_extract(j, '$.reconciliation.expected.khr') AS e_khr,
    json_extract(j, '$.reconciliation.counted.usd') AS n_usd, json_extract(j, '$.reconciliation.counted.khr') AS n_khr,
    json_extract(j, '$.reconciliation.difference.usd') AS d_usd, json_extract(j, '$.reconciliation.difference.khr') AS d_khr
  FROM fg
)
SELECT
  (SELECT COUNT(*) FROM sh) AS shifts_checked,
  f.closes_checked,
  (SELECT COUNT(*) FROM ev) AS events_checked,
  m.sales_outside_shift, m.returns_outside_shift, m.fees_outside_shift, m.payment_events_outside_shift,
  (SELECT COUNT(*) FROM shift_sessions INDEXED BY idx_shift_sessions_open WHERE closed_at IS NULL AND cancelled_at IS NULL
     AND business_date < date('now', '+7 hours')) AS open_shifts_before_today,
  (SELECT COUNT(*) FROM sh WHERE closed_at IS NOT NULL
     AND COALESCE(strftime('%s', closed_at), 0) < COALESCE(strftime('%s', opened_at), 0)) AS closed_before_opened,
  f.close_expected_ne_parts_usd, f.close_expected_ne_parts_khr, f.close_difference_ne_counted_usd, f.close_difference_ne_counted_khr,
  (SELECT COUNT(*) FROM sh WHERE closed_at IS NOT NULL AND counted_usd IS NULL AND counted_khr IS NULL) AS info_closed_without_count
FROM (
  SELECT COALESCE(SUM(kind = 'sale'), 0) AS sales_outside_shift, COALESCE(SUM(kind = 'return'), 0) AS returns_outside_shift,
    COALESCE(SUM(kind = 'fee'), 0) AS fees_outside_shift, COALESCE(SUM(kind = 'event'), 0) AS payment_events_outside_shift
  FROM miss
) m,
(
  SELECT COUNT(*) AS closes_checked,
    COALESCE(SUM(o_usd IS NOT NULL AND e_usd IS NOT NULL AND ABS(e_usd - (o_usd + a_usd + c_usd - r_usd - x_usd - k_usd)) > 0.0051), 0) AS close_expected_ne_parts_usd,
    COALESCE(SUM(o_khr IS NOT NULL AND e_khr IS NOT NULL AND ABS(e_khr - (o_khr + a_khr + c_khr - r_khr - x_khr - k_khr)) > 0.51), 0) AS close_expected_ne_parts_khr,
    COALESCE(SUM(n_usd IS NOT NULL AND e_usd IS NOT NULL AND d_usd IS NOT NULL AND ABS(d_usd - (n_usd - e_usd)) > 0.0051), 0) AS close_difference_ne_counted_usd,
    COALESCE(SUM(n_khr IS NOT NULL AND e_khr IS NOT NULL AND d_khr IS NOT NULL AND ABS(d_khr - (n_khr - e_khr)) > 0.51), 0) AS close_difference_ne_counted_khr
  FROM fx
) f
