-- SCAN2 PP-10: sales whose membership discount is not what the points redeemed
-- are worth. POST /sales checks only that the customer holds the points
-- (lib/saleCustomerAssignmentGuard.ts preparePointsRedemption), never points x
-- redeem value or whole units, so the discount is bounded only by the sale.
-- expected_discount_usd = CAST(points / redeem_points AS INTEGER) x redeem_value_usd
-- at TODAY's settings, read as routes/portal.ts buildPortalConfig does
-- (absent or not a number = the default, blank = 0):
--   redeem_points    customer_portal_redeem_points, default 100, whole, at least 1
--   redeem_value_usd customer_portal_redeem_value_usd, default 1, rounded, at least 0
-- Settings keep no history, so a sale made before a change of either setting is
-- a false candidate: APPROXIMATE, review each row.
--   over_value    discount above the expected value by more than half a cent
--   under_value   discount below it by more than half a cent (a till cap, or a
--                 setting changed since)
--   partial_units points not a whole number of redeem units (the POS redeems
--                 whole units only)
-- Columns: sale_id, receipt_number, created_at, sale_status, points_redeemed,
--   membership_discount_usd, expected_discount_usd, redeem_points_now,
--   redeem_value_usd_now, class
-- Repair (proposed, not run): none by SQL; an over_value row is a discount the
-- points did not pay for, an owner decision per customer.
-- Ids, dates, points and discount amounts only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH raw AS MATERIALIZED (
  SELECT trim((SELECT value FROM settings WHERE key = 'customer_portal_redeem_points')) AS rp,
    trim((SELECT value FROM settings WHERE key = 'customer_portal_redeem_value_usd')) AS rv
),
cfg AS MATERIALIZED (
  SELECT
    CASE WHEN rp IS NULL OR rp GLOB '*[^0-9.eE+-]*' THEN 100 WHEN rp = '' THEN 1
      ELSE MAX(1, CAST(CAST(rp AS REAL) AS INTEGER)) END AS redeem_points,
    CASE WHEN rv IS NULL OR rv GLOB '*[^0-9.eE+-]*' THEN 1 WHEN rv = '' THEN 0
      ELSE MAX(0, ROUND(CAST(rv AS REAL))) END AS redeem_value_usd
  FROM raw
),
s AS MATERIALIZED (
  SELECT x.id, x.receipt_number, x.created_at, COALESCE(NULLIF(x.sale_status, ''), 'completed') AS st,
    x.membership_points_redeemed AS points, COALESCE(x.membership_discount_usd, 0) AS discount,
    CAST(x.membership_points_redeemed / cfg.redeem_points AS INTEGER) * cfg.redeem_value_usd AS expected,
    cfg.redeem_points, cfg.redeem_value_usd,
    x.membership_points_redeemed - CAST(x.membership_points_redeemed / cfg.redeem_points AS INTEGER) * cfg.redeem_points AS leftover
  FROM sales x CROSS JOIN cfg
  WHERE COALESCE(x.membership_points_redeemed, 0) > 0
)
SELECT id AS sale_id, receipt_number, created_at, st AS sale_status, points AS points_redeemed,
  discount AS membership_discount_usd, expected AS expected_discount_usd,
  redeem_points AS redeem_points_now, redeem_value_usd AS redeem_value_usd_now,
  CASE
    WHEN discount > expected + 0.005 THEN 'over_value'
    WHEN discount < expected - 0.005 THEN 'under_value'
    ELSE 'partial_units'
  END AS class
FROM s
WHERE ABS(discount - expected) > 0.005 OR ABS(leftover) > 0.000001
ORDER BY id
LIMIT 2000
