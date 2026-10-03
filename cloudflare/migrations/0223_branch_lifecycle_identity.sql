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
