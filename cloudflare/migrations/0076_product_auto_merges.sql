-- K5 / 9.2 (Part 421): make in-file import auto-merges VISIBLE.
--
-- The products import folds a later row with the same identity signature
-- into the first row's product (importEngine's in-batch dedupe) -- correct
-- under the identity rule, but until now invisible afterward: at the real
-- migration file's scale ~2,013 rows merge into others and their losing
-- values vanish without a trace.
--
-- 1) The FLAG the board asked for: how many in-file rows auto-merged into
--    this product across all imports. Drives the Products "auto-merged"
--    facet; 0 for everything else.
ALTER TABLE products ADD COLUMN auto_merged_count INTEGER DEFAULT 0;

-- 2) The RECORD: one row per losing source row, preserving its original
--    values (losing_json) so "the first row's details win" no longer
--    destroys the evidence. History is append-only; nothing rewrites it.
CREATE TABLE IF NOT EXISTS import_auto_merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  import_job_id INTEGER,
  row_number INTEGER,
  losing_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_auto_merges_product ON import_auto_merges(product_id);
