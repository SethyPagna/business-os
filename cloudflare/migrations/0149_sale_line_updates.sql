-- 0149: allow one atomic correction to a recorded line's quantity and/or
-- final selling price. The append-only ledger keeps the before/after values;
-- sale_items remains the canonical net state used by receipts, stock and
-- reports.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) FROM sale_amendments;
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM sale_amendments; -- unchanged
--   UPDATE/DELETE of sale_amendments still aborts outside maintenance mode.
-- RECOVERY: application code may be reverted; line_updated history remains
-- readable and the canonical line values remain authoritative.

DROP TRIGGER IF EXISTS sale_amendments_append_only_update;
DROP TRIGGER IF EXISTS sale_amendments_append_only_delete;
DROP TRIGGER IF EXISTS sale_revision_sale_amendments_insert;
DROP TRIGGER IF EXISTS sale_revision_sale_amendments_update;
DROP TRIGGER IF EXISTS sale_revision_sale_amendments_delete;

ALTER TABLE sale_amendments RENAME TO sale_amendments_0148;

CREATE TABLE sale_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  group_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'line_added',
    'line_quantity_increased',
    'line_quantity_decreased',
    'line_removed',
    'line_updated',
    'delivery_fee_changed',
    'delivery_actual_cost_changed',
    'delivery_added'
  )),
  sale_item_id INTEGER,
  product_id INTEGER,
  product_name TEXT,
  quantity_before REAL,
  quantity_after REAL,
  quantity_delta REAL,
  amount_before_usd REAL,
  amount_after_usd REAL,
  amount_delta_usd REAL,
  total_before_usd REAL,
  total_after_usd REAL,
  units_moved REAL NOT NULL DEFAULT 0,
  stock_skipped INTEGER NOT NULL DEFAULT 0,
  via TEXT NOT NULL DEFAULT 'amend' CHECK (via IN ('amend', 'undo', 'redo')),
  reverses_amendment_id INTEGER,
  undo_action_id INTEGER,
  note TEXT,
  before_json TEXT,
  after_json TEXT,
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sale_amendments (
  id, sale_id, group_id, kind, sale_item_id, product_id, product_name,
  quantity_before, quantity_after, quantity_delta,
  amount_before_usd, amount_after_usd, amount_delta_usd,
  total_before_usd, total_after_usd, units_moved, stock_skipped, via,
  reverses_amendment_id, undo_action_id, note, before_json, after_json,
  user_id, user_name, created_at
)
SELECT id, sale_id, group_id, kind, sale_item_id, product_id, product_name,
  quantity_before, quantity_after, quantity_delta,
  amount_before_usd, amount_after_usd, amount_delta_usd,
  total_before_usd, total_after_usd, units_moved, stock_skipped, via,
  reverses_amendment_id, undo_action_id, note, before_json, after_json,
  user_id, user_name, created_at
FROM sale_amendments_0148;

DROP TABLE sale_amendments_0148;

CREATE INDEX IF NOT EXISTS idx_sale_amendments_sale ON sale_amendments(sale_id, id);
CREATE INDEX IF NOT EXISTS idx_sale_amendments_sale_kind ON sale_amendments(sale_id, kind);

CREATE TRIGGER sale_amendments_append_only_update
BEFORE UPDATE ON sale_amendments
BEGIN
  SELECT RAISE(ABORT, 'sale_amendments is append-only: correct an entry by appending a compensating entry, never by rewriting one');
END;

CREATE TRIGGER sale_amendments_append_only_delete
BEFORE DELETE ON sale_amendments
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'sale amendments are immutable: append-only');
END;

CREATE TRIGGER sale_revision_sale_amendments_insert AFTER INSERT ON sale_amendments
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
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
  INSERT INTO sale_write_revisions(sale_id, revision) SELECT OLD.sale_id, 1 WHERE OLD.sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;
