-- Transfer idempotency receipts. A single receipt covers one logical
-- transfer request (including a bulk chunk), so a timeout/retry can return
-- the original result without running another stock movement.
CREATE TABLE IF NOT EXISTS transfer_operation_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL CHECK(request_id = trim(request_id)),
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  status TEXT NOT NULL DEFAULT 'committed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_operation_receipts_created
  ON transfer_operation_receipts (created_at DESC, id DESC);
