-- update_code.zip (Part 267) added multi-category/multi-brand support in
-- lib/productWrites.ts (normalizeMultiValue), lib/importEngine.ts, and the
-- search/filter logic in routes/products.ts, routes/inventory.ts -- all of
-- it referencing new `products.categories` / `products.brands` columns
-- (comments in those files explicitly cite this migration by name). The
-- supplied update_code.zip did not include the migration itself -- this
-- file closes that gap so the merged code actually has the columns it
-- queries against, instead of failing at runtime with "no such column".
--
-- `category` / `brand` remain the single-value PRIMARY columns and keep
-- their exact existing shape -- every current sort/filter/group-by/facet
-- call site keeps working unchanged. `categories` / `brands` are new,
-- nullable, `||`-delimited lists (primary value included, see
-- normalizeMultiValue's own comment in lib/productWrites.ts) that a product
-- can additionally carry. Left NULL on every existing row -- callers that
-- read them already fall back to COALESCE(categories, category) /
-- COALESCE(brands, brand), so no backfill is required for search/filter
-- correctness, and no caller is left reading a half-migrated column.
ALTER TABLE products ADD COLUMN categories TEXT;
ALTER TABLE products ADD COLUMN brands TEXT;
