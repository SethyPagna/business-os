-- 0135: locate an applied product-merge cluster plan by its kept product
-- without scanning every historical undo payload. The CASE expressions make
-- index construction safe even if an old opaque snapshot contains malformed
-- JSON; the second partial index lets the route detect that condition and
-- fail closed instead of silently treating corrupt history as no plan.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) AS snapshots_before FROM undo_snapshots;
--   SELECT COUNT(*) AS history_before FROM action_history;
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) AS snapshots_after FROM undo_snapshots; -- equals snapshots_before
--   SELECT COUNT(*) AS history_after FROM action_history;   -- equals history_before
--   SELECT COUNT(*) FROM sqlite_master WHERE type='index'
--     AND name IN ('idx_undo_product_merge_plan_keeper','idx_undo_product_merge_invalid_json'); -- 2
--
-- RECOVERY: these indexes do not change snapshot or action rows. Older code
-- ignores them. Keep both indexes while the bounded preview/continuation
-- lookup is active; if an index build fails, leave the data untouched and do
-- not enable merge continuation until this migration succeeds.

CREATE INDEX IF NOT EXISTS idx_undo_product_merge_plan_keeper
ON undo_snapshots(
  CASE WHEN json_valid(payload_json)
    THEN CAST(json_extract(payload_json, '$.bulkClusterPlan.keeperId') AS INTEGER)
    ELSE NULL END,
  id DESC
)
WHERE kind = 'product.merge' AND status = 'applied' AND json_valid(payload_json) = 1;

CREATE INDEX IF NOT EXISTS idx_undo_product_merge_invalid_json
ON undo_snapshots(id)
WHERE kind = 'product.merge' AND status = 'applied' AND json_valid(payload_json) = 0;
