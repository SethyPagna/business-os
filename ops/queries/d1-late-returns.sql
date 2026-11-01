-- d1-late-returns: returns recorded in a later Cambodia month than their sale,
-- per return month. Sizes how often a closed period's prepared figures change.
-- ops:min-rows 0
SELECT strftime('%Y-%m', r.created_at, '+7 hours') AS return_month, COUNT(*) AS returns_on_older_month_sales
FROM returns r JOIN sales s ON s.id = r.sale_id
WHERE strftime('%Y-%m', r.created_at, '+7 hours') <> strftime('%Y-%m', s.created_at, '+7 hours')
GROUP BY return_month
ORDER BY return_month;
