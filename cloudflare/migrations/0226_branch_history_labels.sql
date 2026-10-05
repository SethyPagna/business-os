-- BRANCH-HISTORY-LABELS: keep the branch name a transfer or a stock session used.
--
-- Adds stock_transfers.from_branch_name, stock_transfers.to_branch_name and
-- stock_session_members.branch_name (nullable TEXT, no default). No data
-- rewritten and no backfill: historical rows stay NULL and readers fall back to
-- the live branches.name (lib/stockInSessionsQuery.ts branchHistoryNameSql).
--
-- Pre-assert:  SELECT COUNT(*) FROM pragma_table_info('stock_transfers')
--                WHERE name IN ('from_branch_name','to_branch_name')
--                                              -- expected 0
--              SELECT COUNT(*) FROM pragma_table_info('stock_session_members')
--                WHERE name = 'branch_name'    -- expected 0
--              SELECT COUNT(*) FROM stock_transfers and
--                SELECT COUNT(*) FROM stock_session_members (record both)
-- Post-assert: the same two pragma queries     -- expected 2, 1
--              both row counts unchanged
--              SELECT COUNT(*) FROM stock_transfers WHERE from_branch_name
--                IS NOT NULL OR to_branch_name IS NOT NULL   -- expected 0
--              SELECT COUNT(*) FROM stock_session_members
--                WHERE branch_name IS NOT NULL -- expected 0
-- Deploy order: MIGRATION FIRST. The candidate Worker writes these columns on
--              transfers and stock sessions and reads them in transfer history
--              with no column probe ("no such column" otherwise). The previous
--              Worker runs unchanged on the new schema.
-- Recovery:    never while the candidate Worker is live. Roll the Worker back
--              first, then
--              ALTER TABLE stock_transfers DROP COLUMN from_branch_name;
--              ALTER TABLE stock_transfers DROP COLUMN to_branch_name;
--              ALTER TABLE stock_session_members DROP COLUMN branch_name;
--              Loses only the names recorded since; quantities and links are
--              unaffected.

ALTER TABLE stock_transfers ADD COLUMN from_branch_name TEXT;
ALTER TABLE stock_transfers ADD COLUMN to_branch_name TEXT;
ALTER TABLE stock_session_members ADD COLUMN branch_name TEXT;
