-- Local unwired lifecycle kernel. Preserve 0185/0186. No money rewrite.
-- These permanent tables must be UNIONED from backups, NEVER cleared by reset.
-- Legacy receipts have no trustworthy organization field: do not infer one.
CREATE TABLE transfer_retired_receipt_keys (
 actor_id INTEGER NOT NULL, request_id TEXT NOT NULL,
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json)),
 operation_id TEXT, member_count INTEGER NOT NULL CHECK(member_count>=0),
 PRIMARY KEY(actor_id,request_id)
);
CREATE UNIQUE INDEX transfer_retired_receipt_operation ON transfer_retired_receipt_keys(operation_id) WHERE operation_id IS NOT NULL;
CREATE TABLE transfer_retired_receipt_snapshots (
 actor_id INTEGER NOT NULL, request_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(actor_id,request_id,snapshot_json),
 FOREIGN KEY(actor_id,request_id) REFERENCES transfer_retired_receipt_keys(actor_id,request_id)
);
CREATE TABLE transfer_retired_receipt_members (
 actor_id INTEGER NOT NULL, request_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(actor_id,request_id,ordinal),
 FOREIGN KEY(actor_id,request_id) REFERENCES transfer_retired_receipt_keys(actor_id,request_id)
);
CREATE TABLE transfer_receipt_lifecycle_guard (
 id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL,
 generation TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('retire','union','restore')),
 source_id TEXT, source_digest TEXT
);
CREATE TABLE transfer_receipt_restore_allowance (
 actor_id INTEGER NOT NULL, request_id TEXT NOT NULL, token TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(actor_id,request_id)
);
CREATE VIEW transfer_receipt_retirement_rows AS SELECT p.*,
 json_object('id',id,'actor_id',actor_id,'request_id',request_id,'request_digest',request_digest,'request_json',request_json,
 'response_json',response_json,'status',status,'created_at',created_at,'operation_id',operation_id,
 'provenance_version',provenance_version,'action_history_id',action_history_id) AS identity_json,
 json_object('id',id,'actor_id',actor_id,'request_id',request_id,'request_digest',request_digest,'request_json',request_json,
 'response_json',response_json,'status',status,'created_at',created_at,'updated_at',updated_at,'operation_id',operation_id,
 'provenance_version',provenance_version,'action_history_id',action_history_id,'replay_state',replay_state,'generation',generation) AS snapshot_json
 FROM transfer_operation_receipts p;
CREATE VIEW transfer_receipt_member_retirement_rows AS SELECT m.*,p.actor_id,p.request_id,
 json_object('receipt_id',m.receipt_id,'ordinal',ordinal,'source_product_id',source_product_id,'destination_product_id',destination_product_id,
 'source_branch_id',source_branch_id,'destination_branch_id',destination_branch_id,'quantity',quantity,'untracked_quantity',untracked_quantity,
 'source_snapshot',source_snapshot,'destination_snapshot',destination_snapshot,'allocations_json',allocations_json) AS snapshot_json
 FROM transfer_operation_members m JOIN transfer_operation_receipts p ON p.id=m.receipt_id;
CREATE TRIGGER transfer_retired_receipt_keys_insert BEFORE INSERT ON transfer_retired_receipt_keys
WHEN NOT EXISTS(SELECT 1 FROM transfer_receipt_lifecycle_guard g JOIN system_flags f ON f.key='business_dataset_generation'
 WHERE g.id=1 AND g.generation=json_extract(f.value,'$.generation'))
BEGIN SELECT RAISE(ABORT,'receipt retirement authority required'); END;
CREATE TRIGGER transfer_retired_receipt_cross_key BEFORE INSERT ON transfer_retired_receipt_keys
WHEN EXISTS(SELECT 1 FROM transfer_runs WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM transfer_run_retired_keys k WHERE k.actor_id=NEW.actor_id AND k.request_id=NEW.request_id
 AND (k.sequence IS NULL OR EXISTS(SELECT 1 FROM json_each(NEW.identity_json) j
   WHERE json_extract(k.snapshot_json,'$.receipt.'||j.key) IS NOT j.value)))
BEGIN SELECT RAISE(ABORT,'receipt identity conflicts with run reservation'); END;
CREATE TRIGGER transfer_retired_run_cross_receipt BEFORE INSERT ON transfer_run_retired_keys
WHEN EXISTS(SELECT 1 FROM transfer_retired_receipt_keys k WHERE k.actor_id=NEW.actor_id AND k.request_id=NEW.request_id
 AND (NEW.sequence IS NULL OR EXISTS(SELECT 1 FROM json_each(k.identity_json) j
   WHERE json_extract(NEW.snapshot_json,'$.receipt.'||j.key) IS NOT j.value)))
