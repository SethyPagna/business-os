-- HELD RECOVERY for 0199_branch_consolidation_shop_into_store.sql. Reverses
-- the Shop -> Store move. Not a forward migration and never in the chain.
--
-- Apply exactly like the forward file: as one migration (atomic in D1),
-- never statement by statement -- copy it into cloudflare/migrations/ under
-- the next free number at that time (clear it against d1_migrations AND
-- every ref's migration files), then wrangler d1 migrations apply. It needs the _branch_consolidation_* tables
-- the forward run left behind and drops them when it has finished, so it
-- runs once per forward run and a later forward run starts clean.
--
-- Deploy the pre-consolidation Worker FIRST only if the owner wants the
-- branches back for good; the successor-aware Worker is correct on both
-- shapes (every branch active, no successor = the old behaviour).
--
-- TRANSITIONS (the forward deltas, negated; moved = what Shop held then)
--   branch_stock       (p, 1): r -> r - q      (p, 2): 0 -> q
--   branch_batch_stock (b, 1): r -> r - q      (b, 2): 0 -> q
--   rfid_confirmed_qty (p, 1): d -> d - c      (p, 2): 0 -> c
-- Delta-based on purpose: if Store has sold since, its own sales stay
-- deducted. If Store no longer holds what Shop brought (sold on), the
-- nonnegative CHECK on branch_stock/branch_batch_stock aborts the whole file
-- and the move has to be undone by a counted, per-product decision instead.
-- When nothing was written in between, every row it touches ends
-- byte-identical to the backup (scripts/test-branch-consolidation-native.cjs).
--
-- Deliberately NOT reversed: sales, returns, fees and other records the
-- Worker redirected to Store after the move. They happened at Store, and each
-- carries its Shop origin in branch_redirects; those redirect rows stay.

-- 0. PREFLIGHT. Reading the run table fails loudly when there is no forward
-- run to recover.
CREATE TABLE _branch_consolidation_recovery_preflight (
  no_forward_run INTEGER NOT NULL
    CONSTRAINT "recovery preflight: no consolidation run to recover" CHECK (no_forward_run = 0),
  branches_not_consolidated INTEGER NOT NULL
    CONSTRAINT "recovery preflight: branches are not in the consolidated shape (Store 1 active, Shop 2 retired -> 1)" CHECK (branches_not_consolidated = 0),
  restore_in_progress INTEGER NOT NULL
    CONSTRAINT "recovery preflight: a restore maintenance window is already open" CHECK (restore_in_progress = 0)
);
INSERT INTO _branch_consolidation_recovery_preflight
SELECT
  CASE WHEN (SELECT COUNT(*) FROM _branch_consolidation_run WHERE receipt_id IS NOT NULL) = 1 THEN 0 ELSE 1 END,
  CASE WHEN EXISTS (SELECT 1 FROM branches WHERE id = 1 AND COALESCE(is_active, 0) = 1)
        AND EXISTS (SELECT 1 FROM branches WHERE id = 2 AND COALESCE(is_active, 0) = 0 AND successor_branch_id = 1)
       THEN 0 ELSE 1 END,
  (SELECT COUNT(*) FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore');

-- Totals before recovery, for the postflight.
CREATE TABLE _branch_consolidation_recovery_totals AS
SELECT 'product' AS kind, product_id AS entity_id, SUM(COALESCE(quantity, 0)) AS quantity, SUM(COALESCE(rfid_confirmed_qty, 0)) AS rfid
FROM branch_stock WHERE branch_id IN (1, 2) GROUP BY product_id
UNION ALL
SELECT 'lot', batch_id, SUM(COALESCE(quantity, 0)), 0
FROM branch_batch_stock WHERE branch_id IN (1, 2) GROUP BY batch_id;

-- 1. The retired-branch guards go first: Shop is about to receive stock.
DROP TRIGGER IF EXISTS branch_inactive_stock_insert_guard;
DROP TRIGGER IF EXISTS branch_inactive_stock_update_guard;
DROP TRIGGER IF EXISTS branch_inactive_lot_insert_guard;
DROP TRIGGER IF EXISTS branch_inactive_lot_update_guard;
DROP TRIGGER IF EXISTS branch_inactive_legacy_effect_guard;

-- 2. BRANCHES back to their recorded rows.
UPDATE branches
SET name = (SELECT name FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id),
    is_default = (SELECT is_default FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id),
    is_active = (SELECT is_active FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id),
    role = (SELECT role FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id),
    canonical_key = (SELECT canonical_key FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id),
    successor_branch_id = (SELECT successor_branch_id FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id),
    updated_at = (SELECT updated_at FROM _branch_consolidation_backup_branches b WHERE b.id = branches.id)
WHERE id IN (1, 2);

-- 3. STOCK, by the negated deltas.
UPDATE branch_batch_stock
SET quantity = quantity - (SELECT s.quantity FROM _branch_consolidation_backup_branch_batch_stock s
                           WHERE s.branch_id = 2 AND s.quantity > 0 AND s.batch_id = branch_batch_stock.batch_id)
WHERE branch_id = 1
  AND batch_id IN (SELECT batch_id FROM _branch_consolidation_backup_branch_batch_stock WHERE branch_id = 2 AND quantity > 0);
UPDATE branch_batch_stock
SET quantity = quantity + (SELECT s.quantity FROM _branch_consolidation_backup_branch_batch_stock s
                           WHERE s.branch_id = 2 AND s.quantity > 0 AND s.batch_id = branch_batch_stock.batch_id)
WHERE branch_id = 2
  AND batch_id IN (SELECT batch_id FROM _branch_consolidation_backup_branch_batch_stock WHERE branch_id = 2 AND quantity > 0);

UPDATE branch_stock
SET quantity = COALESCE(quantity, 0) - (SELECT COALESCE(s.quantity, 0) FROM _branch_consolidation_backup_branch_stock s
                                        WHERE s.branch_id = 2 AND s.product_id = branch_stock.product_id),
    rfid_confirmed_qty = COALESCE(rfid_confirmed_qty, 0) - (SELECT COALESCE(s.rfid_confirmed_qty, 0) FROM _branch_consolidation_backup_branch_stock s
                                        WHERE s.branch_id = 2 AND s.product_id = branch_stock.product_id)
WHERE branch_id = 1
  AND product_id IN (SELECT product_id FROM _branch_consolidation_backup_branch_stock
                     WHERE branch_id = 2 AND (COALESCE(quantity, 0) > 0 OR COALESCE(rfid_confirmed_qty, 0) <> 0));
UPDATE branch_stock
SET quantity = COALESCE(quantity, 0) + (SELECT COALESCE(s.quantity, 0) FROM _branch_consolidation_backup_branch_stock s
                                        WHERE s.branch_id = 2 AND s.product_id = branch_stock.product_id),
    rfid_confirmed_qty = COALESCE(rfid_confirmed_qty, 0) + (SELECT COALESCE(s.rfid_confirmed_qty, 0) FROM _branch_consolidation_backup_branch_stock s
                                        WHERE s.branch_id = 2 AND s.product_id = branch_stock.product_id)
WHERE branch_id = 2
  AND product_id IN (SELECT product_id FROM _branch_consolidation_backup_branch_stock
                     WHERE branch_id = 2 AND (COALESCE(quantity, 0) > 0 OR COALESCE(rfid_confirmed_qty, 0) <> 0));

-- Rows the forward run created at Store and that nothing has used since.
DELETE FROM branch_batch_stock
WHERE branch_id = 1 AND COALESCE(quantity, 0) = 0
  AND id NOT IN (SELECT id FROM _branch_consolidation_backup_branch_batch_stock)
  AND batch_id IN (SELECT batch_id FROM _branch_consolidation_backup_branch_batch_stock WHERE branch_id = 2 AND quantity > 0);
DELETE FROM branch_stock
WHERE branch_id = 1 AND COALESCE(quantity, 0) = 0 AND COALESCE(rfid_confirmed_qty, 0) = 0
  AND id NOT IN (SELECT id FROM _branch_consolidation_backup_branch_stock)
  AND product_id IN (SELECT product_id FROM _branch_consolidation_backup_branch_stock WHERE branch_id = 2);

-- Where a row is back at its recorded quantity (to within float noise from
-- r + q - q), the recorded value and timestamp go back exactly.
UPDATE branch_batch_stock
SET quantity = (SELECT b.quantity FROM _branch_consolidation_backup_branch_batch_stock b WHERE b.id = branch_batch_stock.id),
    updated_at = (SELECT b.updated_at FROM _branch_consolidation_backup_branch_batch_stock b WHERE b.id = branch_batch_stock.id)
WHERE id IN (SELECT b.id FROM _branch_consolidation_backup_branch_batch_stock b
             WHERE b.id = branch_batch_stock.id
               AND ABS(COALESCE(b.quantity, 0) - COALESCE(branch_batch_stock.quantity, 0)) <= 0.000000001
               AND (b.quantity IS NOT branch_batch_stock.quantity OR b.updated_at IS NOT branch_batch_stock.updated_at));
UPDATE branch_stock
SET quantity = (SELECT b.quantity FROM _branch_consolidation_backup_branch_stock b WHERE b.id = branch_stock.id),
    rfid_confirmed_qty = (SELECT b.rfid_confirmed_qty FROM _branch_consolidation_backup_branch_stock b WHERE b.id = branch_stock.id)
WHERE id IN (SELECT b.id FROM _branch_consolidation_backup_branch_stock b
             WHERE b.id = branch_stock.id
               AND ABS(COALESCE(b.quantity, 0) - COALESCE(branch_stock.quantity, 0)) <= 0.000000001
               AND ABS(COALESCE(b.rfid_confirmed_qty, 0) - COALESCE(branch_stock.rfid_confirmed_qty, 0)) <= 0.000000001
               AND (b.quantity IS NOT branch_stock.quantity OR b.rfid_confirmed_qty IS NOT branch_stock.rfid_confirmed_qty));

-- 4. CURRENT-STATE ROWS back to Shop, only those this run moved and that
-- are still where it put them.
UPDATE damaged_stock_lots
SET branch_id = 2,
    updated_at = (SELECT b.updated_at FROM _branch_consolidation_backup_damaged_stock_lots b WHERE b.id = damaged_stock_lots.id)
WHERE branch_id = 1
  AND CAST(id AS TEXT) IN (SELECT entity_key FROM branch_redirects
                           WHERE entity_type = 'damaged_stock_lot' AND context = 'branch-consolidation'
                             AND id > (SELECT redirect_id_floor FROM _branch_consolidation_run));
UPDATE rfid_tags
SET branch_id = 2,
    updated_at = (SELECT b.updated_at FROM _branch_consolidation_backup_rfid_tags b WHERE b.id = rfid_tags.id)
WHERE branch_id = 1
  AND CAST(id AS TEXT) IN (SELECT entity_key FROM branch_redirects
                           WHERE entity_type = 'rfid_tag' AND context = 'branch-consolidation'
                             AND id > (SELECT redirect_id_floor FROM _branch_consolidation_run));

-- 5. UNDO ENTRIES the forward run retired, reopened as they were. An entry
-- touched since (status no longer 'recorded' with the marker) is left alone.
UPDATE action_history
SET reversible = (SELECT b.reversible FROM _branch_consolidation_backup_action_history b WHERE b.id = action_history.id),
    status = (SELECT b.status FROM _branch_consolidation_backup_action_history b WHERE b.id = action_history.id),
    last_error = (SELECT b.last_error FROM _branch_consolidation_backup_action_history b WHERE b.id = action_history.id),
    updated_at = (SELECT b.updated_at FROM _branch_consolidation_backup_action_history b WHERE b.id = action_history.id)
WHERE id IN (SELECT id FROM _branch_consolidation_backup_action_history)
  AND status = 'recorded' AND last_error = 'Retired by the Shop/Warehouse consolidation';

-- 6. THE RUN'S OWN RECORDS. Movements, transfer rows and redirects written
-- by the run itself (never ones the Worker wrote afterwards).
DELETE FROM inventory_movements
WHERE id > (SELECT movement_id_floor FROM _branch_consolidation_run)
  AND reference_id IS NULL
  AND movement_type IN ('transfer_out', 'transfer_in')
  AND reason = 'Branch consolidation: Shop moved into Store';
DELETE FROM stock_transfers
WHERE id > (SELECT stock_transfer_id_floor FROM _branch_consolidation_run)
  AND receipt_id = (SELECT receipt_id FROM _branch_consolidation_run);
DELETE FROM branch_redirects
WHERE id > (SELECT redirect_id_floor FROM _branch_consolidation_run)
  AND context = 'branch-consolidation';

-- Transfer provenance is immutable outside a restore window (0151). Open
-- one for exactly these two deletes, then put system_flags back as it was.
CREATE TABLE _branch_consolidation_recovery_flag AS SELECT * FROM system_flags WHERE key = 'maintenance';
INSERT INTO system_flags(key, value, updated_at)
VALUES ('maintenance', json_object('mode', 'restore', 'token', 'branch-consolidation-recovery', 'backupKey', 'branch-consolidation'), CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
DELETE FROM transfer_operation_members WHERE receipt_id = (SELECT receipt_id FROM _branch_consolidation_run);
DELETE FROM transfer_operation_receipts WHERE id = (SELECT receipt_id FROM _branch_consolidation_run);
DELETE FROM system_flags WHERE key = 'maintenance';
INSERT INTO system_flags SELECT * FROM _branch_consolidation_recovery_flag;

-- 7. CACHES.
INSERT INTO cache_versions(namespace, version) VALUES ('products', 2), ('sales', 2), ('returns', 2)
ON CONFLICT(namespace) DO UPDATE SET version = version + 1, updated_at = CURRENT_TIMESTAMP;

-- 8. POSTFLIGHT. Totals over Store+Shop did not move; Shop holds exactly
-- what it held before the forward run; the branches are back.
CREATE TABLE _branch_consolidation_recovery_postflight (
  totals_changed INTEGER NOT NULL CONSTRAINT "recovery postflight: a product or lot total over Store+Shop changed" CHECK (totals_changed = 0),
  shop_not_restored INTEGER NOT NULL CONSTRAINT "recovery postflight: Shop does not hold what it held before the move" CHECK (shop_not_restored = 0),
  branches_not_restored INTEGER NOT NULL CONSTRAINT "recovery postflight: branch rows differ from the backup" CHECK (branches_not_restored = 0),
  provenance_left INTEGER NOT NULL CONSTRAINT "recovery postflight: the run's transfer record is still present" CHECK (provenance_left = 0)
);
INSERT INTO _branch_consolidation_recovery_postflight
SELECT
  (SELECT COUNT(*) FROM _branch_consolidation_recovery_totals t
   WHERE t.kind = 'product' AND (
     ABS(t.quantity - COALESCE((SELECT SUM(COALESCE(quantity, 0)) FROM branch_stock WHERE product_id = t.entity_id AND branch_id IN (1, 2)), 0)) > 0.000000001
     OR ABS(t.rfid - COALESCE((SELECT SUM(COALESCE(rfid_confirmed_qty, 0)) FROM branch_stock WHERE product_id = t.entity_id AND branch_id IN (1, 2)), 0)) > 0.000000001))
  + (SELECT COUNT(*) FROM _branch_consolidation_recovery_totals t
     WHERE t.kind = 'lot'
       AND ABS(t.quantity - COALESCE((SELECT SUM(COALESCE(quantity, 0)) FROM branch_batch_stock WHERE batch_id = t.entity_id AND branch_id IN (1, 2)), 0)) > 0.000000001),
  (SELECT COUNT(*) FROM _branch_consolidation_backup_branch_stock b
   WHERE b.branch_id = 2 AND NOT EXISTS (
     SELECT 1 FROM branch_stock n WHERE n.id = b.id AND n.quantity IS b.quantity AND n.rfid_confirmed_qty IS b.rfid_confirmed_qty))
  + (SELECT COUNT(*) FROM _branch_consolidation_backup_branch_batch_stock b
     WHERE b.branch_id = 2 AND NOT EXISTS (
       SELECT 1 FROM branch_batch_stock n WHERE n.id = b.id AND n.quantity IS b.quantity)),
  (SELECT COUNT(*) FROM _branch_consolidation_backup_branches b
   WHERE b.id IN (1, 2) AND NOT EXISTS (
     SELECT 1 FROM branches n WHERE n.id = b.id AND n.name IS b.name AND n.is_active IS b.is_active
       AND n.is_default IS b.is_default AND n.role IS b.role AND n.successor_branch_id IS b.successor_branch_id)),
  (SELECT COUNT(*) FROM transfer_operation_receipts WHERE operation_id = 'branch-consolidation-v1');

-- 9. CLEAN UP, so a later forward run starts from nothing.
DROP TABLE _branch_consolidation_recovery_postflight;
DROP TABLE _branch_consolidation_recovery_flag;
DROP TABLE _branch_consolidation_recovery_totals;
DROP TABLE _branch_consolidation_recovery_preflight;
DROP TABLE _branch_consolidation_postflight;
DROP TABLE _branch_consolidation_preflight;
DROP TABLE _branch_consolidation_backup_action_history;
DROP TABLE _branch_consolidation_backup_rfid_tags;
DROP TABLE _branch_consolidation_backup_damaged_stock_lots;
DROP TABLE _branch_consolidation_backup_branch_batch_stock;
DROP TABLE _branch_consolidation_backup_branch_stock;
DROP TABLE _branch_consolidation_backup_branches;
DROP TABLE _branch_consolidation_run;
