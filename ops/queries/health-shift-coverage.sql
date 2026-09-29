-- health-shift-coverage: is every drawer event inside a shift the drawer
-- reconciliation can see? (DATA-MATCH DM-12). The expected-cash formula stays in
-- lib/shiftReconciliation.ts (one definition); this checks only its inputs.
-- A window is [opened_at, closed_at or cancelled_at or now) on the shift's branch
-- (any branch when the shift has none), and the shift's user unless shop_wide --
-- lib/shiftReconciliation.ts shiftFilters, compared with datetime() on both sides as
-- lib/salesAnalytics.ts shiftWindowWhere does. Last 35 days, system rows only.
--   sales_outside_shift / returns_outside_shift / fees_outside_shift (fees with a creator:
--                          migration 0064's 4,240 old-system expenses carry none and the
--                          migration time as created_at)
--   open_shifts_before_today, closed_without_count, closed_before_opened
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH sh AS MATERIALIZED (
  SELECT id, user_id, branch_id, scope_mode, business_date,
    COALESCE(datetime(opened_at), opened_at) AS o,
    COALESCE(datetime(COALESCE(closed_at, cancelled_at)), COALESCE(closed_at, cancelled_at), '9999-12-31 00:00:00') AS c
  FROM shift_sessions WHERE business_date >= date('now', '-37 days')
),
ev AS MATERIALIZED (
  SELECT 'sale' AS kind, id, cashier_id AS actor, branch_id, COALESCE(datetime(created_at), created_at) AS at
    FROM sales WHERE created_at >= date('now', '-35 days') AND COALESCE(legacy_receipt_number, '') = ''
  UNION ALL
  SELECT 'return', id, cashier_id, branch_id, COALESCE(datetime(created_at), created_at)
    FROM returns WHERE created_at >= date('now', '-35 days') AND COALESCE(return_scope, 'customer') = 'customer'
  UNION ALL
  SELECT 'fee', id, created_by, branch_id, COALESCE(datetime(created_at), created_at)
    FROM fees WHERE created_at >= date('now', '-35 days') AND created_by IS NOT NULL
),
miss AS MATERIALIZED (
  SELECT e.kind FROM ev e WHERE NOT EXISTS (
    SELECT 1 FROM sh WHERE e.at >= sh.o AND e.at < sh.c
      AND (sh.branch_id IS NULL OR e.branch_id IS NULL OR e.branch_id = sh.branch_id)
      AND (sh.scope_mode = 'shop_wide' OR e.actor IS sh.user_id))
)
SELECT
  (SELECT COUNT(*) FROM miss WHERE kind = 'sale') AS sales_outside_shift,
  (SELECT COUNT(*) FROM miss WHERE kind = 'return') AS returns_outside_shift,
  (SELECT COUNT(*) FROM miss WHERE kind = 'fee') AS fees_outside_shift,
  (SELECT COUNT(*) FROM ev) AS events_checked,
  (SELECT COUNT(*) FROM shift_sessions WHERE closed_at IS NULL AND cancelled_at IS NULL
     AND business_date < date('now', '+7 hours')) AS open_shifts_before_today,
  (SELECT COUNT(*) FROM shift_sessions WHERE closed_at IS NOT NULL
     AND closing_counted_usd IS NULL AND closing_counted_khr IS NULL) AS closed_without_count,
  (SELECT COUNT(*) FROM shift_sessions WHERE closed_at IS NOT NULL
     AND COALESCE(strftime('%s', closed_at), 0) < COALESCE(strftime('%s', opened_at), 0)) AS closed_before_opened
