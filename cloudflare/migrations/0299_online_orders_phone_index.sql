-- 0299 online orders: an index for the staff search by phone (KHQR lane, slice S6; one index, no row touched).
-- The staff Orders list searches by a typed phone number (lib/onlineOrderStaff.ts listOrders, `q`): a prefix of the canonical number (the stored form, lib/phone.ts), newest
-- first. Without this index that search reads every order. The same column is read by the open-orders-per-phone cap at checkout (lib/onlineOrderStore.ts), which benefits too.
-- Schema only, LF-only. A Worker that predates this file never names the index.
--
-- PRE:  the index does not exist. Record SELECT COUNT(*) FROM online_orders. POST: the index exists and the count is identical.
-- Pinned by scripts/test-migration-0299-online-orders-phone-index-native.cjs.
--
-- RECOVERY: roll the Worker back first (its search names the index), then DROP INDEX IF EXISTS idx_online_orders_phone;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_online_orders_phone') = 0
THEN 1 ELSE json_extract('[]','$[online_orders_phone_index_0299_pre]') END;

CREATE INDEX idx_online_orders_phone ON online_orders (customer_phone, created_at, id);

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_online_orders_phone') = 1
THEN 1 ELSE json_extract('[]','$[online_orders_phone_index_0299_post]') END;
