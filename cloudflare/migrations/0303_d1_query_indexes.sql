-- 0303: three index changes that cut reads and writes on the Free plan, in one file (the only migration of the 11 Nov D1 audit).
--
-- 1. idx_customers_sales_picker: the POS / Sales customer picker with nothing typed (lib/contactPicker.ts buildSalesCustomerPickerSql) read every customer and sorted them
--    (SCAN customers | USE TEMP B-TREE FOR ORDER BY: about 10.3k rows for a page of 8). The partial index holds the non-anonymous customers in the picker's own order
--    (lower(name), id), so the empty search walks it and stops at LIMIT. The predicate text is exactly COALESCE(is_anonymous, 0) = 0, the text the query carries:
--    the planner only uses a partial index when the query repeats its WHERE term in the same shape (IFNULL(...) or "IS NOT 1" would not match). Same rows, same order.
-- 2. idx_audit_logs_retention_deletable: the daily audit-log sweep (lib/audit.ts buildAuditLogRetentionDeleteSql) walked idx_audit_logs_created and re-read every
--    kept-forever row older than the cutoff each day. The partial index holds only the rows the sweep may delete, so it visits those. Its WHERE text is
--    AUDIT_RETENTION_DELETABLE_SQL with whitespace collapsed; the delete uses the same constant. If that constant changes without a new migration the planner
--    falls back to the old index (cost only, never a wrong delete, because the delete keeps its own full predicate);
--    scripts/test-audit-retention-pure.cjs fails on that drift.
-- 3. idx_settings_key_unique is dropped: settings.key is already TEXT PRIMARY KEY (sqlite_autoindex_settings_1), the same single column, BINARY collation, unique.
--    Every settings insert or upsert wrote the row, the primary-key index and this duplicate; now it writes two instead of three. Duplicates stay refused by the
--    primary key, and ON CONFLICT(key) upserts keep resolving against it.
--
-- PRE:  customers, audit_logs and settings exist; the two new indexes do not exist; idx_settings_key_unique exists, is unique and covers exactly (key) with BINARY
--       collation, and the primary-key index of settings covers exactly (key) with BINARY collation and is unique. A failed check reads a malformed JSON path and aborts the file.
-- POST: both new indexes exist on their table with their partial predicate; idx_settings_key_unique is gone and sqlite_autoindex_settings_1 remains.
--       (That the planner uses the two new indexes is pinned by EXPLAIN in scripts/test-migration-0303-d1-queries-indexes-native.cjs; a migration cannot run EXPLAIN.)
-- Cost: one index row per non-anonymous customer insert or rename, one per deletable audit row written; one fewer per settings write. No table or row changes.
-- Append-only, LF-only, generic (no client data). Idempotent only through the PRE check (a second run aborts on the existing index).
-- Rollback-safe: the previous Worker never names these indexes and runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0303-d1-queries-indexes-native.cjs and scripts/test-audit-retention-pure.cjs.
--
-- RECOVERY: schema only, nothing to restore.
--   DROP INDEX IF EXISTS idx_customers_sales_picker;
--   DROP INDEX IF EXISTS idx_audit_logs_retention_deletable;
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_unique ON settings (key);

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('customers', 'audit_logs', 'settings')) = 3
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_customers_sales_picker', 'idx_audit_logs_retention_deletable')) = 0
  AND (SELECT COUNT(*) FROM pragma_index_list('settings') WHERE name = 'idx_settings_key_unique' AND "unique" = 1 AND partial = 0) = 1
  AND (SELECT COUNT(*) FROM pragma_index_list('settings') WHERE name = 'sqlite_autoindex_settings_1' AND "unique" = 1 AND partial = 0) = 1
  AND (SELECT COUNT(*) FROM pragma_index_xinfo('idx_settings_key_unique') WHERE key = 1) = 1
  AND (SELECT COUNT(*) FROM pragma_index_xinfo('idx_settings_key_unique') WHERE key = 1 AND name = 'key' AND coll = 'BINARY' AND desc = 0) = 1
  AND (SELECT COUNT(*) FROM pragma_index_xinfo('sqlite_autoindex_settings_1') WHERE key = 1) = 1
  AND (SELECT COUNT(*) FROM pragma_index_xinfo('sqlite_autoindex_settings_1') WHERE key = 1 AND name = 'key' AND coll = 'BINARY' AND desc = 0) = 1
