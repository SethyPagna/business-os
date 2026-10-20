-- NOT-PAID-CONVERSION CENSUS (lane 6.0.891, plan slice S0). SELECT-only.
--
-- Owner 20 Oct 2026: "change past not paid as paid this is wrong" -- find every
-- past sale that was Not Paid and now reads paid, before the held 0264 moves
-- any status. This file only produces CANDIDATES (a superset, float math);
-- not-paid-conversion-census.mjs judges them with the exact half-cent rule
-- (recordedSaleOutstandingUsd) and prints the control-set counts.
--
-- Run locally: node ops/scripts/census/not-paid-conversion-census.mjs --db <local restore.sqlite>
-- Remote reads (owner-gated, NOT run by this lane) must pass each "-- @query"
-- block below through `wrangler d1 execute ... --command "<one block>"`,
-- never --file (a file run returns no rows and a census built on it observes
-- nothing).
--
-- Blocks are separated by "-- @query <NAME>" lines; the runner executes each
-- one on its own. No block writes; the runner refuses anything that is not
-- SELECT/WITH and opens SQLite read-only.
--
-- "Reads paid today" = the payment class reporting gives the row today:
--   status word   = COALESCE(NULLIF(sale_status,''),'completed')
--   payment class = status_before_return for partial_return/returned (the
--                   notPaidSaleSql / reportingSaleStatusExpr reading), else the status word
--   reads paid    = class NOT IN ('awaiting_payment','cancelled')
-- "Born Not Paid" evidence (any one): the creation snapshot says
-- awaiting_payment; a Sales Records event moved the status away from
-- awaiting_payment; a status-update audit row has oldStatus awaiting_payment.

-- @query CONTROL
-- Row counts of every set the buckets join, so a broken join shows as a count that
-- disagrees with its direct twin (the runner compares the pairs).
SELECT
  (SELECT COUNT(*) FROM sales) AS sales_total,
  (SELECT COUNT(*) FROM sales WHERE json_extract(creation_snapshot_json,'$.sale_status') = 'awaiting_payment') AS sales_snapshot_not_paid,
  (SELECT COUNT(*) FROM returns) AS returns_total,
  (SELECT COUNT(*) FROM sales WHERE source_return_id IS NOT NULL) AS replacement_sales_direct,
  (SELECT COUNT(*) FROM sales rs JOIN returns rt ON rt.id = rs.source_return_id JOIN sales os ON os.id = rt.sale_id) AS replacement_sales_joined,
  (SELECT COUNT(*) FROM customer_receivables) AS ar_rows,
  (SELECT COUNT(*) FROM customer_receivables cr JOIN sales s
     ON s.legacy_receipt_number = cr.invoice_no || '@' || substr(cr.invoice_date, 1, 10)) AS ar_rows_with_sale_composite,
  (SELECT COUNT(*) FROM customer_receivables cr WHERE cr.outstanding_balance_usd > 0.004) AS ar_rows_owed,
  (SELECT COUNT(*) FROM customer_receivables cr JOIN sales s
     ON s.legacy_receipt_number = cr.invoice_no || '@' || substr(cr.invoice_date, 1, 10)
     WHERE cr.outstanding_balance_usd > 0.004) AS ar_rows_owed_with_sale,
  (SELECT COUNT(*) FROM audit_logs WHERE action = 'repair' AND entity = 'data-integrity') AS integrity_repairs;

-- @query C1
-- Leftover return statuses (and awaiting_delivery): the group "returned/partial with NULL
-- status_before_return and born Not Paid" is the integrity-repair and pre-0125 casualty set --
-- the payment state is gone, the row reads paid.
SELECT s.sale_status, s.status_before_return,
  COALESCE(json_extract(s.creation_snapshot_json,'$.origin'), '') AS origin,
  COALESCE(json_extract(s.creation_snapshot_json,'$.sale_status'), '') AS snapshot_status,
  COUNT(*) AS n, ROUND(SUM(s.total_usd), 4) AS total_usd
FROM sales s
WHERE s.sale_status IN ('partial_return', 'returned', 'awaiting_delivery')
GROUP BY 1, 2, 3, 4
ORDER BY n DESC;

-- @query C1B
-- Cancelled sales whose status_before_cancel is a retired status (un-cancel would restore it).
SELECT s.status_before_cancel, s.status_before_return, COUNT(*) AS n, ROUND(SUM(s.total_usd), 4) AS total_usd
FROM sales s
WHERE s.sale_status = 'cancelled' AND s.status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery')
GROUP BY 1, 2
ORDER BY n DESC;

