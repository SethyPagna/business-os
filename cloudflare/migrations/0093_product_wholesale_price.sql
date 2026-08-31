-- 0093: wholesale (បោះដុំ) price -- a fourth per-product price tier alongside
-- selling / special(VIP) / cost. Purely additive columns defaulting to 0, so
-- every existing row reads as "no wholesale price set". The POS only offers
-- the Wholesale tier when the price is > 0, exactly the same gate the VIP
-- (special) tier already uses, so a 0 here is invisible everywhere and
-- nothing regresses.
--
-- The write path needs no code change: lib/productWrites.ts's cleanPayload()
-- writes any request-body key that matches a real table column, so once these
-- columns exist the product create/update endpoints persist them
-- automatically. Only the read SELECT lists (routes/products.ts) name the
-- price columns explicitly and are updated alongside this migration.
--
-- The "wholesale only > N" note and its default-off auto-apply toggle are a
-- separate, still-being-specified sub-feature and get their own later
-- migration; this one is just the price itself.

ALTER TABLE products ADD COLUMN wholesale_price_usd REAL DEFAULT 0;
ALTER TABLE products ADD COLUMN wholesale_price_khr REAL DEFAULT 0;
