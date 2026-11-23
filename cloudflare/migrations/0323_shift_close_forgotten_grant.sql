-- 0323: the "Close forgotten shifts" grant for the Manager role (owner, 23 Nov 2026, A75).
--
-- A shift left open on an earlier day may be closed by the cashier who opened it, an administrator, or anyone holding
-- $."shift_close_forgotten" = true (role editor: Close forgotten shifts). The lead set it ON for Manager and OFF for Employee.
-- lib/roleDefaults.ts and the role editor preset carry the same values for a NEW installation; this file reaches the Manager roles
-- that already exist, because ensureCoreDataInvariants() inserts Manager and Employee once and never rewrites them (same reason as 0310).
--
-- SCOPE: role rows with lower(trim(code)) = 'manager' and a valid JSON OBJECT in permissions. The key is written true ONLY when it is
-- absent (json_insert never overwrites an explicit true or false). Employee stays absent, which the Worker reads as OFF. Admin, every
-- other role, every other key and every user (users.permissions) are left untouched.
-- Statement-splitter note: every CASE is parenthesised. LF-only, append-only, generic (no client data). A re-run changes nothing.
--
-- PRE:  the number of roles this file will change is recorded in system_flags 'shift_close_forgotten_0323_changed'.
-- POST: no manager role with a valid JSON object is left without a shift_close_forgotten member (the SELECT aborts the migration otherwise).
--       Read the flag with: SELECT key, value FROM system_flags WHERE key = 'shift_close_forgotten_0323_changed';
-- RECOVERY: only roles.permissions and updated_at change. To undo for one role:
--       UPDATE roles SET permissions = json_remove(permissions, '$.shift_close_forgotten') WHERE id = <role id>;
--       The recorded flag is informational and safe to delete.

INSERT OR REPLACE INTO system_flags (key, value, updated_at)
SELECT 'shift_close_forgotten_0323_changed', CAST(COUNT(*) AS TEXT), CURRENT_TIMESTAMP
FROM roles
WHERE lower(trim(code)) = 'manager'
  AND (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object') ELSE 0 END)
  AND json_type(permissions, '$.shift_close_forgotten') IS NULL;

UPDATE roles
SET permissions = json_insert(permissions, '$.shift_close_forgotten', json('true')),
    updated_at = CURRENT_TIMESTAMP
WHERE lower(trim(code)) = 'manager'
  AND (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object') ELSE 0 END)
  AND json_type(permissions, '$.shift_close_forgotten') IS NULL;

SELECT (CASE WHEN (SELECT COUNT(*) FROM roles
    WHERE lower(trim(code)) = 'manager'
      AND (CASE WHEN json_valid(permissions) THEN (json_type(permissions) = 'object') ELSE 0 END)
      AND json_type(permissions, '$.shift_close_forgotten') IS NULL) = 0
THEN 1 ELSE json_extract('[]', '$[shift_close_forgotten_0323_post]') END);
