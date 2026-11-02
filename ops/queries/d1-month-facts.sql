-- d1-month-facts: sales, lines, distinct products and customers per Cambodia
-- month, to size prepared per-period report figures. Counts only.
-- ops:min-rows 1
-- ops:max-rows-read 126496
SELECT strftime('%Y-%m', s.created_at, '+7 hours') AS month,
       COUNT(DISTINCT s.id) AS sales, COUNT(*) AS lines,
       COUNT(DISTINCT si.product_id) AS products, COUNT(DISTINCT s.customer_id) AS customers
FROM sales s JOIN sale_items si ON si.sale_id = s.id
GROUP BY month
ORDER BY month;
