-- BRANCH-CUTOVER: durable journal for the Shop -> Warehouse branch cutover.
--
-- Creates the new table branch_cutovers, its partial unique index
-- branch_cutovers_one_active (at most one unfinished cutover), ten guard
-- triggers on branch_cutovers (initial state, identity, terminal, no delete,
-- transition, sealed manifest, child/capture/snapshot/verification progress)
-- and three triggers on system_flags (branch_cutovers_flag_insert, _update,
-- _delete) that refuse writes to the 'maintenance' and
-- 'branch_cutover_control_incarnation' flags only while a cutover is
-- unfinished. No data rewritten: the table starts empty, so the system_flags
-- triggers are inert until a cutover begins.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE name = 'branch_cutovers'
--                                              -- expected 0
--              SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'
--                AND name LIKE 'branch_cutovers_%'   -- expected 0
--              SELECT COUNT(*) FROM system_flags (record it)
-- Post-assert: the same two queries            -- expected 1, 13
--              SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
--                AND name = 'branch_cutovers_one_active'   -- expected 1
--              SELECT COUNT(*) FROM branch_cutovers   -- expected 0
--              SELECT COUNT(*) FROM system_flags      -- unchanged
-- Deploy order: MIGRATION FIRST for the cutover routes, which read the table.
--              The previous Worker never touches the table, and its flag
--              writes are unaffected while the table is empty.
-- Recovery:    only while SELECT COUNT(*) FROM branch_cutovers
--                WHERE phase NOT IN ('completed','aborted') is 0, and after
--              rolling the Worker back:
--              DROP TRIGGER IF EXISTS branch_cutovers_flag_insert;
--              DROP TRIGGER IF EXISTS branch_cutovers_flag_update;
--              DROP TRIGGER IF EXISTS branch_cutovers_flag_delete;
--              DROP TABLE IF EXISTS branch_cutovers;
--              Dropping the table also drops its index, its ten triggers and
--              the 0225 trigger. Loses only the cutover journal.

