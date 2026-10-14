-- Read-only counts that size the multi-lot Revert split (R2 review F1, MULTILOT-REVERT).
--
-- A removal that no single lot covered (a Remove spread across lots, a CSV Remove or
-- Set) used to write a movement with no lot and no record of what it took from each
-- lot. Reverting it put the units back on branch_stock and the product total only: the
-- lots stayed drained and branch_stock rose above the lot sum. The till sells those
-- extra units as "Received date not recorded", so nothing is invisible: what is lost is
-- the lot identity (FIFO order, expiry, cost, supplier) of the restored units.
--
-- Part 1: (product, branch) pairs where branch_stock is ABOVE the lot sum. A pair "has
-- lots" exactly as the till decides it (lib/productBatches.ts getTrackedProductIds): it
-- holds a lot row at that branch that is active or holds stock. For such a pair the
-- excess units sell only as "Received date not recorded". A pair without such a lot is
-- plain stock with no live lot: the till sells it from branch_stock, so it is NOT a
-- split. Pairs with branch_stock of 0 are not counted.
--   pairs_with_branch_stock                 every (product, branch) pair holding stock
--   pairs_with_lots                         of those, pairs that have lots (till reads lots)
--   pairs_with_lots_branch_exceeds_lots     of those, branch_stock > lot sum by more than
--                                           0.000001: the split this fix prevents
--   products_with_lots_branch_exceeds_lots  distinct products among them
--   pairs_with_lots_float_residue           of those, pairs over by 0.000001 or less (noise)
--   pairs_without_live_lot                  pairs holding stock with no lot row at that branch
--                                           that is active or holds stock (no lot row at all,
--                                           or only inactive empty ones)
--
-- Part 2: batch-less removals ('remove' and the CSV import's 'out' with no batch_id, not
-- themselves a Revert counter) and what became of them. Removals written since the fix
-- carry a record in dated_stock_count_batch_actions: lot shares, or one zero row when
-- nothing came off a lot (written only when the product already had a lot row).
--   removals_batchless                      all of them
--   removals_batchless_with_shares          of those, rows with a record (lot shares or the zero row)
--   removals_batchless_reverted             of those, rows that have a Revert counter
--   removals_batchless_reverted_lot_product reverted, and the product has lot rows (the
--                                           removal may have drawn on several lots)
--   removals_batchless_reverted_on_split_pairs  of those, rows whose (product, branch)
--                                           pair is in the split set above today
--   removals_open_revert_refused            not reverted, no record, not a dated-count row, a
--                                           lot of the product was created at or before the removal
--                                           (a tie counts: times are whole seconds) and the movement
--                                           id is at or below the mark migration 0250 stored in
--                                           system_flags (every id counts while no mark row exists):
--                                           exactly the rows a Revert answers with
--                                           revert_lots_not_recorded (Set on the received date
--                                           is the way back; it records no purchase)
--   removals_open_after_mark_lot_before     not reverted, no record, not a dated-count row, a lot
--                                           created at or before it, but the id is ABOVE the mark, so
--                                           a Revert is allowed. Normally a removal on a product that
--                                           had no lot when it was written (a merge gave it older
--                                           lots later); also any removal the previous code wrote
--                                           between the migration and the deploy, the only ones that
--                                           could have drawn on several lots. 0 while no mark exists
--
-- Part 3: kept-as-tagged (damaged) holds. A Remove that kept its units as a tagged row now writes one
-- held row per source lot, so Restore puts every unit back on its lot. A held row written BEFORE
-- that has no lot (batch_id NULL): its Restore adds the units to branch_stock only.
--   held_rows_open_remove_no_lot_upper_bound  open (quantity_remaining > 0) held rows made by a
--                                           Remove (source 'remove') with no lot, on a product that
--                                           has lot rows. An upper bound: it also counts the
--                                           undated part of a hold written after the fix, which
--                                           Restores exactly
--
-- One row of counts; no names, phones or amounts per row, and the counts reach only the
-- encrypted artifact.
-- ops:min-rows 1
-- ops:max-rows 1
WITH lots AS (
  SELECT pb.variant_product_id AS product_id, bbs.branch_id AS branch_id, SUM(bbs.quantity) AS lot_quantity,
    MAX(CASE WHEN pb.is_active = 1 OR bbs.quantity > 0 THEN 1 ELSE 0 END) AS has_lots
  FROM branch_batch_stock bbs
  JOIN product_batches pb ON pb.id = bbs.batch_id
  GROUP BY pb.variant_product_id, bbs.branch_id
),
pairs AS (
  SELECT bs.product_id, bs.branch_id, bs.quantity AS branch_quantity,
    COALESCE(l.lot_quantity, 0) AS lot_quantity, COALESCE(l.has_lots, 0) AS has_lots
  FROM branch_stock bs
  LEFT JOIN lots l ON l.product_id = bs.product_id AND l.branch_id = bs.branch_id
  WHERE bs.quantity > 0
),
split_pairs AS (
  SELECT product_id, branch_id FROM pairs WHERE has_lots = 1 AND branch_quantity - lot_quantity > 0.000001
),
mark AS (
  SELECT CAST(value AS INTEGER) AS id FROM system_flags
  WHERE key = 'multilot_revert_watermark' AND value <> '' AND value NOT GLOB '*[^0-9]*'
),
reverted AS (
  SELECT DISTINCT CAST(SUBSTR(CAST(reference_id AS TEXT), 8) AS INTEGER) AS original_id
  FROM inventory_movements
  WHERE CAST(reference_id AS TEXT) LIKE 'revert:%'
),
removals AS (
  SELECT m.id, m.product_id, m.branch_id,
    m.id IN (SELECT original_id FROM reverted) AS is_reverted,
    m.id IN (SELECT movement_id FROM dated_stock_count_batch_actions) AS has_shares,
    COALESCE(m.reason, '') = 'Dated stock count import' AS is_dated_count,
    EXISTS (SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = m.product_id) AS product_has_lots,
    EXISTS (SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = m.product_id AND datetime(pb.created_at) <= datetime(m.created_at)) AS lot_before,
    (NOT EXISTS (SELECT 1 FROM mark) OR m.id <= (SELECT id FROM mark)) AS before_mark,
    EXISTS (SELECT 1 FROM split_pairs sp WHERE sp.product_id = m.product_id AND sp.branch_id = m.branch_id) AS on_split_pair
  FROM inventory_movements m
  WHERE m.movement_type IN ('remove', 'out') AND m.batch_id IS NULL
    AND COALESCE(CAST(m.reference_id AS TEXT), '') NOT LIKE 'revert:%'
)
SELECT
  (SELECT COUNT(*) FROM pairs) AS pairs_with_branch_stock,
  (SELECT COUNT(*) FROM pairs WHERE has_lots = 1) AS pairs_with_lots,
  (SELECT COUNT(*) FROM split_pairs) AS pairs_with_lots_branch_exceeds_lots,
  (SELECT COUNT(DISTINCT product_id) FROM split_pairs) AS products_with_lots_branch_exceeds_lots,
  (SELECT COUNT(*) FROM pairs WHERE has_lots = 1 AND branch_quantity - lot_quantity > 0 AND branch_quantity - lot_quantity <= 0.000001) AS pairs_with_lots_float_residue,
  (SELECT COUNT(*) FROM pairs WHERE has_lots = 0) AS pairs_without_live_lot,
  (SELECT COUNT(*) FROM removals) AS removals_batchless,
  (SELECT COUNT(*) FROM removals WHERE has_shares = 1) AS removals_batchless_with_shares,
  (SELECT COUNT(*) FROM removals WHERE is_reverted = 1) AS removals_batchless_reverted,
  (SELECT COUNT(*) FROM removals WHERE is_reverted = 1 AND product_has_lots = 1) AS removals_batchless_reverted_lot_product,
  (SELECT COUNT(*) FROM removals WHERE is_reverted = 1 AND product_has_lots = 1 AND on_split_pair = 1) AS removals_batchless_reverted_on_split_pairs,
  (SELECT COUNT(*) FROM removals WHERE is_reverted = 0 AND has_shares = 0 AND is_dated_count = 0 AND lot_before = 1 AND before_mark = 1) AS removals_open_revert_refused,
  (SELECT COUNT(*) FROM removals WHERE is_reverted = 0 AND has_shares = 0 AND is_dated_count = 0 AND lot_before = 1 AND before_mark = 0) AS removals_open_after_mark_lot_before,
  (SELECT COUNT(*) FROM damaged_stock_lots d WHERE d.source = 'remove' AND d.batch_id IS NULL AND d.quantity_remaining > 0
    AND EXISTS (SELECT 1 FROM product_batches pb WHERE pb.variant_product_id = d.product_id)) AS held_rows_open_remove_no_lot_upper_bound
