-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ø', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ú', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ú', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ù', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ù', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'û', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Û', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ü', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ü', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ý', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ý', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ÿ', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ÿ', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ñ', 'n');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ñ', 'n');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ç', 'c');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ç', 'c');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ş', 's');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ş', 's');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ţ', 't');
