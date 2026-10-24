-- perm-extras-impact: read-only counts (no names) for the 6.0.967 Part A review (P1-1, P2-1). Migration 0270 writes the
-- settings extras for every non-admin Settings Full principal; pages that read an extra directly (Website Editor =
-- customer_portal, Receipt settings = receipt_settings, Promotions loyalty = customer_portal) would newly open for those
-- that lacked them. A stored Drive grant without Settings Full opened the Settings page and would be removed.
-- One row of scalar counts: D1 refuses compound SELECTs over 5 terms (sql-compound-too-long).
SELECT
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions)
    AND json_type(permissions, '$.settings') = 'true' AND COALESCE(json_type(permissions, '$.all'), '') <> 'true') AS role_settings_full_non_admin,
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions)
    AND json_type(permissions, '$.settings') = 'true' AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND COALESCE(json_type(permissions, '$.customer_portal'), '') <> 'true') AS role_sf_missing_customer_portal,
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions)
    AND json_type(permissions, '$.settings') = 'true' AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
    AND COALESCE(json_type(permissions, '$.receipt_settings'), '') <> 'true') AS role_sf_missing_receipt_settings,
  (SELECT COUNT(*) FROM users WHERE json_valid(permissions) AND json_type(permissions, '$.settings') = 'true') AS user_own_settings_true,
  (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(trim(COALESCE(r.code, ''))) <> 'admin'
    AND json_valid(r.permissions) AND json_type(r.permissions, '$.settings') = 'true') AS users_on_sf_roles,
  (SELECT COUNT(*) FROM roles WHERE json_valid(permissions) AND json_type(permissions, '$.drive_credentials') = 'true'
    AND COALESCE(json_type(permissions, '$.settings'), '') <> 'true')
  + (SELECT COUNT(*) FROM users WHERE json_valid(permissions) AND json_type(permissions, '$.drive_credentials') = 'true'
    AND COALESCE(json_type(permissions, '$.settings'), '') <> 'true') AS dormant_drive_rows,
  (SELECT COUNT(*) FROM roles WHERE json_valid(permissions) AND json_type(permissions, '$.ai_providers') IS NOT NULL)
  + (SELECT COUNT(*) FROM users WHERE json_valid(permissions) AND json_type(permissions, '$.ai_providers') IS NOT NULL) AS any_ai_providers_key;
