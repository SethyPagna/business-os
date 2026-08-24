-- Batch-level provenance for the dated stock-count importer (lib/
-- datedStockCountImport.ts, lib/datedStockCountApply.ts). One row per
-- real product_batches effect a single inventory_movements row caused
-- via this importer -- (movement_id, batch_id, signed quantity: positive
-- for the add-side top-up/create receiveBatchStock produced, negative
-- for a remove-side FIFO drain removeStockAcrossBatches produced).
--
-- Exists so a corrected RERUN of this importer can reverse only ITS OWN
-- prior batch effects before recomputing, the same way it already
-- reverses its own prior inventory_movements rows (see
-- datedStockCountRoute.ts's existing `reason = DATED_STOCK_COUNT_REASON`
-- lookup) -- without this, a rerun has no way to distinguish "this
-- batch's current quantity reflects my own last run" from "reflects a
-- real sale/adjustment since", so it was forced to skip batch actions
-- entirely on every rerun (the gap datedStockCountImport.ts's own
-- pre-Part-286 comments documented). See
-- datedStockCountImport.ts's reconstructBatchBaseline for how this gets
-- read back.
--
-- No FK constraint to inventory_movements -- this codebase doesn't
-- enforce FKs elsewhere either (see sale_item_batch_allocations,
-- return_item_batch_allocations in migration 0001), rows are deleted
-- alongside their movement by the same caller
-- (datedStockCountApply.ts's applyDatedStockCountPlan, which already
-- owns the `DELETE FROM inventory_movements WHERE id IN (...)` step for
-- a superseded rerun).
CREATE TABLE IF NOT EXISTS dated_stock_count_batch_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dated_stock_count_batch_actions_movement
  ON dated_stock_count_batch_actions (movement_id);
