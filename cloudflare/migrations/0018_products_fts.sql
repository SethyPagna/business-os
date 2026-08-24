-- Full-text index over products' searchable fields, replacing the
-- REPLACE()-chain-wrapped `LIKE '%term%'` scans previously built by
-- lib/searchMatch.ts's normalizedHaystackSql and used in routes/
-- products.ts, inventory.ts, and portal.ts.
--
-- Why this was slow: every searchable column was wrapped in up to a
-- dozen nested REPLACE() calls (diacritic folding, joiner folding) before
-- the LIKE comparison, and a leading '%' wildcard can never use an index
-- anyway -- so every search was a full table scan across up to 8 wrapped
-- columns per row, with OR mode costing more than AND (AND can bail out
-- of a row on the first false clause; OR must check every clause on
-- every non-matching row before concluding no match). A zero-result
-- strict search on top of that triggered a JS Levenshtein fallback pass
-- against up to 3000 candidate rows fetched from D1. On a resource-
-- limited/billed-by-rows-read database, all of that scales directly with
-- catalog size no matter how well-indexed the *filter* columns are.
--
-- FTS5's own inverted index makes a MATCH query proportional to the
-- number of matching tokens, not the size of the table, and its
-- `unicode61 remove_diacritics 2` tokenizer already folds accents and
-- treats punctuation/joiners as token boundaries on its own -- so
-- "Crème"/"creme" and "Cover+Concealer"/"cover concealer" keep matching
-- each other with none of the hand-rolled REPLACE() machinery. See
-- routes/products.ts, inventory.ts, and portal.ts for the new
-- MATCH-based query building this backs, and lib/searchMatch.ts for what
-- was removed.
--
-- content='products'/content_rowid='id' makes this an "external content"
-- table: the index stores only tokens + postings, not a second copy of
-- every column, and points back at products.id for the actual row data.
-- External-content tables don't auto-sync on writes to the base table --
-- the triggers below do that for every INSERT/UPDATE/DELETE against
-- products, at the SQLite level, so every write path (manual product
-- CRUD, bulk import, grouping/merge operations, etc.) stays in sync
-- without any of them needing to know this index exists.
CREATE VIRTUAL TABLE products_fts USING fts5(
  name, sku, barcode, brand, category, supplier, description, unit,
  content='products',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Backfill the index for every product that already exists.
INSERT INTO products_fts(rowid, name, sku, barcode, brand, category, supplier, description, unit)
SELECT id, name, sku, barcode, brand, category, supplier, description, unit FROM products;

CREATE TRIGGER products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES (new.id, new.name, new.sku, new.barcode, new.brand, new.category, new.supplier, new.description, new.unit);
END;

CREATE TRIGGER products_fts_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.brand, old.category, old.supplier, old.description, old.unit);
END;

-- An UPDATE is a delete-then-reinsert of the same rowid -- FTS5's own
-- documented pattern for external-content sync (there's no in-place
-- "update a posting list" operation).
CREATE TRIGGER products_fts_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.brand, old.category, old.supplier, old.description, old.unit);
  INSERT INTO products_fts(rowid, name, sku, barcode, brand, category, supplier, description, unit)
  VALUES (new.id, new.name, new.sku, new.barcode, new.brand, new.category, new.supplier, new.description, new.unit);
END;
