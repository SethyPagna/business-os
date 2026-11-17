-- inventory-check-approvals-line-set: the two facts to read around a Worker deploy or rollback of the Inventory Check count approvals (migration 0316), as one row of counts.
--   pending_without_line_set       pending approvals whose set of lines was not recorded (line_set_json IS NULL): the approvals a Worker that does not know the column creates between
--                                  `migrations apply` and the publish, or after a rollback. The new Worker reads them by the engine's own rule, so each is correct, but a non-zero count
--                                  after the publish means the old Worker is still serving; run it again once the publish is confirmed.
--   pending_with_line_decisions    pending approvals on which an approver has already rejected or modified a line (line_decisions_json <> '{}'). The PRE-ROLLBACK check: a rolled-back Worker
--                                  ignores the column, so it would apply the rejected lines and the counter's own figure for the modified ones. Zero before any rollback; once approvers use
--                                  per-line decisions this is expected to be non-zero, and that is the signal to decide those approvals before rolling the Worker back.
-- Counts only; the rows themselves stay in the database.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero pending_without_line_set, pending_with_line_decisions
-- ops:max-rows-read 50
SELECT COALESCE(SUM(CASE WHEN line_set_json IS NULL THEN 1 ELSE 0 END), 0) AS pending_without_line_set,
       COALESCE(SUM(CASE WHEN line_decisions_json <> '{}' THEN 1 ELSE 0 END), 0) AS pending_with_line_decisions
FROM inventory_check_approvals
WHERE status = 'pending';
