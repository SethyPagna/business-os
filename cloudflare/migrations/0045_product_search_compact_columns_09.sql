-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET brand_compact = REPLACE(brand_compact, 'Á', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'à', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'À', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'â', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Â', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ä', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ä', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ã', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ã', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'å', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Å', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'é', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'É', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'è', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'È', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ê', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ê', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ë', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ë', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'í', 'i');
