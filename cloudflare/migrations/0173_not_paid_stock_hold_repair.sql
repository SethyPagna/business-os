-- 0173: deduct the stock that 21 "Not Paid" (awaiting_payment) sale lines
-- rung on 2026-09-04 never deducted, and mend one amended allocation.
--
-- PREPARED FOR THE PROGRAM 10 CHECKPOINT B APPLY (announced in the status
-- with the pre/post evidence below). Append-only chain: 0172 is the prior
-- migration. No DDL beyond this file's own work/guard tables. Owner message
-- F (2026-09-16, verbatim): "can you check the not paid if somme was not
-- deducted or so on. Be throrough, regarding data fix. make no mistake and
-- miss nothing."
--
-- ============================= WHY THIS EXISTS ===========================
-- Until commit 50d43de4 (S4-3, deployed 2026-09-04 between 07:41Z and
-- 11:56Z) a sale created as Not Paid allocated its lots and RELEASED them in
-- the same write (sale_item_batch_allocations.released_quantity = quantity,
-- released_at = created_at) and wrote no 'sale' inventory movement. The
-- pre-S4-3 completion path re-held the allocation and wrote the movement;
-- the S4-3 completion path treats awaiting_payment -> completed as a zero
-- stock delta because the hold already happened at creation. Every Not
-- Paid sale created by the OLD code and completed by the NEW code therefore
-- fell through both paths: the sale is completed, its lines are priced and
-- reported, but no lot, branch or product quantity ever moved. The Sep 4
-- audit (all of sales 16834-16888, plus Sep 1-3) found exactly 21 such
-- lines / 26 units, all at branch 2 (Shop), cashier Rath:
--
--   sale_item  sale   product  qty  allocation  lot(alloc)  lot(deduct)
--   40124      16836  4276     1    8           51291       51291
--   40125      16837  4696     1    9           52847       52847
--   40126      16838  2578     1    10          52202       52202
--   40127      16839  3326     1    11          52413       52413
--   40128      16839  7892     1    12          52222       52222
--   40129      16839  2578     1    13          52202       52202
--   40130      16839  7878     1    14          52209       52209
--   40131      16839  4181     1    15          52725       52725
--   40202      16870  5210     1    30          51430       51430
--   40203      16871  9162     4    31          54851       54851
--   40204      16871  4267     3    32          54838       54838
--   40226      16881  5131     1    53          55191       55191
--   40245      16885  4774     1    72          55016       55016
--   40246      16885  9456     1    73          55009       55009
--   40247      16885  6706     1    74          53477       53477
--   40248      16885  6796     1    75          53577       61114  (*)
--   40249      16885  7157     1    76          51909       51909
--   40250      16886  9092     1    77          52753       52753
--   40251      16886  4232     1    78          52757       52757
--   40252      16886  4230     1    79          52755       52755
--   40256      16888  5882     1    83          55889       55889
--
-- (*) lot 53577 (product 6796) is empty at branch 2 today; the only shop
--     lot with stock is 61114 (received 08/09/2026, same 43.00 cost), so
--     the unit is taken from 61114 and allocation 75 is re-pointed to it.
--     sale_items.batch_id/batch_label keep the receipt-time lot label.
--
-- Also noted for the owner, NOT acted on here: product 4276's RECON lot
-- 51291 says received 44 while 43 are on hand across both branches with no
-- movement explaining the missing unit; the Sep 2 reconciliation split is
-- not recoverable from data. Line 40124 is still deducted (that sale was
-- completed and delivered).
--
-- Cancelled Not Paid sales of the same window (16834, 16835, 16876) need
-- nothing: cancellation released nothing that was held.
--
-- Separately, sale 16980 (awaiting_payment) line 40441 was amended
-- "Quantity increased" 1 -> 2: the ledgers moved 2 units (movements -2,
-- lots -2) but sale_item_batch_allocations row 264 still says quantity 1.
-- A later cancel/return would release one unit and strand the other. The
-- allocation is set to 2 here; the code defect is fixed on its own lane.
--
-- ============================== RULE =====================================
-- Mirrors lib/saleNotPaidStockRecovery.ts (the reviewed Sep 5 recovery for
-- sales 16952-16954) line for line: per line, the allocation becomes a live
-- hold (released_quantity 0, released_at NULL), branch_batch_stock,
-- branch_stock and products.stock_quantity each drop by the line quantity,
-- and one 'sale' inventory movement is written with the line's cost,
-- reason 'Awaiting payment stock hold correction', reference_id = sale id.
-- Provenance: one undo_snapshots row carrying every before-value, one
-- action_history row per sale (entity sale_not_paid_stock_recovery,
-- reversible 0, status recorded) and one audit_logs row per sale (action
-- correct_awaiting_payment_stock_hold), all attributed to
-- 'migration:0173_not_paid_stock_hold_repair'.
--
-- ============================== IDEMPOTENCE ==============================
-- The work table is filled with INSERT OR IGNORE from a scan that requires
-- the allocation to still be fully released AND no 'sale' movement for the
-- (sale, product) pair to exist; after the first run both conditions are
-- false for every line, and rows already marked applied = 1 drive nothing.
-- On a database without these sales (a test fixture) every statement is a
-- no-op and the guard rows evaluate to ok = 1 on empty sets.
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT COUNT(*) FROM sale_item_batch_allocations a JOIN sale_items si ON si.id=a.sale_item_id
--   JOIN sales s ON s.id=si.sale_id
--   WHERE si.id IN (40124,40125,40126,40127,40128,40129,40130,40131,40202,40203,40204,40226,
--                   40245,40246,40247,40248,40249,40250,40251,40252,40256)
--     AND s.sale_status='completed' AND a.released_quantity=a.quantity AND a.released_at IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.reference_id=s.id AND m.product_id=si.product_id AND m.movement_type='sale');
--   -- expect 21
--   SELECT quantity FROM branch_batch_stock WHERE batch_id=61114 AND branch_id=2;  -- expect 5
--   SELECT quantity, released_quantity FROM sale_item_batch_allocations WHERE id=264; -- expect 1, 0
--   SELECT COUNT(*) FROM audit_logs WHERE user_name='migration:0173_not_paid_stock_hold_repair'; -- expect 0
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM sale_not_paid_repair_0173 WHERE applied=1; -- 21
--   SELECT COUNT(*) FROM inventory_movements WHERE user_name='migration:0173_not_paid_stock_hold_repair' AND movement_type='sale'; -- 21
--   SELECT SUM(quantity) FROM inventory_movements WHERE user_name='migration:0173_not_paid_stock_hold_repair'; -- -26
--   SELECT COUNT(*) FROM sale_item_batch_allocations WHERE id IN (SELECT allocation_id FROM sale_not_paid_repair_0173) AND released_quantity<>0; -- 0
--   SELECT batch_id FROM sale_item_batch_allocations WHERE id=75; -- 61114
--   SELECT quantity FROM branch_batch_stock WHERE batch_id=61114 AND branch_id=2; -- 4
--   SELECT quantity FROM sale_item_batch_allocations WHERE id=264; -- 2
--   SELECT COUNT(*) FROM action_history WHERE entity='sale_not_paid_stock_recovery' AND created_by_name='migration:0173_not_paid_stock_hold_repair'; -- 10 (one per sale)
--   -- ledgers still agree for every touched product:
--   SELECT COUNT(*) FROM products p WHERE p.id IN (SELECT product_id FROM sale_not_paid_repair_0173)
--     AND p.stock_quantity <> (SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=p.id); -- 0
--
-- ============================== RECOVERY =================================
-- Every before-value (lot, branch and product quantity, allocation batch)
-- is in sale_not_paid_repair_0173 and duplicated into the undo_snapshots
-- row of kind 'sale.not_paid_stock_hold_repair' (source 'repair-0173').
-- To reverse one line: add quantity back to branch_batch_stock
-- (deduct_batch_id, branch_id), branch_stock (product_id, branch_id) and
-- products.stock_quantity; set the allocation back to released_quantity =
-- quantity, released_at = created_at, batch_id = allocation_batch_id; and
-- delete the movement with user_name = 'migration:0173_not_paid_stock_hold_repair'
-- and reference_id = sale_id and product_id = product_id. Allocation 264:
-- UPDATE sale_item_batch_allocations SET quantity=1 WHERE id=264.

