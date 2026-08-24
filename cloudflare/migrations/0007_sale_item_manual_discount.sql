-- Adds manual, cashier-entered per-item discount tracking to sale_items.
--
-- Previously the only way to "discount" a line item was to overwrite
-- applied_price_usd/khr directly, which loses the audit trail of what the
-- item's actual price was vs. how much the cashier knocked off at
-- checkout -- important for discount reporting and for reconciling receipts
-- against the product catalog. base_price_usd/khr captures the resolved
-- selling/special/promotion price *before* any manual discount (distinct
-- from product_discount_* which already exists for product-level
-- promotions), and manual_discount_* records what was applied on top of it.
--
-- applied_price_usd/khr remain the source of truth actually charged and
-- used in all total calculations -- these new columns are additive/
-- reporting fields only, so existing totals math is untouched.
ALTER TABLE sale_items ADD COLUMN base_price_usd REAL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN base_price_khr REAL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN manual_discount_type TEXT;
ALTER TABLE sale_items ADD COLUMN manual_discount_value REAL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN manual_discount_usd REAL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN manual_discount_khr REAL DEFAULT 0;
