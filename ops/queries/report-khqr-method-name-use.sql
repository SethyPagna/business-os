-- report-khqr-method-name-use: whether the till or any sale already uses the online-order method name "ABA KHQR".
-- Run before deploying online orders, even with the switch off. Counts only, one row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 200000
SELECT
  (SELECT COUNT(*) FROM settings WHERE key = 'pos_payment_methods' AND lower(value) LIKE '%aba khqr%') AS till_methods_named,
  (SELECT COUNT(*) FROM settings WHERE key = 'online_order_payment_method') AS online_method_setting_rows,
  (SELECT COUNT(*) FROM sales WHERE lower(COALESCE(payment_method, '')) LIKE '%aba khqr%'
    OR lower(COALESCE(payment_details, '')) LIKE '%aba khqr%') AS sales_named
