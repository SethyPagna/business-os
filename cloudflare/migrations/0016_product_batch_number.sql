-- Adds a per-product sequential batch number to product_batches, so a
-- receipt with no lot code can get a real default label ("Batch <n>:
-- <received date>") instead of ManageBatchesModal's current
-- "Unlabeled batch" placeholder -- see progress.md's "Batch selection
-- made mandatory on add/remove stock" item: "Default batch `n+1:
-- mm/dd/yyyy` stays the default for add stock / add product / import;
-- batch number still auto-increments per product." Assigned once at
-- creation and never renumbered (deactivating/editing a batch doesn't
-- shift anyone else's number), same "stable once assigned" rule the
-- rest of this app's identifiers already follow.
--
-- Nullable, not a table rebuild: existing rows are backfilled in the
-- same migration via ROW_NUMBER() OVER (PARTITION BY variant_product_id
-- ORDER BY id), the same window-function pattern
-- lib/familyPagination.ts's ROW_NUMBER() OVER (ORDER BY ...) already
-- uses, so this migration doesn't introduce an unproven SQL feature.
-- Every batch going forward gets its number assigned explicitly by
-- lib/productBatches.ts's receiveBatchStock (MAX(batch_number)+1 for
-- that product) -- this backfill only covers batches that already
-- existed before this migration ran.

ALTER TABLE product_batches ADD COLUMN batch_number INTEGER;

UPDATE product_batches
SET batch_number = (
  SELECT ranked.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY variant_product_id ORDER BY id ASC) AS rn
    FROM product_batches
  ) ranked
  WHERE ranked.id = product_batches.id
);

CREATE INDEX idx_product_batches_variant_number ON product_batches (variant_product_id, batch_number);
