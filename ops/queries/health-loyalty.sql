-- health-loyalty: membership points are computed from sales, never stored
-- (lib/saleCustomerAssignmentGuard.ts rawPointsSql), so the checks are on the
-- inputs of that formula (DATA-MATCH DM-14).
--   programme_on              the readers' rule: absent key = ON; '1','true','yes','on' = ON
--   legacy_sales_accruing     imported sales (legacy_receipt_number) with loyalty_accrual 1:
--                             owner rule, historical sales never accrue -> 0
--   accruing_since_switch_off live sales created after migration 0179 (the switch-off)
--                             that accrue while the programme is off -> 0
--   redeemed_since_switch_off points redeemed on sales after 0179 while off -> 0
--   live_adjustments, live_share_rewards   un-voided ledger rows (0117/0179 voided all)
--   returns_deducting_unaccrued  M5 (SCAN1 L19): active customer refunds with a customer
--                             on sales that never accrued (loyalty_accrual 0 or Not Paid)
-- Needs d1_migrations (production D1 has it; the fixture test creates it).
-- ops:min-rows 1
-- ops:max-rows 1
WITH cfg AS MATERIALIZED (
  SELECT
    CASE WHEN (SELECT value FROM settings WHERE key = 'loyalty_points_enabled') IS NULL THEN 1
      WHEN lower(trim((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'))) IN ('1', 'true', 'yes', 'on') THEN 1
      ELSE 0 END AS on_flag,
    COALESCE((SELECT MIN(applied_at) FROM d1_migrations WHERE name LIKE '0179%'), '9999-12-31') AS off_at
)
SELECT
  (SELECT on_flag FROM cfg) AS programme_on,
  (SELECT off_at FROM cfg) AS switch_off_applied_at,
  (SELECT COUNT(*) FROM sales WHERE COALESCE(legacy_receipt_number, '') <> '' AND COALESCE(loyalty_accrual, 1) = 1
     AND COALESCE(NULLIF(sale_status, ''), 'completed') <> 'cancelled') AS legacy_sales_accruing,
  (SELECT COUNT(*) FROM sales, cfg WHERE cfg.on_flag = 0 AND sales.created_at >= cfg.off_at
     AND COALESCE(sales.loyalty_accrual, 1) = 1 AND sales.customer_id IS NOT NULL
     AND COALESCE(NULLIF(sales.sale_status, ''), 'completed') NOT IN ('cancelled', 'awaiting_payment')
     AND (COALESCE(sales.total_usd, 0) <> 0 OR COALESCE(sales.total_khr, 0) <> 0)) AS accruing_since_switch_off,
  (SELECT COUNT(*) FROM sales, cfg WHERE cfg.on_flag = 0 AND sales.created_at >= cfg.off_at
     AND COALESCE(sales.membership_points_redeemed, 0) <> 0) AS redeemed_since_switch_off,
  (SELECT COUNT(*) FROM loyalty_point_adjustments WHERE voided_at IS NULL AND COALESCE(points, 0) <> 0) AS live_adjustments,
  (SELECT COUNT(*) FROM customer_share_submissions WHERE status = 'approved' AND reward_points_voided_at IS NULL
     AND COALESCE(reward_points, 0) <> 0) AS live_share_rewards,
  (SELECT COUNT(*) FROM returns r JOIN sales s ON s.id = r.sale_id
     WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND COALESCE(NULLIF(r.status, ''), 'completed') <> 'cancelled'
       AND r.customer_id IS NOT NULL AND (COALESCE(r.total_refund_usd, 0) <> 0 OR COALESCE(r.total_refund_khr, 0) <> 0)
       AND (COALESCE(s.loyalty_accrual, 1) = 0 OR COALESCE(NULLIF(s.status_before_return, ''), s.sale_status) = 'awaiting_payment')) AS returns_deducting_unaccrued
