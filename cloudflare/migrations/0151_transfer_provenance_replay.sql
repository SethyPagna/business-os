-- PRE: record counts/sums of stock_transfers, branch_stock and branch_batch_stock.
-- POST: the same counts/sums; legacy receipts have provenance_version=0 and
-- no new members. Existing transfer keys retain legacy uniqueness.
-- RECOVERY: retain this migration and its immutable provenance on code rollback.
-- Never infer allocations for legacy rows. Restore/reset deletes children first
-- under the existing maintenance/reset guard; backups restore parents first.
ALTER TABLE transfer_operation_receipts ADD COLUMN operation_id TEXT;
ALTER TABLE transfer_operation_receipts ADD COLUMN provenance_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transfer_operation_receipts ADD COLUMN action_history_id INTEGER;
ALTER TABLE transfer_operation_receipts ADD COLUMN replay_state TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE transfer_operation_receipts ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_transfer_operation_id ON transfer_operation_receipts(operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE transfer_operation_members (
  receipt_id INTEGER NOT NULL REFERENCES transfer_operation_receipts(id),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  source_product_id INTEGER NOT NULL,
  destination_product_id INTEGER NOT NULL,
  source_branch_id INTEGER NOT NULL,
  destination_branch_id INTEGER NOT NULL,
  quantity REAL NOT NULL CHECK(quantity>0),
  untracked_quantity REAL NOT NULL CHECK(untracked_quantity>=0 AND untracked_quantity<=quantity),
  source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
  destination_snapshot TEXT NOT NULL CHECK(json_valid(destination_snapshot)),
  allocations_json TEXT NOT NULL CHECK(json_valid(allocations_json) AND json_type(allocations_json)='array'),
  PRIMARY KEY(receipt_id,ordinal)
);
CREATE INDEX idx_transfer_member_source ON transfer_operation_members(source_product_id);
CREATE INDEX idx_transfer_member_destination ON transfer_operation_members(destination_product_id);
CREATE TRIGGER transfer_members_sealed_insert BEFORE INSERT ON transfer_operation_members
WHEN EXISTS(SELECT 1 FROM transfer_operation_receipts WHERE id=NEW.receipt_id AND status='committed')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN SELECT RAISE(ABORT,'committed transfer provenance is sealed'); END;
-- History snapshots outlive a products-only reset; this link is deliberately
-- not a cascading FK. Receipt IDs are AUTOINCREMENT and never reused by reset.
ALTER TABLE stock_transfers ADD COLUMN receipt_id INTEGER;
ALTER TABLE stock_transfers ADD COLUMN member_ordinal INTEGER;
ALTER TABLE stock_transfers ADD COLUMN generation INTEGER;
DROP INDEX idx_stock_transfers_client_request_unique;
CREATE UNIQUE INDEX idx_stock_transfers_client_request_unique ON stock_transfers(client_request_id)
  WHERE receipt_id IS NULL AND client_request_id IS NOT NULL AND client_request_id<>'';
CREATE UNIQUE INDEX idx_stock_transfers_operation_member_generation ON stock_transfers(receipt_id,member_ordinal,generation)
  WHERE receipt_id IS NOT NULL;

CREATE TRIGGER transfer_members_immutable_update BEFORE UPDATE ON transfer_operation_members
BEGIN SELECT RAISE(ABORT,'transfer provenance is immutable'); END;
CREATE TRIGGER transfer_members_immutable_delete BEFORE DELETE ON transfer_operation_members
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='sale_record_events_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0)
BEGIN SELECT RAISE(ABORT,'transfer provenance is immutable: reset or restore required'); END;
CREATE TRIGGER transfer_receipts_identity_update BEFORE UPDATE ON transfer_operation_receipts
WHEN OLD.status='committed' AND (NEW.actor_id IS NOT OLD.actor_id OR NEW.request_id IS NOT OLD.request_id
 OR NEW.request_digest IS NOT OLD.request_digest OR NEW.request_json IS NOT OLD.request_json
 OR NEW.response_json IS NOT OLD.response_json OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.provenance_version IS NOT OLD.provenance_version OR NEW.action_history_id IS NOT OLD.action_history_id
 OR NEW.status IS NOT OLD.status)
BEGIN SELECT RAISE(ABORT,'transfer receipt identity is immutable'); END;
CREATE TRIGGER transfer_receipts_generation_update BEFORE UPDATE OF generation,replay_state ON transfer_operation_receipts
WHEN OLD.status='committed' AND (NEW.generation<>OLD.generation+1
 OR NOT ((OLD.replay_state='applied' AND NEW.replay_state='reversed') OR (OLD.replay_state='reversed' AND NEW.replay_state='applied')))
BEGIN SELECT RAISE(ABORT,'transfer replay generation conflict'); END;
CREATE TRIGGER transfer_receipts_immutable_delete BEFORE DELETE ON transfer_operation_receipts
WHEN NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='sale_record_events_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0)
BEGIN SELECT RAISE(ABORT,'transfer receipts are immutable: reset or restore required'); END;
-- Product and lot identities cannot be removed/reparented while replay evidence exists.
CREATE TRIGGER transfer_product_delete BEFORE DELETE ON products
WHEN EXISTS(SELECT 1 FROM transfer_operation_members WHERE source_product_id=OLD.id OR destination_product_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'product has immutable transfer provenance'); END;
CREATE TRIGGER transfer_product_identity_update BEFORE UPDATE OF id,is_active ON products
WHEN (NEW.id IS NOT OLD.id OR NEW.is_active IS NOT OLD.is_active)
 AND EXISTS(SELECT 1 FROM transfer_operation_members WHERE source_product_id=OLD.id OR destination_product_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'product has immutable transfer provenance'); END;
CREATE TRIGGER transfer_batch_identity_update BEFORE UPDATE OF id,variant_product_id ON product_batches
WHEN (NEW.id IS NOT OLD.id OR NEW.variant_product_id IS NOT OLD.variant_product_id)
 AND EXISTS(SELECT 1 FROM transfer_operation_members m,json_each(m.allocations_json) a
   WHERE json_extract(a.value,'$.source_batch_id')=OLD.id OR json_extract(a.value,'$.destination_batch_id')=OLD.id)
BEGIN SELECT RAISE(ABORT,'lot has immutable transfer provenance'); END;
CREATE TRIGGER transfer_batch_delete BEFORE DELETE ON product_batches
WHEN EXISTS(SELECT 1 FROM transfer_operation_members m,json_each(m.allocations_json) a
   WHERE json_extract(a.value,'$.source_batch_id')=OLD.id OR json_extract(a.value,'$.destination_batch_id')=OLD.id)
BEGIN SELECT RAISE(ABORT,'lot has immutable transfer provenance'); END;

-- Old client closure transfers are recorded-only after reload; never manufacture
-- a FIFO reversal from a history row which has no authoritative allocation map.
UPDATE action_history SET reversible=0,status='recorded'
WHERE entity IN ('stock_transfer','stock_transfers')
   OR (scope IN ('branches','inventory') AND (json_extract(CASE WHEN json_valid(undo_payload) THEN undo_payload ELSE '{}' END,'$.type')='transfer'));
