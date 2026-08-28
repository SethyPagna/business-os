-- G1 (Part 391): the promotion RULE engine -- multi-product pricing rules,
-- distinct from the existing `promotions` table (0002), which is the
-- portal's ANNOUNCEMENT STRIP (banners with images/links) and stays as-is.
--
-- One row = one rule. Three rule types (rule_type):
--   'quantity_save' -- "buy >= min_quantity of a qualifying product, save
--                      save_usd/save_khr off that line's total"
--   'percent_off'   -- percent_off% off qualifying products' selling price
--   'fixed_off'     -- save_usd/save_khr off each qualifying unit
-- Scope (scope_type): 'products' (product_ids JSON array -- one id = "one
-- product", many = "a set"), 'category', or 'brand' (single value each,
-- matched the same way the product facet filters match, primary or
-- multi-value column).
-- Title is the customer-facing label; show_title=0 keeps the price cut
-- while hiding the label chip (the price math itself never hides).
-- Windows (starts_at/ends_at) use the same semantics as the per-product
-- discount fields on products: blank = open-ended; a date-only end expires
-- at that date's midnight (see lib/promotionRules.ts isRuleActive, the one
-- shared evaluator POS and portal both read -- truth never diverges).
--
-- POS applies the BEST single benefit per line (rule vs the product's own
-- per-product discount -- never stacked), stores it in the existing
-- sale_items product_discount_* fields with the rule title as the label,
-- so receipts/history need no schema change.

CREATE TABLE promotion_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  show_title INTEGER NOT NULL DEFAULT 1,
  rule_type TEXT NOT NULL DEFAULT 'percent_off',
  min_quantity REAL NOT NULL DEFAULT 0,
  save_usd REAL NOT NULL DEFAULT 0,
  save_khr REAL NOT NULL DEFAULT 0,
  percent_off REAL NOT NULL DEFAULT 0,
  scope_type TEXT NOT NULL DEFAULT 'products',
  product_ids TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  brand TEXT,
  badge_color TEXT DEFAULT '#e11d48',
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Reads are "every rule that could be active now" (small table, filtered
-- further in code); the admin list orders by recency.
CREATE INDEX idx_promotion_rules_active ON promotion_rules (is_active, ends_at);
