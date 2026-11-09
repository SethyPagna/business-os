-- 0298 sales: a cancelled sale of an online order cannot be reopened once an ABA refund was noted for it (KHQR lane, slice S6a; trigger only, no row touched).
-- Cancelling a sale that fulfilled an online order puts the customer's money back to "refund due"; staff then send it through ABA and note it on the order (event
-- refund_noted). Reopening the sale after that would make the same dollars both refunded and sold. The sale status is written by the Sales page, the bulk status action and
-- the history replay of either, so the rule lives where all of them meet: the row. The trigger aborts any UPDATE that takes a cancelled sale out of 'cancelled' while an order
-- linked to it has a refund_noted Record. Orders and sales that have no such Record are unaffected, and so is every other update.
-- Trigger SQL only, LF-only; no table or row changes.
--
-- PRE:  the trigger does not exist (the file has not run). POST: exactly one such trigger exists on sales.
-- Pinned by scripts/test-migration-0298-sales-uncancel-online-refund-native.cjs.
--
-- RECOVERY: roll the Worker back first, then DROP TRIGGER sales_uncancel_after_online_refund;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'sales_uncancel_after_online_refund') = 0
THEN 1 ELSE json_extract('[]','$[sales_uncancel_online_refund_0298_pre]') END;

CREATE TRIGGER sales_uncancel_after_online_refund
BEFORE UPDATE OF sale_status ON sales
WHEN OLD.sale_status = 'cancelled' AND NEW.sale_status IS NOT 'cancelled'
  AND EXISTS (SELECT 1 FROM online_orders o JOIN online_order_events e ON e.order_id = o.id AND e.event = 'refund_noted' WHERE o.sale_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'online_refund_noted: this sale was cancelled and its online payment was refunded through ABA, so it cannot be reopened');
END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'sales' AND name = 'sales_uncancel_after_online_refund') = 1
THEN 1 ELSE json_extract('[]','$[sales_uncancel_online_refund_0298_post]') END;
