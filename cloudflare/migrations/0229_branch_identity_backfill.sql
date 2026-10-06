-- BRANCH-IDENTITY-BACKFILL: give the two operating branches the stable identity
-- 0223 introduced, before any cutover runs.
--
-- Sets role = canonical_key = 'shop' on the one active branch named Shop and
-- role = canonical_key = 'warehouse' on the one active branch named Warehouse.
-- The name is compared trimmed of the Worker's whitespace set and lower-cased,
-- the same rule as branchRoleFromName and sellingBranchConditionSql. That is
-- the only data rewritten: no other column of any branches row changes
-- (updated_at and successor_branch_id included), and no other table is written
-- except by the 0124 trigger stock_revision_branches_update, which bumps the
-- branch revision of each changed row. Behaviour-neutral: every role reader
-- uses COALESCE(role, name) or role-else-name, and role is set to the value it
-- already resolved to from the name. canonical_key is immutable once set (0223
-- trigger), so later code keys on it, never on the display name the cutover
-- will change.
--
-- A row whose role or canonical_key is already set is never touched, a key
-- another row already holds is never assigned again, and an inactive row is
-- never keyed. The file aborts (CHECK failure on branch_identity_guard_0229;
-- nothing applied) when a cutover is unfinished, when two active branches share
-- the name Shop or the name Warehouse, when a Shop/Warehouse-named row has an
-- is_active other than 0 or 1, when a row has only one of role/canonical_key,
-- or when, before any cutover, a row already carries an identity or successor
-- that is not exactly this backfill's. Re-applying it changes nothing. On a
-- fresh database it changes nothing (the setup seed runs after migrations).
-- Both helper tables it creates are dropped before it ends.
--
-- Pre-assert (Ops d1-export --command, never --file):
--   SELECT id, name, is_active, is_default, role, canonical_key,
--     successor_branch_id FROM branches ORDER BY id
--     -- expected: 1|Warehouse|1|<d>|NULL|NULL|NULL and 2|Shop|1|<d>|NULL|NULL|NULL
--   SELECT COUNT(*) FROM branch_cutovers         -- expected 0
--   SELECT COUNT(*) FROM sqlite_master
--     WHERE name IN ('branch_identity_guard_0229', 'branch_identity_preimage_0229')
--                                                -- expected 0
--   SELECT id, name, location, phone, manager, notes, is_default, is_active,
--     created_at, updated_at FROM branches ORDER BY id   (record it)
-- Post-assert:
--   SELECT id, role, canonical_key, successor_branch_id FROM branches ORDER BY id
--     -- expected: 1|warehouse|warehouse|NULL and 2|shop|shop|NULL
--   the recorded read above                      -- byte-identical
--   the sqlite_master query above                -- expected 0
--   SELECT COUNT(*) FROM branch_cutovers         -- expected 0
-- Deploy order: EITHER. No Worker in this release behaves differently: selling
--   and branchRole() resolve the same role from the name, and the cutover
--   parent (not wired to a route) is the only reader that requires the values.
--   Expected side effects: the content-derived branch edit ETag changes once,
--   so an open branch edit form must reload; open stock-session drafts reload
--   on the branch revision bump. Apply with the shop closed, like any migration.
-- Recovery:
--   role:  UPDATE branches SET role = NULL
--            WHERE id IN (1, 2) AND role IS canonical_key;
--   canonical_key is immutable by trigger (0223). To clear it, in ONE reviewed
--   migration and never while a branch_cutovers row is unfinished:
--     DROP TRIGGER branches_canonical_key_immutable;
--     UPDATE branches SET canonical_key = NULL, role = NULL WHERE id IN (1, 2);
--     then recreate branches_canonical_key_immutable byte-identically from 0223.
--   Nothing else to recover: no other column or table keeps data from this file.

CREATE TABLE branch_identity_guard_0229 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- Untyped columns keep every value exactly as stored. row_id, never branch_id.
CREATE TABLE branch_identity_preimage_0229 (
  row_id, name, location, phone, manager, notes, is_default, is_active,
  created_at, updated_at, role, canonical_key, successor_branch_id, name_key
);
INSERT INTO branch_identity_preimage_0229
SELECT id, name, location, phone, manager, notes, is_default, is_active,
  created_at, updated_at, role, canonical_key, successor_branch_id,
  CASE WHEN typeof(name) = 'text' THEN lower(trim(name, char(9, 10, 11, 12, 13, 32, 160, 5760,
    8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287,
    12288, 65279))) END
