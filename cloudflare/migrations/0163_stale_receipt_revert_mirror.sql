-- 0163: mirror the four pre-fix receipt reverts into their lots' supplier columns.
--
-- PREPARED, NOT APPLIED. Data-only; no DDL. Append-only chain (0162 is held by
-- another lane). Verified by scripts/verify-0163-stale-receipt-reverts.cjs,
-- which seeds these exact rows into a fresh local SQLite, runs this file,
-- compares the result with lib/productBatches.ts planUnreceiveBatchStock on an
-- identically seeded twin, and re-runs the file to prove it is a no-op.
--
-- Why: before p3/supplier (d3f8f06c) reverting a stock-in only moved units.
-- The lot kept its supplier, payment status and cumulative received figures,
-- so Contacts still counted the reverted receipt as a purchase (totals, the
-- stock-in invoice list, credit reminders). The kernel now calls
-- planUnreceiveBatchStock inside the revert batch. Production (SELECT-only
-- COUNT by the coordinator, 2026-09-14) holds exactly FOUR reverts written
-- before that fix: all `add` receipts with a supplier, all post-0067, found by
--   inventory_movements r JOIN inventory_movements o ON r.reference_id = 'revert:' || o.id
--   WHERE o.batch_id IS NOT NULL AND o.movement_type = 'add'
-- This file replays the helper's arithmetic for those four id pairs and
-- nothing else. There is no timestamp boundary: every statement is pinned to
-- the movement ids, the lot id and the lot's measured pre-state, so a re-run,
-- an already-mirrored row, a drifted row, or a fresh test database (ids
-- absent) all make every statement a no-op.
--
-- Arithmetic = planUnreceiveBatchStock with the parameters inlined:
--   received_quantity = MAX(0, received_quantity - qty)
--   received_cost_usd = MAX(0, ROUND(received_cost_usd - cost, 4))
--   at received_quantity 0: payment_status/credit_due_date NULL, money 0;
--   AND ONLY IF the lot holds no positive branch_batch_stock anywhere:
--   is_active 0, supplier_id/supplier_name/unit_cost_usd/received_branch_id NULL.
-- The emptiness test is the helper's own subquery, evaluated at apply time --
-- it is not assumed from the measured values.
-- `cost` is the reverted units at the lot's own average
-- (received_cost_usd / received_quantity), the coordinator's ruling for these
-- rows: 61035 1 x 2.6 = 2.6; 61156 3 x 37.5 = 112.5; 61187 and 61155 are
-- whole-lot reverts so the money goes to 0 regardless. The pre-assertion
-- below also prints each original movement's own total_cost_usd so the
-- applier can see whether it agrees before applying.
--
-- Measured pre-state (production, SELECT-only, 2026-09-14):
--   61035  received 19  cost 49.400000000000006  'j secrat'  paid  revert 46323 of 46317 qty 1
--   61187  received  3  cost 149.573577          'srey now'  paid  revert 46898 of 46890 qty 3
--   61155  received  3  cost 114                 'Lang'      paid  revert 46998 of 46680 qty 3
--   61156  received  4  cost 150                 'Lang'      paid  revert 47000 of 46691 qty 3
--
-- Expected post-state:
--   61035  received 18  cost 46.8   'j secrat' paid, unchanged otherwise
--   61156  received  1  cost 37.5   'Lang'     paid, unchanged otherwise
--   61187  received  0  cost 0      payment NULL; attribution cleared + inactive only if empty
--   61155  received  0  cost 0      payment NULL; attribution cleared + inactive only if empty
--
-- PRE-ASSERTION (run before applying; expect the four measured rows above,
-- all four pairs present, and zero rows already stamped by this migration):
--   SELECT pb.id, pb.received_quantity, ROUND(pb.received_cost_usd, 4) AS cost4,
--          pb.supplier_name, pb.payment_status, pb.is_active,
--          (SELECT COALESCE(SUM(quantity), 0) FROM branch_batch_stock WHERE batch_id = pb.id) AS lot_stock
--   FROM product_batches pb WHERE pb.id IN (61035, 61187, 61155, 61156) ORDER BY pb.id;
--   SELECT o.id, o.batch_id, o.movement_type, o.quantity, o.total_cost_usd, r.id AS revert_id
--   FROM inventory_movements o JOIN inventory_movements r ON r.reference_id = 'revert:' || o.id
--   WHERE o.id IN (46317, 46890, 46680, 46691) ORDER BY o.id;
--   SELECT COUNT(*) FROM audit_logs WHERE user_name = 'migration:0163_stale_receipt_revert_mirror';   -- 0
--
-- POST-ASSERTION (same first SELECT; expect 18/46.8, 0/0, 0/0, 1/37.5 in id
-- order 61035, 61155, 61156, 61187; payment_status NULL only on 61155 and
-- 61187; is_active 0 on those two only where lot_stock is 0):
--   SELECT COUNT(*) FROM audit_logs WHERE user_name = 'migration:0163_stale_receipt_revert_mirror';   -- 4
--
-- RECOVERY: each pair first writes one audit_logs row whose old_value is the
-- lot's full pre-image as it stood on the live database (json). Restore a lot
-- from that row rather than from the measured literals above:
--   UPDATE product_batches SET
--     received_quantity  = json_extract(a.old_value, '$.received_quantity'),
--     received_cost_usd  = json_extract(a.old_value, '$.received_cost_usd'),
--     payment_status     = json_extract(a.old_value, '$.payment_status'),
--     credit_due_date    = json_extract(a.old_value, '$.credit_due_date'),
--     supplier_id        = json_extract(a.old_value, '$.supplier_id'),
--     supplier_name      = json_extract(a.old_value, '$.supplier_name'),
--     unit_cost_usd      = json_extract(a.old_value, '$.unit_cost_usd'),
--     received_branch_id = json_extract(a.old_value, '$.received_branch_id'),
--     is_active          = json_extract(a.old_value, '$.is_active'),
--     updated_at         = CURRENT_TIMESTAMP
--   FROM audit_logs a
--   WHERE a.user_name = 'migration:0163_stale_receipt_revert_mirror' AND a.record_id = CAST(product_batches.id AS TEXT);
--   DELETE FROM audit_logs WHERE user_name = 'migration:0163_stale_receipt_revert_mirror';
-- Measured literals for a manual restore if the audit rows are gone:
--   UPDATE product_batches SET received_quantity = 19, received_cost_usd = 49.4, payment_status = 'paid', is_active = 1 WHERE id = 61035;
--   UPDATE product_batches SET received_quantity = 3, received_cost_usd = 149.573577, payment_status = 'paid', supplier_name = 'srey now', is_active = 1 WHERE id = 61187;
--   UPDATE product_batches SET received_quantity = 3, received_cost_usd = 114, payment_status = 'paid', supplier_name = 'Lang', is_active = 1 WHERE id = 61155;
--   UPDATE product_batches SET received_quantity = 4, received_cost_usd = 150, payment_status = 'paid', is_active = 1 WHERE id = 61156;
--   (supplier_id, unit_cost_usd, received_branch_id, credit_due_date of the two
--   zeroed lots were not measured; only the audit row restores them exactly.)
--
-- Coordinator defaults recorded for the lane's open design questions:
--   1. products-import restocks keep "No supplier recorded" (no guessing; owner ruling pending).
--   2. the stale pre-fix reverts are repaired by this migration, id-pinned.
--   3. reverting a revert restores units and money without supplier/payment (accepted for now).

