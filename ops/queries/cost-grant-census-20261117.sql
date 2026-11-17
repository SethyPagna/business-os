-- cost-grant-census-20261117: read-only postflight census for the editable cost permission (owner, 17 Nov 2026).
-- The cost helpers answer from the product_cost_view / product_cost_edit grants again, so this reads who holds them
-- (non-admin roles, active non-admin users, role codes), the retired inventory_check_show_cost switch, the non-admin holders of the
-- backup keys (`backup` exports, `backup_restore` restores; both stay administrator only whatever the cost grants say), the recorded
-- Drive sync authoriser and the last applied migration.
-- The first columns keep the names of cost-grant-impact-20261115.sql; the two "holding" counts were "losing" counts there.
-- One row of scalar counts, no compound SELECT (D1 refuses more than 5 terms in one). Measured on the read-budget seed: 37 rows read
-- (19 for cost-grant-impact-20261115, which carries a 600 ceiling); 1200 leaves the same ~30x headroom for a real roles and users table.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 1200
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
  (SELECT COUNT(*) FROM roles WHERE json_valid(permissions)
    AND json_type(permissions, '$.inventory_check_show_cost') = 'true') AS roles_inventory_check_show_cost,
  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND json_valid(permissions)
    AND json_type(permissions, '$.inventory_check_show_cost') = 'true') AS users_inventory_check_show_cost,
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions)
    AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND (json_type(permissions, '$.backup') = 'true' OR json_type(permissions, '$.backup_restore') = 'true')) AS roles_non_admin_backup,
  (SELECT group_concat(lower(trim(COALESCE(code, ''))), ',') FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin'
    AND json_valid(permissions) AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND (json_type(permissions, '$.backup') = 'true' OR json_type(permissions, '$.backup_restore') = 'true')) AS role_codes_non_admin_backup,
  (SELECT COUNT(*) FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL AND COALESCE(u.is_active, 0) = 1
      AND lower(trim(COALESCE(r.code, ''))) <> 'admin'
      AND COALESCE(json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.all'), '') <> 'true'
      AND COALESCE(json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.all'), '') <> 'true'
      AND (json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.backup') = 'true'
        OR json_type(CASE WHEN json_valid(u.permissions) THEN u.permissions END, '$.backup_restore') = 'true'
        OR json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.backup') = 'true'
        OR json_type(CASE WHEN json_valid(r.permissions) THEN r.permissions END, '$.backup_restore') = 'true')) AS active_non_admin_users_backup,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS last_migration
