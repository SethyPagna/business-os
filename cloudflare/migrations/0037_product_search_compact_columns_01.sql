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

-- Batched into multiple small migration files (01-13) to stay under
-- D1's per-request CPU time limit -- the original single-file version
-- (238 sequential full-table UPDATE statements applied as one request)
-- hit 'D1 DB exceeded its CPU time limit and was reset' on a remote
-- apply. Each file below now does only a small slice of the same
-- shallow, single-level REPLACE sequence, applied in strict numeric
-- order -- functionally identical end result, just spread across
-- more, cheaper requests instead of one expensive one.

ALTER TABLE products ADD COLUMN name_normalized TEXT;
ALTER TABLE products ADD COLUMN unit_normalized TEXT;
ALTER TABLE products ADD COLUMN brand_compact TEXT;

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
