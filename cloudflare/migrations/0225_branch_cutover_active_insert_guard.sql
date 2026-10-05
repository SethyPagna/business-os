-- BRANCH-CUTOVER: refuse a second cutover insert while one is unfinished.
--
-- One BEFORE INSERT trigger on branch_cutovers,
-- branch_cutovers_no_active_insert, raising
-- 'branch_cutover_active_insert_refused' while a row whose phase is not
-- completed/aborted exists. It backs the 0224 partial unique index with a named
-- error. No data rewritten: no row is changed, and an existing active journal
-- row stays exactly as it is.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
--                AND name = 'branch_cutovers'  -- expected 1 (0224 applied)
--              SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
--                AND name = 'branch_cutovers_no_active_insert'   -- expected 0
--              SELECT COUNT(*) FROM branch_cutovers (record it)
-- Post-assert: the trigger query               -- expected 1
--              SELECT COUNT(*) FROM branch_cutovers   -- unchanged
-- Deploy order: EITHER, after 0224. No code names this trigger.
-- Recovery:    DROP TRIGGER IF EXISTS branch_cutovers_no_active_insert;
--              The 0224 unique index still allows only one unfinished cutover.

CREATE TRIGGER branch_cutovers_no_active_insert BEFORE INSERT ON branch_cutovers
WHEN EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_insert_refused'); END;
