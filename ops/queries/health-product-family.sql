-- health-product-family: the name-group model (a product is a name group of child
-- rows) and its trigger-maintained caches (DATA-MATCH DM-15).
--   name_key_drift          name_key <> lower(trim(name)) (trigger trg_products_*_name_key, 0010)
--   grouped_cache_drift     active rows whose is_grouped_cached disagrees with "more than one
--                           active row shares my name_key"; inactive rows still flagged
--   variant_parent_inactive active variants (parent_id > 0) whose parent is inactive
--   blank_name_active       active rows with an empty name (they fall out of every name group)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH g AS MATERIALIZED (
  SELECT name_key, COUNT(*) AS n FROM products WHERE is_active = 1 AND COALESCE(name_key, '') <> '' GROUP BY name_key
)
SELECT
  (SELECT COUNT(*) FROM products WHERE COALESCE(name_key, '') <> COALESCE(lower(trim(name)), '')) AS name_key_drift,
  (SELECT COUNT(*) FROM products p LEFT JOIN g ON g.name_key = p.name_key
     WHERE (p.is_active = 1 AND COALESCE(p.name_key, '') <> ''
            AND COALESCE(p.is_grouped_cached, 0) <> CASE WHEN COALESCE(g.n, 0) > 1 THEN 1 ELSE 0 END)
        OR (COALESCE(p.is_active, 0) = 0 AND COALESCE(p.is_grouped_cached, 0) = 1)) AS grouped_cache_drift,
  (SELECT COUNT(*) FROM products c JOIN products p ON p.id = c.parent_id
     WHERE c.is_active = 1 AND COALESCE(c.parent_id, 0) > 0 AND COALESCE(p.is_active, 0) = 0) AS variant_parent_inactive,
  (SELECT COUNT(*) FROM products WHERE is_active = 1 AND COALESCE(trim(name), '') = '') AS blank_name_active
