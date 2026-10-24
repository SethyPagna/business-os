-- payment-details-census: read-only counts of sales whose payment_details the v0 shift reader cannot use (6.0.974 E4).
SELECT
  SUM(CASE WHEN payment_details = '' THEN 1 ELSE 0 END) AS empty_string,
  SUM(CASE WHEN payment_details IS NOT NULL AND payment_details <> '' AND TRIM(payment_details) = '' THEN 1 ELSE 0 END) AS whitespace_only,
  SUM(CASE WHEN payment_details IS NOT NULL AND TRIM(payment_details) <> '' AND NOT json_valid(payment_details) THEN 1 ELSE 0 END) AS malformed,
  SUM(CASE WHEN payment_details IS NOT NULL AND json_valid(payment_details) AND json_type(payment_details) <> 'array' AND payment_details <> 'null' THEN 1 ELSE 0 END) AS not_an_array,
  SUM(CASE WHEN (payment_details IS NULL OR payment_details = '[]') AND TRIM(COALESCE(payment_method, '')) = '' AND (amount_paid_usd > 0 OR amount_paid_khr > 0) THEN 1 ELSE 0 END) AS unnamed_method_with_money,
  SUM(CASE WHEN (payment_details = '' OR (payment_details IS NOT NULL AND TRIM(payment_details) <> '' AND NOT json_valid(payment_details))) AND (amount_paid_usd > 0 OR amount_paid_khr > 0) THEN 1 ELSE 0 END) AS unreadable_with_money
FROM sales;
