-- inventory-check-approvals-pre-rollback: run ONLY before deploy-rollback.yml, never in a routine postflight and never in a pack. One row, one count.
--   pending_with_line_decisions    pending approvals on which an approver has already rejected or modified a line (line_decisions_json <> '{}'). A rolled-back Worker ignores the column, so it would
--                                  apply the rejected lines and the counter's own figure for the modified ones. Zero is the only safe answer to roll back on; once approvers use per-line decisions
--                                  this is expected to be non-zero in normal operation, and that is the signal to decide or close those approvals before rolling the Worker back.
-- Counts only; the rows themselves stay in the database.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero pending_with_line_decisions
-- ops:max-rows-read 100
SELECT (SELECT COUNT(*) FROM inventory_check_approvals WHERE status = 'pending' AND line_decisions_json <> '{}') AS pending_with_line_decisions;
