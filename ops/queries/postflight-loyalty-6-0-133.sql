-- Release 2e postflight, review checklist item 11 (lead ruling 3): how many
-- customers' loyalty balance moved through change 6.0.133. READ-ONLY: one row
-- of counts and the programme rate settings; no customer ids, names or phones.
--
-- 6.0.133 ("A return of a sale that earned no points takes no points back",
-- lib/customerPointsReturn.ts customerPointsReturnSql): the returns term of the
-- balance used to deduct every non-supplier, non-cancelled return's refund at
-- the points rate. It now skips a return whose sale has loyalty_accrual = 0
-- (migrated old-system history and POS opt-outs: the sale earned nothing, so
-- its refund took back points never earned). A return naming no sale still
-- deducts. The balance is computed on every read from sales/returns, never
-- stored, and the flag is read when the balance is asked, so the effect is
-- derived from live rows, not from a log of what changed.
--
-- What this counts (a customer is "moved" when the new balance differs from the
-- pre-6.0.133 formula): customers with at least one return that is
--   - on a customer (returns.customer_id exists in customers),
--   - not cancelled (COALESCE(status,'completed') <> 'cancelled'),
--   - not a supplier return (COALESCE(return_scope,'customer') <> 'supplier'),
--   - with a non-zero refund (total_refund_usd or total_refund_khr),
--   - on a sale with COALESCE(loyalty_accrual,1) = 0.
-- Each such customer's balance is higher today by refund * rate than it was
-- before 6.0.133 (if the programme rate is above 0: see points_per_usd and
-- points_basis below; with a zero rate nothing moves). Not knowable from data
-- with one SELECT: how many of them ever SAW the lower balance, or had a
-- redemption refused on it (balances are not stored, so there is no history to
-- read). The count is therefore the set whose balance differs from the
-- pre-6.0.133 formula today: an upper bound on customers who noticed.
--   customers_moved            distinct customers as defined above
--   returns_ignored            the returns involved (all customers, same filters)
--   customers_moved_since_2e   customers with such a return created at or after
--                              2026-10-14T15:33:00Z (returns.created_at, UTC)
--   non_accruing_sales_with_customer  sales with loyalty_accrual = 0 and a customer
--   customers_with_non_accruing_sales distinct customers owning those
--   returns_no_sale_still_deducting   returns with no sale: unchanged by 6.0.133
--   points_per_usd / points_basis / points_enabled   programme settings (not private)
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(DISTINCT r.customer_id) FROM returns r
    JOIN customers c ON c.id = r.customer_id
    JOIN sales s ON s.id = r.sale_id
    WHERE COALESCE(r.status, 'completed') <> 'cancelled'
      AND COALESCE(r.return_scope, 'customer') <> 'supplier'
      AND (COALESCE(r.total_refund_usd, 0) <> 0 OR COALESCE(r.total_refund_khr, 0) <> 0)
      AND COALESCE(s.loyalty_accrual, 1) = 0) AS customers_moved,
  (SELECT COUNT(*) FROM returns r
    JOIN customers c ON c.id = r.customer_id
    JOIN sales s ON s.id = r.sale_id
    WHERE COALESCE(r.status, 'completed') <> 'cancelled'
      AND COALESCE(r.return_scope, 'customer') <> 'supplier'
      AND (COALESCE(r.total_refund_usd, 0) <> 0 OR COALESCE(r.total_refund_khr, 0) <> 0)
      AND COALESCE(s.loyalty_accrual, 1) = 0) AS returns_ignored,
  (SELECT COUNT(DISTINCT r.customer_id) FROM returns r
    JOIN customers c ON c.id = r.customer_id
    JOIN sales s ON s.id = r.sale_id
    WHERE COALESCE(r.status, 'completed') <> 'cancelled'
      AND COALESCE(r.return_scope, 'customer') <> 'supplier'
      AND (COALESCE(r.total_refund_usd, 0) <> 0 OR COALESCE(r.total_refund_khr, 0) <> 0)
      AND COALESCE(s.loyalty_accrual, 1) = 0
      AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', r.created_at), r.created_at) >= '2026-10-14 15:33:00') AS customers_moved_since_2e,
  (SELECT COUNT(*) FROM sales WHERE loyalty_accrual = 0 AND customer_id IS NOT NULL) AS non_accruing_sales_with_customer,
  (SELECT COUNT(DISTINCT customer_id) FROM sales WHERE loyalty_accrual = 0 AND customer_id IS NOT NULL) AS customers_with_non_accruing_sales,
  (SELECT COUNT(*) FROM returns
    WHERE sale_id IS NULL AND customer_id IS NOT NULL
      AND COALESCE(status, 'completed') <> 'cancelled'
      AND COALESCE(return_scope, 'customer') <> 'supplier') AS returns_no_sale_still_deducting,
  (SELECT value FROM settings WHERE key = 'customer_portal_points_per_usd') AS points_per_usd,
  (SELECT value FROM settings WHERE key = 'customer_portal_points_basis') AS points_basis,
  (SELECT value FROM settings WHERE key = 'loyalty_points_enabled') AS points_enabled
