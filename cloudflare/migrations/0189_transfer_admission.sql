-- LOCAL PROTOTYPE ONLY. Run the complete migration atomically under maintenance.
-- All control tables below are excluded from destructive reset/upload restore.
INSERT INTO branches(name) SELECT NULL WHERE NOT EXISTS(
 SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore'
 AND length(COALESCE(json_extract(value,'$.token'),''))>0);
CREATE TABLE transfer_admission_bootstrap (
 id INTEGER PRIMARY KEY CHECK(id=1), generation TEXT NOT NULL, state TEXT NOT NULL CHECK(state='sealed')
);
CREATE TABLE transfer_history_bindings (
 id TEXT PRIMARY KEY, dataset_generation TEXT NOT NULL, operation_id TEXT NOT NULL,
 receipt_id INTEGER NOT NULL, history_id INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('branches','inventory')),
 receipt_identity TEXT NOT NULL, history_identity TEXT NOT NULL, member_count INTEGER NOT NULL CHECK(member_count>0),
 source TEXT NOT NULL CHECK(source IN ('installation','new','restored')),
 self_actor_id INTEGER, self_org_id INTEGER, self_created_at TEXT,
 UNIQUE(dataset_generation,operation_id)
);
CREATE TABLE transfer_binding_invalidations (
 binding_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('self','bundle')), reason TEXT NOT NULL,
 PRIMARY KEY(binding_id,scope)
);
CREATE TABLE transfer_execution_heads (
 binding_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
 generation INTEGER NOT NULL, replay_state TEXT NOT NULL, history_status TEXT NOT NULL
);
CREATE TABLE transfer_owner_admissions (
 actor_id INTEGER NOT NULL, request_id TEXT NOT NULL, binding_id TEXT NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE transfer_install_dispositions (
 receipt_id INTEGER PRIMARY KEY, disposition TEXT NOT NULL
);
CREATE TABLE transfer_execution_guard (
 id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('new','restored','replay')),
 dataset_generation TEXT NOT NULL, binding_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id INTEGER NOT NULL, organization_id INTEGER, actor_created_at TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority IN ('self','cross')),
 username TEXT NOT NULL, role_id INTEGER, role_code TEXT, user_permissions TEXT, role_permissions TEXT,
 old_generation INTEGER, new_generation INTEGER, old_state TEXT, new_state TEXT,
 old_status TEXT, new_status TEXT, old_revision INTEGER, scope TEXT
);
CREATE VIEW transfer_binding_history_rows AS SELECT h.*,
 json_object('id',id,'scope',scope,'entity',entity,'entity_id',entity_id,'created_by_id',created_by_id,'created_at',created_at,
 'undo',json_remove(undo_payload,'$.generation'),'redo',json_remove(redo_payload,'$.generation')) AS identity_json
 FROM action_history h WHERE json_valid(undo_payload) AND json_valid(redo_payload);
-- Fence old Workers BEFORE reading the installation head. Trigger persists.
CREATE TRIGGER transfer_admission_maintenance_update BEFORE UPDATE ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
BEGIN SELECT RAISE(ABORT,'transfer execution blocked by maintenance'); END;
INSERT INTO transfer_admission_bootstrap SELECT 1,json_extract(value,'$.generation'),'sealed'
 FROM system_flags WHERE key='business_dataset_generation';
INSERT INTO branches(name) SELECT NULL WHERE (SELECT COUNT(*) FROM transfer_admission_bootstrap)<>1;
INSERT INTO transfer_history_bindings
 SELECT 'install:'||p.operation_id,b.generation,p.operation_id,p.id,h.id,h.scope,p.identity_json,h.identity_json,
 (SELECT COUNT(*) FROM transfer_operation_members m WHERE m.receipt_id=p.id),'installation',u.id,u.organization_id,u.created_at
 FROM transfer_receipt_retirement_rows p JOIN transfer_binding_history_rows h ON h.id=p.action_history_id
 CROSS JOIN transfer_admission_bootstrap b LEFT JOIN users u ON u.id=p.actor_id AND u.is_active=1 AND u.deleted_at IS NULL
 WHERE p.status='committed' AND p.provenance_version=1 AND p.operation_id IS NOT NULL
 AND h.scope IN ('branches','inventory') AND h.entity='stock_transfer' AND h.created_by_id=p.actor_id AND h.entity_id=p.operation_id AND h.reversible=1
 AND json_extract(h.undo_payload,'$.applier')='stock.transfer' AND json_extract(h.redo_payload,'$.applier')='stock.transfer'
 AND json_extract(h.undo_payload,'$.operation_id')=p.operation_id AND json_extract(h.redo_payload,'$.operation_id')=p.operation_id
 AND json_extract(h.undo_payload,'$.permission')=h.scope AND json_extract(h.redo_payload,'$.permission')=h.scope
 AND json_extract(h.undo_payload,'$.generation')=p.generation AND json_extract(h.redo_payload,'$.generation')=p.generation
 AND h.status=CASE p.replay_state WHEN 'applied' THEN 'undoable' WHEN 'reversed' THEN 'redoable' END
 AND EXISTS(SELECT 1 FROM transfer_operation_members m WHERE m.receipt_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM transfer_retired_receipt_keys k WHERE k.actor_id=p.actor_id AND k.request_id=p.request_id)
 AND NOT EXISTS(SELECT 1 FROM transfer_run_retired_keys k WHERE k.actor_id=p.actor_id AND k.request_id=p.request_id);
