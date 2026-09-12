-- Schema only: pre/post products, branch_stock, branch_batch_stock, movements,
-- audit and history counts and stock sums must be identical. No backfill.
-- Recovery: roll back application code; retain this table and durable receipts.
-- Never delete operation rows to retry a request whose outcome is unknown.
CREATE TABLE stock_lot_adjustment_operations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  revision_json TEXT NOT NULL CHECK(json_valid(revision_json)),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  state TEXT NOT NULL DEFAULT 'applied' CHECK(state IN ('applied','reversed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, request_id)
);
