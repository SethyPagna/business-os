-- Pre-deploy census for migration 0269 (6.0.944 cost mirror backfill).
-- READ-ONLY: one row of counts, no ids, names or amounts.
-- 0269 rewrites purchase_price_usd/khr to the cost on every ACTIVE product whose twin is not aligned, where aligned =
--   mirror IS cost OR (cost IS NULL AND COALESCE(mirror, 0) = 0)            (lib/catalogCostRecompute.ts rule)
-- and its PRE aborts above 100 rows. The 21 Oct baseline measured USD only (active_mirror_drift 21).
--   scope_rows                 active products 0269 would rewrite (USD or KHR twin unaligned): must be <= 100
--   scope_usd                  of those, USD twin unaligned
--   scope_khr                  of those, KHR twin unaligned
--   undoable_merge_exposure    undoable single-pair product merges (applier product.merge) whose keeper or merged-away
--                              row is in scope: after 0269 their Undo answers 409 undo_record_changed (owner ruling if > 0)
--   undoable_merges_total      every undoable product.merge (context for the line above)
--   group_merge_exposure       undoable product.merge.bulk actions whose snapshot names an in-scope id under an id-like key
--                              (conservative: an id of another table with the same number also counts)
--   open_review_edits_in_scope open pending product updates on in-scope products (applied after 0269 they may answer
--                              product_money_state_conflict and need re-approval)
-- ops:min-rows 1
-- ops:max-rows 1
WITH scope AS MATERIALIZED (
  SELECT id,
    NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0)) AS usd_off,
    NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0)) AS khr_off
  FROM products
  WHERE is_active = 1
    AND (NOT (cost_price_usd IS purchase_price_usd OR (cost_price_usd IS NULL AND COALESCE(purchase_price_usd, 0) = 0))
      OR NOT (cost_price_khr IS purchase_price_khr OR (cost_price_khr IS NULL AND COALESCE(purchase_price_khr, 0) = 0)))
), merges AS MATERIALIZED (
  SELECT json_extract(s.payload_json, '$.keeperId') AS keeper_id, json_extract(s.payload_json, '$.dupId') AS dup_id
  FROM action_history ah
  JOIN undo_snapshots s ON s.id = json_extract(ah.undo_payload, '$.snapshot_id')
  WHERE ah.status = 'undoable' AND ah.reversible = 1
    AND json_extract(ah.undo_payload, '$.applier') = 'product.merge'
)
SELECT
  (SELECT COUNT(*) FROM scope) AS scope_rows,
  (SELECT COUNT(*) FROM scope WHERE usd_off) AS scope_usd,
  (SELECT COUNT(*) FROM scope WHERE khr_off) AS scope_khr,
  (SELECT COUNT(*) FROM merges m WHERE m.keeper_id IN (SELECT id FROM scope) OR m.dup_id IN (SELECT id FROM scope)) AS undoable_merge_exposure,
  (SELECT COUNT(*) FROM merges) AS undoable_merges_total,
  (SELECT COUNT(DISTINCT ah.id) FROM action_history ah
     JOIN undo_snapshots s ON s.id = json_extract(ah.undo_payload, '$.snapshot_id'), json_tree(s.payload_json) t
     WHERE ah.status = 'undoable' AND ah.reversible = 1
       AND json_extract(ah.undo_payload, '$.applier') = 'product.merge.bulk'
       AND t.key IN ('id', 'keeperId', 'dupId', 'product_id') AND t.atom IN (SELECT id FROM scope)) AS group_merge_exposure,
  (SELECT COUNT(*) FROM pending_actions pa WHERE pa.status = 'open' AND pa.section = 'products' AND pa.action_type = 'update'
     AND pa.entity_type = 'product' AND pa.entity_id IN (SELECT id FROM scope)) AS open_review_edits_in_scope,
  datetime('now') AS checked_at_utc
