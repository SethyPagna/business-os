-- SCAN2 BP-13 / BP-10 / BP-7: writes a non-admin made through a limit that holds
-- only on screen. The Worker lets a Settings-Full non-admin save the sales-policy
-- keys and the Telegram automation keys the Settings page hides from them
-- (routes/settings.ts settingsPermissionRefusal reads only hasPermission(user,
-- 'settings')), and the per-row product delete ran a bulk selection without
-- products:bulk_delete. The last is gated now (routes/products.ts getActionTier
-- 'bulk_delete'), so its arm only finds bursts from before that gate and is
-- bounded by the audit retention. BP-12 ("Add variant" without products:add) is
-- retired: POST /api/products/variant refuses it (routes/products.ts, getActionTier
-- 'add'), so a role with the grant off is no longer an exposure.
-- Actor = audit_logs.user_id, judged by TODAY's role and overrides, merged as
-- lib/permissions.ts does (user keys win over role keys; admin = role code
-- 'admin' or all = true); a role changed since the write is a false candidate.
-- audit_logs keeps about 21 days (lib/audit.ts DEFAULT_AUDIT_LOG_RETENTION_DAYS).
-- kind:
--   settings_sales_policy  a change to exchange_rate, change_exchange_rate,
--                          tax_rate, sale_amendment_window_minutes or
--                          pos_payment_methods (the settings save, the payment
--                          method backfill, or a payment method replace)
--   settings_telegram      a change to a telegram_* key by a signed-in user
--   product_delete_burst   5 or more product deletes in one minute by an actor
--                          whose products:bulk_delete is switched off
-- Columns: kind, actor_user_id, role_code, detail (the setting key, or the UTC
--   minute), events, first_at, last_at, first_audit_id, last_audit_id
-- Repair (proposed, not run): review each changed setting with the owner and
-- re-save it from an admin account; restore deleted products from the Removed
-- list (soft delete, undoable); never by SQL.
-- Ids, role codes, setting keys, times and counts only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH actors AS MATERIALIZED (
  SELECT u.id AS user_id, lower(trim(COALESCE(r.code, ''))) AS role_code,
    CASE WHEN json_valid(u.permissions) AND json_type(u.permissions) = 'object' THEN u.permissions ELSE '{}' END AS own,
    CASE WHEN json_valid(r.permissions) AND json_type(r.permissions) = 'object' THEN r.permissions ELSE '{}' END AS inherited
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
),
non_admin AS MATERIALIZED (
  SELECT user_id, role_code,
    COALESCE(json_type(own, '$."products:bulk_delete"'), json_type(inherited, '$."products:bulk_delete"')) AS bulk_delete_grant
  FROM actors
  WHERE role_code <> 'admin' AND COALESCE(json_type(own, '$.all'), json_type(inherited, '$.all'), '') <> 'true'
),
setting_changes AS MATERIALIZED (
  SELECT a.id, a.user_id, a.created_at, k.key AS setting_key
  FROM audit_logs a,
    json_each(CASE WHEN json_valid(a.new_value) AND json_type(a.new_value) = 'object' THEN a.new_value ELSE '{}' END) k
  WHERE a.entity = 'settings' AND a.user_id IS NOT NULL
    AND (k.key IN ('exchange_rate', 'change_exchange_rate', 'tax_rate', 'sale_amendment_window_minutes', 'pos_payment_methods')
      OR substr(k.key, 1, 9) = 'telegram_')
  UNION ALL
  SELECT a.id, a.user_id, a.created_at, 'pos_payment_methods'
  FROM audit_logs a
  WHERE a.user_id IS NOT NULL AND a.new_value IS NOT NULL
    AND ((a.entity = 'settings' AND a.entity_id = 'pos_payment_methods') OR a.entity = 'payment_method')
),
delete_minutes AS MATERIALIZED (
  SELECT a.user_id, strftime('%Y-%m-%d %H:%M', a.created_at) AS minute, COUNT(*) AS events,
    MIN(a.created_at) AS first_at, MAX(a.created_at) AS last_at, MIN(a.id) AS first_audit_id, MAX(a.id) AS last_audit_id
  FROM audit_logs a
  WHERE a.action = 'delete' AND a.entity = 'product' AND a.user_id IS NOT NULL
  GROUP BY a.user_id, strftime('%Y-%m-%d %H:%M', a.created_at)
  HAVING COUNT(*) >= 5
)
SELECT CASE WHEN substr(c.setting_key, 1, 9) = 'telegram_' THEN 'settings_telegram' ELSE 'settings_sales_policy' END AS kind,
  c.user_id AS actor_user_id, n.role_code, c.setting_key AS detail, COUNT(*) AS events,
  MIN(c.created_at) AS first_at, MAX(c.created_at) AS last_at, MIN(c.id) AS first_audit_id, MAX(c.id) AS last_audit_id
FROM setting_changes c
JOIN non_admin n ON n.user_id = c.user_id
GROUP BY c.user_id, c.setting_key
UNION ALL
SELECT 'product_delete_burst', d.user_id, n.role_code, d.minute, d.events, d.first_at, d.last_at, d.first_audit_id, d.last_audit_id
FROM delete_minutes d
JOIN non_admin n ON n.user_id = d.user_id
WHERE n.bulk_delete_grant = 'false'
ORDER BY 1, 2, 4
LIMIT 2000
