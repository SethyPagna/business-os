-- Active products: id, name, brand, barcode, sku, category.
-- Read-only; the rows reach only the encrypted artifact, and the public log
-- does not show the row count (it is a table size).
-- ops:min-rows 1
SELECT id, name, brand, barcode, sku, category
FROM products
WHERE is_active = 1
ORDER BY id
