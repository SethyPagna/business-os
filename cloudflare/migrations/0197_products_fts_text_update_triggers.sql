-- The three product FTS update triggers (0018 products_fts_au, 0019
-- products_fts_code_au, 0021 products_fts_name_trigram_au) were declared
-- `AFTER UPDATE ON products`, so EVERY products UPDATE re-tokenised the row
-- into all three FTS tables -- including the ~41 stock writers
-- (`UPDATE products SET stock_quantity = ...` on every sale line, stock-in,
-- transfer, return and adjustment) that change no indexed text at all.
-- Seeded lab DB: one 5-line sale's product stock updates 9.5 -> 5.6 ms (I4-5).
--
-- Each trigger is recreated to fire only for the columns ITS OWN index holds,
-- plus `id` (the FTS rowid is content_rowid='id'; an id change must move the
-- entry), and only when one of those values actually changed:
--   products_fts               name, sku, barcode, brand, category, supplier, description, unit
--   products_fts_code          barcode, sku
--   products_fts_name_trigram  name
-- The bodies are byte-for-byte the originals (delete old image, insert new).
-- Correctness: these are external-content FTS5 tables; their postings are a
-- pure function of the listed columns, so an UPDATE that leaves all of them
-- unchanged leaves the index already correct. Renames and every text-column
-- edit still re-index (scripts/test-migration-0197-*-pure.cjs proves each).
-- `IS NOT` so NULL <-> value transitions count as changes.
--
-- Schema-only: no row is read or written. Each DROP is immediately followed
-- by its CREATE; a text edit landing in that sub-millisecond gap at migrate
-- time would miss the index, which the 'rebuild' under Recovery repairs.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN
--                ('products_fts_au','products_fts_code_au','products_fts_name_trigram_au') -- 3
-- Post-assert: same count = 3, and each sql contains 'AFTER UPDATE OF';
--              INSERT INTO products_fts(products_fts, rank) VALUES('integrity-check', 1) succeeds
--              (same for products_fts_code and products_fts_name_trigram).
-- Deploy order: EITHER. No code names these triggers.
-- Recovery:    re-run the three CREATE TRIGGER statements from 0018/0019/0021
--              after DROP TRIGGER IF EXISTS of each name (restores fire-on-every-
--              update). If an index were ever suspected stale:
--              INSERT INTO products_fts(products_fts) VALUES('rebuild'); (and the
--              other two tables) rebuilds from products without data loss.

DROP TRIGGER IF EXISTS products_fts_au;
CREATE TRIGGER products_fts_au
AFTER UPDATE OF id, name, sku, barcode, brand, category, supplier, description, unit ON products
WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name OR NEW.sku IS NOT OLD.sku
  OR NEW.barcode IS NOT OLD.barcode OR NEW.brand IS NOT OLD.brand OR NEW.category IS NOT OLD.category
  OR NEW.supplier IS NOT OLD.supplier OR NEW.description IS NOT OLD.description OR NEW.unit IS NOT OLD.unit
BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.brand, old.category, old.supplier, old.description, old.unit);
  INSERT INTO products_fts(rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES (new.id, new.name, new.sku, new.barcode, new.brand, new.category, new.supplier, new.description, new.unit);
END;

DROP TRIGGER IF EXISTS products_fts_code_au;
CREATE TRIGGER products_fts_code_au
AFTER UPDATE OF id, barcode, sku ON products
WHEN NEW.id IS NOT OLD.id OR NEW.barcode IS NOT OLD.barcode OR NEW.sku IS NOT OLD.sku
BEGIN
  INSERT INTO products_fts_code(products_fts_code, rowid, barcode, sku)
  VALUES ('delete', old.id, old.barcode, old.sku);
  INSERT INTO products_fts_code(rowid, barcode, sku)
  VALUES (new.id, new.barcode, new.sku);
END;

DROP TRIGGER IF EXISTS products_fts_name_trigram_au;
CREATE TRIGGER products_fts_name_trigram_au
AFTER UPDATE OF id, name ON products
WHEN NEW.id IS NOT OLD.id OR NEW.name IS NOT OLD.name
BEGIN
  INSERT INTO products_fts_name_trigram(products_fts_name_trigram, rowid, name)
  VALUES ('delete', old.id, old.name);
  INSERT INTO products_fts_name_trigram(rowid, name)
  VALUES (new.id, new.name);
END;
