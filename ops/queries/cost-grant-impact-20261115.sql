-- cost-grant-impact-20261115: read-only census before the admin-only cost deploy (owner, 15 Nov 2026).
-- Who still holds the retired product cost grants, whether the recorded Drive sync authoriser is an
-- administrator (canAuthorizeDriveSync now needs cost view, which only an administrator has), how many
-- users carry their own Dashboard keys (migration 0310 leaves them alone) and the last applied migration.
-- One row of scalar counts: D1 refuses compound SELECTs over 5 terms.
-- ops:min-rows 1
-- ops:max-rows-read 600
SELECT
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions)
    AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND json_type(permissions, '$.product_cost_view') = 'true') AS roles_non_admin_cost_view,
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions)
    AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND json_type(permissions, '$.product_cost_edit') = 'true') AS roles_non_admin_cost_edit,
  (SELECT group_concat(lower(trim(COALESCE(code, ''))), ',') FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin'
    AND json_valid(permissions) AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND (json_type(permissions, '$.product_cost_view') = 'true' OR json_type(permissions, '$.product_cost_edit') = 'true')) AS role_codes_with_cost_grant,
  (SELECT COUNT(*) FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL AND COALESCE(u.is_active, 0) = 1
      AND lower(trim(COALESCE(r.code, ''))) <> 'admin'
      AND COALESCE(json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.all'), '') <> 'true'
      AND COALESCE(json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.all'), '') <> 'true'
      AND (json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.product_cost_view') = 'true'
        OR json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.product_cost_edit') = 'true'
        OR json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.product_cost_view') = 'true'
        OR json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.product_cost_edit') = 'true')) AS active_non_admin_users_losing_cost,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND json_valid(permissions)
    AND (json_type(permissions, '$.dashboard') IS NOT NULL OR json_type(permissions, '$.dashboard_export') IS NOT NULL)) AS users_with_own_dashboard_keys,
  (SELECT COALESCE(NULLIF(trim(value), ''), 'none') FROM settings WHERE key = 'drive_sync_authorized_by') AS drive_authorizer_id,
  (SELECT CASE
      WHEN u.id IS NULL THEN 'missing'
      WHEN COALESCE(u.is_active, 0) <> 1 THEN 'inactive'
      WHEN lower(trim(COALESCE(r.code, ''))) = 'admin'
        OR json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.all') = 'true'
        OR json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.all') = 'true' THEN 'admin'
      ELSE 'non-admin:' || lower(trim(COALESCE(r.code, ''))) END
    FROM settings s LEFT JOIN users u ON u.id = CAST(s.value AS INTEGER) AND u.deleted_at IS NULL
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE s.key = 'drive_sync_authorized_by') AS drive_authorizer_kind,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS last_migration
