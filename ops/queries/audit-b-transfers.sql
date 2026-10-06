-- DATA-AUDIT lane B (stock & cost), query 5 of 16: branch transfers -- paired legs, receipts, members and history.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- One transfer is written in ONE batch (lib/transferOperation.ts transferEffectStatements): a stock_transfers row per member
-- (generation 0; each Undo / Redo adds a row of the next generation with the legs swapped), one transfer_out movement per lot
-- allocation (plus one for the untracked remainder) at the source branch and one transfer_in per allocation at the destination, all
-- within the same second and NO reference_id. The legs are therefore found by product, branch and instant, never by a reference.
-- Owner model (3 Sep): moving stock is just adding the quantity from one branch to another on the matching child row; the
-- destination can be ANOTHER product row (a name/barcode match), so conservation is checked per instant, not per product.
-- Legs are grouped into events: consecutive transfer legs (by id) at most 2 seconds apart (the two INSERTs of a batch can straddle a
-- second boundary). stock_transfers rows and out legs are clustered per (product, source branch) with gaps of at most 3 seconds and each
-- cluster's row quantity is compared with its leg quantity, so two transfers of one product in one moment still match each other.
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column):
--   transfer_events_unbalanced       events whose transfer_out units differ from their transfer_in units
--   transfer_rows_without_out_leg    stock_transfers rows with no transfer_out movement of that product at that branch at that time
--   transfer_rows_quantity_mismatch  rows whose out legs add up to another quantity than the row
--   out_legs_without_transfer_row    transfer_out movements no stock_transfers row accounts for
--   receipts_without_members         committed transfer_operation_receipts with no member row
--   members_without_receipt          transfer_operation_members whose receipt is gone
--   member_split_mismatch            members whose quantity is not the sum of their lot allocations plus the untracked part
--   transfer_rows_receipt_missing    stock_transfers.receipt_id that names no receipt, or a (receipt, ordinal) with no member
--   receipt_state_generation_mismatch  replay_state 'applied' with an odd generation or 'reversed' with an even one
--   receipt_generation_rows_mismatch members whose stock_transfers rows are not generation + 1 in number
--   history_row_missing              a provenance_version 1 receipt with no action_history row (its Undo does nothing)
--   history_state_mismatch           the history status contradicts the receipt (applied <-> undoable, reversed <-> redoable)
--   history_payload_mismatch         an undo / redo payload that is not applier stock.transfer for this operation and generation
--   Info columns:
--   transfer_rows                    stock_transfers rows;  transfer_rows_legacy: of those, the ones with no receipt (pre-0148)
--   transfer_legs                    transfer_out + transfer_in movements;  transfer_events: the groups they form
--   transfer_unbalanced_units        |out - in| summed over the unbalanced events
--   receipts_reversed                receipts currently undone
--   first_ids                        json object: the lowest offending id per column family (an event reports its first leg id)
-- Needs migration: 0148 (transfer_operation_receipts / members) and 0151; production has applied them (a missing table makes the statement fail loudly, never report 0).
-- Measured cost: one pass over inventory_movements keeping only the two transfer types (a few hundred rows survive), then
-- small nested loops over those rows, stock_transfers, transfer_operation_receipts / members and action_history; see the
-- scale test output (test-audit-b-scale-workerd.cjs).
-- Measured at production scale (workerd D1, 15 ms best of 5 on an idle host, 63k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero transfer_events_unbalanced,transfer_rows_without_out_leg,transfer_rows_quantity_mismatch,out_legs_without_transfer_row,receipts_without_members,members_without_receipt,member_split_mismatch,transfer_rows_receipt_missing,receipt_state_generation_mismatch,receipt_generation_rows_mismatch,history_row_missing,history_state_mismatch,history_payload_mismatch
WITH leg AS MATERIALIZED (
  SELECT id, movement_type, product_id, branch_id, ABS(COALESCE(quantity, 0)) AS q,
    CAST(strftime('%s', created_at) AS INTEGER) AS ts
  FROM inventory_movements
  WHERE movement_type IN ('transfer_out', 'transfer_in')
), lagged AS MATERIALIZED (
  SELECT leg.*, LAG(ts) OVER (ORDER BY id) AS prev_ts FROM leg
), ev AS MATERIALIZED (
  SELECT lagged.*, SUM(CASE WHEN prev_ts IS NULL OR ts IS NULL OR ts - prev_ts > 2 THEN 1 ELSE 0 END) OVER (ORDER BY id) AS grp FROM lagged
), evsum AS MATERIALIZED (
  SELECT grp, MIN(id) AS first_id,
    SUM(CASE WHEN movement_type = 'transfer_out' THEN q ELSE 0 END) AS o,
    SUM(CASE WHEN movement_type = 'transfer_in' THEN q ELSE 0 END) AS i
  FROM ev GROUP BY grp
), sl AS MATERIALIZED (
  -- stock_transfers rows and out legs side by side, to be clustered per (product, source branch)
  SELECT 1 AS is_st, product_id, from_branch_id AS branch_id, COALESCE(quantity, 0) AS q, CAST(strftime('%s', created_at) AS INTEGER) AS ts, id
  FROM stock_transfers WHERE from_branch_id IS NOT NULL
  UNION ALL
  SELECT 0, product_id, branch_id, q, ts, id FROM leg WHERE movement_type = 'transfer_out'
), sl2 AS MATERIALIZED (
  SELECT sl.*, LAG(ts) OVER (PARTITION BY product_id, branch_id ORDER BY ts, is_st, id) AS prev_ts FROM sl
), sl3 AS MATERIALIZED (
  SELECT sl2.*, SUM(CASE WHEN prev_ts IS NULL OR ts IS NULL OR ts - prev_ts > 3 THEN 1 ELSE 0 END)
    OVER (PARTITION BY product_id, branch_id ORDER BY ts, is_st, id) AS cl FROM sl2
), cl AS MATERIALIZED (
  SELECT SUM(is_st) AS st_n, SUM(1 - is_st) AS leg_n,
    SUM(CASE WHEN is_st = 1 THEN q ELSE 0 END) AS st_q, SUM(CASE WHEN is_st = 0 THEN q ELSE 0 END) AS leg_q,
    MIN(CASE WHEN is_st = 1 THEN id END) AS st_first, MIN(CASE WHEN is_st = 0 THEN id END) AS leg_first
  FROM sl3 GROUP BY product_id, branch_id, cl
), mem AS MATERIALIZED (
  SELECT m.receipt_id, m.ordinal, m.quantity, m.untracked_quantity,
    (SELECT COALESCE(SUM(json_extract(a.value, '$.quantity')), 0) FROM json_each(m.allocations_json) a) AS alloc_q,
    (SELECT COUNT(*) FROM stock_transfers t WHERE t.receipt_id = m.receipt_id AND t.member_ordinal = m.ordinal) AS gen_rows,
    r.id AS rid, r.generation AS gen
  FROM transfer_operation_members m
  LEFT JOIN transfer_operation_receipts r ON r.id = m.receipt_id
), rc AS MATERIALIZED (
  SELECT r.id, r.operation_id, r.generation, r.replay_state, r.provenance_version, r.action_history_id, r.status,
    (SELECT COUNT(*) FROM transfer_operation_members m WHERE m.receipt_id = r.id) AS members,
    h.id AS hid, h.status AS hstatus,
    CASE WHEN json_valid(h.undo_payload) = 1 AND json_valid(h.redo_payload) = 1 THEN
      CASE WHEN json_extract(h.undo_payload, '$.applier') = 'stock.transfer' AND json_extract(h.redo_payload, '$.applier') = 'stock.transfer'
        AND json_extract(h.undo_payload, '$.operation_id') = r.operation_id AND json_extract(h.redo_payload, '$.operation_id') = r.operation_id
        AND json_extract(h.undo_payload, '$.generation') = r.generation AND json_extract(h.redo_payload, '$.generation') = r.generation THEN 1 ELSE 0 END
      ELSE 0 END AS payload_ok
  FROM transfer_operation_receipts r
  LEFT JOIN action_history h ON h.id = r.action_history_id
)
SELECT
  (SELECT COUNT(*) FROM evsum WHERE ABS(o - i) > 0.000001) AS transfer_events_unbalanced,
  (SELECT COALESCE(SUM(st_n), 0) FROM cl WHERE leg_n = 0) AS transfer_rows_without_out_leg,
  (SELECT COALESCE(SUM(st_n), 0) FROM cl WHERE st_n > 0 AND leg_n > 0 AND ABS(st_q - leg_q) > 0.000001) AS transfer_rows_quantity_mismatch,
  (SELECT COALESCE(SUM(leg_n), 0) FROM cl WHERE st_n = 0) AS out_legs_without_transfer_row,
  (SELECT COUNT(*) FROM rc WHERE status = 'committed' AND members = 0) AS receipts_without_members,
  (SELECT COUNT(*) FROM mem WHERE rid IS NULL) AS members_without_receipt,
  (SELECT COUNT(*) FROM mem WHERE ABS(alloc_q + untracked_quantity - quantity) > 0.000001) AS member_split_mismatch,
  (SELECT COUNT(*) FROM stock_transfers t WHERE t.receipt_id IS NOT NULL
    AND (NOT EXISTS (SELECT 1 FROM transfer_operation_receipts r WHERE r.id = t.receipt_id)
      OR NOT EXISTS (SELECT 1 FROM transfer_operation_members m WHERE m.receipt_id = t.receipt_id AND m.ordinal = t.member_ordinal))) AS transfer_rows_receipt_missing,
  (SELECT COUNT(*) FROM rc WHERE (replay_state = 'applied' AND generation % 2 = 1) OR (replay_state = 'reversed' AND generation % 2 = 0)) AS receipt_state_generation_mismatch,
  (SELECT COUNT(*) FROM mem WHERE rid IS NOT NULL AND gen_rows <> gen + 1) AS receipt_generation_rows_mismatch,
  (SELECT COUNT(*) FROM rc WHERE provenance_version = 1 AND status = 'committed' AND hid IS NULL) AS history_row_missing,
  (SELECT COUNT(*) FROM rc WHERE hid IS NOT NULL AND ((replay_state = 'applied' AND hstatus <> 'undoable') OR (replay_state = 'reversed' AND hstatus <> 'redoable'))) AS history_state_mismatch,
  (SELECT COUNT(*) FROM rc WHERE hid IS NOT NULL AND payload_ok = 0) AS history_payload_mismatch,
  (SELECT COUNT(*) FROM stock_transfers) AS transfer_rows,
  (SELECT COUNT(*) FROM stock_transfers WHERE receipt_id IS NULL) AS transfer_rows_legacy,
  (SELECT COUNT(*) FROM leg) AS transfer_legs,
  (SELECT COUNT(*) FROM evsum) AS transfer_events,
  (SELECT COALESCE(SUM(ABS(o - i)), 0) FROM evsum WHERE ABS(o - i) > 0.000001) AS transfer_unbalanced_units,
  (SELECT COUNT(*) FROM rc WHERE replay_state = 'reversed') AS receipts_reversed,
  json_object('event', (SELECT MIN(first_id) FROM evsum WHERE ABS(o - i) > 0.000001),
    'transfer_row', (SELECT MIN(st_first) FROM cl WHERE st_n > 0 AND (leg_n = 0 OR ABS(st_q - leg_q) > 0.000001)),
    'out_leg', (SELECT MIN(leg_first) FROM cl WHERE st_n = 0), 'receipt', (SELECT MIN(id) FROM rc WHERE (status = 'committed' AND members = 0)
      OR (replay_state = 'applied' AND generation % 2 = 1) OR (replay_state = 'reversed' AND generation % 2 = 0))) AS first_ids
