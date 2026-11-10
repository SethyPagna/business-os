-- 0299 online orders: three indexes, for the staff search by phone and for the report of refunds sent through ABA (KHQR lane, slice S6; no row touched).
-- The staff Orders list searches by a typed phone number (lib/onlineOrderStaff.ts listOrders, `q`): a prefix of the canonical number (the stored form, lib/phone.ts), newest
-- first. Without this index that search reads every order. The same column is read by the open-orders-per-phone cap at checkout (lib/onlineOrderStore.ts), which benefits too.
-- The Reports overview lists the refunds staff wrote down as sent through ABA in its window (lib/onlineOrderReceived.ts onlineReportBlocks); the partial index holds only those Records, by date. The same block counts the returns refunded through ABA (returns.refund_channel = 'aba', S6b): a second partial index holds only those, by date.
-- Schema only, LF-only. A Worker that predates this file never names the index.
--
-- PRE:  neither index exists. Record SELECT COUNT(*) FROM online_orders. POST: both exist and the count is identical.
-- Pinned by scripts/test-migration-0299-online-orders-phone-index-native.cjs.
--
-- RECOVERY: roll the Worker back first (its search names the phone index), then DROP INDEX IF EXISTS idx_online_orders_phone; DROP INDEX IF EXISTS idx_online_order_events_refund; DROP INDEX IF EXISTS idx_returns_aba_refund;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_online_orders_phone','idx_online_order_events_refund','idx_returns_aba_refund')) = 0
THEN 1 ELSE json_extract('[]','$[online_orders_phone_index_0299_pre]') END;

CREATE INDEX idx_online_orders_phone ON online_orders (customer_phone, created_at, id);
CREATE INDEX idx_online_order_events_refund ON online_order_events (created_at) WHERE event = 'refund_noted';
CREATE INDEX idx_returns_aba_refund ON returns (created_at) WHERE refund_channel = 'aba';

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_online_orders_phone','idx_online_order_events_refund','idx_returns_aba_refund')) = 3
THEN 1 ELSE json_extract('[]','$[online_orders_phone_index_0299_post]') END;
