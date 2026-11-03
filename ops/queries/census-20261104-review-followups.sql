-- Review follow-up census (4 Nov 2026). READ-ONLY: one row of counts, no ids, names, values or amounts.
--   has_sqlite_stat1        1 when the database holds planner statistics (decides which Inventory Check plan production pays for)
--   east_offset_courier     courier-cost sales whose created_at text is a day ahead of its Cambodia day (E1-F export bound)
--   undated_courier         courier-cost sales whose created_at does not parse (E1-F export ordering)
--   sub_cent_selling_prices active products whose selling price has more than two decimals (MONEY-1 price display)
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 250000
SELECT
  (SELECT COUNT(*) FROM sqlite_master WHERE name = 'sqlite_stat1') AS has_sqlite_stat1,
  (SELECT COUNT(*) FROM sales WHERE (delivery_actual_cost_usd IS NOT NULL OR delivery_actual_cost_khr IS NOT NULL) AND substr(created_at, 1, 10) > date(created_at, '+7 hours')) AS east_offset_courier,
  (SELECT COUNT(*) FROM sales WHERE (delivery_actual_cost_usd IS NOT NULL OR delivery_actual_cost_khr IS NOT NULL) AND date(created_at, '+7 hours') IS NULL) AS undated_courier,
  (SELECT COUNT(*) FROM products WHERE is_active = 1 AND abs(selling_price_usd * 100 - round(selling_price_usd * 100)) > 0.000001) AS sub_cent_selling_prices
