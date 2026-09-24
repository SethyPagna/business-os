// N6 (owner, 23 Sep 2026): "Stock-in sessions editable (today only add or
// delete)." The ONE writer that edits a saved stock-in line in place:
//
//   POST /api/inventory/stock-in-lines/:movementId/edit
//
// A "line" is a live receipt movement (movement_type 'add'/'stock_in' with a
// lot, not reverted) -- exactly the rows the Stock-in Sessions list shows. The
// root movement is never rewritten; an edit posts DELTA movements stamped
// `stock-in-edit:<root>:<operation>:<generation>` and every reader folds them
// into the line (lib/stockInSessionsQuery.ts). The operation row lives in the
// 0193 table (stock_lot_adjustment_operations): same shape as the scoped Set
// (exact before/after snapshots, UNIQUE(actor_id, request_id), generation),
// so no new migration was needed; request_json carries kind
// 'stock_in_line_edit' and the history applier is `stock.session_line_edit`.
//
// TRANSITION TABLE. q0/q1 = the line's quantity before/after, d = q1 - q0,
// A = the line's current lot, L = A's quantity at the line's branch,
// B = branch_stock, P = products.stock_quantity, u = the unit cost the line
// is priced at after the edit, T0/T1 = the line's recorded total before/after.
//
//   d > 0, same lot   A.L += d, A.received_quantity += d, A.received_cost += d*u
//                     B += d, P += d; movement 'add' +d at u (like the receipt)
//   d < 0, same lot   refused 409 below_consumed when L < |d| (units already
//                     sold or moved out); else A.L -= |d|, received figures
//                     -= |d| / |d|*u, B -= |d|, P -= |d|; movement 'remove'
//                     with NEGATIVE quantity -d (a correction: removalLosses.ts
//                     guard 2 excludes quantity <= 0, the precedent set by the
//                     stock-session UNDO in lib/stockSession.ts, which reverses
//                     a receipt with exactly such a row -- a data-entry fix is
//                     not destroyed goods)
//   cost u0 -> u1     only when A holds this line alone (no other live receipt,
//                     received_quantity = q0): A.unit_cost = u1,
//                     A.received_cost = q1*u1, catalog cost recomputed; the
//                     line total moves T0 -> q1*u1 by the quantity row plus, if
//                     needed, one 0-quantity 'adjustment' row carrying the
//                     remainder (a cost correction, never a loss)
//   supplier          only when A holds this line alone: A.supplier_* set
//   date, A alone     in place: A.received_at / lot_code (the PATCH /batches
//                     precedent: batch_key is a durable identity and stays)
//   date, A shared    MOVE: refused 409 move_consumed when L < q0; else
//                     A.L -= q0 and A's received figures lose q0 / T0, the lot
//                     T resolved by the receipt identity rule (date + cost,
//                     resolveReceiptLotTarget) gains q1 / q1*u (created if
//                     absent); movements 'remove' -q0 on A (negative, as above)
//                     then 'add' +q1 on T; refused 409 when T already holds a
//                     delivery from a different supplier
//   nothing changed   200 unchanged, no write
//
// B and P always move by exactly d; B + d < 0 is refused. Every edit is ONE
// ordinaryBusinessBatch guarded on the exact preimage of every row it writes,
// so it lands completely or not at all.
//
// UNDO / REDO (`stock.session_line_edit`): guarded on the CURRENT state
// equalling the snapshot it reverses from (a sale, transfer, count or a later
// edit in between refuses 409 and changes nothing), writes the other snapshot,
// posts the counter-rows of the generation under the NEXT generation's
// reference (so the line fold follows), restores the catalog cost only when it
// still holds the value this edit left, and advances the generation in the
// same batch so a stale history row can never apply twice.
import type { D1Compat } from './db'
import { getDb } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { canEditAcquisitionCosts } from './acquisitionCostAccess'
import { actorSnapshot } from './actorSnapshot'
import { ordinaryBusinessBatch } from './businessMaintenanceGuard'
import { dateToBatchCode, normalizeTypedDate } from './batchCode'
import { resolveReceiptLotTarget, type ReceiptLotCandidate, type StockWriteStatement } from './productBatches'
import { catalogCostRecomputeStatement } from './catalogCostRecompute'
import { STOCK_REASON_MAX_LENGTH, stockReasonTooLong } from './stockReason'
import { stockReceiptGateCode, stockReceiptGateMessage } from './stockReceiptGate'
import { divideMoney4, multiplyMoney4, roundMoney4, subtractMoney4, addMoney4 } from './moneyPrecision'
import {
  STOCK_RECEIPT_MOVEMENT_TYPES, STOCK_IN_EDIT_REFERENCE_PREFIX, stockInEditRange, stockInEditReference,
} from './stockInSessionsQuery'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'

export const STOCK_IN_LINE_EDIT_KIND = 'stock.session_line_edit'
const REQUEST_ID = /^[A-Za-z0-9_-]{8,120}$/
const MAX_QUANTITY = 1_000_000_000
const EPSILON = 0.00005

export type StockInLineEditResult = { status: number; body: Record<string, unknown> }
type Statement = StockWriteStatement
type Row = Record<string, unknown>

export type StockInLineEditRequest = {
  kind: 'stock_in_line_edit'
  movementId: number
  quantity: number
  unitCostUsd: number | null
  unitCostProvided: boolean
  freeGoods: boolean
  receivedDate: string | null
  supplierProvided: boolean
  supplierId: number | null
  supplierName: string | null
  reason: string | null
  expectedQuantity: number | null
  expectedBatchId: number | null
  expectedBatchRevision: number
}

/** One lot the edit writes, as absolute values (the guard pins them). */
export type LotState = {
  role: 'source' | 'target'
  id: number | null
  batchKey: string
  isActive: number
  receivedAt: string | null
  lotCode: string | null
  receivedQuantity: number | null
  receivedCostUsd: number | null
  unitCostUsd: number | null
  supplierId: number | null
  supplierName: string | null
  stock: number
  stockExists: number
}

export type EditState = {
  productId: number
  branchId: number
  branchQty: number
  branchExists: number
  lots: LotState[]
}

type MovementPlan = { type: 'add' | 'remove' | 'adjustment'; quantity: number; unitCostUsd: number | null; totalCostUsd: number | null; role: 'source' | 'target' }

type LineSnapshot = { quantity: number; unitCostUsd: number | null; totalCostUsd: number | null; receivedDate: string | null; supplierName: string | null; batchId: number | null }

