-- Image-match results, moved out of import_jobs.chunk_state_json.
--
-- Same quadratic shape as migration 0051's dedupe ledger, and at this
-- catalog's scale the worse of the two. The image match is computed once per
-- job, but it was stored in chunk_state_json, which is JSON.parse'd at the
-- start of every chunk and JSON.stringify'd at the end. Measured on a
-- machine faster than a Worker isolate:
--
--     1,000 images ->  92 KB of state | 0.69 ms per chunk
--     5,000 images -> 479 KB          | 4.01 ms per chunk
--    10,000 images -> 963 KB          | 7.99 ms per chunk
--
-- against a 10ms CPU budget per invocation. Unlike the dedupe ledger, which
-- grew as the run progressed and therefore failed near the END, this one is
-- full size from the FIRST chunk -- so a large image import would burn most
-- of its budget before doing any work at all.
--
-- The access patterns are what make tables the right shape here, not just a
-- smaller blob:
--
--   * rowImagePaths is read per chunk but only ever for the rows in THAT
--     window, so a keyed lookup replaces loading all 10,000 to use 150.
--   * renamePlan is read exactly ONCE per apply run (on the first chunk),
--     yet was being serialised on every one of them.
CREATE TABLE IF NOT EXISTS import_job_image_matches (
  job_id     TEXT NOT NULL,
  -- Original CSV line number, matching ParsedCsvRow._rowNumber -- the key
  -- classifyProducts looks up when deciding which image a row gets.
  row_number INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  PRIMARY KEY (job_id, row_number)
);

-- The `_1`/`_2` rename plan for uploaded image files. Keyed by the
-- import_job_files row id, global to the job rather than window-scoped.
CREATE TABLE IF NOT EXISTS import_job_image_renames (
  job_id   TEXT NOT NULL,
  file_id  TEXT NOT NULL,
  new_name TEXT NOT NULL,
  PRIMARY KEY (job_id, file_id)
);