FROM branches;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'pre_no_unfinished_cutover',
  CASE WHEN NOT EXISTS (SELECT 1 FROM branch_cutovers WHERE phase NOT IN ('completed', 'aborted'))
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'pre_active_flag_known',
  CASE WHEN NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229
    WHERE name_key IN ('shop', 'warehouse') AND (is_active IS NULL OR is_active NOT IN (0, 1)))
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'pre_one_active_per_name',
  CASE WHEN (SELECT COUNT(*) FROM branch_identity_preimage_0229 WHERE is_active = 1 AND name_key = 'shop') <= 1
    AND (SELECT COUNT(*) FROM branch_identity_preimage_0229 WHERE is_active = 1 AND name_key = 'warehouse') <= 1
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'pre_identity_whole',
  CASE WHEN NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229
    WHERE (role IS NULL) <> (canonical_key IS NULL))
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'pre_identity_is_this_backfill_before_cutover',
  CASE WHEN EXISTS (SELECT 1 FROM branch_cutovers)
    OR NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229
      WHERE successor_branch_id IS NOT NULL OR (canonical_key IS NOT NULL
        AND NOT (role IS canonical_key AND canonical_key IS name_key AND is_active = 1)))
  THEN 1 ELSE 0 END;

UPDATE branches SET role = 'shop', canonical_key = 'shop'
WHERE role IS NULL AND canonical_key IS NULL AND successor_branch_id IS NULL AND is_active = 1
  AND id IN (SELECT row_id FROM branch_identity_preimage_0229 WHERE name_key = 'shop')
  AND NOT EXISTS (SELECT 1 FROM branches k WHERE k.canonical_key = 'shop');

UPDATE branches SET role = 'warehouse', canonical_key = 'warehouse'
WHERE role IS NULL AND canonical_key IS NULL AND successor_branch_id IS NULL AND is_active = 1
  AND id IN (SELECT row_id FROM branch_identity_preimage_0229 WHERE name_key = 'warehouse')
  AND NOT EXISTS (SELECT 1 FROM branches k WHERE k.canonical_key = 'warehouse');

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'post_rows_and_other_columns_unchanged',
  CASE WHEN (SELECT COUNT(*) FROM branches) = (SELECT COUNT(*) FROM branch_identity_preimage_0229)
    AND NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229 p LEFT JOIN branches b ON b.id = p.row_id
      WHERE b.id IS NULL OR b.name IS NOT p.name OR b.location IS NOT p.location OR b.phone IS NOT p.phone
        OR b.manager IS NOT p.manager OR b.notes IS NOT p.notes OR b.is_default IS NOT p.is_default
        OR b.is_active IS NOT p.is_active OR b.created_at IS NOT p.created_at
        OR b.updated_at IS NOT p.updated_at OR b.successor_branch_id IS NOT p.successor_branch_id)
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'post_existing_identity_unchanged',
  CASE WHEN NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229 p JOIN branches b ON b.id = p.row_id
    WHERE (p.role IS NOT NULL OR p.canonical_key IS NOT NULL)
      AND (b.role IS NOT p.role OR b.canonical_key IS NOT p.canonical_key))
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'post_new_identity_equals_name',
  CASE WHEN NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229 p JOIN branches b ON b.id = p.row_id
    WHERE p.role IS NULL AND p.canonical_key IS NULL AND (b.role IS NOT NULL OR b.canonical_key IS NOT NULL)
      AND NOT (b.role IS p.name_key AND b.canonical_key IS p.name_key AND p.is_active = 1
        AND p.successor_branch_id IS NULL))
  THEN 1 ELSE 0 END;

INSERT INTO branch_identity_guard_0229 (check_name, ok) SELECT 'post_operating_identity_complete',
  CASE WHEN NOT EXISTS (SELECT 1 FROM branch_identity_preimage_0229 p JOIN branches b ON b.id = p.row_id
    WHERE b.is_active = 1 AND p.name_key IN ('shop', 'warehouse') AND b.canonical_key IS NULL
      AND NOT EXISTS (SELECT 1 FROM branches k WHERE k.canonical_key = p.name_key))
  THEN 1 ELSE 0 END;

DROP TABLE branch_identity_preimage_0229;
DROP TABLE branch_identity_guard_0229;
