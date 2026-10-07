-- REVERT-SET: the size of the census before running it. Range seek on
-- idx_inventory_movements_reference_type_id only (no per-row lookups).
--   reverts          revert:% rows
--   first_id/last_id their id span
--   first_at/last_at their created_at span
-- ops:min-rows 1
-- ops:max-rows 1
SELECT COUNT(*) AS reverts, MIN(id) AS first_id, MAX(id) AS last_id, MIN(created_at) AS first_at, MAX(created_at) AS last_at
FROM inventory_movements
WHERE reference_id >= 'revert:' AND reference_id < 'revert;'
