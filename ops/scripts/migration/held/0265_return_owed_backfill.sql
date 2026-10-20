-- 0265 RETURN-OWED-BACKFILL (DRAFT, lane 6.0.891 slice S0; re-review of held 0238 against the 0260 columns and
-- the two-status model). Owner rulings: 6 Oct 2026 (a return on a Not Paid sale lowers the debt, no cash out;
-- $10 Not Paid with $4 returned -> revenue $6, owes $6, the drawer pays nothing) and 20 Oct 2026 (only Not Paid and
-- Completed exist; a return is a tag; Not Paid stays Not Paid).
--
-- HELD, DRAFT. Parked in ops/scripts/migration/held/, NOT in the deploy chain, not yet reviewed by a second agent.
-- It writes existing production rows (returns only). Moving it into cloudflare/migrations (as 0265) needs the
-- owner's go, 0260 and 0264 applied first, and the held-0200 ordering check
-- (test-held-0200-sale-cost-repair-pure.cjs) taught about it.
--
-- WHAT CHANGED FROM 0238 (the review; the old file stays untouched on claude/returns-correctness-20261005):
--  * It no longer writes sales. 0238 rewrote sales.sale_status to 'returned'/'partial_return' and
--    status_before_return; those statuses are retired and, after 0264, a write of one aborts on
--    sales_status_vocab_upd. A return never writes sale_status in the new model: Not Paid stays Not Paid
--    (even when the returns clear the debt), the quantity state is the return_state tag.
--  * The quantity-status CTEs (rline, short, quantity, plan_status) are gone with it; the debt predicate reads
--    sale_status = 'awaiting_payment' (0264 folded status_before_return = 'awaiting_payment' into it), so this file
--    runs AFTER 0264.
--  * Column names match 0260 (refund_currency, owed_reduction_usd); the 0260 CHECK
--    (owed_reduction_usd = 0 OR <= total_refund_usd) holds because owed = MIN(refund, remaining debt).
--  * Returns on sales that carry no debt (Completed) get refund_currency 'USD', owed_reduction_usd 0, so the dual
--    NULL reading in lib/returnRefundSplit.ts (returnDebtLoweredSql: NULL = the whole refund lowered a debt) is
--    gone for every active customer return except the ones refused below. 0238 left them NULL.
--  * Kept: return id ascending (planReturnMoney order), integer calculation units and the half-cent rule exactly as
--    lib/saleStatusResolution.ts saleOutstandingUsd does it, returns already written by the 0260 code counted first,
--    the money-precision row_ok refusals, the backup table and the revision guard for recovery.
--  * Stored shift-close figures (0237) are not touched: a closed shift shows the rewrite as "changed after close",
--    as the owner accepted. customer_receivables is not touched.
--  * Sale events: none; every touched return bumps its sale's sale_write_revisions through the 0120 triggers, so a
--    screen holding the old state conflicts instead of writing over it.
-- Refused (left NULL, counted by the PRE query): a sale whose money cannot be read; a sale or return row the
-- money-precision triggers would abort on; a sale holding a zero or negative pre-0260 refund. Returns of Cancelled
-- sales and Cancelled returns are not rewritten (a restore recomputes the split anyway).
--
-- DEPLOY ORDER: 0260 applied, the 0260 Worker live, 0264 applied. Under older code the Not Paid list shows the full
-- total owed.
--
-- PRE (write the numbers down): the sizing query of 0238 (ops/queries/ret-a-notpaid-returns-backfill-sizing-live.sql
--   on claude/returns-correctness-20261005) with its status-rewrite columns ignored, plus
--   SELECT COUNT(*) AS n, ROUND(SUM(total_refund_usd),4) AS usd FROM returns;
-- POST (abort when violated, recorded in return_owed_guard_0265): post_refund_totals_unchanged,
--   post_ledger_applied (each ledger return reads currency USD and the planned reduction),
--   post_sales_untouched (sale_status counts and total_usd identical); null_currency_remaining is recorded in
--   return_owed_pre_0265 for the refused returns.
-- IDEMPOTENT: a second run finds no pending row; the ledger keeps the first run's rows (the file itself is a
--   one-shot migration: its CREATE TABLE fails on a second apply).
-- RECOVERY (append-only; for returns whose sale was not written since -- sale_revision is the sale_write_revisions
--   revision this file records last, and the 0120 triggers bump it on every write to the sale, its lines, its
--   returns and their lines):
--   UPDATE return_owed_backfill_0265 SET recover_ok = CASE WHEN NOT EXISTS (
--       SELECT 1 FROM return_owed_backfill_0265 o WHERE o.sale_id = return_owed_backfill_0265.sale_id
--         AND (o.sale_revision IS NULL OR o.sale_revision <> COALESCE((SELECT w.revision FROM sale_write_revisions w WHERE w.sale_id = o.sale_id), 0)))
--     THEN 1 ELSE 0 END;
--   UPDATE returns SET owed_reduction_usd = 0, refund_currency = NULL
--     WHERE id IN (SELECT return_id FROM return_owed_backfill_0265 WHERE recover_ok = 1);
--   SELECT COUNT(DISTINCT sale_id) FROM return_owed_backfill_0265 WHERE recover_ok = 0;   -- left as they are: review by hand
-- End of recovery.
--
-- Proof: cloudflare/scripts/test-held-0265-draft-native.cjs (owner example, partial payment, excess cash, sequence,
-- paid-sale default, a refused sale, sales untouched). The old 0238 fuzz against the TypeScript kernel
-- (test-held-0238-return-owed-backfill-pure.cjs) is not ported: port it when this draft is promoted.

