-- SCAN2 U12: stock a products-import apply ADDED to products that existed before
-- the job. A catalog export re-imported with a cost that differs from the stored
-- one (the export ceiling-rounds sub-cent costs) is classed merge_stock and adds
-- the exported quantity on top of the stock already there.
-- The only writer is lib/importEngine.ts (merge_stock / override_add): one 'add'
-- movement per row, reason 'Product import <job id>, row <n>', created_at = the
-- row's received date (not the apply time). The legacy snapshot path replaces
-- the branch quantity and writes no movement, so it never shows here.
-- Staging rows live on the import DB and are pruned; import_jobs rows are kept
-- about 7 days, so the job is read by the id in the reason and may be gone.
-- Columns:
--   job_id, job_status, job_created_at   job_status NULL = the job row was pruned
--   job_adds, job_units                  add rows and units of that job in this list
--   movement_id, row_number, product_id, branch_id, batch_id, quantity, received_at
--   product_created_at
--   lot_origin   merge | override (the lot this row created) | existing_lot (it
--                topped up an older lot, whose note is not the import's)
--   reverted     1 when a 'revert:<movement_id>' movement exists (lib/stockRevert.ts
--                already took the units back)
-- Rows onto a product created by the same job (after job_created_at) are left out.
-- Repair (proposed, not run): per product and branch, count the shelf; only a
-- surplus over the count comes off, through one branch-scope Set
-- (POST /inventory/adjust, type 'set', setScope 'branch'), never by SQL. A row
-- with reverted = 1 needs nothing.
-- Ids, dates and quantities only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 5000
WITH adds AS MATERIALIZED (
  SELECT m.id AS movement_id, m.product_id, m.branch_id, m.batch_id, m.quantity, m.created_at AS received_at,
    substr(m.reason, 16, instr(m.reason, ', row ') - 16) AS job_id,
    CAST(substr(m.reason, instr(m.reason, ', row ') + 6) AS INTEGER) AS row_number
  FROM inventory_movements m
  WHERE m.movement_type = 'add' AND m.reason LIKE 'Product import %, row %'
),
listed AS MATERIALIZED (
  SELECT a.*, j.status AS job_status, j.created_at AS job_created_at, p.created_at AS product_created_at
  FROM adds a
  LEFT JOIN import_jobs j ON j.id = a.job_id
  LEFT JOIN products p ON p.id = a.product_id
  WHERE j.id IS NULL OR p.id IS NULL OR datetime(p.created_at) < datetime(j.created_at)
),
per_job AS MATERIALIZED (
  SELECT job_id, COUNT(*) AS job_adds, SUM(ABS(COALESCE(quantity, 0))) AS job_units FROM listed GROUP BY job_id
)
SELECT
  l.job_id, l.job_status, l.job_created_at, pj.job_adds, pj.job_units,
  l.movement_id, l.row_number, l.product_id, l.branch_id, l.batch_id, l.quantity, l.received_at,
  l.product_created_at,
  CASE (SELECT pb.notes FROM product_batches pb WHERE pb.id = l.batch_id)
    WHEN 'Stock merged via product import' THEN 'merge'
    WHEN 'Stock added via product import (override)' THEN 'override'
    ELSE 'existing_lot' END AS lot_origin,
  CASE WHEN EXISTS (SELECT 1 FROM inventory_movements rv WHERE rv.reference_id = 'revert:' || l.movement_id)
    THEN 1 ELSE 0 END AS reverted
FROM listed l
JOIN per_job pj ON pj.job_id = l.job_id
ORDER BY l.job_id, l.row_number, l.movement_id
LIMIT 5000
