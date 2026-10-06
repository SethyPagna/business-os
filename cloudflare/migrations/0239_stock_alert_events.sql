-- NOTIF-V2: the bell's stock notifications are EVENTS, not a standing list.
--
-- Owner, 6 Oct 2026: "for the notification i think should trigger if the stock
-- when make sale shows in low stock or out of stock. instead of showing
-- everything in notifications." Until now GET /api/notifications/summary
-- listed EVERY product at or under its threshold on every call. This table
-- holds one row each time a SALE moves a product family from a better stock
-- state into a worse one (healthy -> low, healthy -> out, low -> out), using
-- the Dashboard's own family-level classification (lib/familyStockStats.ts).
-- A sale on a family that is already low writes nothing; a restock puts the
-- family back above its threshold so its next crossing writes a fresh row.
-- Manual adjustments, transfers and imports never write here (the owner asked
-- for the sale moment only).
--
-- Rows are written by ONE INSERT ... SELECT appended to the same atomic D1
-- batch that deducts the stock (lib/saleStockAlerts.ts), so a rolled-back sale
-- leaves no event and a committed sale always has its event. The bell reads
-- the last few days and hides an event once the family is no longer in the
-- state it announced. The scheduled retention sweep prunes rows after 30 days.
--
-- family_root_id is the Dashboard's FAMILY_ROOT_KEY_SQL value (the name key,
-- or 'id:<n>' for a nameless row). product_id is the sold row that stands for
-- the family in the notification; branch_name is the NAME of the branch the sale
-- deducted from, a display snapshot (the classification is the catalog-wide
-- rollup the Dashboard cards use). There is deliberately NO branch_id column: the
-- branch cutover registry (lib/branchCutoverCapture.ts) refuses a database that
-- has an unclassified *_branch_id column, and a 3-day notification label is not
-- worth rewriting rows in a cutover. sale_id is the sale that caused the crossing.
--
-- Telegram (same owner ruling, 6 Oct): the Alerts topic gets one short message per
-- crossing, sent AFTER the sale commits from these rows. telegram_sent_at is the
-- claim: a drain sets it with one UPDATE ... RETURNING, so two overlapping sales
-- never send the same crossing twice, and a failed send clears it so the next
-- drain retries inside the two-hour window (lib/telegram.ts sendPendingStockAlerts).
-- NULL = not yet announced.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
--                AND name = 'stock_alert_events'          -- expected 0
-- Post-assert: the same query                              -- expected 1
--              SELECT COUNT(*) FROM stock_alert_events     -- expected 0
--              SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
--                AND name LIKE 'idx_stock_alert_events_%'  -- expected 3
-- Deploy order: MIGRATION FIRST. The candidate Worker appends the INSERT to
--              every sale batch and reads the table in /api/notifications/
--              summary with no existence probe. The previous Worker never
--              names the table and runs unchanged on the new schema.
-- Recovery:    roll the Worker back first, then
--              DROP TABLE IF EXISTS stock_alert_events;
--              Loses only the notification history; no stock, sale or money
--              figure is stored here.

CREATE TABLE IF NOT EXISTS stock_alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_root_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT,
  branch_name TEXT,
  alert_state TEXT NOT NULL CHECK (alert_state IN ('low', 'out')),
  quantity_after REAL NOT NULL DEFAULT 0,
  sale_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  telegram_sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_alert_events_created
  ON stock_alert_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_stock_alert_events_family
  ON stock_alert_events (family_root_id, id DESC);

-- The Telegram drain's only read: unannounced rows, newest window. Partial, so a
-- sale that crossed nothing probes an empty index instead of the table.
CREATE INDEX IF NOT EXISTS idx_stock_alert_events_unsent
  ON stock_alert_events (created_at)
  WHERE telegram_sent_at IS NULL;
