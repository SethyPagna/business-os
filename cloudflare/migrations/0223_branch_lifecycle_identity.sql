-- BRANCH-LIFECYCLE: stable branch identity for the Shop/Warehouse roles, and the
-- expected entity state a pending action is checked against.
--
-- branches gains role ('shop'|'warehouse'), canonical_key (a stable key, unique
-- when set and immutable once set) and successor_branch_id (only on an
-- inactive, non-default branch, never itself). pending_actions gains
-- expected_entity_state_json (valid JSON or NULL). Every new column starts NULL,
-- so no data rewritten: every existing row keeps every value it had. A NULL
-- role keeps the legacy name-based Shop/Warehouse rule.
--
-- Pre-assert:  SELECT COUNT(*) FROM pragma_table_info('branches')
--                WHERE name IN ('role','canonical_key','successor_branch_id')
--                                              -- expected 0
--              SELECT COUNT(*) FROM pragma_table_info('pending_actions')
--                WHERE name = 'expected_entity_state_json'   -- expected 0
--              SELECT COUNT(*) FROM sqlite_master WHERE name IN
--                ('idx_branches_canonical_key','branches_canonical_key_immutable')
--                                              -- expected 0
--              SELECT COUNT(*) FROM branches (record it)
-- Post-assert: the same three queries          -- expected 3, 1, 2
--              SELECT COUNT(*) FROM branches   -- unchanged
--              SELECT COUNT(*) FROM branches WHERE role IS NOT NULL
--                OR canonical_key IS NOT NULL OR successor_branch_id IS NOT NULL
--                                              -- expected 0
--              SELECT COUNT(*) FROM pending_actions
--                WHERE expected_entity_state_json IS NOT NULL   -- expected 0
-- Deploy order: MIGRATION FIRST. POS and sale writes read branches.role with
--              no column probe, so the candidate Worker must not serve traffic
--              before this file. The previous Worker runs unchanged on the new
--              schema (new columns are NULL; the trigger fires only when a set
--              canonical_key changes).
-- Recovery:    roll the Worker back first, then
--              DROP TRIGGER IF EXISTS branches_canonical_key_immutable;
--              DROP INDEX IF EXISTS idx_branches_canonical_key;
--              ALTER TABLE pending_actions DROP COLUMN expected_entity_state_json;
--              ALTER TABLE branches DROP COLUMN successor_branch_id;
--              ALTER TABLE branches DROP COLUMN canonical_key;
--              ALTER TABLE branches DROP COLUMN role;
--              The trigger and the index must go before DROP COLUMN
--              canonical_key. Loses only role, key and successor values set
--              since; no other table changes.

ALTER TABLE branches ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('shop', 'warehouse'));
ALTER TABLE branches ADD COLUMN canonical_key TEXT CHECK (canonical_key IS NULL OR canonical_key IN ('shop', 'warehouse'));
ALTER TABLE branches ADD COLUMN successor_branch_id INTEGER REFERENCES branches(id)
  CHECK (successor_branch_id IS NULL OR (typeof(successor_branch_id) = 'integer' AND successor_branch_id > 0 AND successor_branch_id <> id AND is_active IS 0 AND is_default IS 0));
ALTER TABLE pending_actions ADD COLUMN expected_entity_state_json TEXT
  CHECK (expected_entity_state_json IS NULL OR json_valid(expected_entity_state_json));
CREATE UNIQUE INDEX idx_branches_canonical_key ON branches(canonical_key) WHERE canonical_key IS NOT NULL;
CREATE TRIGGER branches_canonical_key_immutable BEFORE UPDATE OF canonical_key ON branches
WHEN OLD.canonical_key IS NOT NULL AND NEW.canonical_key IS NOT OLD.canonical_key
BEGIN SELECT RAISE(ABORT, 'branch_canonical_key_immutable'); END;
