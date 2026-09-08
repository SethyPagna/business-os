-- Durable receipts for Products > Conflicts selected merge runs.
-- Schema only: this migration does not update products, stock, lots, history, or audit rows.
-- Pre/post assertions for a release rehearsal:
--   SELECT COUNT(*) FROM products;
--   SELECT COUNT(*), COALESCE(SUM(quantity), 0) FROM branch_stock;
--   SELECT COUNT(*), COALESCE(SUM(quantity), 0) FROM branch_batch_stock;
--   SELECT COUNT(*) FROM undo_snapshots;
--   SELECT COUNT(*) FROM action_history;
--   SELECT COUNT(*) FROM audit_logs;
-- All six results must be identical before and after applying this migration.
-- Recovery: roll back the route/UI while retaining these receipts. Never drop receipt rows
-- to simulate a product-merge rollback. A committed receipt prevents replay; Undo is exposed
-- only while its separately retained action-history and snapshot link remains live.

CREATE TABLE product_conflict_merge_runs (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  manifest_version INTEGER NOT NULL CHECK (manifest_version = 1),
  manifest_digest TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'completed', 'interrupted')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id)
);

CREATE TABLE product_conflict_merge_run_cases (
  run_id TEXT NOT NULL REFERENCES product_conflict_merge_runs(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 12),
  case_key TEXT NOT NULL,
  keeper_product_id INTEGER NOT NULL REFERENCES products(id),
  merged_product_id INTEGER NOT NULL REFERENCES products(id),
  expected_state_digest TEXT NOT NULL,
  stock_choice TEXT CHECK (stock_choice IS NULL OR stock_choice IN ('merge', 'write_off')),
  operation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'committed', 'history_pending', 'undo_ready', 'refused')),
  action_history_id INTEGER REFERENCES action_history(id) ON DELETE SET NULL,
  refusal_code TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, ordinal),
  UNIQUE (run_id, case_key),
  CHECK (keeper_product_id != merged_product_id)
);

CREATE INDEX idx_product_conflict_merge_runs_status
ON product_conflict_merge_runs(status, updated_at, id);

CREATE INDEX idx_product_conflict_merge_run_cases_status
ON product_conflict_merge_run_cases(run_id, status, ordinal);
