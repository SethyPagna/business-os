-- Fixes a real, reported production bug: searching a short, common query
-- like "ana" against Products/Inventory/POS returned `D1_ERROR: Expression
-- tree is too large (maximum depth 100): SQLITE_ERROR` instead of results.
--
-- Root cause (confirmed by hand-tracing the exact clauses a 3-letter
-- single-word query builds in routes/products.ts, and reproduced locally):
-- lib/searchMatch.ts's foldDiacriticsSql wrapped a raw column reference in
-- one NESTED REPLACE() call PER entry in DIACRITIC_SQL_PAIRS (70 pairs =
-- 70 levels of function nesting), plus foldJoinersSql's own 6 more nested
-- REPLACE() calls on top (~78 levels total) -- run fresh on every single
-- search request. Confirmed locally (a plain `sqlite3` build, not just
-- D1's own stricter limit) that this style of deeply NESTED expression
-- overflows the SQL parser itself well before 78 levels -- nesting, not
-- just D1's specific depth-100 ceiling, is the real problem, which is why
-- this migration does not simply move the same nested-REPLACE expression
-- from query time to write time (a trigger built that way would just move
-- the same crash from "every search" to "every product write").
--
-- Fix, in two parts:
--  1. name_normalized / unit_normalized / brand_compact (this migration)
--     store the ALREADY-folded value, computed at write time in JS (see
--     lib/productWrites.ts's insertRow/updateRow and lib/importEngine.ts,
--     using this file's own lib/searchMatch.ts normalizeSearchText/
--     compactSearchText -- the exact same normalization search already
--     used everywhere else, just run once per write instead of once per
--     REPLACE-chain-per-query-per-row). lib/searchMatch.ts's
--     normalizedHaystackSql/compactHaystackSql now accept an
--     `alreadyNormalized` flag that reads these columns directly
--     (`lower(COALESCE(col, ''))`, zero REPLACE nesting) instead of
--     rebuilding the fold -- see that function's own comment.
--     routes/products.ts, inventory.ts, and portal.ts's search-clause
--     builders were updated to pass these columns with
--     alreadyNormalized=true.
--  2. Backfilling EXISTING rows (below) still needs to apply the same
--     fold in SQL, but does so as a long SEQUENCE of shallow, single-level
--     UPDATE statements -- one REPLACE() per statement, writing the
--     result back into the same column -- instead of one deeply NESTED
--     expression. Character folds never overlap (every source character
--     is accented/punctuation, every replacement target is a plain
--     ASCII letter or space that no later step in the same sequence also
--     treats as a "from" character), so applying them one at a time,
--     in sequence, produces the identical final string a single nested
--     expression would have -- just as ~150 shallow statements (each
--     comfortably under any real depth limit) instead of one ~78-level
--     nested one. This runs once, at migration time, never again per
--     search request.
--
-- name_compact (space-stripped, unlike name_normalized) is not added here
-- -- no current caller needs a space-stripped NAME match (only brand has
-- the "single-letter-token" punctuation problem compactHaystackSql exists
-- for); add it in a future migration if a real name-compact caller shows
-- up.
ALTER TABLE products ADD COLUMN name_normalized TEXT;
ALTER TABLE products ADD COLUMN unit_normalized TEXT;
ALTER TABLE products ADD COLUMN brand_compact TEXT;

-- name_normalized backfill (folds name -> lowercase, diacritic-folded, joiner-as-space)
UPDATE products SET name_normalized = COALESCE(name, '');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'á', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Á', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'à', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'À', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'â', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Â', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ä', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ä', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ã', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ã', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'å', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Å', 'a');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'é', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'É', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'è', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'È', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ê', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ê', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ë', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ë', 'e');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'í', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Í', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ì', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ì', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'î', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Î', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ï', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ï', 'i');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ó', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ó', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ò', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ò', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ô', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ô', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ö', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ö', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'õ', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Õ', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ø', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ø', 'o');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ú', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ú', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ù', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ù', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'û', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Û', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ü', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ü', 'u');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ý', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ý', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ÿ', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ÿ', 'y');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ñ', 'n');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ñ', 'n');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ç', 'c');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ç', 'c');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ş', 's');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ş', 's');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ţ', 't');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ţ', 't');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'æ', 'ae');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Æ', 'ae');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'œ', 'oe');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Œ', 'oe');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ß', 'ss');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'ł', 'l');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Ł', 'l');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'đ', 'd');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Đ', 'd');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'þ', 'th');
UPDATE products SET name_normalized = REPLACE(name_normalized, 'Þ', 'th');
UPDATE products SET name_normalized = REPLACE(name_normalized, '+', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '&', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '/', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '_', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '.', ' ');
UPDATE products SET name_normalized = REPLACE(name_normalized, '-', ' ');
UPDATE products SET name_normalized = lower(name_normalized);

