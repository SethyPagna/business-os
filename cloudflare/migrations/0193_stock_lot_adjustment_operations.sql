-- Durable operation rows for the scoped "Set quantity" stock correction
-- (owner, 17 Sep; confirmed 24 Sep: "Set Quantity: offer selected
-- received-date lot or branch total; selected lot is the default").
--
-- One row per applied scoped Set (POST /api/inventory/adjust with setScope,
-- and PATCH /api/batches/:id/branches/:branchId, which share ONE writer:
-- lib/stockLotAdjustment.ts applyStockLotSet). The row holds the exact
-- before/after quantity snapshots of the selected lot and its branch aggregate
-- so the server can replay undo/redo (`stock.quantity_set`) without the
-- client, refuse the replay (409) when current stock no longer equals the
-- snapshot it would reverse from, and advance a generation per replay so a
-- stale history row can never apply twice. UNIQUE(actor_id, request_id) is the
-- per-request idempotency identity even where 0192 is not yet applied.
--
-- Same DDL as the reviewed branch's 0157 (codex/existing-stock-lot-
-- corrections-20260912, never applied anywhere); renumbered because 0157 is
-- taken and 0185-0191 are parked in ops/scripts/migration/held/.
--
-- Schema-only. No product, stock, batch, movement, audit or history backfill.
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master
--              WHERE name='stock_lot_adjustment_operations' is 0; record
--              COUNT(*) and SUM(quantity) of branch_stock, branch_batch_stock,
--              SUM(stock_quantity) of products, COUNT(*) of product_batches,
--              inventory_movements, audit_logs and action_history.
-- Post-assert: SELECT COUNT(*) FROM stock_lot_adjustment_operations = 0; every
--              count and sum recorded above is identical.
-- Deploy order: EITHER order is safe for reads. The Stock Change ledger does
--              not join this table. A Worker running before this migration
--              still applies a scoped Set (same guards, same movements) but
--              records no operation row and no undo history for it; undo
--              becomes available for Sets made after the migration lands.
--              Factory reset and products reset DELETE from this table
--              (lib/coreDataInvariants.ts); in a Worker-first gap they refuse
--              atomically ("no such table", nothing deleted) until 0193 is
--              applied. Preferred order: this migration, then the Worker.
-- Recovery:    roll the Worker back; the table is inert without it. Keep the
--              table and its rows: they are the only exact provenance of each
--              correction's undo. Never delete operation rows to retry a
--              request whose outcome is unknown -- re-send the same
--              client_request_id and the stored response is returned.
-- Backup:      registered in lib/backup.ts (BACKUP_TABLES and the sale replay
--              restore bundle, after action_history) and in both reset lists
--              of lib/coreDataInvariants.ts (before action_history).
CREATE TABLE stock_lot_adjustment_operations (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  revision_json TEXT NOT NULL CHECK(json_valid(revision_json)),
  history_id INTEGER REFERENCES action_history(id),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  state TEXT NOT NULL DEFAULT 'applied' CHECK(state IN ('applied','reversed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, request_id)
);
