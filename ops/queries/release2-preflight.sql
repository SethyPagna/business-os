-- Release 2 preflight: counts only (no names, phones, notes or amounts per row).
-- Stock rollup drift, inventory-import apply volume, migration 0223, audit id
-- shape, stored discount spellings, queued discount payloads, and return lines
-- on a sale with no sale_item_id.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM products p
    LEFT JOIN (SELECT product_id, SUM(quantity) q FROM branch_stock GROUP BY product_id) b ON b.product_id = p.id
    WHERE p.stock_quantity <> COALESCE(b.q, 0)) AS products_total_vs_branch_drift,
  (SELECT ROUND(SUM(p.stock_quantity - COALESCE(b.q, 0)), 4) FROM products p
    LEFT JOIN (SELECT product_id, SUM(quantity) q FROM branch_stock GROUP BY product_id) b ON b.product_id = p.id
    WHERE p.stock_quantity <> COALESCE(b.q, 0)) AS drift_net_units,
  (SELECT COUNT(DISTINCT r.job_id) FROM import_job_rows r JOIN import_jobs j ON j.id = r.job_id
    WHERE j.type = 'inventory' AND r.phase = 'apply' AND r.action = 'create') AS inventory_import_jobs_applied,
  (SELECT COUNT(*) FROM import_job_rows r JOIN import_jobs j ON j.id = r.job_id
    WHERE j.type = 'inventory' AND r.phase = 'apply' AND r.action = 'create') AS inventory_import_rows_applied,
  (SELECT COUNT(*) FROM d1_migrations WHERE name LIKE '0223%') AS migration_0223_applied,
  (SELECT COUNT(*) FROM audit_logs WHERE entity_id LIKE '%.0') AS audit_entity_id_decimal_shape,
  (SELECT COUNT(*) FROM products WHERE discount_enabled IS NOT NULL AND discount_enabled NOT IN (0, 1)) AS discount_enabled_odd,
  (SELECT COUNT(*) FROM products WHERE discount_type IS NOT NULL AND lower(discount_type) NOT IN ('percent', 'fixed', '')) AS discount_type_odd,
  (SELECT COUNT(*) FROM products WHERE typeof(discount_percent) = 'text' OR typeof(discount_amount_usd) = 'text' OR typeof(discount_amount_khr) = 'text') AS discount_amount_text,
  (SELECT COUNT(*) FROM pending_actions WHERE status IN ('open', 'rejected') AND section = 'products' AND instr(payload_json, 'discount_') > 0) AS queued_discount_payloads,
  (SELECT COUNT(*) FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE r.sale_id IS NOT NULL AND ri.sale_item_id IS NULL) AS sale_return_lines_without_item,
  datetime('now') AS checked_at_utc
