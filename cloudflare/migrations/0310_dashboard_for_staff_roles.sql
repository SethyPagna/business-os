-- 0310: the Dashboard for the Manager and Employee roles (owner, 15 Nov 2026).
--
-- Owner ruling: managers and employees may open the Dashboard. This reverses the 20 Oct 2026 rule that the Dashboard is off by
-- default for an Employee. An Employee views it only (no dashboard_export); a Manager keeps export. Cost, profit, margin, stock
-- value and removal loss stay admin-only on it (lib/acquisitionCostAccess.ts), whatever the stored grants say.
-- lib/roleDefaults.ts and the role editor preset carry the same values for a NEW installation; this file reaches the roles that
-- already exist, because ensureCoreDataInvariants() inserts Manager and Employee once and never rewrites them.
--
-- SCOPE: role rows only. A role is reached when lower(trim(code)) is 'manager' or 'employee' and its permissions are a valid JSON
-- OBJECT: $.dashboard becomes true; for an employee $.dashboard_export becomes false; for a manager $.dashboard_export becomes
-- true ONLY when the key is absent (an explicit stored value is kept). A duplicated dashboard or dashboard_export member (which
-- JSON.parse reads last-wins while SQLite reads first) is removed before the value is written, so both readers agree. A manager
-- whose dashboard_export is duplicated keeps the value JSON.parse reads (the last member), written once.
-- Admin, every other role, every other key and
-- every user are left untouched. Per-user overrides (users.permissions) win over the role and are deliberately not changed; the
-- number of users that hold their own dashboard or dashboard_export key is recorded below so the owner can review them.
--
-- Statement-splitter note: every CASE is parenthesised (wrangler closes a CASE only at END followed by a space or semicolon).
-- LF-only, append-only, generic (no client data). Re-running changes nothing: a conforming role is not selected again.
--
-- PRE:  count the roles this file will change; recorded in system_flags 'dashboard_staff_roles_0310_changed'. Nothing is asserted
--       about the count itself (a fresh database has none).
-- POST: no manager or employee role with a valid JSON object is left without exactly one dashboard = true, no such employee role
--       without exactly one dashboard_export = false, and no manager role without exactly one dashboard_export key.
--       Asserted below (the SELECT aborts the migration otherwise).
--       Also recorded: system_flags 'dashboard_staff_roles_0310_users_with_own_keys' = the number of users whose own permissions
--       carry a dashboard or dashboard_export key. Read both with:
--       SELECT key, value FROM system_flags WHERE key LIKE 'dashboard_staff_roles_0310_%';
-- RECOVERY: only role.permissions JSON and updated_at change. To undo for one role, restore its stored JSON from the in-app backup or
--       Time Travel, or set the keys back by hand, e.g.
--       UPDATE roles SET permissions = json_remove(permissions, '$.dashboard', '$.dashboard_export') WHERE id = <role id>;
--       (that returns the role to "no Dashboard", the state before this file, for a role that had neither key). The recorded flags
--       are informational and safe to delete.

INSERT OR REPLACE INTO system_flags (key, value, updated_at)
SELECT 'dashboard_staff_roles_0310_changed', CAST(COUNT(*) AS TEXT), CURRENT_TIMESTAMP
FROM roles
WHERE lower(trim(code)) IN ('manager', 'employee')
  AND (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object') ELSE 0 END)
  AND (json_extract(permissions, '$.dashboard') IS NOT 1
    OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard') > 1
    OR (lower(trim(code)) = 'employee' AND (json_extract(permissions, '$.dashboard_export') IS NOT 0 OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard_export') > 1))
    OR (lower(trim(code)) = 'manager' AND (json_type(permissions, '$.dashboard_export') IS NULL OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard_export') > 1)));

UPDATE roles
SET permissions = (CASE WHEN lower(trim(code)) = 'employee'
      THEN json_set(json_remove(permissions, '$.dashboard', '$.dashboard', '$.dashboard', '$.dashboard', '$.dashboard_export', '$.dashboard_export', '$.dashboard_export', '$.dashboard_export'), '$.dashboard', json('true'), '$.dashboard_export', json('false'))
      ELSE json_insert(json_set((CASE WHEN (SELECT COUNT(*) FROM json_each(permissions) AS e WHERE e.key = 'dashboard_export') > 1
          THEN json_remove(permissions, '$.dashboard', '$.dashboard', '$.dashboard', '$.dashboard', '$.dashboard_export', '$.dashboard_export', '$.dashboard_export', '$.dashboard_export')
          ELSE json_remove(permissions, '$.dashboard', '$.dashboard', '$.dashboard', '$.dashboard') END), '$.dashboard', json('true')),
        '$.dashboard_export', json((CASE WHEN (SELECT e.type FROM json_each(permissions) AS e WHERE e.key = 'dashboard_export' ORDER BY e.id DESC LIMIT 1) = 'false' THEN 'false' ELSE 'true' END))) END),
    updated_at = CURRENT_TIMESTAMP
WHERE lower(trim(code)) IN ('manager', 'employee')
  AND (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object') ELSE 0 END)
  AND (json_extract(permissions, '$.dashboard') IS NOT 1
    OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard') > 1
    OR (lower(trim(code)) = 'employee' AND (json_extract(permissions, '$.dashboard_export') IS NOT 0 OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard_export') > 1))
    OR (lower(trim(code)) = 'manager' AND (json_type(permissions, '$.dashboard_export') IS NULL OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard_export') > 1)));

SELECT (CASE WHEN (SELECT COUNT(*) FROM roles
    WHERE lower(trim(code)) IN ('manager', 'employee')
      AND (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object') ELSE 0 END)
      AND (json_extract(permissions, '$.dashboard') IS NOT 1
        OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard') > 1
        OR (lower(trim(code)) = 'employee' AND (json_extract(permissions, '$.dashboard_export') IS NOT 0 OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard_export') > 1))
        OR (lower(trim(code)) = 'manager' AND (json_type(permissions, '$.dashboard_export') IS NULL OR (SELECT COUNT(*) FROM json_each((CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END)) AS e WHERE e.key = 'dashboard_export') > 1)))) = 0
THEN 1 ELSE json_extract('[]', '$[dashboard_staff_roles_0310_post]') END);

INSERT OR REPLACE INTO system_flags (key, value, updated_at)
SELECT 'dashboard_staff_roles_0310_users_with_own_keys', CAST(COUNT(*) AS TEXT), CURRENT_TIMESTAMP
FROM users
WHERE (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object'
      AND (json_type(permissions, '$.dashboard') IS NOT NULL OR json_type(permissions, '$.dashboard_export') IS NOT NULL)) ELSE 0 END);
