-- report-late-payments-summary: report-late-payments by Cambodia month the money was taken, plus one 'ALL' row.
-- Same event set and the same CTE text as report-late-payments (test-report-late-payments-native.cjs pins the parity); read
-- that file's header for the definitions. Per month: events, distinct sales, how many carry each flag (an event can carry
-- several), settle / correction / undo-redo split, and the net delta of amount_paid (undo rows are negative, redo positive).
-- Counts and totals only.
-- ops:min-rows 1
-- ops:max-rows 60
-- ops:max-rows-read 200000
WITH sh AS MATERIALIZED (
  SELECT id, user_id, branch_id, scope_mode,
    COALESCE(datetime(opened_at), opened_at) AS o,
    COALESCE(datetime(COALESCE(closed_at, cancelled_at)), COALESCE(closed_at, cancelled_at), '9999-12-31 00:00:00') AS c
  FROM shift_sessions
),
ev AS MATERIALIZED (
  SELECT e.id AS event_id, e.sale_id, e.kind, e.via, e.generation, e.actor_id, e.actor_username, e.occurred_at,
    (SELECT json_extract(j.value, '$.before.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'amount_paid_usd') AS usd_before,
    (SELECT json_extract(j.value, '$.after.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'amount_paid_usd') AS usd_after,
    (SELECT json_extract(j.value, '$.before.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'amount_paid_khr') AS khr_before,
    (SELECT json_extract(j.value, '$.after.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'amount_paid_khr') AS khr_after,
    (SELECT json_extract(j.value, '$.before.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'payment_details') AS det_before,
    (SELECT json_extract(j.value, '$.after.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'payment_details') AS det_after,
    (SELECT json_extract(j.value, '$.after.value') FROM json_each(e.changes_json) j WHERE json_extract(j.value, '$.field') = 'payment_method') AS method_after
  FROM sale_record_events e
  WHERE e.source_kind = 'sale_settlement' AND e.kind IN ('payment_settled', 'payment_changed') AND e.via IN ('apply', 'undo', 'redo')
    AND EXISTS (SELECT 1 FROM json_each(e.changes_json) m WHERE json_extract(m.value, '$.field') IN ('amount_paid_usd', 'amount_paid_khr', 'payment_details', 'payment_method'))
),
x AS MATERIALIZED (
  SELECT ev.*, s.receipt_number, s.branch_id, s.cashier_id AS sale_cashier_id, s.sale_status, s.created_at AS sale_created_at,
    COALESCE(datetime(s.created_at), s.created_at) AS sale_at, COALESCE(datetime(ev.occurred_at), ev.occurred_at) AS taken_at
  FROM ev JOIN sales s ON s.id = ev.sale_id
  WHERE s.payments_version = 0
),
y AS MATERIALIZED (
  SELECT x.*,
    (SELECT MAX(sh.id) FROM sh WHERE x.sale_at >= sh.o AND x.sale_at < sh.c
      AND (sh.branch_id IS NULL OR x.branch_id IS NULL OR sh.branch_id = x.branch_id)
      AND (sh.scope_mode = 'shop_wide' OR sh.user_id IS x.sale_cashier_id)) AS sale_shift_id,
    (SELECT MAX(sh.id) FROM sh WHERE x.taken_at >= sh.o AND x.taken_at < sh.c
      AND (sh.branch_id IS NULL OR x.branch_id IS NULL OR sh.branch_id = x.branch_id)
      AND (sh.scope_mode = 'shop_wide' OR sh.user_id IS x.actor_id)) AS taking_shift_id
  FROM x
),
z AS MATERIALIZED (
  SELECT y.*,
    strftime('%Y-%m-%d', y.sale_at, '+7 hours') AS sale_business_date,
    strftime('%Y-%m-%d', y.taken_at, '+7 hours') AS taken_business_date,
    ROUND(COALESCE(y.usd_after, 0) - COALESCE(y.usd_before, 0), 4) AS delta_usd,
    ROUND(COALESCE(y.khr_after, 0) - COALESCE(y.khr_before, 0), 2) AS delta_khr,
    (y.taking_shift_id IS NULL AND y.sale_shift_id IS NOT NULL) AS f_no_shift_at_time,
    (strftime('%Y-%m-%d', y.sale_at, '+7 hours') IS NOT strftime('%Y-%m-%d', y.taken_at, '+7 hours')) AS f_different_day,
    (y.taking_shift_id IS NOT NULL AND y.sale_shift_id IS NOT y.taking_shift_id) AS f_different_shift,
    (y.sale_cashier_id IS NOT y.actor_id AND 'per_account' IN (COALESCE((SELECT sh.scope_mode FROM sh WHERE sh.id = y.sale_shift_id), ''), COALESCE((SELECT sh.scope_mode FROM sh WHERE sh.id = y.taking_shift_id), ''))) AS f_different_cashier
  FROM y
),
w AS MATERIALIZED (
  SELECT z.*,
    CASE WHEN f_no_shift_at_time THEN 'no_shift_at_time' WHEN f_different_day THEN 'different_day'
      WHEN f_different_shift THEN 'different_shift' ELSE 'different_cashier' END AS flag_kind
  FROM z WHERE f_no_shift_at_time OR f_different_day OR f_different_shift OR f_different_cashier
)
SELECT m.taken_month, m.events, m.sales, m.different_day, m.different_shift, m.different_cashier, m.no_shift_at_time,
  m.settles, m.corrections, m.undo_redo, m.net_usd, m.net_khr
FROM (
  SELECT substr(w.taken_business_date, 1, 7) AS taken_month, COUNT(*) AS events, COUNT(DISTINCT w.sale_id) AS sales,
    SUM(w.f_different_day) AS different_day, SUM(w.f_different_shift) AS different_shift,
    SUM(w.f_different_cashier) AS different_cashier, SUM(w.f_no_shift_at_time) AS no_shift_at_time,
    SUM(w.via = 'apply' AND w.kind = 'payment_settled') AS settles, SUM(w.via = 'apply' AND w.kind = 'payment_changed') AS corrections,
    SUM(w.via <> 'apply') AS undo_redo, ROUND(SUM(w.delta_usd), 4) AS net_usd, ROUND(SUM(w.delta_khr), 2) AS net_khr
  FROM w GROUP BY substr(w.taken_business_date, 1, 7)
  UNION ALL
  SELECT 'ALL', COUNT(*), COUNT(DISTINCT w.sale_id), COALESCE(SUM(w.f_different_day), 0), COALESCE(SUM(w.f_different_shift), 0),
    COALESCE(SUM(w.f_different_cashier), 0), COALESCE(SUM(w.f_no_shift_at_time), 0),
    COALESCE(SUM(w.via = 'apply' AND w.kind = 'payment_settled'), 0), COALESCE(SUM(w.via = 'apply' AND w.kind = 'payment_changed'), 0),
    COALESCE(SUM(w.via <> 'apply'), 0), COALESCE(ROUND(SUM(w.delta_usd), 4), 0), COALESCE(ROUND(SUM(w.delta_khr), 2), 0)
  FROM w
) m
ORDER BY (m.taken_month = 'ALL'), m.taken_month
