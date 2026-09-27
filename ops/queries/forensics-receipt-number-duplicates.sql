-- F-forensics: sales sharing one receipt_number. The server mints
-- YYYYMMDD-HHMMSS after a check-then-insert (routes/sales.ts), and an offline
-- replay's client number is honoured as sent, so two tills in one second, or a
-- replayed sale, can collide. Same contents on the same receipt usually means
-- ONE sale recorded twice (stock deducted twice, revenue counted twice); a
-- different basket is an identifier collision only.
--   receipt_group (1..n, not the number itself), sale_id, created_at, sale_status,
--   branch_id, cashier_id, total_usd, item_count, item_signature_group
--   same_basket_as_other   1 when another sale in the group has the same
--                          (product, quantity) multiset and total
--   has_client_request_id, is_legacy (legacy_receipt_number set)
--   returns_by_receipt     returns carrying this receipt number
--   returns_linked         returns whose sale_id is this sale
-- ops:min-rows 0
-- ops:max-rows 3000
WITH d AS (
  SELECT receipt_number, ROW_NUMBER() OVER (ORDER BY MIN(id)) AS receipt_group
  FROM sales WHERE receipt_number IS NOT NULL AND receipt_number <> ''
  GROUP BY receipt_number HAVING COUNT(*) > 1
),
s AS (
  SELECT d.receipt_group, x.*,
    (SELECT group_concat(k, ';') FROM (SELECT si.product_id || 'x' || si.quantity AS k FROM sale_items si
      WHERE si.sale_id = x.id ORDER BY si.product_id, si.quantity)) AS basket
  FROM d JOIN sales x ON x.receipt_number = d.receipt_number
)
SELECT
  s.receipt_group, s.id AS sale_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) AS created_at, s.sale_status, s.branch_id, s.cashier_id,
  s.total_usd, s.money_precision_version AS sale_mpv,
  (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
  CASE WHEN EXISTS (SELECT 1 FROM s o WHERE o.receipt_group = s.receipt_group AND o.id <> s.id
    AND o.basket IS s.basket AND ABS(COALESCE(o.total_usd, 0) - COALESCE(s.total_usd, 0)) < 0.005) THEN 1 ELSE 0 END AS same_basket_as_other,
  CASE WHEN s.client_request_id IS NOT NULL AND s.client_request_id <> '' THEN 1 ELSE 0 END AS has_client_request_id,
  CASE WHEN s.legacy_receipt_number IS NOT NULL AND s.legacy_receipt_number <> '' THEN 1 ELSE 0 END AS is_legacy,
  (SELECT COUNT(*) FROM returns r WHERE r.receipt_number = s.receipt_number) AS returns_by_receipt,
  (SELECT COUNT(*) FROM returns r WHERE r.sale_id = s.id) AS returns_linked
FROM s
ORDER BY s.receipt_group, s.id
LIMIT 3000
