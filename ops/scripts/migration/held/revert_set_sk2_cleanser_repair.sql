-- REVERT-SET repair (6 Oct 2026): SK-II Gentle Cleanser 20g (product 5357, Shop = branch 2).
--
-- ============================== HELD =====================================
-- Kept in ops/scripts/migration/held/, OUTSIDE cloudflare/migrations, so no
-- deploy applies it. Applying it is the owner's decision (production write).
-- PREFERRED instead of this file: the same two records made in the app,
-- which works on the live build (proven by test-stock-lot-adjustment-pure.cjs
-- "screenshot repair in the app", green on the pre-REVERT-SET source too):
--   1. Stock Changes -> row #48197 ("Revert", -30) -> Revert    (60 at Shop)
--   2. Stock Changes -> row #48034 (+27, the Set)  -> Revert    (33 at Shop)
-- in THAT order (on the live build the Set's Undo needs Shop at 60 again).
-- Do it BEFORE the Shop -> LC Store consolidation moves this stock.
--
-- ============================== WHAT HAPPENED ============================
--   #36930 2025-10-05 add 3 (import, no lot)
--   #48026 2026-09-29 add 30 on lot 61482 (received 2026-09-29, Dane japan,
--          $7, $210 paid)                                        Shop 3 -> 33
--   #48034 2026-09-30 lot Set on lot 56725 (received 2026-09-02) 3 -> 30, +27,
--          "wrong stock"; op c7b78789-d9ec-45fa-ace6-8bb6612c290a, History 1318
--                                                                Shop 33 -> 60
--   #48197 2026-10-01 ledger Revert of #48026: -30 on lot 61482, un-received
--          (0 / $0, inactive)                                    Shop 60 -> 30
-- The owner meant to revert the Set (+27) and expected 33. Census
-- (ops/queries/revert-set-census.sql, run 37424352332): 8 reverts in
-- production, 0 arithmetic defects, this the only one reverting a receipt
-- while a later Set on the same product and branch stayed applied.
--
-- ============================== WHAT THIS WRITES =========================
-- Two compensating records, exactly as the app writes them (owner, 30 Sep /
-- 1 Oct 2026: Revert = an official compensating record; history is never
-- rewritten or deleted):
--   A. Revert of #48197: movement 'add' 30 on lot 61482, reference
--      'revert:48197'; the lot is received again (30 / $210, active); its
--      supplier and payment state were kept on the lot by the first Revert.
--   B. Undo of Set #48034: movement 'remove' 27 on lot 56725, reference
--      'revert:48034'; the Set's operation goes to generation 1 'reversed'
--      and History 1318 to 'redoable' (so Redo there re-applies +27).
--   Net: lot 56725 30 -> 3, lot 61482 0 -> 30, Shop 30 -> 33, product 30 -> 33.
--   Catalog cost follows by the 0195 on-hand triggers (both lots cost $7:
--   stays $7.0000). Supplier "Dane japan" purchases regain the $210 delivery.
--   One audit_logs row 'stock_revert_repair'.
--
-- ============================== GUARDS ===================================
-- Statement 1 aborts the whole file (stock_session_guards CHECK) unless
-- production is EXACTLY the observed state (PRE) or already repaired (both
-- revert:48197 and revert:48034 exist, whoever wrote them -- e.g. the owner
-- did it in the app). PRE includes "no newer movement of the product than
-- #48197": a sale or any change since makes this plan stale; re-plan.
-- Idempotent: a re-run after success, or after the in-app repair, writes
-- nothing. The last guard asserts the POST state when this run applied.
--
-- ============================== BACKUP / RECOVERY ========================
-- revert_set_repair_20261006 keeps a JSON copy of every row this run changes
-- (key 'backup:<table>:<id>') and 'applied_at'. To take the repair back,
-- use the app, never SQL: Stock Changes -> the new 'revert:48197' row ->
-- Revert (takes the 30 back off lot 61482 again), and History 1318 -> Redo
-- (re-applies the Set's +27). Both are compensating records like this one.
--
-- ============================== DRY RUN ==================================
-- ops/queries/revert-set-repair-dryrun.sql (read-only, d1-export) prints
-- pre_state_ok / already_repaired and every row's current -> planned value.
-- LF-only (test-held-revert-set-repair-pure.cjs checks it).

INSERT INTO stock_session_guards (guard_value)
SELECT CASE WHEN (
    COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = 56725 AND branch_id = 2), -1) = 30
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = 61482 AND branch_id = 2), -1) = 0
    AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id = 5357 AND branch_id = 2), -1) = 30
    AND COALESCE((SELECT stock_quantity FROM products WHERE id = 5357), -1) = 30
    AND COALESCE((SELECT received_quantity FROM product_batches WHERE id = 61482 AND variant_product_id = 5357), -1) = 0
    AND (SELECT variant_product_id FROM product_batches WHERE id = 56725) = 5357
    AND (SELECT generation FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') = 0
    AND (SELECT state FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') = 'applied'
    AND (SELECT status FROM action_history WHERE id = 1318) = 'undoable'
    AND (SELECT MAX(id) FROM inventory_movements WHERE product_id = 5357) = 48197
    AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id IN ('revert:48197', 'revert:48034'))
  ) OR (
    EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id = 'revert:48197')
    AND EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id = 'revert:48034')
  ) THEN 1 ELSE 0 END;

