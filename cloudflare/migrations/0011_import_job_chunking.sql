-- Makes bulk import analyze/apply survive the Workers FREE plan's 10ms-CPU-
-- per-invocation limit on large files.
--
-- Before this migration, runImportAnalyze/runImportApply (importEngine.ts)
-- fetched the whole CSV, parsed every row, and classified every row
-- (per-row Map lookups, diffFields, image-match scoring, SQL statement
-- building) synchronously inside ONE queue-consumer invocation -- fine when
-- the Worker's own cpu_ms limit was raised to 300000 (5 minutes, Paid-plan
-- only), but the Free plan caps actual CPU compute at 10ms per invocation
-- regardless of how long the invocation is allowed to run for wall-clock
-- (queue consumers get up to 15 minutes of wall-clock time -- see
-- Cloudflare's Workers docs -- time spent awaiting D1/R2 doesn't count
-- against the CPU budget, but the synchronous per-row classify loop very
-- much does). The exact scenario the OLD D1_IMPORT_BATCH_CHUNK_SIZE
-- comment already flags -- "an 11,896-row import" -- is squarely the case
-- this migration is for.
--
-- Fix: classify/apply/write in small row windows (see importEngine.ts's
-- ROWS_PER_IMPORT_CHUNK), persisting progress + partial results after each
-- window and re-enqueuing a fresh IMPORT_QUEUE message (same {jobId, kind}
-- shape as today) to pick up where it left off, instead of one giant
-- synchronous pass. Each invocation gets its own fresh 10ms budget.
--
-- import_job_rows also replaces the old "reclassify the entire file from
-- scratch" pattern GET /:id/review used on every single paginated request
-- (see importJobs.ts) -- that read is now a plain indexed SELECT over
-- already-computed results instead of a repeat of the whole analyze pass,
-- which was its own (pre-existing, independent of the Free-plan limit)
-- correctness/perf gap.
CREATE TABLE IF NOT EXISTS import_job_rows (
  job_id TEXT NOT NULL,
  phase TEXT NOT NULL, -- 'analyze' | 'apply' -- kept separate because apply re-classifies against live DB state (branches/products/contacts created by earlier chunks of the SAME apply run, or edited between analyze and approve), which can legitimately disagree with the last analyze pass -- see runImportApply's own comment on why it always reclassifies rather than trusting analyze's results verbatim.
  row_number INTEGER NOT NULL,
  group_index INTEGER, -- sales imports only: 0-based order-of-first-appearance index of the order_reference group this row belongs to. Null for every other import type. Lets sales chunking window by GROUP (a group's rows must all classify together) instead of by raw row.
  action TEXT NOT NULL, -- 'create' | 'update' | 'skip' | 'error'
  identifier TEXT, -- denormalized copy of ImportRowResult.identifier so GET /:id/review can filter/search with a plain SQL LIKE instead of loading+parsing every row's JSON first
  result_json TEXT NOT NULL, -- JSON-serialized ImportRowResult
  PRIMARY KEY (job_id, phase, row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_job_rows_phase_action ON import_job_rows (job_id, phase, action);
CREATE INDEX IF NOT EXISTS idx_import_job_rows_phase_group ON import_job_rows (job_id, phase, group_index);

-- How many rows/groups of the CURRENT phase run have been processed so far
-- -- the resume point a re-enqueued continuation message picks up from.
-- Reset to 0 whenever a phase (re)starts fresh (POST /:id/start,
-- /:id/approve, /:id/retry) rather than resuming an in-flight one.
ALTER TABLE import_jobs ADD COLUMN chunk_cursor INTEGER NOT NULL DEFAULT 0;

-- Small cache of cross-row-dependent data that's expensive to recompute
-- (products' fuzzy image-vs-name matching is worst-case O(images x rows),
-- see importImageMatch.ts's matchImagesToProducts) but only VALID once per
-- phase run -- computed on that run's first chunk (chunk_cursor = 0),
-- reused by every later chunk of the same run instead of being redone from
-- scratch on every single queue invocation. Cleared whenever a phase
-- (re)starts fresh, same as chunk_cursor above.
ALTER TABLE import_jobs ADD COLUMN chunk_state_json TEXT;
