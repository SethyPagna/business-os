-- 0084: movement <-> batch linkage (D2a). inventory_movements never recorded
-- WHICH lot a row touched, so the ledger's supplier filter and the product
-- detail's Batch column could not be answered truthfully (both flagged on the
-- board under D2/D3 since Part 420/422). Additive, nullable: writers stamp
-- batch_id ONLY where the movement's units are attributable to exactly ONE
-- product_batches row (explicit lot pick, single-lot auto-allocation, batch
-- receipt/correction, lot-preserving transfer legs). A movement spread across
-- several lots, or over legacy unlotted aggregate stock, stays NULL --
-- blank-honest, same rule sale_items.batch_id already follows for multi-lot
-- lines (the per-lot detail lives in sale_item_batch_allocations).
ALTER TABLE inventory_movements ADD COLUMN batch_id INTEGER;

-- Read path: the supplier filter joins product_batches on this column over
-- date/branch-bounded pages.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_batch
  ON inventory_movements (batch_id) WHERE batch_id IS NOT NULL;

-- Backfill from the ONE recorded provenance source that already exists:
-- dated_stock_count_batch_actions (migration 0035) stores each dated
-- stock-count movement's exact batch effects. A movement whose recorded
-- actions all name a single batch is attributable with certainty; one that
-- names several stays NULL (multi-lot). Set-based on purpose -- correlated
-- per-row shapes have hit D1's CPU limit before (see 0081's header). No
-- other backfill is attempted: sale movements reference the sale, not the
-- sale_item, so a multi-item sale of one product cannot be joined back to
-- its lot without guessing.
UPDATE inventory_movements
SET batch_id = (
  SELECT MIN(a.batch_id) FROM dated_stock_count_batch_actions a
  WHERE a.movement_id = inventory_movements.id
)
WHERE batch_id IS NULL
  AND id IN (
    SELECT movement_id FROM dated_stock_count_batch_actions
    GROUP BY movement_id
    HAVING COUNT(DISTINCT batch_id) = 1
  )
  -- Full coverage required: a movement whose single recorded action covered
  -- only part of its quantity (shortfall fell to the plain aggregate) must
  -- not claim the whole movement for that lot. Correlated, but only over
  -- rows already in the candidate set above (dated stock-count movements).
  AND ABS(COALESCE(quantity, 0)) = (
    SELECT SUM(ABS(a.quantity)) FROM dated_stock_count_batch_actions a
    WHERE a.movement_id = inventory_movements.id
  );