CREATE TABLE return_owed_guard_0265 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE return_owed_pre_0265 (
  metric TEXT PRIMARY KEY,
  value REAL NOT NULL
);

CREATE TABLE return_owed_backfill_0265 (
  return_id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  refund_usd REAL,
  owed_reduction_usd REAL NOT NULL CHECK (owed_reduction_usd >= 0),
  basis TEXT NOT NULL CHECK (basis IN ('debt_walk', 'paid_sale')),
  sale_revision INTEGER,
  recover_ok INTEGER,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO return_owed_guard_0265 (check_name, ok) SELECT 'pre_0264_applied',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sales WHERE sale_status IN ('partial_return', 'returned', 'awaiting_delivery'))
  THEN 1 ELSE 0 END;

INSERT INTO return_owed_pre_0265 (metric, value) SELECT 'returns_n', COUNT(*) FROM returns;
INSERT INTO return_owed_pre_0265 (metric, value) SELECT 'refund_usd', ROUND(COALESCE(SUM(total_refund_usd), 0), 4) FROM returns;
INSERT INTO return_owed_pre_0265 (metric, value) SELECT 'refund_khr', COALESCE(SUM(total_refund_khr), 0) FROM returns;
INSERT INTO return_owed_pre_0265 (metric, value) SELECT 'sales_completed', COUNT(*) FROM sales WHERE sale_status = 'completed';
INSERT INTO return_owed_pre_0265 (metric, value) SELECT 'sales_not_paid', COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment';
INSERT INTO return_owed_pre_0265 (metric, value) SELECT 'sales_total_usd', ROUND(COALESCE(SUM(total_usd), 0), 4) FROM sales;

