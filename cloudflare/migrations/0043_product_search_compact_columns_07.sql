-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ú', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ú', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ù', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ù', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'û', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Û', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ü', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ü', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ý', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ý', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ÿ', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ÿ', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ñ', 'n');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ñ', 'n');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ç', 'c');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ç', 'c');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ş', 's');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ş', 's');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ţ', 't');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ţ', 't');
