-- WIP NONDEPLOYABLE: execute the complete file in one transaction under exclusive maintenance.
-- No HTTP conversion endpoint. All remaining writers/readers/restore must close before release.
CREATE TABLE IF NOT EXISTS counted_stock_conversion_lots (
 lot_id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, batch_id INTEGER,
 condition_tag TEXT NOT NULL, source TEXT, unit_cost_usd REAL, credited_quantity REAL NOT NULL,
 converted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS counted_sale_item_conditions (
 sale_item_id INTEGER PRIMARY KEY, lot_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
 branch_id INTEGER NOT NULL, batch_id INTEGER, condition_tag TEXT NOT NULL
);
SELECT CASE WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND CASE WHEN json_valid(value) THEN json_extract(value,'$.mode')='counted_conversion' AND length(trim(COALESCE(json_extract(value,'$.token'),'')))>0 ELSE 0 END)
 AND NOT EXISTS(SELECT 1 FROM system_flags WHERE key='stock_transaction_permit')
 AND EXISTS(SELECT 1 FROM system_flags WHERE key='stock_schema_epoch' AND value IN ('legacy-separate-pool-v1','counted-tagged-subset-v1'))
 AND ((SELECT value FROM system_flags WHERE key='stock_schema_epoch')!='legacy-separate-pool-v1' OR NOT EXISTS(SELECT 1 FROM counted_stock_conversion_lots))
 AND NOT EXISTS(SELECT 1 FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling') OR julianday(lease_expires_at)>julianday('now'))
 AND NOT EXISTS(SELECT 1 FROM bulk_delete_jobs WHERE status IN ('pending','processing'))
 THEN 1 ELSE json_extract('[1]','$[counted_conversion_exclusion_required]') END;
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM damaged_stock_lots d
 LEFT JOIN products p ON p.id=d.product_id LEFT JOIN branches b ON b.id=d.branch_id
 LEFT JOIN product_batches pb ON pb.id=d.batch_id
 WHERE p.id IS NULL OR p.is_active IS NOT 1 OR b.id IS NULL OR b.is_active IS NOT 1
 OR d.quantity_remaining<0 OR d.quantity_remaining>d.quantity OR d.condition_tag IS NULL
 OR (d.batch_id IS NOT NULL AND (pb.id IS NULL OR pb.variant_product_id!=d.product_id OR pb.is_active IS NOT 1)))
 AND NOT EXISTS(SELECT 1 FROM sale_items si LEFT JOIN damaged_stock_lots d ON d.id=si.damaged_lot_id
 WHERE si.damaged_lot_id IS NOT NULL AND (d.id IS NULL OR d.product_id IS NOT si.product_id OR d.branch_id IS NOT si.branch_id))
 THEN 1 ELSE json_extract('[1]','$[counted_conversion_provenance_conflict]') END;
INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch';
INSERT OR IGNORE INTO counted_stock_conversion_lots(lot_id,product_id,branch_id,batch_id,condition_tag,source,unit_cost_usd,credited_quantity)
 SELECT id,product_id,branch_id,batch_id,condition_tag,source,unit_cost_usd,quantity_remaining FROM damaged_stock_lots
 WHERE (SELECT value FROM system_flags WHERE key='stock_schema_epoch')='legacy-separate-pool-v1';
INSERT INTO branch_stock(product_id,branch_id,quantity)
 SELECT product_id,branch_id,SUM(credited_quantity) FROM counted_stock_conversion_lots
 WHERE (SELECT value FROM system_flags WHERE key='stock_schema_epoch')='legacy-separate-pool-v1'
 GROUP BY product_id,branch_id
 ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity;
INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
 SELECT batch_id,branch_id,SUM(credited_quantity) FROM counted_stock_conversion_lots
 WHERE batch_id IS NOT NULL AND (SELECT value FROM system_flags WHERE key='stock_schema_epoch')='legacy-separate-pool-v1'
 GROUP BY batch_id,branch_id
 ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity;
UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=products.id)
 WHERE id IN(SELECT product_id FROM counted_stock_conversion_lots)
 AND (SELECT value FROM system_flags WHERE key='stock_schema_epoch')='legacy-separate-pool-v1';
INSERT OR IGNORE INTO counted_sale_item_conditions(sale_item_id,lot_id,product_id,branch_id,batch_id,condition_tag)
 SELECT si.id,d.id,d.product_id,d.branch_id,d.batch_id,d.condition_tag FROM sale_items si JOIN damaged_stock_lots d ON d.id=si.damaged_lot_id;
UPDATE system_flags SET value='counted-tagged-subset-v1',updated_at=CURRENT_TIMESTAMP WHERE key='stock_schema_epoch';
DELETE FROM system_flags WHERE key='stock_transaction_permit';