BEGIN SELECT RAISE(ABORT,'run reservation conflicts with retired receipt'); END;
CREATE TRIGGER transfer_retired_receipt_keys_update BEFORE UPDATE ON transfer_retired_receipt_keys
BEGIN SELECT RAISE(ABORT,'receipt retirement identity immutable'); END;
CREATE TRIGGER transfer_retired_receipt_keys_delete BEFORE DELETE ON transfer_retired_receipt_keys
BEGIN SELECT RAISE(ABORT,'receipt retirement identity permanent'); END;
CREATE TRIGGER transfer_retired_receipt_snapshots_insert BEFORE INSERT ON transfer_retired_receipt_snapshots
WHEN NOT EXISTS(SELECT 1 FROM transfer_receipt_lifecycle_guard WHERE id=1)
BEGIN SELECT RAISE(ABORT,'receipt evidence authority required'); END;
CREATE TRIGGER transfer_retired_receipt_snapshots_update BEFORE UPDATE ON transfer_retired_receipt_snapshots
BEGIN SELECT RAISE(ABORT,'receipt evidence immutable'); END;
CREATE TRIGGER transfer_retired_receipt_snapshots_delete BEFORE DELETE ON transfer_retired_receipt_snapshots
BEGIN SELECT RAISE(ABORT,'receipt evidence permanent'); END;
CREATE TRIGGER transfer_retired_receipt_members_insert BEFORE INSERT ON transfer_retired_receipt_members
WHEN NOT EXISTS(SELECT 1 FROM transfer_receipt_lifecycle_guard WHERE id=1)
BEGIN SELECT RAISE(ABORT,'receipt member retirement authority required'); END;
CREATE TRIGGER transfer_retired_receipt_members_update BEFORE UPDATE ON transfer_retired_receipt_members
BEGIN SELECT RAISE(ABORT,'receipt member evidence immutable'); END;
CREATE TRIGGER transfer_retired_receipt_members_delete BEFORE DELETE ON transfer_retired_receipt_members
BEGIN SELECT RAISE(ABORT,'receipt member evidence permanent'); END;
CREATE TRIGGER transfer_receipt_retirement_delete BEFORE DELETE ON transfer_operation_receipts
WHEN NOT EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows p JOIN transfer_retired_receipt_snapshots s
 ON s.actor_id=p.actor_id AND s.request_id=p.request_id AND s.snapshot_json=p.snapshot_json WHERE p.id=OLD.id)
BEGIN SELECT RAISE(ABORT,'exact receipt retirement required before delete'); END;
CREATE TRIGGER transfer_receipt_member_retirement_delete BEFORE DELETE ON transfer_operation_members
WHEN NOT EXISTS(SELECT 1 FROM transfer_receipt_member_retirement_rows p JOIN transfer_retired_receipt_members s
 ON s.actor_id=p.actor_id AND s.request_id=p.request_id AND s.ordinal=p.ordinal AND s.snapshot_json=p.snapshot_json
 WHERE p.receipt_id=OLD.receipt_id AND p.ordinal=OLD.ordinal)
BEGIN SELECT RAISE(ABORT,'exact member retirement required before delete'); END;
CREATE TRIGGER transfer_receipt_retirement_update BEFORE UPDATE ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=OLD.actor_id AND request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT,'retired receipt cannot replay'); END;
CREATE TRIGGER transfer_receipt_retirement_member_insert BEFORE INSERT ON transfer_operation_members
WHEN EXISTS(SELECT 1 FROM transfer_operation_receipts p JOIN transfer_retired_receipt_keys k
 ON k.actor_id=p.actor_id AND k.request_id=p.request_id WHERE p.id=NEW.receipt_id)
 AND NOT EXISTS(SELECT 1 FROM transfer_operation_receipts p JOIN transfer_receipt_restore_allowance a
 ON a.actor_id=p.actor_id AND a.request_id=p.request_id JOIN transfer_receipt_lifecycle_guard g ON g.token=a.token
 JOIN transfer_retired_receipt_members m ON m.actor_id=p.actor_id AND m.request_id=p.request_id AND m.ordinal=NEW.ordinal
 WHERE p.id=NEW.receipt_id AND g.kind='restore' AND m.snapshot_json=json_object(
 'receipt_id',NEW.receipt_id,'ordinal',NEW.ordinal,'source_product_id',NEW.source_product_id,'destination_product_id',NEW.destination_product_id,
 'source_branch_id',NEW.source_branch_id,'destination_branch_id',NEW.destination_branch_id,'quantity',NEW.quantity,'untracked_quantity',NEW.untracked_quantity,
 'source_snapshot',NEW.source_snapshot,'destination_snapshot',NEW.destination_snapshot,'allocations_json',NEW.allocations_json))
BEGIN SELECT RAISE(ABORT,'retired receipt member requires exact restore allowance'); END;
CREATE TRIGGER transfer_runs_retired_receipt_insert BEFORE INSERT ON transfer_runs
WHEN EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'receipt key permanently retired'); END;
CREATE TRIGGER transfer_chunks_retired_receipt_insert BEFORE INSERT ON transfer_run_chunks
WHEN EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'receipt key permanently retired'); END;
DROP TRIGGER transfer_receipt_retired_insert;
CREATE TRIGGER transfer_receipt_retired_insert BEFORE INSERT ON transfer_operation_receipts
WHEN (EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM transfer_retired_receipt_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id))
 AND NOT EXISTS(SELECT 1 FROM transfer_receipt_restore_allowance a JOIN transfer_receipt_lifecycle_guard g ON g.token=a.token
 JOIN system_flags f ON f.key='maintenance' JOIN system_flags d ON d.key='business_dataset_generation'
 WHERE g.id=1 AND g.kind='restore' AND g.generation=json_extract(d.value,'$.generation')
 AND json_extract(f.value,'$.mode')='restore' AND json_extract(f.value,'$.token')=g.token
 AND json_extract(f.value,'$.backupKey')=g.source_id
 AND a.actor_id=NEW.actor_id AND a.request_id=NEW.request_id
 AND a.snapshot_json=json_object('id',NEW.id,'actor_id',NEW.actor_id,'request_id',NEW.request_id,'request_digest',NEW.request_digest,'request_json',NEW.request_json,
 'response_json',NEW.response_json,'status',NEW.status,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'operation_id',NEW.operation_id,
 'provenance_version',NEW.provenance_version,'action_history_id',NEW.action_history_id,'replay_state',NEW.replay_state,'generation',NEW.generation))
BEGIN SELECT RAISE(ABORT,'receipt retry identity permanently retired'); END;
