-- 0199, HELD (lane U-branch; number reserved, not in cloudflare/migrations until
-- the owner's cutover). Shop (id 2) moves into Warehouse (id 1), which is
-- renamed Store and becomes the selling, default branch.
--
-- Owner decisions this file implements (lane U-branch):
--   * Survivor: Warehouse id 1 -> name 'Store', role 'shop', is_default 1.
--     canonical_key stays 'warehouse', so a sheet's warehouse column still
--     finds it.
--   * Shop id 2 keeps its name, gets is_active 0 and successor_branch_id 1.
--   * The move is an OFFICIAL transfer: one transfer_operation_receipts row,
--     one transfer_operation_members row per product, per-lot
--     transfer_out/transfer_in movements, one stock_transfers row per member.
--   * History is never relabelled: old sales, returns, movements and shifts
--     keep branch 2 and the name they were written with.
--
-- PREREQUISITES
--   1. cloudflare/migrations/0198_branch_successor_role.sql has run (role, canonical_key,
--      successor_branch_id, branch_redirects). This file reads those columns
--      and fails at parse time without them.
--   2. The Worker that carries lib/branchSuccession.ts is live, so every
--      writer redirects or refuses branch 2 the moment it goes inactive.
--   3. GET /api/branches/consolidation-preview reports ready = true.
--
-- HOW TO APPLY
--   At the cutover, move this file UNCHANGED into cloudflare/migrations/
--   (same name, 0199 is reserved for it) and apply it as a migration
--   (wrangler d1 migrations apply). D1 runs a migration atomically, which is
--   what makes the preflight below an abort: a failed CHECK rolls back every
--   statement and the migration stays unapplied, so it can be retried once
--   the named blocker is cleared. Never run it with d1 execute --file and
--   never statement by statement.
--   It is held rather than in the chain because the chain runs on every
--   release and on every fresh local/test database: here it would perform
--   the move at whatever release came next, and on an empty database its
--   preflight fails by design.
--
-- TRANSITIONS (one run, fixed ids)
--   branch_stock       (p, 2): q      -> 0        (p, 1): r      -> r + q
--   branch_batch_stock (b, 2): q      -> 0        (b, 1): r      -> r + q
--   rfid_confirmed_qty (p, 2): c      -> 0        (p, 1): d      -> d + c
--   products.stock_quantity: untouched (the sum over branches is conserved)
--   Double apply: the first statement creates _branch_consolidation_run, so
--   a second run aborts before touching anything; the preflight also refuses
--   once branch 2 is inactive.
--   Reversal: 0199_branch_consolidation_shop_into_store_recovery.sql (delta-based; byte-identical
--   rows when nothing was written in between).
--
-- A pre-existing ledger mismatch at Shop (branch_stock above the sum of its
-- lots) is carried over exactly: it becomes the member's untracked quantity,
-- as an ordinary transfer records it. The reverse mismatch (lots above
-- branch_stock) cannot be represented by a transfer and aborts the
-- preflight; correct it first with a stock count.

-- 0. Run marker. Fails with "table already exists" on a second run.
CREATE TABLE _branch_consolidation_run (
  operation_id TEXT NOT NULL,
  receipt_id INTEGER,
  movement_id_floor INTEGER NOT NULL,
  stock_transfer_id_floor INTEGER NOT NULL,
  redirect_id_floor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO _branch_consolidation_run(operation_id, movement_id_floor, stock_transfer_id_floor, redirect_id_floor)
SELECT 'branch-consolidation-v1',
  (SELECT COALESCE(MAX(id), 0) FROM inventory_movements),
  (SELECT COALESCE(MAX(id), 0) FROM stock_transfers),
  (SELECT COALESCE(MAX(id), 0) FROM branch_redirects);

-- 1. PREFLIGHT. Every column is a count that must be zero; the constraint
-- name is the reason the run stopped.
CREATE TABLE _branch_consolidation_preflight (
  branches_not_as_expected INTEGER NOT NULL
    CONSTRAINT "preflight: exactly two active branches, Warehouse id 1 and Shop id 2, no successor, no branch named Store"
    CHECK (branches_not_as_expected = 0),
  unreleased_holds INTEGER NOT NULL
    CONSTRAINT "preflight: Shop has awaiting_payment/awaiting_delivery sales holding stock; settle or cancel them first"
    CHECK (unreleased_holds = 0),
  open_shifts INTEGER NOT NULL
    CONSTRAINT "preflight: a shift is open at Shop; end it first"
    CHECK (open_shifts = 0),
  active_jobs INTEGER NOT NULL
    CONSTRAINT "preflight: an import or bulk delete is running; wait for it"
    CHECK (active_jobs = 0),
  active_rfid_sessions INTEGER NOT NULL
    CONSTRAINT "preflight: an RFID scan session is open at Shop; finish it first"
    CHECK (active_rfid_sessions = 0),
  lots_exceed_branch_stock INTEGER NOT NULL
    CONSTRAINT "preflight: at Shop some product holds more in its lots than in branch_stock; count it first"
    CHECK (lots_exceed_branch_stock = 0),
  restore_in_progress INTEGER NOT NULL
    CONSTRAINT "preflight: a restore maintenance window is open"
    CHECK (restore_in_progress = 0)
);
INSERT INTO _branch_consolidation_preflight
SELECT
  CASE WHEN (SELECT COUNT(*) FROM branches WHERE COALESCE(is_active, 0) = 1) = 2
        AND EXISTS (SELECT 1 FROM branches WHERE id = 1 AND COALESCE(is_active, 0) = 1
                    AND lower(trim(name)) = 'warehouse' AND successor_branch_id IS NULL)
        AND EXISTS (SELECT 1 FROM branches WHERE id = 2 AND COALESCE(is_active, 0) = 1
                    AND lower(trim(name)) = 'shop' AND successor_branch_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM branches WHERE lower(trim(name)) = 'store')
       THEN 0 ELSE 1 END,
  (SELECT COUNT(*) FROM sales WHERE branch_id = 2 AND sale_status IN ('awaiting_payment', 'awaiting_delivery')),
  (SELECT COUNT(*) FROM shift_sessions WHERE branch_id = 2 AND closed_at IS NULL AND cancelled_at IS NULL),
  (SELECT COUNT(*) FROM import_jobs WHERE status IN ('pending','queued','running','analyzing','approved','applying','cancelling'))
    + (SELECT COUNT(*) FROM bulk_delete_jobs WHERE status IN ('pending','processing')),
  (SELECT COUNT(*) FROM rfid_scan_sessions WHERE branch_id = 2 AND COALESCE(status, 'active') = 'active' AND finished_at IS NULL),
  (SELECT COUNT(*) FROM (
     SELECT b.variant_product_id AS product_id, SUM(bs.quantity) AS lot_quantity
     FROM branch_batch_stock bs JOIN product_batches b ON b.id = bs.batch_id
     WHERE bs.branch_id = 2 AND bs.quantity > 0
     GROUP BY b.variant_product_id
   ) l
   WHERE l.lot_quantity > COALESCE((SELECT quantity FROM branch_stock WHERE product_id = l.product_id AND branch_id = 2), 0) + 0.000000001),
  (SELECT COUNT(*) FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore');

-- 2. BACKUPS. Plain copies; the recovery file reads them and
-- drops them when it has finished.
CREATE TABLE _branch_consolidation_backup_branches AS SELECT * FROM branches;
CREATE TABLE _branch_consolidation_backup_branch_stock AS SELECT * FROM branch_stock WHERE branch_id IN (1, 2);
CREATE TABLE _branch_consolidation_backup_branch_batch_stock AS SELECT * FROM branch_batch_stock WHERE branch_id IN (1, 2);
CREATE TABLE _branch_consolidation_backup_damaged_stock_lots AS SELECT * FROM damaged_stock_lots WHERE branch_id = 2;
CREATE TABLE _branch_consolidation_backup_rfid_tags AS SELECT * FROM rfid_tags WHERE branch_id = 2;
CREATE TABLE _branch_consolidation_backup_action_history AS
  SELECT * FROM action_history WHERE COALESCE(reversible, 1) = 1 AND status IN ('undoable', 'redoable');

-- 3. THE TRANSFER RECORD. Written as 'planning' so its members can be
-- inserted, then sealed as 'committed' (0148/0152 triggers). No
-- action_history row: this move is reversed by the recovery file, never by
-- the in-app undo.
INSERT INTO transfer_operation_receipts(actor_id, request_id, request_digest, request_json, status, operation_id, provenance_version, replay_state, generation)
VALUES (0, 'branch-consolidation-v1', 'branch-consolidation-v1',
  json_object('kind', 'branch-consolidation', 'fromBranchId', 2, 'toBranchId', 1,
              'reason', 'Branch consolidation: Shop moved into Store'),
  'planning', 'branch-consolidation-v1', 1, 'applied', 0);
UPDATE _branch_consolidation_run
SET receipt_id = (SELECT id FROM transfer_operation_receipts WHERE operation_id = 'branch-consolidation-v1');

INSERT INTO transfer_operation_members(receipt_id, ordinal, source_product_id, destination_product_id, source_branch_id, destination_branch_id,
  quantity, untracked_quantity, source_snapshot, destination_snapshot, allocations_json)
SELECT run.receipt_id,
  ROW_NUMBER() OVER (ORDER BY s.product_id) - 1,
  s.product_id, s.product_id, 2, 1,
  s.quantity,
  MAX(0, s.quantity - COALESCE(l.lot_quantity, 0)),
  json_set(json_object('id', p.id, 'name', p.name, 'barcode', p.barcode, 'created_at', p.created_at, 'is_active', p.is_active),
    '$.untracked_cost_snapshot',
    CASE WHEN s.quantity - COALESCE(l.lot_quantity, 0) > 0 THEN json_object(
      'unitCostUsd', p.cost_price_usd, 'unitCostKhr', p.cost_price_khr,
      'totalCostUsd', CASE WHEN p.cost_price_usd IS NULL THEN NULL ELSE (s.quantity - COALESCE(l.lot_quantity, 0)) * p.cost_price_usd END,
      'totalCostKhr', CASE WHEN p.cost_price_khr IS NULL THEN NULL ELSE (s.quantity - COALESCE(l.lot_quantity, 0)) * p.cost_price_khr END)
    ELSE NULL END),
  json_object('id', p.id, 'name', p.name, 'barcode', p.barcode, 'created_at', p.created_at, 'is_active', p.is_active),
  COALESCE(l.allocations, json_array())
FROM _branch_consolidation_backup_branch_stock s
JOIN products p ON p.id = s.product_id
CROSS JOIN _branch_consolidation_run run
LEFT JOIN (
  SELECT product_id, SUM(quantity) AS lot_quantity, json_group_array(json(allocation)) AS allocations
  FROM (
    SELECT b.variant_product_id AS product_id, bs.quantity,
      json_object(
        'source_batch_id', b.id, 'destination_batch_id', b.id, 'destination_batch_key', b.batch_key,
        'quantity', bs.quantity,
        'source_snapshot', json_object('id', b.id, 'variant_product_id', b.variant_product_id, 'batch_key', b.batch_key,
          'lot_code', b.lot_code, 'received_at', b.received_at, 'expiry_date', b.expiry_date, 'notes', b.notes),
        'destination_snapshot', json_object('id', b.id, 'variant_product_id', b.variant_product_id, 'batch_key', b.batch_key,
          'lot_code', b.lot_code, 'received_at', b.received_at, 'expiry_date', b.expiry_date, 'notes', b.notes),
        'cost_snapshot', json_object('unitCostUsd', b.unit_cost_usd, 'unitCostKhr', NULL,
          'totalCostUsd', CASE WHEN b.unit_cost_usd IS NULL THEN NULL ELSE bs.quantity * b.unit_cost_usd END,
          'totalCostKhr', NULL)
      ) AS allocation
    FROM _branch_consolidation_backup_branch_batch_stock bs
    JOIN product_batches b ON b.id = bs.batch_id
    WHERE bs.branch_id = 2 AND bs.quantity > 0
    ORDER BY b.variant_product_id, b.received_at, b.id
  )
  GROUP BY product_id
) l ON l.product_id = s.product_id
WHERE s.branch_id = 2 AND s.quantity > 0;

UPDATE transfer_operation_receipts
SET status = 'committed',
    response_json = json_object('operation_id', operation_id, 'generation', 0, 'provenance_version', 1,
      'members', (SELECT COUNT(*) FROM transfer_operation_members WHERE receipt_id = transfer_operation_receipts.id)),
    updated_at = CURRENT_TIMESTAMP
WHERE operation_id = 'branch-consolidation-v1';

-- 4. THE SURVIVOR AND THE RETIRED BRANCH. Renamed before the movements so
-- the new rows carry the names in force when they were written.
UPDATE branches SET name = 'Store', role = 'shop', is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1;
UPDATE branches SET is_active = 0, is_default = 0, successor_branch_id = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 2;

-- 5. STOCK. Each ledger moves by exactly what Shop held in it.
INSERT INTO branch_batch_stock(batch_id, branch_id, quantity)
SELECT batch_id, 1, quantity FROM _branch_consolidation_backup_branch_batch_stock WHERE branch_id = 2 AND quantity > 0
ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP;
UPDATE branch_batch_stock SET quantity = 0, updated_at = CURRENT_TIMESTAMP WHERE branch_id = 2 AND quantity > 0;

INSERT INTO branch_stock(product_id, branch_id, quantity, rfid_confirmed_qty)
SELECT product_id, 1, COALESCE(quantity, 0), COALESCE(rfid_confirmed_qty, 0)
FROM _branch_consolidation_backup_branch_stock
WHERE branch_id = 2 AND (COALESCE(quantity, 0) > 0 OR COALESCE(rfid_confirmed_qty, 0) <> 0)
ON CONFLICT(product_id, branch_id) DO UPDATE SET
  quantity = COALESCE(quantity, 0) + excluded.quantity,
  rfid_confirmed_qty = COALESCE(rfid_confirmed_qty, 0) + excluded.rfid_confirmed_qty;
UPDATE branch_stock SET quantity = 0, rfid_confirmed_qty = 0
WHERE branch_id = 2 AND (COALESCE(quantity, 0) <> 0 OR COALESCE(rfid_confirmed_qty, 0) <> 0);

-- 6. MOVEMENTS AND TRANSFER ROWS, from the sealed members, in exactly the
-- convention lib/transferOperation.ts writes: one 'transfer_out' at the
-- source and one 'transfer_in' at the destination per lot take plus one per
-- untracked remainder, reference_id NULL, the transfer reason as reason.
-- Anything that reads or pairs ordinary transfer legs reads these the same
-- way. This run's rows are found by id > movement_id_floor + the reason.
INSERT INTO inventory_movements(product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, batch_id,
  unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr)
SELECT product_id, product_name, branch_id, branch_name, movement_type, quantity, 'Branch consolidation: Shop moved into Store', NULL, 'Branch consolidation', batch_id,
  unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr
FROM (
  SELECT m.source_product_id AS product_id, json_extract(m.source_snapshot, '$.name') AS product_name, side.branch_id, side.branch_name, side.movement_type,
    json_extract(a.value, '$.quantity') AS quantity, m.receipt_id, json_extract(a.value, '$.source_batch_id') AS batch_id,
    json_extract(a.value, '$.cost_snapshot.unitCostUsd') AS unit_cost_usd, json_extract(a.value, '$.cost_snapshot.unitCostKhr') AS unit_cost_khr,
    json_extract(a.value, '$.cost_snapshot.totalCostUsd') AS total_cost_usd, json_extract(a.value, '$.cost_snapshot.totalCostKhr') AS total_cost_khr,
    side.ord, m.ordinal, a.key AS take
  FROM transfer_operation_members m
  JOIN json_each(m.allocations_json) a
  CROSS JOIN (SELECT 2 AS branch_id, (SELECT name FROM branches WHERE id = 2) AS branch_name, 'transfer_out' AS movement_type, 0 AS ord
              UNION ALL SELECT 1, (SELECT name FROM branches WHERE id = 1), 'transfer_in', 1) side
  WHERE m.receipt_id = (SELECT receipt_id FROM _branch_consolidation_run)
  UNION ALL
  SELECT m.source_product_id, json_extract(m.source_snapshot, '$.name'), side.branch_id, side.branch_name, side.movement_type,
    m.untracked_quantity, m.receipt_id, NULL,
    json_extract(m.source_snapshot, '$.untracked_cost_snapshot.unitCostUsd'), json_extract(m.source_snapshot, '$.untracked_cost_snapshot.unitCostKhr'),
    json_extract(m.source_snapshot, '$.untracked_cost_snapshot.totalCostUsd'), json_extract(m.source_snapshot, '$.untracked_cost_snapshot.totalCostKhr'),
    side.ord, m.ordinal, 1000000
  FROM transfer_operation_members m
  CROSS JOIN (SELECT 2 AS branch_id, (SELECT name FROM branches WHERE id = 2) AS branch_name, 'transfer_out' AS movement_type, 0 AS ord
              UNION ALL SELECT 1, (SELECT name FROM branches WHERE id = 1), 'transfer_in', 1) side
  WHERE m.receipt_id = (SELECT receipt_id FROM _branch_consolidation_run) AND m.untracked_quantity > 0
)
ORDER BY ord, ordinal, take;

INSERT INTO stock_transfers(product_id, product_name, from_branch_id, to_branch_id, quantity, notes, user_id, user_name, client_request_id, receipt_id, member_ordinal, generation)
SELECT source_product_id, json_extract(source_snapshot, '$.name'), 2, 1, quantity, 'Branch consolidation: Shop moved into Store',
  NULL, 'Branch consolidation', 'branch-consolidation-v1', receipt_id, ordinal, 0
FROM transfer_operation_members
WHERE receipt_id = (SELECT receipt_id FROM _branch_consolidation_run)
ORDER BY ordinal;

-- 7. CURRENT-STATE ROWS THAT POINT AT SHOP. Open quarantine lots and RFID
-- tags describe goods on a shelf, so they follow the goods; resolved lots
-- are history and stay. Every re-point is recorded as a redirect.
INSERT INTO branch_redirects(entity_type, entity_key, origin_branch_id, origin_branch_name, target_branch_id, target_branch_name, context, created_by_name)
SELECT 'damaged_stock_lot', CAST(id AS TEXT), 2, 'Shop', 1, 'Store', 'branch-consolidation', 'Branch consolidation'
FROM damaged_stock_lots WHERE branch_id = 2 AND quantity_remaining > 0 ORDER BY id;
UPDATE damaged_stock_lots SET branch_id = 1, updated_at = CURRENT_TIMESTAMP WHERE branch_id = 2 AND quantity_remaining > 0;

INSERT INTO branch_redirects(entity_type, entity_key, origin_branch_id, origin_branch_name, target_branch_id, target_branch_name, context, created_by_name)
SELECT 'rfid_tag', CAST(id AS TEXT), 2, 'Shop', 1, 'Store', 'branch-consolidation', 'Branch consolidation'
FROM rfid_tags WHERE branch_id = 2 ORDER BY id;
UPDATE rfid_tags SET branch_id = 1, updated_at = CURRENT_TIMESTAMP WHERE branch_id = 2;

-- 8. UNDO ENTRIES. An undo recorded before this run could put stock back at
-- Shop or take it from a Store row that now holds merged stock. Every open
-- entry is retired to 'recorded' (the state 0151/0152 use); the backup lets
-- the recovery file reopen them.
UPDATE action_history
SET reversible = 0, status = 'recorded', last_error = 'Retired by the Shop/Warehouse consolidation', updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM _branch_consolidation_backup_action_history);

-- 9. NO NEW STOCK AT A RETIRED BRANCH. The Worker already redirects or
-- refuses; these are the database's own last line. A restore window is
-- exempt so a backup can be replayed.
CREATE TRIGGER branch_inactive_stock_insert_guard BEFORE INSERT ON branch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND EXISTS (SELECT 1 FROM branches WHERE id = NEW.branch_id AND COALESCE(is_active, 1) = 0)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_inactive: stock cannot be added at a retired branch'); END;
CREATE TRIGGER branch_inactive_stock_update_guard BEFORE UPDATE OF quantity, branch_id ON branch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND (COALESCE(NEW.quantity, 0) > COALESCE(OLD.quantity, 0) OR NEW.branch_id IS NOT OLD.branch_id)
 AND EXISTS (SELECT 1 FROM branches WHERE id = NEW.branch_id AND COALESCE(is_active, 1) = 0)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_inactive: stock cannot be added at a retired branch'); END;
CREATE TRIGGER branch_inactive_lot_insert_guard BEFORE INSERT ON branch_batch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND EXISTS (SELECT 1 FROM branches WHERE id = NEW.branch_id AND COALESCE(is_active, 1) = 0)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_inactive: stock cannot be added at a retired branch'); END;
CREATE TRIGGER branch_inactive_lot_update_guard BEFORE UPDATE OF quantity, branch_id ON branch_batch_stock
WHEN COALESCE(NEW.quantity, 0) > 0
 AND (COALESCE(NEW.quantity, 0) > COALESCE(OLD.quantity, 0) OR NEW.branch_id IS NOT OLD.branch_id)
 AND EXISTS (SELECT 1 FROM branches WHERE id = NEW.branch_id AND COALESCE(is_active, 1) = 0)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_inactive: stock cannot be added at a retired branch'); END;
-- trg_legacy_inventory_effect_apply writes branch_stock/branch_batch_stock
-- by product+branch; a positive delta would be refused by the guards above,
-- a negative one would draw from rows that are now zero. Refuse both here
-- with a clear reason instead.
CREATE TRIGGER branch_inactive_legacy_effect_guard BEFORE INSERT ON legacy_inventory_effects
WHEN COALESCE(NEW.quantity_delta, 0) <> 0
 AND EXISTS (SELECT 1 FROM branches WHERE id = NEW.branch_id AND COALESCE(is_active, 1) = 0)
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT, 'branch_inactive: a legacy inventory effect cannot land at a retired branch'); END;

-- 10. CACHES. The D1 fallback rows; the KV copies are bumped by the first
-- product/sale write after the release (see the held README runbook).
INSERT INTO cache_versions(namespace, version) VALUES ('products', 2), ('sales', 2), ('returns', 2)
ON CONFLICT(namespace) DO UPDATE SET version = version + 1, updated_at = CURRENT_TIMESTAMP;

-- 11. POSTFLIGHT. Totals are conserved per product and per lot, Shop is
-- empty, the transfer record balances, and the branches are as decided.
CREATE TABLE _branch_consolidation_postflight (
  product_totals_changed INTEGER NOT NULL CONSTRAINT "postflight: a product's stock over Store+Shop changed" CHECK (product_totals_changed = 0),
  lot_totals_changed INTEGER NOT NULL CONSTRAINT "postflight: a lot's stock over Store+Shop changed" CHECK (lot_totals_changed = 0),
  rfid_totals_changed INTEGER NOT NULL CONSTRAINT "postflight: RFID-confirmed quantity over Store+Shop changed" CHECK (rfid_totals_changed = 0),
  shop_not_empty INTEGER NOT NULL CONSTRAINT "postflight: Shop still holds stock" CHECK (shop_not_empty = 0),
  members_unbalanced INTEGER NOT NULL CONSTRAINT "postflight: a transfer member's lots + untracked differ from its quantity" CHECK (members_unbalanced = 0),
  members_total_off INTEGER NOT NULL CONSTRAINT "postflight: the transfer total differs from Shop's stock" CHECK (members_total_off = 0),
  movements_unbalanced INTEGER NOT NULL CONSTRAINT "postflight: transfer_out and transfer_in totals differ from Shop's stock" CHECK (movements_unbalanced = 0),
  branches_not_as_decided INTEGER NOT NULL CONSTRAINT "postflight: branch rows are not Store(1, selling, default) + retired Shop(2 -> 1)" CHECK (branches_not_as_decided = 0)
);
INSERT INTO _branch_consolidation_postflight
SELECT
  (SELECT COUNT(*) FROM (
     SELECT product_id, SUM(COALESCE(quantity, 0)) AS q FROM _branch_consolidation_backup_branch_stock GROUP BY product_id
   ) b
   WHERE ABS(b.q - COALESCE((SELECT SUM(COALESCE(quantity, 0)) FROM branch_stock WHERE product_id = b.product_id AND branch_id IN (1, 2)), 0)) > 0.000000001)
  + (SELECT COUNT(*) FROM branch_stock n WHERE n.branch_id IN (1, 2) AND COALESCE(n.quantity, 0) <> 0
       AND NOT EXISTS (SELECT 1 FROM _branch_consolidation_backup_branch_stock b WHERE b.product_id = n.product_id)),
  (SELECT COUNT(*) FROM (
     SELECT batch_id, SUM(COALESCE(quantity, 0)) AS q FROM _branch_consolidation_backup_branch_batch_stock GROUP BY batch_id
   ) b
   WHERE ABS(b.q - COALESCE((SELECT SUM(COALESCE(quantity, 0)) FROM branch_batch_stock WHERE batch_id = b.batch_id AND branch_id IN (1, 2)), 0)) > 0.000000001)
  + (SELECT COUNT(*) FROM branch_batch_stock n WHERE n.branch_id IN (1, 2) AND COALESCE(n.quantity, 0) <> 0
       AND NOT EXISTS (SELECT 1 FROM _branch_consolidation_backup_branch_batch_stock b WHERE b.batch_id = n.batch_id)),
  (SELECT COUNT(*) FROM (
     SELECT product_id, SUM(COALESCE(rfid_confirmed_qty, 0)) AS q FROM _branch_consolidation_backup_branch_stock GROUP BY product_id
   ) b
   WHERE ABS(b.q - COALESCE((SELECT SUM(COALESCE(rfid_confirmed_qty, 0)) FROM branch_stock WHERE product_id = b.product_id AND branch_id IN (1, 2)), 0)) > 0.000000001),
  (SELECT COUNT(*) FROM branch_stock WHERE branch_id = 2 AND (COALESCE(quantity, 0) <> 0 OR COALESCE(rfid_confirmed_qty, 0) <> 0))
  + (SELECT COUNT(*) FROM branch_batch_stock WHERE branch_id = 2 AND COALESCE(quantity, 0) <> 0),
  (SELECT COUNT(*) FROM transfer_operation_members m
   WHERE m.receipt_id = (SELECT receipt_id FROM _branch_consolidation_run)
     AND ABS((SELECT COALESCE(SUM(json_extract(value, '$.quantity')), 0) FROM json_each(m.allocations_json)) + m.untracked_quantity - m.quantity) > 0.000000001),
  CASE WHEN ABS(
      COALESCE((SELECT SUM(quantity) FROM transfer_operation_members WHERE receipt_id = (SELECT receipt_id FROM _branch_consolidation_run)), 0)
      - COALESCE((SELECT SUM(quantity) FROM _branch_consolidation_backup_branch_stock WHERE branch_id = 2 AND quantity > 0), 0)) > 0.000000001
    THEN 1 ELSE 0 END,
  CASE WHEN ABS(COALESCE((SELECT SUM(quantity) FROM inventory_movements WHERE id > (SELECT movement_id_floor FROM _branch_consolidation_run)
                           AND reason = 'Branch consolidation: Shop moved into Store' AND movement_type = 'transfer_out'), 0)
             - COALESCE((SELECT SUM(quantity) FROM _branch_consolidation_backup_branch_stock WHERE branch_id = 2 AND quantity > 0), 0)) > 0.000000001
         OR ABS(COALESCE((SELECT SUM(quantity) FROM inventory_movements WHERE id > (SELECT movement_id_floor FROM _branch_consolidation_run)
                           AND reason = 'Branch consolidation: Shop moved into Store' AND movement_type = 'transfer_in'), 0)
             - COALESCE((SELECT SUM(quantity) FROM _branch_consolidation_backup_branch_stock WHERE branch_id = 2 AND quantity > 0), 0)) > 0.000000001
    THEN 1 ELSE 0 END,
  CASE WHEN EXISTS (SELECT 1 FROM branches WHERE id = 1 AND name = 'Store' AND role = 'shop' AND canonical_key = 'warehouse'
                    AND is_default = 1 AND COALESCE(is_active, 0) = 1 AND successor_branch_id IS NULL)
        AND EXISTS (SELECT 1 FROM branches WHERE id = 2 AND lower(trim(name)) = 'shop' AND COALESCE(is_active, 0) = 0
                    AND is_default = 0 AND successor_branch_id = 1)
        AND (SELECT COUNT(*) FROM branches WHERE is_default = 1) = 1
       THEN 0 ELSE 1 END;
