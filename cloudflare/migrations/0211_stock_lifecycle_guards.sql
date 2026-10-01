CREATE VIEW stock_lifecycle_dependencies AS
 SELECT id AS source_id,movement_id,batch_id,product_id,branch_id,supplier_id FROM stock_disposition_sources
 UNION ALL SELECT source_id,movement_id,batch_id,product_id,branch_id,supplier_id FROM stock_funding_dependencies;
CREATE TABLE stock_lifecycle_context(
 token TEXT PRIMARY KEY REFERENCES stock_disposition_guards(token),
 source_id TEXT NOT NULL REFERENCES stock_disposition_sources(id),
 batch_id INTEGER NOT NULL,branch_id INTEGER NOT NULL,remaining_quantity REAL NOT NULL CHECK(remaining_quantity>=0)
);
CREATE TRIGGER stock_lifecycle_context_owned BEFORE INSERT ON stock_lifecycle_context
 WHEN NOT EXISTS(SELECT 1 FROM stock_disposition_guards g JOIN stock_disposition_sources s ON s.id=NEW.source_id
  WHERE g.token=NEW.token AND g.valid=1 AND s.batch_id=NEW.batch_id AND s.branch_id=NEW.branch_id
  AND ABS(NEW.remaining_quantity-(CAST(s.quantity AS REAL)-(SELECT COALESCE(SUM(CAST(a.quantity AS REAL)),0) FROM stock_disposition_allocations a WHERE a.source_id=s.id)))<=0.000000001)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_context_no_update BEFORE UPDATE ON stock_lifecycle_context
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_batch_update BEFORE UPDATE ON product_batches
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE batch_id=OLD.id) AND (NEW.id IS NOT OLD.id OR NEW.variant_product_id IS NOT OLD.variant_product_id OR NEW.received_at IS NOT OLD.received_at OR NEW.received_quantity IS NOT OLD.received_quantity OR NEW.received_cost_usd IS NOT OLD.received_cost_usd OR NEW.received_branch_id IS NOT OLD.received_branch_id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.supplier_name IS NOT OLD.supplier_name OR NEW.payment_status IS NOT OLD.payment_status OR NEW.credit_due_date IS NOT OLD.credit_due_date OR NEW.unit_cost_usd IS NOT OLD.unit_cost_usd OR NEW.is_active IS NOT OLD.is_active OR NEW.batch_key IS NOT OLD.batch_key OR NEW.lot_code IS NOT OLD.lot_code)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_batch_delete BEFORE DELETE ON product_batches
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE batch_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_batch_insert BEFORE INSERT ON product_batches
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE batch_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_lot_update BEFORE UPDATE ON branch_batch_stock
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE batch_id=OLD.batch_id) AND (NEW.quantity IS NOT OLD.quantity OR NEW.batch_id IS NOT OLD.batch_id OR NEW.branch_id IS NOT OLD.branch_id) AND NOT EXISTS(SELECT 1 FROM stock_lifecycle_context x JOIN stock_disposition_guards g ON g.token=x.token WHERE g.valid=1 AND x.batch_id=OLD.batch_id AND x.branch_id=OLD.branch_id AND NEW.batch_id=OLD.batch_id AND NEW.branch_id=OLD.branch_id AND NEW.quantity=x.remaining_quantity)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_lot_delete BEFORE DELETE ON branch_batch_stock
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE batch_id=OLD.batch_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_lot_insert BEFORE INSERT ON branch_batch_stock
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE batch_id=NEW.batch_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_movement_update BEFORE UPDATE ON inventory_movements
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE movement_id=OLD.id) AND (NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id OR NEW.branch_id IS NOT OLD.branch_id OR NEW.batch_id IS NOT OLD.batch_id OR NEW.movement_type IS NOT OLD.movement_type OR NEW.quantity IS NOT OLD.quantity OR NEW.free_quantity IS NOT OLD.free_quantity OR NEW.total_cost_usd IS NOT OLD.total_cost_usd OR NEW.total_cost_khr IS NOT OLD.total_cost_khr OR NEW.unit_cost_usd IS NOT OLD.unit_cost_usd OR NEW.unit_cost_khr IS NOT OLD.unit_cost_khr OR NEW.reference_id IS NOT OLD.reference_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_movement_delete BEFORE DELETE ON inventory_movements
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE movement_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_product_update BEFORE UPDATE ON products
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE product_id=OLD.id) AND (NEW.id IS NOT OLD.id OR NEW.is_active IS NOT OLD.is_active OR NEW.parent_id IS NOT OLD.parent_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_product_delete BEFORE DELETE ON products
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE product_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_fee_update BEFORE UPDATE ON fees
 WHEN EXISTS(SELECT 1 FROM stock_disposition_fees WHERE fee_id=OLD.id) OR EXISTS(SELECT 1 FROM stock_funding_events WHERE fee_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_fee_delete BEFORE DELETE ON fees
 WHEN EXISTS(SELECT 1 FROM stock_disposition_fees WHERE fee_id=OLD.id) OR EXISTS(SELECT 1 FROM stock_funding_events WHERE fee_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_v1_admit_maintenance BEFORE INSERT ON stock_disposition_sources
 WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_funding_admit_maintenance BEFORE INSERT ON stock_funding_sources
 WHEN EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance')
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_invoice_update BEFORE UPDATE ON supplier_invoices
 WHEN EXISTS(SELECT 1 FROM stock_funding_invoice_openings WHERE invoice_id=OLD.id)
 AND (NEW.id IS NOT OLD.id OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.branch_id IS NOT OLD.branch_id OR NEW.total_amount_usd IS NOT OLD.total_amount_usd OR NEW.amount_paid_usd IS NOT OLD.amount_paid_usd OR NEW.outstanding_balance_usd IS NOT OLD.outstanding_balance_usd OR NEW.status IS NOT OLD.status)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_invoice_delete BEFORE DELETE ON supplier_invoices
 WHEN EXISTS(SELECT 1 FROM stock_funding_invoice_openings WHERE invoice_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_branch_stock_update BEFORE UPDATE ON branch_stock
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE product_id=OLD.product_id AND branch_id=OLD.branch_id)
 AND (NEW.product_id IS NOT OLD.product_id OR NEW.branch_id IS NOT OLD.branch_id OR NEW.quantity+0.000000001<(SELECT COALESCE(SUM(bs.quantity),0) FROM branch_batch_stock bs WHERE bs.branch_id=OLD.branch_id AND EXISTS(SELECT 1 FROM stock_lifecycle_dependencies d WHERE d.batch_id=bs.batch_id AND d.product_id=OLD.product_id)))
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
CREATE TRIGGER stock_lifecycle_branch_stock_delete BEFORE DELETE ON branch_stock
 WHEN EXISTS(SELECT 1 FROM stock_lifecycle_dependencies WHERE product_id=OLD.product_id AND branch_id=OLD.branch_id)
 BEGIN SELECT RAISE(ABORT,'stock_lifecycle_dependency'); END;
