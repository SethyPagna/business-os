-- payment-change-census: read-only counts for the 6.0.974 delta review (E4b, E5b). Sales whose actual change the v0 shift
-- reader skips but an opening event would subtract, and created_at values not in canonical 'YYYY-MM-DD HH:MM:SS' form (datetime(), since D1 refuses long GLOB patterns).
SELECT
  SUM(CASE WHEN change_is_actual = 1 AND (change_usd IS NULL OR change_khr IS NULL) THEN 1 ELSE 0 END) AS actual_change_with_null_amount,
  SUM(CASE WHEN change_is_actual = 1 AND COALESCE(amount_paid_usd, 0) <= 0 AND COALESCE(amount_paid_khr, 0) <= 0 THEN 1 ELSE 0 END) AS actual_change_nothing_paid,
  SUM(CASE WHEN change_is_actual = 1 THEN 1 ELSE 0 END) AS actual_change_rows,
  SUM(CASE WHEN created_at IS NULL OR datetime(created_at) IS NULL OR datetime(created_at) <> created_at THEN 1 ELSE 0 END) AS created_at_not_canonical,
  COUNT(*) AS sales_rows
FROM sales;
