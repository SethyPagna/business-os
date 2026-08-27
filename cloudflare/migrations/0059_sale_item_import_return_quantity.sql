-- Preserve the per-line returned quantity carried by a historical sales
-- import. Manual returns still live in returns/return_items; this snapshot
-- exists so export -> import -> export does not lose the original compact
-- sales-file fact for imported returned/partial_return orders.
ALTER TABLE sale_items ADD COLUMN returned_quantity REAL NOT NULL DEFAULT 0 CHECK(returned_quantity >= 0 AND returned_quantity <= quantity);
