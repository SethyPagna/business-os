-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'í', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Í', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ì', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ì', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'î', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Î', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ï', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ï', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ó', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ó', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ò', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ò', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ô', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ô', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ö', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ö', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'õ', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Õ', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ø', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ø', 'o');
