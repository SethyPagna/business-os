-- Positive stock must always belong to an active, selectable received lot.
-- Preflight (must return no rows immediately before applying):
-- SELECT bbs.id, bbs.batch_id, bbs.branch_id, bbs.quantity, pb.is_active
-- FROM branch_batch_stock bbs LEFT JOIN product_batches pb ON pb.id=bbs.batch_id
-- WHERE bbs.quantity>0 AND (pb.id IS NULL OR pb.is_active IS NOT 1);
-- Existing violations require evidence-led repair; this migration never guesses
-- whether historical hidden stock was intentional. Production census was zero.
-- D1 applies the migration transactionally. No explicit transaction statements.
-- Recovery: removing these named triggers restores the previous write policy;
-- no dates, costs, quantities, allocations or receipt identities are rewritten.
CREATE TABLE _positive_lot_activation_preflight_0154 (
  violations INTEGER NOT NULL,
  CONSTRAINT "0154_existing_positive_lots_require_active_parent_preflight"
    CHECK (violations=0)
);
INSERT INTO _positive_lot_activation_preflight_0154 (violations)
SELECT COUNT(*) FROM branch_batch_stock bbs
LEFT JOIN product_batches pb ON pb.id=bbs.batch_id
WHERE bbs.quantity>0 AND (pb.id IS NULL OR pb.is_active IS NOT 1);
DROP TABLE _positive_lot_activation_preflight_0154;

-- Writers must explicitly reactivate restored lots in the same atomic batch,
-- before writing positive stock. These guards never reactivate lots as a side
-- effect and cover direct restores, UPSERT updates and INSERT OR REPLACE.
CREATE TRIGGER positive_lot_require_active_insert_0154
BEFORE INSERT ON branch_batch_stock
WHEN NEW.quantity>0
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM product_batches WHERE id=NEW.batch_id AND is_active=1)
    THEN RAISE(ABORT,'Positive lot stock requires an active received lot') END;
END;

CREATE TRIGGER positive_lot_require_active_update_0154
BEFORE UPDATE ON branch_batch_stock
WHEN NEW.quantity>0
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM product_batches WHERE id=NEW.batch_id AND is_active=1)
    THEN RAISE(ABORT,'Positive lot stock requires an active received lot') END;
END;

-- Guard INSERT too: INSERT OR REPLACE must not bypass the update invariant.
-- Guard all UPDATEs so reassignment of an id cannot hide existing stock.
-- IS NOT 1 also rejects NULL/noncanonical inactive flags on stocked lots.
CREATE TRIGGER positive_lot_reject_inactive_insert_0154
BEFORE INSERT ON product_batches
WHEN NEW.is_active IS NOT 1
 AND EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=NEW.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot deactivate a received lot with positive branch stock');
END;

CREATE TRIGGER positive_lot_reject_inactive_update_0154
BEFORE UPDATE ON product_batches
WHEN NEW.is_active IS NOT 1
 AND EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id=NEW.id AND quantity>0)
BEGIN
  SELECT RAISE(ABORT,'Cannot deactivate a received lot with positive branch stock');
END;

-- Postflight: rerun the preflight SELECT; it must still return zero rows.
-- Zero-stock historical lots retain their existing inactive state.
