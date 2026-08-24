-- Third full-text index over products, this time trigram-tokenized `name`
-- only -- closes a real, confirmed gap in products_fts_code (migrations/
-- 0019_products_fts_code.sql), not a new class of bug.
--
-- products_fts (0018, unicode61 tokenizer) matches a NAME word only from
-- its start (`word*` prefix matching). That's correct for the overwhelming
-- majority of real free-text words, but this catalog's naming convention
-- very commonly fuses a number directly onto a unit or shade code with no
-- separating space/punctuation for unicode61 to split on -- "100ml",
-- "454g", "110C", "10ml" are all ONE token, exactly the same shape as the
-- barcode problem 0019 already fixed ("012" inside "6923644012345"). So
-- typing just the unit ("ml"), the weight ("454g"), or a shade-code
-- fragment ("110C") against a name like "Anastasia Foundation 110C" or
-- "Toner 100ml" never matched, even though the row is plainly right there.
--
-- Confirmed at real catalog scale before writing this migration (a batch
-- of ~107,000 realistic queries -- full names, first/last/middle words,
-- reordered words, barcode fragments, and fused number+unit/shade-code
-- fragments -- run against every row of this project's actual product
-- catalog via a real better-sqlite3 harness running the exact SQL
-- routes/products.ts builds): fused number+unit/shade-code tokens were by
-- far the single largest cause of a product search silently "hiding" a
-- result that's clearly in the catalog -- more common than every other
-- confirmed search gap combined.
--
-- Scoped to `name` only, not folded into products_fts_code alongside
-- barcode/sku (a fourth column on that table would have been simpler to
-- migrate) -- kept separate because barcode/sku substring queries and name
-- substring queries have different eligibility rules downstream
-- (buildTrigramMatchExpression's 3-char-per-word minimum is the same, but
-- titleOnly search mode intentionally skips the barcode/sku trigram table
-- while still needing this one), and because a future column-scoped
-- change to one shouldn't risk the other's sync triggers. Not extended to
-- brand/category/supplier/description/unit: those columns are not
-- reported to have this fused-token naming pattern, and an unnecessary
-- trigram index has a real, non-trivial write-amplification and storage
-- cost (every 3-character window, not just token boundaries) that isn't
-- worth paying speculatively.
--
-- Same external-content-table pattern as 0018/0019 (index stores only
-- tokens + postings, points back at products.id; triggers below keep it
-- in sync on every products write path automatically, with no changes
-- needed to any INSERT/UPDATE/DELETE call site).
CREATE VIRTUAL TABLE products_fts_name_trigram USING fts5(
  name,
  content='products',
  content_rowid='id',
  tokenize='trigram'
);

-- Backfill the index for every product that already exists.
INSERT INTO products_fts_name_trigram(rowid, name)
SELECT id, name FROM products;

CREATE TRIGGER products_fts_name_trigram_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts_name_trigram(rowid, name)
  VALUES (new.id, new.name);
END;

CREATE TRIGGER products_fts_name_trigram_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts_name_trigram(products_fts_name_trigram, rowid, name)
  VALUES ('delete', old.id, old.name);
END;

-- An UPDATE is a delete-then-reinsert of the same rowid -- FTS5's own
-- documented pattern for external-content sync (there's no in-place
-- "update a posting list" operation).
CREATE TRIGGER products_fts_name_trigram_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts_name_trigram(products_fts_name_trigram, rowid, name)
  VALUES ('delete', old.id, old.name);
  INSERT INTO products_fts_name_trigram(rowid, name)
  VALUES (new.id, new.name);
END;
