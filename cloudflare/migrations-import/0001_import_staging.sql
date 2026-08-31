-- Import-staging database (binding IMPORT_DB, database business-os-import).
--
-- This is a SEPARATE D1 from the operational `business-os` database. It holds
-- ONLY the two bulk, regenerable import STAGING tables that dominated the
-- operational DB's size (measured Aug 31 2026: import_job_rows 244,716 rows /
-- ~246 MB + import_job_source_rows 214,573 rows / ~185 MB = ~65% of a 661 MB
-- operational DB, all of it transient per-import scratch the 24h retention
-- sweep is meant to reclaim). Moving them here keeps operational size, and
-- therefore backup time and query cache pressure, small and stable.
--
-- Why ONLY these two tables (and not the rest of import_job_*): a D1
-- db.batch() is atomic only within ONE database, and D1 has no cross-database
-- JOINs. These two are only ever written in staging-only batches and are
-- never JOINed to operational tables (verified across importEngine.ts,
-- routes/importJobs.ts, stockActionSeal.ts). The idempotency ledgers
-- (import_sales_commits / import_stock_action_commits / _guards) and
-- import_auto_merges deliberately stay on the operational DB because they ride
-- the SAME atomic batch as the stock/product writes they guard.
--
-- Schemas are byte-faithful copies of migrations/0011_import_job_chunking.sql
-- (import_job_rows) and migrations/0012_import_job_source_rows.sql
-- (import_job_source_rows), MINUS nothing -- neither table had a foreign key,
-- so no cross-DB FK had to be dropped. IF NOT EXISTS throughout, for the same
-- interrupted-apply resilience the operational migrations rely on (see
-- DEPLOY.md's "table/index already exists" note).
--
-- The application reaches these tables through D1Compat.staging (lib/db.ts):
-- getDb(env).staging is a wrapper over IMPORT_DB when the binding is present,
-- and falls back to the operational DB when it is not -- so local dev, the
-- pure-test harnesses, and any single-DB deployment keep working unchanged.

CREATE TABLE IF NOT EXISTS import_job_rows (
  job_id TEXT NOT NULL,
  phase TEXT NOT NULL, -- 'analyze' | 'apply'
  row_number INTEGER NOT NULL,
  group_index INTEGER, -- sales imports only: 0-based order-group index; null otherwise
  action TEXT NOT NULL, -- 'create' | 'update' | 'skip' | 'error'
  identifier TEXT, -- denormalized ImportRowResult.identifier for plain-SQL review filtering
  result_json TEXT NOT NULL, -- JSON-serialized ImportRowResult
  PRIMARY KEY (job_id, phase, row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_job_rows_phase_action ON import_job_rows (job_id, phase, action);
CREATE INDEX IF NOT EXISTS idx_import_job_rows_phase_group ON import_job_rows (job_id, phase, group_index);

CREATE TABLE IF NOT EXISTS import_job_source_rows (
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, -- 0-based order of first appearance among non-blank data rows (what readMaterializedWindow slices by)
  row_number INTEGER NOT NULL, -- original 1-based CSV line number
  data_json TEXT NOT NULL, -- JSON-serialized ParsedCsvRow
  PRIMARY KEY (job_id, sequence)
);
