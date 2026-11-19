-- 0319: a partial index on the OPEN sessions by organization, kind and branch, so the count-task reads that only care about open tasks never read a closed or old session.
--
-- A count task is an open inventory_check_sessions row whose scope_json holds {"membership":"task"}. Three reads need exactly the open tasks of one branch: the auto-close every count writer appends to its own
-- batch (which tasks might this write complete?), the cap guard of the issue (how many open tasks does this branch hold?) and the board's open list. Migration 0318 indexes every session by organization, kind and
-- task, closed ones included, and nothing indexes status or branch, so without this index those reads grow with every session and every closed task the organization has ever made. The partial index holds only open
-- rows (a row leaves it when it closes), so its size is the number of open sessions, whatever the history.
--
-- PRE:  inventory_check_sessions has organization_id, branch_id, status and scope_json, and the index does not exist. A failed check reads a malformed JSON path and aborts the file.
-- POST: the index exists on inventory_check_sessions. No table, trigger or row changes.
-- Cost: one index entry per open session; the build reads the sessions table once. Append-only, LF-only, rowid kept, generic (no client data).
-- Rollback-safe: the previous Worker never names the index and runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0319-inventory-check-open-task-index-pure.cjs (the plans) and test-d1-task-index-plan-native.cjs (the same plans and the rows read on the local D1 engine).
-- RECOVERY: schema only, nothing to restore. Full undo: DROP INDEX IF EXISTS inventory_check_sessions_open_task;
--   Not recorded in d1_migrations (a partial apply): run the DROP above, then rerun migrations apply. Recorded but the index is missing: run the CREATE INDEX line below by hand; do not rerun the file.

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('inventory_check_sessions') WHERE name IN ('organization_id','branch_id','status','scope_json')) = 4
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'inventory_check_sessions_open_task') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_open_task_index_0319_pre]') END;

CREATE INDEX inventory_check_sessions_open_task ON inventory_check_sessions (organization_id, json_extract(scope_json, '$.membership'), branch_id) WHERE status = 'open';
