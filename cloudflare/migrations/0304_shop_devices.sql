-- 0304: shop devices (owner 12 Nov 2026): an administrator marks a till once, and every active employee signs in there without a separate approval and without using one of their own device slots.
--
-- shop_devices: one row per marking. device_id is the browser id the Worker already trusts (the signed __Host-bos_dev cookie; the shop path never honours an id that only came in the request body).
--   Unmarking sets unmarked_at instead of deleting, so the history of who marked and unmarked a till stays; the partial unique index allows at most one ACTIVE marking per device id
--   and is the index the sign-in lookup uses (device_id = ? AND unmarked_at IS NULL).
--   last_seen_at / last_ip / last_country: written by a shop sign-in (at most once every few minutes unless the address or country changed), so the sign-in can raise the same new-country alert a personal device raises and the panel can show where the till was last used.
-- user_sessions.shop_device_id: set only on a sign-in session that was let in by the shop path (the shop_devices row id). Unmarking revokes exactly these sessions (and the sessions re-issued
--   from them, through limit_family_id), so the administrator's own sessions and an employee's personally approved sessions on the same browser are never touched. NULL on every existing row; no backfill.
-- trusted_devices.cookie_bound_at: set the first time a signed device cookie was issued for the row (its browser now holds the cookie). From then on the id alone, arriving in a request
--   body without its cookie, no longer passes the gate (it gets a fresh pending id instead): knowing the id is not enough. Rows approved before this release stay NULL until their first
--   sign-in, which issues the cookie and sets the column, so nobody is locked out by the transition.
-- idx_trusted_devices_device: the shared-device check in routes/auth.ts (device_id = ? AND user_id != ?) had no index and scanned the table on every employee sign-in.
--
-- PRE:  trusted_devices and user_sessions exist; shop_devices, the three new indexes, user_sessions.shop_device_id and trusted_devices.cookie_bound_at do not. A failed check reads a malformed JSON path and aborts the file.
-- POST: trusted_devices.cookie_bound_at exists and is NULL on every row; shop_devices has 12 columns and is empty; user_sessions.shop_device_id exists with no non-NULL value; the three indexes exist with the stated predicates; trusted_devices and user_sessions row counts are unchanged.
-- Cost: one index row per trusted_devices insert; shop_devices is written when an administrator marks or unmarks a till and, throttled, by a shop sign-in; one extra column and (partial) index row only on shop sign-ins.
-- Append-only, LF-only, rowid kept (no WITHOUT ROWID: it breaks backups), generic (no client data). Idempotent only through the PRE check (a second run aborts on the existing table).
-- Deploy order: MIGRATION FIRST. The new Worker's sign-in reads shop_devices on every employee sign-in and names user_sessions.shop_device_id on a shop sign-in.
-- Rollback-safe: the previous Worker never names the table, the column or the indexes and runs unchanged on the new schema.
-- Pinned by scripts/test-migration-0304-shop-devices-pure.cjs and scripts/test-shop-device-pure.cjs.
--
-- RECOVERY: schema only, nothing to restore. To switch the feature off without a code change: UPDATE shop_devices SET unmarked_at = CURRENT_TIMESTAMP WHERE unmarked_at IS NULL; then
--   UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE shop_device_id IS NOT NULL AND revoked_at IS NULL;
-- Full undo (only if nothing depends on it):
--   DROP INDEX IF EXISTS idx_user_sessions_shop_device;
--   DROP INDEX IF EXISTS idx_trusted_devices_device;
--   DROP TABLE IF EXISTS shop_devices;
--   (the user_sessions.shop_device_id column stays; an unused nullable column is harmless.)

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('trusted_devices', 'user_sessions')) = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('shop_devices', 'idx_shop_devices_active', 'idx_user_sessions_shop_device', 'idx_trusted_devices_device')) = 0
  AND (SELECT COUNT(*) FROM pragma_table_info('user_sessions') WHERE name = 'shop_device_id') = 0
  AND (SELECT COUNT(*) FROM pragma_table_info('trusted_devices') WHERE name = 'cookie_bound_at') = 0
THEN 1 ELSE json_extract('[]','$[shop_devices_0304_pre]') END;

CREATE TABLE shop_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  label TEXT NOT NULL,
  marked_by_user_id INTEGER,
  marked_by_name TEXT,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unmarked_at TEXT,
  unmarked_by_user_id INTEGER,
  unmarked_by_name TEXT,
  last_seen_at TEXT,
  last_ip TEXT,
  last_country TEXT
);

CREATE UNIQUE INDEX idx_shop_devices_active ON shop_devices (device_id) WHERE unmarked_at IS NULL;

ALTER TABLE user_sessions ADD COLUMN shop_device_id INTEGER;

CREATE INDEX idx_user_sessions_shop_device ON user_sessions (shop_device_id) WHERE shop_device_id IS NOT NULL;

ALTER TABLE trusted_devices ADD COLUMN cookie_bound_at TEXT;

CREATE INDEX idx_trusted_devices_device ON trusted_devices (device_id);

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('shop_devices')) = 12
  AND (SELECT COUNT(*) FROM shop_devices) = 0
  AND (SELECT COUNT(*) FROM pragma_table_info('user_sessions') WHERE name = 'shop_device_id') = 1
  AND (SELECT COUNT(*) FROM user_sessions WHERE shop_device_id IS NOT NULL) = 0
  AND (SELECT COUNT(*) FROM pragma_table_info('trusted_devices') WHERE name = 'cookie_bound_at') = 1
  AND (SELECT COUNT(*) FROM trusted_devices WHERE cookie_bound_at IS NOT NULL) = 0
  AND (SELECT COUNT(*) FROM pragma_index_list('shop_devices') WHERE name = 'idx_shop_devices_active' AND "unique" = 1 AND partial = 1) = 1
  AND (SELECT COUNT(*) FROM pragma_index_list('user_sessions') WHERE name = 'idx_user_sessions_shop_device' AND partial = 1) = 1
  AND (SELECT COUNT(*) FROM pragma_index_xinfo('idx_trusted_devices_device') WHERE key = 1 AND name = 'device_id') = 1
THEN 1 ELSE json_extract('[]','$[shop_devices_0304_post]') END;
