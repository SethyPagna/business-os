-- SCAN2 PP-1: sale lines on a promotion's advertised last day that were rung at
-- full price after the offer had already expired. A date-only end ('YYYY-MM-DD')
-- is read as 00:00 UTC (lib/promotionRules.ts windowOpen, the product discount
-- twin in lib/promotionRulesSql.ts), which is 07:00 Cambodia time on that last
-- day, so the till dropped the offer for the rest of the day.
-- A candidate line: a system sale (not cancelled) whose Cambodia business day
-- (UTC+7) equals the end date, created at or after 00:00 UTC of that date, for
-- a product in scope, priced 'selling' or 'promotion' with no product discount
-- (sale_items.product_discount_usd = 0 is how every line records "no offer").
--   rule               promotion_rules with a date-only ends_at; scope from
--                      product_ids, or category / brand against the product's
--                      primary or '||' multi-value column (lib/promotionRules.ts
--                      fieldMatches)
--   product_discount   products with discount_enabled, a benefit, and a date-only
--                      discount_ends_at
-- Approximate: scope and the product discount are read from TODAY's rows, and a
-- quantity or spend rule may not have qualified; lines is an upper bound.
-- Columns: source, rule_id, product_id (product_discount only), last_day,
--   rule_type, rule_is_active_now, lines, units, lines_total_usd, sales,
--   first_sale_id, last_sale_id
-- Repair (proposed, not run): none by SQL; a refund of the missed discount is an
-- owner decision per rule/product (SCAN2 owner question 3).
-- Ids, dates, counts and line totals only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 2000
WITH rule_days AS MATERIALIZED (
  SELECT id AS rule_id, trim(ends_at) AS last_day, rule_type, scope_type, is_active,
    CASE WHEN json_valid(product_ids) THEN product_ids ELSE '[]' END AS ids_json,
    lower(trim(COALESCE(category, ''))) AS want_category, lower(trim(COALESCE(brand, ''))) AS want_brand
  FROM promotion_rules
  WHERE length(trim(COALESCE(ends_at, ''))) = 10 AND date(trim(ends_at)) = trim(ends_at)
    AND (COALESCE(trim(starts_at), '') = '' OR date(starts_at) <= trim(ends_at))
),
discount_days AS MATERIALIZED (
  SELECT id AS product_id, trim(discount_ends_at) AS last_day
  FROM products
  WHERE COALESCE(discount_enabled, 0) = 1
    AND length(trim(COALESCE(discount_ends_at, ''))) = 10 AND date(trim(discount_ends_at)) = trim(discount_ends_at)
    AND (COALESCE(trim(discount_starts_at), '') = '' OR date(discount_starts_at) <= trim(discount_ends_at))
    AND ((lower(COALESCE(discount_type, 'percent')) <> 'fixed' AND COALESCE(discount_percent, 0) > 0)
      OR (lower(COALESCE(discount_type, 'percent')) = 'fixed'
        AND (COALESCE(discount_amount_usd, 0) > 0 OR COALESCE(discount_amount_khr, 0) > 0)))
),
last_days AS MATERIALIZED (
  SELECT last_day FROM rule_days UNION SELECT last_day FROM discount_days
),
missed AS MATERIALIZED (
  SELECT si.sale_id, si.product_id, si.quantity, si.total_usd, d.last_day,
    lower(trim(COALESCE(p.category, ''))) AS category,
    '||' || replace(replace(lower(COALESCE(p.categories, '')), '|| ', '||'), ' ||', '||') || '||' AS categories,
    lower(trim(COALESCE(p.brand, ''))) AS brand,
    '||' || replace(replace(lower(COALESCE(p.brands, '')), '|| ', '||'), ' ||', '||') || '||' AS brands
  FROM last_days d
  JOIN sales s ON s.created_at >= d.last_day AND s.created_at < date(d.last_day, '+1 day')
  JOIN sale_items si ON si.sale_id = s.id
  LEFT JOIN products p ON p.id = si.product_id
  WHERE date(s.created_at, '+7 hours') = d.last_day
    AND julianday(s.created_at) >= julianday(d.last_day)
    AND COALESCE(s.legacy_receipt_number, '') = ''
    AND COALESCE(NULLIF(s.sale_status, ''), 'completed') <> 'cancelled'
    AND COALESCE(si.product_discount_usd, 0) = 0
    AND COALESCE(si.price_mode, 'selling') IN ('selling', 'promotion')
)
SELECT 'rule' AS source, r.rule_id, NULL AS product_id, r.last_day, r.rule_type, r.is_active AS rule_is_active_now,
  COUNT(*) AS lines, SUM(m.quantity) AS units, ROUND(SUM(COALESCE(m.total_usd, 0)), 4) AS lines_total_usd,
  COUNT(DISTINCT m.sale_id) AS sales, MIN(m.sale_id) AS first_sale_id, MAX(m.sale_id) AS last_sale_id
FROM rule_days r
JOIN missed m ON m.last_day = r.last_day
WHERE (r.scope_type = 'products'
    AND EXISTS (SELECT 1 FROM json_each(r.ids_json) j WHERE CAST(j.value AS INTEGER) = m.product_id))
  OR (r.scope_type = 'category' AND r.want_category <> ''
    AND (m.category = r.want_category OR instr(m.categories, '||' || r.want_category || '||') > 0))
  OR (r.scope_type = 'brand' AND r.want_brand <> ''
    AND (m.brand = r.want_brand OR instr(m.brands, '||' || r.want_brand || '||') > 0))
GROUP BY r.rule_id
UNION ALL
SELECT 'product_discount', NULL, dd.product_id, dd.last_day, NULL, NULL,
  COUNT(*), SUM(m.quantity), ROUND(SUM(COALESCE(m.total_usd, 0)), 4),
  COUNT(DISTINCT m.sale_id), MIN(m.sale_id), MAX(m.sale_id)
FROM discount_days dd
JOIN missed m ON m.last_day = dd.last_day AND m.product_id = dd.product_id
GROUP BY dd.product_id
ORDER BY 1, 2, 3
LIMIT 2000
