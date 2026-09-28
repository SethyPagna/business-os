-- SCAN1 M7: lost-fee expenses written by a sale cancellation whose fee_date is
-- not the Cambodia business day (UTC+7) of that cancellation.
-- PATCH /api/sales/:id/status (routes/sales.ts) wrote fee_date = date('now'),
-- the UTC day, and grouped status (lib/saleBulkStatus.ts) writes
-- stamp.slice(0, 10), also the UTC day. A cancel between 00:00 and 06:59
-- Cambodia time therefore booked the loss on the previous business day, after
-- that day's Telegram report, and outside the day Expenses/Reports show it.
-- Only the fee a sale still links (sales.cancel_fee_id) is a cancellation fee;
-- an un-cancel deletes it. Driven by fees (small); sales is read by primary key.
-- Read-only. Ids, dates and amounts only.
--   fee_id, sale_id, receipt_number, cancelled_at (UTC), fee_date,
--   business_date            the day the fee should carry
--   amount_usd, amount_khr, fee_created_at, fee_updated_at
--   edited                   1 when the fee row changed after it was written
--                            (someone may have re-dated it on purpose: review)
--   writer                   single (PATCH status) or grouped (bulk status,
--                            negative fee ids)
-- ops:min-rows 0
-- ops:max-rows 2000
SELECT
  f.id AS fee_id, s.id AS sale_id, s.receipt_number, s.cancelled_at, f.fee_date,
  date(s.cancelled_at, '+7 hours') AS business_date,
  f.amount_usd, f.amount_khr, f.created_at AS fee_created_at, f.updated_at AS fee_updated_at,
  CASE WHEN COALESCE(f.updated_at, '') <> COALESCE(f.created_at, '') THEN 1 ELSE 0 END AS edited,
  CASE WHEN f.id < 0 THEN 'grouped' ELSE 'single' END AS writer
FROM fees f
JOIN sales s ON s.id = f.sale_id AND s.cancel_fee_id = f.id
WHERE f.sale_id IS NOT NULL
  AND s.cancelled_at IS NOT NULL
  AND f.fee_date <> date(s.cancelled_at, '+7 hours')
ORDER BY s.cancelled_at, f.id
LIMIT 2000
