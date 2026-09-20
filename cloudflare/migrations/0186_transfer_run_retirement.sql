-- Local lifecycle proposal. 0185 remains unchanged. No monetary/history rewrite.
-- Pre-generation runs receive '' and are frozen, not silently adopted. Retire
-- them through the authorized lifecycle API before any restore/reset deletes.
-- system_flags is intentionally excluded from backup/reset manifests. This
-- generation must never be restored from a backup or deleted during reset.
INSERT INTO system_flags(key,value) VALUES('business_dataset_generation',json_object('generation',
  lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))))
ON CONFLICT(key) DO NOTHING;
ALTER TABLE transfer_runs ADD COLUMN dataset_generation TEXT NOT NULL DEFAULT '';
CREATE TABLE transfer_run_retired_keys (
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  organization_id INTEGER,
  run_id TEXT NOT NULL,
  sequence INTEGER,
  dataset_generation TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  retired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(actor_id,request_id)
);
-- Private transaction marker, never an HTTP/settings API. The execution API
-- owns its complete batch, as with 0185's executing marker; not arbitrary-SQL proof.
CREATE TABLE transfer_run_lifecycle_guard (
  id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('restore','reset','union')),
  generation_before TEXT NOT NULL, generation_after TEXT NOT NULL
);
CREATE TRIGGER transfer_generation_no_delete BEFORE DELETE ON system_flags
WHEN OLD.key='business_dataset_generation'
BEGIN SELECT RAISE(ABORT,'dataset generation cannot be deleted'); END;
CREATE TRIGGER transfer_generation_no_replace BEFORE INSERT ON system_flags
WHEN NEW.key='business_dataset_generation'
BEGIN SELECT RAISE(ABORT,'dataset generation already initialized'); END;
CREATE TRIGGER transfer_generation_update BEFORE UPDATE ON system_flags
WHEN (OLD.key='business_dataset_generation' OR NEW.key='business_dataset_generation') AND (
 NEW.key IS NOT OLD.key OR NOT json_valid(NEW.value)
 OR NOT EXISTS(SELECT 1 FROM transfer_run_lifecycle_guard g WHERE g.id=1 AND g.kind IN ('restore','reset')
   AND g.generation_before=json_extract(OLD.value,'$.generation') AND g.generation_after=json_extract(NEW.value,'$.generation')
   AND g.generation_before<>g.generation_after)
 OR EXISTS(SELECT 1 FROM transfer_runs) OR EXISTS(SELECT 1 FROM transfer_run_chunks))
BEGIN SELECT RAISE(ABORT,'dataset generation requires completed transfer retirement'); END;
CREATE TRIGGER transfer_retired_keys_insert BEFORE INSERT ON transfer_run_retired_keys
WHEN NOT EXISTS(SELECT 1 FROM transfer_run_lifecycle_guard g JOIN system_flags f ON f.key='business_dataset_generation'
  WHERE g.id=1 AND g.generation_before=json_extract(f.value,'$.generation'))
BEGIN SELECT RAISE(ABORT,'transfer retirement authority required'); END;
CREATE TRIGGER transfer_retired_keys_update BEFORE UPDATE ON transfer_run_retired_keys
BEGIN SELECT RAISE(ABORT,'retired transfer identities are immutable'); END;
CREATE TRIGGER transfer_retired_keys_delete BEFORE DELETE ON transfer_run_retired_keys
BEGIN SELECT RAISE(ABORT,'retired transfer identities are permanent'); END;
CREATE TRIGGER transfer_runs_generation_insert BEFORE INSERT ON transfer_runs
WHEN NEW.dataset_generation IS NOT (SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')
 OR EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'transfer generation stale or request retired'); END;
CREATE TRIGGER transfer_runs_generation_update BEFORE UPDATE ON transfer_runs
WHEN NEW.dataset_generation IS NOT OLD.dataset_generation
 OR OLD.dataset_generation IS NOT (SELECT json_extract(value,'$.generation') FROM system_flags WHERE key='business_dataset_generation')
BEGIN SELECT RAISE(ABORT,'transfer generation is immutable or stale'); END;
CREATE TRIGGER transfer_chunks_retired_insert BEFORE INSERT ON transfer_run_chunks
WHEN EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
 OR NOT EXISTS(SELECT 1 FROM transfer_runs r JOIN system_flags f ON f.key='business_dataset_generation'
   WHERE r.id=NEW.run_id AND r.dataset_generation=json_extract(f.value,'$.generation'))
BEGIN SELECT RAISE(ABORT,'transfer child generation stale or request retired'); END;
CREATE TRIGGER transfer_receipt_retired_insert BEFORE INSERT ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM transfer_run_retired_keys WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'transfer retry identity permanently retired'); END;
DROP TRIGGER transfer_run_chunks_no_delete;
CREATE TRIGGER transfer_run_chunks_no_delete BEFORE DELETE ON transfer_run_chunks
WHEN NOT EXISTS(SELECT 1 FROM transfer_run_lifecycle_guard g JOIN transfer_run_retired_keys k
 ON k.actor_id=OLD.actor_id AND k.request_id=OLD.request_id
 WHERE g.id=1 AND g.kind IN ('restore','reset') AND k.run_id=OLD.run_id AND k.sequence=OLD.sequence
 AND k.request_digest=OLD.request_digest AND k.request_json=OLD.request_json
 AND json_extract(k.snapshot_json,'$.status')=OLD.status
 AND json_extract(k.snapshot_json,'$.receipt_id') IS OLD.receipt_id
 AND json_extract(k.snapshot_json,'$.is_final')=OLD.is_final
 AND k.organization_id IS (SELECT organization_id FROM transfer_runs WHERE id=OLD.run_id)
 AND k.dataset_generation=(SELECT dataset_generation FROM transfer_runs WHERE id=OLD.run_id)
 AND json_extract(k.snapshot_json,'$.cursor_before')=OLD.cursor_before
 AND json_extract(k.snapshot_json,'$.cursor_after')=OLD.cursor_after)
BEGIN SELECT RAISE(ABORT,'transfer child requires exact retirement snapshot'); END;
DROP TRIGGER transfer_runs_no_delete;
CREATE TRIGGER transfer_runs_no_delete BEFORE DELETE ON transfer_runs
WHEN NOT EXISTS(SELECT 1 FROM transfer_run_lifecycle_guard g JOIN transfer_run_retired_keys k
 ON k.actor_id=OLD.actor_id AND k.request_id=OLD.request_id
 WHERE g.id=1 AND g.kind IN ('restore','reset') AND k.run_id=OLD.id AND k.sequence IS NULL
 AND k.organization_id IS OLD.organization_id AND k.dataset_generation=OLD.dataset_generation
 AND k.request_digest=OLD.request_digest AND k.request_json=OLD.request_json
 AND json_extract(k.snapshot_json,'$.status')=OLD.status
 AND json_extract(k.snapshot_json,'$.revision')=OLD.revision
 AND json_extract(k.snapshot_json,'$.next_sequence')=OLD.next_sequence
 AND json_extract(k.snapshot_json,'$.scope')=OLD.scope
 AND json_extract(k.snapshot_json,'$.created_at')=OLD.created_at
 AND json_extract(k.snapshot_json,'$.updated_at')=OLD.updated_at
 AND json_extract(k.snapshot_json,'$.cursor_json')=OLD.cursor_json)
BEGIN SELECT RAISE(ABORT,'transfer run requires exact retirement snapshot'); END;
