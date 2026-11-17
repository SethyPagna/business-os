-- inventory-check-census-20261117: read-only census before the Inventory count-request deploy (owner redesign, 17 Nov 2026).
-- One row of scalar counts (D1 refuses compound SELECTs over 5 terms; this has none):
--   r1_pending_mismatch        pending approvals whose stored `lines` differs from the number of items that differ in TOTAL (baseline vs counted). The older engine read only that, while the creation
--                              statement also counted a dated count whose per-date errors cancel out (A 6 of 5, B 3 of 4): such an approval could be neither approved, rejected nor closed.
--   r1_pending_engine_zero     the subset where that item-level count is 0 (the approval was unreachable)
--   max_checked_products_branch  per branch, the most distinct products with a done or issue count: the check-state sets are cached only up to inventoryCheckFilterMaxIds (2000 on Free);
--                              above that the status and date chips are hidden (tooLarge)
--   max_latest_days_branch     per branch, the most distinct Cambodia business days (UTC+7) among each product's LATEST count: the number of date chips
--   sessions, items, events, approvals_rows   row counts of the four inventory_check tables
--   approvals_pending          pending approvals in total
--   last_migration             the last applied migration
-- Read cost: the four inventory_check tables are each read in full a few times (items three times: the distinct-products group, the latest-per-product days and the row count; events, sessions and
-- the small approvals table once or a few times, the approvals' items by the session index). Measured on the CI read-budget seed, which holds no inventory check row: 8 rows read, with and
-- without ANALYZE. At production scale it is about 3 x items + events + sessions + 5 x approvals, far under the 384,440 rows of the whole database (d1-table-rows), so the ceiling below is the
-- whole-database figure rounded up: it can only fire if something other than these scans runs. Run it once, not on a schedule.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 400000
SELECT
  (SELECT COUNT(*) FROM inventory_check_approvals a WHERE a.status = 'pending'
    AND a.lines <> (SELECT COUNT(*) FROM inventory_check_items i WHERE i.session_id = a.session_id AND i.baseline_quantity IS NOT NULL AND i.counted_quantity IS NOT NULL
      AND abs(i.baseline_quantity - i.counted_quantity) > 0.000000001)) AS r1_pending_mismatch,
  (SELECT COUNT(*) FROM inventory_check_approvals a WHERE a.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM inventory_check_items i WHERE i.session_id = a.session_id AND i.baseline_quantity IS NOT NULL AND i.counted_quantity IS NOT NULL
      AND abs(i.baseline_quantity - i.counted_quantity) > 0.000000001)) AS r1_pending_engine_zero,
  (SELECT COALESCE(MAX(n), 0) FROM (SELECT COUNT(DISTINCT product_id) AS n FROM inventory_check_items WHERE state IN ('done', 'issue') GROUP BY branch_id)) AS max_checked_products_branch,
  (SELECT COALESCE(MAX(n), 0) FROM (SELECT COUNT(DISTINCT date(latest, '+7 hours')) AS n
    FROM (SELECT branch_id, MAX(updated_at) AS latest FROM inventory_check_items WHERE state IN ('done', 'issue') GROUP BY branch_id, product_id) GROUP BY branch_id)) AS max_latest_days_branch,
  (SELECT COUNT(*) FROM inventory_check_sessions) AS sessions,
  (SELECT COUNT(*) FROM inventory_check_items) AS items,
  (SELECT COUNT(*) FROM inventory_check_events) AS events,
  (SELECT COUNT(*) FROM inventory_check_approvals) AS approvals_rows,
  (SELECT COUNT(*) FROM inventory_check_approvals WHERE status = 'pending') AS approvals_pending,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS last_migration
