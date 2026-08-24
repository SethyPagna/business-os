-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET brand_compact = REPLACE(brand_compact, 'Í', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ì', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ì', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'î', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Î', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ï', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ï', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ó', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ó', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ò', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ò', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ô', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ô', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ö', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ö', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'õ', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Õ', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ø', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ø', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ú', 'u');
