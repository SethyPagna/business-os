-- 0294: the count of one product at one branch, line by received date (INV-B S5, ic_lot_counts; Inventory replan rev. 2, section 2.6).
--
-- Today a count is ONE figure per product (inventory_check_items, keyed session + product + branch), so which received date absorbs a difference is the system's choice.
-- To Set a received date from a count, a line must be (product, branch, received date). Each row here is one such line of a submitted count:
--   batch_id 0, scope 'branch'   the branch total of the product (offered only when the product has an active received date)
--   batch_id N, scope 'lot'      the quantity of received date N at the branch
-- seen_quantity is the figure the counter saw. seen_source says where it came from: 'screen' (the sighted counter's figure, guarded in the submission batch against the live
-- quantity) or 'write' (a counter who may not see stock: the quantity read inside the insert itself, at the moment of the write). counted_quantity is the sellable count typed
-- for the line; damaged units stay a chip on the row and are never counted here.
--
-- The product row in inventory_check_items stays the product's state and its total (counted = the sum of its lines, baseline = the sum of the seen figures), so sessions, history,
-- the Issues filter, index 0285, queue-first supersede and the approval plan keep working unchanged. Rows are written only by the submission that records the count.
--
-- PRE:  the three 0259 tables exist; inventory_check_lot_lines does not. A failed check reads a malformed JSON path and aborts the file.
-- POST: the table exists with its one index and two triggers and holds no row; the three 0259 tables are unchanged (the companion test counts them before and after).
-- Append-only, LF-only, generic (no client data), idempotent only through the PRE check (a second run aborts on the existing table).
-- Rollback-safe: the previous Worker never names the table, so it runs unchanged on the new schema.
-- A rowid table (never WITHOUT ROWID: the backup and restore code reads rowids).
-- Pinned by scripts/test-migration-0294-inventory-check-lot-lines-native.cjs.
--
-- Immutable like the history it belongs to: a line is never updated; rows are never deleted, except while the restore maintenance flag is set (the same carve-out as 0268 and 0286).
--
-- RECOVERY: schema only, nothing to restore.
--   DROP TABLE IF EXISTS inventory_check_lot_lines;   -- after removing it from BACKUP_TABLES, or a restore aborts on the missing table

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('inventory_check_sessions','inventory_check_items','inventory_check_events')) = 3
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name = 'inventory_check_lot_lines') = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_lot_lines_0294_pre]') END;

CREATE TABLE inventory_check_lot_lines (
  session_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL DEFAULT 0 CHECK(batch_id>=0),
  scope TEXT NOT NULL CHECK(scope IN ('lot','branch')),
  seen_quantity REAL CHECK(seen_quantity IS NULL OR seen_quantity>=0),
  counted_quantity REAL NOT NULL CHECK(counted_quantity>=0),
  seen_source TEXT NOT NULL CHECK(seen_source IN ('screen','write')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_id,product_id,batch_id),
  FOREIGN KEY(session_id,product_id,branch_id) REFERENCES inventory_check_items(session_id,product_id,branch_id),
  CHECK((scope='branch' AND batch_id=0) OR (scope='lot' AND batch_id>0))
);
CREATE INDEX inventory_check_lot_lines_product ON inventory_check_lot_lines(product_id,branch_id,session_id);

CREATE TRIGGER inventory_check_lot_lines_no_update BEFORE UPDATE ON inventory_check_lot_lines
BEGIN SELECT RAISE(ABORT,'inventory_check_lot_line_immutable'); END;
CREATE TRIGGER inventory_check_lot_lines_no_delete BEFORE DELETE ON inventory_check_lot_lines
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN SELECT RAISE(ABORT,'inventory_check_lot_line_immutable'); END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = 'inventory_check_lot_lines' AND type = 'trigger') = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = 'inventory_check_lot_lines' AND type = 'index' AND name = 'inventory_check_lot_lines_product') = 1
  AND (SELECT COUNT(*) FROM inventory_check_lot_lines) = 0
THEN 1 ELSE json_extract('[]','$[inventory_check_lot_lines_0294_post]') END;
