-- inventory-check-approvals-postflight: the facts to read after every Worker publish that carries the Inventory Check count approvals (migration 0316), as one row of counts. A hard gate in a routine postflight.
--   pending_without_line_set       pending approvals whose set of lines was not recorded (line_set_json IS NULL): the approvals a Worker that does not know the column creates between
--                                  `migrations apply` and the publish, or after a rollback. The new Worker reads them by the engine's own rule, so each is correct and nothing needs repair; they clear as
--                                  they are decided. A non-zero count right after the publish means the old Worker is still serving: run it again once the publish has propagated.
--   items_with_approval_time       Done items of an approval's session whose updated_at is not their session's started_at: an item the approval flip of the previous Worker rewrote (the flip no longer
--                                  writes the time). Such an item makes an older count look like the newest one. Migration 0316 restores them; one that an old Worker flipped between
--                                  `migrations apply` and the publish is restored by repeating the second UPDATE of that file (a production write: the owner's approval first).
-- Neither can be broken by the new Worker itself. The rollback check (pending_with_line_decisions) is a separate query, inventory-check-approvals-pre-rollback, and never belongs here.
-- Counts only; the rows themselves stay in the database.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero pending_without_line_set, items_with_approval_time
-- ops:max-rows-read 100
SELECT (SELECT COUNT(*) FROM inventory_check_approvals WHERE status = 'pending' AND line_set_json IS NULL) AS pending_without_line_set,
       (SELECT COUNT(*) FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id = i.session_id
         WHERE i.state = 'done' AND i.session_id IN (SELECT a.session_id FROM inventory_check_approvals a) AND i.updated_at <> s.started_at) AS items_with_approval_time;