INSERT INTO transfer_execution_heads(binding_id,generation,replay_state,history_status)
 SELECT b.id,p.generation,p.replay_state,h.status FROM transfer_history_bindings b
 JOIN transfer_operation_receipts p ON p.id=b.receipt_id JOIN action_history h ON h.id=b.history_id;
INSERT INTO transfer_install_dispositions SELECT p.id,CASE WHEN p.provenance_version=0 THEN 'recorded_only_v0'
 WHEN b.id IS NULL THEN 'unverifiable_exact_bundle' WHEN b.self_actor_id IS NULL THEN 'bound_crossuser' ELSE 'bound_self' END
 FROM transfer_operation_receipts p LEFT JOIN transfer_history_bindings b ON b.receipt_id=p.id;
CREATE TRIGGER transfer_binding_no_update BEFORE UPDATE ON transfer_history_bindings
BEGIN SELECT RAISE(ABORT,'execution binding immutable'); END;
CREATE TRIGGER transfer_binding_no_delete BEFORE DELETE ON transfer_history_bindings
BEGIN SELECT RAISE(ABORT,'execution binding permanent'); END;
CREATE TRIGGER transfer_invalidation_no_update BEFORE UPDATE ON transfer_binding_invalidations
BEGIN SELECT RAISE(ABORT,'authority invalidation immutable'); END;
CREATE TRIGGER transfer_invalidation_no_delete BEFORE DELETE ON transfer_binding_invalidations
BEGIN SELECT RAISE(ABORT,'authority invalidation permanent'); END;
CREATE TRIGGER transfer_binding_member_insert AFTER INSERT ON transfer_operation_members
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'bundle','member inserted' FROM transfer_history_bindings WHERE receipt_id=NEW.receipt_id; END;
CREATE TRIGGER transfer_binding_member_delete BEFORE DELETE ON transfer_operation_members
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'bundle','member deleted' FROM transfer_history_bindings WHERE receipt_id=OLD.receipt_id; END;
CREATE TRIGGER transfer_binding_receipt_delete BEFORE DELETE ON transfer_operation_receipts
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'bundle','receipt deleted' FROM transfer_history_bindings WHERE receipt_id=OLD.id; END;
CREATE TRIGGER transfer_binding_history_delete BEFORE DELETE ON action_history
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'bundle','history deleted' FROM transfer_history_bindings WHERE history_id=OLD.id; END;
CREATE TRIGGER transfer_binding_history_identity AFTER UPDATE ON action_history
WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.entity IS NOT OLD.entity OR NEW.entity_id IS NOT OLD.entity_id
 OR NEW.created_by_id IS NOT OLD.created_by_id OR NEW.created_at IS NOT OLD.created_at
 OR json_remove(NEW.undo_payload,'$.generation') IS NOT json_remove(OLD.undo_payload,'$.generation')
 OR json_remove(NEW.redo_payload,'$.generation') IS NOT json_remove(OLD.redo_payload,'$.generation')
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'bundle','history identity changed' FROM transfer_history_bindings WHERE history_id=OLD.id; END;
CREATE TRIGGER transfer_binding_receipt_identity AFTER UPDATE ON transfer_operation_receipts
WHEN NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.request_id IS NOT OLD.request_id
 OR NEW.request_digest IS NOT OLD.request_digest OR NEW.request_json IS NOT OLD.request_json OR NEW.response_json IS NOT OLD.response_json
 OR NEW.status IS NOT OLD.status OR NEW.created_at IS NOT OLD.created_at OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.provenance_version IS NOT OLD.provenance_version OR NEW.action_history_id IS NOT OLD.action_history_id
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'bundle','receipt identity changed' FROM transfer_history_bindings WHERE receipt_id=OLD.id; END;
CREATE TRIGGER transfer_binding_principal_delete BEFORE DELETE ON users
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'self','principal deleted' FROM transfer_history_bindings WHERE self_actor_id=OLD.id; END;
CREATE TRIGGER transfer_binding_principal_update BEFORE UPDATE ON users
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
BEGIN INSERT OR IGNORE INTO transfer_binding_invalidations SELECT id,'self','principal identity changed' FROM transfer_history_bindings WHERE self_actor_id=OLD.id; END;
CREATE VIEW transfer_valid_execution_guard AS SELECT g.* FROM transfer_execution_guard g
 JOIN users u ON u.id=g.actor_id LEFT JOIN roles r ON r.id=u.role_id
 JOIN system_flags f ON f.key='business_dataset_generation'
 WHERE g.dataset_generation=json_extract(f.value,'$.generation') AND u.is_active=1 AND u.deleted_at IS NULL
 AND u.organization_id IS g.organization_id AND u.created_at=g.actor_created_at AND u.username=g.username
 AND u.role_id IS g.role_id AND r.code IS g.role_code AND u.permissions IS g.user_permissions AND r.permissions IS g.role_permissions;
