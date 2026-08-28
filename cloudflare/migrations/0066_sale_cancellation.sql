-- Sale cancellation, fully scoped (Part 383 R3).
--
-- Cancelling stops being a bare status flip: it records WHY (a fixed
-- reason -- mistake / buyer_refused / other -- plus a free-text note,
-- required when the reason is 'other'), WHO and WHEN, remembers where the
-- sale was (status_before_cancel -- un-cancelling may ONLY go back there),
-- and can carry a linked lost-fee expense row (cancel_fee_id -> fees.id;
-- e.g. a delivery fee the shop already paid that the buyer refused to
-- cover). The stock itself comes back as new 'return'
-- inventory_movements whose reason names the cancellation -- the original
-- sale movements are never deleted or rewritten.
--
-- cancel_reason is free TEXT, not a CHECK enum, same as fees.fee_type
-- (migration 0018) and customers.gender (0017): D1/SQLite has no enum
-- type and the valid set is enforced at the edge
-- (lib/saleTransitions.ts's normalizeCancelReason on every write).
-- cancel_fee_id is deliberately NOT a foreign key, same reasoning as
-- fees.sale_id in 0018: the fee row is its own durable money record.
-- Historical/imported sales that arrived already cancelled keep every
-- column NULL and render as plain "cancelled".

ALTER TABLE sales ADD COLUMN cancel_reason TEXT;
ALTER TABLE sales ADD COLUMN cancel_note TEXT;
ALTER TABLE sales ADD COLUMN cancelled_at TEXT;
ALTER TABLE sales ADD COLUMN cancelled_by_name TEXT;
ALTER TABLE sales ADD COLUMN status_before_cancel TEXT;
ALTER TABLE sales ADD COLUMN cancel_fee_id INTEGER;
