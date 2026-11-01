-- d1-branch-activity: which branches are active (decides whether Inventory
-- Check may read once for a sole branch). Ids and flags only, no names.
-- ops:min-rows 1
SELECT id, is_active, is_default, role, successor_branch_id
FROM branches
ORDER BY id;
