-- Schema-only: no sales, money or stock backfill. Revisions start at zero.
-- Pre/post: compare sales counts and stock/money sums; they must be identical.
-- Recovery: roll back code, retain these tables and snapshots; never drop replay data.
CREATE TABLE sale_write_revisions (sale_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sale_bulk_operations (
 id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, request_id TEXT NOT NULL,
 request_json TEXT NOT NULL, snapshot_id INTEGER REFERENCES undo_snapshots(id),
 history_id INTEGER REFERENCES action_history(id), generation INTEGER NOT NULL DEFAULT 0,
 receipt_json TEXT NOT NULL, UNIQUE(actor_id, request_id)
);
CREATE TABLE sale_bulk_members (
 operation_id TEXT NOT NULL REFERENCES sale_bulk_operations(id), sale_id INTEGER NOT NULL,
 revision INTEGER NOT NULL, movement_fingerprint TEXT NOT NULL, PRIMARY KEY(operation_id, sale_id)
);
CREATE TABLE sale_bulk_guards (id INTEGER PRIMARY KEY, guard_value INTEGER NOT NULL CHECK(guard_value = 1));
CREATE INDEX idx_sales_cancel_fee_revision ON sales(cancel_fee_id) WHERE cancel_fee_id IS NOT NULL;
CREATE TRIGGER sale_revision_sales_insert AFTER INSERT ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.id, 1 WHERE NEW.id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sales_update AFTER UPDATE ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.id AS sale_id UNION SELECT NEW.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sales_delete AFTER DELETE ON sales
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.id, 1 WHERE OLD.id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_items_insert AFTER INSERT ON sale_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_items_update AFTER UPDATE ON sale_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT NEW.sale_id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_items_delete AFTER DELETE ON sale_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_item_batch_allocations_insert AFTER INSERT ON sale_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM sale_items WHERE id = NEW.sale_item_id), 1 WHERE (SELECT sale_id FROM sale_items WHERE id = NEW.sale_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_item_batch_allocations_update AFTER UPDATE ON sale_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT (SELECT sale_id FROM sale_items WHERE id = OLD.sale_item_id) AS sale_id UNION SELECT (SELECT sale_id FROM sale_items WHERE id = NEW.sale_item_id)) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_item_batch_allocations_delete AFTER DELETE ON sale_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM sale_items WHERE id = OLD.sale_item_id), 1 WHERE (SELECT sale_id FROM sale_items WHERE id = OLD.sale_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_returns_insert AFTER INSERT ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_returns_update AFTER UPDATE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT NEW.sale_id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_returns_delete AFTER DELETE ON returns
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_return_items_insert AFTER INSERT ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM returns WHERE id = NEW.return_id), 1 WHERE (SELECT sale_id FROM returns WHERE id = NEW.return_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_return_items_update AFTER UPDATE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT (SELECT sale_id FROM returns WHERE id = OLD.return_id) AS sale_id UNION SELECT (SELECT sale_id FROM returns WHERE id = NEW.return_id)) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_return_items_delete AFTER DELETE ON return_items
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT sale_id FROM returns WHERE id = OLD.return_id), 1 WHERE (SELECT sale_id FROM returns WHERE id = OLD.return_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_return_item_batch_allocations_insert AFTER INSERT ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = NEW.return_item_id), 1 WHERE (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = NEW.return_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_return_item_batch_allocations_update AFTER UPDATE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = OLD.return_item_id) AS sale_id UNION SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = NEW.return_item_id)) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_return_item_batch_allocations_delete AFTER DELETE ON return_item_batch_allocations
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = OLD.return_item_id), 1 WHERE (SELECT r.sale_id FROM returns r JOIN return_items ri ON ri.return_id = r.id WHERE ri.id = OLD.return_item_id) IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_amendments_insert AFTER INSERT ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_amendments_update AFTER UPDATE ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision)
 SELECT sale_id, 1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT NEW.sale_id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_sale_amendments_delete AFTER DELETE ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER sale_revision_fees_insert AFTER INSERT ON fees
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) SELECT sale_id,1 FROM (SELECT NEW.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=NEW.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER sale_revision_fees_update AFTER UPDATE ON fees
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) SELECT sale_id,1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=OLD.id UNION SELECT NEW.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=NEW.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER sale_revision_fees_delete AFTER DELETE ON fees
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
 INSERT INTO sale_write_revisions(sale_id,revision) SELECT sale_id,1 FROM (SELECT OLD.sale_id AS sale_id UNION SELECT id FROM sales WHERE cancel_fee_id=OLD.id) WHERE sale_id IS NOT NULL
 ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1;
END;