-- unit_normalized backfill
UPDATE products SET unit_normalized = COALESCE(unit, '');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'á', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Á', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'à', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'À', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'â', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Â', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ä', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ä', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ã', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ã', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'å', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Å', 'a');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'é', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'É', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'è', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'È', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ê', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ê', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ë', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ë', 'e');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'í', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Í', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ì', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ì', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'î', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Î', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ï', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ï', 'i');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ó', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ó', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ò', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ò', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ô', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ô', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ö', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ö', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'õ', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Õ', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ø', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ø', 'o');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ú', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ú', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ù', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ù', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'û', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Û', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ü', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ü', 'u');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ý', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ý', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ÿ', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ÿ', 'y');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ñ', 'n');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ñ', 'n');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ç', 'c');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ç', 'c');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ş', 's');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ş', 's');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ţ', 't');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ţ', 't');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'æ', 'ae');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Æ', 'ae');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'œ', 'oe');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Œ', 'oe');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ß', 'ss');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'ł', 'l');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Ł', 'l');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'đ', 'd');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Đ', 'd');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'þ', 'th');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, 'Þ', 'th');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '+', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '&', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '/', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '_', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '.', ' ');
UPDATE products SET unit_normalized = REPLACE(unit_normalized, '-', ' ');
UPDATE products SET unit_normalized = lower(unit_normalized);

-- brand_compact backfill (same fold, plus a final space-strip)
UPDATE products SET brand_compact = COALESCE(brand, '');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'á', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Á', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'à', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'À', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'â', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Â', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ä', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ä', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ã', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ã', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'å', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Å', 'a');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'é', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'É', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'è', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'È', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ê', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ê', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ë', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ë', 'e');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'í', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Í', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ì', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ì', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'î', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Î', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ï', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ï', 'i');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ó', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ó', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ò', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ò', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ô', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ô', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ö', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ö', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'õ', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Õ', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ø', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ø', 'o');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ú', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ú', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ù', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ù', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'û', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Û', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ü', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ü', 'u');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ý', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ý', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ÿ', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ÿ', 'y');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ñ', 'n');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ñ', 'n');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ç', 'c');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ç', 'c');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ş', 's');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ş', 's');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ţ', 't');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ţ', 't');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'æ', 'ae');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Æ', 'ae');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'œ', 'oe');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Œ', 'oe');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ß', 'ss');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'ł', 'l');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Ł', 'l');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'đ', 'd');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Đ', 'd');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'þ', 'th');
UPDATE products SET brand_compact = REPLACE(brand_compact, 'Þ', 'th');
UPDATE products SET brand_compact = REPLACE(brand_compact, '+', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '&', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '/', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '_', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '.', ' ');
UPDATE products SET brand_compact = REPLACE(brand_compact, '-', ' ');
UPDATE products SET brand_compact = lower(brand_compact);
UPDATE products SET brand_compact = REPLACE(brand_compact, ' ', '');

CREATE INDEX IF NOT EXISTS idx_products_brand_compact ON products(brand_compact);

-- Ongoing sync for any write path this migration's own JS-side hooks
-- (lib/productWrites.ts, lib/importEngine.ts) don't cover is deliberately
-- NOT done via a SQL trigger here -- seed_from a trigger body would need
-- the exact same nested-REPLACE expression that caused the original bug
-- (a trigger body's own expressions are just as subject to D1's
-- depth-100 limit as a query's), and this codebase's two real product
-- write paths (the manual Add/Edit form via routes/products.ts, and bulk
-- import via lib/importEngine.ts) both already go through the JS-side
-- computation directly. If a third write path is ever added, it must
-- call lib/productWrites.ts's insertRow/updateRow (as every other table
-- write in this app already does) rather than hand-rolling its own SQL,
-- which keeps this column in sync without needing a SQL-side fallback at
-- all.
