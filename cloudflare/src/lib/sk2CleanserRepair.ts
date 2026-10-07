import type { D1Compat } from './db'

/**
 * SK2-REPAIR (owner, 7 Oct 2026: "i want you to do it for me. with the cut over. backend.") -- the one-off repair of
 * SK-II Gentle Cleanser 20g (product 5357) at Shop (branch 2), run by the cutover operator (action `repair-sk2`) on
 * cutover night just before `start`.
 *
 * What happened (production rows, read from the 7 Oct prod copy):
 *   #48026 2026-09-29 add 30 on lot 61482 (received 2026-09-29, Dane japan, $7, $210 paid)        Shop 3 -> 33
 *   #48034 2026-09-30 lot Set on lot 56725 (received 2026-09-02) 3 -> 30, +27, "wrong stock";
 *          operation c7b78789-d9ec-45fa-ace6-8bb6612c290a, History 1318                          Shop 33 -> 60
 *   #48197 2026-10-01 Revert of #48026 (meant for the Set): -30 on lot 61482, lot un-received      Shop 60 -> 30
 *
 * Owner ruling (6 Oct 2026 22:50): "restore the delivery, and also revert the +27 as I meant to remove the 3 in the
 * branch in a more formal way: current 3 + 27, revert +27 -> back to 3, then minus 3 -> 0 left in that slot ... cost
 * price, loss etc. only counts the 3. Revert should fully revert, never leaves a stock effect behind."
 *
 * Three compensating records, written exactly as the app writes them (history is never edited or deleted), all in
 * ONE D1 batch with the state guard first and the post-assertion last, so it applies whole or not at all:
 *   A. Revert of #48197: 'add' 30 on lot 61482, reference 'revert:48197'; the lot is received again (30 / $210,
 *      active). Not a loss.
 *   B. Undo of the Set #48034: 'remove' 27 on lot 56725, reference 'revert:48034'; its operation -> generation 1
 *      'reversed', History 1318 -> 'redoable'. Not a loss (removalLosses.ts excludes 'revert:' rows).
 *   C. Remove 3 from lot 56725 (the 02/09 slot), no reference, at the lot's own cost: the ONLY loss (3 x $7 = $21).
 *   Net: lot 56725 30 -> 0, lot 61482 0 -> 30, Shop 30 -> 30, product 30 -> 30, catalog cost $7 (the 0195 on-hand
 *   triggers: only lot 61482 is on hand). Actor: user 5. Two audit rows: the before images, then the outcome.
 *
 * States (read first, re-asserted inside the batch):
 *   pre   the observed production state                          -> writes A, B, C
 *   ab    A and B already written (an earlier partial path)      -> writes C
 *   done  A, B and C written                                     -> writes nothing (idempotent)
 *   stale anything else (a sale since, a changed lot, ...)       -> refuses, writes nothing
 */

export const SK2 = Object.freeze({
  productId: 5357,
  branchId: 2,
  slotLot: 56725,       // received 2026-09-02, the Set's lot
  deliveryLot: 61482,   // received 2026-09-29, the reverted delivery
  setMovement: 48034,
  revertMovement: 48197,
  deliveryMovement: 48026,
  setOperation: 'c7b78789-d9ec-45fa-ace6-8bb6612c290a',
  setHistory: 1318,
  actorUserId: 5,
  deliveryQuantity: 30,
  deliveryCostUsd: 210,
  setDelta: 27,
  lossQuantity: 3,
})

export type Sk2State = 'pre' | 'ab' | 'done' | 'stale'
export type Sk2Figures = {
  state: Sk2State
  slotLot: number | null; deliveryLot: number | null; shop: number | null; product: number | null
  deliveryReceived: number | null; deliveryCost: number | null; deliveryActive: number | null
  setGeneration: number | null; historyStatus: string | null; newestMovement: number | null
  revertRows: number; lossRows: number; catalogCost: number | null; slotUnitCost: number | null
}

const P = { product: SK2.productId, branch: SK2.branchId, slot: SK2.slotLot, delivery: SK2.deliveryLot, setMovement: SK2.setMovement,
  revertMovement: SK2.revertMovement, operation: SK2.setOperation, history: SK2.setHistory, actor: SK2.actorUserId }
