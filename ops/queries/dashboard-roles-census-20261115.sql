-- dashboard-roles-census-20261115: read-only facts migration 0310 and the admin-only cost rule depend on.
-- The live Manager and Employee roles' own Dashboard and courier keys, the configured landing page, and
-- open review rows a non-admin queued that could carry a cost (they now need an administrator).
-- One row of scalar values: D1 refuses compound SELECTs over 5 terms.
-- ops:min-rows 1
-- ops:max-rows-read 5000
SELECT
  (SELECT group_concat(lower(trim(code)) || ':' || COALESCE(json_type(permissions, '$.dashboard'), 'absent') || '/' || COALESCE(json_type(permissions, '$.dashboard_export'), 'absent'), ',')
     FROM roles WHERE lower(trim(COALESCE(code, ''))) IN ('manager', 'employee') AND json_valid(permissions)) AS staff_role_dashboard_keys,
  (SELECT group_concat(lower(trim(code)) || ':' || COALESCE(json_type(permissions, '$."sales:view_courier_cost"'), 'absent'), ',')
     FROM roles WHERE lower(trim(COALESCE(code, ''))) IN ('manager', 'employee') AND json_valid(permissions)) AS staff_role_courier_key,
  (SELECT COUNT(*) FROM roles WHERE lower(trim(COALESCE(code, ''))) IN ('manager', 'employee') AND NOT json_valid(permissions)) AS staff_roles_invalid_json,
  (SELECT COALESCE(NULLIF(trim(value), ''), 'unset') FROM settings WHERE key = 'default_landing_page') AS default_landing_page,
  (SELECT COUNT(*) FROM pending_actions WHERE status = 'open') AS open_review_rows,
  (SELECT group_concat(section || '/' || action_type || ':' || n, ',') FROM (SELECT section, action_type, COUNT(*) AS n FROM pending_actions WHERE status = 'open' GROUP BY section, action_type)) AS open_review_by_type,
  (SELECT COUNT(*) FROM pending_actions WHERE status = 'open' AND (payload_json LIKE '%cost%')) AS open_review_rows_mentioning_cost
