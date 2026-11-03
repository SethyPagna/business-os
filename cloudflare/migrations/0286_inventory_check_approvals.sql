-- 0286: the approval a submitted Inventory Check count waits for (lane 6.0.1045, ic_fix_stock).
--
-- A count submitted from the list (0259 tables, closed session scope.membership = 'submission') whose figures differ from stock changes
-- nothing by itself: it creates ONE approval row, status 'pending'. An administrator holding "approve counts" approves it (stock is then set
-- by what the count found, line by line, through the existing stock writers) or rejects it (nothing changes). The row records who
-- submitted and who decided, when, and per product the figures before and after. New table only: no existing table, row or trigger changes.
--
-- A count is applied as the VARIANCE it found: counted minus the stock the counter SAW when counting (baselines_json, recorded at submit), added to the
-- ordinary stock of the moment of approval, never below zero. A sale between the count and the approval therefore survives it.
-- Applying is claimed before any stock is written: applying_request_id / applying_by name the one request (and person) continuing it, and plan_json
-- holds the exact figures each line was sent with, so a repeat after a lost answer sends the identical request and the stock writers replay it.
--
-- One waiting item per product, holding the newest count (queue-first): a later count of a product whose earlier count still waits at the branch closes that older
-- line as superseded in the same atomic commit that records the new count. superseded_json maps product id -> the session of the newer count; a superseded line is
-- never applied, never waits, and is not counted as unapplied by a close. A line whose stock figures are planned (plan_json) is being applied and is never superseded:
-- the newer count is refused instead, so the two never race. An approval left with no line to apply and nothing applied is rejected in that same commit, by the system, not by a person:
-- decided_by and decided_by_name stay NULL (the only decision the table accepts without a decider, and only as a rejection that carries its note), the note says why, and the pages read it as "replaced".
-- The index inventory_check_approvals_progress bounds the read that asks whether another approval applied a product since a count (decided or last claimed time).
--
-- PRE:  the three 0259 tables exist; inventory_check_approvals does not. A failed check reads a malformed JSON path and aborts the file.
-- POST: the table exists with its two indexes and four triggers; it holds no row; the three 0259 tables are unchanged (the companion test
--       counts them before and after).
-- Append-only, LF-only, generic (no client data), idempotent only through the PRE check (a second run aborts on the existing table).
-- Rollback-safe: the previous Worker never names the table, so it runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0286-inventory-check-approvals-native.cjs.
--
-- Immutable once decided, like the history it belongs to:
--   * the identity columns can never change; a decided row (approved or rejected) can never change again;
--   * a pending row may only gain applied_json entries (the per-product results of a partly applied approval), take or release its claim, or be decided;
--   * a claimed row (stock may already have moved) can never be REJECTED, only closed (closed_json: no stock moves, the lines applied stay applied and the rest are recorded as not applied);
--   * its claim changes hands only by a counted takeover (takeovers + 1, planned afresh), and is released only while nothing is planned or applied;
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
  baselines_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(baselines_json) AND json_type(baselines_json)='object'),
  applying_request_id TEXT,
  applying_by INTEGER,
  applying_at TEXT,
  takeovers INTEGER NOT NULL DEFAULT 0 CHECK(takeovers>=0),
  closed_json TEXT CHECK(closed_json IS NULL OR (json_valid(closed_json) AND json_type(closed_json)='object')),
  plan_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(plan_json) AND json_type(plan_json)='object'),
  superseded_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(superseded_json) AND json_type(superseded_json)='object'),
  FOREIGN KEY(session_id) REFERENCES inventory_check_sessions(id),
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_request_id IS NULL)
    OR (status<>'pending' AND decided_at IS NOT NULL AND decision_request_id IS NOT NULL
      AND (decided_by IS NOT NULL OR (status='rejected' AND decided_by_name IS NULL AND decision_note IS NOT NULL)))),
  CHECK((applying_request_id IS NULL) = (applying_by IS NULL) AND (applying_request_id IS NULL) = (applying_at IS NULL)),
  CHECK(closed_json IS NULL OR status<>'pending')
);
CREATE INDEX inventory_check_approvals_pending ON inventory_check_approvals(organization_id, status, submitted_at DESC);
CREATE INDEX inventory_check_approvals_progress ON inventory_check_approvals(branch_id, COALESCE(decided_at, applying_at));

CREATE TRIGGER inventory_check_approvals_identity BEFORE UPDATE OF
  session_id,organization_id,branch_id,lines,submitted_by,submitted_at,baselines_json ON inventory_check_approvals
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;
CREATE TRIGGER inventory_check_approvals_decided BEFORE UPDATE ON inventory_check_approvals
WHEN OLD.status <> 'pending'
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;
CREATE TRIGGER inventory_check_approvals_claim BEFORE UPDATE ON inventory_check_approvals
WHEN (NEW.takeovers IS NOT OLD.takeovers AND NOT (NEW.takeovers = OLD.takeovers + 1 AND OLD.applying_request_id IS NOT NULL AND NEW.applying_by IS NOT OLD.applying_by))
  OR (OLD.applying_request_id IS NOT NULL AND ((NEW.status = 'rejected' AND NEW.closed_json IS NULL)
    OR NOT ((NEW.applying_request_id IS OLD.applying_request_id AND NEW.applying_by IS OLD.applying_by)
      OR (NEW.applying_request_id IS NULL AND NEW.plan_json = '{}' AND json_extract(NEW.applied_json,'$.lines') IS NULL)
      OR (NEW.status = 'pending' AND NEW.applying_request_id IS NOT NULL AND NEW.applying_by IS NOT OLD.applying_by AND NEW.takeovers = OLD.takeovers + 1 AND NEW.plan_json = '{}'))))
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;
CREATE TRIGGER inventory_check_approvals_no_delete BEFORE DELETE ON inventory_check_approvals
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_approval_immutable'); END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = 'inventory_check_approvals' AND type = 'trigger') = 4
  AND (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = 'inventory_check_approvals' AND type = 'index' AND name IN ('inventory_check_approvals_pending','inventory_check_approvals_progress')) = 2
  AND (SELECT COUNT(*) FROM inventory_check_approvals) = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_approvals_0286_post]') END;
