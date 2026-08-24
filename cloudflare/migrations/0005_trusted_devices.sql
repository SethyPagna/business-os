-- Device-approval security feature. An unrecognized device attempting to
-- sign in as a non-administrator is put in a pending state instead of
-- receiving a session, until an administrator approves or rejects it from
-- Users > Device approvals. Admin-control users (the reserved `admin`
-- username, `admin` role code, or an explicit `permissions.all` grant) are
-- intentionally exempt so an administrator can always manage approvals.
--
-- `device_id` is a random UUID the client generates once and persists in
-- localStorage (see frontend's deviceInfo helpers) -- not a security
-- boundary by itself (a cleared browser gets a new id, and a new id is
-- just a new pending row, not a bypass), but paired with `user_id` it lets
-- the same physical device skip re-approval on every login and lets an
-- admin recognize *which* browser/device a pending request came from
-- (name + user agent + IP shown at approval time).
CREATE TABLE IF NOT EXISTS trusted_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  user_agent TEXT,
  first_ip TEXT,
  last_ip TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  decided_by_user_id INTEGER,
  decided_by_name TEXT,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_user_device ON trusted_devices (user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_status ON trusted_devices (status);
