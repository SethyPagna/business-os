-- Fixes the remaining CPU-budget cliff migration 0011 didn't cover: analyze/
-- apply chunking (ROWS_PER_IMPORT_CHUNK) already split the CLASSIFY+WRITE
-- work into small windows, but every single one of those windows still
-- called fetchDecidedRows, which re-fetched the CSV from R2 and
-- re-parsed the ENTIRE file from scratch (parseCsvRows over the whole
-- text) before slicing out just that window's 150 rows. For an
-- ~11,890-row/38-column file that's the full O(n) parse cost paid again on
-- every one of the ~80 analyze chunks and again on every one of the ~80
-- apply chunks -- effectively O(n^2) -- which is what actually produced the
-- "stuck for minutes" hang: an 11-11.9k row export never got past the free
-- plan's 10ms/invocation-recheck-worthy chunk-parse cost even though each
-- individual classify window was small.
--
-- Fix: parse the file ONCE, in small resumable windows of its own (see
-- importCsv.ts's parseDelimitedRowsWindow + importEngine.ts's
-- ensureSourceRowsMaterialized / MATERIALIZE_ROWS_PER_CHUNK), persisting
-- each already-parsed row here as it's produced. Every later analyze/apply
-- chunk then reads its window with a plain indexed SELECT (I/O-bound, no
-- re-parsing) via readMaterializedWindow, and the handful of genuinely
-- cross-row computations that need every row at once (sales' order
-- grouping, products' image-match candidates) read the whole,
-- already-parsed table via readAllMaterializedRows instead of re-parsing
-- CSV text.
CREATE TABLE IF NOT EXISTS import_job_source_rows (
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, -- 0-based order of first appearance among non-blank data rows -- what readMaterializedWindow slices by (cursor, cursor+limit), NOT row_number (which is the original 1-based CSV line and can skip over blank lines)
  row_number INTEGER NOT NULL, -- original CSV line number, matching parseCsvRows' `index + 1` / ParsedCsvRow._rowNumber -- carried through so identifiers/errors still cite the row the user sees in their spreadsheet
  data_json TEXT NOT NULL, -- JSON-serialized ParsedCsvRow (header-keyed values + _rowNumber)
  PRIMARY KEY (job_id, sequence)
);

-- Resume/checkpoint state for the materialize pass itself -- separate from
-- import_jobs' existing chunk_cursor/chunk_state_json (migration 0011),
-- which track the analyze/apply CLASSIFY pass's own progress and are reset
-- on every fresh /:id/start or /:id/retry. materialize_state_json instead
-- tracks progress through parsing the raw file, which only needs to happen
-- ONCE per uploaded file and is deliberately left untouched by analyze/apply
-- retries -- see resetMaterializeState's comment for the one case (a NEW
-- CSV upload) that does clear it.
ALTER TABLE import_jobs ADD COLUMN materialize_state_json TEXT;
ALTER TABLE import_jobs ADD COLUMN materialize_done INTEGER NOT NULL DEFAULT 0;