-- @query C2
-- Born Not Paid, reads paid today, tender short before the returns. Superset: the Node judge
-- applies the exact rule with and without the debt lowered by returns.
WITH s0 AS MATERIALIZED (
  SELECT s.id, s.receipt_number, s.sale_status, s.status_before_return, s.total_usd, s.amount_paid_usd, s.amount_paid_khr,
    s.exchange_rate, s.money_precision_version, s.calculated_total_usd, s.creation_snapshot_json,
    CASE WHEN COALESCE(NULLIF(s.sale_status,''),'completed') IN ('partial_return','returned')
      THEN COALESCE(NULLIF(s.status_before_return,''),'completed')
      ELSE COALESCE(NULLIF(s.sale_status,''),'completed') END AS pay_class
  FROM sales s
),
short AS MATERIALIZED (
  SELECT * FROM s0
  WHERE pay_class NOT IN ('awaiting_payment', 'cancelled')
    AND total_usd - COALESCE(amount_paid_usd, 0)
      - CASE WHEN COALESCE(amount_paid_khr, 0) = 0 THEN 0 ELSE COALESCE(amount_paid_khr / NULLIF(exchange_rate, 0), 0) END > 0.004
),
r AS (
  SELECT sale_id,
    SUM(CASE WHEN refund_currency IS NULL THEN total_refund_usd ELSE owed_reduction_usd END) AS lowered_usd,
    SUM(total_refund_usd) AS refunded_usd
  FROM returns
  WHERE COALESCE(status,'completed') <> 'cancelled' AND COALESCE(return_scope,'customer') = 'customer'
  GROUP BY sale_id
)
SELECT k.id, k.receipt_number, k.sale_status, k.status_before_return, k.pay_class, k.total_usd, k.amount_paid_usd, k.amount_paid_khr,
  k.exchange_rate, k.money_precision_version, k.calculated_total_usd,
  COALESCE(r.lowered_usd, 0) AS lowered_usd, COALESCE(r.refunded_usd, 0) AS refunded_usd,
  CASE WHEN json_extract(k.creation_snapshot_json,'$.sale_status') = 'awaiting_payment' THEN 1 ELSE 0 END AS ev_snapshot,
  EXISTS(SELECT 1 FROM sale_record_events e, json_each(e.changes_json) c WHERE e.sale_id = k.id
    AND json_extract(c.value,'$.field') = 'sale_status' AND json_extract(c.value,'$.before.value') = 'awaiting_payment') AS ev_event,
  EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity = 'sale' AND a.entity_id = CAST(k.id AS TEXT) AND a.action = 'update'
    AND json_extract(a.details,'$.oldStatus') = 'awaiting_payment') AS ev_audit
FROM short k
LEFT JOIN r ON r.sale_id = k.id
WHERE json_extract(k.creation_snapshot_json,'$.sale_status') = 'awaiting_payment'
  OR EXISTS(SELECT 1 FROM sale_record_events e, json_each(e.changes_json) c WHERE e.sale_id = k.id
    AND json_extract(c.value,'$.field') = 'sale_status' AND json_extract(c.value,'$.before.value') = 'awaiting_payment')
  OR EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity = 'sale' AND a.entity_id = CAST(k.id AS TEXT) AND a.action = 'update'
    AND json_extract(a.details,'$.oldStatus') = 'awaiting_payment')
ORDER BY k.id;

-- @query C3
-- Replacement sales off an original that was Not Paid. The judge keeps the ones whose original
-- still reads Not Paid, or was born Not Paid and is short, and whose replacement carries tender
-- or a paid status (a Not Paid original may only have a Not Paid, zero-tender replacement).
SELECT rs.id AS replacement_id, rs.receipt_number AS replacement_receipt, rs.sale_status AS replacement_status,
  rs.payment_method, rs.amount_paid_usd AS replacement_paid_usd, rs.amount_paid_khr AS replacement_paid_khr, rs.total_usd AS replacement_total_usd,
  rt.id AS return_id, os.id AS original_id, os.receipt_number AS original_receipt, os.sale_status AS original_status,
  os.status_before_return AS original_before_return, os.total_usd AS original_total_usd, os.amount_paid_usd AS original_paid_usd,
  os.amount_paid_khr AS original_paid_khr, os.exchange_rate AS original_rate, os.money_precision_version AS original_mpv,
  os.calculated_total_usd AS original_calc_total,
  CASE WHEN COALESCE(NULLIF(os.sale_status,''),'completed') IN ('partial_return','returned')
    THEN COALESCE(NULLIF(os.status_before_return,''),'completed') ELSE COALESCE(NULLIF(os.sale_status,''),'completed') END AS original_pay_class,
  CASE WHEN (json_extract(os.creation_snapshot_json,'$.sale_status') = 'awaiting_payment'
    OR EXISTS(SELECT 1 FROM sale_record_events e, json_each(e.changes_json) c WHERE e.sale_id = os.id
      AND json_extract(c.value,'$.field') = 'sale_status' AND json_extract(c.value,'$.before.value') = 'awaiting_payment')
    OR EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity = 'sale' AND a.entity_id = CAST(os.id AS TEXT) AND a.action = 'update'
      AND json_extract(a.details,'$.oldStatus') = 'awaiting_payment')) THEN 1 ELSE 0 END AS original_born_not_paid,
  COALESCE((SELECT SUM(CASE WHEN x.refund_currency IS NULL THEN x.total_refund_usd ELSE x.owed_reduction_usd END) FROM returns x
    WHERE x.sale_id = os.id AND COALESCE(x.status,'completed') <> 'cancelled' AND COALESCE(x.return_scope,'customer') = 'customer'), 0) AS original_lowered_usd
