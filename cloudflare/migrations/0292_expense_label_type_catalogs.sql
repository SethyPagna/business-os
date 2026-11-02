-- 0292: the Expenses page can add, rename and archive its labels and its types (6.0.1053, owner ask 2 Nov 2026).
--
-- Until now a label existed only while a saved expense carried it (GET /api/fees/labels was a DISTINCT over fees.label)
-- and the expense types were a fixed list of five written into the code, so nothing could be added.
--
-- Two catalog tables, additive and empty at birth:
--   fee_types   the CUSTOM types an administrator adds. The five built-in types (tax, delivery, change, expense, other) stay in
--               code: reports split on 'delivery', so those five names are not editable.
--   fee_labels  the labels an operator added, renamed, re-typed or archived. A label that exists only on expenses (every
--               label today) needs no row; the first managing action registers it.
-- Expenses keep storing the type and label as TEXT (fees.fee_type, fees.label): every report, the Telegram and shift
-- splits and the exports read those columns and do not change. The catalog supplies the choices and the archive state;
-- a rename rewrites the exact matching expense rows and records each one in the audit log, in the same commit.
--
-- Also one partial index, idx_sales_courier_cost: the Expenses list shows the courier cost recorded on sales, and the index holds
-- only the sales that carry one, so a long window reads those sales and not every sale in it.
--
-- PRE: fees and sales exist, and sales carries created_at and both courier-cost columns.
-- POST: both tables and the index exist. No row of fees or sales is touched, and the tables start empty.
-- A failed check reads a malformed JSON path and aborts the file.
-- Idempotent: IF NOT EXISTS. Backward compatible: the previous Worker never reads these tables, and this Worker treats a
-- missing table as "no custom types, no registered labels" until the migration is applied.
-- Pinned by scripts/test-migration-0292-expense-catalogs-native.cjs.
--
-- RECOVERY: nothing to restore.
--   DROP INDEX IF EXISTS idx_sales_courier_cost;
--   DROP TABLE IF EXISTS fee_labels;
--   DROP TABLE IF EXISTS fee_types;
-- Dropping the tables loses only the added choices and the archive flags; expenses keep their text.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('fees','sales')) = 2
  AND (SELECT COUNT(*) FROM pragma_table_info('sales') WHERE name IN ('delivery_actual_cost_usd','delivery_actual_cost_khr','created_at')) = 3
THEN 1 ELSE json_extract('[]','$[expense_catalogs_0292_pre]') END;

CREATE TABLE IF NOT EXISTS fee_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  name_key TEXT NOT NULL UNIQUE,
  archived_at TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fee_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  name_key TEXT NOT NULL UNIQUE,
  fee_type TEXT,
  archived_at TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_courier_cost ON sales (created_at)
  WHERE delivery_actual_cost_usd IS NOT NULL OR delivery_actual_cost_khr IS NOT NULL;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('fee_types','fee_labels','idx_sales_courier_cost')) = 3
THEN 1 ELSE json_extract('[]','$[expense_catalogs_0292_post]') END;
