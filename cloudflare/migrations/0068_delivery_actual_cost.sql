-- P6 (Part 386): what delivery ACTUALLY cost the shop, per sale -- the
-- courier/tuktuk money paid out, distinct from delivery_fee_usd (what the
-- customer was charged, or the store absorbed). Staff-only per the C2
-- redaction scope: it appears in the Sales stats drill and the staff sale
-- detail, never on receipts or any customer/portal surface.
--
-- Money-pair convention (usd+khr) like every other money column. NULL =
-- not recorded (historical sales, or staff didn't enter one) -- stats sum
-- with COALESCE and the margin line says how many sales carried one, so a
-- missing cost is visible rather than counted as 0 profit.
--
-- Deliberately NOT part of profit_usd yet: the standing rule is that
-- moves/polish must not change existing calculations. The stats show
-- charged / actual / margin side by side; folding actual cost into profit
-- is its own explicit decision later.

ALTER TABLE sales ADD COLUMN delivery_actual_cost_usd REAL;
ALTER TABLE sales ADD COLUMN delivery_actual_cost_khr REAL;