CREATE TABLE IF NOT EXISTS sale_not_paid_repair_0173 (
  sale_item_id INTEGER PRIMARY KEY,
  allocation_id INTEGER NOT NULL,
  sale_id INTEGER NOT NULL,
  receipt_number TEXT,
  product_id INTEGER NOT NULL,
  product_name TEXT,
  branch_id INTEGER NOT NULL,
  allocation_batch_id INTEGER NOT NULL,
  deduct_batch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_cost_usd REAL NOT NULL DEFAULT 0,
  batch_before REAL,
  branch_before REAL,
  product_before REAL,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

INSERT OR IGNORE INTO sale_not_paid_repair_0173 (
  sale_item_id, allocation_id, sale_id, receipt_number, product_id, product_name, branch_id,
  allocation_batch_id, deduct_batch_id, quantity, unit_cost_usd,
  batch_before, branch_before, product_before
)
SELECT
  si.id, a.id, s.id, s.receipt_number, si.product_id, si.product_name, s.branch_id,
  a.batch_id,
  CASE WHEN si.id = 40248 AND a.batch_id = 53577 THEN 61114 ELSE a.batch_id END,
  si.quantity, COALESCE(si.cost_price_usd, 0),
  (SELECT b.quantity FROM branch_batch_stock b
     WHERE b.batch_id = CASE WHEN si.id = 40248 AND a.batch_id = 53577 THEN 61114 ELSE a.batch_id END
       AND b.branch_id = s.branch_id),
  (SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id = si.product_id AND bs.branch_id = s.branch_id),
  (SELECT p.stock_quantity FROM products p WHERE p.id = si.product_id)
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN sale_item_batch_allocations a ON a.sale_item_id = si.id
WHERE si.id IN (40124,40125,40126,40127,40128,40129,40130,40131,40202,40203,40204,40226,
                40245,40246,40247,40248,40249,40250,40251,40252,40256)
  AND s.sale_status = 'completed'
  AND COALESCE(s.stock_skipped, 0) = 0
  AND s.branch_id = 2
  AND (a.branch_id IS NULL OR a.branch_id = s.branch_id)
  AND a.quantity = si.quantity
  AND a.released_quantity = a.quantity
  AND a.released_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM inventory_movements m
    WHERE m.reference_id = s.id AND m.product_id = si.product_id AND m.movement_type = 'sale'
  );

