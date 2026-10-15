-- PRE: no maintenance, active import/bulk job, unexpired import lease or transient permit.
-- Install the epoch and MAX(receipt id) boundary in one atomic INSERT; migration
-- runner must execute this complete file as one transaction (D1 migration batch).
-- POST: no business rows changed, exact boundary durable, no permit present.
-- RECOVERY: retain the fence on Worker rollback; old physical writers refuse.
-- No counted conversion, restore-format adoption or reset authority is granted.
INSERT INTO system_flags(key,value,updated_at)
SELECT 'stock_schema_epoch', CASE WHEN
  NOT EXISTS(SELECT 1 FROM system_flags WHERE key IN ('maintenance','stock_transaction_permit','stock_schema_epoch','stock_schema_receipt_boundary'))
  AND NOT EXISTS(SELECT 1 FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling') OR julianday(lease_expires_at)>julianday('now'))
  AND NOT EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE status IN ('pending','processing'))
  THEN 'legacy-separate-pool-v1'
  ELSE json_extract('[1]','$[stock_schema_installation_conflict]') END, CURRENT_TIMESTAMP
UNION ALL
SELECT 'stock_schema_receipt_boundary', CAST(COALESCE(MAX(id),0) AS TEXT), CURRENT_TIMESTAMP FROM stock_mutation_receipts;

CREATE TRIGGER stock_epoch_branch_stock_insert_0243
BEFORE INSERT ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_update_0243
BEFORE UPDATE ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_delete_0243
BEFORE DELETE ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_insert_0243
BEFORE INSERT ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_update_0243
BEFORE UPDATE ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_delete_0243
BEFORE DELETE ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_insert_0243
BEFORE INSERT ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_update_0243
BEFORE UPDATE ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_delete_0243
BEFORE DELETE ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_insert_0243
BEFORE INSERT ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_update_0243
BEFORE UPDATE OF stock_quantity,id,is_active ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_delete_0243
BEFORE DELETE ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_insert_0243
BEFORE INSERT ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_update_0243
BEFORE UPDATE OF id,variant_product_id,is_active ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_delete_0243
BEFORE DELETE ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

-- Finite old reset admission backstop also fires when all stock tables are empty.
CREATE TRIGGER stock_epoch_reset_admission_0243
BEFORE INSERT ON system_flags
WHEN NEW.key IN ('sale_record_events_reset_guard','sale_incident_recovery_reset_guard','sale_not_paid_stock_recovery_reset_guard')
 AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

-- Any maintenance row blocks ordinary execution. Old restore admission cannot
-- mint permission, and corrupt control payloads fail closed without parsing JSON.
-- New restore still requires its existing token/source/representation contract.
CREATE TRIGGER stock_epoch_maintenance_insert_0243
BEFORE INSERT ON system_flags
WHEN NEW.key='maintenance' AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_maintenance_update_0243
BEFORE UPDATE OF key,value ON system_flags
WHEN NEW.key='maintenance' AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='legacy-separate-pool-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;
