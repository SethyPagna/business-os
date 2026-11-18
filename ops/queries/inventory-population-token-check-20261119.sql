-- inventory-population-token-check-20261119: read-only check of migration 0317 after it is applied. One row per problem, so a healthy database returns none.
--   row count                 the token table must hold exactly one row
--   bad row                   that row must be id 1 with a 16-character lowercase hex stamp
--   trigger or index missing  the three products triggers and the partial index 0317 creates must all exist
-- Run only once 0317 is applied in this database; before that the table does not exist and the query errors.
-- ops:min-rows 0
-- ops:max-rows 0
-- ops:max-rows-read 5000
SELECT 'row count' AS problem FROM (SELECT COUNT(*) AS n FROM inventory_population_token) WHERE n <> 1
UNION ALL SELECT 'bad row' FROM inventory_population_token WHERE id IS NOT 1 OR typeof(stamp) <> 'text' OR length(stamp) <> 16 OR stamp GLOB '*[^0-9a-f]*'
UNION ALL SELECT 'trigger or index missing' FROM (SELECT COUNT(*) AS n FROM sqlite_master WHERE (type = 'trigger' AND name IN ('inventory_population_token_products_insert', 'inventory_population_token_products_delete', 'inventory_population_token_products_update')) OR (type = 'index' AND name = 'idx_products_inventory_population')) WHERE n <> 4;
