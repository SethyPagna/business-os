-- 0131: make public screenshot consent durable and remove legacy raw session
-- identifiers. Prepared only; do not apply remotely without user approval.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) AS session_rows_with_raw_identifiers FROM portal_sessions
--     WHERE last_ip IS NOT NULL OR user_agent IS NOT NULL;
--   SELECT COUNT(*) AS consent_columns FROM pragma_table_info('customer_share_submissions')
--     WHERE name IN ('rights_consent_version', 'privacy_consent_version', 'consent_at', 'consent_locale'); -- expect 0
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM portal_sessions WHERE last_ip IS NOT NULL OR user_agent IS NOT NULL; -- expect 0
--   SELECT COUNT(*) AS consent_columns FROM pragma_table_info('customer_share_submissions')
--     WHERE name IN ('rights_consent_version', 'privacy_consent_version', 'consent_at', 'consent_locale'); -- expect 4
--   SELECT COUNT(*) FROM portal_auth_lockouts WHERE scope IN ('signup', 'signin'); -- expect 0
--   SELECT COUNT(*) FROM rate_limit_events WHERE bucket LIKE 'portal:%'; -- expect 0
--
-- RECOVERY: the new nullable columns are append-only and safe for older code
-- to ignore. Clearing legacy raw identifiers and abuse rows is intentionally
-- irreversible privacy cleanup; it does not delete accounts, sessions,
-- submissions, points, or business records.

ALTER TABLE customer_share_submissions ADD COLUMN rights_consent_version TEXT;
ALTER TABLE customer_share_submissions ADD COLUMN privacy_consent_version TEXT;
ALTER TABLE customer_share_submissions ADD COLUMN consent_at TEXT;
ALTER TABLE customer_share_submissions ADD COLUMN consent_locale TEXT;

UPDATE portal_sessions SET last_ip = NULL, user_agent = NULL
WHERE last_ip IS NOT NULL OR user_agent IS NOT NULL;

DELETE FROM portal_auth_lockouts WHERE scope IN ('signup', 'signin');
DELETE FROM rate_limit_events WHERE bucket LIKE 'portal:%';
