-- Local additive proposal. PRE: preserve all business/control counts and sums.
-- POST: business rows unchanged; journal empty. No historical backfill.
-- These tables are CONTROL state: never put them in destructive restore/reset
-- or ordinary backup table lists. Preserve on code rollback and recovery.
-- Requires the current-generation system_flags contract from reviewed 0186
-- before use; absence fails closed. This migration does not change generation.
CREATE VIEW dataset_operation_current_principals AS
SELECT u.id AS actor_id, u.organization_id,
 json_object('id',u.id,'org',u.organization_id,'created',u.created_at,
 'username',u.username,'roleId',u.role_id,'permissions',u.permissions,
 'roleCode',r.code,'rolePermissions',r.permissions) AS principal_json
FROM users u LEFT JOIN roles r ON r.id=u.role_id
WHERE u.is_active=1 AND u.deleted_at IS NULL;

CREATE TABLE dataset_operations (
 id TEXT PRIMARY KEY NOT NULL, epoch TEXT NOT NULL UNIQUE,
 request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
 actor_id INTEGER NOT NULL, organization_id INTEGER, principal_json TEXT NOT NULL CHECK(json_valid(principal_json)),
 kind TEXT NOT NULL CHECK(kind IN ('restore','reset')),
 source_json TEXT NOT NULL CHECK(json_valid(source_json) AND length(source_json)<=8192),
 request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=65536),
 dataset_generation TEXT NOT NULL, maintenance_token TEXT NOT NULL,
 phase TEXT NOT NULL, cursor_json TEXT NOT NULL CHECK(json_valid(cursor_json) AND length(cursor_json)<=4096),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(actor_id,request_id)
);
CREATE TABLE dataset_operation_head (
 id INTEGER PRIMARY KEY CHECK(id=1), operation_id TEXT NOT NULL REFERENCES dataset_operations(id), epoch TEXT NOT NULL
);
CREATE TABLE dataset_operation_invalidations (
 operation_id TEXT PRIMARY KEY REFERENCES dataset_operations(id), reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE dataset_operation_chunks (
 operation_id TEXT NOT NULL REFERENCES dataset_operations(id), sequence INTEGER NOT NULL CHECK(sequence>=0),
 plan_digest TEXT NOT NULL, phase_before TEXT NOT NULL, cursor_before TEXT NOT NULL,
 phase_after TEXT NOT NULL, cursor_after TEXT NOT NULL CHECK(json_valid(cursor_after)),
 final INTEGER NOT NULL CHECK(final IN (0,1)), response_json TEXT NOT NULL CHECK(json_valid(response_json) AND length(response_json)<=16384),
 PRIMARY KEY(operation_id,sequence)
);
-- Private transaction assertion, never exposed as a split-prefix write API.
CREATE TABLE dataset_operation_fence (
 id INTEGER PRIMARY KEY CHECK(id=1), ok INTEGER NOT NULL CHECK(ok=1),
 operation_id TEXT NOT NULL, epoch TEXT NOT NULL, sequence INTEGER NOT NULL
);
CREATE TRIGGER dataset_operation_identity BEFORE UPDATE ON dataset_operations
WHEN NEW.id IS NOT OLD.id OR NEW.epoch IS NOT OLD.epoch
 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.principal_json IS NOT OLD.principal_json OR NEW.request_id IS NOT OLD.request_id
 OR NEW.request_digest IS NOT OLD.request_digest OR NEW.request_json IS NOT OLD.request_json
 OR NEW.kind IS NOT OLD.kind OR NEW.source_json IS NOT OLD.source_json
 OR NEW.dataset_generation IS NOT OLD.dataset_generation OR NEW.maintenance_token IS NOT OLD.maintenance_token
 OR NEW.created_at IS NOT OLD.created_at OR OLD.status<>'active' OR NEW.revision<>OLD.revision+1
 OR NOT EXISTS(SELECT 1 FROM dataset_operation_fence f JOIN dataset_operation_chunks c
 ON c.operation_id=f.operation_id AND c.sequence=f.sequence
 WHERE f.id=1 AND f.operation_id=OLD.id AND f.epoch=OLD.epoch AND f.sequence=OLD.revision
 AND c.phase_before=OLD.phase AND c.cursor_before=OLD.cursor_json
 AND c.phase_after=NEW.phase AND c.cursor_after=NEW.cursor_json
 AND NEW.status=CASE WHEN c.final=1 THEN 'completed' ELSE 'active' END)
BEGIN SELECT RAISE(ABORT,'dataset operation identity or position is immutable'); END;
CREATE TRIGGER dataset_operation_no_replace BEFORE INSERT ON dataset_operations
WHEN EXISTS(SELECT 1 FROM dataset_operations WHERE id=NEW.id OR epoch=NEW.epoch OR (actor_id=NEW.actor_id AND request_id=NEW.request_id))
BEGIN SELECT RAISE(ABORT,'dataset request permanently reserved'); END;
CREATE TRIGGER dataset_operation_no_delete BEFORE DELETE ON dataset_operations
BEGIN SELECT RAISE(ABORT,'dataset journal is permanent'); END;
CREATE TRIGGER dataset_chunk_admission BEFORE INSERT ON dataset_operation_chunks
WHEN NOT EXISTS(SELECT 1 FROM dataset_operation_fence f WHERE f.id=1 AND f.operation_id=NEW.operation_id AND f.sequence=NEW.sequence)
 OR EXISTS(SELECT 1 FROM dataset_operation_chunks WHERE operation_id=NEW.operation_id AND sequence=NEW.sequence)
BEGIN SELECT RAISE(ABORT,'dataset chunk requires atomic fence'); END;
CREATE TRIGGER dataset_chunk_no_update BEFORE UPDATE ON dataset_operation_chunks
BEGIN SELECT RAISE(ABORT,'dataset chunk receipt is immutable'); END;
CREATE TRIGGER dataset_chunk_no_delete BEFORE DELETE ON dataset_operation_chunks
BEGIN SELECT RAISE(ABORT,'dataset chunk receipt is permanent'); END;
CREATE TRIGGER dataset_invalidation_no_update BEFORE UPDATE ON dataset_operation_invalidations
BEGIN SELECT RAISE(ABORT,'dataset revocation is permanent'); END;
CREATE TRIGGER dataset_invalidation_no_delete BEFORE DELETE ON dataset_operation_invalidations
BEGIN SELECT RAISE(ABORT,'dataset revocation is permanent'); END;
CREATE TRIGGER dataset_principal_delete BEFORE DELETE ON users
BEGIN INSERT OR IGNORE INTO dataset_operation_invalidations(operation_id,reason) SELECT id,'principal deleted' FROM dataset_operations WHERE actor_id=OLD.id; END;
CREATE TRIGGER dataset_principal_change AFTER UPDATE ON users
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.created_at IS NOT OLD.created_at
 OR NEW.username IS NOT OLD.username OR NEW.role_id IS NOT OLD.role_id OR NEW.permissions IS NOT OLD.permissions
 OR NEW.is_active IS NOT OLD.is_active OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.password IS NOT OLD.password
BEGIN INSERT OR IGNORE INTO dataset_operation_invalidations(operation_id,reason) SELECT id,'principal changed' FROM dataset_operations WHERE actor_id=OLD.id; END;
CREATE TRIGGER dataset_role_change AFTER UPDATE ON roles
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.permissions IS NOT OLD.permissions
BEGIN INSERT OR IGNORE INTO dataset_operation_invalidations(operation_id,reason) SELECT id,'role changed' FROM dataset_operations WHERE json_extract(principal_json,'$.roleId')=OLD.id; END;
CREATE TRIGGER dataset_role_delete BEFORE DELETE ON roles
BEGIN INSERT OR IGNORE INTO dataset_operation_invalidations(operation_id,reason) SELECT id,'role deleted' FROM dataset_operations WHERE json_extract(principal_json,'$.roleId')=OLD.id; END;
-- REPLACE may suppress DELETE triggers with recursive_triggers off. Invalidate
-- before any conflicting INSERT as well; failed ordinary inserts roll back it.
CREATE TRIGGER dataset_principal_replace BEFORE INSERT ON users
WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.id)
BEGIN INSERT OR IGNORE INTO dataset_operation_invalidations(operation_id,reason) SELECT id,'principal replaced' FROM dataset_operations WHERE actor_id=NEW.id; END;
CREATE TRIGGER dataset_role_replace BEFORE INSERT ON roles
WHEN EXISTS(SELECT 1 FROM roles WHERE id=NEW.id)
BEGIN INSERT OR IGNORE INTO dataset_operation_invalidations(operation_id,reason) SELECT id,'role replaced' FROM dataset_operations WHERE json_extract(principal_json,'$.roleId')=NEW.id; END;
CREATE TRIGGER dataset_head_no_delete BEFORE DELETE ON dataset_operation_head
BEGIN SELECT RAISE(ABORT,'dataset operation head is control state'); END;
CREATE TRIGGER dataset_invalidation_no_replace BEFORE INSERT ON dataset_operation_invalidations
WHEN EXISTS(SELECT 1 FROM dataset_operation_invalidations WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(IGNORE); END;
