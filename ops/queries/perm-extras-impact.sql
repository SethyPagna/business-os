-- perm-extras-impact: read-only counts (no names) for the 6.0.967 Part A review (P1-1, P2-1). Migration 0270 writes the
-- settings extras for every non-admin Settings Full principal; pages that read an extra directly (Website Editor =
-- customer_portal, Receipt settings = receipt_settings, Promotions loyalty = customer_portal) would newly open for those
-- that lacked them. A stored Drive grant without Settings Full opened the Settings page and would be removed.
SELECT 'role_settings_full_non_admin' AS k, COUNT(*) AS n FROM roles
  WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions) AND json_type(permissions, '$.settings') = 'true'
    AND COALESCE(json_type(permissions, '$.all'), '') <> 'true'
UNION ALL SELECT 'role_sf_missing_customer_portal', COUNT(*) FROM roles
  WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions) AND json_type(permissions, '$.settings') = 'true'
    AND COALESCE(json_type(permissions, '$.all'), '') <> 'true' AND COALESCE(json_type(permissions, '$.customer_portal'), '') <> 'true'
UNION ALL SELECT 'role_sf_missing_receipt_settings', COUNT(*) FROM roles
  WHERE lower(trim(COALESCE(code, ''))) <> 'admin' AND json_valid(permissions) AND json_type(permissions, '$.settings') = 'true'
    AND COALESCE(json_type(permissions, '$.all'), '') <> 'true' AND COALESCE(json_type(permissions, '$.receipt_settings'), '') <> 'true'
UNION ALL SELECT 'user_own_settings_true', COUNT(*) FROM users
  WHERE json_valid(permissions) AND json_type(permissions, '$.settings') = 'true'
UNION ALL SELECT 'users_on_sf_roles', COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
  WHERE lower(trim(COALESCE(r.code, ''))) <> 'admin' AND json_valid(r.permissions) AND json_type(r.permissions, '$.settings') = 'true'
UNION ALL SELECT 'dormant_drive_rows', COUNT(*) FROM (SELECT permissions AS p FROM roles UNION ALL SELECT permissions FROM users)
  WHERE json_valid(p) AND json_type(p, '$.drive_credentials') = 'true' AND COALESCE(json_type(p, '$.settings'), '') <> 'true'
UNION ALL SELECT 'any_ai_providers_key', COUNT(*) FROM (SELECT permissions AS p FROM roles UNION ALL SELECT permissions FROM users)
  WHERE json_valid(p) AND json_type(p, '$.ai_providers') IS NOT NULL;
