-- 0285: the index a product's latest Inventory Check observation is read through (lane 6.0.1044, ic_simple).
--
-- Schema only: no row is inserted, updated or deleted and no existing query changes, so no result can change.
--
-- The simplified Inventory Check list shows each product's check status, count, note and last-checked time, and filters by check status.
-- Every one of those is "the newest done/issue item of this product in this branch scope". Today only (session_id, state, product_id)
-- exists (0259), so any lookup by product walks the whole items table. This index lets each lookup seek (product_id, branch_id) and read
-- updated_at in order.
--
-- PRE: inventory_check_items and the three columns exist. A failed check reads a malformed JSON path and aborts the file.
-- POST: the index exists on inventory_check_items(product_id, branch_id, updated_at); the companion test proves no row changed.
-- Idempotent: CREATE INDEX IF NOT EXISTS. Rollback-safe: the previous Worker never names the index, so it runs unchanged on the new schema.
-- LF-only, append-only, generic (no client data).
-- Pinned by scripts/test-migration-0285-inventory-check-items-latest-native.cjs.
--
-- RECOVERY: schema only, nothing to restore; the Worker works with or without the index (it only changes plans).
--   DROP INDEX IF EXISTS inventory_check_items_product_latest;

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('inventory_check_items') WHERE name IN ('product_id','branch_id','updated_at')) = 3
THEN 1 ELSE json_extract('[]','$[inventory_check_items_latest_0285_pre_columns]') END;

CREATE INDEX IF NOT EXISTS inventory_check_items_product_latest ON inventory_check_items(product_id, branch_id, updated_at);

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'inventory_check_items_product_latest' AND tbl_name = 'inventory_check_items') = 1
THEN 1 ELSE json_extract('[]','$[inventory_check_items_latest_0285_post_index]') END;
