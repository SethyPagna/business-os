-- 0273: the Conflicts lists for unknown cost and missing barcodes (lane 6.0.988).
--
-- Owner rulings 14-15 Oct 2026: a cost nobody recorded is UNKNOWN and Conflicts lists every unknown-cost item, lots included;
-- an old $0 is unknown too unless it is provably real, with a "Confirm $0" in Conflicts and nothing rewritten; blank barcodes and the
-- old "0" placeholder barcodes are separate lists, and an admin can mark a product "has no barcode", reversibly.
--
-- What this adds (no existing business row is read for update or changed):
--   1. product_conflict_marks: one row per (product, mark). mark 'zero_cost_confirmed' proves a $0 catalog cost is real; mark 'no_barcode'
--      removes the product from both barcode lists. Deleting the row reverses either. The route writes an audit row and an undo record
--      with every change. No cost, stock, lot or sale column is touched by a mark.
--   2. system_flags 'cost_zero_watermark': the highest products.id when this migration is applied, as text. A $0 catalog cost on a product
--      at or below it was written when the Worker could not store "unknown", so it is unproven until confirmed; a product created after
--      it can only hold a $0 a person typed. Nothing old is rewritten.
--   3. Six partial indexes so the lists and counts read index entries, not the whole product table. Every query in
--      lib/productDataGaps.ts repeats these WHERE terms verbatim (SQLite uses a partial index only when the query implies it);
--      the barcode terms use the same character set as JavaScript trim() (tab, line breaks, space, no-break space and the Unicode
--      spaces), so SQL and the app agree on what is blank.
--
-- LF-only, append-only, generic (no client data). Applying it twice aborts at the PRE assertion.
--
-- PRE:  none of the objects below exists, and no 'cost_zero_watermark' flag. Asserted in this file (the first SELECT aborts otherwise).
--       Note SELECT COALESCE(MAX(id), 0) FROM products; it is the value stored below.
-- POST: the table, the six indexes and the flag exist, the flag equals MAX(products.id) as text, and the table is empty. Asserted below.
-- RECOVERY: nothing else depends on these objects; the lists fall back to scans if an index is missing.
--       DROP INDEX IF EXISTS idx_products_unknown_cost;  DROP INDEX IF EXISTS idx_product_batches_unknown_cost;
--       DROP INDEX IF EXISTS idx_damaged_lots_unknown_cost;  DROP INDEX IF EXISTS idx_products_zero_cost;
--       DROP INDEX IF EXISTS idx_products_empty_barcode;  DROP INDEX IF EXISTS idx_products_placeholder_barcode;
--       remove 'product_conflict_marks' from BACKUP_TABLES (or a restore aborts on the missing table), then
--       DROP TABLE IF EXISTS product_conflict_marks;   -- loses only the confirmations and no-barcode marks
--       DELETE FROM system_flags WHERE key = 'cost_zero_watermark';   -- no old $0 is then listed as unproven
--     The mark may be RAISED (never lowered) once an older Worker that wrote default 0 costs has stopped writing:
--       UPDATE system_flags SET value = CAST((SELECT COALESCE(MAX(id), 0) FROM products) AS TEXT), updated_at = CURRENT_TIMESTAMP
--       WHERE key = 'cost_zero_watermark';

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('product_conflict_marks','idx_products_unknown_cost',
    'idx_product_batches_unknown_cost','idx_damaged_lots_unknown_cost','idx_products_zero_cost','idx_products_empty_barcode',
    'idx_products_placeholder_barcode')) = 0
  AND (SELECT COUNT(*) FROM system_flags WHERE key = 'cost_zero_watermark') = 0
THEN 1 ELSE json_extract('[]','$[conflict_marks_0273_pre]') END;

CREATE TABLE product_conflict_marks (
  product_id INTEGER NOT NULL,
  mark TEXT NOT NULL CHECK (mark IN ('zero_cost_confirmed', 'no_barcode')),
  marked_by_id INTEGER,
  marked_by_name TEXT,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, mark)
);

CREATE INDEX idx_products_unknown_cost ON products(is_active, id) WHERE cost_price_usd IS NULL AND is_active = 1;

CREATE INDEX idx_product_batches_unknown_cost ON product_batches(is_active, variant_product_id) WHERE unit_cost_usd IS NULL AND is_active = 1;

CREATE INDEX idx_damaged_lots_unknown_cost ON damaged_stock_lots(product_id) WHERE unit_cost_usd IS NULL AND quantity_remaining > 0;

CREATE INDEX idx_products_zero_cost ON products(is_active, id) WHERE cost_price_usd = 0 AND is_active = 1;

CREATE INDEX idx_products_empty_barcode ON products(is_active, id) WHERE is_active = 1 AND (barcode IS NULL OR trim(barcode, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)) = '');

CREATE INDEX idx_products_placeholder_barcode ON products(is_active, id) WHERE is_active = 1 AND barcode IS NOT NULL AND trim(barcode, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)) <> '' AND trim(barcode, char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)) NOT GLOB '*[^0]*';

INSERT INTO system_flags (key, value, updated_at)
SELECT 'cost_zero_watermark', CAST(COALESCE(MAX(id), 0) AS TEXT), CURRENT_TIMESTAMP FROM products;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('product_conflict_marks','idx_products_unknown_cost',
    'idx_product_batches_unknown_cost','idx_damaged_lots_unknown_cost','idx_products_zero_cost','idx_products_empty_barcode',
    'idx_products_placeholder_barcode')) = 7
  AND (SELECT COUNT(*) FROM product_conflict_marks) = 0
  AND (SELECT value FROM system_flags WHERE key = 'cost_zero_watermark') = CAST((SELECT COALESCE(MAX(id), 0) FROM products) AS TEXT)
THEN 1 ELSE json_extract('[]','$[conflict_marks_0273_post]') END;