-- Guards: every check must be 1 or the CHECK constraint aborts the file
-- before any stock row is written.
CREATE TABLE IF NOT EXISTS sale_not_paid_repair_guard_0173 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM sale_not_paid_repair_guard_0173;
-- exactly the audited set, or nothing (fixture / second run)
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'pending_count_is_0_or_21', CASE WHEN
  (SELECT COUNT(*) FROM sale_not_paid_repair_0173 WHERE applied = 0) IN (0, 21) THEN 1 ELSE 0 END;
-- every deduct lot belongs to the line's product and is active
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'deduct_lots_belong_and_active', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_not_paid_repair_0173 r
  LEFT JOIN product_batches pb ON pb.id = r.deduct_batch_id
  WHERE r.applied = 0 AND (pb.id IS NULL OR pb.variant_product_id <> r.product_id OR COALESCE(pb.is_active, 0) <> 1)
) THEN 1 ELSE 0 END;
-- lot, branch and product quantities can absorb the deduction
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'lot_stock_sufficient', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_not_paid_repair_0173 r
  WHERE r.applied = 0
  GROUP BY r.deduct_batch_id, r.branch_id
  HAVING SUM(r.quantity) > COALESCE((SELECT b.quantity FROM branch_batch_stock b
    WHERE b.batch_id = r.deduct_batch_id AND b.branch_id = r.branch_id), 0)
) THEN 1 ELSE 0 END;
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'branch_stock_sufficient', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_not_paid_repair_0173 r
  WHERE r.applied = 0
  GROUP BY r.product_id, r.branch_id
  HAVING SUM(r.quantity) > COALESCE((SELECT bs.quantity FROM branch_stock bs
    WHERE bs.product_id = r.product_id AND bs.branch_id = r.branch_id), 0)
) THEN 1 ELSE 0 END;
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'product_stock_sufficient', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_not_paid_repair_0173 r
  WHERE r.applied = 0
  GROUP BY r.product_id
  HAVING SUM(r.quantity) > COALESCE((SELECT p.stock_quantity FROM products p WHERE p.id = r.product_id), 0)
) THEN 1 ELSE 0 END;

