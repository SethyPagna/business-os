-- SCAN2 U11, re-scoped to the schema after 0260 and 0263: active customer returns
-- recorded BEFORE migration 0260 (refund_currency NULL) on a sale that reads Not Paid.
-- Owner rulings (29 Sep, 5-6 Oct, 20 Oct 2026): a return on a Not Paid sale is allowed;
-- it lowers the debt and pays no cash, and a return never changes sale_status. New
-- returns record owed_reduction_usd (lib/returnRefundSplit.ts planReturnMoney), so they
-- are healthy by construction and are not listed. A row recorded earlier has no split:
-- lib/shiftReconciliation.ts refundDrawerUsdSql counts its WHOLE total_refund_usd as
-- dollar cash that left the drawer, while returnDebtLoweredSql reads the same row as all
-- debt on a Not Paid sale. These are the rows the held 0265 backfill (ops/scripts/migration/held/0265_return_owed_backfill.sql,
-- which replaces 0238 for the two-status model) must rewrite; the rows it refuses stay listed.
-- A Not Paid sale is the two-status reading (saleReadsNotPaid): sale_status
-- 'awaiting_payment', or a retired return label (partial_return / returned, live until the
-- held 0264) whose status_before_return was 'awaiting_payment'.
-- Cancelled returns and supplier returns are out.
-- Columns:
--   return_id, return_number, return_created_at, return_money_version
--   total_refund_usd, total_refund_khr   the refund the drawer was told to pay out
--   sale_id, receipt_number, sale_created_at, sale_status, status_before_return, return_state
--   sale_total_usd, sale_paid_usd, sale_paid_khr, sale_exchange_rate
--   shift_id     lowest id of the shifts whose window holds the return, as
--                lib/shiftReconciliation.ts shiftFilters builds it: [opened_at,
--                closed_at or cancelled_at or open), the shift's branch unless it
--                has none, its user unless shop_wide; NULL when no shift holds it
-- Each row is cash the drawer expected out although the customer was only owed less.
-- Repair (proposed, not run): none by SQL; the held 0265 backfill sets refund_currency and
-- owed_reduction_usd per row after the owner's go (it needs 0260 and the held 0264 first).
-- Ids, dates and amounts only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 2000
SELECT
  r.id AS return_id, r.return_number, r.created_at AS return_created_at,
  COALESCE(r.money_precision_version, 0) AS return_money_version,
  r.total_refund_usd, r.total_refund_khr,
  s.id AS sale_id, s.receipt_number, s.created_at AS sale_created_at,
  s.sale_status, s.status_before_return, s.return_state,
  s.total_usd AS sale_total_usd, s.amount_paid_usd AS sale_paid_usd, s.amount_paid_khr AS sale_paid_khr,
  s.exchange_rate AS sale_exchange_rate,
  (SELECT MIN(sh.id) FROM shift_sessions sh
    WHERE datetime(r.created_at) >= datetime(sh.opened_at)
      AND datetime(r.created_at) < COALESCE(datetime(COALESCE(sh.closed_at, sh.cancelled_at)), '9999-12-31 23:59:59')
      AND (sh.branch_id IS NULL OR sh.branch_id IS r.branch_id)
      AND (sh.scope_mode = 'shop_wide' OR sh.user_id IS r.cashier_id)) AS shift_id
FROM returns r
JOIN sales s ON s.id = r.sale_id
WHERE COALESCE(r.return_scope, 'customer') = 'customer'
  AND COALESCE(NULLIF(r.status, ''), 'completed') <> 'cancelled'
  AND r.refund_currency IS NULL
  AND COALESCE(r.total_refund_usd, 0) > 0
  AND (
    s.sale_status = 'awaiting_payment'
    OR (s.sale_status IN ('partial_return', 'returned') AND s.status_before_return = 'awaiting_payment')
  )
ORDER BY r.id
LIMIT 2000
