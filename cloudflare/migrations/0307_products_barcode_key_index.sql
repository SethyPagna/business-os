-- 0307: an index on the normalized barcode, so a typed product search finds a stored barcode written with spaces, hyphens, capitals or extra zeros by SEEK, not by
-- scanning every product (lane/products-search-reads).
--
-- Every typed search carries the exact-barcode catch-all of lib/searchMatch.ts exactBarcodePredicateSql: a stored barcode matches when its normalized form
-- (lower, no spaces or hyphens, leading zeros dropped: normalizedBarcodeSql) equals the typed key. The literal forms the catalog stores are probed by the barcode index,
-- but the catch-all stays an expression over the stored column, and with no index on that expression it forced a read of EVERY active product on EVERY typed search,
-- whatever the text matched: 8,334 rows for a search that finds nothing, ahead of the work the matches cost. This index holds exactly that expression, so the
-- planner answers `<expression> = key` with a seek (EXPLAIN: SEARCH p USING INDEX idx_products_barcode_key (<expr>=?)). The expression is written exactly as
-- normalizedBarcodeSql writes it; SQLite uses an expression index only when the query spells the same expression.
--
-- PRE:  products exists; the index does not. A failed check reads a malformed JSON path and aborts the file.
-- POST: idx_products_barcode_key exists on products; no table or row changes (the expression is pinned against normalizedBarcodeSql by
--       scripts/test-migration-0307-products-barcode-key-index-pure.cjs, which also pins the EXPLAIN plan: a migration cannot run EXPLAIN).
-- Cost: one index row per products insert, and a rewrite only for an UPDATE that changes barcode (SQLite skips the entry when none of the expression's columns change).
--       The build reads and indexes every existing product once.
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups), generic (no client data). Idempotent only through the PRE check.
-- Rollback-safe: the previous Worker never names this index and runs unchanged on the new schema; this Worker returns the same rows with or without it (it only seeks faster).
-- RECOVERY: schema only. Full undo: DROP INDEX IF EXISTS idx_products_barcode_key;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'products') = 1
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_products_barcode_key') = 0
THEN 1 ELSE json_extract('[]','$[products_barcode_key_0307_pre]') END;

CREATE INDEX idx_products_barcode_key ON products (ltrim(lower(replace(replace(trim(COALESCE(barcode, '')), ' ', ''), '-', '')), '0'));
