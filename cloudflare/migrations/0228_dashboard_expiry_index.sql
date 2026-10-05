-- G39 efficiency item 1: the Dashboard's expiring-products list and count
-- (lib/dashboardStockOverview.ts, and the same predicate in routes/compat.ts
-- dashboardInsightList) filter
--   p.is_active = 1 AND expiry_date IS NOT NULL
--   AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')
-- and the list orders by date(expiry_date). No index covered expiry_date, so
-- both statements walked EVERY active product through
-- idx_products_active_grouped_pg (is_active=?) and the list added a temp
-- B-tree sort: about 2 x the active catalog (~8k rows each) per Dashboard load.
--
-- This partial index holds only products that HAVE an expiry date. Its
-- leading is_active column matches the existing equality, so the planner
-- prefers it with no sqlite_stat1 (checked with and without ANALYZE), then
-- walks it in date(expiry_date) order: the list needs no sort and the count
-- reads only products with an expiry date. The per-row bound
-- (expiry_alert_days) stays a row filter; the query text is unchanged.
-- date() without 'now' is deterministic, so it is allowed in an index.
--
-- Purely additive and idempotent: CREATE INDEX IF NOT EXISTS on existing
-- columns. No row is read back or changed; only query plans change. Without
-- it every result is identical, it only costs more reads.
--
-- Pre-assert:  SELECT COUNT(*) FROM sqlite_master WHERE type='index'
--                AND name = 'idx_products_active_expiry_day'
--              -- expected 0; also record SELECT COUNT(*) FROM products
--              -- and SELECT COUNT(*) FROM products WHERE is_active = 1
--              --   AND expiry_date IS NOT NULL (the index's row count).
-- Post-assert: the same sqlite_master query -> 1; both counts unchanged;
--              EXPLAIN QUERY PLAN of the Dashboard expiry list shows
--              "USING INDEX idx_products_active_expiry_day" and no TEMP B-TREE.
-- Deploy order: EITHER. No code names this index; the planner picks it up.
-- Recovery:    DROP INDEX IF EXISTS idx_products_active_expiry_day;
--              removes only the seek path, never data.

CREATE INDEX IF NOT EXISTS idx_products_active_expiry_day
  ON products(is_active, date(expiry_date))
  WHERE expiry_date IS NOT NULL;
