-- 0238 RETURN-OWED-BACKFILL (RET-A Q1; owner ruling 6 Oct 2026, relayed by the
-- lead): rewrite the customer returns recorded on a Not Paid sale BEFORE 0234
-- to the model 0234's code uses for every new one.
--
-- HELD. This file is parked in ops/scripts/migration/held/ and is NOT in the
-- deploy chain. It writes existing production rows, and the held 0200 cost
-- repair names both tables it updates (sales, returns), which
-- test-held-0200-sale-cost-repair-pure.cjs treats as an ordering dependency.
-- Moving it into cloudflare/migrations is the "apply this" decision: it needs
-- the owner's go and the lead's call on that guard (see held/README.md).
--
-- Owner example, exactly: a $10 Not Paid sale with $4 returned -> revenue $6;
-- the Not Paid section owes $6; the shift drawer pays out nothing. Closed shift
-- drawers change and the owner accepts that; reports treat Not Paid and
-- Completed alike, Not Paid being an extra detail at the end.
--
-- What it does, per sale that carries a debt (lib/returnRefundSplit.ts
-- saleCarriesDebt: Not Paid, or Returned/Partial return whose
-- status_before_return is Not Paid, or a return already lowered its debt) and
-- is not cancelled:
--   * its active customer returns with refund_currency IS NULL (written before
--     0234's code) are replayed in id order through splitReturnRefund, in
--     integer calculation units exactly as lib/saleStatusResolution.ts
--     saleOutstandingUsd does it (half-cent tolerance, half-up, the sale's own
--     booked rate, riel tender counted): owed_reduction_usd = min(refund, what
--     the sale still owes after the returns before it), refund_currency 'USD'
--     (the currency the drawer already took them in; NULL read as USD);
--   * returns written by 0234's code on the same sale count first, so the debt
--     lowered never exceeds the debt;
--   * the sale's status is then what lib/returnRefundSplit.ts
--     saleStatusWithReturns gives: a Returned / Partial return sale that still
--     owes goes back to Not Paid (status_before_return left as it is, as the
--     return-edit path does); a Not Paid sale whose debt the returns clear
--     takes its quantity status by the create route's own rule -- Returned when
--     every sale line has come back in full (its own return lines, plus what
--     the sales import recorded, plus same-product return lines tied to no
--     line of the sale), else Partial return -- with status_before_return
--     'awaiting_payment', as the create path writes it.
--     (Verifier P4: a pre-0234 return, then one written by 0234's code, can
--     clear the debt only once this file runs.)
-- Stock moves by 0 (status changes between held statuses only). Revenue moves
-- by 0 (recognizedExpr is "<> 'cancelled'"). customer_receivables is not
-- touched: returns have never written it, so no ledger split is created.
-- shift_close_figures (SEC-SHIFT 0237) is not touched: a closed shift with
-- stored figures shows the rewrite as "changed after close", as intended.
-- Sale events: none (sale_record_events has no source kind for a migration);
-- every touched sale gets a new sale_write_revisions revision through the
-- 0120 trigger, so a screen holding the old state conflicts instead of
-- writing over it. KV caches refresh on the next sales write.
--
-- Refused (left exactly as they are, counted by the sizing query): a sale
-- whose money cannot be read; a sale or return row the money-precision
-- triggers would abort on; a sale holding a zero or negative pre-0234 refund.
-- Cancelled returns are not rewritten.
--
-- DEPLOY ORDER: only with 0234 applied AND RET-A's Worker code live. Applied
-- under older code, the Not Paid list would show the full total owed.
--
-- PRE (run first; numbers to write down):
--   ops/queries/ret-a-notpaid-returns-backfill-sizing-live.sql (0234 applied)
--   -> backfill_returns = N, backfill_sales = M, sales_to_not_paid = K,
--      not_paid_cleared_sales = C, moves_to_debt_usd = X, refused_returns = F
-- POST:
--   SELECT COUNT(*) AS n, COUNT(DISTINCT sale_id) AS m,
--     ROUND(SUM(owed_reduction_usd), 4) AS x,
--     COUNT(DISTINCT CASE WHEN new_sale_status = 'awaiting_payment' AND prior_sale_status IS NOT 'awaiting_payment' THEN sale_id END) AS k,
--     COUNT(DISTINCT CASE WHEN prior_sale_status = 'awaiting_payment' AND new_sale_status IS NOT 'awaiting_payment' THEN sale_id END) AS c
--   FROM return_owed_backfill_0238                         -- expect N, M, X, K, C
--   SELECT COUNT(*) FROM returns r JOIN return_owed_backfill_0238 b ON b.return_id = r.id
--   WHERE r.refund_currency = 'USD' AND r.owed_reduction_usd = b.owed_reduction_usd   -- expect N
--   the -live sizing query again -> backfill_returns 0, refused_returns F (unchanged)
-- IDEMPOTENT: a second run finds no pending row (refund_currency is set) and
-- writes nothing; return_owed_backfill_0238 keeps the first run's rows.
--
-- RECOVERY (verifier P5: undoes a sale only when nothing on it was written
-- since the backfill -- sale_revision is the sale_write_revisions revision the
-- last statement below records, and the 0120 triggers bump it on every write
-- to the sale, its lines, its returns and their lines: a later settlement, a
-- return edit or a new return all leave that sale exactly as it is. The
-- backup table stays.)
-- Statements:
--   UPDATE return_owed_backfill_0238 SET recover_ok = CASE WHEN NOT EXISTS (
--       SELECT 1 FROM return_owed_backfill_0238 o WHERE o.sale_id = return_owed_backfill_0238.sale_id
--         AND (o.sale_revision IS NULL OR o.sale_revision <> COALESCE((SELECT w.revision FROM sale_write_revisions w WHERE w.sale_id = o.sale_id), 0)))
--     THEN 1 ELSE 0 END;
--   UPDATE returns SET owed_reduction_usd = 0, refund_currency = NULL
--     WHERE id IN (SELECT return_id FROM return_owed_backfill_0238 WHERE recover_ok = 1);
--   UPDATE sales SET sale_status = (SELECT b.prior_sale_status FROM return_owed_backfill_0238 b WHERE b.sale_id = sales.id ORDER BY b.return_id LIMIT 1),
--       status_before_return = (SELECT b.prior_status_before_return FROM return_owed_backfill_0238 b WHERE b.sale_id = sales.id ORDER BY b.return_id LIMIT 1)
--     WHERE id IN (SELECT sale_id FROM return_owed_backfill_0238 WHERE recover_ok = 1
--       AND (new_sale_status IS NOT prior_sale_status OR new_status_before_return IS NOT prior_status_before_return));
--   SELECT COUNT(DISTINCT sale_id) FROM return_owed_backfill_0238 WHERE recover_ok = 0;   -- sales left as they are: review by hand
-- End of recovery.
--
-- Proof: cloudflare/scripts/test-held-0238-return-owed-backfill-pure.cjs
-- (owner example, drawer and Not Paid before/after, refusals, double apply,
-- recovery, sizing parity, and a fuzz against the TypeScript kernel).

CREATE TABLE IF NOT EXISTS return_owed_backfill_0238 (
  return_id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  refund_usd REAL,
  owed_reduction_usd REAL NOT NULL CHECK (owed_reduction_usd >= 0),
  prior_sale_status TEXT,
  new_sale_status TEXT,
  prior_status_before_return TEXT,
  new_status_before_return TEXT,
  sale_revision INTEGER,
  recover_ok INTEGER,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  SELECT s.id AS sale_id, s.sale_status AS prior_sale_status, s.status_before_return AS prior_status_before_return, s.legacy_receipt_number,
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
  SELECT d.sale_id, d.prior_sale_status, d.prior_status_before_return, d.status_word, d.legacy_receipt_number, d.tu, d.pu, d.pk, d.rn,
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
  SELECT v.sale_id, v.prior_sale_status, v.prior_status_before_return, v.status_word, v.legacy_receipt_number, v.post_count,
    t.lowered_u, t.cash_u,
    CASE WHEN (v.tu - t.lowered_u - v.pu) * v.rn - v.pk * 10000 <= 50 * v.rn THEN 0 ELSE 1 END AS owes_after,
    CASE WHEN (t.cash_u + v.post_cash_u - v.pu) * v.rn - v.pk * 10000 > 50 * v.rn THEN 1 ELSE 0 END AS cash_beyond_paid
  FROM sale_verdict v
  JOIN (SELECT sale_id, MAX(before_u + red_u) AS lowered_u, SUM(refund_u - red_u) AS cash_u FROM walk GROUP BY sale_id) t
    ON t.sale_id = v.sale_id
),
rline AS (
  SELECT x.sale_id, ri.sale_item_id, ri.product_id, CAST(ROUND(ri.quantity * 10000) AS INTEGER) AS q_u,
    EXISTS (SELECT 1 FROM sale_items z WHERE z.id = ri.sale_item_id AND z.sale_id = x.sale_id) AS on_line
  FROM return_items ri JOIN cust x ON x.id = ri.return_id
  WHERE x.sale_id IN (SELECT sale_id FROM plan) AND COALESCE(x.status, 'completed') <> 'cancelled' AND ri.quantity > 0
),
short AS (
  SELECT si.sale_id, si.product_id,
    SUM(MAX(CAST(ROUND(si.quantity * 10000) AS INTEGER) - CAST(ROUND(MAX(COALESCE(si.returned_quantity, 0), 0) * 10000) AS INTEGER)
      - COALESCE((SELECT SUM(r.q_u) FROM rline r WHERE r.sale_id = si.sale_id AND r.sale_item_id = si.id), 0), 0)) AS short_u
  FROM sale_items si WHERE si.sale_id IN (SELECT sale_id FROM plan)
  GROUP BY si.sale_id, si.product_id
),
quantity AS (
  SELECT p.sale_id,
    CASE WHEN (EXISTS (SELECT 1 FROM rline r WHERE r.sale_id = p.sale_id)
        OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = p.sale_id AND si.returned_quantity > 0))
      AND NOT EXISTS (SELECT 1 FROM short h WHERE h.sale_id = p.sale_id AND h.short_u > CASE WHEN h.product_id IS NULL THEN 0
        ELSE COALESCE((SELECT SUM(r.q_u) FROM rline r WHERE r.sale_id = h.sale_id AND r.on_line = 0 AND r.product_id = h.product_id), 0) END)
      THEN 'returned' ELSE 'partial_return' END AS quantity_status
  FROM plan p
),
plan_status AS (
  SELECT p.*, q.quantity_status,
    CASE WHEN p.status_word IN ('returned', 'partial_return') AND p.owes_after = 1 THEN 'awaiting_payment'
      WHEN p.status_word = 'awaiting_payment' AND p.owes_after = 0 THEN q.quantity_status
      ELSE p.prior_sale_status END AS new_sale_status,
    CASE WHEN p.status_word = 'awaiting_payment' AND p.owes_after = 0 THEN 'awaiting_payment'
      ELSE p.prior_status_before_return END AS new_status_before_return
  FROM plan p JOIN quantity q ON q.sale_id = p.sale_id
)
-- plan:end
,
backfill AS (
  SELECT w.id AS return_id, w.sale_id, c.total_refund_usd AS refund_usd,
    MIN(w.red_u / 10000.0, c.total_refund_usd) AS owed_reduction_usd,
    p.prior_sale_status, p.new_sale_status, p.prior_status_before_return, p.new_status_before_return
  FROM walk w JOIN candidate c ON c.id = w.id JOIN plan_status p ON p.sale_id = w.sale_id
)
INSERT OR IGNORE INTO return_owed_backfill_0238 (return_id, sale_id, refund_usd, owed_reduction_usd, prior_sale_status, new_sale_status,
  prior_status_before_return, new_status_before_return)
