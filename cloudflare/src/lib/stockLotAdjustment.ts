// The ONE lot-level "Set quantity" writer (owner, 17 Sep; confirmed 24 Sep:
// "Set Quantity: offer selected received-date lot or branch total; selected
// lot is the default"). Two entry points share it and nothing else sets a
// lot's quantity to an absolute figure:
//
//   POST  /api/inventory/adjust  {type:'set', setScope:'lot'|'branch', batchId}
//   PATCH /api/batches/:id/branches/:branchId   (ManageBatchesModal, lot scope)
//
// A body without setScope keeps the historical branch-total conversion in
// routes/inventory.ts (old clients, queued offline replays).
//
// TRANSITION TABLE. L = the selected lot's quantity at the branch
// (branch_batch_stock), B = the branch aggregate (branch_stock), P =
// products.stock_quantity, H = the held (tagged) row. q = the operator's
// target, d = the lot delta.
//
//   scope lot     d = q - L        L' = q      B' = max(0, B + d)   P += B' - B
//   scope branch  d = q - B        L' = L + d  B' = q               P += d
//                 (refused 409 when L + d < 0: the lot cannot cover it)
//   d > 0         movement 'adjustment' |d| at the lot's unit_cost_usd
//                 (an upward count correction is not a purchase and not a loss)
//   d < 0         movement 'remove' |d| at the lot's unit_cost_usd -- the
//                 owner's loss rule (24 Sep): counted by removalLosses.ts
//   d < 0 tagged  the existing tagged Remove path (damagedLotActions.ts
//                 planHoldAsTagged): H += |d|, movement 'damage_out', not a
//                 loss until the held row is disposed of
//   d = 0         no write at all
//   tag with d >= 0  refused 400 (a tag names units that LEFT sellable stock)
//
// The B floor on lot scope is the Part-77 decision the batch correction route
// has always carried: the lot figure being set is authoritative and a drifted
// aggregate must not make the repair impossible. The exact B'/B pair is kept
// in the snapshots, so undo still restores B exactly.
//
// IDEMPOTENCY. The whole forward write is one ordinaryBusinessBatch (the
// maintenance guard is its last statement), so a Set either lands completely
// or not at all. A repeat of the same client_request_id is answered from the
// 0192 receipt (lib/stockMutationReceipt.ts) or, where 0192 is not applied,
// from this table's UNIQUE(actor_id, request_id); a different body under the
// same id is refused 409.
//
// UNDO / REDO (`stock.quantity_set`). Each replay is guarded on the CURRENT
// L, B (and H for a tagged Set) equalling the snapshot it reverses from --
// an intervening sale, transfer, count or disposal refuses the replay 409 and
// changes nothing. Undo posts the counter-movement stamped
// `revert:<forward movement id>` (so removalLosses.ts drops the undone loss,
// and the undo of an upward Set is not itself a loss); redo posts a fresh
// forward movement under the next generation's reference. The generation is
// advanced in the same batch, so a stale history row can never apply twice.
//
// Migration 0193 not applied: the Set still applies with the same guards and
// movements, but records no operation row and no history row (no undo).
import type { D1Compat } from './db'
import { getDb } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { ordinaryBusinessBatch } from './businessMaintenanceGuard'
import { resolveMovementCostSnapshot, type MovementCostPair } from './movementCostSnapshot'
import { planHoldAsTagged } from './damagedLotActions'
import type { StockWriteStatement } from './productBatches'
import type { StockConditionTag } from './stockCondition'
import { STOCK_REASON_MAX_LENGTH, stockReasonTooLong } from './stockReason'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'

export const STOCK_LOT_SET_KIND = 'stock.quantity_set'
export const STOCK_SET_REFERENCE_PREFIX = 'stock-set:'
export type StockLotSetScope = 'lot' | 'branch'

export type StockLotSetRequest = {
  productId: number
  branchId: number
  batchId: number
  quantity: number
  setScope: StockLotSetScope
  reason: string
  conditionTag: StockConditionTag | null
  expectedLotQuantity?: number
  expectedBranchQuantity?: number
}

export type StockLotSetResult = { status: number; body: Record<string, unknown> }

type Statement = StockWriteStatement

type Snapshot = {
  productId: number
  branchId: number
  batchId: number
  lotQuantity: number
  branchQuantity: number
  lotExists: number
  branchExists: number
}

