-- Part 543: system_flags -- tiny key/value store for runtime flags that
-- must SURVIVE a backup restore. `settings` cannot host these: it is the
-- first entry in BACKUP_TABLES, so a restore DELETEs it mid-operation --
-- the maintenance flag guarding that very restore would wipe itself.
-- Deliberately EXCLUDED from BACKUP_TABLES (see lib/backup.ts's exclusion
-- comment): these are live runtime state, never business data.
CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
