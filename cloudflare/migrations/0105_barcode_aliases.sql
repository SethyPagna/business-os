-- Additive alias-barcode table (P2-3, Phase 2 RC "Codex/legacy-data
-- contract"). Codex/legacy re-verification (old-system barcodes are
-- correct where ours are missing/"0"/short -- see productIdentity.ts:170-
-- 173) sometimes finds a real barcode for a product that already carries a
-- DIFFERENT real barcode. `products.barcode` is a deliberately shared,
-- non-unique scalar column (migrations/0001_init.sql:419,776 -- a plain
-- index, never UNIQUE; 238 live products currently share the literal "0")
-- and must never be silently overwritten by an import or a script. This
-- table gives the re-verified alternative code somewhere real to live, so
-- it becomes searchable (cloudflare/src/lib/barcodeAliases.ts's
-- buildAliasExactClause is the read side P2-2's search tail can OR in)
-- without ever touching the primary column.
--
-- Deliberately NOT unique on `barcode`/`barcode_normalized` alone -- that
-- would reintroduce exactly the false uniqueness assumption
-- `products.barcode` itself was never given (the same alias code can
-- legitimately belong to more than one product, same as the primary
-- column). The UNIQUE constraint is on (product_id, barcode_normalized)
-- only: it stops the SAME product from accumulating duplicate rows for the
-- SAME alias (re-running an import or a script twice must be a no-op, not
-- a growing pile of identical rows), while leaving two different products
-- free to share one alias barcode exactly as they can share one primary
-- barcode.
--
-- ON DELETE CASCADE: an alias with no surviving product is meaningless
-- data, not a record worth keeping (mirrors migrations/0013_user_notes.sql
-- and 0098_user_aliases.sql's identical ON DELETE CASCADE choice for the
-- same "child row is meaningless without its parent" reasoning). Products
-- are never hard-deleted by ordinary app flows (soft-delete via
-- is_active=0), so this only ever fires for genuine cleanup/test paths.
--
-- FTS: products_fts_code (0019_products_fts_code.sql) is an FTS5
-- EXTERNAL-CONTENT table keyed 1:1 to products.id (content='products',
-- content_rowid='id') -- it structurally cannot hold more than one barcode
-- per product without becoming a different kind of table, which is out of
-- this migration's additive-only scope. Aliases are looked up directly
-- against this table's own `barcode_normalized` index instead (exact match
-- only -- see buildAliasExactClause's own comment for why substring/fuzzy
-- alias matching isn't attempted here).
CREATE TABLE IF NOT EXISTS barcode_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  barcode_normalized TEXT NOT NULL,
  source TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, barcode_normalized)
);

-- Non-unique on purpose (see the table comment above) -- this is the index
-- an exact-match lookup (buildAliasExactClause) and any future per-product
-- listing (listAliases) actually hit.
CREATE INDEX IF NOT EXISTS idx_barcode_aliases_normalized
  ON barcode_aliases (barcode_normalized);

CREATE INDEX IF NOT EXISTS idx_barcode_aliases_product
  ON barcode_aliases (product_id);
