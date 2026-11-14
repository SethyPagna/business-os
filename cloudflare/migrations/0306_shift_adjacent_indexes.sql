-- 0306: two indexes so the shift close finds the segment before / after a shift by SEEK, not by scanning every stored shift (lane/shift-close-reads).
--
-- readAdjacentShift (routes/shifts.ts) filters shift_sessions on scope_mode, branch_id, (user_id for a per-account shift), cancelled_at IS NULL and opened_at < / >= x,
-- ordered by opened_at, id, LIMIT 1. No index held opened_at, so every close and every amend walked the whole table (measured 2881 + 362 rows read at 360 stored shifts,
-- growing about 8 rows per stored shift: the wide SHIFT_COLUMNS subselects ran for every candidate row). The route now also picks the id with a narrow inner SELECT
-- (see the function comment); these two indexes make that inner SELECT a seek that stops at its first row, whichever scope the shop runs:
--   idx_shift_sessions_scope_branch_opened       (scope_mode, branch_id, opened_at)           shop-wide shifts (no user in the WHERE)
--   idx_shift_sessions_scope_user_branch_opened  (scope_mode, user_id, branch_id, opened_at)  per-account shifts
-- Both are PARTIAL (WHERE cancelled_at IS NULL), which is readAdjacentShift's own predicate: SQLite uses a partial index only for a statement that states it, so no other
-- shift_sessions statement (GET /current's readCurrent filters by business_date and never says cancelled_at) can be pulled onto them by the planner. Full-table indexes did
-- exactly that (read-budget shifts-current: 8 rows became 368 on a 360-shift world, plan: SEARCH USING INDEX idx_shift_sessions_scope_user_branch_opened (scope_mode=? AND user_id=?)).
-- Cancelled shifts are not indexed, so a cancel removes its two index rows. The statements that name cancelled_at IS NULL and a scope (readPreviousOpen, readStaleDrawersToAlert)
-- are kept on their open-shift / business_date indexes by `+scope_mode` in the route.
-- The row id (the INTEGER PRIMARY KEY, so the rowid) is the implicit last column of both, which is the ORDER BY tie-break; no temp b-tree is needed.
--
-- PRE:  shift_sessions exists; neither index exists. A failed check reads a malformed JSON path and aborts the file.
-- POST: both indexes exist on shift_sessions with their columns and the cancelled_at IS NULL predicate; no table or row changes (the pairing of columns is pinned by scripts/test-migration-0306-shift-adjacent-indexes-pure.cjs,
--       which also pins the EXPLAIN plans: a migration cannot run EXPLAIN).
-- Cost: two index rows per non-cancelled shift_sessions insert (an open, a reopen or replacement segment, a restore); an UPDATE that does not touch scope_mode, user_id, branch_id or opened_at
--       writes none (the close); a cancel removes the two rows. The amend route that moves opened_at rewrites them.
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups), generic (no client data). Idempotent only through the PRE check.
-- Rollback-safe: the previous Worker never names these indexes and runs unchanged on the new schema.
-- RECOVERY: schema only. Full undo: DROP INDEX IF EXISTS idx_shift_sessions_scope_user_branch_opened; DROP INDEX IF EXISTS idx_shift_sessions_scope_branch_opened;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'shift_sessions') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_shift_sessions_scope_branch_opened', 'idx_shift_sessions_scope_user_branch_opened')) = 0
THEN 1 ELSE json_extract('[]','$[shift_adjacent_indexes_0306_pre]') END;

CREATE INDEX idx_shift_sessions_scope_branch_opened ON shift_sessions (scope_mode, branch_id, opened_at) WHERE cancelled_at IS NULL;

CREATE INDEX idx_shift_sessions_scope_user_branch_opened ON shift_sessions (scope_mode, user_id, branch_id, opened_at) WHERE cancelled_at IS NULL;
