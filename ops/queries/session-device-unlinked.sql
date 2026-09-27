-- SEC1-01 detection (read-only, SELECT only). Live sessions that Devices ->
-- Revoke / Reject cannot reach by device id. POST /api/auth/session-duration
-- used to take the new session's device id from the request body, which the
-- app never sends, so saving "Default login duration" left a live row with
-- device_id NULL (or, for a crafted body, another device's id).
--   class a_family_null        re-issued since migration 0201 (limit_family_id
--                              set) with no device id while its sign-in has one.
--                              The FX-auth revoke reaches it once deployed.
--   class a_family_other       re-issued since 0201 with a device id different
--                              from its sign-in's. Also reached by that revoke.
--   class b_prefamily_reissue  no family link (minted before 0201), no device id,
--                              and a session_duration_updated audit row by the
--                              same user within 10 s of created_at. Device revoke
--                              cannot reach it even after the fix.
--   class c_signin_no_device   any other live row with no device id: a sign-in
--                              that carried none (old build), or a re-issue of
--                              one. Not this bug.
--   user_device_rows           trusted_devices rows of the account (0 = device
--                              approval never applied, e.g. administrators).
-- Selects no token hash, IP, user agent, device id or device name.
-- ops:min-rows 0
-- ops:max-rows 5000
WITH live AS (
  SELECT s.id, s.user_id, s.device_id, s.limit_family_id, s.created_at, s.last_seen_at, s.expires_at
  FROM user_sessions s
  WHERE s.revoked_at IS NULL AND julianday(s.expires_at) > julianday('now')
), reissue_audit AS (
  SELECT a.user_id, julianday(a.created_at) AS at
  FROM audit_logs a
  WHERE a.action = 'session_duration_updated'
), classified AS (
  SELECT l.id AS session_id, l.user_id, l.limit_family_id, l.created_at, l.last_seen_at, l.expires_at,
    CASE
      WHEN l.limit_family_id IS NOT NULL AND COALESCE(r.device_id, '') <> '' AND COALESCE(l.device_id, '') = '' THEN 'a_family_null'
      WHEN l.limit_family_id IS NOT NULL AND COALESCE(r.device_id, '') <> '' AND l.device_id <> r.device_id THEN 'a_family_other'
      WHEN COALESCE(l.device_id, '') <> '' THEN NULL
      WHEN l.limit_family_id IS NULL AND EXISTS (
        SELECT 1 FROM reissue_audit ra
        WHERE ra.user_id = l.user_id AND abs(ra.at - julianday(l.created_at)) <= 10.0 / 86400
      ) THEN 'b_prefamily_reissue'
      ELSE 'c_signin_no_device'
    END AS class
  FROM live l
  LEFT JOIN user_sessions r ON r.id = l.limit_family_id
)
SELECT c.session_id, c.user_id, u.username, ro.code AS role_code, u.is_active, c.class, c.limit_family_id,
  (SELECT COUNT(*) FROM trusted_devices td WHERE td.user_id = c.user_id) AS user_device_rows,
  c.created_at, c.last_seen_at, c.expires_at
FROM classified c
JOIN users u ON u.id = c.user_id
LEFT JOIN roles ro ON ro.id = u.role_id
WHERE c.class IS NOT NULL
ORDER BY c.class, c.user_id, c.session_id;
