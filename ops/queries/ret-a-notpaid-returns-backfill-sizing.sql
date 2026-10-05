-- RET-A Q1 sizing (owner ruling 6 Oct 2026, relayed by the lead): customer
-- returns recorded on a Not Paid sale BEFORE migration 0234 counted their whole
-- refund as cash out of the drawer and moved the sale out of Not Paid. The
-- held backfill ops/scripts/migration/held/0238_return_owed_backfill.sql
-- rewrites them as 0234's code would have: the refund first lowers what the
-- customer owes (returns.owed_reduction_usd), only the rest stays cash, and a
-- sale that still owes goes back to Not Paid. Owner example: $10 Not Paid, $4
-- returned -> revenue $6, Not Paid owes $6, the drawer pays out nothing.
--
-- THIS FILE: production BEFORE 0234 is applied (today). Every return is pre-0234
-- there, so refund_currency/owed_reduction_usd are read as NULL/0. After 0234
-- use ret-a-notpaid-returns-backfill-sizing-live.sql (has_0234_columns stops this one).
--
-- The plan between plan:begin and plan:end is byte-identical in both sizing
-- files and in the held migration (cloudflare/scripts/test-held-0238-return-
-- owed-backfill-pure.cjs proves it and that the counts here equal what the
-- migration writes). Read-only; counts, sums and dates only.
--   has_0234_columns / missing_0234_columns   must be 0 (wrong file for this database)
--   pending_debt_returns        pre-0234 active customer returns on a sale that carries a debt
--   backfill_returns            ... the migration rewrites (refund_currency 'USD', owed_reduction_usd set)
--   backfill_sales              their sales (each gets a new sale_write_revisions revision)
--   refund_usd_counted_as_cash  their total refund: all of it was counted as drawer cash out
--   moves_to_debt_usd           the part that becomes "debt lowered" (drawers expect this much MORE cash)
--   stays_cash_usd              the part above the debt, still a cash refund
--   returns_with_reduction      backfill returns whose owed_reduction_usd becomes > 0
--   sales_to_not_paid           Returned / Partial return -> Not Paid (they still owe)
--   not_paid_cleared_sales      already Not Paid, the returns now clear the debt (status left; owes $0)
--   cash_beyond_paid_sales      cash part exceeds what the customer paid (0234 would have refused;
--                               written anyway, debt cannot go below zero) -- review by hand
--   mixed_sales                 sales that also hold a return written by 0234's code (capped by it)
--   refused_sales_*             left untouched: unreadable sale money, a row the money-precision
--                               triggers would abort on, or a zero/negative refund on the sale
--   refused_returns             the pending returns on those refused sales
--   cancelled_returns_left      pre-0234 CANCELLED returns on debt sales: untouched (no drawer effect)
--   shifts_open / _closed / _cancelled   shift windows holding a return whose drawer figure changes
--                               (window = shiftRefunds: created_at in [opened_at, closed_at or
--                               cancelled_at), the shift's branch, its cashier unless shop_wide).
--                               A closed shift's expected cash rises; with SEC-SHIFT's stored close
--                               figures it shows as "changed after close" -- expected.
--   legacy_sales / legacy_sales_with_receivable   imported legacy sales among backfill_sales, and
--                               those with a customer_receivables row (that ledger is never written:
--                               returns have never touched it; report any non-zero to the lead)
--   first_return_date, last_return_date
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero has_0234_columns
WITH RECURSIVE
src_returns AS (
  SELECT r.id, r.sale_id, r.status, r.return_scope, r.total_refund_usd, r.created_at, r.branch_id, r.cashier_id,
    NULL AS refund_currency, 0 AS owed_reduction_usd,
    COALESCE((typeof(r.money_precision_version) = 'integer' AND (
        (r.money_precision_version = 0 AND r.calculated_refund_usd IS NULL AND r.rounding_adjustment_usd = 0)
        OR (r.money_precision_version = 1
          AND typeof(r.calculated_refund_usd) IN ('integer', 'real') AND r.calculated_refund_usd BETWEEN -100000000000 AND 100000000000 AND r.calculated_refund_usd = CAST(ROUND(r.calculated_refund_usd * 10000) AS INTEGER) / 10000.0
          AND typeof(r.total_refund_usd) IN ('integer', 'real') AND r.total_refund_usd BETWEEN -100000000000 AND 100000000000 AND r.total_refund_usd = CAST(ROUND(r.total_refund_usd * 10000) AS INTEGER) / 10000.0
          AND typeof(r.rounding_adjustment_usd) IN ('integer', 'real') AND r.rounding_adjustment_usd BETWEEN -100000000000 AND 100000000000 AND r.rounding_adjustment_usd = CAST(ROUND(r.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
          AND r.calculated_refund_usd >= 0 AND r.total_refund_usd >= 0
          AND CAST(ROUND(r.total_refund_usd * 10000) AS INTEGER) % 100 = 0
          AND CAST(ROUND(r.calculated_refund_usd * 10000) AS INTEGER) + CAST(ROUND(r.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(r.total_refund_usd * 10000) AS INTEGER)
          AND ABS(CAST(ROUND(r.rounding_adjustment_usd * 10000) AS INTEGER)) < 100
        )
      )), 0) AS row_ok
  FROM returns r
),
-- plan:begin
cust AS (
  SELECT * FROM src_returns WHERE COALESCE(return_scope, 'customer') = 'customer'
),
lowered AS (
  SELECT sale_id FROM cust WHERE owed_reduction_usd > 0 GROUP BY sale_id
),
post AS (
  SELECT sale_id,
    SUM(CAST(ROUND(owed_reduction_usd * 10000) AS INTEGER)) AS s0,
    SUM(CAST(ROUND(total_refund_usd * 10000) AS INTEGER) - CAST(ROUND(owed_reduction_usd * 10000) AS INTEGER)) AS post_cash_u,
    COUNT(*) AS post_count
  FROM cust
  WHERE refund_currency IS NOT NULL AND COALESCE(status, 'completed') <> 'cancelled'
  GROUP BY sale_id
),
pending AS (
  SELECT * FROM cust
  WHERE refund_currency IS NULL AND COALESCE(status, 'completed') <> 'cancelled' AND sale_id IS NOT NULL
),
debt_sale AS (
  SELECT s.id AS sale_id, s.sale_status AS prior_sale_status, s.legacy_receipt_number,
    lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) AS status_word,
    CASE WHEN typeof(s.total_usd) IN ('integer', 'real') AND typeof(s.exchange_rate) IN ('integer', 'real')
      AND typeof(COALESCE(s.amount_paid_usd, 0)) IN ('integer', 'real')
      AND typeof(COALESCE(s.amount_paid_khr, 0)) IN ('integer', 'real')
      AND CAST(ROUND(s.exchange_rate * 10000) AS INTEGER) > 0 THEN 1 ELSE 0 END AS money_readable,
    COALESCE((typeof(s.money_precision_version) = 'integer' AND (
        (s.money_precision_version = 0 AND s.calculated_total_usd IS NULL AND s.rounding_adjustment_usd = 0)
        OR (s.money_precision_version IN (0, 1)
          AND typeof(s.calculated_total_usd) IN ('integer', 'real') AND s.calculated_total_usd BETWEEN 0 AND 100000000000 AND s.calculated_total_usd = CAST(ROUND(s.calculated_total_usd * 10000) AS INTEGER) / 10000.0
          AND typeof(s.total_usd) IN ('integer', 'real') AND s.total_usd BETWEEN 0 AND 100000000000 AND s.total_usd = CAST(ROUND(s.total_usd * 10000) AS INTEGER) / 10000.0
          AND typeof(s.rounding_adjustment_usd) IN ('integer', 'real') AND s.rounding_adjustment_usd BETWEEN -0.005 AND 0.005 AND s.rounding_adjustment_usd = CAST(ROUND(s.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
          AND CAST(ROUND(s.total_usd * 10000) AS INTEGER) % 100 = 0
          AND CAST(ROUND(s.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(s.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(s.total_usd * 10000) AS INTEGER)
          AND ((CAST(ROUND(s.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(s.total_usd * 10000) AS INTEGER)
        )
      )), 0) AS row_ok,
    CAST(ROUND(s.total_usd * 10000) AS INTEGER) AS tu,
    CAST(ROUND(COALESCE(s.amount_paid_usd, 0) * 10000) AS INTEGER) AS pu,
    CAST(ROUND(COALESCE(s.amount_paid_khr, 0) * 10000) AS INTEGER) AS pk,
    CAST(ROUND(s.exchange_rate * 10000) AS INTEGER) AS rn
  FROM sales s
  WHERE s.id IN (SELECT sale_id FROM pending)
    AND lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) <> 'cancelled'
    AND (lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) = 'awaiting_payment'
      OR (lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) IN ('returned', 'partial_return')
        AND lower(trim(COALESCE(NULLIF(s.status_before_return, ''), 'completed'))) = 'awaiting_payment')
      OR s.id IN (SELECT sale_id FROM lowered))
),
candidate AS (
  SELECT p.id, p.sale_id, p.total_refund_usd, p.created_at, p.branch_id, p.cashier_id, p.row_ok,
    CASE WHEN typeof(p.total_refund_usd) IN ('integer', 'real') AND p.total_refund_usd > 0 THEN 1 ELSE 0 END AS refund_ok
  FROM pending p JOIN debt_sale d ON d.sale_id = p.sale_id
),
sale_verdict AS (
  SELECT d.sale_id, d.prior_sale_status, d.status_word, d.legacy_receipt_number, d.tu, d.pu, d.pk, d.rn,
    COALESCE(o.s0, 0) AS s0, COALESCE(o.post_cash_u, 0) AS post_cash_u, COALESCE(o.post_count, 0) AS post_count,
    CASE WHEN d.money_readable = 0 THEN 'money_unreadable'
      WHEN d.row_ok = 0 OR a.rows_ok = 0 THEN 'row_locked'
      WHEN a.refunds_ok = 0 THEN 'refund_not_positive' END AS refusal
  FROM debt_sale d
  JOIN (SELECT sale_id, MIN(row_ok) AS rows_ok, MIN(refund_ok) AS refunds_ok FROM candidate GROUP BY sale_id) a
    ON a.sale_id = d.sale_id
  LEFT JOIN post o ON o.sale_id = d.sale_id
),
seq AS (
  SELECT c.id, c.sale_id, CAST(ROUND(c.total_refund_usd * 10000) AS INTEGER) AS refund_u,
    v.tu, v.pu, v.pk, v.rn, v.s0,
    ROW_NUMBER() OVER (PARTITION BY c.sale_id ORDER BY c.id) AS n
  FROM candidate c JOIN sale_verdict v ON v.sale_id = c.sale_id
  WHERE v.refusal IS NULL
),
walk (id, sale_id, n, refund_u, tu, pu, pk, rn, before_u, red_u) AS (
  SELECT q.id, q.sale_id, q.n, q.refund_u, q.tu, q.pu, q.pk, q.rn, q.s0,
    MIN(q.refund_u, (((CASE WHEN (q.tu - q.s0 - q.pu) * q.rn - q.pk * 10000 <= 50 * q.rn THEN 0
      ELSE (2 * ((q.tu - q.s0 - q.pu) * q.rn - q.pk * 10000) + q.rn) / (2 * q.rn) END) + 50) / 100) * 100)
  FROM seq q WHERE q.n = 1
  UNION ALL
  SELECT q.id, q.sale_id, q.n, q.refund_u, q.tu, q.pu, q.pk, q.rn, w.before_u + w.red_u,
    MIN(q.refund_u, (((CASE WHEN (q.tu - (w.before_u + w.red_u) - q.pu) * q.rn - q.pk * 10000 <= 50 * q.rn THEN 0
      ELSE (2 * ((q.tu - (w.before_u + w.red_u) - q.pu) * q.rn - q.pk * 10000) + q.rn) / (2 * q.rn) END) + 50) / 100) * 100)
  FROM walk w JOIN seq q ON q.sale_id = w.sale_id AND q.n = w.n + 1
),
plan AS (
  SELECT v.sale_id, v.prior_sale_status, v.status_word, v.legacy_receipt_number, v.post_count,
    t.lowered_u, t.cash_u,
    CASE WHEN (v.tu - t.lowered_u - v.pu) * v.rn - v.pk * 10000 <= 50 * v.rn THEN 0 ELSE 1 END AS owes_after,
    CASE WHEN (t.cash_u + v.post_cash_u - v.pu) * v.rn - v.pk * 10000 > 50 * v.rn THEN 1 ELSE 0 END AS cash_beyond_paid
  FROM sale_verdict v
  JOIN (SELECT sale_id, MAX(before_u + red_u) AS lowered_u, SUM(refund_u - red_u) AS cash_u FROM walk GROUP BY sale_id) t
    ON t.sale_id = v.sale_id
),
plan_status AS (
  SELECT p.*,
    CASE WHEN p.status_word IN ('returned', 'partial_return') AND p.owes_after = 1 THEN 'awaiting_payment'
      ELSE p.prior_sale_status END AS new_sale_status
  FROM plan p
)
-- plan:end
,
moved AS (
  SELECT c.id, c.created_at, c.branch_id, c.cashier_id
  FROM walk w JOIN candidate c ON c.id = w.id
  WHERE w.red_u > 0
),
shift_hit AS (
  SELECT h.id, h.closed_at, h.cancelled_at
  FROM shift_sessions h
  WHERE EXISTS (
    SELECT 1 FROM moved m
    WHERE datetime(m.created_at) >= datetime(h.opened_at)
      AND (COALESCE(h.closed_at, h.cancelled_at) IS NULL OR datetime(m.created_at) < datetime(COALESCE(h.closed_at, h.cancelled_at)))
      AND (h.branch_id IS NULL OR m.branch_id = h.branch_id)
      AND (COALESCE(h.scope_mode, 'per_account') = 'shop_wide' OR m.cashier_id = h.user_id)
  )
)
SELECT
  (SELECT CASE WHEN instr(sql, 'owed_reduction_usd') > 0 THEN 1 ELSE 0 END FROM sqlite_master WHERE type = 'table' AND name = 'returns') AS has_0234_columns,
  (SELECT COUNT(*) FROM candidate) AS pending_debt_returns,
  (SELECT COUNT(*) FROM walk) AS backfill_returns,
  (SELECT COUNT(*) FROM plan_status) AS backfill_sales,
  (SELECT ROUND(COALESCE(SUM(c.total_refund_usd), 0), 2) FROM walk w JOIN candidate c ON c.id = w.id) AS refund_usd_counted_as_cash,
  (SELECT ROUND(COALESCE(SUM(red_u), 0) / 10000.0, 4) FROM walk) AS moves_to_debt_usd,
  (SELECT ROUND(COALESCE(SUM(refund_u - red_u), 0) / 10000.0, 4) FROM walk) AS stays_cash_usd,
  (SELECT COUNT(*) FROM walk WHERE red_u > 0) AS returns_with_reduction,
  (SELECT COUNT(*) FROM plan_status WHERE new_sale_status IS NOT prior_sale_status) AS sales_to_not_paid,
  (SELECT COUNT(*) FROM plan_status WHERE status_word = 'awaiting_payment' AND owes_after = 0) AS not_paid_cleared_sales,
  (SELECT COUNT(*) FROM plan_status WHERE cash_beyond_paid = 1) AS cash_beyond_paid_sales,
  (SELECT COUNT(*) FROM plan_status WHERE post_count > 0) AS mixed_sales,
  (SELECT COUNT(*) FROM sale_verdict WHERE refusal = 'money_unreadable') AS refused_sales_money_unreadable,
  (SELECT COUNT(*) FROM sale_verdict WHERE refusal = 'row_locked') AS refused_sales_row_locked,
  (SELECT COUNT(*) FROM sale_verdict WHERE refusal = 'refund_not_positive') AS refused_sales_refund_not_positive,
  (SELECT COUNT(*) FROM candidate c JOIN sale_verdict v ON v.sale_id = c.sale_id WHERE v.refusal IS NOT NULL) AS refused_returns,
  (SELECT COUNT(*) FROM cust x JOIN sales s ON s.id = x.sale_id
    WHERE x.refund_currency IS NULL AND COALESCE(x.status, 'completed') = 'cancelled'
      AND lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) <> 'cancelled'
      AND (lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) = 'awaiting_payment'
        OR (lower(trim(COALESCE(NULLIF(s.sale_status, ''), 'completed'))) IN ('returned', 'partial_return')
          AND lower(trim(COALESCE(NULLIF(s.status_before_return, ''), 'completed'))) = 'awaiting_payment'))) AS cancelled_returns_left,
  (SELECT COUNT(*) FROM shift_hit WHERE closed_at IS NULL AND cancelled_at IS NULL) AS shifts_open,
  (SELECT COUNT(*) FROM shift_hit WHERE closed_at IS NOT NULL) AS shifts_closed,
  (SELECT COUNT(*) FROM shift_hit WHERE closed_at IS NULL AND cancelled_at IS NOT NULL) AS shifts_cancelled,
  (SELECT COUNT(*) FROM plan_status WHERE legacy_receipt_number IS NOT NULL AND legacy_receipt_number <> '') AS legacy_sales,
  (SELECT COUNT(*) FROM plan_status p WHERE p.legacy_receipt_number IS NOT NULL AND p.legacy_receipt_number <> ''
    AND EXISTS (SELECT 1 FROM customer_receivables cr WHERE cr.invoice_no = CASE WHEN instr(p.legacy_receipt_number, '@') > 0
      THEN substr(p.legacy_receipt_number, 1, instr(p.legacy_receipt_number, '@') - 1) ELSE p.legacy_receipt_number END)) AS legacy_sales_with_receivable,
  (SELECT MIN(date(c.created_at)) FROM walk w JOIN candidate c ON c.id = w.id) AS first_return_date,
  (SELECT MAX(date(c.created_at)) FROM walk w JOIN candidate c ON c.id = w.id) AS last_return_date;