-- Provenance first (before-values), so the snapshot describes the state
-- the writes below start from.
INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
SELECT
  'sale.not_paid_stock_hold_repair', 'applied',
  json_object(
    'source', 'repair-0173',
    'correction', 'awaiting_payment_holds_stock',
    'lines', json_group_array(json_object(
      'sale_item_id', r.sale_item_id, 'allocation_id', r.allocation_id, 'sale_id', r.sale_id,
      'receipt_number', r.receipt_number, 'product_id', r.product_id, 'branch_id', r.branch_id,
      'allocation_batch_id', r.allocation_batch_id, 'deduct_batch_id', r.deduct_batch_id,
      'quantity', r.quantity, 'unit_cost_usd', r.unit_cost_usd,
      'batch_before', r.batch_before, 'branch_before', r.branch_before, 'product_before', r.product_before))
  ),
  NULL, 'migration:0173_not_paid_stock_hold_repair'
FROM sale_not_paid_repair_0173 r
WHERE r.applied = 0
GROUP BY r.applied;

-- Lot ledger.
UPDATE branch_batch_stock SET
  quantity = quantity - (SELECT SUM(r.quantity) FROM sale_not_paid_repair_0173 r
    WHERE r.applied = 0 AND r.deduct_batch_id = branch_batch_stock.batch_id AND r.branch_id = branch_batch_stock.branch_id),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM sale_not_paid_repair_0173 r
  WHERE r.applied = 0 AND r.deduct_batch_id = branch_batch_stock.batch_id AND r.branch_id = branch_batch_stock.branch_id);

-- Branch ledger.
UPDATE branch_stock SET
  quantity = quantity - (SELECT SUM(r.quantity) FROM sale_not_paid_repair_0173 r
    WHERE r.applied = 0 AND r.product_id = branch_stock.product_id AND r.branch_id = branch_stock.branch_id)
WHERE EXISTS (SELECT 1 FROM sale_not_paid_repair_0173 r
  WHERE r.applied = 0 AND r.product_id = branch_stock.product_id AND r.branch_id = branch_stock.branch_id);

-- Product total.
UPDATE products SET
  stock_quantity = stock_quantity - (SELECT SUM(r.quantity) FROM sale_not_paid_repair_0173 r
    WHERE r.applied = 0 AND r.product_id = products.id),
  updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM sale_not_paid_repair_0173 r WHERE r.applied = 0 AND r.product_id = products.id);

-- The allocation becomes a live hold on the lot the unit actually came from.
UPDATE sale_item_batch_allocations SET
  released_quantity = 0,
  released_at = NULL,
  batch_id = (SELECT r.deduct_batch_id FROM sale_not_paid_repair_0173 r WHERE r.allocation_id = sale_item_batch_allocations.id AND r.applied = 0),
  lot_code = COALESCE((SELECT pb.lot_code FROM product_batches pb
    JOIN sale_not_paid_repair_0173 r ON r.deduct_batch_id = pb.id
    WHERE r.allocation_id = sale_item_batch_allocations.id AND r.applied = 0), lot_code)
WHERE id IN (SELECT r.allocation_id FROM sale_not_paid_repair_0173 r WHERE r.applied = 0);

-- One 'sale' movement per line, same shape as the Sep 5 recovery.
INSERT INTO inventory_movements (
  product_id, product_name, branch_id, branch_name, movement_type, quantity,
  unit_cost_usd, unit_cost_khr, reason, reference_id, user_id, user_name, batch_id
)
SELECT
  r.product_id, r.product_name, r.branch_id, (SELECT b.name FROM branches b WHERE b.id = r.branch_id),
  'sale', -r.quantity, r.unit_cost_usd, 0,
  'Awaiting payment stock hold correction (Not Paid sale rung before S4-3, migration 0173)',
  r.sale_id, NULL, 'migration:0173_not_paid_stock_hold_repair', r.deduct_batch_id
FROM sale_not_paid_repair_0173 r
WHERE r.applied = 0
ORDER BY r.sale_item_id;

