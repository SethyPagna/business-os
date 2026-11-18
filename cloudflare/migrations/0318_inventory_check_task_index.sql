-- 0318: an index on what kind of count session a row is, so the Tasks reads and the one-picker check find their rows by seek and not by reading every session ever made.
--
-- A count task is an open inventory_check_sessions row whose scope_json holds {"membership":"task"}; a pickup holds {"membership":"pickup","task":"<task id>"}; a submission holds
-- {"membership":"submission"} (and "task" when it counted a task). One session is made per Submit, so the table grows without limit, and without this index listing the tasks of an organization
-- or asking whether a task already has a pickup would read all of it. The index holds one entry per session row (organization, kind, task), written once when the row is made: scope_json cannot
-- change afterwards (inventory_check_sessions_identity), so the index is never rewritten.
--
-- PRE:  inventory_check_sessions exists with organization_id and scope_json, and the index does not exist. A failed check reads a malformed JSON path and aborts the file.
-- POST: the index exists on inventory_check_sessions. No table, trigger or row changes.
-- Cost: one index entry per new session (a Submit writes one more row); the build reads the sessions table once.
-- Append-only, LF-only, rowid kept, generic (no client data). Rollback-safe: the previous Worker never names the index and runs unchanged on the new schema; this Worker returns the same rows without it (it only reads more).
-- Pinned by scripts/test-migration-0318-inventory-check-task-index-pure.cjs (the plans of both reads) and test-d1-task-index-plan-native.cjs (the same plans on the local D1 engine).
-- RECOVERY: schema only, nothing to restore. Full undo: DROP INDEX IF EXISTS inventory_check_sessions_kind_task;
--   Not recorded in d1_migrations (a partial apply): run the DROP above, then rerun migrations apply. Recorded but the index is missing: run the CREATE INDEX line below by hand; do not rerun the file.

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('inventory_check_sessions') WHERE name IN ('organization_id','scope_json')) = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'inventory_check_sessions_kind_task') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_task_index_0318_pre]') END;

CREATE INDEX inventory_check_sessions_kind_task ON inventory_check_sessions (organization_id, json_extract(scope_json, '$.membership'), json_extract(scope_json, '$.task'));

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'inventory_check_sessions_kind_task' AND tbl_name = 'inventory_check_sessions') = 1
THEN 1 ELSE json_extract('[]','$[inventory_check_task_index_0318_post]') END;
