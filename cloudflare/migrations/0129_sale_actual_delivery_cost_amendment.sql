-- 0129: make staff-paid delivery-cost corrections first-class sale amendments.
--
-- The customer delivery fee and the courier's actual cost are different
-- numbers.  The former changes what the customer owes; the latter changes
-- only reporting/margin.  The existing 0115 CHECK allowed only the former,
-- which meant a correction to the actual courier cost could not be made from
-- the sale while retaining the before/after record.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) AS amendment_rows FROM sale_amendments;
--   SELECT COUNT(*) AS actual_cost_rows FROM sales
--     WHERE delivery_actual_cost_usd IS NOT NULL;
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM sale_amendments; -- equals amendment_rows
--   SELECT COUNT(*) FROM sale_amendments
--     WHERE kind = 'delivery_actual_cost_changed'; -- 0 until a correction
--   UPDATE/DELETE of a ledger row still abort outside maintenance restore.
--
-- RECOVERY: this is an append-only schema extension.  Do not delete the new
-- kind or its history.  Revert application code if necessary; the new rows
-- remain readable and the canonical sales columns remain authoritative.

BEGIN;

DROP TRIGGER IF EXISTS sale_amendments_append_only_update;
DROP TRIGGER IF EXISTS sale_amendments_append_only_delete;
DROP TRIGGER IF EXISTS sale_revision_sale_amendments_insert;
DROP TRIGGER IF EXISTS sale_revision_sale_amendments_update;
DROP TRIGGER IF EXISTS sale_revision_sale_amendments_delete;

ALTER TABLE sale_amendments RENAME TO sale_amendments_0115;

CREATE TABLE sale_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  group_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'line_added',
    'line_quantity_increased',
    'line_quantity_decreased',
    'line_removed',
    'delivery_fee_changed',
    'delivery_actual_cost_changed'
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
  user_id INTEGER,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sale_amendments (
  id, sale_id, group_id, kind, sale_item_id, product_id, product_name,
  quantity_before, quantity_after, quantity_delta,
  amount_before_usd, amount_after_usd, amount_delta_usd,
  total_before_usd, total_after_usd, units_moved, stock_skipped, via,
  reverses_amendment_id, undo_action_id, note, user_id, user_name, created_at
)
SELECT id, sale_id, group_id, kind, sale_item_id, product_id, product_name,
  quantity_before, quantity_after, quantity_delta,
  amount_before_usd, amount_after_usd, amount_delta_usd,
  total_before_usd, total_after_usd, units_moved, stock_skipped, via,
  reverses_amendment_id, undo_action_id, note, user_id, user_name, created_at
FROM sale_amendments_0115;

DROP TABLE sale_amendments_0115;

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

COMMIT;
