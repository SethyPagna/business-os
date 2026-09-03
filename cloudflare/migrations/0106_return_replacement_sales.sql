-- A replacement handed out during a customer return is also a real sale.
-- Keep the existing return_replacement_items audit trail, but link it to the
-- sale/receipt so Sales, receipts and later returns all use the normal model.
ALTER TABLE returns ADD COLUMN replacement_sale_id INTEGER;
ALTER TABLE sales ADD COLUMN source_return_id INTEGER;
ALTER TABLE return_replacement_items ADD COLUMN sale_item_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_returns_replacement_sale ON returns(replacement_sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_source_return ON sales(source_return_id);
CREATE INDEX IF NOT EXISTS idx_return_replacements_sale_item ON return_replacement_items(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);
