-- PRE/POST: inactive-products-with-stock must return no violations; this migration changes no business rows.
-- RECOVERY: retain these guards on code rollback. Resolve stock through audited compensating operations.
-- Existing transfer/lot provenance triggers (0151/0154/0155) remain authoritative and unchanged.
CREATE TRIGGER product_deactivate_stock_0242
BEFORE UPDATE OF is_active ON products
WHEN NEW.is_active IS NOT 1 AND OLD.is_active IS 1
 AND (COALESCE(OLD.stock_quantity,0)<>0 OR COALESCE(NEW.stock_quantity,0)<>0
  OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=OLD.id AND quantity<>0)
  OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=OLD.id AND s.quantity<>0)
  OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=OLD.id AND quantity_remaining<>0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER product_delete_stock_0242
BEFORE DELETE ON products
WHEN COALESCE(OLD.stock_quantity,0)<>0
 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=OLD.id AND quantity<>0)
 OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=OLD.id AND s.quantity<>0)
 OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=OLD.id AND quantity_remaining<>0)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER product_insert_stock_0242
BEFORE INSERT ON products
WHEN NEW.is_active IS NOT 1 AND (COALESCE(NEW.stock_quantity,0)<>0
 OR EXISTS(SELECT 1 FROM products WHERE id=NEW.id AND stock_quantity<>0)
 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=NEW.id AND quantity<>0)
 OR EXISTS(SELECT 1 FROM product_batches b JOIN branch_batch_stock s ON s.batch_id=b.id WHERE b.variant_product_id=NEW.id AND s.quantity<>0)
 OR EXISTS(SELECT 1 FROM damaged_stock_lots WHERE product_id=NEW.id AND quantity_remaining<>0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER product_cache_stock_0242
BEFORE UPDATE OF stock_quantity ON products
WHEN NEW.is_active IS NOT 1 AND NEW.stock_quantity<>0
 AND (NEW.stock_quantity>MAX(COALESCE(OLD.stock_quantity,0),0) OR NEW.stock_quantity<MIN(COALESCE(OLD.stock_quantity,0),0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER branch_stock_insert_active_0242
BEFORE INSERT ON branch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER branch_stock_update_active_0242
BEFORE UPDATE OF product_id,quantity ON branch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
 AND (NEW.product_id IS NOT OLD.product_id OR NEW.quantity>MAX(OLD.quantity,0) OR NEW.quantity<MIN(OLD.quantity,0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER batch_stock_insert_active_0242
BEFORE INSERT ON branch_batch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM product_batches b JOIN products p ON p.id=b.variant_product_id WHERE b.id=NEW.batch_id AND p.is_active IS NOT 1)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER batch_stock_update_active_0242
BEFORE UPDATE OF batch_id,quantity ON branch_batch_stock
WHEN NEW.quantity<>0 AND EXISTS(SELECT 1 FROM product_batches b JOIN products p ON p.id=b.variant_product_id WHERE b.id=NEW.batch_id AND p.is_active IS NOT 1)
 AND (NEW.batch_id IS NOT OLD.batch_id OR NEW.quantity>MAX(OLD.quantity,0) OR NEW.quantity<MIN(OLD.quantity,0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER batch_product_active_0242
BEFORE UPDATE OF variant_product_id ON product_batches
WHEN NEW.variant_product_id IS NOT OLD.variant_product_id
 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.variant_product_id AND is_active IS NOT 1)
 AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=OLD.id AND quantity<>0)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER damaged_stock_insert_active_0242
BEFORE INSERT ON damaged_stock_lots
WHEN NEW.quantity_remaining<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;

CREATE TRIGGER damaged_stock_update_active_0242
BEFORE UPDATE OF product_id,quantity_remaining ON damaged_stock_lots
WHEN NEW.quantity_remaining<>0 AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND is_active IS NOT 1)
 AND (NEW.product_id IS NOT OLD.product_id OR NEW.quantity_remaining>MAX(OLD.quantity_remaining,0) OR NEW.quantity_remaining<MIN(OLD.quantity_remaining,0))
BEGIN
  SELECT RAISE(ABORT,'product_has_stock');
END;
