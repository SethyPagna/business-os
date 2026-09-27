-- ops:min-rows 1
-- Admin census (read-only, SELECT only). Answers: which users are administrators
-- under the OLD rule (c5b28762: trimmed/lower-cased username 'admin' OR role
-- code 'admin' OR effective all grant) vs the NEW rule (FX-sec 87cd03f5: role
-- code 'admin' OR effective all grant), and how many ACTIVE, non-deleted users
-- hold administrator control under the NEW rule (must be >= 1 before deploy).
-- Effective all mirrors cloudflare/src/lib/permissions.ts: merged = {...role, ...user};
-- a user-level 'all' key (any value) wins over the role's; only JSON true counts;
-- invalid JSON / arrays / scalars count as {}. The trim set is JS String.trim()'s.
-- Selects no password, hash, token, OTP secret, e-mail, phone or Google field.
WITH ws(chars) AS (
  SELECT char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)
), base AS (
  SELECT u.id, u.username, r.code AS role_code, u.is_active,
         CASE WHEN u.deleted_at IS NULL THEN 0 ELSE 1 END AS is_deleted,
         CASE WHEN json_valid(u.permissions) AND json_type(u.permissions) = 'object'
              THEN json_type(u.permissions, '$.all') END AS user_all,
         CASE WHEN json_valid(r.permissions) AND json_type(r.permissions) = 'object'
              THEN json_type(r.permissions, '$.all') END AS role_all
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
), g AS (
  SELECT b.id, b.username, b.role_code, b.is_active, b.is_deleted,
         CASE WHEN b.user_all IS NOT NULL THEN (b.user_all = 'true')
              ELSE (COALESCE(b.role_all, '') = 'true') END AS has_all_grant,
         (lower(trim(COALESCE(b.role_code, ''), ws.chars)) = 'admin') AS admin_role,
         (lower(trim(COALESCE(b.username, ''), ws.chars)) = 'admin') AS named_admin
  FROM base b, ws
)
SELECT id, username, role_code, is_active, is_deleted, has_all_grant,
       (named_admin OR admin_role OR has_all_grant) AS admin_old_rule,
       (admin_role OR has_all_grant) AS admin_new_rule,
       (SELECT COUNT(*) FROM g WHERE is_active = 1 AND is_deleted = 0 AND (admin_role OR has_all_grant)) AS active_admins_new_rule,
       (SELECT COUNT(*) FROM g WHERE is_active = 1 AND is_deleted = 0 AND (named_admin OR admin_role OR has_all_grant)) AS active_admins_old_rule
FROM g
WHERE named_admin OR admin_role OR has_all_grant
ORDER BY id;
