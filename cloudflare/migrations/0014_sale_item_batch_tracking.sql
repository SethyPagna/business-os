-- Adds batch/lot tracking to sale_items, so a sale line that was rung up
-- against a specific expiry-tracked lot (see lib/productBatches.ts) records
-- which one. Mirrors the base_price_usd/manual_discount_* pattern from
-- 0007_sale_item_manual_discount.sql: additive/reporting columns only,
-- existing totals math and every pre-batch sale row are untouched (all
-- three are NULL there, same as any product without batch tracking).
--
-- batch_label/batch_expiry_date are a denormalized copy of the batch's own
-- lot_code/expiry_date at the moment of sale, not a live join -- so a
-- receipt or return still shows the correct lot/expiry even if the batch
-- itself is edited or deactivated later.
ALTER TABLE sale_items ADD COLUMN batch_id INTEGER;
ALTER TABLE sale_items ADD COLUMN batch_label TEXT;
ALTER TABLE sale_items ADD COLUMN batch_expiry_date TEXT;
