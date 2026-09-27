-- F-forensics M1: customer return lines refunded at a price other than the one
-- the sale line was sold at, where the return line carries no sale_item_id but
-- its sale is on file and has a line of the same product.
-- routes/returns.ts resolves the refund price from the sale line only when
-- sale_item_id is sent (resolveRefundUnitPrice falls back to the posted price),
-- while the quantity cap already matches by product -- so on a legacy
-- (money_precision_version 0) sale the posted price was trusted.
--   return_id, return_created_at, return_status, sale_id, sale_mpv, return_mpv
--   return_item_id, product_id, quantity
--   refund_unit_usd / sold_unit_usd, refund_unit_khr / sold_unit_khr
--   over_refund_usd          (refund - sold) x quantity; + = customer got more back
--   matching_sale_lines      >1: several lines of the product on the sale (review)
--   created_via_app          1 when a return_create_receipts row exists (POST /returns)
--   edited                   1 when the return has edit movements (PATCH)
-- ops:min-rows 0
-- ops:max-rows 2000
WITH li AS (
  SELECT ri.id AS return_item_id, ri.return_id, ri.product_id, ri.quantity,
    ri.applied_price_usd AS refund_unit_usd, ri.applied_price_khr AS refund_unit_khr,
    r.sale_id, r.status, r.money_precision_version AS return_mpv, COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) AS return_created_at
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE ri.sale_item_id IS NULL AND r.sale_id IS NOT NULL AND ri.product_id IS NOT NULL
    AND COALESCE(r.return_scope, 'customer') = 'customer'
),
m AS (
  SELECT li.*, si.id AS sale_item_id, si.applied_price_usd AS sold_unit_usd, si.applied_price_khr AS sold_unit_khr,
    (SELECT COUNT(*) FROM sale_items z WHERE z.sale_id = li.sale_id AND z.product_id = li.product_id) AS matching_sale_lines
  FROM li JOIN sale_items si ON si.sale_id = li.sale_id AND si.product_id = li.product_id
)
SELECT
  m.return_id, m.return_created_at, COALESCE(m.status, 'completed') AS return_status, m.sale_id,
  s.money_precision_version AS sale_mpv, m.return_mpv,
  m.return_item_id, m.sale_item_id, m.product_id, m.quantity,
  m.refund_unit_usd, m.sold_unit_usd, m.refund_unit_khr, m.sold_unit_khr,
  ROUND((COALESCE(m.refund_unit_usd, 0) - COALESCE(m.sold_unit_usd, 0)) * m.quantity, 2) AS over_refund_usd,
  m.matching_sale_lines,
  CASE WHEN EXISTS (SELECT 1 FROM return_create_receipts c WHERE c.return_id = m.return_id) THEN 1 ELSE 0 END AS created_via_app,
  CASE WHEN EXISTS (SELECT 1 FROM inventory_movements e WHERE e.reference_id = m.return_id AND e.reason LIKE 'Return #% updated%') THEN 1 ELSE 0 END AS edited
FROM m JOIN sales s ON s.id = m.sale_id
WHERE ABS(COALESCE(m.refund_unit_usd, 0) - COALESCE(m.sold_unit_usd, 0)) > 0.005
   OR ABS(COALESCE(m.refund_unit_khr, 0) - COALESCE(m.sold_unit_khr, 0)) >= 1
ORDER BY m.return_created_at, m.return_item_id
LIMIT 2000
