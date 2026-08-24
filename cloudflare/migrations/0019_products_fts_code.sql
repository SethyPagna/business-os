-- Second, separate full-text index over just (barcode, sku), using FTS5's
-- trigram tokenizer instead of products_fts's unicode61 tokenizer
-- (migrations/0018_products_fts.sql).
--
-- Why this exists as its OWN table rather than just another column on
-- products_fts: unicode61's word-prefix matching (`word*`) only ever
-- matches from the START of a token, and a barcode like "6923644012345"
-- is one single token (no spaces for unicode61 to split on) -- so typing
-- "012", which appears in the MIDDLE of that token, never matched, even
-- though a person typing a fragment of a barcode expects substring
-- matching. Confirmed against real FTS5 (better-sqlite3, same engine D1
-- runs on) before writing this migration, not assumed. Trigram indexes
-- every overlapping 3-character sequence, so a plain MATCH against it is a
-- true substring search -- "012" now finds "6923644012345" via this
-- table. See lib/searchMatch.ts's buildTrigramMatchExpression for the
-- query-building side and routes/products.ts/inventory.ts for how its
-- MATCH is combined (via SQL OR) with the main products_fts MATCH.
--
-- Scoped to barcode+sku only, not all 8 products_fts columns: trigram
-- indexes cost meaningfully more to store and write than unicode61 (every
-- 3-character window, not just token boundaries), and free-text fields
-- like name/description are already well served by word-prefix matching
-- -- nobody needs "com" to substring-match "welcome" in a product
-- description. Barcode/sku are short, dense, punctuation-light strings
-- where substring search is the actual expected behavior (scanning or
-- typing a fragment), so the extra index cost is worth it only there.
--
-- Same external-content-table pattern as 0018 (index stores only tokens +
-- postings, points back at products.id; triggers below keep it in sync on
-- every products write path automatically).
CREATE VIRTUAL TABLE products_fts_code USING fts5(
  barcode, sku,
  content='products',
  content_rowid='id',
  tokenize='trigram'
);

-- Backfill the index for every product that already exists.
INSERT INTO products_fts_code(rowid, barcode, sku)
SELECT id, barcode, sku FROM products;

CREATE TRIGGER products_fts_code_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts_code(rowid, barcode, sku)
  VALUES (new.id, new.barcode, new.sku);
END;

CREATE TRIGGER products_fts_code_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts_code(products_fts_code, rowid, barcode, sku)
  VALUES ('delete', old.id, old.barcode, old.sku);
END;

-- An UPDATE is a delete-then-reinsert of the same rowid -- FTS5's own
-- documented pattern for external-content sync (there's no in-place
-- "update a posting list" operation).
CREATE TRIGGER products_fts_code_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts_code(products_fts_code, rowid, barcode, sku)
  VALUES ('delete', old.id, old.barcode, old.sku);
  INSERT INTO products_fts_code(rowid, barcode, sku)
  VALUES (new.id, new.barcode, new.sku);
END;
