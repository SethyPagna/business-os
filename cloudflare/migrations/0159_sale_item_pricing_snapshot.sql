-- Additive provenance only; historical rows remain NULL and are never repriced.
-- Restore applications, not columns, on rollback. Retain a pre-migration backup.
ALTER TABLE sale_items ADD COLUMN pricing_snapshot_json TEXT;
