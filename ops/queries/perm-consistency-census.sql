-- perm-consistency-census: every role and user permission SHAPE that migration 0270 (lane 6.0.967, owner ruling 21 Oct 2026
-- "Full = main access only; extras are separate") touches, with how many principals hold it. Read-only, SELECT only.
-- The Worker used to IMPLY grants from a module grant; 0270 writes each one out so nothing changes for anyone. One row per shape:
--   kind                 role | user (a user is judged on its role merged with its own text: {...role, ...user}, as lib/permissions.ts does)
--   admin                1 when role code is admin (any case or padding) or the merged all is JSON true: never written
--   settings             merged settings: true | view | false | other (any other JSON value) | absent
--   inventory            merged inventory: true | review | other | absent
--   count_sessions       merged inventory_checks: true | false | other (null, a string, a number) | absent. ABSENT means "follows Inventory" today
--   dormant_grant        1 when the merged drive_credentials is true WITHOUT Settings Full, or ANY ai_providers key is stored. Both did NOTHING
--                        before (no Worker reader granted from them); the migration overwrites them with what the old rules granted (false unless
--                        Settings Full), so effective access is unchanged. These are the rows the design called "can't map".
--   own_touched_keys     1 when a USER's own text names a key the migration may write (an override: the migration writes the user key by key)
--   principals           how many principals have this shape; total_principals is the whole table (roles + users)
--   writes_extras        1 when the migration writes the ten extras (business_identity, sales_policy, receipt_settings, portal_posts, portal_faq,
--                        portal_about, customer_portal, library, drive_credentials, ai_providers): a Settings Full, non-admin principal
--   writes_count_sessions  1 when count sessions currently follow Inventory (inventory_checks absent, Inventory true or review): inventory_checks
--                        and the nine field switches are written from what Inventory Full implied
--   neutralises_dormant  1 when a dormant grant is overwritten
-- Only the shape (JSON value types) is read, never a name, phone, e-mail, password, token or the permission text itself.
-- Expected: dormant_grant = 0 everywhere is the quiet case; any row with dormant_grant = 1 is a stored grant that never worked and is set to false.
-- ops:min-rows 1
-- ops:max-rows 400
WITH p AS MATERIALIZED (
  SELECT 'role' AS kind, r.id AS pid, lower(trim(COALESCE(r.code, ''))) AS rc,
    (CASE WHEN json_valid(r.permissions) AND json_type(r.permissions) = 'object' THEN r.permissions ELSE '{}' END) AS rb, '{}' AS ub
  FROM roles r
  UNION ALL
  SELECT 'user', u.id, lower(trim(COALESCE(r.code, ''))),
    (CASE WHEN json_valid(r.permissions) AND json_type(r.permissions) = 'object' THEN r.permissions ELSE '{}' END), (CASE WHEN json_valid(u.permissions) AND json_type(u.permissions) = 'object' THEN u.permissions ELSE '{}' END)
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
),
q AS MATERIALIZED (
  SELECT kind, pid, rc,
    COALESCE(json_type(ub, '$."all"'), json_type(rb, '$."all"')) AS all_t, COALESCE(json_type(ub, '$."settings"'), json_type(rb, '$."settings"')) AS settings_t, COALESCE(json_type(ub, '$."inventory"'), json_type(rb, '$."inventory"')) AS inventory_t,
    (CASE WHEN json_type(ub, '$.inventory') IS NOT NULL THEN json_extract(ub, '$.inventory') ELSE json_extract(rb, '$.inventory') END) AS inventory_v,
    (CASE WHEN json_type(ub, '$.settings') IS NOT NULL THEN json_extract(ub, '$.settings') ELSE json_extract(rb, '$.settings') END) AS settings_v,
    COALESCE(json_type(ub, '$."inventory_checks"'), json_type(rb, '$."inventory_checks"')) AS ic_t,
    COALESCE(json_type(ub, '$."drive_credentials"'), json_type(rb, '$."drive_credentials"')) AS dc_t, COALESCE(json_type(ub, '$."ai_providers"'), json_type(rb, '$."ai_providers"')) AS ai_t,
    (json_type(ub, '$."business_identity"') IS NOT NULL OR json_type(ub, '$."sales_policy"') IS NOT NULL OR json_type(ub, '$."receipt_settings"') IS NOT NULL OR json_type(ub, '$."portal_posts"') IS NOT NULL OR json_type(ub, '$."portal_faq"') IS NOT NULL OR json_type(ub, '$."portal_about"') IS NOT NULL OR json_type(ub, '$."customer_portal"') IS NOT NULL OR json_type(ub, '$."library"') IS NOT NULL OR json_type(ub, '$."drive_credentials"') IS NOT NULL OR json_type(ub, '$."ai_providers"') IS NOT NULL OR json_type(ub, '$."inventory_checks"') IS NOT NULL OR json_type(ub, '$."inventory_checks:view"') IS NOT NULL OR json_type(ub, '$."inventory_checks:check"') IS NOT NULL OR json_type(ub, '$."inventory:view"') IS NOT NULL OR json_type(ub, '$."inventory:check"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_price"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_barcode"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_category"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_brand"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_stock"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_received"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_sales"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_customers"') IS NOT NULL OR json_type(ub, '$."inventory_check_show_cost"') IS NOT NULL) AS own_touched
  FROM p
),
s AS MATERIALIZED (
  SELECT kind,
    (rc = 'admin' OR all_t IS 'true') AS admin,
    (CASE WHEN settings_t IS 'true' THEN 'true' WHEN settings_t IS 'text' AND settings_v IS 'view' THEN 'view' WHEN settings_t IS 'false' THEN 'false'
      WHEN settings_t IS NULL THEN 'absent' ELSE 'other' END) AS settings,
    (CASE WHEN inventory_t IS 'true' THEN 'true' WHEN inventory_t IS 'text' AND inventory_v IS 'review' THEN 'review' WHEN inventory_t IS NULL THEN 'absent' ELSE 'other' END) AS inventory,
    (CASE WHEN ic_t IS NULL THEN 'absent' WHEN ic_t IN ('true', 'false') THEN ic_t ELSE 'other' END) AS count_sessions,
    ((dc_t IS 'true' AND settings_t IS NOT 'true') OR ai_t IS NOT NULL) AS dormant_grant,
    (kind = 'user' AND own_touched) AS own_touched_keys
  FROM q
)
SELECT kind, admin, settings, inventory, count_sessions, dormant_grant, own_touched_keys,
  COUNT(*) AS principals,
  (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM users) AS total_principals,
  (admin = 0 AND settings = 'true') AS writes_extras,
  (admin = 0 AND count_sessions = 'absent' AND inventory IN ('true', 'review')) AS writes_count_sessions,
  (admin = 0 AND dormant_grant) AS neutralises_dormant
FROM s
GROUP BY kind, admin, settings, inventory, count_sessions, dormant_grant, own_touched_keys
ORDER BY kind, admin, settings, inventory, count_sessions, dormant_grant, own_touched_keys;