CREATE VIEW transfer_valid_replay_guard AS SELECT g.*,b.receipt_id,b.history_id
 FROM transfer_valid_execution_guard g JOIN transfer_history_bindings b ON b.id=g.binding_id
 JOIN transfer_execution_heads x ON x.binding_id=b.id JOIN transfer_receipt_retirement_rows p ON p.id=b.receipt_id
 JOIN transfer_binding_history_rows h ON h.id=b.history_id
 WHERE g.kind='replay' AND b.dataset_generation=g.dataset_generation AND b.operation_id=g.operation_id AND b.scope=g.scope
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
 AND NOT EXISTS(SELECT 1 FROM transfer_binding_invalidations WHERE binding_id=b.id AND scope='bundle')
 AND (g.authority='cross' OR (b.self_actor_id=g.actor_id AND b.self_org_id IS g.organization_id AND b.self_created_at=g.actor_created_at
 AND NOT EXISTS(SELECT 1 FROM transfer_binding_invalidations WHERE binding_id=b.id AND scope='self')))
 AND b.receipt_identity=p.identity_json AND b.history_identity=h.identity_json AND h.reversible=1
 AND b.member_count=(SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id=p.id)
 AND x.revision=g.old_revision AND x.generation=g.old_generation AND x.replay_state=g.old_state AND x.history_status=g.old_status
 AND p.generation=x.generation AND p.replay_state=x.replay_state AND h.status=x.history_status
 AND json_extract(h.undo_payload,'$.generation')=x.generation AND json_extract(h.redo_payload,'$.generation')=x.generation;
CREATE TRIGGER transfer_binding_insert BEFORE INSERT ON transfer_history_bindings
WHEN NOT EXISTS(SELECT 1 FROM transfer_valid_execution_guard g WHERE g.binding_id=NEW.id AND g.operation_id=NEW.operation_id
 AND g.dataset_generation=NEW.dataset_generation AND g.kind=NEW.source AND
 ((g.kind='restored' AND NEW.self_actor_id IS NULL AND NEW.self_org_id IS NULL AND NEW.self_created_at IS NULL)
 OR (g.kind='new' AND NEW.scope=g.scope AND NEW.self_actor_id=g.actor_id AND NEW.self_org_id IS g.organization_id AND NEW.self_created_at=g.actor_created_at)))
