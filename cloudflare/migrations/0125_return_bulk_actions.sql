-- Schema-only support for guarded, retry-idempotent grouped Return actions.
-- Pre/post: return, return_item, stock, damaged-lot and money totals are unchanged.
-- Recovery: roll back code and retain these tables/snapshots; never discard replay provenance.
-- A sale can be awaiting payment/delivery before its first return. Preserve
-- that exact state so cancelling the final return never guesses "completed".
ALTER TABLE sales ADD COLUMN status_before_return TEXT;

CREATE TABLE return_write_revisions (
  return_id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE return_bulk_operations (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  snapshot_id INTEGER REFERENCES undo_snapshots(id),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0,
  receipt_json TEXT NOT NULL,
  UNIQUE(actor_id, request_id)
);

CREATE TABLE return_bulk_members (
  operation_id TEXT NOT NULL REFERENCES return_bulk_operations(id),
  return_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  sale_id INTEGER,
  sale_revision INTEGER,
  stock_fingerprint TEXT NOT NULL,
  PRIMARY KEY(operation_id, return_id)
);

CREATE TABLE return_bulk_guards (
  id INTEGER PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK(guard_value = 1)
);

CREATE TRIGGER return_revision_returns_insert AFTER INSERT ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_returns_update AFTER UPDATE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM (SELECT OLD.id AS return_id UNION SELECT NEW.id) WHERE return_id IS NOT NULL
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_returns_delete AFTER DELETE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(OLD.id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_items_insert AFTER INSERT ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_items_update AFTER UPDATE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM (SELECT OLD.return_id AS return_id UNION SELECT NEW.return_id) WHERE return_id IS NOT NULL
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_items_delete AFTER DELETE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(OLD.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_allocations_insert AFTER INSERT ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM return_items WHERE id = NEW.return_item_id
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_allocations_update AFTER UPDATE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM return_items WHERE id IN (OLD.return_item_id, NEW.return_item_id)
  GROUP BY return_id
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_allocations_delete AFTER DELETE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM return_items WHERE id = OLD.return_item_id
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_damaged_insert AFTER INSERT ON damaged_stock_lots
WHEN NEW.return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_damaged_update AFTER UPDATE ON damaged_stock_lots
WHEN (OLD.return_id IS NOT NULL OR NEW.return_id IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision)
  SELECT return_id, 1 FROM (SELECT OLD.return_id AS return_id UNION SELECT NEW.return_id) WHERE return_id IS NOT NULL
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER return_revision_damaged_delete AFTER DELETE ON damaged_stock_lots
WHEN OLD.return_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(OLD.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;
