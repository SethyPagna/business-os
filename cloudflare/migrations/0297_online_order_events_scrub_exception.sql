-- 0297 online order events: one narrow exception to "append-only" for the privacy scrub (KHQR lane, slice S5; no row touched).
-- online_order_events was append-only (0293): every UPDATE aborted. The 90 day scrub of unpaid orders (lib/onlineOrderScrub.ts) must clear the free text staff typed
-- into the Records of an order whose contact details it overwrites (a public comment or internal note can repeat the customer's phone or address).
-- The replacement trigger lets an UPDATE through ONLY when ALL of these hold:
--   - public_comment and internal_note are both set to NULL;
--   - every other column keeps exactly its value (IS, so NULLs compare equal);
--   - the event's order already carries scrubbed_at (the order row is scrubbed first, in the same batch).
-- Any other update still aborts with the old message, so a Record can still never be rewritten, only emptied of free text once its order was scrubbed.
-- Trigger SQL only, LF-only; no table or row changes.
--
-- PRE:  the old trigger exists and the exception trigger does not (the file has not run). Record SELECT COUNT(*) FROM online_order_events.
-- POST: exactly one update trigger exists on online_order_events, and it is the new one (its SQL names scrubbed_at). Counts identical.
-- Pinned by scripts/test-migration-0297-online-order-events-scrub-exception-native.cjs.
--
-- RECOVERY: roll the Worker back first (its scrub step then fails on the abort and clears nothing), then
--   DROP TRIGGER online_order_events_append_only_update;
--   and recreate it from 0293 (BEFORE UPDATE ON online_order_events BEGIN SELECT RAISE(ABORT, ...); END).

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'online_order_events_append_only_update' AND sql NOT LIKE '%scrubbed_at%') = 1
THEN 1 ELSE json_extract('[]','$[online_order_events_scrub_exception_0297_pre]') END;

DROP TRIGGER online_order_events_append_only_update;

CREATE TRIGGER online_order_events_append_only_update
BEFORE UPDATE ON online_order_events
WHEN NOT (
  NEW.public_comment IS NULL AND NEW.internal_note IS NULL
  AND NEW.id IS OLD.id AND NEW.order_id IS OLD.order_id AND NEW.payment_id IS OLD.payment_id AND NEW.request_id IS OLD.request_id
  AND NEW.event IS OLD.event AND NEW.from_state IS OLD.from_state AND NEW.to_state IS OLD.to_state AND NEW.source IS OLD.source
  AND NEW.actor_id IS OLD.actor_id AND NEW.actor_name IS OLD.actor_name AND NEW.amount_usd IS OLD.amount_usd AND NEW.amount_khr IS OLD.amount_khr
  AND NEW.reference IS OLD.reference AND NEW.attachments_json IS OLD.attachments_json AND NEW.sale_id IS OLD.sale_id AND NEW.return_id IS OLD.return_id
  AND NEW.amendment_group_id IS OLD.amendment_group_id AND NEW.action_history_id IS OLD.action_history_id AND NEW.detail_json IS OLD.detail_json
  AND NEW.created_at IS OLD.created_at
  AND EXISTS (SELECT 1 FROM online_orders WHERE id = OLD.order_id AND scrubbed_at IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'online_order_events is append-only: correct an entry by appending a new one, never by rewriting one');
END;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'online_order_events' AND name LIKE '%append_only_update') = 1
AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'online_order_events_append_only_update' AND sql LIKE '%scrubbed_at%') = 1
THEN 1 ELSE json_extract('[]','$[online_order_events_scrub_exception_0297_post]') END;
