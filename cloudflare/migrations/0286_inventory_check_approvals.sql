-- 0286: the approval a submitted Inventory Check count waits for (lane 6.0.1045, ic_fix_stock).
--
-- A count submitted from the list (0259 tables, closed session scope.membership = 'submission') whose figures differ from stock changes
-- nothing by itself: it creates ONE approval row, status 'pending'. An administrator holding "approve counts" approves it (stock is then set
-- to counted minus damaged units, line by line, through the existing Set writer) or rejects it (nothing changes). The row records who
-- submitted and who decided, when, and per product the figures before and after. New table only: no existing table, row or trigger changes.
--
-- PRE:  the three 0259 tables exist; inventory_check_approvals does not. A failed check reads a malformed JSON path and aborts the file.
-- POST: the table exists with its index and three triggers; it holds no row; the three 0259 tables are unchanged (the companion test
--       counts them before and after).
-- Append-only, LF-only, generic (no client data), idempotent only through the PRE check (a second run aborts on the existing table).
-- Rollback-safe: the previous Worker never names the table, so it runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0286-inventory-check-approvals-native.cjs.
--
-- Immutable once decided, like the history it belongs to:
--   * the identity columns can never change; a decided row (approved or rejected) can never change again;
--   * a pending row may only gain applied_json entries (the per-product results of a partly applied approval) or be decided;
--   * rows are never deleted, except while the restore maintenance flag is set (the same carve-out as 0268).
--
-- RECOVERY: schema only, nothing to restore.
--   DROP TABLE IF EXISTS inventory_check_approvals;   -- after removing it from BACKUP_TABLES, or a restore aborts on the missing table

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('inventory_check_sessions','inventory_check_items','inventory_check_events')) = 3
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name = 'inventory_check_approvals') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_approvals_0286_pre]') END;

CREATE TABLE inventory_check_approvals (
  session_id TEXT PRIMARY KEY,
  organization_id INTEGER,
  branch_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  lines INTEGER NOT NULL CHECK(lines>0),
  submitted_by INTEGER NOT NULL,
  submitted_at TEXT NOT NULL,
  decided_by INTEGER,
  decided_by_name TEXT,
  decided_at TEXT,
  decision_note TEXT CHECK(decision_note IS NULL OR length(decision_note)<=500),
  decision_request_id TEXT,
  applied_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(applied_json) AND json_type(applied_json)='object'),
  FOREIGN KEY(session_id) REFERENCES inventory_check_sessions(id),
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_request_id IS NULL)
    OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_request_id IS NOT NULL))
);
CREATE INDEX inventory_check_approvals_pending ON inventory_check_approvals(organization_id, status, submitted_at DESC);

CREATE TRIGGER inventory_check_approvals_identity BEFORE UPDATE OF
  session_id,organization_id,branch_id,lines,submitted_by,submitted_at ON inventory_check_approvals
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;
CREATE TRIGGER inventory_check_approvals_decided BEFORE UPDATE ON inventory_check_approvals
WHEN OLD.status <> 'pending'
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;
CREATE TRIGGER inventory_check_approvals_no_delete BEFORE DELETE ON inventory_check_approvals
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = 'inventory_check_approvals' AND type = 'trigger') = 3
  AND (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = 'inventory_check_approvals' AND type = 'index' AND name = 'inventory_check_approvals_pending') = 1
  AND (SELECT COUNT(*) FROM inventory_check_approvals) = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_approvals_0286_post]') END;
