-- BEFORE INSERT triggers run before SQLite resolves INSERT OR IGNORE's unique
-- source-key conflict. Exempt an already-applied source key from the negative-
-- stock guard so repeat imports remain idempotent; new effects are still
-- rejected before they can make product, branch, or lot stock negative.

DROP TRIGGER IF EXISTS trg_legacy_inventory_effect_stock_guard;

CREATE TRIGGER trg_legacy_inventory_effect_stock_guard
BEFORE INSERT ON legacy_inventory_effects
WHEN NOT EXISTS (
  SELECT 1 FROM legacy_inventory_effects WHERE source_key=NEW.source_key
) AND NEW.quantity_delta < 0 AND (
  COALESCE((
    SELECT quantity FROM branch_stock
    WHERE product_id=NEW.product_id AND branch_id=NEW.branch_id
  ), 0) + NEW.quantity_delta < 0
  OR COALESCE((
    SELECT stock_quantity FROM products WHERE id=NEW.product_id
  ), 0) + NEW.quantity_delta < 0
  OR (
    NEW.batch_id IS NOT NULL AND COALESCE((
      SELECT quantity FROM branch_batch_stock
      WHERE batch_id=NEW.batch_id AND branch_id=NEW.branch_id
    ), 0) + NEW.quantity_delta < 0
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Legacy inventory effect would make stock negative');
END;
