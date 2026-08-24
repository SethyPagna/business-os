-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ë', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'í', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Í', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ì', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ì', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'î', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Î', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ï', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ï', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ó', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ó', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ò', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ò', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ô', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ô', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ö', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ö', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'õ', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Õ', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ø', 'o');
