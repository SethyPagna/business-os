-- 0271 sale payment events (lane 6.0.972, slice S1 of DESIGN-SALE-ADDITIONS-PAYMENTS, expand step).
-- A sale keeps its running tender in sales.amount_paid_* and payment_details. This file adds the
-- append-only ledger that will record each payment: who took it, when, in which direction, and which
-- addition it paid for. sales and sale_items stay the canonical current state, exactly as 0115 set it
-- for amendments. The columns of the event money (amount_paid_*, change_*, payment_details) carry the
-- names of the sales tender columns so the shift summary reader can read events without a new parser.
--   sales.payments_version        0 = the sale has no events (today's rule: its tender belongs to
--                                     sales.created_at); 1 = events are the record. Only the Worker
--                                     moves a sale to 1, and nothing does yet.
--   sale_items.added_operation_id NULL = rung at POS checkout; else the sale_amendments.group_id that added it.
--   sale_payment_events           direction in/out, origin checkout|opening|added|collect|late_record|undo|redo|correction,
--                                 event_id UNIQUE ('opening:<sale_id>' is the one opening event per sale).
--                                 No foreign key to sales: like sale_amendments, the ledger must not block the
--                                 admin data reset, and a restore replaces both tables together.
-- Append-only like 0149: UPDATE always aborts; DELETE aborts unless the restore maintenance flag is set
-- (a restore deletes then inserts every backed-up table). Inserts bump sale_write_revisions, the same
-- optimistic-write counter every sale ledger bumps (the update and delete revision triggers of 0149 are
-- unreachable here because those statements abort first, so they are not created).
-- Schema only: no row of any table is inserted, updated or deleted, and no Worker code reads or writes
-- these columns yet, so a Worker that predates this file behaves exactly as before.
--
-- PRE:  sales has no payments_version, sale_items has no added_operation_id, sale_payment_events does not
--       exist (ADD COLUMN or CREATE TABLE would fail half way). Record SELECT COUNT(*) FROM sales and
--       SELECT COUNT(*) FROM sale_items.
-- POST: the two counts are unchanged; sale_payment_events has 0 rows; every sales.payments_version is 0 and
--       every sale_items.added_operation_id is NULL; both indexes and the three triggers exist.
--       A failed check reads a malformed JSON path and aborts the file.
-- Pinned by scripts/test-migration-0271-sale-payment-events-native.cjs.
--
-- RECOVERY: schema only, nothing to restore. Roll the Worker back first (it will read these columns), then
--   remove 'sale_payment_events' from BACKUP_TABLES (or a restore aborts on the missing table), then
--   DROP TRIGGER IF EXISTS sale_payment_events_append_only_update;
--   DROP TRIGGER IF EXISTS sale_payment_events_append_only_delete;
--   DROP TRIGGER IF EXISTS sale_revision_sale_payment_events_insert;
--   DROP TABLE IF EXISTS sale_payment_events;  -- only while it is empty (its delete guard refuses otherwise;
--                                                  set the restore maintenance flag if rows must go)
--   ALTER TABLE sale_items DROP COLUMN added_operation_id;
--   ALTER TABLE sales DROP COLUMN payments_version;

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('sales') WHERE name = 'payments_version') = 0
  AND (SELECT COUNT(*) FROM pragma_table_info('sale_items') WHERE name = 'added_operation_id') = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name = 'sale_payment_events') = 0
THEN 1 ELSE json_extract('[]','$[sale_payment_events_0271_pre]') END;

ALTER TABLE sales ADD COLUMN payments_version INTEGER NOT NULL DEFAULT 0 CHECK (payments_version IN (0,1));
ALTER TABLE sale_items ADD COLUMN added_operation_id TEXT;

CREATE TABLE sale_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  origin TEXT NOT NULL CHECK (origin IN ('checkout','opening','added','collect','late_record','undo','redo','correction')),
  covers_operation_id TEXT,
  operation_id TEXT,
  reverses_event_id TEXT,
  payment_method TEXT NOT NULL,
  payment_details TEXT NOT NULL CHECK (json_valid(payment_details) AND json_type(payment_details) = 'array'),
  amount_paid_usd REAL NOT NULL DEFAULT 0 CHECK (amount_paid_usd >= 0),
  amount_paid_khr REAL NOT NULL DEFAULT 0 CHECK (amount_paid_khr >= 0),
  change_usd REAL NOT NULL DEFAULT 0 CHECK (change_usd >= 0),
  change_khr REAL NOT NULL DEFAULT 0 CHECK (change_khr >= 0),
  change_is_actual INTEGER NOT NULL DEFAULT 0 CHECK (change_is_actual IN (0,1)),
  change_exchange_rate REAL,
  exchange_rate REAL NOT NULL CHECK (exchange_rate > 0),
  drawer_effect INTEGER NOT NULL DEFAULT 1 CHECK (drawer_effect IN (0,1)),
  received_at TEXT NOT NULL,
  branch_id INTEGER,
  cashier_id INTEGER,
  cashier_name TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sale_payment_events_sale ON sale_payment_events (sale_id, id);
CREATE INDEX IF NOT EXISTS idx_sale_payment_events_received ON sale_payment_events (received_at, branch_id);

CREATE TRIGGER sale_payment_events_append_only_update
BEFORE UPDATE ON sale_payment_events
BEGIN
  SELECT RAISE(ABORT, 'sale_payment_events is append-only: correct an entry by appending a compensating entry, never by rewriting one');
END;

CREATE TRIGGER sale_payment_events_append_only_delete
BEFORE DELETE ON sale_payment_events
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'sale payment events are immutable: append-only');
END;

CREATE TRIGGER sale_revision_sale_payment_events_insert AFTER INSERT ON sale_payment_events
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO sale_write_revisions(sale_id, revision) SELECT NEW.sale_id, 1 WHERE NEW.sale_id IS NOT NULL
  ON CONFLICT(sale_id) DO UPDATE SET revision = revision + 1;
END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sale_payment_events) = 0
  AND (SELECT COUNT(*) FROM sales WHERE payments_version <> 0) = 0
  AND (SELECT COUNT(*) FROM sale_items WHERE added_operation_id IS NOT NULL) = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_sale_payment_events_sale','idx_sale_payment_events_received') AND type = 'index') = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'sale_payment_events') = 3
THEN 1 ELSE json_extract('[]','$[sale_payment_events_0271_post]') END;
