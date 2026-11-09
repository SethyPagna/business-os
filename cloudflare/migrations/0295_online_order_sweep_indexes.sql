-- 0295 online order sweep indexes (KHQR lane, slice S4: expand step; two partial indexes, no row touched).
-- The */5 cron sweep (lib/onlineOrderSweep.ts) needs two more bounded lookups, and an idle tick must read no row:
--   idx_online_orders_qr_failed         the orders stuck in qr_failed (the payment could not start, or was declined), oldest first, so the sweep
--                                       can expire the ones older than the QR lifetime plus the grace. Only qr_failed rows are in the index.
--   idx_online_order_payments_expired   the payments whose QR ran out, by expiry then by last check, so the sweep can re-check the recent ones with
--                                       PayWay (late money whose callback was lost). The window and the gap between re-checks are plan limits
--                                       (planTier onlineOrderLateCheckHours / onlineOrderLateCheckEveryMinutes) filtered on the index columns alone.
-- Schema only, LF-only. A Worker that predates this file behaves exactly as before (it never names either index).
--
-- PRE:  neither index exists (CREATE INDEX would fail half way). Record SELECT COUNT(*) FROM online_orders and online_order_payments.
-- POST: both indexes exist and those counts are identical. A failed check reads a malformed JSON path and aborts the file.
-- Pinned by scripts/test-migration-0295-online-order-sweep-indexes-native.cjs.
--
-- RECOVERY: roll the Worker back first (its sweep names both indexes with INDEXED BY), then
--   DROP INDEX IF EXISTS idx_online_orders_qr_failed;
--   DROP INDEX IF EXISTS idx_online_order_payments_expired;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_online_orders_qr_failed','idx_online_order_payments_expired')) = 0
THEN 1 ELSE json_extract('[]','$[online_order_sweep_indexes_0295_pre]') END;

CREATE INDEX idx_online_orders_qr_failed ON online_orders (updated_at) WHERE state = 'qr_failed';
CREATE INDEX idx_online_order_payments_expired ON online_order_payments (expires_at, last_checked_at) WHERE state = 'expired';

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_online_orders_qr_failed','idx_online_order_payments_expired')) = 2
THEN 1 ELSE json_extract('[]','$[online_order_sweep_indexes_0295_post]') END;
