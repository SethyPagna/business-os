-- D5 (Part 384): how many units a lot RECEIVED, cumulatively -- distinct
-- from branch_batch_stock (what remains). Purchases/cost summaries per
-- supplier need "bought", not "left": total spent with a supplier is
-- SUM(received_quantity * unit_cost_usd) over their batches, and that must
-- not shrink as the stock sells down.
--
-- Written by both receive paths (lib/productBatches.ts receiveBatchStock
-- and lib/stockActionCommit.ts's import add writer): set on INSERT,
-- incremented on every top-up of the same lot. Deployed BEFORE the 21k-row
-- history import runs, so historical batches arrive with their real
-- received totals. Batches created before this migration keep NULL
-- (unknown -- summaries COALESCE to 0 and say so), never a guessed value.

ALTER TABLE product_batches ADD COLUMN received_quantity REAL;
