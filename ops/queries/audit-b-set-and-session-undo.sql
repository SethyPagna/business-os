-- DATA-AUDIT lane B (stock & cost), query 10 of 14: scoped Set operations and stock-in sessions against their movements, snapshots and history.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Rule (system prompt "Undo must actually reverse"; lib/stockLotAdjustment.ts, lib/stockSession.ts, lib/stockInLineEdit.ts): every action that records an
-- action_history row must carry a payload the SERVER can replay without the client (an empty payload makes Undo a no-op that reports success), and its
-- replay state must agree with the rows it wrote.
--   * A scoped Set (stock_lot_adjustment_operations, setScope in request_json, history entity stock_quantity_set, applier stock.quantity_set): generation 0
--     writes one forward movement 'stock-set:<op>:0' of |lot delta| (type 'adjustment' up, 'remove' down, 'damage_out' for a tagged hold); each Undo adds a
--     counter movement 'revert:<forward id>' of the SAME magnitude and flips state applied -> reversed (generation + 1); each Redo writes a new forward
--     movement 'stock-set:<op>:<generation>'. So at generation G there are G/2 + 1 forward rows and (G + 1)/2 counters (integer division), and the state is
--     'applied' when G is even, 'reversed' when odd. Owner's SK-II case: the Revert of a Set must invert exactly its delta.
--   * A stock-in line edit shares the table (history entity stock_in_line_edit, applier stock.session_line_edit): only its state / history link is checked here.
--   * A stock-in session (stock_session_operations, applier stock.session): one 'add' receipt movement per member with a quantity, stamped with the operation's
--     rowid; each Undo writes one 'remove' (stored NEGATIVE) and each Redo one 'add' per member, reason 'Stock session <id> undo|redo generation <n>'; the
--     undo_snapshot is 'applied' at an even generation and 'reversed' at an odd one; the history row is 'undoable' / 'redoable' accordingly.
--   * Transfers: audit-b-transfers.sql.  The tables read here come from migrations 0193 (stock_lot_adjustment_operations) and the stock-session set; check
--     migrations-applied.sql first.
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column):
--   set_state_generation_mismatch      an operation row whose state contradicts the parity of its generation
--   set_forward_rows_mismatch          a scoped Set whose forward movements are not G/2 + 1 in number
--   set_forward_quantity_mismatch      a forward movement whose size is not |lot after - lot before|
--   set_forward_scope_mismatch         a forward movement of another product, branch or lot than the Set's own
--   set_forward_direction_mismatch     a forward movement whose type contradicts the sign of the delta
--   set_counter_rows_mismatch          a scoped Set whose Reverts are not (G + 1)/2 in number
--   set_counter_quantity_mismatch      a counter movement that does not invert exactly the delta (SK-II)
--   operation_history_missing          an operation row with no action_history row (its Undo does nothing)
--   operation_history_mismatch         a history payload that is not this operation's applier / id / generation, or a status that contradicts the state
--   session_ops_without_members        a stock-in session with no member
--   session_member_movement_missing    a member with a quantity and no receipt movement
--   session_member_movement_mismatch   a receipt movement of another product, branch, lot, type or size than its member (or not stamped with the operation)
--   session_member_lot_other_product   a member whose lot belongs to another product (or does not exist)
--   session_generation_rows_mismatch   undo / redo movement rows that are not generation x members-with-quantity
--   session_snapshot_unusable          a session whose undo snapshot is missing, empty or in the wrong state for its generation
--   session_history_mismatch           a session history row that is missing, not applier stock.session for this operation / snapshot / generation, or in the wrong status
--   open_history_without_operation     an open (undoable / redoable) stock history row (transfer, session, Set, line edit) that no operation or receipt points at
--   Info columns:
--   set_operations / set_operations_reversed / line_edit_operations / stock_sessions / stock_session_members_total / stock_sessions_reversed
--   set_branch_delta_differs           scoped Sets whose branch delta differs from the lot delta (the Part-77 floor on lot scope; the movement writes the lot delta)
--   open_history_rows                  history rows that are reversible and undoable / redoable
--   open_history_without_applier       of them, with no server applier in the undo payload (undone by the client, never by the server)
--   open_history_without_applier_by_entity   json object entity -> count, the ten largest
--   first_ids                          json object: the lowest offending operation id / history id per column family
-- Measured cost: a range read per operation row on the reference_id index (a few hundred rows), index probes per session member, and one pass over
-- action_history; see the scale test output (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero set_state_generation_mismatch,set_forward_rows_mismatch,set_forward_quantity_mismatch,set_forward_scope_mismatch,set_forward_direction_mismatch,set_counter_rows_mismatch,set_counter_quantity_mismatch,operation_history_missing,operation_history_mismatch,session_ops_without_members,session_member_movement_missing,session_member_movement_mismatch,session_member_lot_other_product,session_generation_rows_mismatch,session_snapshot_unusable,session_history_mismatch,open_history_without_operation
WITH op AS MATERIALIZED (
  SELECT o.id, o.generation AS g, o.state, o.history_id,
    CASE WHEN json_extract(o.request_json, '$.setScope') IS NOT NULL THEN 1 ELSE 0 END AS is_set,
    json_extract(o.before_json, '$.productId') AS b_product, json_extract(o.before_json, '$.branchId') AS b_branch, json_extract(o.before_json, '$.batchId') AS b_batch,
    json_extract(o.after_json, '$.lotQuantity') - json_extract(o.before_json, '$.lotQuantity') AS lot_delta,
    json_extract(o.after_json, '$.branchQuantity') - json_extract(o.before_json, '$.branchQuantity') AS branch_delta,
    'stock-set:' || o.id || ':' AS lo, 'stock-set:' || o.id || ';' AS hi
  FROM stock_lot_adjustment_operations o
), fw AS MATERIALIZED (
  SELECT op.id AS op_id, op.lot_delta, op.b_product, op.b_branch, op.b_batch, m.id, m.movement_type, ABS(COALESCE(m.quantity, 0)) AS q,
    m.product_id, m.branch_id, m.batch_id
  FROM op JOIN inventory_movements m ON m.reference_id >= op.lo AND m.reference_id < op.hi
  WHERE op.is_set = 1
), cn AS MATERIALIZED (
  SELECT fw.op_id, fw.id AS fw_id, fw.lot_delta, c.id, ABS(COALESCE(c.quantity, 0)) AS q
  FROM fw JOIN inventory_movements c ON c.reference_id = 'revert:' || CAST(fw.id AS TEXT)
), opx AS MATERIALIZED (
  SELECT op.*,
    (SELECT COUNT(*) FROM fw WHERE fw.op_id = op.id) AS n_fw,
    (SELECT COUNT(*) FROM cn WHERE cn.op_id = op.id) AS n_cn,
    h.id AS hid, h.status AS hstatus, h.entity AS hentity,
    CASE WHEN h.id IS NOT NULL AND json_valid(h.undo_payload) = 1 AND json_valid(h.redo_payload) = 1 THEN
      CASE WHEN json_extract(h.undo_payload, '$.applier') = CASE WHEN op.is_set = 1 THEN 'stock.quantity_set' ELSE 'stock.session_line_edit' END
        AND json_extract(h.redo_payload, '$.applier') = json_extract(h.undo_payload, '$.applier')
        AND json_extract(h.undo_payload, '$.operation_id') = op.id AND json_extract(h.redo_payload, '$.operation_id') = op.id
        AND json_extract(h.undo_payload, '$.generation') = op.g AND json_extract(h.redo_payload, '$.generation') = op.g THEN 1 ELSE 0 END
      ELSE 0 END AS payload_ok
  FROM op LEFT JOIN action_history h ON h.id = op.history_id
), ss AS MATERIALIZED (
  SELECT o.id, o.rowid AS orow, o.generation AS g, o.snapshot_id, o.history_id,
    (SELECT COUNT(*) FROM stock_session_members m WHERE m.operation_id = o.id) AS n_members,
    (SELECT COUNT(*) FROM stock_session_members m WHERE m.operation_id = o.id AND m.quantity > 0) AS n_pos,
    (SELECT COUNT(*) FROM inventory_movements x WHERE x.reference_id = o.rowid AND x.movement_type IN ('add', 'remove')
      AND substr(x.reason, 1, 14 + length(o.id)) = 'Stock session ' || o.id
      AND NOT EXISTS (SELECT 1 FROM stock_session_members mm WHERE mm.movement_id = x.id)) AS gen_rows,
    s.id AS sid, s.kind AS skind, s.status AS sstatus, s.payload_json AS spayload,
    h.id AS hid, h.status AS hstatus,
    CASE WHEN h.id IS NOT NULL AND json_valid(h.undo_payload) = 1 AND json_valid(h.redo_payload) = 1 THEN
      CASE WHEN json_extract(h.undo_payload, '$.applier') = 'stock.session' AND json_extract(h.redo_payload, '$.applier') = 'stock.session'
        AND json_extract(h.undo_payload, '$.operation_id') = o.id AND json_extract(h.redo_payload, '$.operation_id') = o.id
        AND json_extract(h.undo_payload, '$.snapshot_id') = o.snapshot_id AND json_extract(h.redo_payload, '$.snapshot_id') = o.snapshot_id
        AND json_extract(h.undo_payload, '$.generation') = o.generation AND json_extract(h.redo_payload, '$.generation') = o.generation THEN 1 ELSE 0 END
      ELSE 0 END AS payload_ok
  FROM stock_session_operations o
  LEFT JOIN undo_snapshots s ON s.id = o.snapshot_id
  LEFT JOIN action_history h ON h.id = o.history_id
), sm AS MATERIALIZED (
  SELECT m.operation_id, m.quantity,
    CASE WHEN m.quantity > 0 AND (m.movement_id IS NULL OR mv.id IS NULL) THEN 1 ELSE 0 END AS no_movement,
    CASE WHEN mv.id IS NOT NULL AND (mv.product_id IS NOT m.product_id OR mv.branch_id IS NOT m.branch_id OR mv.batch_id IS NOT m.batch_id
      OR mv.movement_type NOT IN ('add', 'stock_in') OR ABS(COALESCE(mv.quantity, 0)) <> m.quantity OR mv.reference_id IS NOT o.rowid) THEN 1 ELSE 0 END AS wrong_movement,
    CASE WHEN m.batch_id IS NOT NULL AND (pb.id IS NULL OR pb.variant_product_id <> m.product_id) THEN 1 ELSE 0 END AS wrong_lot,
    CASE WHEN o.id IS NULL THEN 1 ELSE 0 END AS no_operation
  FROM stock_session_members m
  LEFT JOIN stock_session_operations o ON o.id = m.operation_id
  LEFT JOIN inventory_movements mv ON mv.id = m.movement_id
  LEFT JOIN product_batches pb ON pb.id = m.batch_id
), oh AS MATERIALIZED (
  SELECT h.id, h.entity FROM action_history h
  WHERE h.reversible = 1 AND h.status IN ('undoable', 'redoable') AND h.entity IN ('stock_transfer', 'stock_session', 'stock_quantity_set', 'stock_in_line_edit')
    AND NOT EXISTS (SELECT 1 FROM transfer_operation_receipts r WHERE r.action_history_id = h.id)
    AND NOT EXISTS (SELECT 1 FROM stock_session_operations o WHERE o.history_id = h.id)
    AND NOT EXISTS (SELECT 1 FROM stock_lot_adjustment_operations a WHERE a.history_id = h.id)
), ha AS MATERIALIZED (
  SELECT COALESCE(entity, '') AS entity, COUNT(*) AS n,
    SUM(CASE WHEN CASE WHEN json_valid(undo_payload) = 1 THEN json_extract(undo_payload, '$.applier') END IS NULL THEN 1 ELSE 0 END) AS no_applier
  FROM action_history
  WHERE reversible = 1 AND status IN ('undoable', 'redoable')
  GROUP BY COALESCE(entity, '')
)
SELECT
  (SELECT COUNT(*) FROM op WHERE (state = 'applied' AND g % 2 = 1) OR (state = 'reversed' AND g % 2 = 0)) AS set_state_generation_mismatch,
  (SELECT COUNT(*) FROM opx WHERE is_set = 1 AND n_fw <> g / 2 + 1) AS set_forward_rows_mismatch,
  (SELECT COUNT(*) FROM fw WHERE ABS(q - ABS(lot_delta)) > 0.000001) AS set_forward_quantity_mismatch,
  (SELECT COUNT(*) FROM fw WHERE product_id IS NOT b_product OR branch_id IS NOT b_branch OR batch_id IS NOT b_batch) AS set_forward_scope_mismatch,
  (SELECT COUNT(*) FROM fw WHERE (lot_delta > 0 AND movement_type <> 'adjustment') OR (lot_delta < 0 AND movement_type NOT IN ('remove', 'damage_out'))) AS set_forward_direction_mismatch,
  (SELECT COUNT(*) FROM opx WHERE is_set = 1 AND n_cn <> (g + 1) / 2) AS set_counter_rows_mismatch,
  (SELECT COUNT(*) FROM cn WHERE ABS(q - ABS(lot_delta)) > 0.000001) AS set_counter_quantity_mismatch,
  (SELECT COUNT(*) FROM opx WHERE hid IS NULL) AS operation_history_missing,
  (SELECT COUNT(*) FROM opx WHERE hid IS NOT NULL AND (payload_ok = 0 OR (state = 'applied' AND hstatus <> 'undoable') OR (state = 'reversed' AND hstatus <> 'redoable'))) AS operation_history_mismatch,
  (SELECT COUNT(*) FROM ss WHERE n_members = 0) AS session_ops_without_members,
  (SELECT COALESCE(SUM(no_movement), 0) FROM sm) AS session_member_movement_missing,
  (SELECT COALESCE(SUM(wrong_movement), 0) FROM sm) AS session_member_movement_mismatch,
  (SELECT COALESCE(SUM(wrong_lot), 0) FROM sm) AS session_member_lot_other_product,
  (SELECT COUNT(*) FROM ss WHERE gen_rows <> g * n_pos) AS session_generation_rows_mismatch,
  (SELECT COUNT(*) FROM ss WHERE sid IS NULL OR skind <> 'stock.session' OR COALESCE(json_valid(spayload), 0) = 0 OR length(spayload) <= 2
    OR (g % 2 = 0 AND sstatus <> 'applied') OR (g % 2 = 1 AND sstatus <> 'reversed')) AS session_snapshot_unusable,
  (SELECT COUNT(*) FROM ss WHERE hid IS NULL OR payload_ok = 0 OR (g % 2 = 0 AND hstatus <> 'undoable') OR (g % 2 = 1 AND hstatus <> 'redoable')) AS session_history_mismatch,
  (SELECT COUNT(*) FROM oh) AS open_history_without_operation,
  (SELECT COUNT(*) FROM op WHERE is_set = 1) AS set_operations,
  (SELECT COUNT(*) FROM op WHERE is_set = 1 AND state = 'reversed') AS set_operations_reversed,
  (SELECT COUNT(*) FROM op WHERE is_set = 0) AS line_edit_operations,
  (SELECT COUNT(*) FROM ss) AS stock_sessions,
  (SELECT COUNT(*) FROM sm) AS stock_session_members_total,
  (SELECT COUNT(*) FROM ss WHERE g % 2 = 1) AS stock_sessions_reversed,
  (SELECT COUNT(*) FROM op WHERE is_set = 1 AND ABS(branch_delta - lot_delta) > 0.000001) AS set_branch_delta_differs,
  (SELECT COALESCE(SUM(n), 0) FROM ha) AS open_history_rows,
  (SELECT COALESCE(SUM(no_applier), 0) FROM ha) AS open_history_without_applier,
  (SELECT COALESCE(json_group_object(entity, no_applier), '{}') FROM (SELECT entity, no_applier FROM ha WHERE no_applier > 0 ORDER BY no_applier DESC, entity LIMIT 10)) AS open_history_without_applier_by_entity,
  json_object('operation', (SELECT MIN(id) FROM opx WHERE (state = 'applied' AND g % 2 = 1) OR (state = 'reversed' AND g % 2 = 0) OR hid IS NULL OR (is_set = 1 AND (n_fw <> g / 2 + 1 OR n_cn <> (g + 1) / 2))),
    'session', (SELECT MIN(id) FROM ss WHERE n_members = 0 OR gen_rows <> g * n_pos OR sid IS NULL OR hid IS NULL OR payload_ok = 0),
    'history', (SELECT MIN(id) FROM oh)) AS first_ids