BEGIN SELECT RAISE(ABORT,'private binding authority required'); END;
DROP TRIGGER transfer_receipt_retirement_update;
CREATE TRIGGER transfer_receipt_retirement_update BEFORE UPDATE ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=OLD.actor_id AND request_id=OLD.request_id)
 AND NOT EXISTS(SELECT 1 FROM transfer_valid_replay_guard g
 WHERE g.operation_id=OLD.operation_id AND g.receipt_id=OLD.id
 AND OLD.generation=g.old_generation AND NEW.generation=g.new_generation AND NEW.generation=OLD.generation+1
 AND OLD.replay_state=g.old_state AND NEW.replay_state=g.new_state
 AND ((OLD.replay_state='applied' AND NEW.replay_state='reversed') OR (OLD.replay_state='reversed' AND NEW.replay_state='applied'))
 AND NEW.id=OLD.id AND NEW.actor_id=OLD.actor_id AND NEW.request_id=OLD.request_id AND NEW.request_digest=OLD.request_digest
 AND NEW.request_json=OLD.request_json AND NEW.response_json IS OLD.response_json AND NEW.status=OLD.status
 AND NEW.created_at=OLD.created_at AND NEW.operation_id IS OLD.operation_id AND NEW.provenance_version=OLD.provenance_version
 AND NEW.action_history_id IS OLD.action_history_id)
BEGIN SELECT RAISE(ABORT,'retired receipt requires exact authorized history execution'); END;
CREATE TRIGGER transfer_bound_receipt_replay BEFORE UPDATE OF generation,replay_state ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM transfer_history_bindings b JOIN transfer_admission_bootstrap z
 ON b.dataset_generation=(SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation') WHERE b.receipt_id=OLD.id)
 AND NOT EXISTS(SELECT 1 FROM transfer_valid_replay_guard g WHERE g.receipt_id=OLD.id AND g.operation_id=OLD.operation_id
 AND OLD.generation=g.old_generation AND NEW.generation=g.new_generation AND OLD.replay_state=g.old_state AND NEW.replay_state=g.new_state)
BEGIN SELECT RAISE(ABORT,'bound transfer requires private replay executor'); END;
CREATE TRIGGER transfer_head_insert BEFORE INSERT ON transfer_execution_heads
WHEN NOT EXISTS(SELECT 1 FROM transfer_valid_execution_guard WHERE binding_id=NEW.binding_id AND kind IN ('new','restored'))
BEGIN SELECT RAISE(ABORT,'head creation authority required'); END;
CREATE TRIGGER transfer_head_update BEFORE UPDATE ON transfer_execution_heads
WHEN NOT EXISTS(SELECT 1 FROM transfer_valid_execution_guard g WHERE g.kind='replay' AND g.binding_id=OLD.binding_id
 AND NEW.binding_id=OLD.binding_id AND g.old_revision=OLD.revision AND NEW.revision=OLD.revision+1
 AND g.old_generation=OLD.generation AND g.new_generation=NEW.generation AND g.old_state=OLD.replay_state
 AND g.new_state=NEW.replay_state AND g.old_status=OLD.history_status AND g.new_status=NEW.history_status)
BEGIN SELECT RAISE(ABORT,'head update requires exact replay CAS'); END;
CREATE TRIGGER transfer_head_delete BEFORE DELETE ON transfer_execution_heads
BEGIN SELECT RAISE(ABORT,'execution heads retained'); END;
CREATE TRIGGER transfer_owner_insert BEFORE INSERT ON transfer_owner_admissions
WHEN NOT EXISTS(SELECT 1 FROM transfer_valid_execution_guard g JOIN transfer_history_bindings b ON b.id=g.binding_id
 JOIN transfer_operation_receipts p ON p.id=b.receipt_id WHERE g.kind='new' AND NEW.binding_id=b.id AND NEW.actor_id=g.actor_id
 AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'new receipt owner authority required'); END;
CREATE TRIGGER transfer_owner_update BEFORE UPDATE ON transfer_owner_admissions
BEGIN SELECT RAISE(ABORT,'receipt owner admission immutable'); END;
CREATE TRIGGER transfer_owner_delete BEFORE DELETE ON transfer_owner_admissions
BEGIN SELECT RAISE(ABORT,'receipt owner admission retained'); END;
CREATE TRIGGER transfer_bootstrap_update BEFORE UPDATE ON transfer_admission_bootstrap
BEGIN SELECT RAISE(ABORT,'installation baseline immutable'); END;
CREATE TRIGGER transfer_bootstrap_delete BEFORE DELETE ON transfer_admission_bootstrap
BEGIN SELECT RAISE(ABORT,'installation baseline retained'); END;
CREATE TRIGGER transfer_disposition_update BEFORE UPDATE ON transfer_install_dispositions
BEGIN SELECT RAISE(ABORT,'installation disposition immutable'); END;
CREATE TRIGGER transfer_disposition_delete BEFORE DELETE ON transfer_install_dispositions
BEGIN SELECT RAISE(ABORT,'installation disposition retained'); END;
