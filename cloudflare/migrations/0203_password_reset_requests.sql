-- S-auth4c: password reset by administrator approval.
--
-- The owner wants recovery to offer any of three methods: the authenticator
-- code (POST /api/auth/password-reset/otp), the emailed link
-- (/password-reset/email, needs Resend), and asking an administrator. The
-- third had no record: "ask your admin" was only a hint. This table holds
-- those requests.
--
--   POST /api/auth/password-reset/admin-request (public, rate limited per
--     network and per identifier, one identical answer whatever matched)
--     inserts a 'pending' row for exactly one active account;
--   GET  /api/users/password-reset-requests (administrators) lists pending;
--   POST /api/users/:id/reset-password (the existing admin reset) marks that
--     account's pending rows 'resolved'; .../:requestId/dismiss marks one
--     'dismissed'.
--
-- At most one pending request per account (partial unique index), so a
-- repeat while one is waiting adds nothing. No credential or token is stored;
-- the administrator sets the new password through the existing action and
-- hands it over in person.
--
-- New table only; no existing row is read or changed.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE name = 'password_reset_requests'
--              -- expected 0
-- Post-assert: the same query -- expected 1;
--              SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
--                AND name IN ('idx_password_reset_requests_pending_user',
--                             'idx_password_reset_requests_status_requested')
--              -- expected 2; SELECT COUNT(*) FROM password_reset_requests -- 0.
-- Deploy order: EITHER. Without the table the request route answers the same
--              and records nothing, and the admin list is empty.
-- Recovery:    DROP TABLE IF EXISTS password_reset_requests;
--              (drops its indexes; loses only unanswered requests).

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_ip TEXT,
  device_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by INTEGER,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_requests_pending_user
  ON password_reset_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status_requested
  ON password_reset_requests (status, requested_at);
