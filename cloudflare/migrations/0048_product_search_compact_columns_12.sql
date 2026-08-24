-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET brand_compact = REPLACE(brand_compact, 'Æ', 'ae');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'œ', 'oe');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Œ', 'oe');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ß', 'ss');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ł', 'l');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ł', 'l');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'đ', 'd');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Đ', 'd');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'þ', 'th');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Þ', 'th');
UPDATE products SET brand_compact = REPLACE(brand_compact, '+', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '&', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '/', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '_', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '.', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '-', ' ');
UPDATE products SET brand_compact = lower(brand_compact);
UPDATE products SET brand_compact = REPLACE(brand_compact, ' ', '');
