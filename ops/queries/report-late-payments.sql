-- report-late-payments: the owner's list of past later payments that were counted in the wrong shift, day or cashier.
-- Owner ruling 10 Nov 2026: past payments are NOT moved; this is the read-only list (Records/Design/2026-11-10/LATER-PAYMENT-SHIFT-PLAN.md).
-- Cause: a settle / payment correction / settlement undo or redo rewrote the sale row's tender, which the shift and daily
-- readers date by sales.created_at and credit to sales.cashier_id, not to the moment and the person that took the money.
-- One row per settlement record event (sale_record_events: source_kind 'sale_settlement', kind payment_settled or
-- payment_changed, via apply, undo or redo) on a payments_version 0 sale whose taking differs from the sale in at least one way.
--   amounts       delta_usd / delta_khr = amount_paid after minus before, read from the event's changes_json (negative on an
--                 undo; a correction can be 0 while the method moved). paid_*_before / _after are the two tenders. Change
--                 given back is not netted. The columns are the sale's amount_paid_usd / amount_paid_khr.
--   methods       methods_added / methods_removed = payment_details methods present only after / only before; when the
--                 details did not change, methods_added falls back to the payment_method written.
--   dates         Cambodia business dates (UTC+7) of sales.created_at and of the event's occurred_at.
--   shifts        sale_shift_id = the shift whose window held sales.created_at, taking_shift_id = the shift whose window held
--                 occurred_at, both on the sale's branch and (per_account) for the sale's cashier / the acting user. A window
--                 is [opened_at, closed_at or cancelled_at or open-ended), as health-shift-coverage reads it. NULL = none.
--   flags         flag_kind is the first that applies: no_shift_at_time (the taker had no shift while the sale had one),
--                 different_day, different_shift, different_cashier. The f_* columns show every one that applies.
-- Records exist only since migration 0140 (never backfilled); bulk payment relabels (sale_bulk_update) are not settlements.
-- Staff ids and usernames only; no customer data, no phone numbers. Capped by LIMIT 5001 against max-rows 5000.
-- ops:min-rows 0
-- ops:max-rows 5000
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
    (y.sale_cashier_id IS NOT y.actor_id) AS f_different_cashier
  FROM y
),
w AS MATERIALIZED (
  SELECT z.*,
    CASE WHEN f_no_shift_at_time THEN 'no_shift_at_time' WHEN f_different_day THEN 'different_day'
      WHEN f_different_shift THEN 'different_shift' ELSE 'different_cashier' END AS flag_kind
  FROM z WHERE f_no_shift_at_time OR f_different_day OR f_different_shift OR f_different_cashier
)
SELECT w.event_id, w.sale_id, w.receipt_number AS receipt_no, w.branch_id,
  (SELECT b.name FROM branches b WHERE b.id = w.branch_id) AS branch_label, w.sale_status,
  w.sale_created_at, w.sale_business_date, w.occurred_at AS taken_at, w.taken_business_date,
  w.kind, w.via, w.generation, (w.kind = 'payment_changed') AS is_correction,
  w.delta_usd, w.delta_khr, w.usd_before AS paid_usd_before, w.usd_after AS paid_usd_after,
  w.khr_before AS paid_khr_before, w.khr_after AS paid_khr_after,
  COALESCE((SELECT group_concat(DISTINCT json_extract(a.value, '$.method')) FROM json_each(w.det_after) a
    WHERE json_extract(a.value, '$.method') NOT IN (SELECT json_extract(b.value, '$.method') FROM json_each(COALESCE(w.det_before, '[]')) b)), w.method_after) AS methods_added,
  (SELECT group_concat(DISTINCT json_extract(b.value, '$.method')) FROM json_each(w.det_before) b
    WHERE json_extract(b.value, '$.method') NOT IN (SELECT json_extract(a.value, '$.method') FROM json_each(COALESCE(w.det_after, '[]')) a)) AS methods_removed,
  w.sale_shift_id, w.taking_shift_id, w.sale_cashier_id, w.actor_id AS taking_actor_id, w.actor_username AS taking_actor_username,
  w.flag_kind, w.f_no_shift_at_time, w.f_different_day, w.f_different_shift, w.f_different_cashier
FROM w
ORDER BY w.occurred_at, w.event_id
LIMIT 5001
