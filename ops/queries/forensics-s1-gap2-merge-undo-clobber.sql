-- F-forensics S1 gap 2 follow-up: movement 46198 was a fold row of merge
-- snapshot 32, which was later reversed (forensics-s1-gap-cause). The undo
-- (undoAppliers.ts applyMergeReversal, 6abd34da through HEAD) writes ABSOLUTE
-- quantities: for each branch the duplicate had stock in, the keeper's
-- branch_stock is set back to keeperStockBefore and the duplicate's to
-- dupStockBefore, both captured at merge time. Any stock movement on the
-- keeper or the duplicate at those branches between the merge and the undo
-- was overwritten. Zero 'between' rows means the undo compensated exactly.
-- The undo time is the snapshot's updated_at (the undo stamps it).
-- Read-only. Ids, times and quantities only.
-- One row shape: section, id, product_id, branch_id, quantity, at, detail
--   snapshot  each merge snapshot (or bulk reversal) whose adjustmentMovementIds
--             lists 46198: id, at = created_at, detail = {kind, status, updated_at,
--             keeper, dup, keeper_before, dup_before, adjustment_ids}
--   between   movements on the keeper or duplicate at the duplicate's branches
--             created after the merge and up to the undo, excluding the fold's
--             own rows: id, product, branch, signed-as-stored quantity, at,
--             detail = movement_type
--   now       current branch_stock of keeper and duplicate at those branches
-- ops:min-rows 0
-- ops:max-rows 500
WITH snap AS MATERIALIZED (
  SELECT s.id, s.kind, s.status,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.created_at), s.created_at) AS created_at,
    COALESCE(strftime('%Y-%m-%d %H:%M:%S', s.updated_at), s.updated_at) AS updated_at,
    r.value AS rev,
    CAST(json_extract(r.value, '$.keeperId') AS INTEGER) AS keeper_id,
    CAST(json_extract(r.value, '$.dupId') AS INTEGER) AS dup_id
  FROM undo_snapshots s
  JOIN json_each(CASE WHEN s.kind = 'product.merge.bulk' THEN s.payload_json ELSE json_array(json(s.payload_json)) END,
    CASE WHEN s.kind = 'product.merge.bulk' THEN '$.reversals' ELSE '$' END) r
  WHERE s.kind IN ('product.merge', 'product.merge.bulk', 'product.merge.group.child')
    AND instr(s.payload_json, '46198') > 0 AND json_valid(s.payload_json)
    AND EXISTS (SELECT 1 FROM json_each(r.value, '$.adjustmentMovementIds') a WHERE CAST(a.value AS INTEGER) = 46198)
),
br AS MATERIALIZED (
  SELECT DISTINCT s.id AS snapshot_id, CAST(json_extract(d.value, '$.branch_id') AS INTEGER) AS branch_id
  FROM snap s JOIN json_each(s.rev, '$.dupStockBefore') d
),
prod AS MATERIALIZED (
  SELECT id AS snapshot_id, keeper_id AS product_id FROM snap
  UNION ALL SELECT id, dup_id FROM snap
)
SELECT 'snapshot' AS section, s.id, NULL AS product_id, NULL AS branch_id, NULL AS quantity, s.created_at AS at,
  json_object('kind', s.kind, 'status', s.status, 'updated_at', s.updated_at, 'keeper', s.keeper_id, 'dup', s.dup_id,
    'keeper_before', (SELECT json_group_array(json_array(CAST(json_extract(k.value, '$.branch_id') AS INTEGER), json_extract(k.value, '$.quantity'))) FROM json_each(s.rev, '$.keeperStockBefore') k),
    'dup_before', (SELECT json_group_array(json_array(CAST(json_extract(d.value, '$.branch_id') AS INTEGER), json_extract(d.value, '$.quantity'))) FROM json_each(s.rev, '$.dupStockBefore') d),
    'adjustment_ids', json_extract(s.rev, '$.adjustmentMovementIds')) AS detail
FROM snap s
UNION ALL
SELECT 'between', m.id, m.product_id, m.branch_id, m.quantity,
  COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at), m.movement_type
FROM snap s
JOIN prod p ON p.snapshot_id = s.id
CROSS JOIN inventory_movements m
WHERE m.product_id = p.product_id
  AND m.branch_id IN (SELECT b.branch_id FROM br b WHERE b.snapshot_id = s.id)
  AND m.created_at >= date(s.created_at, '-1 day') AND m.created_at < date(s.updated_at, '+2 days')
  AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) > s.created_at
  AND COALESCE(strftime('%Y-%m-%d %H:%M:%S', m.created_at), m.created_at) <= s.updated_at
  AND NOT EXISTS (SELECT 1 FROM json_each(s.rev, '$.adjustmentMovementIds') a WHERE CAST(a.value AS INTEGER) = m.id)
UNION ALL
SELECT 'now', NULL, bs.product_id, bs.branch_id, bs.quantity, NULL, NULL
FROM branch_stock bs
WHERE bs.product_id IN (SELECT product_id FROM prod) AND EXISTS (SELECT 1 FROM prod p JOIN br b ON b.snapshot_id = p.snapshot_id
  WHERE p.product_id = bs.product_id AND b.branch_id = bs.branch_id)
LIMIT 500
