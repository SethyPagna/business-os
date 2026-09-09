-- Durable receipt for the fixed September 9 zero-item sale recovery.
-- Schema only: this migration changes no sale, item, stock, money or audit row.
-- PRE/POST: sales, sale_items, stock and inventory movement counts/sums are unchanged.
-- RECOVERY: retain applied receipts and members if application code is rolled back;
-- they are the authoritative replay record for this one guarded incident repair.
CREATE TABLE sale_incident_recovery_receipts (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE CHECK(incident_key IN ('sale-zero-items-20260909-v1', 'sale-zero-items-20260909-v2')),
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  backup_created INTEGER NOT NULL CHECK(backup_created = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_incident_recovery_members (
  operation_id TEXT NOT NULL REFERENCES sale_incident_recovery_receipts(id),
  sale_id INTEGER NOT NULL UNIQUE CHECK(sale_id IN (16951, 16952, 16953, 16954)),
  history_id INTEGER NOT NULL REFERENCES action_history(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  PRIMARY KEY(operation_id, sale_id)
);

CREATE INDEX idx_sale_incident_recovery_members_history
  ON sale_incident_recovery_members(history_id);

-- Transient single-writer guard. It is inserted and removed inside the same
-- D1 batch as the receipt and every recovery effect, and is never backed up.
CREATE TABLE sale_incident_recovery_guards (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);
