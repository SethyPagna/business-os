CREATE TRIGGER stock_lifecycle_supplier_delete BEFORE DELETE ON suppliers
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE supplier_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_supplier_identity BEFORE UPDATE OF id ON suppliers
 WHEN NEW.id IS NOT OLD.id AND EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE supplier_id=OLD.id OR supplier_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_supplier_insert BEFORE INSERT ON suppliers
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE supplier_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_v1_supplier_admit BEFORE INSERT ON stock_disposition_sources
 WHEN NOT EXISTS(SELECT 1 FROM suppliers WHERE id=NEW.supplier_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_funding_supplier_admit BEFORE INSERT ON stock_funding_sources
 WHEN NOT EXISTS(SELECT 1 FROM suppliers WHERE id=NEW.supplier_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
