-- SCAN2 PP-5 / PP-12: promotion rules that can stop checkout or were cut short.
-- Every checkout (routes/sales.ts, POST /sales, add-items and replacement)
-- captures every is_active = 1 rule, ended or not (LIMIT 101), and refuses the
-- whole basket when more than MAX_PRICING_RULES (100) are captured or, after
-- normalizePromotionRule, one captured rule has min_quantity above
-- MAX_PRICING_UNITS (10000) or more than 10000 product ids
-- (lib/saleItemPricing.ts). routes/promotions.ts keeps only the first 200 ids.
-- One row:
--   active_rules                   is_active = 1 rules (checkout fails above 100)
--   min_quantity_over_limit(_ids)  active rules with min_quantity > 10000
--   percent_over_100(_ids)         active rules with percent_off > 100: capture
--                                  clamps these to 100, so they do not stop
--                                  checkout on their own
--   product_ids_over_limit(_ids)   active rules naming more than 10000 product ids
--   product_ids_not_json(_ids)     rules whose product_ids is not valid JSON (the
--                                  kernel reads them as no products)
--   exactly_200_products(_ids)     rules holding exactly 200 product ids: the save
--                                  may have dropped the rest (any is_active)
-- *_ids: up to 50 rule ids, comma-separated, lowest first.
-- Repair (proposed, not run): pause or fix the listed rules on the Promotions
-- page; for a 200-product rule, compare with what the owner meant to include.
-- Counts and rule ids only. Read-only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH r AS MATERIALIZED (
  SELECT id, is_active, COALESCE(min_quantity, 0) AS min_quantity, COALESCE(percent_off, 0) AS percent_off,
    CASE WHEN json_valid(product_ids) THEN json_array_length(product_ids) END AS id_count
  FROM promotion_rules
)
SELECT
  (SELECT COUNT(*) FROM r WHERE is_active = 1) AS active_rules,
  (SELECT COUNT(*) FROM r WHERE is_active = 1 AND min_quantity > 10000) AS min_quantity_over_limit,
  (SELECT group_concat(id) FROM (SELECT id FROM r WHERE is_active = 1 AND min_quantity > 10000 ORDER BY id LIMIT 50)) AS min_quantity_over_limit_ids,
  (SELECT COUNT(*) FROM r WHERE is_active = 1 AND percent_off > 100) AS percent_over_100,
  (SELECT group_concat(id) FROM (SELECT id FROM r WHERE is_active = 1 AND percent_off > 100 ORDER BY id LIMIT 50)) AS percent_over_100_ids,
  (SELECT COUNT(*) FROM r WHERE is_active = 1 AND id_count > 10000) AS product_ids_over_limit,
  (SELECT group_concat(id) FROM (SELECT id FROM r WHERE is_active = 1 AND id_count > 10000 ORDER BY id LIMIT 50)) AS product_ids_over_limit_ids,
  (SELECT COUNT(*) FROM r WHERE id_count IS NULL) AS product_ids_not_json,
  (SELECT group_concat(id) FROM (SELECT id FROM r WHERE id_count IS NULL ORDER BY id LIMIT 50)) AS product_ids_not_json_ids,
  (SELECT COUNT(*) FROM r WHERE id_count = 200) AS exactly_200_products,
  (SELECT group_concat(id) FROM (SELECT id FROM r WHERE id_count = 200 ORDER BY id LIMIT 50)) AS exactly_200_products_ids