THEN 1 ELSE json_extract('[]','$[customers_picker_audit_settings_0303_pre]') END;

CREATE INDEX idx_customers_sales_picker ON customers (lower(name), id) WHERE COALESCE(is_anonymous, 0) = 0;

CREATE INDEX idx_audit_logs_retention_deletable ON audit_logs (created_at) WHERE NOT (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) IN ('sale', 'sale_creation', 'sale_item', 'sales', 'payment_method', 'customer_receivables', 'supplier_invoices', 'return', 'returns', 'return_create', 'return_reason', 'supplier_return', 'stock', 'stock_transfer', 'stock_transfers', 'stock_session', 'stock_session_operations', 'inventory', 'inventory_movements', 'inventory_reason', 'product_batch', 'product_batches', 'branch_stock_integrity', 'branch_cutover', 'role', 'roles', 'fee', 'fee_label', 'fee_type', 'shift_session', 'read_switch') OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'user' AND COALESCE(action, '') IN ('create', 'update')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'users' AND COALESCE(action, '') IN ('create', 'update')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'product' AND COALESCE(action, '') IN ('create', 'update', 'cost_override', 'catalog_cost_recompute_backfill')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'products' AND COALESCE(action, '') IN ('create', 'update', 'cost_override', 'catalog_cost_recompute_backfill')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'system' AND COALESCE(action, '') IN ('reset_data', 'factory_reset', 'finalize_migration')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'data-integrity' AND COALESCE(action, '') IN ('repair')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'backup' AND COALESCE(action, '') IN ('restore')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'import_job' AND COALESCE(action, '') IN ('import_job_approve', 'import_job_retry')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'customer' AND COALESCE(action, '') IN ('merge', 'link_sales', 'relink_sales', 'create_and_link_sales', 'customer_same_name_phone_merge', 'mark_anonymous_customer', 'clear_shared_general_membership')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'supplier' AND COALESCE(action, '') IN ('merge', 'supplier_duplicate_cluster_merge')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = 'delivery_contact' AND COALESCE(action, '') IN ('merge')) OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) = '' AND COALESCE(action, '') IN ('sale', 'sale_settlement', 'return')) OR COALESCE(action, '') IN ('stock_add', 'stock_remove', 'stock_set', 'stock_adjust', 'stock_in_line_edit', 'stock_movement_reason_edit', 'stock_tagged_dispose', 'stock_tagged_restore', 'transfer', 'transfer_intent', 'merge_duplicate', 'fold', 'product_same_name_merge', 'product_transfer_aware_merge', 'product_leading_zero_twin_merge', 'received_date_saleability_repair', 'stale_receipt_revert_mirror', 'recompute_stock_cache', 'branch_cutover_inactive_stock', 'branch_cutover_approved_fold', 'branch_cutover_inactive_fold', 'branch_cutover_lot_fold', 'branch_cutover_completed', 'undo_closed_branch_cutover', 'stock_revert', 'stock_revert_repair', 'stock_revert_repair_before') OR (LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) IN ('product', 'products', 'action_history', '') AND (COALESCE(action, '') LIKE '%\_undo' ESCAPE '\' OR COALESCE(action, '') LIKE '%\_redo' ESCAPE '\'))) AND NOT (COALESCE(entity, '') = 'pending_action' AND (COALESCE(CASE WHEN json_valid(details) THEN json_extract(details, '$.section') END, '') IN ('fees') OR (COALESCE(action, '') = 'approve' AND COALESCE(CASE WHEN json_valid(details) THEN json_extract(details, '$.section') END, '') IN ('products', 'inventory', 'returns', 'contacts'))));

DROP INDEX idx_settings_key_unique;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_customers_sales_picker' AND tbl_name = 'customers' AND sql LIKE '%WHERE COALESCE(is_anonymous, 0) = 0') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_audit_logs_retention_deletable' AND tbl_name = 'audit_logs' AND sql LIKE '% WHERE NOT (LOWER(TRIM(%' AND sql LIKE '%AND NOT (COALESCE(entity, ''%') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_settings_key_unique') = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'sqlite_autoindex_settings_1' AND tbl_name = 'settings') = 1
THEN 1 ELSE json_extract('[]','$[customers_picker_audit_settings_0303_post]') END;
