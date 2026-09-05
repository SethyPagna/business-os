-- Schema-only milestone A. No product, stock, batch, movement, audit or history backfill.
-- Pre/post: counts and sums in products/branch_stock/branch_batch_stock/product_batches must match.
-- Recovery: roll back code and retain operation/member/revision rows; never drop durable receipts.
CREATE TABLE stock_session_operations (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'stock_in'),
  request_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL DEFAULT '{}',
  snapshot_id INTEGER REFERENCES undo_snapshots(id),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_id)
);

CREATE TABLE stock_session_members (
  operation_id TEXT NOT NULL REFERENCES stock_session_operations(id),
  line_id TEXT NOT NULL,
  command_kind TEXT NOT NULL CHECK (command_kind IN ('receive', 'create_receive')),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_created INTEGER NOT NULL DEFAULT 0 CHECK (product_created IN (0, 1)),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  batch_id INTEGER REFERENCES product_batches(id),
  movement_id INTEGER REFERENCES inventory_movements(id),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_cost_usd REAL,
  PRIMARY KEY (operation_id, line_id)
);

CREATE TABLE stock_session_revisions (
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_key)
);

CREATE TABLE stock_session_guards (
  id INTEGER PRIMARY KEY,
  guard_value INTEGER NOT NULL CHECK (guard_value = 1)
);

CREATE INDEX idx_stock_session_members_product ON stock_session_members(product_id, operation_id);
CREATE INDEX idx_stock_session_members_batch ON stock_session_members(batch_id) WHERE batch_id IS NOT NULL;

CREATE TRIGGER stock_revision_products_insert AFTER INSERT ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_products_update AFTER UPDATE ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'product', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_products_delete AFTER DELETE ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branches_insert AFTER INSERT ON branches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_branches_update AFTER UPDATE ON branches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'branch', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_branches_delete AFTER DELETE ON branches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('branch_catalog', 'all', 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_suppliers_insert AFTER INSERT ON suppliers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('supplier', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_suppliers_update AFTER UPDATE ON suppliers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'supplier', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_suppliers_delete AFTER DELETE ON suppliers
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('supplier', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_file_assets_insert AFTER INSERT ON file_assets
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('asset', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_file_assets_update AFTER UPDATE ON file_assets
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'asset', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_file_assets_delete AFTER DELETE ON file_assets
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('asset', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_batches_insert AFTER INSERT ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('batch', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('batch_identity', CAST(NEW.variant_product_id AS TEXT) || ':' || NEW.batch_key, 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_product_batches_update AFTER UPDATE ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'batch', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'batch_identity', entity_key, 1 FROM (
    SELECT CAST(OLD.variant_product_id AS TEXT) || ':' || OLD.batch_key entity_key
    UNION SELECT CAST(NEW.variant_product_id AS TEXT) || ':' || NEW.batch_key
  )
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_product_batches_delete AFTER DELETE ON product_batches
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('batch', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('batch_identity', CAST(OLD.variant_product_id AS TEXT) || ':' || OLD.batch_key, 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_stock_insert AFTER INSERT ON branch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_stock', CAST(NEW.product_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_branch_stock_update AFTER UPDATE ON branch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'branch_stock', entity_key, 1 FROM (
    SELECT CAST(OLD.product_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT) entity_key
    UNION SELECT CAST(NEW.product_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT)
  ) WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_branch_stock_delete AFTER DELETE ON branch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_stock', CAST(OLD.product_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_branch_batch_stock_insert AFTER INSERT ON branch_batch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_batch_stock', CAST(NEW.batch_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_branch_batch_stock_update AFTER UPDATE ON branch_batch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'branch_batch_stock', entity_key, 1 FROM (
    SELECT CAST(OLD.batch_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT) entity_key
    UNION SELECT CAST(NEW.batch_id AS TEXT) || ':' || CAST(NEW.branch_id AS TEXT)
  ) WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_branch_batch_stock_delete AFTER DELETE ON branch_batch_stock
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  VALUES('branch_batch_stock', CAST(OLD.batch_id AS TEXT) || ':' || CAST(OLD.branch_id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER stock_revision_product_images_insert AFTER INSERT ON product_images
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_image', CAST(NEW.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_product_images_update AFTER UPDATE ON product_images
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision)
  SELECT 'product_image', entity_key, 1 FROM (SELECT CAST(OLD.id AS TEXT) entity_key UNION SELECT CAST(NEW.id AS TEXT))
  WHERE 1
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
CREATE TRIGGER stock_revision_product_images_delete AFTER DELETE ON product_images
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  INSERT INTO stock_session_revisions(entity_type, entity_key, revision) VALUES('product_image', CAST(OLD.id AS TEXT), 1)
  ON CONFLICT(entity_type, entity_key) DO UPDATE SET revision = revision + 1;
END;
