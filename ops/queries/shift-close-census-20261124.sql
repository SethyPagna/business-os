-- shift-close-census-20261124: why employees report no way to close a shift (24 Nov 2026).
-- READ-ONLY, SELECT only. No names, no cash, no notes, no reasons: one row per shift that is open now
-- or whose business day is on or after 2026-11-22, with the opener's and closer's role code, whether
-- the opener's effective permissions hold pos and shift_close_forgotten (merged = {...role, ...user},
-- only JSON true counts, as cloudflare/src/lib/permissions.ts), and the shift policy settings
-- (shift_scope_mode, shift_admin_exempt; cloudflare/src/routes/shifts.ts readShiftPolicy).
-- ops:min-rows 0
-- ops:max-rows 400
-- ops:max-rows-read 20000
WITH pol AS (
  SELECT
    (SELECT value FROM settings WHERE key = 'shift_scope_mode') AS policy_scope,
    (SELECT value FROM settings WHERE key = 'shift_admin_exempt') AS policy_admin_exempt
), perm AS (
  SELECT u.id,
    r.code AS role_code,
    CASE
      WHEN json_valid(u.permissions) AND json_type(u.permissions) = 'object' AND json_type(u.permissions, '$.pos') IS NOT NULL
        THEN json_type(u.permissions, '$.pos') = 'true'
      ELSE COALESCE(CASE WHEN json_valid(r.permissions) AND json_type(r.permissions) = 'object' THEN json_type(r.permissions, '$.pos') END, '') = 'true'
    END AS has_pos,
    CASE
      WHEN json_valid(u.permissions) AND json_type(u.permissions) = 'object' AND json_type(u.permissions, '$.shift_close_forgotten') IS NOT NULL
        THEN json_type(u.permissions, '$.shift_close_forgotten') = 'true'
      ELSE COALESCE(CASE WHEN json_valid(r.permissions) AND json_type(r.permissions) = 'object' THEN json_type(r.permissions, '$.shift_close_forgotten') END, '') = 'true'
    END AS has_late_close
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
)
SELECT s.id, s.scope_mode, s.business_date, s.branch_id,
  (s.parent_shift_id IS NOT NULL) AS reopened,
  strftime('%Y-%m-%d %H:%M', s.opened_at, '+7 hours') AS opened_kh,
  strftime('%Y-%m-%d %H:%M', s.closed_at, '+7 hours') AS closed_kh,
  strftime('%Y-%m-%d %H:%M', s.cancelled_at, '+7 hours') AS cancelled_kh,
  s.user_id AS opener_id, po.role_code AS opener_role, po.has_pos AS opener_pos, po.has_late_close AS opener_late_close,
  s.closed_by_user_id AS closer_id, pc.role_code AS closer_role,
  pol.policy_scope, pol.policy_admin_exempt
FROM shift_sessions s
CROSS JOIN pol
LEFT JOIN perm po ON po.id = s.user_id
LEFT JOIN perm pc ON pc.id = s.closed_by_user_id
WHERE (s.closed_at IS NULL AND s.cancelled_at IS NULL) OR s.business_date >= '2026-11-22'
ORDER BY s.id DESC
LIMIT 400;