-- ---------------------------------------------------------------- 61035 (46323 reverts 46317, qty 1)
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0163_stale_receipt_revert_mirror', 'stale_receipt_revert_mirror', 'product_batch', '61035',
       'product_batches', '61035',
       json_object('received_quantity', received_quantity, 'received_cost_usd', received_cost_usd,
                   'payment_status', payment_status, 'credit_due_date', credit_due_date,
                   'supplier_id', supplier_id, 'supplier_name', supplier_name, 'unit_cost_usd', unit_cost_usd,
                   'received_branch_id', received_branch_id, 'is_active', is_active),
       json_object('movement_id', 46317, 'revert_movement_id', 46323, 'quantity', 1, 'cost_usd', 2.6)
FROM product_batches
WHERE id = 61035 AND received_quantity = 19 AND ROUND(received_cost_usd, 4) = 49.4
  AND supplier_name = 'j secrat' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46317 AND batch_id = 61035 AND movement_type = 'add' AND ABS(quantity) = 1)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46323 AND reference_id = 'revert:46317');

UPDATE product_batches SET
  received_quantity = MAX(0, received_quantity - 1),
  received_cost_usd = MAX(0, ROUND(received_cost_usd - 2.6, 4)),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 61035 AND received_quantity = 19 AND ROUND(received_cost_usd, 4) = 49.4
  AND supplier_name = 'j secrat' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46317 AND batch_id = 61035 AND movement_type = 'add' AND ABS(quantity) = 1)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46323 AND reference_id = 'revert:46317');

-- ---------------------------------------------------------------- 61187 (46898 reverts 46890, qty 3, whole lot)
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0163_stale_receipt_revert_mirror', 'stale_receipt_revert_mirror', 'product_batch', '61187',
       'product_batches', '61187',
       json_object('received_quantity', received_quantity, 'received_cost_usd', received_cost_usd,
                   'payment_status', payment_status, 'credit_due_date', credit_due_date,
                   'supplier_id', supplier_id, 'supplier_name', supplier_name, 'unit_cost_usd', unit_cost_usd,
                   'received_branch_id', received_branch_id, 'is_active', is_active),
       json_object('movement_id', 46890, 'revert_movement_id', 46898, 'quantity', 3, 'cost_usd', ROUND(received_cost_usd, 4))