CREATE TABLE branch_cutovers (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) = 36),
  begin_request_id TEXT NOT NULL UNIQUE CHECK(length(begin_request_id) BETWEEN 8 AND 120),
  actor_id INTEGER NOT NULL CHECK(typeof(actor_id) = 'integer' AND actor_id BETWEEN 1 AND 9007199254740991),
  organization_id TEXT NOT NULL CHECK(length(organization_id) BETWEEN 1 AND 128),
  control_incarnation TEXT NOT NULL CHECK(length(control_incarnation) = 36),
  maintenance_token TEXT NOT NULL CHECK(length(maintenance_token) = 36),
  source_branch_id INTEGER NOT NULL CHECK(typeof(source_branch_id) = 'integer' AND source_branch_id BETWEEN 1 AND 9007199254740991),
  target_branch_id INTEGER NOT NULL CHECK(typeof(target_branch_id) = 'integer' AND target_branch_id BETWEEN 1 AND 9007199254740991 AND target_branch_id <> source_branch_id),
  intent_json TEXT NOT NULL CHECK(length(CAST(intent_json AS BLOB)) <= 16384 AND json_valid(intent_json) AND json_type(intent_json) = 'object'),
  intent_digest TEXT NOT NULL CHECK(length(intent_digest) = 64 AND intent_digest NOT GLOB '*[^0-9a-f]*'),
  source_preimage_json TEXT NOT NULL CHECK(length(CAST(source_preimage_json AS BLOB)) <= 16384 AND json_valid(source_preimage_json) AND json_type(source_preimage_json) = 'object' AND json_extract(source_preimage_json, '$.id') IS source_branch_id),
  target_preimage_json TEXT NOT NULL CHECK(length(CAST(target_preimage_json AS BLOB)) <= 16384 AND json_valid(target_preimage_json) AND json_type(target_preimage_json) = 'object' AND json_extract(target_preimage_json, '$.id') IS target_branch_id),
  maintenance_flag_json TEXT NOT NULL CHECK(length(CAST(maintenance_flag_json AS BLOB)) <= 4096 AND json_valid(maintenance_flag_json) AND json_type(maintenance_flag_json) = 'object'),
  phase TEXT NOT NULL DEFAULT 'capturing' CHECK(phase IN ('capturing','snapshots','moving','verifying','ready','completed','aborted')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991),
  capture_cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(capture_cursor_json AS BLOB)) <= 4096 AND json_valid(capture_cursor_json) AND json_type(capture_cursor_json) = 'object'),
  capture_records INTEGER NOT NULL DEFAULT 0 CHECK(typeof(capture_records) = 'integer' AND capture_records BETWEEN 0 AND 9007199254740991),
  capture_digest TEXT NOT NULL CHECK(length(capture_digest) = 64 AND capture_digest NOT GLOB '*[^0-9a-f]*'),
  snapshot_cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(snapshot_cursor_json AS BLOB)) <= 4096 AND json_valid(snapshot_cursor_json) AND json_type(snapshot_cursor_json) = 'object'),
  snapshot_records INTEGER NOT NULL DEFAULT 0 CHECK(typeof(snapshot_records) = 'integer' AND snapshot_records BETWEEN 0 AND 9007199254740991),
  snapshot_digest TEXT NOT NULL CHECK(length(snapshot_digest) = 64 AND snapshot_digest NOT GLOB '*[^0-9a-f]*'),
  verification_cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(length(CAST(verification_cursor_json AS BLOB)) <= 4096 AND json_valid(verification_cursor_json) AND json_type(verification_cursor_json) = 'object'),
  verification_records INTEGER NOT NULL DEFAULT 0 CHECK(typeof(verification_records) = 'integer' AND verification_records BETWEEN 0 AND 9007199254740991),
  verification_digest TEXT NOT NULL CHECK(length(verification_digest) = 64 AND verification_digest NOT GLOB '*[^0-9a-f]*'),
  manifest_json TEXT CHECK(manifest_json IS NULL OR (length(CAST(manifest_json AS BLOB)) <= 16384 AND json_valid(manifest_json) AND json_type(manifest_json) = 'object')),
  manifest_digest TEXT CHECK(manifest_digest IS NULL OR (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*')),
  planned_child_json TEXT CHECK(planned_child_json IS NULL OR (length(CAST(planned_child_json AS BLOB)) <= 65536 AND json_valid(planned_child_json) AND json_type(planned_child_json) = 'object')),
  planned_child_key TEXT CHECK(planned_child_key IS NULL OR length(planned_child_key) BETWEEN 8 AND 120),
  planned_child_digest TEXT CHECK(planned_child_digest IS NULL OR (length(planned_child_digest) = 64 AND planned_child_digest NOT GLOB '*[^0-9a-f]*')),
  next_sequence INTEGER NOT NULL DEFAULT 0 CHECK(typeof(next_sequence) = 'integer' AND next_sequence BETWEEN 0 AND 9007199254740991),
  committed_children INTEGER NOT NULL DEFAULT 0 CHECK(typeof(committed_children) = 'integer' AND committed_children = next_sequence),
  terminal_json TEXT CHECK(terminal_json IS NULL OR (length(CAST(terminal_json AS BLOB)) <= 32768 AND json_valid(terminal_json) AND json_type(terminal_json) = 'object')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((manifest_json IS NULL) = (manifest_digest IS NULL)),
  CHECK((planned_child_json IS NULL) = (planned_child_key IS NULL) AND (planned_child_json IS NULL) = (planned_child_digest IS NULL)),
  CHECK((phase IN ('completed','aborted')) = (terminal_json IS NOT NULL)),
  CHECK(phase IN ('capturing','aborted') OR manifest_json IS NOT NULL),
  CHECK(planned_child_json IS NULL OR phase = 'moving'),
  CHECK(terminal_json IS NULL OR (json_extract(terminal_json,'$.version') IS 1 AND json_extract(terminal_json,'$.operationId') IS operation_id AND json_extract(terminal_json,'$.kind') IS phase))
);

CREATE UNIQUE INDEX branch_cutovers_one_active ON branch_cutovers((1))
WHERE phase NOT IN ('completed','aborted');

CREATE TRIGGER branch_cutovers_initial BEFORE INSERT ON branch_cutovers
WHEN EXISTS (SELECT 1 FROM branch_cutovers WHERE operation_id = NEW.operation_id OR begin_request_id = NEW.begin_request_id)
  OR NEW.phase <> 'capturing' OR NEW.revision <> 0 OR NEW.next_sequence <> 0 OR NEW.committed_children <> 0
  OR NEW.capture_records <> 0 OR NEW.snapshot_records <> 0 OR NEW.verification_records <> 0
  OR NEW.capture_cursor_json <> '{}' OR NEW.snapshot_cursor_json <> '{}' OR NEW.verification_cursor_json <> '{}'
  OR NEW.manifest_json IS NOT NULL OR NEW.planned_child_json IS NOT NULL OR NEW.terminal_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_initial_state'); END;

CREATE TRIGGER branch_cutovers_identity BEFORE UPDATE ON branch_cutovers
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.begin_request_id IS NOT OLD.begin_request_id
  OR NEW.actor_id IS NOT OLD.actor_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.control_incarnation IS NOT OLD.control_incarnation OR NEW.maintenance_token IS NOT OLD.maintenance_token
  OR NEW.source_branch_id IS NOT OLD.source_branch_id OR NEW.target_branch_id IS NOT OLD.target_branch_id
  OR NEW.intent_json IS NOT OLD.intent_json OR NEW.intent_digest IS NOT OLD.intent_digest
  OR NEW.source_preimage_json IS NOT OLD.source_preimage_json OR NEW.target_preimage_json IS NOT OLD.target_preimage_json
  OR NEW.maintenance_flag_json IS NOT OLD.maintenance_flag_json OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'branch_cutover_identity_immutable'); END;

CREATE TRIGGER branch_cutovers_terminal BEFORE UPDATE ON branch_cutovers
WHEN OLD.phase IN ('completed','aborted')
BEGIN SELECT RAISE(ABORT, 'branch_cutover_terminal_immutable'); END;

CREATE TRIGGER branch_cutovers_no_delete BEFORE DELETE ON branch_cutovers
BEGIN SELECT RAISE(ABORT, 'branch_cutover_no_delete'); END;

CREATE TRIGGER branch_cutovers_transition BEFORE UPDATE ON branch_cutovers
WHEN NEW.revision <> OLD.revision + 1 OR NOT (
  NEW.phase = OLD.phase
  OR (OLD.phase = 'capturing' AND NEW.phase = 'snapshots')
  OR (OLD.phase = 'snapshots' AND NEW.phase IN ('moving','verifying'))
  OR (OLD.phase = 'moving' AND NEW.phase = 'verifying' AND NEW.planned_child_json IS NULL)
  OR (OLD.phase = 'verifying' AND NEW.phase = 'ready')
  OR (OLD.phase = 'ready' AND NEW.phase = 'completed')
  OR (NEW.phase = 'aborted' AND OLD.next_sequence = 0 AND OLD.planned_child_json IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_transition'); END;

CREATE TRIGGER branch_cutovers_sealed_manifest BEFORE UPDATE ON branch_cutovers
WHEN (OLD.manifest_json IS NOT NULL AND (NEW.manifest_json IS NOT OLD.manifest_json OR NEW.manifest_digest IS NOT OLD.manifest_digest))
  OR (OLD.manifest_json IS NULL AND NEW.manifest_json IS NOT NULL AND NOT (OLD.phase = 'capturing' AND NEW.phase = 'snapshots'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_manifest_immutable'); END;

CREATE TRIGGER branch_cutovers_child_progress BEFORE UPDATE ON branch_cutovers
WHEN NOT (
  (NEW.next_sequence = OLD.next_sequence AND (
    (NEW.planned_child_json IS OLD.planned_child_json AND NEW.planned_child_key IS OLD.planned_child_key AND NEW.planned_child_digest IS OLD.planned_child_digest)
    OR (OLD.planned_child_json IS NULL AND NEW.planned_child_json IS NOT NULL AND OLD.phase = 'moving' AND NEW.phase = 'moving')
  ))
  OR (NEW.next_sequence = OLD.next_sequence + 1 AND OLD.planned_child_json IS NOT NULL AND NEW.planned_child_json IS NULL AND OLD.phase = 'moving' AND NEW.phase IN ('moving','verifying'))
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_child_progress'); END;

CREATE TRIGGER branch_cutovers_capture_progress BEFORE UPDATE ON branch_cutovers
WHEN NEW.capture_records < OLD.capture_records OR (
  (NEW.capture_cursor_json IS NOT OLD.capture_cursor_json OR NEW.capture_records IS NOT OLD.capture_records OR NEW.capture_digest IS NOT OLD.capture_digest)
  AND NOT (OLD.phase = 'capturing' AND NEW.phase = 'capturing')
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_capture_progress'); END;

CREATE TRIGGER branch_cutovers_snapshot_progress BEFORE UPDATE ON branch_cutovers
WHEN NEW.snapshot_records < OLD.snapshot_records OR (
  (NEW.snapshot_cursor_json IS NOT OLD.snapshot_cursor_json OR NEW.snapshot_records IS NOT OLD.snapshot_records OR NEW.snapshot_digest IS NOT OLD.snapshot_digest)
  AND NOT (OLD.phase = 'snapshots' AND NEW.phase = 'snapshots')
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_snapshot_progress'); END;

CREATE TRIGGER branch_cutovers_verification_progress BEFORE UPDATE ON branch_cutovers
WHEN NEW.verification_records < OLD.verification_records OR (
  (NEW.verification_cursor_json IS NOT OLD.verification_cursor_json OR NEW.verification_records IS NOT OLD.verification_records OR NEW.verification_digest IS NOT OLD.verification_digest)
  AND NOT (OLD.phase = 'verifying' AND NEW.phase = 'verifying')
)
BEGIN SELECT RAISE(ABORT, 'branch_cutover_invalid_verification_progress'); END;

CREATE TRIGGER branch_cutovers_flag_insert BEFORE INSERT ON system_flags
WHEN NEW.key IN ('maintenance','branch_cutover_control_incarnation')
  AND EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_control_protected'); END;

CREATE TRIGGER branch_cutovers_flag_update BEFORE UPDATE ON system_flags
WHEN (OLD.key IN ('maintenance','branch_cutover_control_incarnation') OR NEW.key IN ('maintenance','branch_cutover_control_incarnation'))
  AND EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_control_protected'); END;

CREATE TRIGGER branch_cutovers_flag_delete BEFORE DELETE ON system_flags
WHEN OLD.key IN ('maintenance','branch_cutover_control_incarnation')
  AND EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed','aborted'))
BEGIN SELECT RAISE(ABORT, 'branch_cutover_active_control_protected'); END;