-- One action_history row per sale (not undoable; provenance in redo_payload).
INSERT INTO action_history (scope, entity, entity_id, label, reversible, status, undo_payload, redo_payload, created_by_id, created_by_name)
SELECT
  'global', 'sale_not_paid_stock_recovery', CAST(r.sale_id AS TEXT),
  'Correct Not Paid stock hold for sale ' || COALESCE(r.receipt_number, CAST(r.sale_id AS TEXT)),
  0, 'recorded', '{}',
  json_object(
    'kind', 'sale_stock_corrected', 'source', 'migration:0173_not_paid_stock_hold_repair',
    'correction', 'awaiting_payment_holds_stock',
    'stock_effect_before', 'released_allocation_only', 'stock_effect_after', 'deducted_now',
    'sale_id', r.sale_id, 'held_units_before', 0, 'held_units_after', SUM(r.quantity),
    'sale_item_ids', json_group_array(r.sale_item_id), 'reversible', json('false')
  ),
  NULL, 'migration:0173_not_paid_stock_hold_repair'
FROM sale_not_paid_repair_0173 r
WHERE r.applied = 0
GROUP BY r.sale_id, r.receipt_number;

-- One audit_logs row per sale.
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT
  NULL, 'migration:0173_not_paid_stock_hold_repair', 'correct_awaiting_payment_stock_hold', 'sale', CAST(r.sale_id AS TEXT),
  json_object('source', 'repair-0173', 'sale_item_ids', json_group_array(r.sale_item_id), 'units', SUM(r.quantity)),
  'sales', CAST(r.sale_id AS TEXT),
  json_object('held_units', 0, 'stock_effect', 'released_allocation_only'),
  json_object('held_units', SUM(r.quantity), 'stock_effect', 'deducted_now')
FROM sale_not_paid_repair_0173 r
WHERE r.applied = 0
GROUP BY r.sale_id;

UPDATE sale_not_paid_repair_0173 SET applied = 1, applied_at = CURRENT_TIMESTAMP WHERE applied = 0;

-- Post-guard: the ledgers still agree for every touched product.
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'ledgers_agree_after', CASE WHEN NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.id IN (SELECT product_id FROM sale_not_paid_repair_0173)
    AND ABS(p.stock_quantity - (SELECT COALESCE(SUM(bs.quantity), 0) FROM branch_stock bs WHERE bs.product_id = p.id)) > 0.0001
) THEN 1 ELSE 0 END;
INSERT INTO sale_not_paid_repair_guard_0173 (check_name, ok)
SELECT 'no_released_allocation_remains', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sale_item_batch_allocations a
  WHERE a.id IN (SELECT allocation_id FROM sale_not_paid_repair_0173) AND (a.released_quantity <> 0 OR a.released_at IS NOT NULL)
) THEN 1 ELSE 0 END;

-- Sale 16980 line 40441: the amended quantity (2) is what the ledgers moved;
-- the allocation row must say the same. Guarded on every fact the audit saw.
UPDATE sale_item_batch_allocations SET quantity = 2
WHERE id = 264 AND sale_item_id = 40441 AND batch_id = 55971
  AND quantity = 1 AND released_quantity = 0 AND released_at IS NULL
  AND (SELECT si.quantity FROM sale_items si WHERE si.id = 40441 AND si.product_id = 5987) = 2
  AND (SELECT COALESCE(SUM(-m.quantity), 0) FROM inventory_movements m
       WHERE m.reference_id = 16980 AND m.product_id = 5987 AND m.movement_type = 'sale') = 2;
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT NULL, 'migration:0173_not_paid_stock_hold_repair', 'sync_amended_allocation_quantity', 'sale', '16980',
  json_object('source', 'repair-0173', 'sale_item_id', 40441, 'allocation_id', 264, 'reason', 'Quantity increased 1->2 moved 2 units but left the allocation at 1'),
  'sale_item_batch_allocations', '264', json_object('quantity', 1), json_object('quantity', 2)
WHERE EXISTS (SELECT 1 FROM sale_item_batch_allocations WHERE id = 264 AND sale_item_id = 40441 AND quantity = 2)
  AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE user_name = 'migration:0173_not_paid_stock_hold_repair' AND action = 'sync_amended_allocation_quantity');

DROP TABLE IF EXISTS sale_not_paid_repair_guard_0173;