type OperationRow = {
  id: string; request_json: string; response_json: string; before_json: string; after_json: string
  revision_json: string; history_id: number | null; generation: number; state: string
}

type Revision = {
  generation: number
  rootMovementId: number
  productId: number
  branchId: number
  productDelta: number
  movements: MovementPlan[]
  targetCreated: boolean
  targetBatchKey: string | null
  targetLotId?: number | null
  productCostBefore: { cost: number | null; purchase: number | null }
  productCostAfter?: { cost: number | null; purchase: number | null }
  lineBefore: LineSnapshot
  lineAfter: LineSnapshot
  requiresCostEdit: boolean
  reason: string
}

class EditRefusal extends Error {
  constructor(readonly status: number, message: string, readonly code: string, readonly details: Row = {}) { super(message) }
}
function refuse(status: number, message: string, code: string, details: Row = {}): never {
  throw new EditRefusal(status, message, code, details)
}

// A failed guard inserts 0 into stock_session_guards, whose CHECK(guard_value
// = 1) aborts the whole batch. Same helper shape as lib/stockLotAdjustment.ts.
function guard(condition: string, params: Row): Statement {
  return { sql: `INSERT INTO stock_session_guards(guard_value) SELECT 0 WHERE COALESCE((${condition}),0)=0`, params }
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function text(value: unknown): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : null
}
function sameMoney(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a == null && b == null
  return Math.abs(a - b) < EPSILON
}
function supplierKey(id: number | null, name: string | null): string {
  return id != null ? `id:${id}` : `name:${String(name || '').trim().toLowerCase()}`
}

let operationsReady = false
/** Test-only: forget the memoised 0193 probe. */
export function resetStockInLineEditSchemaProbe(): void { operationsReady = false }
async function operationsAvailable(db: D1Compat): Promise<boolean> {
  if (operationsReady) return true
  try {
    const row = await db.prepare("SELECT COUNT(*) AS ready FROM sqlite_master WHERE type='table' AND name='stock_lot_adjustment_operations'").get<{ ready: number }>()
    operationsReady = Number(row?.ready ?? 0) > 0
  } catch { operationsReady = false }
  return operationsReady
}

/** Parse and canonicalize the wire body. Canonical JSON is the idempotency fingerprint. */
export function parseStockInLineEditRequest(movementId: number, body: Row): StockInLineEditRequest {
  if (!Number.isSafeInteger(movementId) || movementId <= 0) refuse(400, 'A valid stock-in line is required.', 'invalid_request')
  const quantity = typeof body.quantity === 'number' ? body.quantity : NaN
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_QUANTITY) refuse(400, 'Quantity must be between 0 and 1,000,000,000.', 'invalid_quantity')
  const unitCostProvided = Object.prototype.hasOwnProperty.call(body, 'unit_cost_usd') && body.unit_cost_usd !== undefined
  let unitCostUsd: number | null = null
  if (unitCostProvided) {
    if (typeof body.unit_cost_usd !== 'number' || !Number.isFinite(body.unit_cost_usd) || body.unit_cost_usd < 0) {
      refuse(400, 'Unit cost must be zero or more.', 'invalid_unit_cost')
    }
    try { unitCostUsd = roundMoney4(body.unit_cost_usd as number); multiplyMoney4(unitCostUsd, quantity) } catch { refuse(400, 'Unit cost is out of range.', 'invalid_unit_cost') }
  }
  let receivedDate: string | null = null
  if (body.received_date != null && body.received_date !== '') {
    receivedDate = normalizeTypedDate(String(body.received_date))
    if (!receivedDate) refuse(400, 'Received date must be a valid date (dd/mm/yyyy).', 'invalid_received_date')
  }
  const supplierProvided = body.supplier_name !== undefined || body.supplier_id !== undefined
  const supplierName = supplierProvided ? text(body.supplier_name) : null
  if (supplierName && supplierName.length > 240) refuse(400, 'Supplier name is too long.', 'invalid_request')
  let supplierId: number | null = null
  if (supplierProvided && body.supplier_id != null) {
    if (typeof body.supplier_id !== 'number' || !Number.isSafeInteger(body.supplier_id) || body.supplier_id <= 0) refuse(400, 'supplier_id must be a positive integer.', 'invalid_request')
    supplierId = body.supplier_id as number
  }
  const reason = text(body.reason)
  if (stockReasonTooLong(reason)) refuse(400, `Reason is too long (max ${STOCK_REASON_MAX_LENGTH} characters).`, 'reason_too_long')
  const expectedQuantity = body.expected_quantity == null ? null : num(body.expected_quantity)
  const expectedBatchId = body.expected_batch_id == null ? null : num(body.expected_batch_id)
  const expectedBatchRevision = body.expected_batch_revision
  if (typeof expectedBatchRevision !== 'number' || !Number.isSafeInteger(expectedBatchRevision) || expectedBatchRevision < 0) {
    refuse(400, 'A nonnegative integer expected_batch_revision is required.', 'invalid_batch_revision')
  }
  return {
    kind: 'stock_in_line_edit', movementId, quantity, unitCostUsd, unitCostProvided, freeGoods: body.free_goods === true, receivedDate,
    supplierProvided, supplierId, supplierName, reason, expectedQuantity, expectedBatchId, expectedBatchRevision,
  }
}

type LotRow = {
  id: number; variant_product_id: number; batch_key: string; is_active: number | null; received_at: string | null; lot_code: string | null
  received_quantity: number | null; received_cost_usd: number | null; unit_cost_usd: number | null
  supplier_id: number | null; supplier_name: string | null; payment_status: string | null; credit_due_date: string | null
  expiry_date: string | null
}

function lotState(role: 'source' | 'target', lot: LotRow, stock: number, stockExists: number): LotState {
  return {
    role, id: Number(lot.id), batchKey: String(lot.batch_key), isActive: Number(lot.is_active) === 1 ? 1 : 0,
    receivedAt: lot.received_at == null ? null : String(lot.received_at), lotCode: lot.lot_code == null ? null : String(lot.lot_code),
    receivedQuantity: num(lot.received_quantity), receivedCostUsd: num(lot.received_cost_usd), unitCostUsd: num(lot.unit_cost_usd),
    supplierId: num(lot.supplier_id), supplierName: lot.supplier_name == null ? null : String(lot.supplier_name),
    stock, stockExists,
  }
}

