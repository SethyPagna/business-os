-- Release 6.0.909 pre-deploy census, v2 (corrects 6.0.918's release-not-paid-owed-census).
-- READ-ONLY: one row of counts, no receipts, names or free text.
-- The 6.0.909 report kernel treats a sale as Not Paid when
--   sale_status = 'awaiting_payment', or
--   sale_status IN ('partial_return','returned') AND status_before_return = 'awaiting_payment'
-- (salesAnalytics.ts, retired labels are still live data until 0264 ships). For those sales a
-- riel deposit needs a positive exchange rate; an empty, non-numeric or <= 0 rate makes every
-- report window containing the sale refuse (unsupported_row). The deploy waits while
--   riel_paid_without_rate > 0
-- Context columns:
--   not_paid_kernel_sales     sales the kernel reads as Not Paid (both shapes above)
--   not_paid_returned_label   of those, the ones still carrying a retired return label
--   not_paid_with_riel        of those, the ones with a riel deposit
--   checked_at_utc            when this ran
-- ops:min-rows 1
-- ops:max-rows 1
WITH np AS (
  SELECT amount_paid_khr, exchange_rate, sale_status
  FROM sales
  WHERE sale_status = 'awaiting_payment'
     OR (sale_status IN ('partial_return', 'returned') AND status_before_return = 'awaiting_payment')
)
SELECT
  (SELECT COUNT(*) FROM np) AS not_paid_kernel_sales,
  (SELECT COUNT(*) FROM np WHERE sale_status <> 'awaiting_payment') AS not_paid_returned_label,
  (SELECT COUNT(*) FROM np WHERE COALESCE(CAST(amount_paid_khr AS REAL), 0) <> 0) AS not_paid_with_riel,
  (SELECT COUNT(*) FROM np WHERE COALESCE(CAST(amount_paid_khr AS REAL), 0) <> 0
     AND COALESCE(CAST(exchange_rate AS REAL), 0) <= 0) AS riel_paid_without_rate,
  datetime('now') AS checked_at_utc