CREATE TABLE IF NOT EXISTS revert_set_repair_20261006 (
  key TEXT PRIMARY KEY,
  value TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DELETE FROM revert_set_repair_20261006 WHERE key = 'apply_now';

INSERT INTO revert_set_repair_20261006 (key, value)
SELECT 'apply_now', '1'
WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id IN ('revert:48197', 'revert:48034'));

INSERT OR REPLACE INTO revert_set_repair_20261006 (key, value)
SELECT 'backup:products:5357', json_object('id', id, 'stock_quantity', stock_quantity, 'cost_price_usd', cost_price_usd, 'purchase_price_usd', purchase_price_usd, 'updated_at', updated_at)
FROM products WHERE id = 5357 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT OR REPLACE INTO revert_set_repair_20261006 (key, value)
SELECT 'backup:branch_stock:5357:2', json_object('product_id', product_id, 'branch_id', branch_id, 'quantity', quantity)
FROM branch_stock WHERE product_id = 5357 AND branch_id = 2 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT OR REPLACE INTO revert_set_repair_20261006 (key, value)
SELECT 'backup:branch_batch_stock:' || batch_id || ':2', json_object('batch_id', batch_id, 'branch_id', branch_id, 'quantity', quantity, 'updated_at', updated_at)
FROM branch_batch_stock WHERE batch_id IN (56725, 61482) AND branch_id = 2 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT OR REPLACE INTO revert_set_repair_20261006 (key, value)
SELECT 'backup:product_batches:' || id, json_object('id', id, 'is_active', is_active, 'received_quantity', received_quantity, 'received_cost_usd', received_cost_usd,
  'supplier_id', supplier_id, 'supplier_name', supplier_name, 'payment_status', payment_status, 'updated_at', updated_at)
FROM product_batches WHERE id IN (56725, 61482) AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT OR REPLACE INTO revert_set_repair_20261006 (key, value)
SELECT 'backup:stock_lot_adjustment_operations:' || id, json_object('id', id, 'generation', generation, 'state', state, 'revision_json', revision_json)
FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a' AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT OR REPLACE INTO revert_set_repair_20261006 (key, value)
SELECT 'backup:action_history:1318', json_object('id', id, 'status', status, 'last_error', last_error, 'undo_payload', undo_payload, 'redo_payload', redo_payload, 'updated_at', updated_at)
FROM action_history WHERE id = 1318 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
  unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id)
SELECT product_id, product_name, branch_id, branch_name, 'add', 30,
  unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, 'Revert of #48197: ' || COALESCE(reason, ''), 'revert:48197', NULL, 'REVERT-SET repair', CURRENT_TIMESTAMP, 61482
