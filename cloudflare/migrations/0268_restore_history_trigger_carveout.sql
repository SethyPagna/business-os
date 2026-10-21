-- 0268 restore carve-out for the inventory-check and branch-cutover history guards (lane 6.0.917).
-- A restore runs DELETE FROM then INSERT on every backed-up table, so the immutable-history triggers
-- of these four tables aborted it and the tables could not join BACKUP_TABLES. Six triggers gain the
-- same predicate as shift_close_figures_no_delete (0237) and the catalog-cost triggers (0261):
--   NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
--   DELETE guards (0259):  inventory_check_events_no_delete, inventory_check_sessions_no_delete,
--                          inventory_check_items_no_delete
--   DELETE guard (0224):   branch_cutovers_no_delete
--   INSERT guards:         branch_cutovers_initial (0224), branch_cutovers_no_active_insert (0225)
-- Bodies and error names are unchanged; an existing WHEN condition is kept and wrapped in parentheses.
-- Outside a restore every guard refuses exactly what it refused before. The UPDATE guards are not
-- touched: a restore only deletes and inserts. The 0224 partial unique index
-- branch_cutovers_one_active still allows one unfinished cutover even during a restore.
-- Schema only: no row of any table is inserted, updated or deleted.
--
-- PRE:  the six triggers exist and none mentions 'restore'. Record SELECT COUNT(*) of
--       inventory_check_sessions, inventory_check_items, inventory_check_events, branch_cutovers.
-- POST: the six triggers exist, each now mentions 'restore'; the four counts are unchanged; the
--       branch_cutovers_% trigger count is unchanged (14: 13 from 0224 plus 0225).
--       A failed check reads a malformed JSON path and aborts the file.
-- Pinned by scripts/test-migration-0268-restore-history-carveout-native.cjs.
--
-- RECOVERY: schema only. DROP TRIGGER IF EXISTS for the six names, then re-run their definitions from
--   0259_inventory_check_sessions.sql (the three inventory_check_*_no_delete statements),
--   0224_branch_cutover_journal.sql (branch_cutovers_initial, branch_cutovers_no_delete) and
--   0225_branch_cutover_active_insert_guard.sql (branch_cutovers_no_active_insert).
--   Remove the four tables from BACKUP_TABLES first, or a restore aborts on the restored guards.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
    AND name IN ('inventory_check_events_no_delete','inventory_check_sessions_no_delete','inventory_check_items_no_delete',
      'branch_cutovers_no_delete','branch_cutovers_initial','branch_cutovers_no_active_insert')
    AND sql NOT LIKE '%''restore''%') = 6
THEN 1 ELSE json_extract('[]','$[restore_carveout_0268_pre_triggers]') END;

DROP TRIGGER IF EXISTS inventory_check_events_no_delete;
DROP TRIGGER IF EXISTS inventory_check_sessions_no_delete;
DROP TRIGGER IF EXISTS inventory_check_items_no_delete;
DROP TRIGGER IF EXISTS branch_cutovers_no_delete;
DROP TRIGGER IF EXISTS branch_cutovers_initial;
DROP TRIGGER IF EXISTS branch_cutovers_no_active_insert;

CREATE TRIGGER inventory_check_events_no_delete BEFORE DELETE ON inventory_check_events
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;
CREATE TRIGGER inventory_check_sessions_no_delete BEFORE DELETE ON inventory_check_sessions
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;
CREATE TRIGGER inventory_check_items_no_delete BEFORE DELETE ON inventory_check_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_history_immutable'); END;

CREATE TRIGGER branch_cutovers_no_delete BEFORE DELETE ON branch_cutovers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_no_delete'); END;

CREATE TRIGGER branch_cutovers_initial BEFORE INSERT ON branch_cutovers
WHEN (EXISTS (SELECT 1 FROM branch_cutovers WHERE operation_id = NEW.operation_id OR begin_request_id = NEW.begin_request_id)
  OR NEW.phase <> 'capturing' OR NEW.revision <> 0 OR NEW.next_sequence <> 0 OR NEW.committed_children <> 0
  OR NEW.capture_records <> 0 OR NEW.snapshot_records <> 0 OR NEW.verification_records <> 0
  OR NEW.capture_cursor_json <> '{}' OR NEW.snapshot_cursor_json <> '{}' OR NEW.verification_cursor_json <> '{}'
  OR NEW.manifest_json IS NOT NULL OR NEW.planned_child_json IS NOT NULL OR NEW.terminal_json IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_initial_state'); END;

CREATE TRIGGER branch_cutovers_no_active_insert BEFORE INSERT ON branch_cutovers
WHEN (EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted')))
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_insert_refused'); END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
    AND name IN ('inventory_check_events_no_delete','inventory_check_sessions_no_delete','inventory_check_items_no_delete',
      'branch_cutovers_no_delete','branch_cutovers_initial','branch_cutovers_no_active_insert')
    AND sql LIKE '%''restore''%') = 6
THEN 1 ELSE json_extract('[]','$[restore_carveout_0268_post_triggers]') END;
