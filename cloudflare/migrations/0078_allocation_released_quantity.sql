-- 0078: per-unit release tracking on sale_item_batch_allocations (Z0).
--
-- The user's rule: returns and cancels must put stock back into the SAME
-- batch the sale took it from. The allocations table records which lot(s) a
-- sale line drew from, but until now only carried a whole-row released_at
-- marker -- enough for an all-or-nothing cancel of a single-lot line,
-- useless for partial returns or multi-lot lines. released_quantity counts
-- how many of the allocation's units have been put back so far; restores
-- consume outstanding (quantity - released_quantity), re-deducts (un-cancel)
-- consume released_quantity.
ALTER TABLE sale_item_batch_allocations ADD COLUMN released_quantity REAL NOT NULL DEFAULT 0;

-- Backfill: a row the old cancel path marked released was released in full.
UPDATE sale_item_batch_allocations
SET released_quantity = quantity
WHERE released_at IS NOT NULL;
