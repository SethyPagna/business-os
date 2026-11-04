-- Pre-deploy census for migration 0292 (6.0.1053 expense label and type catalogs), from the rc/20261104a release
-- review. READ-ONLY: one row of counts and flag values, no ids, names or amounts.
--   applied / last_applied / beyond_0273  the ledger must read 219, 0273_conflict_marks_and_indexes.sql, 0
--   new_objects                           fee_types, fee_labels, idx_sales_courier_cost already present: must be 0
--   switch_rows                           read_switches / data_epoch rows: 0 means every read switch is OFF (= live)
--   portal_*_set / portal_*_value         stored storefront settings that override the new defaults (U2)
--   custom_fee_type_rows                  expenses with a type outside the built-in five (an old Worker after a
--                                         rollback rewrites such a type to 'other' when the expense is edited)
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 20000
SELECT
  (SELECT COUNT(*) FROM d1_migrations) AS applied,
  (SELECT MAX(name) FROM d1_migrations) AS last_applied,
  (SELECT COUNT(*) FROM d1_migrations WHERE name > '0273_conflict_marks_and_indexes.sql') AS beyond_0273,
  (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('fee_types', 'fee_labels', 'idx_sales_courier_cost')) AS new_objects,
  (SELECT COUNT(*) FROM system_flags WHERE key IN ('read_switches', 'data_epoch')) AS switch_rows,
  (SELECT COUNT(*) FROM settings WHERE key = 'customer_portal_show_contact_instagram') AS portal_instagram_set,
  (SELECT value FROM settings WHERE key = 'customer_portal_show_contact_instagram') AS portal_instagram_value,
  (SELECT COUNT(*) FROM settings WHERE key = 'customer_portal_grid_columns_auto') AS portal_grid_auto_set,
  (SELECT value FROM settings WHERE key = 'customer_portal_grid_columns_auto') AS portal_grid_auto_value,
  (SELECT COUNT(*) FROM settings WHERE key = 'customer_portal_announcement_enabled') AS portal_announcement_set,
  (SELECT COUNT(*) FROM fees WHERE fee_type NOT IN ('tax', 'delivery', 'change', 'expense', 'other')) AS custom_fee_type_rows
