-- DATA-AUDIT lane B (stock & cost), query 9 of 16: every Revert is linked to its source and inverts exactly its recorded delta.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner rule (30 Sep / 5 Oct, memory owner-answers): a Revert is an official COMPENSATING record -- its own labelled row linked both ways
-- to the original, never an edit or a delete of it. Writers (lib/stockRevert.ts applyMovementRevert; lib/stockLotAdjustment.ts undo of a scoped
-- Set): the counter movement carries reference_id 'revert:<original movement id>', the SAME product, branch and (when the original had one) lot, the
-- SAME magnitude and the OPPOSITE direction (an inflow is undone by 'remove', an outflow by 'add' -- or by 'adjustment' when the original was the
-- downward half of a scoped Set). Direction comes from the TYPE (stockLedgerQuery.ts LEDGER_OUT_TYPES), never the stored sign. Only the allowlist
-- add / remove / set / adjustment / in / out / csv_import can be reverted (plus the tagged hold, damage_out, that a scoped Set wrote: reference 'stock-set:...');
-- anything tied to a sale, return or transfer is reversed from its own record. Owner's SK-II case: a Set's revert must invert EXACTLY its delta, so
-- a Revert whose magnitude differs from its original leaves the stock wrong by the difference (the scoped Set's own generations: audit-b-set-and-session-undo.sql).
-- Not repeated (run it as it is): forensics-s6-double-reverts.sql (the rows of a doubled Revert and their compensation); this file only counts them.
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column):
--   revert_reference_malformed       reference_id starts 'revert:' but is not exactly 'revert:<integer>'
--   revert_original_missing          the original movement no longer exists (a dated stock count re-run or a merge undo deleted it)
--   revert_id_precedes_original      the Revert row has a lower id than its original
--   revert_wrong_product_or_branch   product or branch differs from the original's
--   revert_quantity_not_inverse      magnitude differs from the original's (the SK-II shape)
--   revert_direction_not_inverse     the Revert moves stock the SAME way as its original (both in or both out)
--   revert_lot_differs               the original named a lot and the Revert names another (or none)
--   revert_of_unrevertible_type      the original is a type the ledger refuses to revert (a sale, return, transfer, session row ...)
--   originals_reverted_more_than_once   originals with more than one Revert (detail: forensics-s6-double-reverts.sql)
--   Info columns:
--   reverts                          movements whose reference_id starts 'revert:';  reverts_of_reverts: of them, whose original is itself a Revert
--   first_ids                        json object: the lowest offending Revert id per column family, ids only
-- Needs only inventory_movements. Measured cost: a range read of the (reference_id, movement_type, id) index over the 'revert:' prefix (a few thousand
-- rows) and one primary-key probe each; see the scale test output (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 0 ms best of 5 on an idle host, 6 rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero revert_reference_malformed,revert_original_missing,revert_id_precedes_original,revert_wrong_product_or_branch,revert_quantity_not_inverse,revert_direction_not_inverse,revert_lot_differs,revert_of_unrevertible_type,originals_reverted_more_than_once
WITH rv AS MATERIALIZED (
  SELECT m.id, m.product_id, m.branch_id, m.batch_id, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS q,
    CASE WHEN CAST(m.reference_id AS TEXT) = 'revert:' || CAST(CAST(substr(CAST(m.reference_id AS TEXT), 8) AS INTEGER) AS TEXT)
      THEN CAST(substr(CAST(m.reference_id AS TEXT), 8) AS INTEGER) END AS orig_id
  FROM inventory_movements m
  WHERE m.reference_id >= 'revert:' AND m.reference_id < 'revert;'
), j AS MATERIALIZED (
  SELECT rv.id, rv.orig_id, rv.product_id, rv.branch_id, rv.batch_id, rv.movement_type, rv.q,
    o.id AS oid, o.product_id AS o_product, o.branch_id AS o_branch, o.batch_id AS o_batch, o.movement_type AS o_type, ABS(COALESCE(o.quantity, 0)) AS o_q,
    CAST(o.reference_id AS TEXT) AS o_ref,
    CASE WHEN rv.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out') THEN 1 ELSE 0 END AS rv_out,
    CASE WHEN o.movement_type IN ('remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'move_out', 'write_off', 'damage_out', 'replacement_out', 'out') THEN 1 ELSE 0 END AS o_out
  FROM rv
  LEFT JOIN inventory_movements o ON o.id = rv.orig_id
), d AS MATERIALIZED (
  SELECT j.*,
    CASE WHEN orig_id IS NULL THEN 1 ELSE 0 END AS malformed,
    CASE WHEN orig_id IS NOT NULL AND oid IS NULL THEN 1 ELSE 0 END AS missing,
    CASE WHEN oid IS NOT NULL AND id < oid THEN 1 ELSE 0 END AS precedes,
    CASE WHEN oid IS NOT NULL AND (product_id IS NOT o_product OR branch_id IS NOT o_branch) THEN 1 ELSE 0 END AS wrong_pb,
    CASE WHEN oid IS NOT NULL AND ABS(q - o_q) > 0.000001 THEN 1 ELSE 0 END AS wrong_q,
    CASE WHEN oid IS NOT NULL AND rv_out = o_out THEN 1 ELSE 0 END AS wrong_dir,
    CASE WHEN oid IS NOT NULL AND o_batch IS NOT NULL AND batch_id IS NOT o_batch THEN 1 ELSE 0 END AS wrong_lot,
    CASE WHEN oid IS NOT NULL AND o_type NOT IN ('add', 'remove', 'set', 'adjustment', 'in', 'out', 'csv_import')
      AND NOT (o_type = 'damage_out' AND o_ref >= 'stock-set:' AND o_ref < 'stock-set;') THEN 1 ELSE 0 END AS bad_type
  FROM j
), dbl AS (
  SELECT COUNT(*) AS n FROM (SELECT orig_id FROM rv WHERE orig_id IS NOT NULL GROUP BY orig_id HAVING COUNT(*) > 1)
)
SELECT
  COALESCE(SUM(malformed), 0) AS revert_reference_malformed,
  COALESCE(SUM(missing), 0) AS revert_original_missing,
  COALESCE(SUM(precedes), 0) AS revert_id_precedes_original,
  COALESCE(SUM(wrong_pb), 0) AS revert_wrong_product_or_branch,
  COALESCE(SUM(wrong_q), 0) AS revert_quantity_not_inverse,
  COALESCE(SUM(wrong_dir), 0) AS revert_direction_not_inverse,
  COALESCE(SUM(wrong_lot), 0) AS revert_lot_differs,
  COALESCE(SUM(bad_type), 0) AS revert_of_unrevertible_type,
  (SELECT n FROM dbl) AS originals_reverted_more_than_once,
  COUNT(*) AS reverts,
  COALESCE(SUM(CASE WHEN o_ref >= 'revert:' AND o_ref < 'revert;' THEN 1 ELSE 0 END), 0) AS reverts_of_reverts,
  json_object('malformed', MIN(CASE WHEN malformed = 1 THEN id END), 'missing', MIN(CASE WHEN missing = 1 THEN id END),
    'precedes', MIN(CASE WHEN precedes = 1 THEN id END), 'product_branch', MIN(CASE WHEN wrong_pb = 1 THEN id END),
    'quantity', MIN(CASE WHEN wrong_q = 1 THEN id END), 'direction', MIN(CASE WHEN wrong_dir = 1 THEN id END),
    'lot', MIN(CASE WHEN wrong_lot = 1 THEN id END), 'type', MIN(CASE WHEN bad_type = 1 THEN id END)) AS first_ids
FROM d
