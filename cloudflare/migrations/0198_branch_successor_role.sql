-- 0198 (lane U-branch). Branch successor + explicit role + canonical sheet key.
--
-- Additive only: three nullable columns on branches and one new table. It
-- changes no stock and no behaviour by itself -- every branch stays active and
-- has no successor, so lib/branchSuccession.ts resolves every write to the
-- branch it was addressed to, exactly as before. Safe to ship in an ordinary
-- release. It is the prerequisite of the HELD move
-- ops/scripts/migration/held/0199_branch_consolidation_shop_into_store.sql,
-- which is applied separately, only on the owner's go.
--
-- Why these columns:
--   * role          -- the operational role ('shop' sells, 'warehouse' holds).
--                      Seeded from today's names, so nothing changes; the
--                      consolidation sets the survivor ("Store") to 'shop'.
--                      Code reads it through `SELECT * FROM branches` and falls
--                      back to the name when absent (branchRoles.ts branchRole).
--   * canonical_key -- the identity a row was created as ('shop'/'warehouse').
--                      It never changes on rename, so a stock sheet's `warehouse`
--                      column still finds the renamed row and its `shop` column
--                      still finds the retired one (then its successor).
--   * successor_branch_id -- where a retired branch's writes go. Data, never an
--                      id in code.
--   * branch_redirects -- the provenance of every redirected write: which record
--                      was addressed to which retired branch and where it
--                      landed. Written only when a redirect happens, which is
--                      only possible once this file has run.
--
-- PRE:  SELECT COUNT(*) FROM pragma_table_info('branches') WHERE name IN ('role','canonical_key','successor_branch_id'); -- 0
-- POST: the same query returns 3; every canonical row has role = canonical_key = lower(trim(name));
--       SELECT COUNT(*) FROM branch_redirects; -- 0
--       Production today (ids 1 Warehouse, 2 Shop) therefore reads
--       (1,'warehouse','warehouse',NULL) and (2,'shop','shop',NULL):
--       SELECT id, role, canonical_key, successor_branch_id FROM branches ORDER BY id;
--       A branch inserted AFTER this file (fresh local/test databases) has a
--       NULL role and key and is judged by its name, exactly as before.
-- RECOVERY: none needed for data (nothing is rewritten). The columns are inert
--       without a successor; leave them in place on a code rollback. If they
--       must go (only before 0199 has run -- 0199 depends on them):
--       DROP TRIGGER branches_successor_not_self_insert; DROP TRIGGER branches_successor_not_self_update;
--       DROP TABLE branch_redirects;
--       ALTER TABLE branches DROP COLUMN successor_branch_id; (then canonical_key, then role)

ALTER TABLE branches ADD COLUMN role TEXT CHECK (role IS NULL OR role IN ('shop', 'warehouse'));
ALTER TABLE branches ADD COLUMN canonical_key TEXT CHECK (canonical_key IS NULL OR canonical_key IN ('shop', 'warehouse'));
ALTER TABLE branches ADD COLUMN successor_branch_id INTEGER REFERENCES branches(id);

UPDATE branches
SET role = lower(trim(name)),
    canonical_key = lower(trim(name))
WHERE lower(trim(name)) IN ('shop', 'warehouse');

-- A successor must be a different branch.
CREATE TRIGGER branches_successor_not_self_insert BEFORE INSERT ON branches
WHEN NEW.successor_branch_id IS NOT NULL AND NEW.successor_branch_id = NEW.id
BEGIN SELECT RAISE(ABORT, 'a branch cannot be its own successor'); END;
CREATE TRIGGER branches_successor_not_self_update BEFORE UPDATE OF successor_branch_id ON branches
WHEN NEW.successor_branch_id IS NOT NULL AND NEW.successor_branch_id = NEW.id
BEGIN SELECT RAISE(ABORT, 'a branch cannot be its own successor'); END;

CREATE TABLE branch_redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  origin_branch_id INTEGER NOT NULL,
  origin_branch_name TEXT,
  target_branch_id INTEGER NOT NULL,
  target_branch_name TEXT,
  context TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (origin_branch_id <> target_branch_id)
);
CREATE INDEX idx_branch_redirects_entity ON branch_redirects(entity_type, entity_key);
CREATE INDEX idx_branch_redirects_origin ON branch_redirects(origin_branch_id, created_at);
