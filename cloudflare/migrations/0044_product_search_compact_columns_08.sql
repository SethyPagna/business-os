-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'æ', 'ae');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Æ', 'ae');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'œ', 'oe');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Œ', 'oe');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ß', 'ss');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ł', 'l');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ł', 'l');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'đ', 'd');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Đ', 'd');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'þ', 'th');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Þ', 'th');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '+', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '&', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '/', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '_', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '.', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '-', ' ');
UPDATE products SET unit_normalized = lower(unit_normalized);
UPDATE products SET brand_compact = COALESCE(brand, '');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'á', 'a');
