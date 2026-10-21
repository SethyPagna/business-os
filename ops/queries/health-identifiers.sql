-- health-identifiers: numbers and identities that must be unique (DATA-MATCH DM-18).
-- sales.receipt_number and returns.return_number have no UNIQUE index (receipt
-- numbers are minted YYYYMMDD-HHMMSS after a check-then-insert, routes/sales.ts),
-- so duplicates are possible; shift_code, membership numbers and client_request_id
-- are enforced by unique indexes and are not re-checked here.
--   receipt_dup_groups / receipt_dup_sales      all time (RATCHET)
--   receipt_dup_groups_recent                   groups with a sale in the last 35 days (ZERO)
--   return_number_dup_groups
--   product_identity_twins   active rows sharing name_key AND the same non-empty trimmed
--                            barcode: the merge rule says one row (RATCHET; Conflicts page fixes)
--   supplier_name_dup_groups same lower(trim(name)): owner rule, one supplier (RATCHET)
--   customer_phone_name_dup_groups  same phone_normalized and lower(trim(name)) (RATCHET)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH rd AS MATERIALIZED (
  SELECT receipt_number, COUNT(*) AS n, MAX(created_at) AS last_at
  FROM sales WHERE COALESCE(receipt_number, '') <> '' GROUP BY receipt_number HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*) FROM rd) AS receipt_dup_groups,
  (SELECT COALESCE(SUM(n), 0) FROM rd) AS receipt_dup_sales,
  (SELECT COUNT(*) FROM rd WHERE last_at >= date('now', '-35 days')) AS receipt_dup_groups_recent,
  (SELECT COUNT(*) FROM (SELECT return_number FROM returns WHERE COALESCE(return_number, '') <> ''
     GROUP BY return_number HAVING COUNT(*) > 1)) AS return_number_dup_groups,
  (SELECT COUNT(*) FROM (SELECT name_key, trim(barcode) FROM products
     WHERE is_active = 1 AND COALESCE(name_key, '') <> '' AND COALESCE(trim(barcode), '') <> ''
     GROUP BY name_key, trim(barcode) HAVING COUNT(*) > 1)) AS product_identity_twins,
  (SELECT COUNT(*) FROM (SELECT lower(trim(name)) FROM suppliers WHERE COALESCE(trim(name), '') <> ''
     GROUP BY lower(trim(name)) HAVING COUNT(*) > 1)) AS supplier_name_dup_groups,
  (SELECT COUNT(*) FROM (SELECT phone_normalized, lower(trim(name)) FROM customers
     WHERE COALESCE(phone_normalized, '') <> '' GROUP BY phone_normalized, lower(trim(name)) HAVING COUNT(*) > 1)) AS customer_phone_name_dup_groups