WITH RECURSIVE
src_returns AS (
  SELECT r.id, r.sale_id, r.status, r.return_scope, r.total_refund_usd, r.created_at, r.branch_id, r.cashier_id,
    r.refund_currency, r.owed_reduction_usd,
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
cust AS (
  SELECT * FROM src_returns WHERE COALESCE(return_scope, 'customer') = 'customer'
),
lowered AS (
  SELECT sale_id FROM cust WHERE owed_reduction_usd > 0 GROUP BY sale_id
),
post AS (
  SELECT sale_id, SUM(CAST(ROUND(owed_reduction_usd * 10000) AS INTEGER)) AS s0
  FROM cust
  WHERE refund_currency IS NOT NULL AND COALESCE(status, 'completed') <> 'cancelled'
  GROUP BY sale_id
),
pending AS (
  SELECT * FROM cust
  WHERE refund_currency IS NULL AND COALESCE(status, 'completed') <> 'cancelled' AND sale_id IS NOT NULL
),
debt_sale AS (
  SELECT s.id AS sale_id,
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
    AND s.sale_status <> 'cancelled'
    AND (s.sale_status = 'awaiting_payment' OR s.id IN (SELECT sale_id FROM lowered))
),
candidate AS (
  SELECT p.id, p.sale_id, p.total_refund_usd, p.row_ok,
    CASE WHEN typeof(p.total_refund_usd) IN ('integer', 'real') AND p.total_refund_usd > 0 THEN 1 ELSE 0 END AS refund_ok
  FROM pending p JOIN debt_sale d ON d.sale_id = p.sale_id
),
sale_verdict AS (
  SELECT d.sale_id, d.tu, d.pu, d.pk, d.rn, COALESCE(o.s0, 0) AS s0,
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
backfill AS (
  SELECT w.id AS return_id, w.sale_id, c.total_refund_usd AS refund_usd,
    MIN(w.red_u / 10000.0, c.total_refund_usd) AS owed_reduction_usd, 'debt_walk' AS basis
  FROM walk w JOIN candidate c ON c.id = w.id
  UNION ALL
  SELECT p.id, p.sale_id, p.total_refund_usd, 0, 'paid_sale'
  FROM pending p JOIN sales s ON s.id = p.sale_id
  WHERE p.row_ok = 1 AND s.sale_status = 'completed' AND p.sale_id NOT IN (SELECT sale_id FROM debt_sale)
)
INSERT OR IGNORE INTO return_owed_backfill_0265 (return_id, sale_id, refund_usd, owed_reduction_usd, basis)
SELECT return_id, sale_id, refund_usd, owed_reduction_usd, basis FROM backfill ORDER BY return_id;

UPDATE returns
SET owed_reduction_usd = (SELECT b.owed_reduction_usd FROM return_owed_backfill_0265 b WHERE b.return_id = returns.id),
  refund_currency = 'USD'
WHERE refund_currency IS NULL AND id IN (SELECT return_id FROM return_owed_backfill_0265);

UPDATE return_owed_backfill_0265
SET sale_revision = COALESCE((SELECT w.revision FROM sale_write_revisions w WHERE w.sale_id = return_owed_backfill_0265.sale_id), 0)
WHERE sale_revision IS NULL;

-- ---- POST ----
INSERT INTO return_owed_guard_0265 (check_name, ok) SELECT 'post_refund_totals_unchanged',
  CASE WHEN (SELECT COUNT(*) FROM returns) = (SELECT value FROM return_owed_pre_0265 WHERE metric = 'returns_n')
    AND (SELECT ROUND(COALESCE(SUM(total_refund_usd), 0), 4) FROM returns) = (SELECT value FROM return_owed_pre_0265 WHERE metric = 'refund_usd')
    AND (SELECT COALESCE(SUM(total_refund_khr), 0) FROM returns) = (SELECT value FROM return_owed_pre_0265 WHERE metric = 'refund_khr')
  THEN 1 ELSE 0 END;

INSERT INTO return_owed_guard_0265 (check_name, ok) SELECT 'post_ledger_applied',
  CASE WHEN NOT EXISTS (SELECT 1 FROM return_owed_backfill_0265 b LEFT JOIN returns r ON r.id = b.return_id
    WHERE r.id IS NULL OR r.refund_currency IS NOT 'USD' OR r.owed_reduction_usd IS NOT b.owed_reduction_usd)
  THEN 1 ELSE 0 END;

INSERT INTO return_owed_guard_0265 (check_name, ok) SELECT 'post_sales_untouched',
  CASE WHEN (SELECT COUNT(*) FROM sales WHERE sale_status = 'completed') = (SELECT value FROM return_owed_pre_0265 WHERE metric = 'sales_completed')
    AND (SELECT COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment') = (SELECT value FROM return_owed_pre_0265 WHERE metric = 'sales_not_paid')
    AND (SELECT ROUND(COALESCE(SUM(total_usd), 0), 4) FROM sales) = (SELECT value FROM return_owed_pre_0265 WHERE metric = 'sales_total_usd')
  THEN 1 ELSE 0 END;

-- Recorded, not asserted: active customer returns still reading NULL (the refused ones; read them by hand).
INSERT INTO return_owed_pre_0265 (metric, value)
SELECT 'null_currency_remaining', COUNT(*) FROM returns
WHERE refund_currency IS NULL AND COALESCE(return_scope, 'customer') = 'customer' AND COALESCE(status, 'completed') <> 'cancelled';
