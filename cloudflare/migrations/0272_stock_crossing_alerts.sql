-- 0272 stock crossing alerts (lane 6.0.991; owner ruling 6 Oct 2026: low and out-of-stock alerts fire only when
-- a sale crosses the threshold).
--
-- One row per CROSSING: a sale took a product at a branch from above a threshold to at or below it
-- (tier 'low' = crossed the low-stock threshold, tier 'out' = crossed the out-of-stock threshold). The row is
-- written by the Worker right after the deduction commits, and it does two jobs:
--   1. It is the idempotency claim. `INSERT OR IGNORE` against the two unique keys below is the only gate in
--      front of the Telegram send, so a retry, a replay, two tills racing across the same threshold, or a sale
--      that is undone and redone can never send a second message for the same crossing.
--        alert_key  'stock-crossing:<tier>:<branch>:<product>:<epoch>' where <epoch> is the id of the newest
--                   inventory_movements row for that product and branch that is a real INFLOW: quantity > 0 AND a
--                   movement_type that is not an outflow (the Stock Change ledger's own LEDGER_OUT_TYPES; transfer_out
--                   and the like are stored as positive magnitudes, so the sign alone is not enough). That is the last
--                   restock. Racing sales share the epoch and collapse to one row; a restock moves the epoch, so the
--                   next crossing is a new row and a new message.
--        sale key   (sale_id, product_id, branch_id, tier): the same sale never claims the same crossing twice,
--                   even when an undo (a restock) moved the epoch in between.
--   2. It is a log of every crossing (which sale or addition, how much before and after, and what became of the
--      Telegram message). Nothing reads it yet; the notification bell still shows the standing low-stock list.
-- telegram_status records what became of the send. Delivery is AT MOST ONCE and inline (no queue, no drain):
-- a row is never re-sent, so a copied database can never replay old alerts into a chat.
--
-- Schema only: no existing table is read or written. No client data.
-- PRE:  stock_crossing_alerts does not exist.
-- POST: stock_crossing_alerts exists with 0 rows, and its three indexes exist. A failed check reads a malformed
--       JSON path and aborts the file.
-- Pinned by scripts/test-stock-crossing-alert-pure.cjs.
--
-- Deploy order: EITHER order is safe. lib/stockCrossingAlert.ts probes for the table (memoising only a positive
-- result) and, while it is absent, records and sends nothing.
-- RECOVERY: roll the Worker back; the table is inert without it. DROP TABLE IF EXISTS stock_crossing_alerts.
-- Retention: one row per crossing, at most one per product and branch between two restocks. No pruner.
-- Backup: deliberately NOT in lib/backup.ts BACKUP_TABLES. It is an alert log, not business data; a restore
--       CLEARS it (lib/backup.ts), because the keys embed movement and sale ids that a restore rolls back.
--       Bringing its rows back would suppress the first crossing after the restore.

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name = 'stock_crossing_alerts') = 0
THEN 1 ELSE json_extract('[]','$[stock_crossing_alerts_0272_pre]') END;

CREATE TABLE stock_crossing_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('low', 'out')),
  sale_id INTEGER,
  quantity_before REAL NOT NULL,
  quantity_after REAL NOT NULL,
  telegram_status TEXT NOT NULL DEFAULT 'pending' CHECK (telegram_status IN ('pending', 'sent', 'skipped', 'failed')),
  telegram_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_stock_crossing_alerts_sale
  ON stock_crossing_alerts (sale_id, product_id, branch_id, tier) WHERE sale_id IS NOT NULL;
CREATE INDEX idx_stock_crossing_alerts_recent ON stock_crossing_alerts (created_at DESC, id DESC);
CREATE INDEX idx_stock_crossing_alerts_product ON stock_crossing_alerts (product_id, branch_id, tier);

SELECT CASE WHEN (SELECT COUNT(*) FROM stock_crossing_alerts) = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_stock_crossing_alerts_sale','idx_stock_crossing_alerts_recent','idx_stock_crossing_alerts_product')) = 3
THEN 1 ELSE json_extract('[]','$[stock_crossing_alerts_0272_post]') END;
