-- Idempotency ledger for ordinary historical sales imports. Queue delivery
-- is at-least-once; each sale header, all line items, any return restock,
-- and the applied marker commit in one D1 batch transaction.
CREATE TABLE IF NOT EXISTS import_sales_commits (
  job_id TEXT NOT NULL,
  group_key TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  PRIMARY KEY (job_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_import_sales_commits_job_status
  ON import_sales_commits(job_id, status, row_number);
