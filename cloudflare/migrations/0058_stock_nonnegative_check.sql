-- Make "stock can never go negative" a database-enforced invariant.
--
-- The live POS/sales paths validated availability with a plain READ and then
-- deducted with MAX(0, quantity - sold). That read-then-write is not atomic:
-- two concurrent sales of the last unit both pass the read, and the MAX(0)
-- clamp then SILENTLY hides the resulting oversell by flooring at 0 -- stock
-- is lost with no error. A CHECK(quantity >= 0) turns an oversell into a real
-- constraint failure, so the whole sale transaction (D1 batch()) rolls back
-- instead of clamping. This is the standard, declarative guard; the POS write
-- paths switch from MAX(0, ...) to plain subtraction so it actually fires.
--
-- Safe to apply to live data: every EXISTING write path either adds, sets an
-- absolute count, or already MAX(0)-clamps, so no current row can violate the
-- new constraint. The copy still floors defensively (MAX(0, ...)) in case any
-- historical row drifted negative, so the rebuild can never fail on live data.
--
-- SQLite cannot ALTER TABLE ADD CONSTRAINT, so this is the standard 12-step
-- table rebuild (rename, recreate with the CHECK, copy, drop, re-index).

ALTER TABLE branch_stock RENAME TO branch_stock_old;
CREATE TABLE branch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0 CHECK (quantity >= 0),
  rfid_confirmed_qty REAL DEFAULT 0
);
INSERT INTO branch_stock (id, product_id, branch_id, quantity, rfid_confirmed_qty)
  SELECT id, product_id, branch_id, MAX(0, COALESCE(quantity, 0)), COALESCE(rfid_confirmed_qty, 0)
  FROM branch_stock_old;
DROP TABLE branch_stock_old;
CREATE UNIQUE INDEX idx_branch_stock_product_branch_unique ON branch_stock (product_id, branch_id);
CREATE INDEX idx_branch_stock_branch_qty_product_pg ON branch_stock (branch_id, quantity DESC, product_id);

ALTER TABLE branch_batch_stock RENAME TO branch_batch_stock_old;
CREATE TABLE branch_batch_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  quantity REAL DEFAULT 0 CHECK (quantity >= 0),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO branch_batch_stock (id, batch_id, branch_id, quantity, created_at, updated_at)
  SELECT id, batch_id, branch_id, MAX(0, COALESCE(quantity, 0)), created_at, updated_at
  FROM branch_batch_stock_old;
DROP TABLE branch_batch_stock_old;
CREATE UNIQUE INDEX idx_branch_batch_stock_batch_branch_unique ON branch_batch_stock (batch_id, branch_id);
CREATE INDEX idx_branch_batch_stock_branch_qty ON branch_batch_stock (branch_id, quantity DESC, batch_id);