type Effect = {
  productName: string
  branchName: string | null
  unitCostUsd: number | null
  lotDelta: number
  tag: StockConditionTag | null
  reason: string
}

type OperationRow = {
  id: string
  request_json: string
  response_json: string
  before_json: string
  after_json: string
  revision_json: string
  history_id: number | null
  generation: number
  state: string
}

/** `stock-set:<operation>:<generation>` -- the forward movement of one generation. */
export function stockSetReference(operationId: string, generation: number): string {
  return `${STOCK_SET_REFERENCE_PREFIX}${operationId}:${generation}`
}

export function isStockSetReference(referenceId: unknown): boolean {
  return String(referenceId ?? '').startsWith(STOCK_SET_REFERENCE_PREFIX)
}

// Same probe contract as lib/stockMutationReceipt.ts: only a positive answer
// is memoised, so an isolate that probed mid-migration starts recording
// operations the moment the table exists.
let operationsReady = false
export function resetStockLotSetSchemaProbe(): void { operationsReady = false }
async function operationsAvailable(db: D1Compat): Promise<boolean> {
  if (operationsReady) return true
  try {
    const row = await db.prepare(
      "SELECT COUNT(*) AS ready FROM sqlite_master WHERE type='table' AND name='stock_lot_adjustment_operations'",
    ).get<{ ready: number }>()
    operationsReady = Number(row?.ready ?? 0) > 0
  } catch {
    operationsReady = false
  }
  return operationsReady
}

// A failed guard inserts 0 into stock_session_guards, whose CHECK(guard_value
// = 1) aborts the whole batch. Nothing is left behind on success.
function guard(condition: string, params: Record<string, unknown>): Statement {
  return { sql: `INSERT INTO stock_session_guards(guard_value) SELECT 0 WHERE COALESCE((${condition}),0)=0`, params }
}

const MAINTENANCE_ERROR = /ordinary_business_maintenance_active/

function isMaintenanceError(error: unknown): boolean {
  return MAINTENANCE_ERROR.test(error instanceof Error ? error.message : String(error))
}

const MAINTENANCE_RESPONSE: StockLotSetResult = {
  status: 503,
  body: { error: 'Maintenance is in progress. No stock was changed; try again shortly.', code: 'maintenance_active' },
}

function conflict(error: string, code = 'stock_conflict'): StockLotSetResult {
  return { status: 409, body: { error, code } }
}

function stateGuard(from: Snapshot): Statement {
  return guard(`EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND variant_product_id=@product)
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch),0)=@lot
    AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0)=@branchQty
    AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch)=@lotExists
    AND EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch)=@branchExists`, {
    product: from.productId, branch: from.branchId, batch: from.batchId,
    lot: from.lotQuantity, branchQty: from.branchQuantity, lotExists: from.lotExists, branchExists: from.branchExists,
  })
}

