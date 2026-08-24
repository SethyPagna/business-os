-- Final part of the batched 0037 product_search_compact_columns
-- migration -- creates the supporting index once all prior parts have
-- finished backfilling brand_compact.

CREATE INDEX IF NOT EXISTS idx_products_brand_compact ON products(brand_compact);

-- Ongoing sync for any write path this migration's own JS-side hooks
-- (lib/productWrites.ts, lib/importEngine.ts) don't cover is deliberately
-- NOT done via a SQL trigger here -- seed_from a trigger body would need
-- the exact same nested-REPLACE expression that caused the original bug
-- (a trigger body's own expressions are just as subject to D1's
-- depth-100 limit as a query's), and this codebase's two real product
-- write paths (the manual Add/Edit form via routes/products.ts, and bulk
-- import via lib/importEngine.ts) both already go through the JS-side
-- computation directly. If a third write path is ever added, it must
-- call lib/productWrites.ts's insertRow/updateRow (as every other table
-- write in this app already does) rather than hand-rolling its own SQL,
-- which keeps this column in sync without needing a SQL-side fallback at
-- all.

