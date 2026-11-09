-- 0296 backfill permissions.online_orders = true onto the built-in Employee and Manager roles (KHQR lane, slice S5).
--
-- roleDefaults.ts gives Manager and Employee `online_orders: true` (owner, 9 Nov 2026: the front line handles online orders), but
-- ensureCoreDataInvariants() only rewrites the ADMIN role on every boot; Manager and Employee are inserted once and left alone as editable.
-- Every live Employee and Manager row therefore reads `online_orders` as ABSENT, which getActionTier / getPermissionTier treat as "none":
-- the staff routes of this slice would answer 403 for the very people the default is meant for. Same trap and same cure as 0172.
--
-- SCOPE: only code IN ('employee','manager') rows whose permissions JSON is valid and has NO online_orders key. An owner who already
-- switched it off (an explicit false) keeps that choice: json_extract(...) IS NULL is false for an explicit false. Admin ({"all":true}) and
-- custom roles are never touched (a custom role gets the key from the Permission Editor's own default when it is created).
-- IDEMPOTENT: after the first run every touched row carries the key, so the WHERE clause matches nothing the second time.
-- LF-only.
--
-- PRE:  SELECT id, code, json_extract(permissions,'$.online_orders') FROM roles WHERE code IN ('employee','manager');
--       Record the NULL rows (those are the ones this reaches) and SELECT COUNT(*) FROM roles.
-- POST: the same query reads 1 for every row that was NULL and is unchanged for every row that had a value; SELECT COUNT(*) FROM roles is
--       the same; re-running the file changes 0 rows.
-- Pinned by scripts/test-migration-0296-roles-online-orders-default-native.cjs.
--
-- RECOVERY: no column is dropped and no row deleted. To put the key back to absent:
--   UPDATE roles SET permissions = json_remove(permissions, '$.online_orders') WHERE code IN ('employee','manager');
--   (this also removes a value an owner set on purpose after this ran: prefer setting it to false in the Permission Editor.)

UPDATE roles
SET permissions = json_set(permissions, '$.online_orders', json('true')),
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('employee', 'manager')
  AND json_valid(permissions)
  AND json_extract(permissions, '$.online_orders') IS NULL;
