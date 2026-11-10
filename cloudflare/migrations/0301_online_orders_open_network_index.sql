-- 0301 online orders: one partial index for the per-network open-order cap (KHQR lane, security review F5; schema only, no row touched).
-- The create route refuses an order when its network already holds planTier onlineOrderOpenPerNetworkMax unpaid orders with a live QR (lib/onlineOrderStore.ts
-- countOpenOrdersForNetwork, over online_orders.network_key, the keyed hash of the network, never an address). Only orders still waiting for payment are in the
-- index, so it stays as small as the open set and an order leaves it the moment it is paid, expired or cancelled.
-- Schema only, LF-only. A Worker that predates this file never names the index.
--
-- PRE:  the index does not exist. Record SELECT COUNT(*) FROM online_orders. POST: it exists and the count is identical.
-- Pinned by scripts/test-migration-0301-online-orders-open-network-index-native.cjs.
--
-- RECOVERY: roll the Worker back first (its cap names the index), then DROP INDEX IF EXISTS idx_online_orders_open_network;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_online_orders_open_network') = 0
THEN 1 ELSE json_extract('[]','$[online_orders_open_network_index_0301_pre]') END;

CREATE INDEX idx_online_orders_open_network ON online_orders (network_key) WHERE state = 'awaiting_payment';

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_online_orders_open_network') = 1
THEN 1 ELSE json_extract('[]','$[online_orders_open_network_index_0301_post]') END;