const REFS = `('revert:${SK2.revertMovement}', 'revert:${SK2.setMovement}')`

// The three states as SQL predicates -- the read and the in-batch guard use the same text.
const PRE_SQL = `(
    COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = @slot AND branch_id = @branch), -1) = 30
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = @delivery AND branch_id = @branch), -1) = 0
    AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id = @product AND branch_id = @branch), -1) = 30
    AND COALESCE((SELECT stock_quantity FROM products WHERE id = @product), -1) = 30
    AND COALESCE((SELECT received_quantity FROM product_batches WHERE id = @delivery AND variant_product_id = @product), -1) = 0
    AND COALESCE((SELECT received_cost_usd FROM product_batches WHERE id = @delivery), -1) = 0
    AND (SELECT variant_product_id FROM product_batches WHERE id = @slot) = @product
    AND (SELECT generation FROM stock_lot_adjustment_operations WHERE id = @operation) = 0
    AND (SELECT state FROM stock_lot_adjustment_operations WHERE id = @operation) = 'applied'
    AND (SELECT status FROM action_history WHERE id = @history) = 'undoable'
    AND (SELECT MAX(id) FROM inventory_movements WHERE product_id = @product) = @revertMovement
    AND (SELECT reference_id FROM inventory_movements WHERE id = @revertMovement) = 'revert:${SK2.deliveryMovement}'
    AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE reference_id IN ${REFS})
  )`
const AB_SQL = `(
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ${REFS}) = 2
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = @slot AND branch_id = @branch), -1) = 3
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = @delivery AND branch_id = @branch), -1) = 30
    AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id = @product AND branch_id = @branch), -1) = 33
    AND COALESCE((SELECT stock_quantity FROM products WHERE id = @product), -1) = 33
    AND (SELECT variant_product_id FROM product_batches WHERE id = @slot) = @product
    AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE product_id = @product
      AND id > (SELECT MAX(id) FROM inventory_movements WHERE reference_id IN ${REFS}))
  )`
const DONE_SQL = `(
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ${REFS}) = 2
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id = @slot AND branch_id = @branch), -1) = 0
    AND EXISTS (SELECT 1 FROM inventory_movements WHERE product_id = @product AND branch_id = @branch AND batch_id = @slot
      AND movement_type = 'remove' AND quantity = 3 AND reference_id IS NULL
      AND id > (SELECT MAX(id) FROM inventory_movements WHERE reference_id IN ${REFS}))
  )`
// The end state every successful run must reach, the loss row included.
const POST_SQL = `(
    (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ${REFS}) = 2
    AND (SELECT quantity FROM branch_batch_stock WHERE batch_id = @slot AND branch_id = @branch) = 0
    AND (SELECT quantity FROM branch_batch_stock WHERE batch_id = @delivery AND branch_id = @branch) = 30
    AND (SELECT quantity FROM branch_stock WHERE product_id = @product AND branch_id = @branch) = 30
    AND (SELECT stock_quantity FROM products WHERE id = @product) = 30
    AND (SELECT received_quantity FROM product_batches WHERE id = @delivery) = 30
    AND ABS((SELECT received_cost_usd FROM product_batches WHERE id = @delivery) - 210) < 0.00005
    AND (SELECT is_active FROM product_batches WHERE id = @delivery) = 1
    AND (SELECT generation FROM stock_lot_adjustment_operations WHERE id = @operation) = 1
    AND (SELECT state FROM stock_lot_adjustment_operations WHERE id = @operation) = 'reversed'
    AND (SELECT status FROM action_history WHERE id = @history) = 'redoable'
    AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = @product AND id > @revertMovement AND movement_type = 'remove'
      AND (reference_id IS NULL OR CAST(reference_id AS TEXT) NOT LIKE 'revert:%')) = 1
    AND (SELECT COUNT(*) FROM inventory_movements WHERE product_id = @product AND id > @revertMovement AND movement_type = 'remove'
      AND reference_id IS NULL AND batch_id = @slot AND quantity = 3
      AND ABS(total_cost_usd - 3 * (SELECT unit_cost_usd FROM product_batches WHERE id = @slot)) < 0.00005) = 1
    AND ABS(COALESCE((SELECT cost_price_usd FROM products WHERE id = @product), -1) - (SELECT unit_cost_usd FROM product_batches WHERE id = @delivery)) < 0.00005
  )`

