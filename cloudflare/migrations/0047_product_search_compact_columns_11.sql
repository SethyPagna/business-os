-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ú', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ù', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ù', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'û', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Û', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ü', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ü', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ý', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ý', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ÿ', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ÿ', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ñ', 'n');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ñ', 'n');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ç', 'c');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ç', 'c');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ş', 's');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ş', 's');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ţ', 't');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ţ', 't');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'æ', 'ae');
