-- Cross-chunk in-file duplicate detection, moved out of chunk_state_json.
--
-- The analyze phase has to notice that two rows thousands of rows apart are
-- the "same" new product, so the review screen an operator approves matches
-- what approving it will actually do. That ledger lived in
-- import_jobs.chunk_state_json as a plain object, one key per created row.
--
-- The cost was quadratic and invisible. chunk_state_json is JSON.parse'd at
-- the start of every chunk and JSON.stringify'd at the end, so a ledger that
-- reaches ~8,700 entries by the final chunk is parsed and re-serialised in
-- full on all ~58 of them -- work proportional to (rows x chunks), not rows,
-- inside a Worker whose entire budget is 10ms per invocation. The ledger was
-- also the largest thing in that column by far, so it dominated the cost of
-- reading state that otherwise holds a handful of scalars.
--
-- As a table this becomes an indexed lookup of only the signatures a given
-- chunk actually asks about (at most one window's worth), and the state
-- column goes back to being small.
--
-- Scoped by job_id and deleted whenever a phase restarts, exactly as the old
-- in-state map was discarded when chunk state reset -- see resetChunkState.
CREATE TABLE IF NOT EXISTS import_job_row_signatures (
  job_id     TEXT NOT NULL,
  -- productIdentitySignature output: name + barcode + the pricing fields.
  signature  TEXT NOT NULL,
  -- The ORIGINAL CSV line number of the first row carrying this signature.
  -- Reported to the operator as "merges with row #N", so it must be the
  -- number they see in their spreadsheet, not an internal sequence.
  row_number INTEGER NOT NULL,
  PRIMARY KEY (job_id, signature)
);
