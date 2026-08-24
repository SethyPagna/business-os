-- Part of the batched 0037 product_search_compact_columns migration
-- (see 0037_product_search_compact_columns_01.sql for full rationale).
-- Continues the same shallow REPLACE sequence on name_normalized /
-- unit_normalized / brand_compact.

UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'á', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Á', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'à', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'À', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'â', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Â', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ä', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ä', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ã', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ã', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'å', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Å', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'é', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'É', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'è', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'È', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ê', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ê', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ë', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ë', 'e');