const guard = (predicate: string) => ({ sql: `INSERT INTO stock_session_guards (guard_value) SELECT CASE WHEN ${predicate} THEN 1 ELSE 0 END`, params: P })
const ACTOR_NAME = `(SELECT username FROM users WHERE id = @actor)`

const BEFORE_IMAGES = `json_object(
    'products', (SELECT json_object('id', id, 'stock_quantity', stock_quantity, 'cost_price_usd', cost_price_usd, 'purchase_price_usd', purchase_price_usd, 'updated_at', updated_at) FROM products WHERE id = @product),
    'branch_stock', (SELECT json_object('id', id, 'quantity', quantity) FROM branch_stock WHERE product_id = @product AND branch_id = @branch),
    'branch_batch_stock', (SELECT json_group_array(json_object('id', id, 'batch_id', batch_id, 'quantity', quantity, 'updated_at', updated_at)) FROM branch_batch_stock WHERE batch_id IN (@slot, @delivery) AND branch_id = @branch),
    'product_batches', (SELECT json_group_array(json_object('id', id, 'is_active', is_active, 'received_quantity', received_quantity, 'received_cost_usd', received_cost_usd,
      'unit_cost_usd', unit_cost_usd, 'supplier_id', supplier_id, 'supplier_name', supplier_name, 'payment_status', payment_status, 'updated_at', updated_at)) FROM product_batches WHERE id IN (@slot, @delivery)),
    'stock_lot_adjustment_operations', (SELECT json_object('id', id, 'generation', generation, 'state', state) FROM stock_lot_adjustment_operations WHERE id = @operation),
    'action_history', (SELECT json_object('id', id, 'status', status, 'undo_generation', json_extract(undo_payload, '$.generation')) FROM action_history WHERE id = @history),
    'newest_movement', (SELECT MAX(id) FROM inventory_movements WHERE product_id = @product))`

const auditBefore = (state: Sk2State) => ({
  sql: `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
    VALUES (@actor, ${ACTOR_NAME}, 'stock_revert_repair_before', 'product', '${SK2.productId}',
      json_object('repair', 'SK2-REPAIR', 'state', @state, 'before', ${BEFORE_IMAGES}))`,
  params: { ...P, state },
})

// A. Revert of #48197 -- the delivery comes back, the lot is received again.
const RECORD_A = [
  { sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
      unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id)
    SELECT product_id, product_name, branch_id, branch_name, 'add', 30, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
      'Revert of #${SK2.revertMovement}: ' || COALESCE(reason, ''), 'revert:${SK2.revertMovement}', @actor, ${ACTOR_NAME}, CURRENT_TIMESTAMP, @delivery
    FROM inventory_movements WHERE id = @revertMovement`, params: P },
  // Active first: a positive lot must sit on an active lot (0154).
  { sql: `UPDATE product_batches SET is_active = 1, received_quantity = COALESCE(received_quantity, 0) + 30,
      received_cost_usd = ROUND(COALESCE(received_cost_usd, 0) + 210, 4), updated_at = CURRENT_TIMESTAMP WHERE id = @delivery`, params: P },
  { sql: `UPDATE branch_batch_stock SET quantity = quantity + 30, updated_at = datetime('now') WHERE batch_id = @delivery AND branch_id = @branch`, params: P },
  { sql: `UPDATE branch_stock SET quantity = quantity + 30 WHERE product_id = @product AND branch_id = @branch`, params: P },
  { sql: `UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + 30, updated_at = CURRENT_TIMESTAMP WHERE id = @product`, params: P },
]

// B. Undo of the Set #48034 -- exactly its +27, on its own lot; the Set's operation and History row follow.
const RECORD_B = [
  { sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
      unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id)
    SELECT product_id, product_name, branch_id, branch_name, 'remove', 27, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
      'Undo: wrong stock (Set received 2026-09-02 from 3 to 30)', 'revert:${SK2.setMovement}', @actor, ${ACTOR_NAME}, CURRENT_TIMESTAMP, @slot
    FROM inventory_movements WHERE id = @setMovement`, params: P },
  { sql: `UPDATE branch_batch_stock SET quantity = quantity - 27, updated_at = datetime('now') WHERE batch_id = @slot AND branch_id = @branch`, params: P },
  { sql: `UPDATE branch_stock SET quantity = quantity - 27 WHERE product_id = @product AND branch_id = @branch`, params: P },
  { sql: `UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - 27, updated_at = CURRENT_TIMESTAMP WHERE id = @product`, params: P },
  { sql: `UPDATE stock_lot_adjustment_operations SET generation = 1, state = 'reversed', revision_json = json_set(revision_json, '$.generation', 1)
    WHERE id = @operation AND generation = 0 AND state = 'applied'`, params: P },
  { sql: `UPDATE action_history SET status = 'redoable', last_error = NULL, updated_at = CURRENT_TIMESTAMP,
      undo_payload = json_set(undo_payload, '$.generation', 1), redo_payload = json_set(redo_payload, '$.generation', 1)
    WHERE id = @history AND status = 'undoable'`, params: P },
]