// The state a target lot is left in when the edit that created it is undone:
// retained (movements reference it) but empty and inactive, with no attribution
// -- the same retention lib/stockSession.ts's undo gives a lot it created.
function retainedEmptyTarget(after: LotState): LotState {
  return { ...after, isActive: 0, receivedQuantity: 0, receivedCostUsd: null, unitCostUsd: null, supplierId: null, supplierName: null, stock: 0, stockExists: 0 }
}

const lotIdSql = (param: string) => `COALESCE(@${param}Id, (SELECT id FROM product_batches WHERE variant_product_id=@product AND batch_key=@${param}Key))`

function stateGuard(state: EditState, targetAbsent: boolean): Statement[] {
  const params: Row = { product: state.productId, branch: state.branchId, branchQty: state.branchQty, branchExists: state.branchExists }
  const out: Statement[] = [guard(`EXISTS(SELECT 1 FROM products WHERE id=@product)
    AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0)=@branchQty
    AND EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch)=@branchExists`, params)]
  for (const lot of state.lots) {
    if (lot.role === 'target' && targetAbsent) {
      out.push(guard('NOT EXISTS(SELECT 1 FROM product_batches WHERE variant_product_id=@product AND batch_key=@key)', { product: state.productId, key: lot.batchKey }))
      continue
    }
    out.push(guard(`EXISTS(SELECT 1 FROM product_batches WHERE id=@id AND variant_product_id=@product
        AND COALESCE(is_active,0)=@isActive AND received_at IS @receivedAt AND received_quantity IS @rq AND received_cost_usd IS @rc
        AND unit_cost_usd IS @unit AND supplier_id IS @sid AND supplier_name IS @sname)
      AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@id AND branch_id=@branch),0)=@stock
      AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@id AND branch_id=@branch)=@stockExists`, {
      id: lot.id, product: state.productId, branch: state.branchId, isActive: lot.isActive, receivedAt: lot.receivedAt,
      rq: lot.receivedQuantity, rc: lot.receivedCostUsd, unit: lot.unitCostUsd, sid: lot.supplierId, sname: lot.supplierName,
      stock: lot.stock, stockExists: lot.stockExists,
    }))
  }
  return out
}

// Absolute writes are exact because stateGuard pinned the preimage in the same
// transaction. Order respects migration 0154 (positive lot stock needs an
// active lot): activate, move stock, then deactivate.
function stateWrites(to: EditState, productDelta: number): Statement[] {
  const out: Statement[] = []
  const lotParams = (lot: LotState) => ({
    product: to.productId, branch: to.branchId, lotId: lot.id, lotKey: lot.batchKey,
    isActive: lot.isActive, receivedAt: lot.receivedAt, lotCode: lot.lotCode, rq: lot.receivedQuantity, rc: lot.receivedCostUsd,
    unit: lot.unitCostUsd, sid: lot.supplierId, sname: lot.supplierName, stock: lot.stock, stockExists: lot.stockExists,
  })
  for (const lot of to.lots) {
    out.push({ sql: `UPDATE product_batches SET is_active=CASE WHEN @isActive=1 THEN 1 ELSE is_active END,
        received_at=@receivedAt, lot_code=@lotCode, received_quantity=@rq, received_cost_usd=@rc, unit_cost_usd=@unit,
        supplier_id=@sid, supplier_name=@sname, updated_at=CURRENT_TIMESTAMP
      WHERE id=${lotIdSql('lot')}`, params: lotParams(lot) })
  }
  for (const lot of to.lots) {
    out.push({ sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT ${lotIdSql('lot')},@branch,@stock WHERE @stockExists=1
      ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity, updated_at=CURRENT_TIMESTAMP`, params: lotParams(lot) })
    out.push({ sql: `DELETE FROM branch_batch_stock WHERE batch_id=${lotIdSql('lot')} AND branch_id=@branch AND @stockExists=0`, params: lotParams(lot) })
  }
  const branchParams = { product: to.productId, branch: to.branchId, branchQty: to.branchQty, branchExists: to.branchExists, productDelta }
  out.push({ sql: `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT @product,@branch,@branchQty WHERE @branchExists=1
    ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=excluded.quantity`, params: branchParams })
  out.push({ sql: 'DELETE FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND @branchExists=0', params: branchParams })
  out.push({ sql: 'UPDATE products SET stock_quantity=COALESCE(stock_quantity,0)+@productDelta, updated_at=CURRENT_TIMESTAMP WHERE id=@product AND @productDelta<>0', params: branchParams })
  for (const lot of to.lots) {
    if (lot.isActive === 0) out.push({ sql: `UPDATE product_batches SET is_active=0 WHERE id=${lotIdSql('lot')}`, params: lotParams(lot) })
  }
  return out
}

function movementStatements(input: {
  plans: MovementPlan[]; state: EditState; lotIds: Record<'source' | 'target', { id: number | null; key: string }>
  reference: string; reason: string; user: SessionUser; productName: string; branchName: string | null
}): Statement[] {
  return input.plans.map((plan) => {
    const lot = input.lotIds[plan.role]
    return {
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,
          unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,created_at,batch_id)
        VALUES(@product,@productName,@branch,@branchName,@type,@quantity,@unit,0,@total,CASE WHEN @total IS NULL THEN NULL ELSE 0 END,
          @reason,@reference,@userId,@userName,CURRENT_TIMESTAMP,${lotIdSql('lot')})`,
      params: {
        product: input.state.productId, productName: input.productName, branch: input.state.branchId, branchName: input.branchName,
        type: plan.type, quantity: plan.quantity, unit: plan.unitCostUsd, total: plan.totalCostUsd, reason: input.reason,
        reference: input.reference, userId: input.user.id ?? null, userName: actorSnapshot(input.user), lotId: lot.id, lotKey: lot.key,
      },
    }
  })
}

// The counter-rows of one generation, newest first so the last positive row
// names the lot the line returns to (the fold's "current lot" rule).
function counterPlans(plans: MovementPlan[]): MovementPlan[] {
  return [...plans].reverse().map((plan) => ({
    ...plan,
    type: plan.type === 'adjustment' ? 'adjustment' : plan.quantity > 0 ? 'remove' : 'add',
    quantity: plan.quantity === 0 ? 0 : -plan.quantity,
    totalCostUsd: plan.totalCostUsd == null ? null : roundMoney4(-plan.totalCostUsd),
  }))
}

