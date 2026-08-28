-- G1b (Part 397): three more promotion rule types + label wording styles.
--
-- New rule_type values (TEXT column, no shape change needed):
--   'spend_save'       -- spend >= min_spend on a qualifying line, save
--                         save_usd/save_khr off that line
--   'quantity_percent' -- buy >= min_quantity, get percent_off% off
--   'next_item'        -- buy min_quantity qualifying items, the NEXT one
--                         is percent_off% (or save_usd/khr) off. Applied
--                         to the CHEAPEST item of each complete group
--                         ("only lowest of the two gets the discount" --
--                         user rule), repeating per group, evaluated
--                         cart-wide across every line the rule reaches.
--
-- min_spend_* carries spend_save's threshold. label_style picks the
-- wording family for AUTO-generATED titles ('save' -> "Buy 3 Save $5",
-- 'get' -> "Buy 3 Get $5 Off", 'free' -> "Buy 1 Get 1 Free" where the
-- math genuinely makes it free); a typed title always overrides.

ALTER TABLE promotion_rules ADD COLUMN min_spend_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE promotion_rules ADD COLUMN min_spend_khr REAL NOT NULL DEFAULT 0;
ALTER TABLE promotion_rules ADD COLUMN label_style TEXT NOT NULL DEFAULT 'save';
