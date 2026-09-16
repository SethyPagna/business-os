-- 0170: backfill product.merge undo_snapshots evidence for sale_items
-- reparented by migrations 0165 (product_same_name_merge) and 0168
-- (transfer_aware_merge).
--
-- PREPARED, NOT APPLIED (report to the owner before running against
-- --remote; this only writes undo_snapshots rows, never touches sale/
-- product data itself).
--
-- WHY THIS EXISTS (Sentry BUSINESS-OS-1F): both 0165 and 0168 reparent
-- sale_items.product_id straight from the loser to the keeper with a plain
-- UPDATE (see their own "UPDATE sale_items SET product_id = ..." statements)
-- and never write a matching undo_snapshots row. Every other product-merge
-- writer (routes/products.ts foldDuplicateProductInto, used by the manual
-- pair merge, bulk /merge-duplicates, and the leading-zero/group-child
-- flows) writes a kind='product.merge'[.bulk|.group.child] undo_snapshots
-- row carrying reparentedSaleItemIds in the SAME atomic write as the
-- reparent -- lib/productMergeLineage.ts's resolveProductMergeLineage
-- requires that row to prove a sale_item's recorded (captured) product
-- identity still chains to its live product_id. For sale_items reparented
-- by 0165/0168, that evidence has never existed, so any later read of a
-- sale containing one of those items (GET /api/sales, /:id/records, an
-- amendment, a return, an undo) throws product_merge_lineage_conflict.
-- routes/sales.ts's GET / now degrades gracefully (flags the line instead
-- of failing the page) so this migration is a repair, not a hotfix
-- dependency -- but it is what makes the *write* paths (amendments,
-- returns, undo) for those exact rows usable again instead of a permanent
-- 409, and what proves normal lineage instead of merely tolerating a gap.
--
-- ============================== RULE ======================================
-- For every (loser_id, keeper_id) pair in product_merge_map_0165 UNION
-- product_merge_map_0168: for every LIVE sale_item currently on the keeper
-- whose pricing_snapshot_json records its OWN captured product id as the
-- loser (i.e. exactly the divergence resolveProductMergeLineage looks for),
-- and which no existing applied product.merge* undo_snapshots row already
-- covers, insert one new undo_snapshots row of kind='product.merge',
-- status='applied', payload {dupId:loser_id, keeperId:keeper_id,
-- reparentedSaleItemIds:[...], source:'repair-0170'}.
--
-- ============================== IDEMPOTENCE ===============================
-- The temp table is rebuilt from a NOT EXISTS check against undo_snapshots
-- itself, so a second run finds every row already covered by the first
-- run's repair-0170 evidence and inserts nothing further.
--
-- ============================== PRE-ASSERTION (run before applying) ======
--   SELECT COUNT(*) FROM sale_items si
--   JOIN (SELECT loser_id, keeper_id FROM product_merge_map_0165
--         UNION SELECT loser_id, keeper_id FROM product_merge_map_0168) pair
--     ON pair.keeper_id = si.product_id
--   WHERE json_valid(si.pricing_snapshot_json) = 1
--     AND EXISTS (
--       SELECT 1 FROM json_each(json_extract(si.pricing_snapshot_json, '$.pool.lines')) entry
--       WHERE json_extract(entry.value, '$.line_key') = json_extract(si.pricing_snapshot_json, '$.line_key')
--         AND json_extract(entry.value, '$.product.id') = pair.loser_id
--     );
--   -- expected 4 against current production (sale_items 40587, 40590,
--   -- 40591, 40611); a different count is fine (it only means other
--   -- reparented rows share the gap) but should be reviewed before
--   -- applying if it is unexpectedly large.
--
-- ============================== POST-ASSERTION ============================
--   SELECT COUNT(*) FROM sale_items si
--   JOIN (SELECT loser_id, keeper_id FROM product_merge_map_0165
--         UNION SELECT loser_id, keeper_id FROM product_merge_map_0168) pair
--     ON pair.keeper_id = si.product_id
--   WHERE json_valid(si.pricing_snapshot_json) = 1
--     AND EXISTS (
--       SELECT 1 FROM json_each(json_extract(si.pricing_snapshot_json, '$.pool.lines')) entry
--       WHERE json_extract(entry.value, '$.line_key') = json_extract(si.pricing_snapshot_json, '$.line_key')
--         AND json_extract(entry.value, '$.product.id') = pair.loser_id
--     )
--     AND NOT EXISTS (
--       SELECT 1 FROM undo_snapshots u
--       WHERE u.kind = 'product.merge' AND u.status = 'applied'
--         AND json_valid(u.payload_json) = 1
--         AND json_extract(u.payload_json, '$.source') = 'repair-0170'
--         AND EXISTS (SELECT 1 FROM json_each(u.payload_json, '$.reparentedSaleItemIds') i WHERE i.value = si.id)
--     );
--   -- expect 0
--
-- ============================== RECOVERY ==================================
-- This migration only INSERTs new undo_snapshots rows; nothing existing is
-- modified or deleted. To undo, delete the rows it added:
--   DELETE FROM undo_snapshots WHERE kind='product.merge' AND status='applied'
--     AND json_valid(payload_json)=1 AND json_extract(payload_json,'$.source')='repair-0170';

CREATE TABLE IF NOT EXISTS product_merge_lineage_repair_0170 (
  sale_item_id INTEGER PRIMARY KEY,
  loser_id INTEGER NOT NULL,
  keeper_id INTEGER NOT NULL
);

INSERT OR IGNORE INTO product_merge_lineage_repair_0170 (sale_item_id, loser_id, keeper_id)
SELECT si.id, pair.loser_id, pair.keeper_id
FROM sale_items si
JOIN (
  SELECT loser_id, keeper_id FROM product_merge_map_0165
  UNION
  SELECT loser_id, keeper_id FROM product_merge_map_0168
) pair ON pair.keeper_id = si.product_id
WHERE json_valid(si.pricing_snapshot_json) = 1
  AND EXISTS (
    SELECT 1 FROM json_each(json_extract(si.pricing_snapshot_json, '$.pool.lines')) entry
    WHERE json_extract(entry.value, '$.line_key') = json_extract(si.pricing_snapshot_json, '$.line_key')
      AND json_extract(entry.value, '$.product.id') = pair.loser_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM undo_snapshots u
    WHERE u.kind IN ('product.merge','product.merge.bulk','product.merge.group.child')
      AND u.status = 'applied'
      AND json_valid(u.payload_json) = 1
      AND (
        (u.kind IN ('product.merge','product.merge.group.child')
          AND EXISTS (SELECT 1 FROM json_each(u.payload_json, '$.reparentedSaleItemIds') i WHERE i.value = si.id))
        OR
        (u.kind = 'product.merge.bulk'
          AND EXISTS (
            SELECT 1 FROM json_each(u.payload_json, '$.reversals') r,
                          json_each(r.value, '$.reparentedSaleItemIds') i
            WHERE i.value = si.id
          ))
      )
  );

INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name, created_at)
SELECT
  'product.merge', 'applied',
  json_object(
    'dupId', loser_id, 'keeperId', keeper_id,
    'reparentedSaleItemIds', json_group_array(sale_item_id),
    'source', 'repair-0170'
  ),
  NULL, 'repair-0170', CURRENT_TIMESTAMP
FROM product_merge_lineage_repair_0170
GROUP BY loser_id, keeper_id;

DROP TABLE IF EXISTS product_merge_lineage_repair_0170;
