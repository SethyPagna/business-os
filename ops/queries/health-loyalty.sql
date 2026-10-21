-- health-loyalty: membership points are computed from sales, never stored
-- (lib/saleCustomerAssignmentGuard.ts rawPointsSql), so the checks are on the
-- inputs of that formula (DATA-MATCH DM-14). Needs migration 0251.
-- Since 0251 the programme is OFF (settings loyalty_points_enabled 'false') and ONLY activity
-- after the reset checkpoint counts: system_flags 'loyalty_points_reset' stores the highest
-- sales / returns / submissions / adjustments id at the reset, and the formula adds up
-- sales and refunds with a higher id, approved share rewards with a higher id that were born
-- eligible, and ledger adjustments with a higher id (lib/customerPointsReturn.ts). Triggers
-- born in 0251 stamp loyalty_accrual 0 on every sale inserted while the programme is off, refuse
-- positive adjustments and rewards while it is off, and make a sale's earning decision immutable.
-- An ABSENT key now reads OFF (lib/loyaltyEligibility.ts loyaltyPointsEnabled; before 0251 it read ON).
--   programme_on              1 for '1','true','yes','on' (trimmed, any case); absent or anything else 0
--   reset_present             1 when the checkpoint row exists (POSITIVE CONTROL: 0 means the formula
--                             counts every sale ever made)
--   switch_off_since          when the key was last written (settings.updated_at), else the reset time:
--                             the start of "the programme has been off"; any later save moves it
--                             forward, which can only hide a violation, never invent one
--   legacy_sales_accruing     imported sales (legacy_receipt_number, or the sales import's own
--                             client_request_id 'sales-import:...') past the checkpoint that still
--                             accrue: owner rule, historical sales never accrue -> 0
--   accruing_since_switch_off sales with a customer made after switch_off_since, paid, accruing, off -> 0
--   redeemed_since_switch_off points redeemed on sales made after switch_off_since while off -> 0
--   live_adjustments, live_share_rewards   un-voided ledger rows and eligible approved rewards
--                             past the checkpoint (0 while the programme has never been on)
--   returns_deducting_unaccrued  M5 remainder: refunds past the checkpoint, with a customer, on a sale
--                             that reads Not Paid and so earned nothing yet -- the formula still
--                             deducts them (the accrual-0 half is fixed in customerPointsReturnSql)
-- ops:min-rows 1
-- ops:max-rows 1
WITH cfg AS MATERIALIZED (
  SELECT
    CASE WHEN lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END AS on_flag,
    (SELECT value FROM system_flags WHERE key = 'loyalty_points_reset') AS reset_json,
    COALESCE((SELECT updated_at FROM settings WHERE key = 'loyalty_points_enabled'),
      (SELECT json_extract(value, '$.reset_at') FROM system_flags WHERE key = 'loyalty_points_reset'), '9999-12-31') AS off_at
),
cp AS MATERIALIZED (
  SELECT on_flag, off_at, reset_json IS NOT NULL AS present,
    COALESCE(json_extract(reset_json, '$.sales'), 0) AS sales_id, COALESCE(json_extract(reset_json, '$.returns'), 0) AS returns_id,
    COALESCE(json_extract(reset_json, '$.submissions'), 0) AS submissions_id, COALESCE(json_extract(reset_json, '$.adjustments'), 0) AS adjustments_id
  FROM cfg
)
SELECT
  (SELECT on_flag FROM cp) AS programme_on,
  (SELECT present FROM cp) AS reset_present,
  (SELECT off_at FROM cp) AS switch_off_since,
  (SELECT COUNT(*) FROM sales, cp WHERE sales.id > cp.sales_id
     AND (COALESCE(sales.legacy_receipt_number, '') <> '' OR (sales.client_request_id >= 'sales-import:' AND sales.client_request_id < 'sales-import;'))
     AND COALESCE(sales.loyalty_accrual, 1) = 1 AND COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled') AS legacy_sales_accruing,
  (SELECT COUNT(*) FROM sales, cp WHERE cp.on_flag = 0 AND sales.id > cp.sales_id AND datetime(sales.created_at) >= datetime(cp.off_at)
     AND COALESCE(sales.loyalty_accrual, 1) = 1 AND sales.customer_id IS NOT NULL
     AND COALESCE(NULLIF(sales.sale_status, ''), 'completed') NOT IN ('cancelled', 'awaiting_payment')
     AND (COALESCE(sales.total_usd, 0) <> 0 OR COALESCE(sales.total_khr, 0) <> 0)) AS accruing_since_switch_off,
  (SELECT COUNT(*) FROM sales, cp WHERE cp.on_flag = 0 AND sales.id > cp.sales_id AND datetime(sales.created_at) >= datetime(cp.off_at)
     AND COALESCE(sales.membership_points_redeemed, 0) <> 0) AS redeemed_since_switch_off,
  (SELECT COUNT(*) FROM loyalty_point_adjustments a, cp WHERE a.id > cp.adjustments_id AND a.voided_at IS NULL AND COALESCE(a.points, 0) <> 0) AS live_adjustments,
  (SELECT COUNT(*) FROM customer_share_submissions x, cp WHERE x.id > cp.submissions_id AND x.loyalty_eligible = 1
     AND x.status = 'approved' AND x.reward_points_voided_at IS NULL AND COALESCE(x.reward_points, 0) <> 0) AS live_share_rewards,
  (SELECT COUNT(*) FROM returns r JOIN sales s ON s.id = r.sale_id, cp
     WHERE r.id > cp.returns_id AND s.id > cp.sales_id
       AND COALESCE(r.return_scope, 'customer') = 'customer' AND COALESCE(NULLIF(r.status, ''), 'completed') <> 'cancelled'
       AND r.customer_id IS NOT NULL AND (COALESCE(r.total_refund_usd, 0) <> 0 OR COALESCE(r.total_refund_khr, 0) <> 0)
       AND COALESCE(s.loyalty_accrual, 1) = 1
       AND (s.sale_status = 'awaiting_payment' OR (s.sale_status IN ('partial_return', 'returned') AND s.status_before_return = 'awaiting_payment'))) AS returns_deducting_unaccrued
