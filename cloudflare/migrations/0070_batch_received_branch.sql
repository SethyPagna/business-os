-- D1b (Stock-In Invoice report): WHICH branch a lot was received into.
-- product_batches carried supplier (0062), cost/payment (0065) and the
-- cumulative received total (0067), but not the receiving branch — a
-- batch's branch_batch_stock rows say where its stock SITS today (and gain
-- rows on transfer), which is not the same fact as "received into". The
-- report's branch filter (shop / warehouse / all) needs the receive-time
-- fact, so it becomes its own column, stamped by both receive writers
-- (lib/productBatches.ts receiveBatchStock, lib/stockActionCommit.ts
-- applyUnifiedStockAdd). First attribution sticks on top-ups, same rule as
-- supplier/cost. Rows written before this migration keep NULL (unknown)
-- honestly — the report shows and counts them as "no branch recorded"
-- instead of guessing. Deployed BEFORE the migration-pack history import
-- runs, so the 21k-row history lands with its real shop/warehouse split.
ALTER TABLE product_batches ADD COLUMN received_branch_id INTEGER;

-- The report filters and groups by received date. Existing indexes all
-- lead with variant_product_id (per-product reads); this report reads
-- across ALL products by date, so received_at gets its own index.
CREATE INDEX idx_product_batches_received_at ON product_batches (received_at);
