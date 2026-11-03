-- forensics-receipt-cost-drift-rows: one row per lot counted by health-supplier-lots.receipt_cost_drift (same selection),
-- with the fold each candidate writer explains. Ids, days, amounts and code tokens only. 56214 = max movement id at the
-- 21 Oct baseline (health-movement-balance 39647787308).
-- ops:min-rows 0
-- ops:max-rows 200
-- ops:max-rows-read 400000
WITH rc AS MATERIALIZED (SELECT batch_id, SUM(COALESCE(total_cost_usd, 0)) AS cost FROM inventory_movements
  WHERE batch_id IS NOT NULL AND movement_type IN ('add', 'stock_in') GROUP BY batch_id),
d AS MATERIALIZED (SELECT pb.*, rc.cost FROM product_batches pb JOIN rc ON rc.batch_id = pb.id
  WHERE pb.received_cost_usd IS NOT NULL AND ABS(pb.received_cost_usd - rc.cost) > 0.01
    AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.batch_id = pb.id AND r.reference_id LIKE 'revert:%')),
m AS (SELECT d.id AS lot, x.id, x.created_at, x.movement_type AS t, COALESCE(x.total_cost_usd, 0) AS usd,
    CASE WHEN x.reference_id >= 'stock-in-edit:' AND x.reference_id < 'stock-in-edit;' THEN 'edit'
      WHEN x.movement_type = 'remove' AND x.quantity < 0 AND CAST(x.reference_id AS TEXT) GLOB '[0-9]*' THEN 'undo'
      WHEN EXISTS (SELECT 1 FROM dated_stock_count_batch_actions a WHERE a.movement_id = x.id) THEN 'count' END AS k,
    EXISTS (SELECT 1 FROM inventory_movements r WHERE r.reference_id = 'revert:' || x.id) AS rv
  FROM d JOIN inventory_movements x ON x.batch_id = d.id),
g AS (SELECT lot, MAX(id) AS last_id, substr(MAX(created_at), 1, 10) AS last_day,
    SUM(k IS 'edit') AS edit_n, SUM(CASE WHEN k IS 'edit' AND t NOT IN ('add', 'stock_in') THEN usd ELSE 0 END) AS edit_usd,
    SUM(k IS 'undo') AS undo_n, SUM(CASE WHEN k IS 'undo' THEN usd ELSE 0 END) AS undo_usd,
    SUM(k IS 'count' AND t IN ('add', 'stock_in')) AS count_n, SUM(CASE WHEN k IS 'count' AND t IN ('add', 'stock_in') THEN usd ELSE 0 END) AS count_usd,
    SUM(rv AND t IN ('add', 'stock_in')) AS revert_away_n, SUM(CASE WHEN rv AND t IN ('add', 'stock_in') THEN usd ELSE 0 END) AS revert_away_usd
  FROM m GROUP BY lot)
SELECT d.id AS batch_id, d.variant_product_id AS product_id, d.received_branch_id, substr(d.received_at, 1, 10) AS received_day,
  substr(d.created_at, 1, 10) AS created_day, g.last_day, g.last_id > 56214 AS touched_since_baseline, d.is_active,
  d.received_quantity, ROUND(d.received_cost_usd, 4) AS lot_usd, ROUND(d.cost, 4) AS receipts_usd,
  ROUND(d.received_cost_usd - d.cost, 4) AS delta_usd, g.edit_n, g.undo_n, g.count_n, g.revert_away_n,
  ROUND(d.received_cost_usd - (d.cost + g.edit_usd + g.undo_usd - g.count_usd - g.revert_away_usd), 4) AS residual_usd
FROM d JOIN g ON g.lot = d.id ORDER BY d.id LIMIT 201
