-- Per-line idempotency receipts for the single-line stock write kernels
-- (routes/inventory.ts runAdjustAction and routes/batches.ts
-- runReceiveBatchAction). Those two kernels are the only writers behind the
-- fast stock-in commit (routes/stockInCommit.ts), the ReceiveBatchModal
-- receipt and the StockAdjustModal add/remove/set, and none of them had a
-- dedup identity: a line whose response was lost (crashed render, killed
-- tab, dropped connection) is re-sent by the retry and moved stock twice.
-- The transfer route has had this since 0151 via transfer_operation_receipts;
-- this is the same contract for the per-line kernels, in their own table
-- because transfer receipts carry provenance triggers a stock line has no
-- answer for.
--
-- Schema-only. No product, stock, batch, movement, audit or history backfill.
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE name='stock_mutation_receipts'
--              is 0; counts and sums in products,
--              branch_stock, branch_batch_stock, product_batches and
--              inventory_movements must be identical before and after.
-- Post-assert: SELECT COUNT(*) FROM stock_mutation_receipts = 0; the five
--              stock tables above unchanged.
-- Recovery:    roll the Worker back; the table is inert when no request
--              carries a client_request_id, and lib/stockMutationReceipt.ts
--              falls back to the pre-0192 behaviour when the table is absent,
--              so code and schema can land in either order.
-- Retention:   receipts are kept forever -- there is NO pruner. One row per
--              identified stock line is the same order of magnitude as
--              inventory_movements, which is also never pruned, so this adds
--              no new retention problem. A future pruner deleting completed
--              rows by age should add its own created_at index in its own
--              migration; one is deliberately not created here because
--              nothing in this code path reads created_at except through the
--              UNIQUE (actor_id, request_id) lookup, and an index nothing
--              reads is a cost on every insert.
CREATE TABLE stock_mutation_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('adjust', 'receive')),
  request_json TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE (actor_id, request_id)
);