// Absolute writes are exact here because stateGuard pinned the preimage in the
// same transaction: writing `to` equals applying (to - from) to each ledger.
function quantityStatements(from: Snapshot, to: Snapshot): Statement[] {
  const params = {
    product: to.productId, branch: to.branchId, batch: to.batchId,
    lot: to.lotQuantity, branchQty: to.branchQuantity, lotExists: to.lotExists, branchExists: to.branchExists,
    productDelta: to.branchQuantity - from.branchQuantity,
  }
  return [
    // 0154: positive lot stock needs an active lot. Activate first.
    ...(to.lotQuantity > 0 ? [{ sql: `UPDATE product_batches SET is_active=1, updated_at=datetime('now') WHERE id=@batch AND is_active IS NOT 1`, params }] : []),
    { sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT @batch,@branch,@lot WHERE @lotExists=1
      ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity, updated_at=datetime('now')`, params },
    { sql: 'DELETE FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND @lotExists=0', params },
    { sql: `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT @product,@branch,@branchQty WHERE @branchExists=1
      ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=excluded.quantity`, params },
    { sql: 'DELETE FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND @branchExists=0', params },
    { sql: 'UPDATE products SET stock_quantity=COALESCE(stock_quantity,0)+@productDelta, updated_at=CURRENT_TIMESTAMP WHERE id=@product AND @productDelta<>0', params },
  ]
}

function movementCost(effect: Effect): MovementCostPair {
  const quantity = Math.abs(effect.lotDelta)
  return resolveMovementCostSnapshot({ quantity, components: [{ quantity, unitCostUsd: effect.unitCostUsd }] })
}

function movementStatement(input: {
  snapshot: Snapshot; effect: Effect; movementType: string; reason: string; referenceSql: string; user: SessionUser; extra?: Record<string, unknown>
}): Statement {
  const cost = movementCost(input.effect)
  return {
    sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,
        unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,created_at,batch_id)
      VALUES(@product,@productName,@branch,@branchName,@movementType,@quantity,
        @unitCostUsd,@unitCostKhr,@totalCostUsd,@totalCostKhr,@reason,${input.referenceSql},@userId,@userName,CURRENT_TIMESTAMP,@batch)`,
    params: {
      product: input.snapshot.productId, productName: input.effect.productName,
      branch: input.snapshot.branchId, branchName: input.effect.branchName,
      movementType: input.movementType, quantity: Math.abs(input.effect.lotDelta), ...cost,
      reason: input.reason, userId: input.user.id ?? null, userName: actorSnapshot(input.user), batch: input.snapshot.batchId,
      ...(input.extra || {}),
    },
  }
}

// The forward half: the movement(s) of one applied generation. Untagged
// downward is a plain 'remove' (a loss); tagged downward is EXACTLY the
// tagged Remove path's HOLD plan; upward is an 'adjustment'.
function forwardMovementStatements(before: Snapshot, effect: Effect, user: SessionUser, reference: string, operationId: string | null): Statement[] {
  const quantity = Math.abs(effect.lotDelta)
  if (effect.lotDelta < 0 && effect.tag) {
    const [lotInsert, holdMovement] = planHoldAsTagged({
      productId: before.productId, productName: effect.productName, branchId: before.branchId, branchName: effect.branchName,
      batchId: before.batchId, quantity, tag: effect.tag, source: 'remove', reason: effect.reason,
      cost: movementCost(effect), referenceId: reference,
      actor: { userId: user.id ?? null, userName: actorSnapshot(user) },
    })
    // Remember WHICH held row this generation created, so its undo can take
    // exactly those units back out of it. last_insert_rowid() is the held row
    // here: the UPDATE between the two inserts inserts nothing itself.
    const remember = operationId ? [{
      sql: "UPDATE stock_lot_adjustment_operations SET revision_json=json_set(revision_json,'$.heldLotId',last_insert_rowid()) WHERE id=@operation",
      params: { operation: operationId },
    }] : []
    return [lotInsert, ...remember, holdMovement]
  }
  return [movementStatement({
    snapshot: before, effect, user, movementType: effect.lotDelta > 0 ? 'adjustment' : 'remove',
    reason: effect.reason, referenceSql: '@reference', extra: { reference },
  })]
}

function snapshotAfter(before: Snapshot, request: StockLotSetRequest): { after: Snapshot; lotDelta: number } | null {
  const lotDelta = request.setScope === 'lot' ? request.quantity - before.lotQuantity : request.quantity - before.branchQuantity
  const lotQuantity = before.lotQuantity + lotDelta
  const branchQuantity = request.setScope === 'lot' ? Math.max(0, before.branchQuantity + lotDelta) : request.quantity
  if (!(lotQuantity >= 0) || !(branchQuantity >= 0)) return null
  return {
    lotDelta,
    after: {
      ...before, lotQuantity, branchQuantity,
      lotExists: before.lotExists || (lotQuantity > 0 ? 1 : 0),
      branchExists: before.branchExists || (branchQuantity > 0 ? 1 : 0),
    },
  }
}

function describe(request: StockLotSetRequest, productName: string, receivedAt: string | null): string {
  const lot = receivedAt ? String(receivedAt).slice(0, 10) : `#${request.batchId}`
  return request.setScope === 'lot'
    ? `Set ${productName} received ${lot} to ${request.quantity}`
    : `Set ${productName} branch total to ${request.quantity} (received ${lot})`
}

function setNote(request: StockLotSetRequest): string {
  return request.setScope === 'lot' ? `Set received date to ${request.quantity}` : `Set to ${request.quantity}`
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Apply one scoped Set. `markWritten` is the 0192 receipt barrier; it is
 * called immediately before the single atomic batch and never earlier.
 */
export async function applyStockLotSet(
  db: D1Compat,
  user: SessionUser,
  requestId: string | null,
  request: StockLotSetRequest,
  markWritten: () => Promise<void> = async () => {},
): Promise<StockLotSetResult> {
  if (getActionTier(user, 'inventory', 'adjust') !== 'full') {
    return { status: 403, body: { error: 'Stock adjustments require Full Access to Inventory.' } }
  }
  if (request.setScope !== 'lot' && request.setScope !== 'branch') return { status: 400, body: { error: 'Invalid set scope.', code: 'invalid_set_scope' } }
  if (!Number.isSafeInteger(request.batchId) || request.batchId <= 0) {
    return { status: 400, body: { error: 'An existing received date must be selected.', code: 'batch_required' } }
  }
  if (!Number.isFinite(request.quantity) || request.quantity < 0) return { status: 400, body: { error: 'Quantity cannot be negative' } }
  if (!request.reason) return { status: 400, body: { error: 'A reason is required for stock adjustments' } }
  if (stockReasonTooLong(request.reason)) return { status: 400, body: { error: `Reason is too long (max ${STOCK_REASON_MAX_LENGTH} characters)`, code: 'reason_too_long' } }

  const recordOperation = await operationsAvailable(db)
  const operationRequestId = requestId || crypto.randomUUID()
  const requestJson = JSON.stringify(request)
  const previous = () => db.prepare('SELECT * FROM stock_lot_adjustment_operations WHERE actor_id=@actor AND request_id=@request')
    .get<OperationRow>({ actor: user.id, request: operationRequestId })
  const replay = (row: OperationRow): StockLotSetResult => row.request_json !== requestJson
    ? conflict('client_request_id was already used for different stock adjustment data.', 'idempotency_conflict')
    : { status: 200, body: { ...JSON.parse(row.response_json), replayed: true } }
  if (recordOperation && requestId) {
    const existing = await previous()
    if (existing) return replay(existing)
  }

  const facts = await db.prepare(`SELECT
      (SELECT name FROM products WHERE id=@product) AS product_name,
      (SELECT name FROM branches WHERE id=@branch) AS branch_name,
      (SELECT variant_product_id FROM product_batches WHERE id=@batch) AS lot_product_id,
      (SELECT unit_cost_usd FROM product_batches WHERE id=@batch) AS unit_cost_usd,
      (SELECT received_at FROM product_batches WHERE id=@batch) AS received_at,
      COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch),0) AS lot_quantity,
      COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0) AS branch_quantity,
      EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch) AS lot_exists,
      EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch) AS branch_exists`)
    .get<{ product_name: string | null; branch_name: string | null; lot_product_id: number | null; unit_cost_usd: number | null; received_at: string | null
      lot_quantity: number; branch_quantity: number; lot_exists: number; branch_exists: number }>({ product: request.productId, branch: request.branchId, batch: request.batchId })
  if (!facts?.product_name) return { status: 404, body: { error: 'Product not found' } }
  if (!facts.branch_name) return { status: 400, body: { error: 'An active branch is required before stock can be changed' } }
  if (Number(facts.lot_product_id) !== request.productId) return conflict('Selected received date does not belong to this product.', 'batch_mismatch')

  const before: Snapshot = {
    productId: request.productId, branchId: request.branchId, batchId: request.batchId,
    lotQuantity: Number(facts.lot_quantity) || 0, branchQuantity: Number(facts.branch_quantity) || 0,
    lotExists: Number(facts.lot_exists) ? 1 : 0, branchExists: Number(facts.branch_exists) ? 1 : 0,
  }
  if ((request.expectedLotQuantity !== undefined && request.expectedLotQuantity !== before.lotQuantity)
    || (request.expectedBranchQuantity !== undefined && request.expectedBranchQuantity !== before.branchQuantity)) {
    return conflict('Stock changed since this received date was loaded. Refresh and try again.')
  }
  const planned = snapshotAfter(before, request)
  if (!planned) return conflict('The selected received date does not have enough stock for this branch total.', 'selected_lot_unavailable')
  const { after, lotDelta } = planned
  if (request.conditionTag && lotDelta >= 0) {
    return { status: 400, body: { error: 'A condition tag can only be recorded when Set lowers stock.', code: 'set_tag_requires_decrease' } }
  }
  const base = {
    success: true, branchId: request.branchId, productId: request.productId, productName: facts.product_name,
    batchId: request.batchId, setScope: request.setScope, createdSibling: false,
  }
  if (lotDelta === 0) return { status: 200, body: { ...base, movementType: 'set', quantity: 0, before, after } }

  const effect: Effect = {
    productName: facts.product_name, branchName: facts.branch_name, unitCostUsd: facts.unit_cost_usd ?? null,
    lotDelta, tag: request.conditionTag, reason: `${request.reason} (${setNote(request)})`,
  }
  try { movementCost(effect) } catch { return { status: 400, body: { error: 'Movement cost is out of range' } } }
  const operationId = crypto.randomUUID()
  const movementType = lotDelta > 0 ? 'adjustment' : request.conditionTag ? 'damage_out' : 'remove'
  const payload = JSON.stringify({ applier: STOCK_LOT_SET_KIND, operation_id: operationId, generation: 0 })
  const response = {
    ...base, movementType, quantity: Math.abs(lotDelta), conditionTag: request.conditionTag,
    before, after, operation_id: recordOperation ? operationId : null, generation: 0, server_recorded: recordOperation,
  }
  const opParams = {
    operation: operationId, actor: user.id, actorName: actorSnapshot(user), requestId: operationRequestId, requestJson,
    digest: await digest(requestJson), response: JSON.stringify(response), before: JSON.stringify(before), after: JSON.stringify(after),
    // The lot cost captured at apply time: every later generation (undo and
    // redo) posts its movement at this same cost, not at an edited one.
    revision: JSON.stringify({ generation: 0, unitCostUsd: facts.unit_cost_usd ?? null }), payload, label: describe(request, facts.product_name, facts.received_at), product: request.productId,
  }
  const statements: Statement[] = [
    stateGuard(before),
    ...(recordOperation ? [{ sql: `INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json)
      VALUES(@operation,@actor,@requestId,@requestJson,@digest,@response,@before,@after,@revision)`, params: opParams }] : []),
    ...quantityStatements(before, after),
    ...forwardMovementStatements(before, effect, user, stockSetReference(operationId, 0), recordOperation ? operationId : null),
    ...(recordOperation ? [
      { sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
        VALUES('inventory','stock_quantity_set',@product,@label,1,'undoable',@payload,@payload,@actor,@actorName)`, params: opParams },
      { sql: `UPDATE stock_lot_adjustment_operations SET history_id=last_insert_rowid(),
        response_json=json_set(response_json,'$.action_history_id',last_insert_rowid()) WHERE id=@operation`, params: opParams },
    ] : []),
  ]
  await markWritten()
  try {
    await ordinaryBusinessBatch(db, statements)
  } catch (error) {
    if (recordOperation && requestId) {
      const concurrent = await previous()
      if (concurrent) return replay(concurrent)
    }
    if (isMaintenanceError(error)) return MAINTENANCE_RESPONSE
    return conflict('Stock changed while saving. No correction was applied; refresh and try again.')
  }
  if (!recordOperation) return { status: 200, body: response }
  const stored = await previous()
  return { status: 200, body: stored ? JSON.parse(stored.response_json) : response }
}

export async function notifyStockLotSet(env: Env): Promise<void> {
  await Promise.all([
    broadcast(env, 'products', { action: 'update' }),
    broadcast(env, 'inventory', { action: 'adjust' }),
    bumpVersion(env, 'products'),
  ])
}

export class StockLotSetReplayError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode = 409) {
    super(message)
    this.statusCode = statusCode
  }
}

/** Server-side undo/redo of one scoped Set generation. */
export async function replayStockLotSet(
  env: Env,
  user: SessionUser,
  direction: 'undo' | 'redo',
  historyId: number,
  generation: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  if (getActionTier(user, 'inventory', 'adjust') !== 'full') throw new StockLotSetReplayError('Stock adjustments require Full Access to Inventory.', 403)
  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM stock_lot_adjustment_operations WHERE id=@operation AND history_id=@history')
    .get<OperationRow>({ operation: String(payload.operation_id || ''), history: historyId })
  if (!row) throw new StockLotSetReplayError('This stock correction has no exact stock provenance.')
  // Older clients send no expected_generation; the payload's own generation is
  // then the expectation, still guarded against the row below.
  const expected = generation == null ? Number(payload.generation) : Number(generation)
  if (!Number.isSafeInteger(expected) || expected < 0) throw new StockLotSetReplayError('A stock correction generation is required.')
  const target = direction === 'undo' ? 'reversed' : 'applied'
  const oldState = direction === 'undo' ? 'applied' : 'reversed'
  const next = expected + 1
  if (row.generation === next && row.state === target) return
  if (row.generation !== expected || Number(payload.generation) !== expected || row.state !== oldState) {
    throw new StockLotSetReplayError('This stock correction generation is stale. Refresh its history.')
  }
  const request = JSON.parse(row.request_json) as StockLotSetRequest
  const before = JSON.parse(row.before_json) as Snapshot
  const after = JSON.parse(row.after_json) as Snapshot
  const revision = JSON.parse(row.revision_json || '{}') as { heldLotId?: number; unitCostUsd?: number | null }
  const from = direction === 'undo' ? after : before
  const to = direction === 'undo' ? before : after
  const facts = await db.prepare(`SELECT (SELECT name FROM products WHERE id=@product) AS product_name,
      (SELECT name FROM branches WHERE id=@branch) AS branch_name`)
    .get<{ product_name: string | null; branch_name: string | null }>({ product: before.productId, branch: before.branchId })
  const lotDelta = after.lotQuantity - before.lotQuantity
  const tagged = lotDelta < 0 && !!request.conditionTag
  const effect: Effect = {
    productName: facts?.product_name || `#${before.productId}`, branchName: facts?.branch_name ?? null,
    unitCostUsd: revision.unitCostUsd ?? null, lotDelta, tag: request.conditionTag,
    reason: `${direction === 'undo' ? 'Undo' : 'Redo'}: ${request.reason} (${setNote(request)})`,
  }
  if (direction === 'undo' && tagged && !(Number(revision.heldLotId) > 0)) {
    throw new StockLotSetReplayError('The held row of this correction is unknown, so it cannot be reversed exactly.')
  }
  const params = {
    operation: row.id, history: historyId, generation: expected, next, target, oldState,
    status: direction === 'undo' ? 'redoable' : 'undoable', oldStatus: direction === 'undo' ? 'undoable' : 'redoable',
    forward: stockSetReference(row.id, expected), heldLotId: Number(revision.heldLotId) || 0, held: Math.abs(lotDelta),
  }
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o JOIN action_history h ON h.id=o.history_id
      WHERE o.id=@operation AND h.id=@history AND o.generation=@generation AND o.state=@oldState AND h.status=@oldStatus
      AND json_extract(h.undo_payload,'$.operation_id')=@operation AND json_extract(h.undo_payload,'$.generation')=@generation)`, params),
    stateGuard(from),
  ]
  if (direction === 'undo') {
    // The counter-movement names the forward row it reverses: removalLosses.ts
    // then stops counting an undone loss, and does not count this row either.
    statements.push(guard('EXISTS(SELECT 1 FROM inventory_movements WHERE reference_id=@forward)', params))
    if (tagged) {
      statements.push(guard('(SELECT quantity_remaining FROM damaged_stock_lots WHERE id=@heldLotId)=@held', params))
      statements.push({ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining-@held, updated_at=CURRENT_TIMESTAMP WHERE id=@heldLotId AND quantity_remaining>=@held', params })
    }
    statements.push(...quantityStatements(from, to))
    statements.push(movementStatement({
      snapshot: before, effect, user, movementType: lotDelta > 0 ? 'remove' : 'adjustment', reason: effect.reason,
      referenceSql: "'revert:' || (SELECT id FROM inventory_movements WHERE reference_id=@forward ORDER BY id DESC LIMIT 1)",
      extra: { forward: params.forward },
    }))
  } else {
    statements.push(...quantityStatements(from, to))
    statements.push(...forwardMovementStatements(before, effect, user, stockSetReference(row.id, next), row.id))
  }
  statements.push(
    { sql: "UPDATE stock_lot_adjustment_operations SET generation=@next,state=@target,revision_json=json_set(revision_json,'$.generation',@next) WHERE id=@operation", params },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
      undo_payload=json_set(undo_payload,'$.generation',@next),redo_payload=json_set(redo_payload,'$.generation',@next) WHERE id=@history`, params },
  )
  try {
    await ordinaryBusinessBatch(db, statements)
  } catch (error) {
    const current = await db.prepare('SELECT generation,state FROM stock_lot_adjustment_operations WHERE id=@operation').get<OperationRow>({ operation: row.id })
    if (current?.generation === next && current.state === target) return
    if (isMaintenanceError(error)) throw new StockLotSetReplayError('Maintenance is in progress. Nothing was changed.', 503)
    throw new StockLotSetReplayError('Stock changed after this correction (a sale, transfer, count or tagged-row action). Nothing was changed.')
  }
}
