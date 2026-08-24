-- Closes two real gaps found while auditing the admin device-approval
-- feature (migrations/0005_trusted_devices.sql):
--
-- 1. `user_sessions` had no `device_id` column, so there was no way to
--    revoke a *live* session when an admin revokes/rejects a device's
--    trust from Settings > Security -- a stolen/lost device stayed
--    logged in until its session naturally expired. See lib/deviceTrust.ts
--    and routes/devices.ts for the approve/reject/revoke flow this feeds.
-- 2. `trusted_devices` recorded IP but not country, so an admin reviewing
--    a pending request in the approval queue had to look up the IP
--    themselves to tell where a login attempt originated from.
--
-- Both are additive, nullable columns -- safe on existing rows (old
-- sessions/devices just have NULL, which behaves as "unknown", not as a
-- migration failure).

ALTER TABLE user_sessions ADD COLUMN device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_device ON user_sessions (user_id, device_id);

ALTER TABLE trusted_devices ADD COLUMN first_country TEXT;
ALTER TABLE trusted_devices ADD COLUMN last_country TEXT;
