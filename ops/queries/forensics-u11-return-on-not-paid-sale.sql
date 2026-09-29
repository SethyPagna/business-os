-- SCAN2 U11: active customer returns recorded on a Not Paid (awaiting_payment)
-- sale. routes/returns.ts refused only a cancelled sale, so a return on a sale
-- still owed was accepted: the refund is sized from the sale value, the drawer
-- expects that refund to leave, and the sale moves to partial_return/returned,
-- where it can never be settled and no report counts it as owed.
-- A return that moved the sale's status stored the old one in
-- sales.status_before_return (routes/returns.ts, the sales status UPDATE); a
-- return that did not move it leaves sale_status = 'awaiting_payment'.
-- Cancelled returns (a cancel restores the sale) and supplier returns are out.
-- Columns:
--   return_id, return_number, return_created_at, return_money_version
--   total_refund_usd, total_refund_khr   the refund the drawer was told to pay out
--   sale_id, receipt_number, sale_created_at, sale_status, status_before_return
--   sale_total_usd, sale_paid_usd, sale_paid_khr, sale_exchange_rate
--   shift_id     lowest id of the shifts whose window holds the return, as
--                lib/shiftReconciliation.ts shiftFilters builds it: [opened_at,
--                closed_at or cancelled_at or open), the shift's branch unless it
--                has none, its user unless shop_wide; NULL when no shift holds it
-- Each row is a debt that vanished plus a refund the drawer expected.
-- Repair (proposed, not run): none by SQL. Per row, the owner's answer to SCAN2
-- owner question 1 (refuse and cancel the return, or keep the balance owed less
-- what was paid) is applied through the app's return cancel and settle writers.
-- Ids, dates and amounts only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 2000
SELECT
  r.id AS return_id, r.return_number, r.created_at AS return_created_at,
  COALESCE(r.money_precision_version, 0) AS return_money_version,
  r.total_refund_usd, r.total_refund_khr,
  s.id AS sale_id, s.receipt_number, s.created_at AS sale_created_at,
  s.sale_status, s.status_before_return,
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
  AND (
    s.sale_status = 'awaiting_payment'
    OR (s.sale_status IN ('returned', 'partial_return') AND s.status_before_return = 'awaiting_payment')
  )
ORDER BY r.id
LIMIT 2000
