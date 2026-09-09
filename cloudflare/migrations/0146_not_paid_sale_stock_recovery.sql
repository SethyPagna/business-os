-- Durable proof for the fixed September 9 Not Paid stock correction.
-- Schema only: this migration changes no sale, allocation, stock, movement,
-- history or audit row. The guarded Worker route performs the one-time repair.
CREATE TABLE sale_not_paid_stock_recovery_receipts (
  id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE CHECK(incident_key = 'sale-not-paid-stock-recovery-20260909-v1'),
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  backup_created INTEGER NOT NULL CHECK(backup_created = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_not_paid_stock_recovery_members (
  operation_id TEXT NOT NULL REFERENCES sale_not_paid_stock_recovery_receipts(id),
  sale_id INTEGER NOT NULL UNIQUE CHECK(sale_id IN (16952, 16953, 16954)),
  history_id INTEGER NOT NULL REFERENCES action_history(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  PRIMARY KEY(operation_id, sale_id)
);

CREATE TABLE sale_not_paid_stock_recovery_guards (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

CREATE TRIGGER sale_not_paid_stock_recovery_receipts_append_only_update
BEFORE UPDATE ON sale_not_paid_stock_recovery_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery receipts are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_receipts_append_only_delete
BEFORE DELETE ON sale_not_paid_stock_recovery_receipts
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery receipts are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_members_append_only_update
BEFORE UPDATE ON sale_not_paid_stock_recovery_members
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery members are append-only');
END;

CREATE TRIGGER sale_not_paid_stock_recovery_members_append_only_delete
BEFORE DELETE ON sale_not_paid_stock_recovery_members
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
 AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='sale_not_paid_stock_recovery_reset_guard' AND json_extract(value,'$.mode')='reset' AND length(json_extract(value,'$.token'))>0)
BEGIN
  SELECT RAISE(ABORT, 'not paid stock recovery members are append-only');
END;
