-- LOCAL PROPOSAL ONLY. Remote application needs separate owner authorization.
-- PRE: record transfer receipt/member/history and stock counts/sums.
-- POST: all existing rows identical; only empty run tables/guards added.
-- DEPLOYMENT BLOCKER: backup/restore/reset must include these reservations and
-- child links before enabling routes. Never delete a reservation to retry.
-- RECOVERY: retain tables/guards on code rollback; no historical backfill.
CREATE TABLE transfer_runs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id INTEGER NOT NULL CHECK(actor_id>0),
  organization_id INTEGER,
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 8 AND 120 AND request_id=trim(request_id)),
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=131072),
  scope TEXT NOT NULL CHECK(scope IN ('branches','inventory')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','abandoned','completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  next_sequence INTEGER NOT NULL DEFAULT 0 CHECK(next_sequence>=0),
  cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cursor_json) AND length(cursor_json)<=4096),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id,request_id)
);
CREATE TABLE transfer_run_chunks (
  run_id TEXT NOT NULL REFERENCES transfer_runs(id),
  sequence INTEGER NOT NULL CHECK(sequence>=0),
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 8 AND 120 AND request_id=trim(request_id)),
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=65536),
  cursor_before TEXT NOT NULL CHECK(json_valid(cursor_before) AND length(cursor_before)<=4096),
  cursor_after TEXT NOT NULL CHECK(json_valid(cursor_after) AND length(cursor_after)<=4096),
  is_final INTEGER NOT NULL CHECK(is_final IN (0,1)),
  -- executing is an internal transaction marker: wrapper acquires it, writes
  -- effects, links receipt and advances run in ONE batch. Never persist alone.
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','executing','committed')),
  receipt_id INTEGER REFERENCES transfer_operation_receipts(id),
  PRIMARY KEY(run_id,sequence),
  UNIQUE(actor_id,request_id),
  UNIQUE(receipt_id),
  CHECK((status IN ('planned','executing') AND receipt_id IS NULL) OR (status='committed' AND receipt_id IS NOT NULL))
);
CREATE TRIGGER transfer_runs_reserve_insert BEFORE INSERT ON transfer_runs
WHEN NEW.status<>'active' OR NEW.revision<>0 OR NEW.next_sequence<>0 OR NEW.cursor_json<>'{}'
 OR EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM transfer_run_chunks WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'transfer run request already reserved or invalid initial state'); END;
-- Opposite half of the race: even an old Worker already planning an original
-- transfer cannot insert its receipt after a run reserves that actor/key.
CREATE TRIGGER transfer_runs_block_original_receipt BEFORE INSERT ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM transfer_runs WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'transfer original request is reserved by a run'); END;
CREATE TRIGGER transfer_run_chunks_insert_guard BEFORE INSERT ON transfer_run_chunks
WHEN NEW.status<>'planned' OR NEW.receipt_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM transfer_runs r WHERE r.id=NEW.run_id AND r.actor_id=NEW.actor_id
   AND r.status='active' AND r.next_sequence=NEW.sequence AND r.cursor_json=NEW.cursor_before)
 OR EXISTS(SELECT 1 FROM transfer_runs WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'invalid or reserved transfer child'); END;
CREATE TRIGGER transfer_run_child_receipt_guard BEFORE INSERT ON transfer_operation_receipts
WHEN EXISTS(SELECT 1 FROM transfer_run_chunks WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id)
 AND NOT EXISTS(SELECT 1 FROM transfer_run_chunks c JOIN transfer_runs r ON r.id=c.run_id
   WHERE c.actor_id=NEW.actor_id AND c.request_id=NEW.request_id AND c.request_digest=NEW.request_digest
   AND c.request_json=NEW.request_json AND c.status='executing' AND r.status='active'
   AND r.next_sequence=c.sequence AND r.cursor_json=c.cursor_before)
BEGIN SELECT RAISE(ABORT,'transfer child receipt does not match active intent'); END;
CREATE TRIGGER transfer_run_chunks_update_guard BEFORE UPDATE ON transfer_run_chunks
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.sequence IS NOT OLD.sequence OR NEW.actor_id IS NOT OLD.actor_id
 OR NEW.request_id IS NOT OLD.request_id OR NEW.request_digest IS NOT OLD.request_digest OR NEW.request_json IS NOT OLD.request_json
 OR NEW.cursor_before IS NOT OLD.cursor_before OR NEW.cursor_after IS NOT OLD.cursor_after OR NEW.is_final IS NOT OLD.is_final
 OR NOT (
   (OLD.status='planned' AND NEW.status='executing' AND NEW.receipt_id IS NULL
     AND EXISTS(SELECT 1 FROM transfer_runs r WHERE r.id=NEW.run_id AND r.status='active'
       AND r.next_sequence=NEW.sequence AND r.cursor_json=NEW.cursor_before)
     AND NOT EXISTS(SELECT 1 FROM transfer_operation_receipts p WHERE p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id))
   OR (OLD.status='executing' AND NEW.status='committed'
     AND EXISTS(SELECT 1 FROM transfer_operation_receipts p JOIN transfer_runs r ON r.id=NEW.run_id
   WHERE p.id=NEW.receipt_id AND p.actor_id=NEW.actor_id AND p.request_id=NEW.request_id
   AND p.request_digest=NEW.request_digest AND p.request_json=NEW.request_json AND p.status='committed'
   AND p.provenance_version=1 AND p.action_history_id IS NOT NULL AND p.response_json IS NOT NULL
   AND r.status='active' AND r.next_sequence=NEW.sequence AND r.cursor_json=NEW.cursor_before))
 )
BEGIN SELECT RAISE(ABORT,'transfer child is immutable or lacks committed receipt'); END;
CREATE TRIGGER transfer_runs_update_guard BEFORE UPDATE ON transfer_runs
WHEN NEW.id IS NOT OLD.id OR NEW.actor_id IS NOT OLD.actor_id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.request_id IS NOT OLD.request_id OR NEW.request_digest IS NOT OLD.request_digest OR NEW.request_json IS NOT OLD.request_json
 OR NEW.scope IS NOT OLD.scope OR NEW.created_at IS NOT OLD.created_at OR NEW.revision<>OLD.revision+1
 OR NOT (
   (NEW.next_sequence=OLD.next_sequence AND NEW.cursor_json=OLD.cursor_json
     AND ((OLD.status='active' AND NEW.status IN ('paused','abandoned'))
       OR (OLD.status='paused' AND NEW.status IN ('active','abandoned'))))
   OR (OLD.status='active' AND NEW.next_sequence=OLD.next_sequence+1
     AND EXISTS(SELECT 1 FROM transfer_run_chunks c WHERE c.run_id=OLD.id AND c.sequence=OLD.next_sequence
       AND c.status='committed' AND c.cursor_before=OLD.cursor_json AND c.cursor_after=NEW.cursor_json
       AND NEW.status=CASE WHEN c.is_final=1 THEN 'completed' ELSE 'active' END))
 )
BEGIN SELECT RAISE(ABORT,'invalid transfer run transition'); END;
CREATE TRIGGER transfer_runs_no_delete BEFORE DELETE ON transfer_runs
BEGIN SELECT RAISE(ABORT,'transfer run reservations must be retained'); END;
CREATE TRIGGER transfer_run_chunks_no_delete BEFORE DELETE ON transfer_run_chunks
BEGIN SELECT RAISE(ABORT,'transfer run chunks must be retained'); END;
