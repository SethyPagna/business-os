-- SCAN2 U2: sales whose stored exchange_rate is implausible. POST /sales takes
-- the client's exchange_rate and refuses only a rate of 0 or less
-- (lib/saleStatusResolution.ts), so a crafted rate with a riel tender reads as
-- paid and the drawer expects the wrong riel figure.
-- System sales only (legacy imports carry the old system's own rates).
-- A row is listed when its rate is
--   outside_band   NULL, or outside 3500..4700 riel per dollar (a wide band around
--                  the 4100 default of sales.exchange_rate), or
--   off_day_mode   more than 5% away from the most common rate of that Cambodia
--                  business day (UTC+7); a tie picks the rate nearest the setting
-- Settings keep no rate history, so settings_rate_now is today's value only.
-- Columns: sale_id, receipt_number, created_at, business_date, sale_status,
--   exchange_rate, day_mode_rate, day_sales, settings_rate_now,
--   riel_tender (1 when riel was tendered), amount_paid_khr, reason
-- A riel_tender = 1 row is the U2 exposure; the others only mis-state the riel twin.
-- Repair (proposed, not run): none by SQL; each riel_tender row is a drawer
-- question for the owner (count the riel actually taken for that shift).
-- Ids, dates, rates and the riel tender only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH cfg AS MATERIALIZED (
  SELECT COALESCE((SELECT CAST(value AS REAL) FROM settings WHERE key = 'exchange_rate' AND CAST(value AS REAL) > 0), 4100) AS rate_now
),
s AS MATERIALIZED (
  SELECT id, receipt_number, created_at, date(created_at, '+7 hours') AS bday, exchange_rate AS rate,
    COALESCE(NULLIF(sale_status, ''), 'completed') AS st, COALESCE(amount_paid_khr, 0) AS paid_khr
  FROM sales
  WHERE COALESCE(legacy_receipt_number, '') = ''
),
day_rate AS MATERIALIZED (
  SELECT bday, rate, COUNT(*) AS n FROM s WHERE rate > 0 GROUP BY bday, rate
),
day_mode AS MATERIALIZED (
  SELECT d.bday, SUM(d.n) AS day_sales,
    (SELECT r.rate FROM day_rate r, cfg WHERE r.bday = d.bday ORDER BY r.n DESC, ABS(r.rate - cfg.rate_now), r.rate LIMIT 1) AS mode_rate
  FROM day_rate d GROUP BY d.bday
)
SELECT
  s.id AS sale_id, s.receipt_number, s.created_at, s.bday AS business_date, s.st AS sale_status,
  s.rate AS exchange_rate, m.mode_rate AS day_mode_rate, m.day_sales, cfg.rate_now AS settings_rate_now,
  CASE WHEN s.paid_khr > 0 THEN 1 ELSE 0 END AS riel_tender, s.paid_khr AS amount_paid_khr,
  CASE WHEN s.rate IS NULL OR s.rate < 3500 OR s.rate > 4700 THEN 'outside_band' ELSE 'off_day_mode' END AS reason
FROM s
CROSS JOIN cfg
LEFT JOIN day_mode m ON m.bday = s.bday
WHERE s.rate IS NULL OR s.rate < 3500 OR s.rate > 4700
   OR ABS(s.rate - m.mode_rate) > 0.05 * m.mode_rate
ORDER BY riel_tender DESC, s.id
LIMIT 2000