FROM product_batches
WHERE id = 61187 AND received_quantity = 3 AND ROUND(received_cost_usd, 4) = 149.5736
  AND supplier_name = 'srey now' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46890 AND batch_id = 61187 AND movement_type = 'add' AND ABS(quantity) = 3)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46898 AND reference_id = 'revert:46890');

UPDATE product_batches SET
  received_quantity = MAX(0, received_quantity - 3),
  received_cost_usd = 0,
  payment_status = NULL,
  credit_due_date = NULL,
  is_active = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61187 AND quantity > 0) THEN is_active ELSE 0 END,
  supplier_id = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61187 AND quantity > 0) THEN supplier_id ELSE NULL END,
  supplier_name = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61187 AND quantity > 0) THEN supplier_name ELSE NULL END,
  unit_cost_usd = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61187 AND quantity > 0) THEN unit_cost_usd ELSE NULL END,
  received_branch_id = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61187 AND quantity > 0) THEN received_branch_id ELSE NULL END,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 61187 AND received_quantity = 3 AND ROUND(received_cost_usd, 4) = 149.5736
  AND supplier_name = 'srey now' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46890 AND batch_id = 61187 AND movement_type = 'add' AND ABS(quantity) = 3)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46898 AND reference_id = 'revert:46890');

-- ---------------------------------------------------------------- 61155 (46998 reverts 46680, qty 3, whole lot)
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0163_stale_receipt_revert_mirror', 'stale_receipt_revert_mirror', 'product_batch', '61155',
       'product_batches', '61155',
       json_object('received_quantity', received_quantity, 'received_cost_usd', received_cost_usd,
                   'payment_status', payment_status, 'credit_due_date', credit_due_date,
                   'supplier_id', supplier_id, 'supplier_name', supplier_name, 'unit_cost_usd', unit_cost_usd,
                   'received_branch_id', received_branch_id, 'is_active', is_active),
       json_object('movement_id', 46680, 'revert_movement_id', 46998, 'quantity', 3, 'cost_usd', ROUND(received_cost_usd, 4))
FROM product_batches
WHERE id = 61155 AND received_quantity = 3 AND ROUND(received_cost_usd, 4) = 114
  AND supplier_name = 'Lang' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46680 AND batch_id = 61155 AND movement_type = 'add' AND ABS(quantity) = 3)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46998 AND reference_id = 'revert:46680');

UPDATE product_batches SET
  received_quantity = MAX(0, received_quantity - 3),
  received_cost_usd = 0,
  payment_status = NULL,
  credit_due_date = NULL,
  is_active = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61155 AND quantity > 0) THEN is_active ELSE 0 END,
  supplier_id = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61155 AND quantity > 0) THEN supplier_id ELSE NULL END,
  supplier_name = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61155 AND quantity > 0) THEN supplier_name ELSE NULL END,
  unit_cost_usd = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61155 AND quantity > 0) THEN unit_cost_usd ELSE NULL END,
  received_branch_id = CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = 61155 AND quantity > 0) THEN received_branch_id ELSE NULL END,
  updated_at = CURRENT_TIMESTAMP
WHERE id = 61155 AND received_quantity = 3 AND ROUND(received_cost_usd, 4) = 114
  AND supplier_name = 'Lang' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46680 AND batch_id = 61155 AND movement_type = 'add' AND ABS(quantity) = 3)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46998 AND reference_id = 'revert:46680');

-- ---------------------------------------------------------------- 61156 (47000 reverts 46691, qty 3 of 4)
INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, details)
SELECT NULL, 'migration:0163_stale_receipt_revert_mirror', 'stale_receipt_revert_mirror', 'product_batch', '61156',
       'product_batches', '61156',
       json_object('received_quantity', received_quantity, 'received_cost_usd', received_cost_usd,
                   'payment_status', payment_status, 'credit_due_date', credit_due_date,
                   'supplier_id', supplier_id, 'supplier_name', supplier_name, 'unit_cost_usd', unit_cost_usd,
                   'received_branch_id', received_branch_id, 'is_active', is_active),
       json_object('movement_id', 46691, 'revert_movement_id', 47000, 'quantity', 3, 'cost_usd', 112.5)
FROM product_batches
WHERE id = 61156 AND received_quantity = 4 AND ROUND(received_cost_usd, 4) = 150
  AND supplier_name = 'Lang' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46691 AND batch_id = 61156 AND movement_type = 'add' AND ABS(quantity) = 3)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 47000 AND reference_id = 'revert:46691');

UPDATE product_batches SET
  received_quantity = MAX(0, received_quantity - 3),
  received_cost_usd = MAX(0, ROUND(received_cost_usd - 112.5, 4)),
  updated_at = CURRENT_TIMESTAMP
WHERE id = 61156 AND received_quantity = 4 AND ROUND(received_cost_usd, 4) = 150
  AND supplier_name = 'Lang' AND payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 46691 AND batch_id = 61156 AND movement_type = 'add' AND ABS(quantity) = 3)
  AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = 47000 AND reference_id = 'revert:46691');