FROM inventory_movements WHERE id = 48197 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE product_batches SET is_active = 1, received_quantity = COALESCE(received_quantity, 0) + 30,
  received_cost_usd = ROUND(COALESCE(received_cost_usd, 0) + 210, 4), updated_at = CURRENT_TIMESTAMP
WHERE id = 61482 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE branch_batch_stock SET quantity = quantity + 30, updated_at = datetime('now')
WHERE batch_id = 61482 AND branch_id = 2 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE branch_stock SET quantity = quantity + 30
WHERE product_id = 5357 AND branch_id = 2 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + 30, updated_at = CURRENT_TIMESTAMP
WHERE id = 5357 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
  unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id)
SELECT product_id, product_name, branch_id, branch_name, 'remove', 27,
  unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, 'Undo: wrong stock (Set received 2026-09-02 from 3 to 30)', 'revert:48034', NULL, 'REVERT-SET repair', CURRENT_TIMESTAMP, 56725
FROM inventory_movements WHERE id = 48034 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE branch_batch_stock SET quantity = quantity - 27, updated_at = datetime('now')
WHERE batch_id = 56725 AND branch_id = 2 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE branch_stock SET quantity = quantity - 27
WHERE product_id = 5357 AND branch_id = 2 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - 27, updated_at = CURRENT_TIMESTAMP
WHERE id = 5357 AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE stock_lot_adjustment_operations SET generation = 1, state = 'reversed', revision_json = json_set(revision_json, '$.generation', 1)
WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a' AND generation = 0 AND state = 'applied'
  AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

UPDATE action_history SET status = 'redoable', last_error = NULL, updated_at = CURRENT_TIMESTAMP,
  undo_payload = json_set(undo_payload, '$.generation', 1), redo_payload = json_set(redo_payload, '$.generation', 1)
WHERE id = 1318 AND status = 'undoable' AND EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
SELECT NULL, 'REVERT-SET repair', 'stock_revert_repair', 'product', '5357',
  json_object('reverted', json_array(48197, 48034), 'lots', json_object('56725', -27, '61482', 30), 'branchId', 2, 'shop', json_array(30, 33),
    'why', 'Owner meant to revert the Set +27 (#48034) on 1 Oct; the Revert went to the delivery #48026 instead.')
WHERE EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT OR IGNORE INTO revert_set_repair_20261006 (key, value)
SELECT 'applied_at', CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now');

INSERT INTO stock_session_guards (guard_value)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM revert_set_repair_20261006 WHERE key = 'apply_now') THEN CASE WHEN
    (SELECT quantity FROM branch_batch_stock WHERE batch_id = 56725 AND branch_id = 2) = 3
    AND (SELECT quantity FROM branch_batch_stock WHERE batch_id = 61482 AND branch_id = 2) = 30
    AND (SELECT quantity FROM branch_stock WHERE product_id = 5357 AND branch_id = 2) = 33
    AND (SELECT stock_quantity FROM products WHERE id = 5357) = 33
    AND (SELECT received_quantity FROM product_batches WHERE id = 61482) = 30
    AND (SELECT received_cost_usd FROM product_batches WHERE id = 61482) = 210
    AND (SELECT is_active FROM product_batches WHERE id = 61482) = 1
    AND (SELECT generation FROM stock_lot_adjustment_operations WHERE id = 'c7b78789-d9ec-45fa-ace6-8bb6612c290a') = 1
    AND (SELECT status FROM action_history WHERE id = 1318) = 'redoable'
    AND (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ('revert:48197', 'revert:48034')) = 2
    THEN 1 ELSE 0 END
  ELSE CASE WHEN (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ('revert:48197', 'revert:48034')) = 2 THEN 1 ELSE 0 END
  END;

DELETE FROM revert_set_repair_20261006 WHERE key = 'apply_now';

DELETE FROM stock_session_guards;