// C. Remove the 3 left on the 02/09 slot -- the one loss, at the lot's own cost.
const RECORD_C = [
  { sql: `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity,
      unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reason, reference_id, user_id, user_name, created_at, batch_id)
    SELECT @product, (SELECT name FROM products WHERE id = @product), @branch, (SELECT name FROM branches WHERE id = @branch), 'remove', 3,
      pb.unit_cost_usd, 0, ROUND(3 * pb.unit_cost_usd, 4), 0,
      'Stock count: received 02/09/2026 holds 0 (owner, 6 Oct 2026)', NULL, @actor, ${ACTOR_NAME}, CURRENT_TIMESTAMP, @slot
    FROM product_batches pb WHERE pb.id = @slot`, params: P },
  { sql: `UPDATE branch_batch_stock SET quantity = quantity - 3, updated_at = datetime('now') WHERE batch_id = @slot AND branch_id = @branch`, params: P },
  { sql: `UPDATE branch_stock SET quantity = quantity - 3 WHERE product_id = @product AND branch_id = @branch`, params: P },
  { sql: `UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - 3, updated_at = CURRENT_TIMESTAMP WHERE id = @product`, params: P },
]

const auditAfter = (state: Sk2State) => ({
  sql: `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
    VALUES (@actor, ${ACTOR_NAME}, 'stock_revert_repair', 'product', '${SK2.productId}', json_object(
      'repair', 'SK2-REPAIR', 'from_state', @state,
      'reverted', CASE WHEN @state = 'pre' THEN json_array(${SK2.revertMovement}, ${SK2.setMovement}) ELSE json_array() END,
      'movements', (SELECT json_group_array(id) FROM inventory_movements WHERE product_id = @product AND id > @revertMovement),
      'removed', json_object('lot', @slot, 'quantity', 3, 'loss_usd', (SELECT total_cost_usd FROM inventory_movements
        WHERE product_id = @product AND batch_id = @slot AND movement_type = 'remove' AND quantity = 3 AND reference_id IS NULL ORDER BY id DESC LIMIT 1)),
      'branchId', @branch, 'shop', json_array(30, (SELECT quantity FROM branch_stock WHERE product_id = @product AND branch_id = @branch)),
      'why', 'Owner meant to revert the Set +27 (#${SK2.setMovement}) on 1 Oct; the Revert went to the delivery #${SK2.deliveryMovement}. Owner ruling 6 Oct: delivery back, Set reverted, the 3 on the 02/09 slot removed as the only loss.'))`,
  params: { ...P, state },
})

/** The statements a run from `state` writes, guard first and post-assertion last. Empty for done/stale. */
export function sk2RepairStatements(state: Sk2State): Array<{ sql: string; params: Record<string, unknown> }> {
  if (state !== 'pre' && state !== 'ab') return []
  return [
    guard(state === 'pre' ? PRE_SQL : AB_SQL),
    // The actor must be a live account: user 5, active, not deleted.
    guard(`EXISTS (SELECT 1 FROM users WHERE id = @actor AND is_active = 1 AND deleted_at IS NULL)`),
    auditBefore(state),
    ...(state === 'pre' ? [...RECORD_A, ...RECORD_B] : []),
    ...RECORD_C,
    auditAfter(state),
    guard(POST_SQL),
    { sql: 'DELETE FROM stock_session_guards', params: {} },
  ]
}

