-- health-returns-money: customer refunds against their own rule, their sale, and
-- the sale's return tag (DATA-MATCH DM-09, DM-10). Needs migrations 0260 and 0263.
-- v1 refunds are written by lib/refundMoneyPrecision.ts buildRefundMoneyPrecision and
-- lib/customerReturnEntitlement.ts (total_refund_khr = multiplyMoney4(usd, rate)).
-- A return never changes sale_status (owner, 20 Oct 2026): it sets sales.return_state
-- (partial | full); live rows keep the retired labels partial_return / returned until
-- the held 0264, and a retired label outranks the column (saleStoredState).
-- A return on a Not Paid sale is legal: total_refund_usd is the return value (revenue),
-- owed_reduction_usd the part that lowered the debt, the rest is cash
-- (lib/returnRefundSplit.ts). A row recorded before 0260 (refund_currency NULL) reads
-- as all debt on a Not Paid sale and as all cash on a paid one (returnDebtLoweredSql).
--   v1_refund_equation        total_refund_usd <> calculated + adjustment, |adj| >= 0.01,
--                             or payout not whole cents
--   v1_refund_khr_twin        total_refund_khr vs total_refund_usd x exchange_rate (4dp),
--                             refunds not paid in riel
--   v1_refund_khr_paid        the same for refund_currency KHR: never above the twin and less
--                             than 100 riel below it (the riel round-down to 100 is not in the
--                             Worker yet; the figure is exact today and stays inside this band after)
--   riel_only_customer_returns  no dollar value but a riel figure (forensics-m2 precondition)
--   sales_refunded_over_total   active v1 refunds of one sale above its total_usd
--   returns_on_not_paid_before_0260  active customer returns recorded before 0260 on a sale that
--                             reads Not Paid: the drawer still counts each whole refund as cash
--                             until the held 0265 backfill (ops/scripts/migration/held, replaces
--                             0238) rewrites it; it leaves refused rows NULL (RATCHET down, not
--                             necessarily to 0; rows: forensics-u11-return-on-not-paid-sale)
--   debt_lowered_over_total   debt lowered by one sale's active returns above its total_usd
--   returns_on_missing_sale   customer returns whose sale row is gone
--   return_tag_without_evidence / return_evidence_without_tag
--                             a tagged sale with no active customer return and no unit an
--                             import recorded as returned, and the reverse (not cancelled)
--   retired_return_labels     sales still carrying partial_return / returned (INFO; only falls)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH rt AS MATERIALIZED (
  SELECT id, sale_id, COALESCE(return_scope, 'customer') AS scope, COALESCE(NULLIF(status, ''), 'completed') AS st,
    COALESCE(money_precision_version, 0) AS mpv, COALESCE(total_refund_usd, 0) AS usd, COALESCE(total_refund_khr, 0) AS khr,
    calculated_refund_usd AS calc, COALESCE(rounding_adjustment_usd, 0) AS adj, exchange_rate AS rate,
    refund_currency AS cur, COALESCE(owed_reduction_usd, 0) AS owed
  FROM returns
),
act AS MATERIALIZED (
  SELECT sale_id, SUM(CASE WHEN mpv = 1 THEN usd ELSE 0 END) AS v1_refunded,
    SUM(CASE WHEN cur IS NULL THEN usd ELSE 0 END) AS value_before_0260,
    SUM(CASE WHEN cur IS NULL THEN 0 ELSE owed END) AS lowered_0260
  FROM rt WHERE scope = 'customer' AND st <> 'cancelled' AND sale_id IS NOT NULL GROUP BY sale_id
),
imp AS MATERIALIZED (
  SELECT DISTINCT sale_id FROM sale_items WHERE COALESCE(returned_quantity, 0) > 0
),
sl AS MATERIALIZED (
  SELECT id, sale_status, COALESCE(total_usd, 0) AS total,
    CASE WHEN sale_status = 'awaiting_payment' OR (sale_status IN ('partial_return', 'returned') AND status_before_return = 'awaiting_payment') THEN 1 ELSE 0 END AS not_paid,
    CASE sale_status WHEN 'returned' THEN 'full' WHEN 'partial_return' THEN 'partial' ELSE return_state END AS tag
  FROM sales
)
SELECT
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer') AS customer_returns,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND (calc IS NULL OR ABS(usd - calc - adj) > 0.00005
     OR ABS(adj) >= 0.01 OR ABS(usd * 100 - ROUND(usd * 100)) > 0.00005)) AS v1_refund_equation,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND cur IS NOT 'KHR' AND rate > 0
     AND ABS(khr - usd * rate) > 0.00005) AS v1_refund_khr_twin,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND mpv = 1 AND cur = 'KHR' AND rate > 0
     AND (khr > usd * rate + 0.00005 OR khr <= usd * rate - 100)) AS v1_refund_khr_paid,
  (SELECT COUNT(*) FROM rt WHERE scope = 'customer' AND usd = 0 AND khr <> 0) AS riel_only_customer_returns,
  (SELECT COUNT(*) FROM act a JOIN sl ON sl.id = a.sale_id WHERE a.v1_refunded > sl.total + 0.005) AS sales_refunded_over_total,
  (SELECT COUNT(*) FROM rt r JOIN sl ON sl.id = r.sale_id WHERE r.scope = 'customer' AND r.st <> 'cancelled'
     AND r.cur IS NULL AND r.usd > 0 AND sl.not_paid = 1) AS returns_on_not_paid_before_0260,
  (SELECT COUNT(*) FROM act a JOIN sl ON sl.id = a.sale_id
     WHERE a.lowered_0260 + CASE WHEN sl.not_paid = 1 THEN a.value_before_0260 ELSE 0 END > sl.total + 0.005) AS debt_lowered_over_total,
  (SELECT COUNT(*) FROM rt r WHERE r.scope = 'customer' AND r.sale_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = r.sale_id)) AS returns_on_missing_sale,
  (SELECT COUNT(*) FROM sl LEFT JOIN act a ON a.sale_id = sl.id LEFT JOIN imp ON imp.sale_id = sl.id
     WHERE sl.sale_status IS NOT 'cancelled' AND sl.tag IS NOT NULL AND a.sale_id IS NULL AND imp.sale_id IS NULL) AS return_tag_without_evidence,
  (SELECT COUNT(*) FROM sl LEFT JOIN act a ON a.sale_id = sl.id LEFT JOIN imp ON imp.sale_id = sl.id
     WHERE sl.sale_status IS NOT 'cancelled' AND sl.tag IS NULL AND (a.sale_id IS NOT NULL OR imp.sale_id IS NOT NULL)) AS return_evidence_without_tag,
  (SELECT COUNT(*) FROM sl WHERE sale_status IN ('partial_return', 'returned')) AS retired_return_labels
