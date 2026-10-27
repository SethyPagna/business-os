-- 0275 return refund corrections (lane 6.0.997 slice S2, expand step; the writers come in a later slice).
-- A return row holds the CURRENT refund (returns.total_refund_*, owed_reduction_usd, refund_currency) and the shift
-- drawer counts a refund in the shift containing returns.created_at. Rewriting that row in place on a later day would
-- therefore change a shift that may already be closed. This file adds the append-only ledger that records each change
-- of a return's money instead: what it was, what it became, who changed it, and in which shift the difference counts.
-- returns and return_items stay the canonical current state. The ledger only moves the DRAWER CASH of a change.
--   kind       'edit' | 'cancel' | 'restore'  (a cancel is a correction to zero cash, a restore the reverse, so the
--              later cancel lane needs no second migration).
--   mode       'today'        the difference counts in the shift that made the change (counts_at = the change time);
--              'original_day' a typing mistake, so the day of the return is corrected (counts_at = the return's own
--                             created_at, written in the canonical shape below).
--   counts_at  the instant that decides which shift the difference counts in, canonical UTC 'YYYY-MM-DD HH:MM:SS' (the
--              CHECK enforces the shape so it compares as plain text and idx_return_refund_corrections_counts serves it).
--   created_at when the change was made; it is kept apart from counts_at, so a screen can show
--              "changed on / counts on" and the mode.
--   before_* / after_*  the four money columns of the return row on either side of the change. They are stored as
--              values, not as a difference, so the shift reader applies the SAME drawer-cash function
--              (shiftReconciliation refundDrawerUsdSql / refundDrawerKhrSql) to both sides and a later change of that
--              formula treats both alike.
--   reverses_id  the correction an undo reverses (an undo is a new row, never a delete).
--   operation_id UNIQUE  the idempotency key of the write that made the row.
-- How the shift reader uses it (lib/shiftReconciliation.ts refundCorrectionsSql): the shift containing the return's
-- created_at subtracts each correction's drawer-cash difference (after - before), because the return row now holds the
-- AFTER values; the shift whose window contains counts_at adds it. Summed over every shift the refund therefore equals
-- the drawer cash of the current row, and a closed shift never moves because of a correction counted elsewhere.
-- A normal rowid table on purpose (backup, export and reset paginate by rowid; see 0273's WITHOUT ROWID failure).
-- No foreign key to returns or sales: like sale_payment_events (0271), the ledger must not block the admin data reset,
-- and a restore replaces it together with the returns it describes (lib/backup.ts BACKUP_TABLES, SALE_REPLAY_OPTIONAL_TABLES).
-- Append-only like 0271: UPDATE always aborts; DELETE aborts unless the restore maintenance flag is set (a restore deletes
-- then inserts every backed-up table). An insert bumps return_write_revisions, the optimistic-write counter every return
-- ledger bumps, so a screen opened before a correction cannot save over it.
-- Schema only: no row of any table is inserted, updated or deleted, and no Worker code writes this table yet, so a Worker
-- that predates this file behaves exactly as before. The shift and report readers add nothing while the table is empty.
--
-- PRE:  return_refund_corrections does not exist (CREATE TABLE would fail half way). Record SELECT COUNT(*) FROM returns.
-- POST: the returns count is unchanged; return_refund_corrections has 0 rows; both indexes and the three triggers exist.
--       A failed check reads a malformed JSON path and aborts the file.
-- Pinned by scripts/test-migration-0275-return-refund-corrections-native.cjs.
--
-- RECOVERY: schema only, nothing to restore. Roll the Worker back first (it will read this table), then remove
--   'return_refund_corrections' from BACKUP_TABLES and SALE_REPLAY_OPTIONAL_TABLES (or a restore aborts on the missing
--   table), then
--   DROP TRIGGER IF EXISTS return_refund_corrections_append_only_update;
--   DROP TRIGGER IF EXISTS return_refund_corrections_append_only_delete;
--   DROP TRIGGER IF EXISTS return_revision_return_refund_corrections_insert;
--   DROP TABLE IF EXISTS return_refund_corrections;  -- only while it is empty (its delete guard refuses otherwise;
--                                                       set the restore maintenance flag if rows must go)

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name = 'return_refund_corrections') = 0
THEN 1 ELSE json_extract('[]','$[return_refund_corrections_0275_pre]') END;

CREATE TABLE return_refund_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  return_id INTEGER NOT NULL,
  sale_id INTEGER,
  branch_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'edit' CHECK (kind IN ('edit','cancel','restore')),
  mode TEXT NOT NULL CHECK (mode IN ('today','original_day')),
  counts_at TEXT NOT NULL CHECK (counts_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'),
  before_total_refund_usd REAL NOT NULL DEFAULT 0 CHECK (before_total_refund_usd >= 0),
  before_total_refund_khr REAL NOT NULL DEFAULT 0 CHECK (before_total_refund_khr >= 0),
  before_owed_reduction_usd REAL NOT NULL DEFAULT 0 CHECK (before_owed_reduction_usd >= 0),
  before_refund_currency TEXT CHECK (before_refund_currency IS NULL OR before_refund_currency IN ('USD','KHR')),
  after_total_refund_usd REAL NOT NULL DEFAULT 0 CHECK (after_total_refund_usd >= 0),
  after_total_refund_khr REAL NOT NULL DEFAULT 0 CHECK (after_total_refund_khr >= 0),
  after_owed_reduction_usd REAL NOT NULL DEFAULT 0 CHECK (after_owed_reduction_usd >= 0),
  after_refund_currency TEXT CHECK (after_refund_currency IS NULL OR after_refund_currency IN ('USD','KHR')),
  reverses_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_return_refund_corrections_counts ON return_refund_corrections (counts_at);
CREATE INDEX idx_return_refund_corrections_return ON return_refund_corrections (return_id, id);

CREATE TRIGGER return_refund_corrections_append_only_update
BEFORE UPDATE ON return_refund_corrections
BEGIN
  SELECT RAISE(ABORT, 'return_refund_corrections is append-only: correct an entry by appending a compensating entry, never by rewriting one');
END;

CREATE TRIGGER return_refund_corrections_append_only_delete
BEFORE DELETE ON return_refund_corrections
WHEN NOT EXISTS (
  SELECT 1 FROM system_flags
  WHERE key = 'maintenance'
    AND json_extract(value, '$.mode') = 'restore'
)
BEGIN
  SELECT RAISE(ABORT, 'return refund corrections are immutable: append-only');
END;

CREATE TRIGGER return_revision_return_refund_corrections_insert AFTER INSERT ON return_refund_corrections
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore')
BEGIN
  INSERT INTO return_write_revisions(return_id, revision) VALUES(NEW.return_id, 1)
  ON CONFLICT(return_id) DO UPDATE SET revision = revision + 1;
END;

SELECT CASE WHEN (SELECT COUNT(*) FROM return_refund_corrections) = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_return_refund_corrections_counts','idx_return_refund_corrections_return') AND type = 'index') = 2
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'return_refund_corrections') = 3
THEN 1 ELSE json_extract('[]','$[return_refund_corrections_0275_post]') END;
