-- 0300: the partial index that lets "which sales name this delivery person" be answered by a SEARCH instead of a SCAN of every sale.
--
-- sales.delivery_contact_id had no index (fees has idx_fees_delivery_contact_date, 0105). The delivery-person delete guard (lib/contactDeleteGuard.ts), the
-- rename-impact count, the rename cascade and the contact merge repoint all filter sales by it, and each read every sale (about 15.8k rows at today's size).
-- Partial: only sales that name a delivery person are indexed (the rest are pickups and in-shop sales), so the index stays small and a plain sale write pays
-- one index row only when it is a delivery. Every query that compares the column (=, IN) implies IS NOT NULL, so the planner uses it.
--
-- PRE:  sales has the delivery_contact_id column and idx_sales_delivery_contact does not exist. A failed check reads a malformed JSON path and aborts the file.
-- POST: the index exists on exactly (delivery_contact_id) with the partial predicate; no table or row changed.
-- Append-only, LF-only, generic (no client data). Idempotent only through the PRE check (a second run aborts on the existing index).
-- Rollback-safe: the previous Worker never names the index and runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0300-sales-delivery-contact-index-native.cjs and scripts/test-d1-query-plans-native.cjs.
--
-- RECOVERY: schema only, nothing to restore.
--   DROP INDEX IF EXISTS idx_sales_delivery_contact;

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('sales') WHERE name = 'delivery_contact_id') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_sales_delivery_contact') = 0
THEN 1 ELSE json_extract('[]','$[sales_delivery_contact_0300_pre]') END;

CREATE INDEX idx_sales_delivery_contact ON sales (delivery_contact_id) WHERE delivery_contact_id IS NOT NULL;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_sales_delivery_contact' AND tbl_name = 'sales' AND sql LIKE '%WHERE delivery_contact_id IS NOT NULL%') = 1
THEN 1 ELSE json_extract('[]','$[sales_delivery_contact_0300_post]') END;
