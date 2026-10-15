-- Release 2e postflight, review checklist item 6: the audit rows the retention
-- sweep keeps forever, counted per class. READ-ONLY: one SELECT; each row is a
-- class name with a count and the oldest and newest created_at: no entity
-- ids, names or details. Mirrors lib/audit.ts buildAuditLogRetentionDeleteSql
-- (owner rule 14 Oct 2026: sales, payments, returns, stock changes, permission
-- changes and reverts are kept forever; every other row follows the retention
-- setting, floor 21 days) over the rows older than 21 days.
--
-- Each old row (created_at before now - 21 days, UTC) gets exactly one class, the
-- first that matches. The kept classes together are exactly the rows the sweep's
-- NOT (kept) test keeps, so every class except follows_retention is kept forever
-- and follows_retention is what the sweep may delete (the stored retention
-- setting can be longer than 21 days; this uses the floor):
--   sales_payments       entity sale, sale_creation, sale_item, sales, payment_method,
--                        customer_receivables, supplier_invoices
--   returns              entity return(s), return_create, return_reason, supplier_return
--   stock_entities       entity stock*, inventory*, product_batch(es), branch_stock_integrity, branch_cutover
--   stock_actions        any entity, action stock_add/remove/set/adjust, transfer, fold, merge
--                        and repair actions (AUDIT_RETENTION_KEPT_STOCK_ACTIONS)
--   reverts              any entity, action stock_revert / stock_revert_repair(_before)
--   permissions          entity role(s), and user(s) with action create/update
--   expenses             entity fee, fee_label
--   cash_shifts          entity shift_session
--   product_price_cost   entity product(s) with action create/update/cost_override/
--                        catalog_cost_recompute_backfill
--   system_writes        system reset/factory reset/finalize migration, data-integrity repair,
--                        backup restore, import job approve/retry
--   contact_links        customer / supplier / delivery_contact merges and sale links
--   legacy_actions       no entity and action sale / sale_settlement / return
--   undo_redo            product(s) / action_history / no entity, action *_undo or *_redo
--   review_decisions     entity pending_action: every fees decision, and approvals of
--                        products, inventory, returns, contacts
--   follows_retention    everything else: the sweep deletes these once past the setting
-- ops:min-rows 1
WITH old AS (
  SELECT
    LOWER(TRIM(COALESCE(NULLIF(TRIM(entity), ''), table_name, ''))) AS e,
    COALESCE(action, '') AS a,
    COALESCE(entity, '') AS raw_entity,
    COALESCE(CASE WHEN json_valid(details) THEN json_extract(details, '$.section') END, '') AS section,
    created_at
  FROM audit_logs
  WHERE created_at < datetime('now', '-21 days')
), classed AS (
  SELECT
    CASE
      WHEN e IN ('sale', 'sale_creation', 'sale_item', 'sales', 'payment_method', 'customer_receivables', 'supplier_invoices') THEN 'sales_payments'
      WHEN e IN ('return', 'returns', 'return_create', 'return_reason', 'supplier_return') THEN 'returns'
      WHEN e IN ('stock', 'stock_transfer', 'stock_transfers', 'stock_session', 'stock_session_operations', 'inventory', 'inventory_movements',
                 'inventory_reason', 'product_batch', 'product_batches', 'branch_stock_integrity', 'branch_cutover') THEN 'stock_entities'
      WHEN a IN ('stock_add', 'stock_remove', 'stock_set', 'stock_adjust', 'stock_in_line_edit', 'stock_movement_reason_edit',
                 'stock_tagged_dispose', 'stock_tagged_restore', 'transfer', 'transfer_intent',
                 'merge_duplicate', 'fold', 'product_same_name_merge', 'product_transfer_aware_merge', 'product_leading_zero_twin_merge',
                 'received_date_saleability_repair', 'stale_receipt_revert_mirror', 'recompute_stock_cache',
                 'branch_cutover_inactive_stock', 'branch_cutover_approved_fold', 'branch_cutover_inactive_fold', 'branch_cutover_lot_fold',
                 'branch_cutover_completed', 'undo_closed_branch_cutover') THEN 'stock_actions'
      WHEN a IN ('stock_revert', 'stock_revert_repair', 'stock_revert_repair_before') THEN 'reverts'
      WHEN e IN ('role', 'roles') OR (e IN ('user', 'users') AND a IN ('create', 'update')) THEN 'permissions'
      WHEN e IN ('fee', 'fee_label') THEN 'expenses'
      WHEN e = 'shift_session' THEN 'cash_shifts'
      WHEN e IN ('product', 'products') AND a IN ('create', 'update', 'cost_override', 'catalog_cost_recompute_backfill') THEN 'product_price_cost'
      WHEN (e = 'system' AND a IN ('reset_data', 'factory_reset', 'finalize_migration'))
        OR (e = 'data-integrity' AND a = 'repair')
        OR (e = 'backup' AND a = 'restore')
        OR (e = 'import_job' AND a IN ('import_job_approve', 'import_job_retry')) THEN 'system_writes'
      WHEN (e = 'customer' AND a IN ('merge', 'link_sales', 'relink_sales', 'create_and_link_sales', 'customer_same_name_phone_merge',
                                     'mark_anonymous_customer', 'clear_shared_general_membership'))
        OR (e = 'supplier' AND a IN ('merge', 'supplier_duplicate_cluster_merge'))
        OR (e = 'delivery_contact' AND a = 'merge') THEN 'contact_links'
      WHEN e = '' AND a IN ('sale', 'sale_settlement', 'return') THEN 'legacy_actions'
      WHEN e IN ('product', 'products', 'action_history', '')
        AND (a LIKE '%\_undo' ESCAPE '\' OR a LIKE '%\_redo' ESCAPE '\') THEN 'undo_redo'
      WHEN raw_entity = 'pending_action'
        AND (section IN ('fees') OR (a = 'approve' AND section IN ('products', 'inventory', 'returns', 'contacts'))) THEN 'review_decisions'
      ELSE 'follows_retention'
    END AS class,
    created_at
  FROM old
)
SELECT class, COUNT(*) AS rows_older_than_21d, MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM classed
GROUP BY class
ORDER BY class
