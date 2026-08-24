-- Backs real password-reset send/verify (auth priority item 1 in
-- PORTING_STATUS.md): a single-use, hashed recovery link token per
-- request. The legacy Docker backend's `verification_codes` table (see
-- backend's services/verification.ts) had columns for a much larger
-- feature set (SMS, multiple providers, per-channel state). This is a
-- deliberately smaller schema scoped to what's actually implemented here
-- first: email-delivered recovery links (`purpose = 'password_reset_link'`).
-- The `purpose` column exists so email-verify or a future typed-code flow
-- can reuse this table later without a new migration.

-- NOTE: `verification_codes` already exists as of 0001_init.sql, but with a
-- different, never-used schema (channel/destination/code_salt/meta_json --
-- no code in cloudflare/src ever references those columns; lib/verification.ts
-- only ever reads/writes user_id, purpose, code_hash, target, max_attempts,
-- expires_at, requester_ip, consumed_at, created_at). `CREATE TABLE IF NOT
-- EXISTS` here was therefore a silent no-op against the 0001 table, so the
-- columns this migration actually needs were never added -- causing
-- "no such column: requester_ip" the first time 0003+ ran against a
-- database that already had 0001 applied (i.e. any real/remote DB). Add the
-- missing columns to the existing table instead of trying to recreate it.
ALTER TABLE verification_codes ADD COLUMN target TEXT;
ALTER TABLE verification_codes ADD COLUMN attempts INTEGER DEFAULT 0;
ALTER TABLE verification_codes ADD COLUMN max_attempts INTEGER DEFAULT 5;
ALTER TABLE verification_codes ADD COLUMN requester_ip TEXT;

-- `channel` and `destination` were NOT NULL with no default in 0001 and
-- `code_salt` NOT NULL too; lib/verification.ts's insert never supplies
-- any of the three (nor meta_json), so every password-reset request would
-- fail with a NOT NULL constraint error on any DB carrying the 0001
-- schema -- this was a live bug independent of the requester_ip failure.
-- Drop the dead columns rather than special-case them app-side.
ALTER TABLE verification_codes DROP COLUMN channel;
ALTER TABLE verification_codes DROP COLUMN destination;
ALTER TABLE verification_codes DROP COLUMN code_salt;
ALTER TABLE verification_codes DROP COLUMN meta_json;

-- Lookup path for verify/confirm: latest live code for a user+purpose.
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_purpose ON verification_codes(user_id, purpose, created_at);

-- Lookup path for rate limiting by IP across all users.
CREATE INDEX IF NOT EXISTS idx_verification_codes_ip_created ON verification_codes(requester_ip, created_at);
