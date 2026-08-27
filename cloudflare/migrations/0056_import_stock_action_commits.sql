-- Idempotency ledger for §12 stock-action apply. Queue delivery is
-- at-least-once; every business write in one action is guarded by a pending
-- ledger row and the same D1 batch marks it applied atomically.
CREATE TABLE IF NOT EXISTS import_stock_action_commits (
  job_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  row_number INTEGER,
  action_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  PRIMARY KEY (job_id, action_key)
);

CREATE INDEX IF NOT EXISTS idx_import_stock_action_commits_job_status
  ON import_stock_action_commits(job_id, status, row_number);
