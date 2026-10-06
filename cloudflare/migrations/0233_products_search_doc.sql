-- G37 phase 2: a stored, versioned search document per product and one FTS5
-- table over it, so a product text search is one index lookup instead of the
-- seven-way FTS/trigram/LIKE disjunction with its LIMIT-scan fallbacks (measured
-- 25k-60k D1 rows read per multi-word search; see lib/productSearchDocQuery.ts).
--
-- products.search_doc is the space-separated index terms of name + brand,
-- written by lib/searchCore.ts docTerms (the SAME normalizer the admin
-- pickers run in the browser): roman aliases (ii -> 2), letter/digit splits
-- (100ml -> 100 ml) and short-run joins behind a '~' mark (sk ii -> ~skii
-- ~sk2). Khmer vowel signs and coeng are kept. search_doc_version is the
-- docTerms version the text was written with.
--
-- products_search_fts is an external-content FTS5 table over search_doc. EVERY
-- product row is in it, a row without a document as an empty one (the triggers
-- below are symmetric: 'delete' the old value, insert the new), which keeps
-- 'rebuild' and 'integrity-check' (rank=1, which compares the index with the
-- content table) valid at any time. tokenchars '~' keeps "~skii" one token, so a joined-term prefix query can
-- be told apart from a plain term prefix (the client index keeps terms and
-- joined terms in separate postings; the server must match level for level).
-- prefix='2 3' keeps the common 2-3 letter typing steps off the full term walk.
-- products_search_vocab is the fts5vocab view of its terms: the Worker reads
-- one first-letter range of it (and caches it) to find typo variants.
--
-- search_doc is NULL until it is written. A row with a NULL document is
-- "missing": the Worker matches those few rows in code with the same core
-- (see loadMissingSearchDocRows) and refuses the index path when too many are
-- missing, falling back to the legacy clause. idx_products_search_doc_missing
-- is partial, so the "how many are missing" probe reads only the missing rows.
--
-- Correctness never depends on every writer remembering the column:
-- products_search_doc_stale nulls search_doc when name or brand change in a
-- statement that did not also change search_doc (renames through the group
-- cascade, merges, undo appliers, restore snapshots, ...). The scheduled repair
-- and scripts/backfill-search-doc then rewrite the missing documents.
--
-- NO data backfill here: the normalizer is JS (a SQL port could not stay byte-
-- identical to the browser's). ops/scripts/backfill-search-doc.mjs writes the
-- documents; it is a held production write applied by the deploy lead. Until it
-- has run, more than the missing-row cap are missing and every search keeps
-- using the legacy path, i.e. applying this migration changes no search result.
--
-- Heads-up for the backfill: stock_revision_products_update (0124/0195) fires on
-- ANY products UPDATE and bumps stock_session_revisions, so run the backfill
-- when no stock session is open (after closing).
--
-- Pre-assert:  SELECT COUNT(*) FROM pragma_table_info('products')
--                WHERE name IN ('search_doc','search_doc_version')  -- 0
--              SELECT COUNT(*) FROM sqlite_master WHERE name IN ('products_fts',
--                'products_fts_code','products_fts_name_trigram')   -- 3
--              (and none of products_search_fts, products_search_vocab,
--               idx_products_search_doc_missing exists)
-- Post-assert: the two columns exist; products_search_fts, products_search_vocab and
--              idx_products_search_doc_missing exist; 4 triggers named
--              products_search_fts_ai/_ad/_au and products_search_doc_stale exist;
--              SELECT COUNT(*) FROM products WHERE search_doc IS NOT NULL = 0;
--              SELECT COUNT(*) FROM products_search_fts = SELECT COUNT(*) FROM products;
--              INSERT INTO products_search_fts(products_search_fts, rank)
--                VALUES('integrity-check', 1) succeeds.
-- Deploy order: BEFORE the Worker that reads search_doc (the Worker tolerates the
--              tables being absent by using the legacy path, so either order is
--              safe, but the migration must be applied for the new path to run).
-- Recovery:    DROP TRIGGER IF EXISTS on the 4 triggers, DROP TABLE IF EXISTS
--              products_search_vocab, DROP TABLE IF EXISTS products_search_fts,
--              DROP INDEX IF EXISTS idx_products_search_doc_missing. The two columns
--              stay inert (the Worker then sees no products_search_fts and uses the
--              legacy path). If the index were ever suspected stale:
--              INSERT INTO products_search_fts(products_search_fts) VALUES('rebuild');

ALTER TABLE products ADD COLUMN search_doc TEXT;
ALTER TABLE products ADD COLUMN search_doc_version INTEGER;

CREATE VIRTUAL TABLE products_search_fts USING fts5(
  search_doc,
  content='products',
  content_rowid='id',
  tokenize="unicode61 remove_diacritics 2 tokenchars '~'",
  prefix='2 3'
);

-- Every existing row enters the index as an empty document (search_doc is NULL
-- until the backfill): about 8.5k docsize rows, no postings.
INSERT INTO products_search_fts(rowid, search_doc) SELECT id, search_doc FROM products;

CREATE VIRTUAL TABLE products_search_vocab USING fts5vocab(products_search_fts, 'row');

CREATE INDEX idx_products_search_doc_missing ON products(id) WHERE search_doc IS NULL AND is_active = 1;

CREATE TRIGGER products_search_fts_ai AFTER INSERT ON products
BEGIN
  INSERT INTO products_search_fts(rowid, search_doc) VALUES (NEW.id, NEW.search_doc);
END;

CREATE TRIGGER products_search_fts_ad AFTER DELETE ON products
BEGIN
  INSERT INTO products_search_fts(products_search_fts, rowid, search_doc) VALUES ('delete', OLD.id, OLD.search_doc);
END;

-- Delete-then-insert of the same rowid (FTS5's external-content update).
CREATE TRIGGER products_search_fts_au AFTER UPDATE OF id, search_doc ON products
WHEN NEW.id IS NOT OLD.id OR NEW.search_doc IS NOT OLD.search_doc
BEGIN
  INSERT INTO products_search_fts(products_search_fts, rowid, search_doc) VALUES ('delete', OLD.id, OLD.search_doc);
  INSERT INTO products_search_fts(rowid, search_doc) VALUES (NEW.id, NEW.search_doc);
END;

-- The document is a pure function of name and brand: when either changes and
-- the same statement left search_doc alone, the document is stale. Nulling it
-- fires products_search_fts_au (the FTS entry goes with it) and puts the row in
-- the partial index until it is rewritten.
CREATE TRIGGER products_search_doc_stale AFTER UPDATE OF name, brand ON products
WHEN NEW.search_doc IS NOT NULL AND NEW.search_doc IS OLD.search_doc
  AND (NEW.name IS NOT OLD.name OR NEW.brand IS NOT OLD.brand)
BEGIN
  UPDATE products SET search_doc = NULL, search_doc_version = NULL WHERE id = NEW.id;
END;