async function digest(textValue: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(textValue))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isMaintenanceError(error: unknown): boolean {
  return /ordinary_business_maintenance_active/.test(error instanceof Error ? error.message : String(error))
}

/**
 * Apply one line edit. Worker enforcement: Full inventory adjust (the gate
 * every stock-in writer uses) and, for a cost, the cost-entry permission that
 * stock-in creation demands (lib/acquisitionCostAccess.ts).
 */
export async function applyStockInLineEdit(
  db: D1Compat, user: SessionUser, movementId: number, body: Row,
): Promise<StockInLineEditResult> {
  try {
    return await applyInner(db, user, movementId, body)
  } catch (error) {
    if (error instanceof EditRefusal) return { status: error.status, body: { error: error.message, code: error.code, ...error.details } }
    throw error
  }
}

async function applyInner(db: D1Compat, user: SessionUser, movementId: number, body: Row): Promise<StockInLineEditResult> {
  const tier = getActionTier(user, 'inventory', 'adjust')
  if (tier !== 'full') refuse(403, 'Editing a stock-in line requires Full Access to adjust inventory.', 'permission_denied')
  const request = parseStockInLineEditRequest(movementId, body)
  if (request.unitCostProvided && !canEditAcquisitionCosts(user)) {
    refuse(403, 'Cost-entry permission is required to change receipt costs.', 'product_cost_edit_required')
  }
  const requestId = String(body.client_request_id ?? '').trim()
  if (!REQUEST_ID.test(requestId)) refuse(400, 'A stable client_request_id (8-120 letters, digits, "-" or "_") is required.', 'invalid_client_request_id')
  if (!await operationsAvailable(db)) refuse(503, 'Stock-in line editing needs migration 0193. Nothing was changed.', 'migration_required')

  const requestJson = JSON.stringify(request)
  const previous = () => db.prepare('SELECT * FROM stock_lot_adjustment_operations WHERE actor_id=@actor AND request_id=@request')
    .get<OperationRow>({ actor: user.id, request: requestId })
  const replay = (row: OperationRow): StockInLineEditResult => row.request_json !== requestJson
    ? { status: 409, body: { error: 'client_request_id was already used for a different edit.', code: 'idempotency_conflict' } }
    : { status: 200, body: { ...JSON.parse(row.response_json), replayed: true } }
  const existing = await previous()
  if (existing) return replay(existing)

  // ---- The root line and its current folded state.
  const root = await db.prepare(`SELECT m.*, EXISTS(SELECT 1 FROM inventory_movements r WHERE r.reference_id='revert:' || CAST(m.id AS TEXT)) AS reverted
      FROM inventory_movements m WHERE m.id=@id`).get<Row>({ id: movementId })
  const reference = String(root?.reference_id ?? '')
  if (!root || !(STOCK_RECEIPT_MOVEMENT_TYPES as readonly string[]).includes(String(root.movement_type))
    || !(Number(root.batch_id) > 0) || !(Number(root.branch_id) > 0) || !(Math.abs(Number(root.quantity) || 0) > 0)
    || reference.startsWith('revert:') || reference.startsWith(STOCK_IN_EDIT_REFERENCE_PREFIX) || Number(root.reverted) === 1) {
    refuse(409, 'This line is not a saved received line, or it was already removed.', 'line_not_editable')
  }
  // A session that was undone no longer holds its stock; a row written by a
  // session's undo/redo is not a receipt line either (same test stockRevert.ts
  // applies before reverting one).
  if (/^\d+$/.test(reference)) {
    const session = await db.prepare(`SELECT o.id, o.generation,
        EXISTS(SELECT 1 FROM stock_session_members sm WHERE sm.movement_id=@movement) AS is_member
      FROM stock_session_operations o WHERE o.rowid=@rowid`).get<Row>({ rowid: Number(reference), movement: movementId })
    if (session && (Number(session.is_member) !== 1 || Number(session.generation) % 2 === 1)) {
      refuse(409, 'This stock-in session was undone. Redo it first, then edit the line.', 'session_undone')
    }
  }
  const productId = Number(root.product_id)
  const branchId = Number(root.branch_id)
  const range = stockInEditRange(movementId)
  const edits = await db.prepare(`SELECT id, quantity, total_cost_usd, batch_id FROM inventory_movements
      WHERE reference_id >= @lo AND reference_id < @hi ORDER BY id`).all<Row>(range)
  const q0 = Math.abs(Number(root.quantity)) + edits.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)
  const lastIn = [...edits].reverse().find((row) => Number(row.quantity) > 0)
  const sourceId = Number(lastIn?.batch_id ?? root.batch_id)
  const costRows = edits.filter((row) => row.total_cost_usd != null)
  const t0 = root.total_cost_usd == null && costRows.length === 0
    ? null
    : roundMoney4((num(root.total_cost_usd) ?? 0) + costRows.reduce((sum, row) => sum + Number(row.total_cost_usd), 0))
  if ((request.expectedQuantity != null && Math.abs(request.expectedQuantity - q0) > 1e-9)
    || (request.expectedBatchId != null && request.expectedBatchId !== sourceId)) {
    refuse(409, 'This line changed since it was opened. Reopen the session and try again.', 'stale_line')
  }

  const [facts, sourceLot, lots, baseline, receiptsElsewhere] = await Promise.all([
    db.prepare(`SELECT (SELECT name FROM products WHERE id=@product) AS product_name,
        (SELECT cost_price_usd FROM products WHERE id=@product) AS cost_price_usd,
        (SELECT purchase_price_usd FROM products WHERE id=@product) AS purchase_price_usd,
        (SELECT name FROM branches WHERE id=@branch) AS branch_name,
        COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0) AS branch_qty,
        EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch) AS branch_exists`)
      .get<Row>({ product: productId, branch: branchId }),
    db.prepare(`SELECT b.*, COALESCE((SELECT revision FROM stock_session_revisions
      WHERE entity_type='batch' AND entity_key=CAST(b.id AS TEXT)),0) AS batch_revision
      FROM product_batches b WHERE b.id=@id`).get<LotRow & { batch_revision: number }>({ id: sourceId }),
    db.prepare('SELECT id,batch_key,received_at,unit_cost_usd FROM product_batches WHERE variant_product_id=@product').all<ReceiptLotCandidate>({ product: productId }),
    db.prepare('SELECT baseline_batch_id FROM product_cost_entries WHERE product_id=@product ORDER BY id DESC LIMIT 1').get<Row>({ product: productId }).catch(() => null),
    // Other live receipts into the line's current lot (any line but this one).
    db.prepare(`SELECT COUNT(*) AS n FROM inventory_movements x
        WHERE x.batch_id=@lot AND x.movement_type IN ('add','stock_in') AND x.id<>@root AND x.quantity > 0
          AND NOT (x.reference_id >= @lo AND x.reference_id < @hi)
          AND NOT EXISTS(SELECT 1 FROM inventory_movements r WHERE r.reference_id='revert:' || CAST(x.id AS TEXT))`)
      .get<Row>({ lot: sourceId, root: movementId, ...range }),
  ])
  if (!facts?.product_name) refuse(404, 'Product not found.', 'product_not_found')
  if (!sourceLot || Number(sourceLot.variant_product_id) !== productId) refuse(409, 'The received date of this line no longer belongs to its product.', 'batch_mismatch')
  if (sourceLot.batch_revision !== request.expectedBatchRevision) {
    refuse(409, 'This line changed since it was opened. Reopen the session and try again.', 'stale_line')
  }
  const sourceStock = await db.prepare(`SELECT COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@lot AND branch_id=@branch),0) AS qty,
      EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@lot AND branch_id=@branch) AS present,
      COALESCE((SELECT SUM(quantity) FROM branch_batch_stock WHERE batch_id=@lot AND branch_id<>@branch),0) AS elsewhere`)
    .get<Row>({ lot: sourceId, branch: branchId })
  const L = Number(sourceStock?.qty) || 0
  const A = lotState('source', sourceLot, L, Number(sourceStock?.present) ? 1 : 0)
  const exclusive = Number(receiptsElsewhere?.n) === 0 && (A.receivedQuantity == null || Math.abs(A.receivedQuantity - q0) < 1e-9)

  // ---- What changes.
  const q1 = request.quantity
  const d = q1 - q0
  let supplier = { id: A.supplierId, name: A.supplierName }
  if (request.supplierProvided) {
    if (request.supplierId != null) {
      const row = await db.prepare('SELECT id,name FROM suppliers WHERE id=@id').get<Row>({ id: request.supplierId })
      if (!row) refuse(404, `Supplier ${request.supplierId} was not found.`, 'supplier_not_found')
      if (request.supplierName && String(row.name || '').trim().toLowerCase() !== request.supplierName.toLowerCase()) {
        refuse(409, `Supplier ${request.supplierId} does not match supplier_name.`, 'supplier_mismatch')
      }
      supplier = { id: Number(row.id), name: String(row.name || '').trim() || null }
    } else {
      supplier = { id: null, name: request.supplierName }
    }
  }
  const supplierChanged = request.supplierProvided && supplierKey(supplier.id, supplier.name) !== supplierKey(A.supplierId, A.supplierName)
  const costChanged = request.unitCostProvided && !sameMoney(request.unitCostUsd, A.unitCostUsd)
  const sourceDate = A.receivedAt ? String(A.receivedAt).slice(0, 10) : null
  const dateChanged = request.receivedDate != null && request.receivedDate !== sourceDate
  // The receipt gate (lib/stockReceiptGate.ts, the kernel every stock-in wire
  // runs) on exactly the fields this edit changes: an edit can never clear a
  // receipt's supplier, nor turn it into a $0.00 receipt nobody declared free.
  // An unchanged legacy field is left as it was saved.
  if (supplierChanged && q1 > 0) {
    const gate = stockReceiptGateCode({ isStockIn: true, supplierName: supplier.name, unitCostUsd: 1, freeGoods: false })
    if (gate) refuse(400, stockReceiptGateMessage(gate) as string, gate)
  }
  if (costChanged && q1 > 0) {
    const gate = stockReceiptGateCode({ isStockIn: true, supplierName: 'recorded', unitCostUsd: request.unitCostUsd, freeGoods: request.freeGoods })
    if (gate) refuse(400, stockReceiptGateMessage(gate) as string, gate)
  }
  if (d === 0 && !supplierChanged && !costChanged && !dateChanged) {
    return { status: 200, body: { success: true, unchanged: true, movementId, productId } }
  }
  if (!exclusive && (costChanged || supplierChanged) && !dateChanged) {
    refuse(409, 'This received date also holds another receipt, so its cost or supplier cannot be changed from one line. Change the received date too, or edit the lot itself.', 'shared_lot')
  }
  const move = dateChanged && !exclusive && q1 > 0
  const inPlaceDate = dateChanged && exclusive
  // The unit cost the line is priced at after the edit.
  const legacyUnit = t0 != null && q0 > 0 ? divideMoney4(t0, q0) : null
  const u = costChanged ? request.unitCostUsd : (A.unitCostUsd ?? legacyUnit)

  const B = Number(facts.branch_qty) || 0
  const branchAfter = B + d
  if (move && L < q0) {
    refuse(409, `${q0 - L} of these units were already sold or moved out of this received date, so the line cannot move to another date. Change the quantity or cost only.`, 'move_consumed', { consumed: q0 - L })
  }
  if (!move && d < 0 && L < -d) {
    const minimum = Math.max(0, q0 - L)
    refuse(409, `${q0 - L} of these units were already sold or moved out of this received date. The lowest quantity allowed is ${minimum}.`, 'below_consumed', { minimum, consumed: q0 - L })
  }
  // The lot guard above is the specific answer; this is the drifted-aggregate backstop.
  if (branchAfter < 0) refuse(409, 'The branch does not hold enough of this product for that quantity.', 'branch_below_zero')

  // ---- Snapshots.
  const before: EditState = { productId, branchId, branchQty: B, branchExists: Number(facts.branch_exists) ? 1 : 0, lots: [A] }
  const after: EditState = { productId, branchId, branchQty: branchAfter, branchExists: before.branchExists || (branchAfter > 0 ? 1 : 0), lots: [] }
  const plans: MovementPlan[] = []
  let targetCreated = false
  let targetKey: string | null = null
  let t1: number | null
  if (move) {
    // Resolve the receiving lot exactly as a fresh receipt would.
    const target = (() => {
      try {
        return resolveReceiptLotTarget(lots.filter((lot) => Number(lot.id) !== A.id), request.receivedDate as string, u, Number(baseline?.baseline_batch_id) || 0)
      } catch { return refuse(409, 'The receiving received date could not be resolved. Refresh and retry.', 'target_unresolved') }
    })()
    targetKey = target.batchKey
    let T: LotState
    if (target.existingBatchId != null) {
      const [lotRow, stockRow] = await Promise.all([
        db.prepare('SELECT * FROM product_batches WHERE id=@id').get<LotRow>({ id: target.existingBatchId }),
        db.prepare(`SELECT COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@lot AND branch_id=@branch),0) AS qty,
          EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@lot AND branch_id=@branch) AS present`).get<Row>({ lot: target.existingBatchId, branch: branchId }),
      ])
      if (!lotRow) refuse(409, 'The receiving received date changed. Refresh and retry.', 'target_unresolved')
      T = lotState('target', lotRow, Number(stockRow?.qty) || 0, Number(stockRow?.present) ? 1 : 0)
      if ((T.supplierId != null || T.supplierName) && supplierKey(T.supplierId, T.supplierName) !== supplierKey(supplier.id, supplier.name)) {
        refuse(409, `That received date already holds a delivery from ${T.supplierName || 'another supplier'} at this cost. Choose another date or supplier.`, 'target_other_supplier')
      }
    } else {
      targetCreated = true
      T = {
        role: 'target', id: null, batchKey: target.batchKey, isActive: 0, receivedAt: request.receivedDate, lotCode: dateToBatchCode(request.receivedDate) as string,
        receivedQuantity: 0, receivedCostUsd: null, unitCostUsd: null, supplierId: null, supplierName: null, stock: 0, stockExists: 0,
      }
    }
    before.lots.push(T)
    const aRq = A.receivedQuantity == null ? null : Math.max(0, A.receivedQuantity - q0)
    const aRc = A.receivedCostUsd == null ? null : Math.max(0, subtractMoney4(A.receivedCostUsd, t0 ?? (A.unitCostUsd != null ? multiplyMoney4(A.unitCostUsd, q0) : 0)))
    const aStock = L - q0
    after.lots.push({ ...A, stock: aStock, receivedQuantity: aRq, receivedCostUsd: aRq === 0 ? (aRc == null ? null : 0) : aRc,
      isActive: aRq === 0 && aStock <= 0 && Number(sourceStock?.elsewhere || 0) <= 0 ? 0 : A.isActive })
    const lineCost = u == null ? null : multiplyMoney4(u, q1)
    after.lots.push({
      ...T, isActive: 1, stock: T.stock + q1, stockExists: 1,
      receivedQuantity: (T.receivedQuantity ?? 0) + q1,
      receivedCostUsd: lineCost == null ? T.receivedCostUsd : addMoney4(T.receivedCostUsd ?? 0, lineCost),
      unitCostUsd: targetCreated ? u : T.unitCostUsd,
      supplierId: T.supplierId ?? supplier.id, supplierName: T.supplierName ?? supplier.name,
    })
    // An unrecorded line cost stays unrecorded unless the edit sets one.
    const recordTotals = t0 != null || costChanged
    plans.push({ type: 'remove', quantity: -q0, unitCostUsd: A.unitCostUsd, totalCostUsd: t0 == null ? null : roundMoney4(-t0), role: 'source' })
    plans.push({ type: 'add', quantity: q1, unitCostUsd: u, totalCostUsd: recordTotals && lineCost != null ? lineCost : null, role: 'target' })
    t1 = recordTotals && lineCost != null ? lineCost : null
  } else {
    const stock = L + d
    const rq = A.receivedQuantity == null ? null : Math.max(0, A.receivedQuantity + d)
    let rc = A.receivedCostUsd
    let qtyTotal: number | null = null
    let remainder: number | null = null
    if (costChanged) {
      // The lot is this line's alone: its money is exactly the line's.
      const lineCost = multiplyMoney4(u as number, q1)
      rc = lineCost
      qtyTotal = d === 0 ? null : multiplyMoney4(u as number, d)
      remainder = roundMoney4(lineCost - (t0 ?? 0) - (qtyTotal ?? 0))
      t1 = lineCost
    } else {
      if (u != null && rc != null) rc = Math.max(0, addMoney4(rc, multiplyMoney4(u, d)))
      qtyTotal = t0 != null && u != null && d !== 0 ? multiplyMoney4(u, d) : null
      t1 = t0 == null ? null : roundMoney4(t0 + (qtyTotal ?? 0))
    }
    after.lots.push({
      ...A, stock, stockExists: A.stockExists || (stock > 0 ? 1 : 0), receivedQuantity: rq, receivedCostUsd: rc,
      unitCostUsd: costChanged ? u : A.unitCostUsd,
      supplierId: supplierChanged ? supplier.id : A.supplierId, supplierName: supplierChanged ? supplier.name : A.supplierName,
      receivedAt: inPlaceDate ? request.receivedDate : A.receivedAt,
      lotCode: inPlaceDate ? dateToBatchCode(request.receivedDate) : A.lotCode,
      isActive: stock > 0 ? 1 : A.isActive,
    })
    if (d > 0) plans.push({ type: 'add', quantity: d, unitCostUsd: u, totalCostUsd: qtyTotal, role: 'source' })
    if (d < 0) plans.push({ type: 'remove', quantity: d, unitCostUsd: u, totalCostUsd: qtyTotal, role: 'source' })
    if (remainder != null && Math.abs(remainder) >= EPSILON) plans.push({ type: 'adjustment', quantity: 0, unitCostUsd: u, totalCostUsd: remainder, role: 'source' })
  }

  const receivedAfter = move ? request.receivedDate : inPlaceDate ? request.receivedDate : sourceDate
  const lineBefore: LineSnapshot = { quantity: q0, unitCostUsd: A.unitCostUsd ?? legacyUnit, totalCostUsd: t0, receivedDate: sourceDate, supplierName: A.supplierName, batchId: A.id }
  const lineAfter: LineSnapshot = {
    quantity: q1, unitCostUsd: u ?? null, totalCostUsd: t1, receivedDate: receivedAfter,
    supplierName: move ? (after.lots[1].supplierName) : (supplierChanged ? supplier.name : A.supplierName), batchId: move ? null : A.id,
  }
  const operationId = crypto.randomUUID()
  const reasonText = `Edit of stock-in line #${movementId}${request.reason ? `: ${request.reason}` : ''}`
  const revision: Revision = {
    generation: 0, rootMovementId: movementId, productId, branchId, productDelta: d, movements: plans,
    targetCreated, targetBatchKey: targetKey, productCostBefore: { cost: num(facts.cost_price_usd), purchase: num(facts.purchase_price_usd) },
    lineBefore, lineAfter, requiresCostEdit: request.unitCostProvided, reason: reasonText,
  }
  const payload = JSON.stringify({ applier: STOCK_IN_LINE_EDIT_KIND, operation_id: operationId, generation: 0, requires_cost_edit: request.unitCostProvided ? 1 : 0 })
  const label = `Edit stock-in line: ${String(facts.product_name)} (${q0} → ${q1})`
  const response = {
    success: true, operation_id: operationId, generation: 0, movementId, productId, branchId,
    before: lineBefore, after: lineAfter, movements: plans.length,
  }
  const lotIds = {
    source: { id: A.id, key: A.batchKey },
    target: { id: targetCreated ? null : (before.lots[1]?.id ?? null), key: targetKey ?? A.batchKey },
  }
  const opParams = {
    operation: operationId, actor: user.id, actorName: actorSnapshot(user), requestId, requestJson, digest: await digest(requestJson),
    response: JSON.stringify(response), before: JSON.stringify(before), after: JSON.stringify(after), revision: JSON.stringify(revision),
    payload, label, product: productId, targetKey,
  }
  const auditChange = {
    before: { quantity: q0, unit_cost_usd: lineBefore.unitCostUsd, received_date: lineBefore.receivedDate, supplier_name: lineBefore.supplierName },
    after: { quantity: q1, unit_cost_usd: lineAfter.unitCostUsd, received_date: lineAfter.receivedDate, supplier_name: lineAfter.supplierName },
  }
  const created = targetCreated ? after.lots[1] : null
  const statements: Statement[] = [
    // 0124 retains a revision on EVERY lot mutation, including same-second
    // changes and changes restored to their old values. Pin the review, not
    // just the newer snapshot we happened to read while planning this write.
    guard(`COALESCE((SELECT revision FROM stock_session_revisions
      WHERE entity_type='batch' AND entity_key=@batchKey),0)=@revision`,
    { batchKey: String(sourceId), revision: request.expectedBatchRevision }),
    ...stateGuard(before, targetCreated),
    { sql: `INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json)
      VALUES(@operation,@actor,@requestId,@requestJson,@digest,@response,@before,@after,@revision)`, params: opParams },
    ...(created ? [{
      sql: `INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,supplier_id,supplier_name,
          unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd,expiry_date)
        VALUES(@product,@key,@lotCode,@receivedAt,0,(SELECT COALESCE(MAX(batch_number),0)+1 FROM product_batches WHERE variant_product_id=@product),
          NULL,NULL,NULL,@paymentStatus,@creditDueDate,0,@branch,NULL,@expiry)`,
      params: {
        product: productId, key: created.batchKey, lotCode: created.lotCode, receivedAt: created.receivedAt, branch: branchId,
        paymentStatus: sourceLot.payment_status ?? null, creditDueDate: sourceLot.credit_due_date ?? null, expiry: sourceLot.expiry_date ?? null,
      },
    }, {
      sql: "UPDATE stock_lot_adjustment_operations SET revision_json=json_set(revision_json,'$.targetLotId',(SELECT id FROM product_batches WHERE variant_product_id=@product AND batch_key=@targetKey)) WHERE id=@operation",
      params: opParams,
    }] : []),
    ...stateWrites(after, d),
    catalogCostRecomputeStatement(productId),
    { sql: `UPDATE stock_lot_adjustment_operations SET revision_json=json_set(revision_json,'$.productCostAfter',
        json_object('cost',(SELECT cost_price_usd FROM products WHERE id=@product),'purchase',(SELECT purchase_price_usd FROM products WHERE id=@product))) WHERE id=@operation`, params: opParams },
    ...movementStatements({ plans, state: after, lotIds, reference: stockInEditReference(movementId, operationId, 0), reason: reasonText, user, productName: String(facts.product_name), branchName: facts.branch_name == null ? null : String(facts.branch_name) }),
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
      VALUES('inventory','stock_in_line_edit',@product,@label,1,'undoable',@payload,@payload,@actor,@actorName)`, params: opParams },
    { sql: `UPDATE stock_lot_adjustment_operations SET history_id=last_insert_rowid(),
      response_json=json_set(response_json,'$.action_history_id',last_insert_rowid()) WHERE id=@operation`, params: opParams },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
      VALUES(@actor,@actorName,'stock_in_line_edit','product',@entityId,@details,'inventory_movements',@root,@oldValue,@newValue)`, params: {
      actor: user.id ?? null, actorName: actorSnapshot(user), entityId: String(productId), root: movementId,
      details: JSON.stringify({ operationId, movementId, branchId, reason: request.reason, moved: move }),
      oldValue: JSON.stringify(auditChange.before), newValue: JSON.stringify(auditChange.after),
    } },
  ]
  try {
    await ordinaryBusinessBatch(db, statements)
  } catch (error) {
    const concurrent = await previous()
    if (concurrent) return replay(concurrent)
    if (isMaintenanceError(error)) return { status: 503, body: { error: 'Maintenance is in progress. Nothing was changed; try again shortly.', code: 'maintenance_active' } }
    if (/constraint/i.test(String(error))) return { status: 409, body: { error: 'Stock changed while saving. Nothing was changed; reopen the session and try again.', code: 'stale_state' } }
    throw error
  }
  const stored = await previous()
  return { status: 200, body: stored ? JSON.parse(stored.response_json) : response }
}

