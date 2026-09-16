-- 0176: give the two replacement lines written before 4a2ce71b their
-- sale_item_batch_allocations row.
--
-- PREPARED FOR THE PROGRAM 10 CHECKPOINT B APPLY (announced in the status).
-- Append-only chain: 0175 is the prior migration. No lasting DDL.
--
-- ============================== WHY ======================================
-- Owner (2026-09-17): "if it is through the system, it needs to match
-- correctly, check all aspects." Audit of every system sale since Sep 4
-- (allocation rows vs line quantity, 'sale'/'return' movements vs line
-- quantity, branch_stock vs lot ledger vs products.stock_quantity): the
-- three ledgers agree everywhere (0 mismatches), the Not Paid gap is 0173,
-- and the only remaining gap is two completed lines that hold no
-- allocation row although their units left the shelf:
--
--   sale 16972 (20260910-105014) line 40431, product 5348, 1 unit, lot 56716
--     -- "line_replaced" amendment 2026-09-10 04:43Z (movement 46728)
--   sale 16927 (20260907-115705) line 40506, product 4684, 1 unit, lot 56575
--     -- "line_replaced" amendment 2026-09-12 05:22Z (movement 46836)
--
-- Before 4a2ce71b (2026-09-13) the replace amendment's add half did not
-- attach the replacement line's lot rows; since then the operation-member
-- writer (buildOperationAllocationStatements) does, and every later added
-- line in production carries its row. The other two pre-4a2ce71b replaces
-- need nothing: sale 16980 line 40441 already has its row (0173 syncs its
-- quantity), sale 16876 line 40216 never moved stock (cancelled Not Paid).
--
-- Effect: a later cancel/return of these two sales gives the unit back to
-- the lot it was drawn from instead of touching only branch_stock.
--
-- ============================== RULE =====================================
-- One row per line, exactly what the write should have produced: batch from
-- the line's own 'sale' movement, quantity = line quantity, released 0
-- (units are out with the completed sale), lot_code/expiry from the lot.
-- Guarded: the sale must be completed and stock-moving, the lot must belong
-- to the product, the movement must exist with that batch and quantity,
-- and no allocation row may exist yet. Re-run: no-op. Empty DB: no-op.
--
-- ============================== PRE-ASSERTION ============================
--   SELECT COUNT(*) FROM sale_item_batch_allocations WHERE sale_item_id IN (40431, 40506); -- 0
--   SELECT id, quantity, batch_id FROM inventory_movements WHERE id IN (46728, 46836); -- -1/56716, -1/56575
-- ============================== POST-ASSERTION ===========================
--   SELECT sale_item_id, batch_id, quantity, released_quantity FROM sale_item_batch_allocations
--   WHERE sale_item_id IN (40431, 40506); -- 40431/56716/1/0, 40506/56575/1/0
--   SELECT COUNT(*) FROM audit_logs WHERE action = 'repair_replacement_line_allocation'; -- 2
-- ============================== RECOVERY =================================
--   DELETE FROM sale_item_batch_allocations WHERE sale_item_id IN (40431, 40506)
--     AND id IN (SELECT CAST(record_id AS INTEGER) FROM audit_logs WHERE action = 'repair_replacement_line_allocation');

INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date, released_quantity, released_at)
SELECT si.id, pb.id, s.branch_id, si.quantity, pb.lot_code, pb.expiry_date, 0, NULL
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN product_batches pb ON pb.id = CASE si.id WHEN 40431 THEN 56716 WHEN 40506 THEN 56575 END
WHERE si.id IN (40431, 40506)
  AND si.sale_id = CASE si.id WHEN 40431 THEN 16972 ELSE 16927 END
  AND si.product_id = CASE si.id WHEN 40431 THEN 5348 ELSE 4684 END
  AND pb.variant_product_id = si.product_id
  AND s.sale_status = 'completed'
  AND COALESCE(s.stock_skipped, 0) = 0
  AND s.branch_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM inventory_movements m
    WHERE m.reference_id = s.id AND m.product_id = si.product_id AND m.movement_type = 'sale'
      AND m.batch_id = pb.id AND m.quantity = -si.quantity
  )
  AND NOT EXISTS (SELECT 1 FROM sale_item_batch_allocations a WHERE a.sale_item_id = si.id)
ORDER BY si.id;

INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value)
SELECT NULL, 'migration:0176_sale_replacement_line_allocation_repair', 'repair_replacement_line_allocation',
  'sale', CAST(a.sale_item_id AS TEXT),
  json_object('source', 'repair-0176', 'sale_item_id', a.sale_item_id, 'batch_id', a.batch_id, 'quantity', a.quantity),
  'sale_item_batch_allocations', CAST(a.id AS TEXT), NULL, json_object('quantity', a.quantity, 'released_quantity', 0)
FROM sale_item_batch_allocations a
WHERE a.sale_item_id IN (40431, 40506)
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs l
    WHERE l.action = 'repair_replacement_line_allocation' AND l.entity_id = CAST(a.sale_item_id AS TEXT)
  );