SELECT return_id, sale_id, refund_usd, owed_reduction_usd, prior_sale_status, new_sale_status,
  prior_status_before_return, new_status_before_return FROM backfill ORDER BY return_id;

UPDATE sales
SET sale_status = (SELECT b.new_sale_status FROM return_owed_backfill_0238 b WHERE b.sale_id = sales.id ORDER BY b.return_id LIMIT 1),
  status_before_return = (SELECT b.new_status_before_return FROM return_owed_backfill_0238 b WHERE b.sale_id = sales.id ORDER BY b.return_id LIMIT 1)
WHERE id IN (
  SELECT b.sale_id FROM return_owed_backfill_0238 b JOIN returns r ON r.id = b.return_id
  WHERE r.refund_currency IS NULL
);

UPDATE returns
SET owed_reduction_usd = (SELECT b.owed_reduction_usd FROM return_owed_backfill_0238 b WHERE b.return_id = returns.id),
  refund_currency = 'USD'
WHERE refund_currency IS NULL AND id IN (SELECT return_id FROM return_owed_backfill_0238);

UPDATE return_owed_backfill_0238
SET sale_revision = COALESCE((SELECT w.revision FROM sale_write_revisions w WHERE w.sale_id = return_owed_backfill_0238.sale_id), 0)
WHERE sale_revision IS NULL;