export async function notifyStockInLineEdit(env: Env): Promise<void> {
  await Promise.allSettled([
    broadcast(env, 'products', { action: 'update' }),
    broadcast(env, 'inventory', { action: 'adjust' }),
    bumpVersion(env, 'products'),
  ])
}

export class StockInLineEditReplayError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message) }
}

/** Server-side undo/redo of one line-edit generation. */
export async function replayStockInLineEdit(
  env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row,
): Promise<void> {
  if (getActionTier(user, 'inventory', 'adjust') !== 'full') throw new StockInLineEditReplayError('Editing a stock-in line requires Full Access to adjust inventory.', 403)
  if (Number(payload.requires_cost_edit) === 1 && !canEditAcquisitionCosts(user)) throw new StockInLineEditReplayError('Cost-entry permission is required to reverse a cost change.', 403)
  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM stock_lot_adjustment_operations WHERE id=@operation AND history_id=@history')
    .get<OperationRow>({ operation: String(payload.operation_id || ''), history: historyId })
  if (!row) throw new StockInLineEditReplayError('This stock-in line edit has no exact stock provenance.')
  const expected = generation == null ? Number(payload.generation) : Number(generation)
  if (!Number.isSafeInteger(expected) || expected < 0) throw new StockInLineEditReplayError('A stock-in line edit generation is required.')
  const target = direction === 'undo' ? 'reversed' : 'applied'
  const oldState = direction === 'undo' ? 'applied' : 'reversed'
  const next = expected + 1
  if (row.generation === next && row.state === target) return
  if (row.generation !== expected || Number(payload.generation) !== expected || row.state !== oldState) {
    throw new StockInLineEditReplayError('This stock-in line edit generation is stale. Refresh its history.')
  }
  const revision = JSON.parse(row.revision_json) as Revision
  const forwardBefore = JSON.parse(row.before_json) as EditState
  const forwardAfter = JSON.parse(row.after_json) as EditState
  const targetLotId = revision.targetCreated ? Number(revision.targetLotId) || null : null
  if (revision.targetCreated && !targetLotId) throw new StockInLineEditReplayError('The received date this edit created is unknown, so it cannot be reversed exactly.')
  // A target the forward write created is retained, empty, after an undo.
  const withIds = (state: EditState, retainTarget: boolean): EditState => ({
    ...state,
    lots: state.lots.map((lot) => lot.role === 'target' && revision.targetCreated
      ? { ...(retainTarget ? retainedEmptyTarget(forwardAfter.lots.find((l) => l.role === 'target') as LotState) : lot), id: targetLotId }
      : lot),
  })
  const beforeState = withIds(forwardBefore, true)
  const afterState = withIds(forwardAfter, false)
  const from = direction === 'undo' ? afterState : beforeState
  const to = direction === 'undo' ? beforeState : afterState
  const productDelta = direction === 'undo' ? -revision.productDelta : revision.productDelta
  const plans = direction === 'undo' ? counterPlans(revision.movements) : revision.movements
  const costFrom = direction === 'undo' ? revision.productCostAfter : revision.productCostBefore
  const costTo = direction === 'undo' ? revision.productCostBefore : revision.productCostAfter
  const facts = await db.prepare(`SELECT (SELECT name FROM products WHERE id=@product) AS product_name, (SELECT name FROM branches WHERE id=@branch) AS branch_name`)
    .get<Row>({ product: revision.productId, branch: revision.branchId })
  const source = forwardBefore.lots.find((lot) => lot.role === 'source') as LotState
  const lotIds = {
    source: { id: source.id, key: source.batchKey },
    target: { id: targetLotId ?? forwardBefore.lots.find((lot) => lot.role === 'target')?.id ?? null, key: revision.targetBatchKey ?? source.batchKey },
  }
  const params = {
    operation: row.id, history: historyId, generation: expected, next, target, oldState,
    status: direction === 'undo' ? 'redoable' : 'undoable', oldStatus: direction === 'undo' ? 'undoable' : 'redoable',
    product: revision.productId, costFrom: costFrom?.cost ?? null, purchaseFrom: costFrom?.purchase ?? null,
    costTo: costTo?.cost ?? null, purchaseTo: costTo?.purchase ?? null,
  }
  const lineFrom = direction === 'undo' ? revision.lineAfter : revision.lineBefore
  const lineTo = direction === 'undo' ? revision.lineBefore : revision.lineAfter
  const statements: Statement[] = [
    guard(`EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o JOIN action_history h ON h.id=o.history_id
      WHERE o.id=@operation AND h.id=@history AND o.generation=@generation AND o.state=@oldState AND h.status=@oldStatus
      AND json_extract(h.undo_payload,'$.operation_id')=@operation AND json_extract(h.undo_payload,'$.generation')=@generation)`, params),
    ...stateGuard(from, false),
    ...stateWrites(to, productDelta),
    // Restore the catalog cost only while it still holds the value this
    // generation left; a later receipt's recompute is never clobbered.
    ...(costFrom && costTo ? [{ sql: `UPDATE products SET cost_price_usd=@costTo, purchase_price_usd=@purchaseTo
      WHERE id=@product AND cost_price_usd IS @costFrom AND purchase_price_usd IS @purchaseFrom`, params }] : []),
    ...movementStatements({
      plans, state: to, lotIds, reference: stockInEditReference(revision.rootMovementId, row.id, next),
      reason: `${direction === 'undo' ? 'Undo' : 'Redo'}: ${revision.reason}`, user,
      productName: String(facts?.product_name ?? `#${revision.productId}`), branchName: facts?.branch_name == null ? null : String(facts.branch_name),
    }),
    { sql: "UPDATE stock_lot_adjustment_operations SET generation=@next,state=@target,revision_json=json_set(revision_json,'$.generation',@next) WHERE id=@operation", params },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
      undo_payload=json_set(undo_payload,'$.generation',@next),redo_payload=json_set(redo_payload,'$.generation',@next) WHERE id=@history`, params },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)
      VALUES(@actor,@actorName,@action,'product',@entityId,@details,'inventory_movements',@root,@oldValue,@newValue)`, params: {
      actor: user.id ?? null, actorName: actorSnapshot(user), action: direction === 'undo' ? 'action_undo' : 'action_redo',
      entityId: String(revision.productId), root: revision.rootMovementId,
      details: JSON.stringify({ kind: 'stock_in_line_edit', operationId: row.id, movementId: revision.rootMovementId, generation: next }),
      oldValue: JSON.stringify({ quantity: lineFrom.quantity, unit_cost_usd: lineFrom.unitCostUsd, received_date: lineFrom.receivedDate, supplier_name: lineFrom.supplierName }),
      newValue: JSON.stringify({ quantity: lineTo.quantity, unit_cost_usd: lineTo.unitCostUsd, received_date: lineTo.receivedDate, supplier_name: lineTo.supplierName }),
    } },
  ]
  try {
    await ordinaryBusinessBatch(db, statements)
  } catch (error) {
    const current = await db.prepare('SELECT generation,state FROM stock_lot_adjustment_operations WHERE id=@operation').get<OperationRow>({ operation: row.id })
    if (current?.generation === next && current.state === target) return
    if (isMaintenanceError(error)) throw new StockInLineEditReplayError('Maintenance is in progress. Nothing was changed.', 503)
    throw new StockInLineEditReplayError('Stock changed after this line edit (a sale, transfer, count or a later edit). Nothing was changed.')
  }
}
