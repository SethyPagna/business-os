-- INSERT OR IGNORE propagates its conflict policy into AFTER-trigger UPDATEs.
-- Without an explicit guard, a bad source mapping can therefore skip a
-- branch_stock CHECK violation while still changing the product aggregate.
-- Reject the source effect before any write instead; valid idempotent repeats
-- remain harmless because the source-key conflict skips before this trigger.

CREATE TRIGGER IF NOT EXISTS trg_legacy_inventory_effect_stock_guard
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
