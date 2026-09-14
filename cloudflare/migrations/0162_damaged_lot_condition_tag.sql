-- P3-L6: a removal may KEEP the units inside the product group as a tagged
-- child row instead of destroying them. Owner: "Make it option chooseable to
-- keep in group with tag or remove entiriely, "Restock with "tag"", make sure
-- if remove directly it also counts toward losses. as cost price no selling
-- price means loss. the tag remains english even in khmer."
--
-- damaged_stock_lots (0074) already holds non-sellable units per
-- product/branch/batch, but only ever as the ONE implicit condition a return
-- could record ("damaged"), written by exactly one writer (returns). Three
-- additive columns turn it into the general held-stock ledger the tagged
-- child row reads:
--
--   condition_tag  the English constant the row is tagged with. The list is
--                  defined ONCE, in cloudflare/src/lib/stockCondition.ts, and
--                  mirrored (parity-tested) in frontend/src/utils/
--                  stockCondition.ts. Stored as the English token in every
--                  language: the owner asked for the tag itself to stay
--                  English even under km, so nothing translates on write and
--                  nothing has to be un-translated on read.
--   source         which writer created the row: 'return' (returns flow),
--                  'remove' (a remove-stock action that chose to keep), or
--                  'restock' (a stock-in received straight into the tagged
--                  row -- the purchase still reaches the supplier ledger via
--                  its ordinary product_batches lot).
--   unit_cost_usd  the cost the held units were carried at, captured at write
--                  time from the drained lot (or the product's cost). Held
--                  units are NOT a loss yet; this is what the loss is valued
--                  at when the tagged row is finally disposed of.
--
-- No column is dropped and no existing writer has to change: 0074's returns
-- INSERT keeps working, and the backfill below gives its historical rows the
-- identity they always had implicitly.
--
-- Preflight (must return the row count that the backfill will touch):
--   SELECT COUNT(*) FROM damaged_stock_lots WHERE condition_tag IS NULL;  -- after the ALTERs
-- Postflight (must both return 0):
--   SELECT COUNT(*) FROM damaged_stock_lots WHERE condition_tag IS NULL;
--   SELECT COUNT(*) FROM damaged_stock_lots WHERE source IS NULL;
-- Recovery: the three columns are additive and nullable; dropping them
-- restores the previous shape. No quantity, cost, return identity or
-- attribution on an existing row is rewritten by this migration.
-- D1 applies the migration transactionally. No explicit transaction statements.
ALTER TABLE damaged_stock_lots ADD COLUMN condition_tag TEXT;
ALTER TABLE damaged_stock_lots ADD COLUMN source TEXT;
ALTER TABLE damaged_stock_lots ADD COLUMN unit_cost_usd REAL;

-- Backfill is WHERE-guarded on NULL, so re-running it is a no-op and it can
-- never restamp a row a later writer has since tagged differently.
UPDATE damaged_stock_lots SET condition_tag = 'damaged' WHERE condition_tag IS NULL;
UPDATE damaged_stock_lots SET source = 'return' WHERE source IS NULL;

-- The tagged child row reads (product, branch, tag) with quantity_remaining > 0
-- for one product group at a time; 0074's idx_damaged_lots_product_branch
-- already covers the product/branch half, this completes it with the tag.
CREATE INDEX IF NOT EXISTS idx_damaged_lots_product_branch_tag
  ON damaged_stock_lots(product_id, branch_id, condition_tag);
