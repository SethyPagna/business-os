-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ţ', 't');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'æ', 'ae');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Æ', 'ae');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'œ', 'oe');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Œ', 'oe');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ß', 'ss');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ł', 'l');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ł', 'l');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'đ', 'd');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Đ', 'd');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'þ', 'th');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Þ', 'th');
UPDATE products SET name_normalized = REPLACE(name_normalized, '+', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '&', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '/', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '_', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '.', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '-', ' ');
UPDATE products SET name_normalized = lower(name_normalized);
UPDATE products SET unit_normalized = COALESCE(unit, '');
