-- Sales/Returns permission split (see lib/permissions.ts's ENTITY_PERMISSION_MAP
-- and routes/returns.ts): 'returns' is now its own permission key, independent
-- of 'sales', so Sales can stay Full/None-only while Returns can later get a
-- Review Required tier without the two being coupled.
--
-- Before this migration, every returns.ts endpoint accepted the shared 'sales'
-- key. Any role or user that already had permissions.sales = true (and no
-- explicit 'returns' key of its own) would otherwise silently lose Returns
-- access the moment the split ships, since returns.ts no longer accepts
-- 'sales' at all. This backfills permissions.returns = true onto exactly
-- those rows, preserving today's effective access.
--
-- Rows that already have an explicit 'returns' key (however it's set) are
-- left untouched -- this only fills in the gap for accounts that were
-- relying on the old shared key.

UPDATE roles
SET permissions = json_set(permissions, '$.returns', json('true'))
WHERE json_extract(permissions, '$.sales') = 1
  AND json_extract(permissions, '$.returns') IS NULL;

UPDATE users
SET permissions = json_set(permissions, '$.returns', json('true'))
WHERE json_extract(permissions, '$.sales') = 1
  AND json_extract(permissions, '$.returns') IS NULL;
