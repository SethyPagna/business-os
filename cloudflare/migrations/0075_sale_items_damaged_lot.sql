-- K2 / 11.9 (Part 411): a POS sale line that draws from a damaged lot
-- records WHICH lot. The stock such a line consumes lives in
-- damaged_stock_lots.quantity_remaining (see 0074) -- never in
-- branch_stock / branch_batch_stock, which a damaged unit left when its
-- return classified it.
ALTER TABLE sale_items ADD COLUMN damaged_lot_id INTEGER;
