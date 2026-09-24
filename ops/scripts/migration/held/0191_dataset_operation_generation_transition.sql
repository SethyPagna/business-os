-- Additive control-state extension; 0190 remains immutable. No business changes.
-- PRE: 0185/0186/0188/0190 applied. POST: no transitions, business totals unchanged.
-- Preserve with the journal during reset/restore and code rollback. Never backfill.
CREATE TABLE dataset_operation_generation_transitions (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES dataset_operations(id),
 sequence INTEGER NOT NULL,
 epoch TEXT NOT NULL,
 generation_before TEXT NOT NULL,
 generation_after TEXT NOT NULL UNIQUE,
 FOREIGN KEY(operation_id,sequence) REFERENCES dataset_operation_chunks(operation_id,sequence),
 CHECK(generation_before<>generation_after)
);
-- Completion means all live evidence is archived BEFORE any business deletion.
-- The coordinator must archive -> rotate -> delete, not delete while archiving.
CREATE VIEW dataset_operation_retirement_complete AS SELECT
 NOT EXISTS(SELECT 1 FROM transfer_runs)
 AND NOT EXISTS(SELECT 1 FROM transfer_run_chunks)
 AND NOT EXISTS(SELECT 1 FROM transfer_operation_members m LEFT JOIN transfer_operation_receipts p ON p.id=m.receipt_id WHERE p.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows p WHERE NOT EXISTS(
   SELECT 1 FROM transfer_retired_receipt_keys k WHERE k.actor_id=p.actor_id AND k.request_id=p.request_id
   AND k.identity_json=p.identity_json
   AND k.member_count=(SELECT COUNT(*) FROM transfer_operation_members m WHERE m.receipt_id=p.id)
   AND k.member_count=(SELECT COUNT(*) FROM transfer_retired_receipt_members m WHERE m.actor_id=p.actor_id AND m.request_id=p.request_id)))
 AND NOT EXISTS(SELECT 1 FROM transfer_receipt_retirement_rows p WHERE NOT EXISTS(
   SELECT 1 FROM transfer_retired_receipt_snapshots s WHERE s.actor_id=p.actor_id AND s.request_id=p.request_id AND s.snapshot_json=p.snapshot_json))
 AND NOT EXISTS(SELECT 1 FROM transfer_receipt_member_retirement_rows m WHERE NOT EXISTS(
   SELECT 1 FROM transfer_retired_receipt_members s WHERE s.actor_id=m.actor_id AND s.request_id=m.request_id AND s.ordinal=m.ordinal AND s.snapshot_json=m.snapshot_json)) AS complete;
CREATE TRIGGER dataset_transition_admission BEFORE INSERT ON dataset_operation_generation_transitions
WHEN EXISTS(SELECT 1 FROM dataset_operation_generation_transitions WHERE operation_id=NEW.operation_id OR generation_after=NEW.generation_after)
 OR NOT EXISTS(SELECT 1 FROM dataset_operation_fence f JOIN dataset_operations o ON o.id=f.operation_id
 JOIN dataset_operation_chunks c ON c.operation_id=o.id AND c.sequence=f.sequence
 JOIN system_flags g ON g.key='business_dataset_generation'
 WHERE f.id=1 AND f.operation_id=NEW.operation_id AND f.epoch=NEW.epoch AND f.sequence=NEW.sequence
 AND o.epoch=NEW.epoch AND o.status='active' AND o.revision=NEW.sequence
 AND o.dataset_generation=NEW.generation_before AND json_extract(g.value,'$.generation')=NEW.generation_before
 AND c.phase_before=o.phase AND c.cursor_before=o.cursor_json AND c.final=0
 AND json_extract(c.response_json,'$.generation')=NEW.generation_after
 AND (SELECT complete FROM dataset_operation_retirement_complete)=1)
BEGIN SELECT RAISE(ABORT,'dataset transition requires exact atomic retirement completion'); END;
CREATE TRIGGER dataset_transition_no_update BEFORE UPDATE ON dataset_operation_generation_transitions
BEGIN SELECT RAISE(ABORT,'dataset transition is immutable'); END;
CREATE TRIGGER dataset_transition_no_delete BEFORE DELETE ON dataset_operation_generation_transitions
BEGIN SELECT RAISE(ABORT,'dataset transition is permanent'); END;
