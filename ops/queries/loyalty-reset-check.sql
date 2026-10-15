-- Aggregate-only reset postflight; raw nonzero balances include negative debt.
WITH settings_map AS (
  SELECT
    (SELECT value FROM system_flags WHERE key = 'loyalty_points_reset') AS since,
    CASE WHEN lower(COALESCE((SELECT value FROM settings WHERE key = 'customer_portal_points_basis'), '')) = 'khr' THEN 'khr' ELSE 'usd' END AS basis,
    COALESCE(CAST((SELECT value FROM settings WHERE key = 'customer_portal_points_per_usd') AS REAL), 1) AS per_usd,
    COALESCE(CAST((SELECT value FROM settings WHERE key = 'exchange_rate') AS REAL), 4100) AS exchange
),
rate AS (
  SELECT since, basis, per_usd,
    COALESCE(CAST((SELECT value FROM settings WHERE key = 'customer_portal_points_per_khr') AS REAL),
      CASE WHEN per_usd > 0 AND exchange > 0 THEN per_usd / exchange ELSE 0 END) AS per_khr
  FROM settings_map
),
ledger AS (
  SELECT s.customer_id AS customer_id,
    (CASE WHEN COALESCE(NULLIF(s.sale_status, ''), 'completed') <> 'awaiting_payment' AND COALESCE(s.loyalty_accrual, 1) = 1
      AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',s.id,s.client_request_id) AND value = 'skipped')
      THEN CASE WHEN r.basis = 'khr' THEN COALESCE(s.total_khr, 0) * r.per_khr ELSE COALESCE(s.total_usd, 0) * r.per_usd END ELSE 0 END
     - COALESCE(s.membership_points_redeemed, 0)) AS points,
    CASE WHEN s.id > COALESCE(json_extract(r.since, '$.sales'), 0) THEN 1 ELSE 0 END AS since_ok
  FROM sales s CROSS JOIN rate r
  WHERE s.customer_id IS NOT NULL AND COALESCE(NULLIF(s.sale_status, ''), 'completed') <> 'cancelled'
  UNION ALL
  SELECT rt.customer_id,
    -(CASE WHEN r.basis = 'khr' THEN COALESCE(rt.total_refund_khr, 0) * r.per_khr ELSE COALESCE(rt.total_refund_usd, 0) * r.per_usd END),
    CASE WHEN (rt.id > COALESCE(json_extract(r.since, '$.returns'), 0))
      AND (rs.id IS NULL OR rs.id > COALESCE(json_extract(r.since, '$.sales'), 0)) THEN 1 ELSE 0 END
  FROM returns rt CROSS JOIN rate r LEFT JOIN sales rs ON rs.id = rt.sale_id
  WHERE rt.customer_id IS NOT NULL AND COALESCE(NULLIF(rt.status, ''), 'completed') <> 'cancelled'
    AND COALESCE(rt.return_scope, 'customer') <> 'supplier' AND COALESCE(rs.loyalty_accrual, 1) <> 0
    AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = printf('loyalty_sale_earning:%d:%s',rs.id,rs.client_request_id) AND value = 'skipped')
  UNION ALL
  SELECT cs.customer_id, COALESCE(cs.reward_points, 0),
    CASE WHEN cs.id > COALESCE(json_extract(r.since, '$.submissions'), 0) AND cs.loyalty_eligible = 1 THEN 1 ELSE 0 END
  FROM customer_share_submissions cs CROSS JOIN rate r
  WHERE cs.customer_id IS NOT NULL AND cs.status = 'approved' AND cs.reward_points_voided_at IS NULL
  UNION ALL
  SELECT a.customer_id, COALESCE(a.points, 0),
    CASE WHEN a.id > COALESCE(json_extract(r.since, '$.adjustments'), 0) THEN 1 ELSE 0 END
  FROM loyalty_point_adjustments a CROSS JOIN rate r
  WHERE a.customer_id IS NOT NULL AND a.voided_at IS NULL
),
balances AS (
  SELECT customer_id,
    SUM(points) AS all_history,
    SUM(CASE WHEN since_ok = 1 THEN points ELSE 0 END) AS after_reset
  FROM ledger GROUP BY customer_id
)
SELECT
  (SELECT json_extract(since, '$.reset_at') FROM rate) AS reset_at,
  (SELECT COUNT(*) FROM customers) AS customers_total,
  (SELECT COUNT(*) FROM balances b JOIN customers c ON c.id = b.customer_id WHERE b.all_history > 0.0000001) AS customers_nonzero_all_history,
  (SELECT COUNT(*) FROM balances b JOIN customers c ON c.id = b.customer_id WHERE ABS(b.after_reset) > 0.0000001) AS customers_nonzero_after_reset,
  (SELECT COUNT(*) FROM balances b JOIN customers c ON c.id = b.customer_id WHERE b.all_history > 0.0000001) -
  (SELECT COUNT(*) FROM balances b JOIN customers c ON c.id = b.customer_id WHERE b.after_reset > 0.0000001 AND b.all_history > 0.0000001) AS customers_cleared_by_reset;
