-- F-forensics S1: every dated stock-count import run (Inventory -> dated
-- stock count -> Apply), from the audit row routes/inventory.ts writes after
-- applyDatedStockCountPlan. A run with movements_deleted > 0 re-applied dates a
-- previous run had already applied: lib/datedStockCountApply.ts deletes the
-- earlier movements WITHOUT reversing their stock, then adds the new deltas,
-- so every such run doubled the earlier run's effect on the pairs it touched.
-- Read-only. Ids, times and counts only.
--   audit_id, run_at (UTC), user_id
--   entry_count, movements_applied, movements_deleted, batch_tracked_groups, plain_groups
--   is_rerun          1 when movements_deleted > 0 (the S1 signature)
-- ops:min-rows 0
-- ops:max-rows 2000
SELECT
  id AS audit_id,
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at) AS run_at,
  user_id,
  CAST(json_extract(details, '$.entryCount') AS INTEGER) AS entry_count,
  CAST(json_extract(details, '$.movementsApplied') AS INTEGER) AS movements_applied,
  CAST(json_extract(details, '$.movementsDeleted') AS INTEGER) AS movements_deleted,
  CAST(json_extract(details, '$.batchTrackedGroups') AS INTEGER) AS batch_tracked_groups,
  CAST(json_extract(details, '$.plainGroups') AS INTEGER) AS plain_groups,
  CASE WHEN COALESCE(CAST(json_extract(details, '$.movementsDeleted') AS INTEGER), 0) > 0 THEN 1 ELSE 0 END AS is_rerun
FROM audit_logs
WHERE action = 'dated_stock_count_import' AND json_valid(details)
ORDER BY id
LIMIT 2000
