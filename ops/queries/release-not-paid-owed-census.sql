-- Release 6.0.909 pre-deploy census: can every Not Paid sale's "still owed" be read?
-- READ-ONLY: one row of counts and money sums, no receipts, names or free text.
-- 6.0.909 converts riel deposits on Not Paid sales (sale_status 'awaiting_payment')
-- with the sale's exchange_rate. A sale with riel paid and no positive rate makes
-- the sales reports refuse (unsupported_row), so the deploy waits while
--   riel_paid_without_rate > 0
-- Context columns:
--   not_paid_sales / not_paid_with_riel   open Not Paid sales, and those with a riel deposit
--   not_paid_total_usd / not_paid_paid_usd   sums of total_usd and amount_paid_usd on them
--   checked_at_utc                         when this ran
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment') AS not_paid_sales,
  (SELECT COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment'
    AND COALESCE(amount_paid_khr, 0) <> 0) AS not_paid_with_riel,
  (SELECT COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment'
    AND COALESCE(amount_paid_khr, 0) <> 0
    AND (exchange_rate IS NULL OR exchange_rate <= 0)) AS riel_paid_without_rate,
  (SELECT ROUND(COALESCE(SUM(total_usd), 0), 2) FROM sales WHERE sale_status = 'awaiting_payment') AS not_paid_total_usd,
  (SELECT ROUND(COALESCE(SUM(amount_paid_usd), 0), 2) FROM sales WHERE sale_status = 'awaiting_payment') AS not_paid_paid_usd,
  datetime('now') AS checked_at_utc
