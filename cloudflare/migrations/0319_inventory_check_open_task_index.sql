-- 0319: two partial indexes so the count-task reads never read a closed or old session they do not need.
--
-- A count task is an inventory_check_sessions row whose scope_json holds {"membership":"task"}; it is open until it closes.
--   inventory_check_sessions_open_task: the OPEN sessions by organization, kind and branch (WHERE status = 'open'). Three reads need exactly the open tasks of one branch: the auto-close every count writer appends
--   to its own batch (which tasks might this write complete?), the cap guard of the issue (how many open tasks does this branch hold?) and the board's open list. Migration 0318 indexes every session by organization,
--   kind and task, closed ones included, and nothing indexes status or branch, so without this index those reads grow with every session and every closed task the organization has ever made. A row leaves it
--   when it closes, so its size is the number of open sessions, whatever the history.
--   inventory_check_sessions_task_board: the TASKS only (WHERE the kind is 'task'), by organization, branch, status, closed_at and id. The board's list of recently closed tasks reads the last few closed tasks of one
--   branch in order, by seek and a short walk of this index; without it that list walks every task the organization ever made, on every branch (2,332 rows at 1,000 closed tasks).
--
-- PRE:  inventory_check_sessions has organization_id, branch_id, status, closed_at and scope_json, and neither index exists. A failed check reads a malformed JSON path and aborts the file.
-- POST: both indexes exist on inventory_check_sessions. No table, trigger or row changes.
-- Cost: one index entry per open session (open_task) and one per task (task_board); the build reads the sessions table once. Append-only, LF-only, rowid kept, generic (no client data).
-- Rollback-safe: the previous Worker never names either index and runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0319-inventory-check-open-task-index-pure.cjs (the plans) and test-d1-task-index-plan-native.cjs (the same plans and the rows read on the local D1 engine).
-- RECOVERY: schema only, nothing to restore. Full undo: DROP INDEX IF EXISTS inventory_check_sessions_open_task; DROP INDEX IF EXISTS inventory_check_sessions_task_board;
--   Not recorded in d1_migrations (a partial apply): run the two DROPs above, then rerun migrations apply. Recorded but an index is missing: run the CREATE INDEX line of that index below by hand; do not rerun the file.

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('inventory_check_sessions') WHERE name IN ('organization_id','branch_id','status','closed_at','scope_json')) = 5
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('inventory_check_sessions_open_task','inventory_check_sessions_task_board')) = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_open_task_index_0319_pre]') END;

CREATE INDEX inventory_check_sessions_open_task ON inventory_check_sessions (organization_id, json_extract(scope_json, '$.membership'), branch_id) WHERE status = 'open';

CREATE INDEX inventory_check_sessions_task_board ON inventory_check_sessions (organization_id, branch_id, status, closed_at, id) WHERE json_extract(scope_json, '$.membership') = 'task';

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('inventory_check_sessions_open_task','inventory_check_sessions_task_board') AND tbl_name = 'inventory_check_sessions') = 2
THEN 1 ELSE json_extract('[]','$[inventory_check_open_task_index_0319_post]') END;