export async function readSk2State(db: D1Compat): Promise<Sk2Figures> {
  const row = await db.prepare(`SELECT
      CASE WHEN ${DONE_SQL} THEN 'done' WHEN ${PRE_SQL} THEN 'pre' WHEN ${AB_SQL} THEN 'ab' ELSE 'stale' END AS state,
      (SELECT quantity FROM branch_batch_stock WHERE batch_id = @slot AND branch_id = @branch) AS slotLot,
      (SELECT quantity FROM branch_batch_stock WHERE batch_id = @delivery AND branch_id = @branch) AS deliveryLot,
      (SELECT quantity FROM branch_stock WHERE product_id = @product AND branch_id = @branch) AS shop,
      (SELECT stock_quantity FROM products WHERE id = @product) AS product,
      (SELECT received_quantity FROM product_batches WHERE id = @delivery) AS deliveryReceived,
      (SELECT received_cost_usd FROM product_batches WHERE id = @delivery) AS deliveryCost,
      (SELECT is_active FROM product_batches WHERE id = @delivery) AS deliveryActive,
      (SELECT generation FROM stock_lot_adjustment_operations WHERE id = @operation) AS setGeneration,
      (SELECT status FROM action_history WHERE id = @history) AS historyStatus,
      (SELECT MAX(id) FROM inventory_movements WHERE product_id = @product) AS newestMovement,
      (SELECT COUNT(*) FROM inventory_movements WHERE reference_id IN ${REFS}) AS revertRows,
      (SELECT COUNT(*) FROM inventory_movements WHERE product_id = @product AND id > @revertMovement AND movement_type = 'remove' AND reference_id IS NULL) AS lossRows,
      (SELECT cost_price_usd FROM products WHERE id = @product) AS catalogCost,
      (SELECT unit_cost_usd FROM product_batches WHERE id = @slot) AS slotUnitCost`).get<Sk2Figures>(P)
  if (!row) throw new Error('sk2_read_failed')
  return { ...row, state: row.state as Sk2State }
}

export type Sk2Outcome = { status: number; body: Record<string, unknown> }
const isGuardFailure = (error: unknown) => /guard_value|stock_session_guards|CHECK constraint/i.test(String((error as { message?: unknown } | null)?.message ?? error))

/**
 * The operator action. `dryRun` reads the state and the planned loss and writes nothing. A real run writes only from
 * `pre` or `ab`; `done` answers success without writing (idempotent re-run); `stale` and a guard failure (the rows
 * moved between the read and the batch) are refusals with nothing written.
 */
export async function runSk2Repair(db: D1Compat, body: Record<string, unknown>): Promise<Sk2Outcome> {
  if (body.actorUserId !== SK2.actorUserId) return { status: 409, body: { ok: false, code: 'refused', refusal: 'sk2_actor_not_5' } }
  const before = await readSk2State(db)
  const plannedLossUsd = before.slotUnitCost == null ? null : Math.round(3 * before.slotUnitCost * 10000) / 10000
  if (body.dryRun === true) return { status: 200, body: { ok: true, dryRun: true, state: before.state, plannedLossUsd, before } }
  if (before.state === 'stale') return { status: 409, body: { ok: false, code: 'refused', refusal: 'sk2_state_mismatch', before } }
  if (before.state === 'done') return { status: 200, body: { ok: true, state: 'done', applied: false, replayed: true, after: before } }
  try {
    await db.batch(sk2RepairStatements(before.state))
  } catch (error) {
    if (!isGuardFailure(error)) throw error
    // A guard refused the batch. If an earlier attempt of this same run committed (a lost acknowledgement retried),
    // the rows are already in the end state: report that, never a second write.
    const now = await readSk2State(db)
    if (now.state === 'done') return { status: 200, body: { ok: true, state: 'done', applied: true, unconfirmed: true, from: before.state, plannedLossUsd, before, after: now } }
    return { status: 409, body: { ok: false, code: 'refused', refusal: 'sk2_state_changed', before, now } }
  }
  const after = await readSk2State(db)
  return { status: 200, body: { ok: after.state === 'done', state: after.state, applied: true, from: before.state, plannedLossUsd, before, after } }
}
