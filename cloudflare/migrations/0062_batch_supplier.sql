-- Supplier is a property of the BATCH, not the product (user, Aug 28): the
-- same product is bought from different suppliers over time, so attribution
-- lives on the lot that was actually received. supplier_name is the
-- as-entered/imported text; supplier_id links to the suppliers table when a
-- match exists (matching is by exact normalized name at write time —
-- unmatched names keep supplier_id NULL and stay linkable later; imports
-- never auto-create suppliers). The product's "Supplier" section derives
-- per-supplier totals from these rows; nothing is stored per product.
ALTER TABLE product_batches ADD COLUMN supplier_id INTEGER;
ALTER TABLE product_batches ADD COLUMN supplier_name TEXT;
