-- stock-state-census-stats-migrations-20261116: stock-state design Phase 0, census C11 and C12.
--   stat_tables          sqlite_stat* tables in the schema: production must have 0 (ANALYZE never ran; the design's trigger
--                        plans are pinned for a database WITHOUT statistics). Read from sqlite_master, so it never touches a
--                        table that might not exist.
--   has_stat1            1 when sqlite_stat1 itself exists
--   stock_state_objects  tables, indexes and triggers whose name starts with stock_state or stock_family: must be 0 before the
--                        new migration (its PRE assertion) and is the check that nothing was half applied
--   migrations_applied   rows of d1_migrations
--   max_migration_id     the highest d1_migrations.id
--   tail_1 .. tail_5     the five newest migration file names (newest first): the migration number authority for the new file
--   max_name_prefix      the highest four-digit prefix among the applied names (text, as stored)
-- File names only: no table size is a customer figure, no name or phone. Never ANALYZE, never a write. One row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 6000
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'sqlite_stat%') AS stat_tables,
  (SELECT COUNT(*) FROM sqlite_master WHERE name = 'sqlite_stat1') AS has_stat1,
  (SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'stock_state%' OR name LIKE 'stock_family%'
     OR name LIKE 'idx_stock_state%' OR name LIKE 'idx_stock_family%') AS stock_state_objects,
  (SELECT COUNT(*) FROM d1_migrations) AS migrations_applied,
  (SELECT MAX(id) FROM d1_migrations) AS max_migration_id,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1 OFFSET 0) AS tail_1,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1 OFFSET 1) AS tail_2,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1 OFFSET 2) AS tail_3,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1 OFFSET 3) AS tail_4,
  (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1 OFFSET 4) AS tail_5,
  (SELECT MAX(substr(name, 1, 4)) FROM d1_migrations) AS max_name_prefix
