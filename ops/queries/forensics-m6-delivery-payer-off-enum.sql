-- SCAN1 M6: sales whose delivery_fee_paid_by is not exactly 'customer' or
-- 'store' (NULL reads as the customer everywhere and is not listed).
-- POST /api/sales (routes/sales.ts) stored the posted value verbatim, and the
-- sales import (lib/importEngine.ts) stores the trimmed cell. The engines then
-- disagree: v1 totals and returns treat anything but 'customer' as shop-paid,
-- every report treats anything but 'store' as customer-billed, and
-- saleMutationHeaderQuote refuses later header-quoted edits of the sale.
-- One pass over sales (no index on the column); read-only.
--   sale_id, receipt_number, created_at, sale_status, is_delivery,
--   delivery_fee_paid_by        the stored value, verbatim
--   normalized_payer            customer/store after trim + lower-case, NULL
--                               when it is neither (owner decides)
--   delivery_fee_usd, subtotal_usd, discount_usd, membership_discount_usd,
--   tax_usd, rounding_adjustment_usd, total_usd
--   total_minus_base_usd        total - (subtotal - discounts + tax): about the
--                               fee when the total billed it to the customer,
--                               about 0 when the shop absorbed it
--   legacy_receipt_number       set on imported sales
--   money_precision_version
-- ops:min-rows 0
-- ops:max-rows 2000
SELECT
  s.id AS sale_id, s.receipt_number, s.created_at, s.sale_status, s.is_delivery,
  s.delivery_fee_paid_by,
  CASE WHEN lower(trim(s.delivery_fee_paid_by)) IN ('customer', 'store') THEN lower(trim(s.delivery_fee_paid_by)) END AS normalized_payer,
  s.delivery_fee_usd, s.subtotal_usd, s.discount_usd, s.membership_discount_usd, s.tax_usd,
  s.rounding_adjustment_usd, s.total_usd,
  ROUND(COALESCE(s.total_usd, 0) - (COALESCE(s.subtotal_usd, 0) - COALESCE(s.discount_usd, 0)
    - COALESCE(s.membership_discount_usd, 0) + COALESCE(s.tax_usd, 0)), 2) AS total_minus_base_usd,
  s.legacy_receipt_number, s.money_precision_version
FROM sales s
WHERE s.delivery_fee_paid_by IS NOT NULL
  AND s.delivery_fee_paid_by NOT IN ('customer', 'store')
ORDER BY s.id
LIMIT 2000
