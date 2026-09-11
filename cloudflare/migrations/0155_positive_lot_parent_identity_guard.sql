-- Complete 0154's parent protection: branch_batch_stock has no foreign key,
-- so deleting or renumbering a stocked parent would leave unselectable stock.
-- No rows are updated. Dates, costs, quantities and receipt identities remain.
-- Pre/postflight (must return no rows):
-- SELECT bbs.id, bbs.batch_id, bbs.branch_id, bbs.quantity
-- FROM branch_batch_stock bbs LEFT JOIN product_batches pb ON pb.id=bbs.batch_id
-- WHERE bbs.quantity>0 AND (pb.id IS NULL OR pb.is_active IS NOT 1);
-- Recovery: dropping these named triggers and the partial index restores the
-- previous policy; no data rollback is required. 0154 remains unchanged.
CREATE TRIGGER positive_lot_reject_parent_delete_0155
BEFORE DELETE ON product_batches
WHEN EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=OLD.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot delete a received lot with positive branch stock');
END;

-- With recursive_triggers disabled (SQLite's default), REPLACE's implicit
-- deletion does not run DELETE triggers. A BEFORE INSERT collision guard also
-- rejects legitimate UPSERT/IGNORE, so check the resulting invariant instead.
-- ABORT rolls back the entire replacing statement, including implicit deletes.
-- The partial index bounds these checks to positive stock and supplies batch_id
-- without visiting zero-stock history or fetching full stock rows.
CREATE INDEX idx_branch_batch_stock_positive_batch_0155
ON branch_batch_stock(batch_id) WHERE quantity>0;

CREATE TRIGGER positive_lot_reject_parent_insert_orphan_0155
AFTER INSERT ON product_batches
WHEN EXISTS (
  SELECT 1 FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
  WHERE bbs.quantity>0 AND NOT EXISTS (SELECT 1 FROM product_batches WHERE id=bbs.batch_id)
)
BEGIN
  SELECT RAISE(ABORT,'Cannot orphan positive branch stock by replacing a received lot');
END;

CREATE TRIGGER positive_lot_reject_parent_update_orphan_0155
AFTER UPDATE ON product_batches
WHEN (OLD.id IS NOT NEW.id OR OLD.variant_product_id IS NOT NEW.variant_product_id OR OLD.batch_key IS NOT NEW.batch_key)
 AND EXISTS (
  SELECT 1 FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155
  WHERE bbs.quantity>0 AND NOT EXISTS (SELECT 1 FROM product_batches WHERE id=bbs.batch_id)
)
BEGIN
  SELECT RAISE(ABORT,'Cannot orphan positive branch stock by replacing a received lot');
END;

CREATE TRIGGER positive_lot_reject_parent_id_update_0155
BEFORE UPDATE OF id ON product_batches
WHEN OLD.id!=NEW.id
 AND EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=OLD.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot change the identity of a received lot with positive branch stock');
END;