DROP TRIGGER IF EXISTS stock_epoch_branch_stock_insert_0243;
DROP TRIGGER IF EXISTS stock_epoch_branch_stock_update_0243;
DROP TRIGGER IF EXISTS stock_epoch_branch_stock_delete_0243;
DROP TRIGGER IF EXISTS stock_epoch_branch_batch_stock_insert_0243;
DROP TRIGGER IF EXISTS stock_epoch_branch_batch_stock_update_0243;
DROP TRIGGER IF EXISTS stock_epoch_branch_batch_stock_delete_0243;
DROP TRIGGER IF EXISTS stock_epoch_damaged_stock_lots_insert_0243;
DROP TRIGGER IF EXISTS stock_epoch_damaged_stock_lots_update_0243;
DROP TRIGGER IF EXISTS stock_epoch_damaged_stock_lots_delete_0243;
DROP TRIGGER IF EXISTS stock_epoch_products_insert_0243;
DROP TRIGGER IF EXISTS stock_epoch_products_update_0243;
DROP TRIGGER IF EXISTS stock_epoch_products_delete_0243;
DROP TRIGGER IF EXISTS stock_epoch_product_batches_insert_0243;
DROP TRIGGER IF EXISTS stock_epoch_product_batches_update_0243;
DROP TRIGGER IF EXISTS stock_epoch_product_batches_delete_0243;
DROP TRIGGER IF EXISTS stock_epoch_reset_admission_0243;
DROP TRIGGER IF EXISTS stock_epoch_maintenance_insert_0243;
DROP TRIGGER IF EXISTS stock_epoch_maintenance_update_0243;
CREATE TRIGGER stock_epoch_branch_stock_insert_0243
BEFORE INSERT ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_update_0243
BEFORE UPDATE ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_stock_delete_0243
BEFORE DELETE ON branch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_insert_0243
BEFORE INSERT ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_update_0243
BEFORE UPDATE ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_branch_batch_stock_delete_0243
BEFORE DELETE ON branch_batch_stock
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_insert_0243
BEFORE INSERT ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_update_0243
BEFORE UPDATE ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_damaged_stock_lots_delete_0243
BEFORE DELETE ON damaged_stock_lots
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_insert_0243
BEFORE INSERT ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_update_0243
BEFORE UPDATE OF stock_quantity,id,is_active ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_products_delete_0243
BEFORE DELETE ON products
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_insert_0243
BEFORE INSERT ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_update_0243
BEFORE UPDATE OF id,variant_product_id,is_active ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_product_batches_delete_0243
BEFORE DELETE ON product_batches
WHEN NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

-- Finite old reset admission backstop also fires when all stock tables are empty.
CREATE TRIGGER stock_epoch_reset_admission_0243
BEFORE INSERT ON system_flags
WHEN NEW.key IN ('sale_record_events_reset_guard','sale_incident_recovery_reset_guard','sale_not_paid_stock_recovery_reset_guard')
 AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

-- Any maintenance row blocks ordinary execution. Old restore admission cannot
-- mint permission, and corrupt control payloads fail closed without parsing JSON.
-- New restore still requires its existing token/source/representation contract.
CREATE TRIGGER stock_epoch_maintenance_insert_0243
BEFORE INSERT ON system_flags
WHEN NEW.key='maintenance' AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER stock_epoch_maintenance_update_0243
BEFORE UPDATE OF key,value ON system_flags
WHEN NEW.key='maintenance' AND NOT EXISTS(SELECT 1 FROM system_flags e JOIN system_flags p ON p.key='stock_transaction_permit' AND p.value=e.value WHERE e.key='stock_schema_epoch' AND e.value='counted-tagged-subset-v1')
BEGIN SELECT RAISE(ABORT,'stock_transaction_required'); END;

CREATE TRIGGER IF NOT EXISTS counted_conversion_lots_no_update_0246 BEFORE UPDATE ON counted_stock_conversion_lots BEGIN SELECT RAISE(ABORT,'immutable_counted_conversion'); END;
CREATE TRIGGER IF NOT EXISTS counted_conversion_lots_no_delete_0246 BEFORE DELETE ON counted_stock_conversion_lots BEGIN SELECT RAISE(ABORT,'immutable_counted_conversion'); END;
CREATE TRIGGER IF NOT EXISTS counted_sale_conditions_no_update_0246 BEFORE UPDATE ON counted_sale_item_conditions BEGIN SELECT RAISE(ABORT,'immutable_counted_condition'); END;
CREATE TRIGGER IF NOT EXISTS counted_sale_conditions_no_delete_0246 BEFORE DELETE ON counted_sale_item_conditions BEGIN SELECT RAISE(ABORT,'immutable_counted_condition'); END;

CREATE TRIGGER IF NOT EXISTS counted_sale_condition_capture_0246 AFTER INSERT ON sale_items
WHEN NEW.damaged_lot_id IS NOT NULL
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM damaged_stock_lots d WHERE d.id=NEW.damaged_lot_id AND d.product_id=NEW.product_id AND d.branch_id=NEW.branch_id)
 THEN 1 ELSE RAISE(ABORT,'counted_condition_identity_conflict') END;
 INSERT INTO counted_sale_item_conditions(sale_item_id,lot_id,product_id,branch_id,batch_id,condition_tag)
 SELECT NEW.id,id,product_id,branch_id,batch_id,condition_tag FROM damaged_stock_lots WHERE id=NEW.damaged_lot_id;
END;
