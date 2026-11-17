-- 0315: partial indexes on the lot a sale line and a return line name, so a product merge finds every line on a folded lot by SEEK, not by scanning both line tables
-- (lane/merge-by-date round 6).
--
-- The merge fold re-points sale_items.batch_id and return_items.batch_id from a discarded lot to the kept one, and the planner reads the same lines first. Neither table had
-- an index on batch_id, so `WHERE batch_id IN (...)` was a full pass over sale_items and over return_items for the read and again for each re-point (r4: 92,109 rows read to fold 1 lot
-- on a census-shaped test world; base reads 6,042). Selecting through the product-first index instead (r5) was cheap but not exact: a line
-- written after a merge that names a moved lot (a historical import writes no stock movement), then a merge undo, leaves a line whose product differs from its lot's product, and a
-- later fold would leave it on an inactive lot. The fold now selects purely by batch_id, which is exact, and these indexes make that a seek.
-- Both are PARTIAL (WHERE batch_id IS NOT NULL): most lines name no lot (only a small share of sale and return lines carry one),
-- so the index holds only the lot-bearing rows. SQLite uses a partial index only for a statement that states the predicate, or whose terms imply it; the fold statements
-- select by `batch_id IN (...)`, which implies batch_id IS NOT NULL, so no extra term is written (pinned by scripts/test-migration-0315-sale-return-line-batch-index-pure.cjs,
-- which also pins the EXPLAIN plans: a migration cannot run EXPLAIN). Without that inference the fold is still exact; it only reads as much as r4 did.
--
-- PRE:  sale_items and return_items exist; neither index exists. A failed check reads a malformed JSON path and aborts the file.
-- POST: idx_sale_items_batch_id_partial and idx_return_items_batch_id_partial exist with their batch_id column and IS NOT NULL predicate; no table or row changes.
-- Cost: one index row per sale_items / return_items insert that names a lot, and a rewrite only for an UPDATE that changes batch_id (the fold, its undo, an import). The build reads each
--       table once and writes only the lot-bearing rows.
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups), generic (no client data). Idempotent only through the PRE check.
-- Rollback-safe: the previous Worker never names these indexes and runs unchanged on the new schema; this Worker returns the same rows with or without them (it only seeks faster).
-- RECOVERY: schema only. Full undo: DROP INDEX IF EXISTS idx_return_items_batch_id_partial; DROP INDEX IF EXISTS idx_sale_items_batch_id_partial;
--   Partial apply (one index exists, so a rerun aborts on PRE): first check d1_migrations for this file name.
--   Not recorded: run both DROP INDEX IF EXISTS statements, then rerun migrations apply.
--   Recorded but an index missing: run that one CREATE INDEX line from this file by hand; do not rerun the file.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('sale_items', 'return_items')) = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_sale_items_batch_id_partial', 'idx_return_items_batch_id_partial')) = 0
THEN 1 ELSE json_extract('[]','$[sale_return_line_batch_index_0315_pre]') END;

CREATE INDEX idx_sale_items_batch_id_partial ON sale_items (batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX idx_return_items_batch_id_partial ON return_items (batch_id) WHERE batch_id IS NOT NULL;
