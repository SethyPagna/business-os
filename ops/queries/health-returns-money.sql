-- health-returns-money: customer refunds against their own rule, their sale, and
-- the sale's status (DATA-MATCH DM-09, DM-10). v1 refunds are written by
-- lib/refundMoneyPrecision.ts buildRefundMoneyPrecision and
-- lib/customerReturnEntitlement.ts (total_refund_khr = multiplyMoney4(usd, rate)).
--   v1_refund_equation        total_refund_usd <> calculated + adjustment, |adj| >= 0.01,
--                             or payout not whole cents
--   v1_refund_khr_twin        total_refund_khr vs total_refund_usd x exchange_rate (4dp)
--   riel_only_customer_returns  no dollar refund but a riel figure (forensics-m2 precondition)
--   sales_refunded_over_total   active v1 refunds of one sale above its total_usd
--   active_returns_on_not_paid  U11: an active customer return on a sale still Not Paid,
--                             or returned from Not Paid (the rows
--                             forensics-u11-return-on-not-paid-sale lists)
--   returns_on_missing_sale     customer returns whose sale row is gone
--   returned_status_without_active_return / active_return_on_unreturned_status
--                             sale_status vs returns (lib/returnBulkAction.ts:270, :476)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH rt AS MATERIALIZED (
  SELECT id, sale_id, COALESCE(return_scope, 'customer') AS scope, COALESCE(NULLIF(status, ''), 'completed') AS st,
    COALESCE(money_precision_version, 0) AS mpv, COALESCE(total_refund_usd, 0) AS usd, COALESCE(total_refund_khr, 0) AS khr,
    calculated_refund_usd AS calc, COALESCE(rounding_adjustment_usd, 0) AS adj, exchange_rate AS rate
  FROM returns
),
act AS MATERIALIZED (
  SELECT sale_id, SUM(CASE WHEN mpv = 1 THEN usd ELSE 0 END) AS v1_refunded, COUNT(*) AS n
  FROM rt WHERE scope = 'customer' AND st <> 'cancelled' AND sale_id IS NOT NULL GROUP BY sale_id
)
SELECT
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer') AS customer_returns,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND (calc IS NULL OR ABS(usd - calc - adj) > 0.00005
     OR ABS(adj) >= 0.01 OR ABS(usd * 100 - ROUND(usd * 100)) > 0.00005)) AS v1_refund_equation,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND rate > 0 AND ABS(khr - usd * rate) > 0.00005) AS v1_refund_khr_twin,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND usd = 0 AND khr <> 0) AS riel_only_customer_returns,
  (SELECT COUNT(*) FROM act a JOIN sales s ON s.id = a.sale_id WHERE a.v1_refunded > COALESCE(s.total_usd, 0) + 0.005) AS sales_refunded_over_total,
  (SELECT COUNT(*) FROM rt r JOIN sales s ON s.id = r.sale_id WHERE r.scope = 'customer' AND r.st <> 'cancelled'
     AND (s.sale_status = 'awaiting_payment'
       OR (s.sale_status IN ('returned', 'partial_return') AND s.status_before_return = 'awaiting_payment'))) AS active_returns_on_not_paid,
  (SELECT COUNT(*) FROM rt r WHERE r.scope = 'customer' AND r.sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = r.sale_id)) AS returns_on_missing_sale,
  (SELECT COUNT(*) FROM sales s WHERE s.sale_status IN ('returned', 'partial_return')
     AND NOT EXISTS (SELECT 1 FROM act a WHERE a.sale_id = s.id)) AS returned_status_without_active_return,
  (SELECT COUNT(*) FROM act a JOIN sales s ON s.id = a.sale_id
     WHERE COALESCE(NULLIF(s.sale_status, ''), 'completed') NOT IN ('returned', 'partial_return', 'cancelled')) AS active_return_on_unreturned_status