FROM sales rs
JOIN returns rt ON rt.id = rs.source_return_id
JOIN sales os ON os.id = rt.sale_id
WHERE os.sale_status = 'awaiting_payment' OR os.status_before_return = 'awaiting_payment'
  OR (json_extract(os.creation_snapshot_json,'$.sale_status') = 'awaiting_payment'
    OR EXISTS(SELECT 1 FROM sale_record_events e, json_each(e.changes_json) c WHERE e.sale_id = os.id
      AND json_extract(c.value,'$.field') = 'sale_status' AND json_extract(c.value,'$.before.value') = 'awaiting_payment')
    OR EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity = 'sale' AND a.entity_id = CAST(os.id AS TEXT) AND a.action = 'update'
      AND json_extract(a.details,'$.oldStatus') = 'awaiting_payment'))
ORDER BY rs.id;

-- @query C4
-- The 884 flip (negative control; expected 0): a return that lowered a debt AND paid cash
-- beyond it, on a sale that reads paid now.
SELECT rt.id AS return_id, rt.sale_id, rt.total_refund_usd, rt.owed_reduction_usd, rt.refund_currency, s.sale_status, s.status_before_return
FROM returns rt JOIN sales s ON s.id = rt.sale_id
WHERE rt.refund_currency IS NOT NULL AND rt.owed_reduction_usd > 0 AND rt.total_refund_usd > rt.owed_reduction_usd
  AND (CASE WHEN COALESCE(NULLIF(s.sale_status,''),'completed') IN ('partial_return','returned')
        THEN COALESCE(NULLIF(s.status_before_return,''),'completed') ELSE COALESCE(NULLIF(s.sale_status,''),'completed') END) NOT IN ('awaiting_payment','cancelled')
ORDER BY rt.id;

-- @query C5
-- Legacy receivable still owed, sale reads paid. Composite key invoice_no@date (a bare invoice
-- number repeats across days).
SELECT cr.id AS receivable_id, cr.invoice_no, substr(cr.invoice_date, 1, 10) AS invoice_date, cr.customer_name,
  cr.total_amount_usd, cr.amount_paid_usd AS receivable_paid_usd, cr.outstanding_balance_usd,
  s.id AS sale_id, s.receipt_number, s.sale_status, s.status_before_return, s.total_usd, s.amount_paid_usd AS sale_paid_usd
FROM customer_receivables cr
JOIN sales s ON s.legacy_receipt_number = cr.invoice_no || '@' || substr(cr.invoice_date, 1, 10)
WHERE cr.outstanding_balance_usd > 0.004
  AND (CASE WHEN COALESCE(NULLIF(s.sale_status,''),'completed') IN ('partial_return','returned')
        THEN COALESCE(NULLIF(s.status_before_return,''),'completed') ELSE COALESCE(NULLIF(s.sale_status,''),'completed') END) NOT IN ('awaiting_payment','cancelled')
ORDER BY cr.id;

-- @query C6
-- Integrity-repair events: each one may have rewritten sale_status to returned/partial_return
-- without keeping the payment state. casualties_since = return-status sales with no payment
-- state kept, last touched at or after the event.
SELECT a.id, a.created_at, a.user_name, a.details,
  (SELECT COUNT(*) FROM sales s WHERE s.sale_status IN ('partial_return','returned') AND s.status_before_return IS NULL
     AND s.updated_at >= a.created_at) AS casualties_since
FROM audit_logs a
WHERE a.action = 'repair' AND a.entity = 'data-integrity'
ORDER BY a.id;
