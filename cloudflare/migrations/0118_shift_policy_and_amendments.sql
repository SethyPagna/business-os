ALTER TABLE shift_sessions ADD COLUMN scope_mode TEXT NOT NULL DEFAULT 'per_account'
  CHECK (scope_mode IN ('per_account', 'shop_wide'));
ALTER TABLE shift_sessions ADD COLUMN closed_by_user_id INTEGER;
ALTER TABLE shift_sessions ADD COLUMN closed_by_user_name TEXT;
ALTER TABLE shift_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS idx_shift_sessions_user_day;
CREATE UNIQUE INDEX idx_shift_sessions_account_day ON shift_sessions(user_id, COALESCE(branch_id, -1), business_date) WHERE scope_mode = 'per_account';
CREATE UNIQUE INDEX idx_shift_sessions_shop_day ON shift_sessions(COALESCE(branch_id, -1), business_date) WHERE scope_mode = 'shop_wide';
CREATE TABLE shift_session_amendments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 shift_session_id INTEGER NOT NULL REFERENCES shift_sessions(id) ON DELETE RESTRICT,
 actor_user_id INTEGER NOT NULL, actor_name TEXT, reason TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shift_amendments_shift_time ON shift_session_amendments(shift_session_id, created_at, id);
CREATE TRIGGER shift_session_amendments_no_update
BEFORE UPDATE ON shift_session_amendments
BEGIN SELECT RAISE(ABORT, 'shift amendments are immutable'); END;
CREATE TRIGGER shift_session_amendments_no_delete
BEFORE DELETE ON shift_session_amendments
BEGIN SELECT RAISE(ABORT, 'shift amendments are immutable'); END;
INSERT INTO settings (key,value,updated_at) VALUES ('shift_scope_mode','per_account',CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key,value,updated_at) VALUES ('shift_admin_exempt','true',CURRENT_TIMESTAMP) ON CONFLICT(key) DO NOTHING;
