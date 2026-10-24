import { executeStockTransaction, stockTransactionStatementCount } from './stockTransaction'
import { productStockGuardStatement, productStockGuardError } from './productStockGuard'
import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { getPlanLimits } from './planTier'
import { bumpVersion } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { actorSnapshot } from './actorSnapshot'
import { assertSaleRecordBatchBounds, buildSaleRecordEventsInsert } from './saleRecordEvents'
import { validateCustomerReturnRestorationCohortV1, validateCustomerReturnRestorationMemberV1,
  type CustomerReturnRestorationV1 } from './customerReturnEntitlement'
import { multiplyMoney4, sellingPriceCeilCent, subtractDecimalSum } from './moneyPrecision'
import { canSetSalePrice, firstDisallowedReplacementPrice, RETURN_REPLACEMENT_PRICE_REFUSAL, type ReplacementPriceLine } from './returnReplacementPrice'
import {
  assertReturnCreateCapacity, ReturnCapacityError, type ReturnCapacityParams,
} from './returnCreateAction'
import { importedReturnLines } from './saleTransitions'
import {
  carriesRetiredReturnLabel, planReturnMoney, readSalesReturnMoney, saleReturnMoney, saleReturnMoneySql, type SaleReturnMoney, RETURN_REOPENS_PAID_SALE_DEBT, RETURN_REOPENS_PAID_SALE_DEBT_ERROR, ReturnMoneyError,
  saleReturnRecordWord, saleReturnStateSql, saleReturnTagStatement,
} from './returnRefundSplit'
import { saleStoredState, type SaleReturnState } from './saleStatusResolution'
import {
  BRANCH_RETIRED_DAMAGED_CODE, BRANCH_RETIRED_DAMAGED_ERROR, BranchEffectResolver, BranchRetiredNoSuccessorError,
  branchEffectGuardPredicate, foldedLotSurvivors, readBranchDirectory,
} from './branchEffect'

export const RETURN_BULK_ACTION_KIND = 'return.fields.bulk'
export const RETURN_BULK_LIMIT = 25

// The plan's D1 queries per invocation (50 on Free) is shared by the whole request. A grouped return action runs one atomic batch, which is checked against
// what the request has already spent BEFORE it is sent: a selection that cannot fit is refused whole with a sentence, never cut off part-way through the
// invocation. reserveStatements is what the route still needs after the batch. Since 6.0.966 the batch does not grow with the stock lines it moves or the
// replacement returns it links (set-based writes, merged guards); it grows with the number of returns selected together (a credit move and a sale tag each).
// An undo or redo is a request of its own and is sized the same way (measured in test-return-exchange-cancel-free-native.cjs).
export type ReturnBulkQueryBudget = { statementsUsed(): number; reserveStatements: number }
const RETURN_BULK_MOVEMENT_LIMIT = 256

type Row = Record<string, unknown>
type Statement = { sql: string; params: Record<string, unknown> }

type ReturnField = 'status' | 'return_type' | 'supplier_settlement'

type BulkRequest = {
  client_request_id: string
  field: ReturnField
  source: string
  target: string
  items: Array<{
    id: number
    expected_status: string
    expected_method: string
    expected_updated_at: string | null
    // Cancelling a return that has replacement units still with the customer (6.0.958): the returns the till made to take those units back,
    // [] when the replacement stays. Sorted and unique. Absent on every other request.
    replacement?: ReplacementChoice
  }>
  // A check that writes nothing (6.0.964): the cancel is planned, validated and sized exactly as it would be applied, then answered without a write.
  dry_run?: true
}

/**
 * `planned`: only on a dry run -- the units of the replacement the till is ABOUT to take back (it has not made that return yet). They count as gone when the
 * choice and the price floor are judged, and each planned take-back is sized as the linked return it will become.
 */
type ReplacementChoice = { return_ids: number[]; planned?: Array<{ sale_item_id: number; quantity: number }> }

type ReturnItem = Row & {
  id: number
  return_id: number
  product_id: number | null
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  quantity: number
  cost_price_usd: number | null
  cost_price_khr: number | null
  return_to_stock: number | null
  stock_action: string | null
}

type Allocation = {
  id: number
  return_item_id: number
  batch_id: number
  branch_id: number | null
  quantity: number
}

type DamagedLot = Row & {
  id: number
  return_id: number
  product_id: number
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  quantity: number
  quantity_remaining: number
}

// A recorded cost, or null when none was recorded. Zero is a real cost.
function recordedCost(value: unknown): number | null {
  if (value == null || value === '') return null
  const cost = Number(value)
  return Number.isFinite(cost) && cost >= 0 ? cost : null
}

// Quantity-weighted cost of a group of return lines; any line without a recorded cost makes the group unknown.
function groupedRecordedCost(items: ReturnItem[], field: 'cost_price_usd' | 'cost_price_khr', totalQuantity: number): number | null {
  let sum = 0
  for (const candidate of items) {
    const cost = recordedCost(candidate[field])
    if (cost === null) return null
    sum += cost * (Number(candidate.quantity) || 0)
  }
  return sum / totalQuantity
}

type StockDelta = {
  productId: number
  productName: string | null
  branchId: number
  batchId: number | null
  damagedLotId: number | null
  quantity: number
  costUsd: number | null
  costKhr: number | null
  movementType: string
  // Present only when the line was recorded at a branch that has since been retired and the stock moved at its
  // active successor (branchId is then the successor; older snapshots simply lack these): the branch the stock
  // really moved at, and the label the return was made under.
  branchName?: string | null
  addressed?: string | null
}

type Member = {
  id: number
  returnNumber: string
  saleId: number | null
  saleRevision: number | null
  moneyPrecisionVersion: number
  scope: 'customer' | 'supplier'
  before: { status: string; return_type: string; supplier_settlement: string }
  after: { status: string; return_type: string; supplier_settlement: string }
  changed: boolean
  reason: 'changed' | 'source_mismatch' | 'scope_mismatch'
  updateSale: boolean
  stock: StockDelta[]
  // A restored customer return is a new refund: its debt/cash split is taken
  // again against the sale as it stands. Absent on older snapshots and on
  // every other member, which then leave both columns alone.
  money?: { before: ReturnMoneyState; after: ReturnMoneyState }
  // A return the till made to take replacement units of a cancelled exchange back (a normal return of the replacement sale). It is already
  // completed when the cancel is applied, so applying writes nothing for it; UNDO cancels it again (the units leave the shelf), REDO restores it.
  // Absent on snapshots written before 6.0.958, whose members are all the returns the operator selected.
  linked?: true
  // Cancelling an exchange return takes back the refund credit that paid the replacement sale (6.0.963, owner: "Mark it Not Paid"): the credit tender row leaves
  // the sale's payments and the sale owes it again. Both sides are the exact stored columns, so undo and redo put back precisely what was there.
  // Absent on every other member and on snapshots written before 6.0.963.
  credit?: { saleId: number; usd: number; before: SaleCreditState; after: SaleCreditState }
}

type SaleCreditState = { payment_method: string | null; payment_details: string | null; amount_paid_usd: number; amount_paid_khr: number; sale_status: string }

type ReturnMoneyState = { owed_reduction_usd: number; refund_currency: string | null }
// before/after: the sale's Records status word on each side (saleReturnRecordWord:
// the return tag, else the payment state). payment*: written by 6.0.884 only,
// when a return still moved the payment state; read for Records, never replayed.
type SaleStatusSnapshot = { saleId: number; before: string; after: string; paymentBefore?: string; paymentAfter?: string }
// tagged: written by the two-status Worker (6.0.905), whose apply already rewrote any retired return word on each touched
// sale; a replay of it needs no sale read. Older snapshots may have left one, so their replay reads the sales first.
type Snapshot = { version: 1; operationId: string; field: ReturnField; members: Member[]; saleStatuses?: SaleStatusSnapshot[]; tagged?: true }

// `code` names a business refusal the client restates in the operator's
// language; without one the route answers the generic write_conflict /
// invalid_bulk_action it always has. `params` are the values that sentence
// names (the product and counts of return_restore_over_capacity), forwarded
// so the restated sentence keeps them.
export class ReturnBulkError extends Error {
  // `extra` rides next to error/code in the route's JSON (the redirect a client must confirm).
  constructor(message: string, readonly statusCode: 400 | 403 | 409 = 409, readonly code?: string, readonly params?: ReturnCapacityParams, readonly extra?: Record<string, unknown>) {
    super(message)
  }
}

function fail(message: string, status: 400 | 403 | 409 = 409, code?: string, params?: ReturnCapacityParams, extra?: Record<string, unknown>): never {
  throw new ReturnBulkError(message, status, code, params, extra)
}

function normalize(value: unknown, fallback = ''): string {
  return String(value ?? '').trim().toLowerCase() || fallback
}

function methodField(scope: unknown): Exclude<ReturnField, 'status'> {
  return normalize(scope, 'customer') === 'supplier' ? 'supplier_settlement' : 'return_type'
}

function methodValue(row: Row): string {
  return methodField(row.return_scope) === 'supplier_settlement'
    ? normalize(row.supplier_settlement, 'refund')
    : normalize(row.return_type, 'manual')
}

const REPLACEMENT_RETURNS_PER_ITEM = 10

function parseReplacementChoice(value: unknown, field: ReturnField, target: string, dryRun: boolean): ReplacementChoice | undefined {
  if (value === undefined) return undefined
  if (field !== 'status' || target !== 'cancelled') fail('A replacement choice only applies when cancelling a return.', 400)
  const choice = value as Row
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) || Object.keys(choice).some((key) => key !== 'return_ids' && !(dryRun && key === 'planned'))
    || !Array.isArray(choice.return_ids) || choice.return_ids.length > REPLACEMENT_RETURNS_PER_ITEM) fail('The replacement choice is invalid.', 400)
  const ids = (choice.return_ids as unknown[]).map(Number)
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) fail('The replacement choice is invalid.', 400)
  let planned: ReplacementChoice['planned']
  if (choice.planned !== undefined) {
    const list = choice.planned
    // A retry after part of the take-backs were made names those (return_ids) and announces the rest (planned).
    if (!Array.isArray(list) || list.length > 50) fail('The replacement choice is invalid.', 400)
    planned = (list as unknown[]).map((entry) => {
      const line = entry as Row
      const saleItemId = Number(line?.sale_item_id)
      const quantity = Number(line?.quantity)
      if (!line || typeof line !== 'object' || Object.keys(line).some((key) => key !== 'sale_item_id' && key !== 'quantity')
        || !Number.isSafeInteger(saleItemId) || saleItemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) fail('The replacement choice is invalid.', 400)
      return { sale_item_id: saleItemId, quantity }
    })
    if (new Set(planned.map((line) => line.sale_item_id)).size !== planned.length) fail('The replacement choice is invalid.', 400)
  }
  return { return_ids: ids.sort((a, b) => a - b), ...(planned ? { planned } : {}) }
}

function parseRequest(raw: Row): BulkRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('A bulk return action is required.', 400)
  const allowed = ['client_request_id', 'field', 'source', 'target', 'items', 'dry_run']
  if (Object.keys(raw).some((key) => !allowed.includes(key))) fail('Unsupported bulk return field.', 400)
  if (raw.dry_run !== undefined && raw.dry_run !== true) fail('Unsupported bulk return field.', 400)
  const dryRun = raw.dry_run === true
  if (typeof raw.client_request_id !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(raw.client_request_id)) fail('A stable request id is required.', 400)
  const field = String(raw.field || '') as ReturnField
  if (!['status', 'return_type', 'supplier_settlement'].includes(field)) fail('Invalid return field.', 400)
  const source = normalize(raw.source)
  const target = normalize(raw.target)
  if (!source || !target || source === target || source.length > 80 || target.length > 80) fail('Choose different source and target values.', 400)
  if (field === 'status' && (![source, target].every((value) => ['completed', 'cancelled'].includes(value)))) {
    fail('Return status can only move between completed and cancelled.', 400)
  }
  if (field === 'return_type' && !['restock', 'writeoff', 'refund'].includes(target)) fail('Invalid customer return type.', 400)
  if (field === 'supplier_settlement' && !['refund', 'credit', 'replacement', 'writeoff'].includes(target)) fail('Invalid supplier settlement.', 400)
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > RETURN_BULK_LIMIT) fail(`Select between 1 and ${RETURN_BULK_LIMIT} returns.`, 400)
  const ids = new Set<number>()
  const items = raw.items.map((candidate) => {
    const item = candidate as Row
    const keys = Object.keys(item || {})
    const id = Number(item?.id)
    if (!item || typeof item !== 'object' || keys.some((key) => !['id', 'expected_status', 'expected_method', 'expected_updated_at', 'replacement'].includes(key))
      || !Number.isSafeInteger(id) || id <= 0 || ids.has(id)
      || typeof item.expected_status !== 'string' || typeof item.expected_method !== 'string'
      || !(typeof item.expected_updated_at === 'string' || item.expected_updated_at === null)) {
      fail('Unique return ids and expected states are required.', 400)
    }
    ids.add(id)
    const replacement = parseReplacementChoice(item.replacement, field, target, dryRun)
    return {
      id,
      expected_status: normalize(item.expected_status, 'completed'),
      expected_method: normalize(item.expected_method),
      expected_updated_at: item.expected_updated_at as string | null,
      ...(replacement ? { replacement } : {}),
    }
  }).sort((left, right) => left.id - right.id)
  return { client_request_id: raw.client_request_id, field, source, target, items, ...(dryRun ? { dry_run: true as const } : {}) }
}

function assertReturnBulkBudget(env: Env, used: number, planned: number, reserve: number): void {
  if (used + planned + reserve > getPlanLimits(env).d1QueriesPerInvocation) {
    fail('This selection is too large for the current plan. Select fewer returns or replacement items, then try again.', 400, 'return_bulk_over_plan_budget')
  }
}

function guard(predicate: string, params: Row = {}): Statement {
  return { sql: `INSERT INTO return_bulk_guards(guard_value) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }
}

function movementFingerprint(idSql: string): string {
  return `(SELECT CASE WHEN COUNT(*)>${RETURN_BULK_MOVEMENT_LIMIT} THEN NULL ELSE json_group_array(json_array(id,product_id,branch_id,batch_id,movement_type,quantity)) END FROM (SELECT id,product_id,branch_id,batch_id,movement_type,quantity FROM inventory_movements WHERE reference_id=${idSql} AND movement_type IN ('return','return_reversal','damage_in','damage_reversal','supplier_return','supplier_return_reversal') ORDER BY id LIMIT ${RETURN_BULK_MOVEMENT_LIMIT + 1}))`
}

async function rowsForIds<T>(db: D1Compat, ids: number[], sql: (marks: string) => string): Promise<T[]> {
  if (!ids.length) return []
  if (ids.length > RETURN_BULK_LIMIT) fail('Selection exceeds the single-query bound.', 400)
  // sql-bound-params: bounded by construction -- parseRequest caps the
  // selection at 25 and this helper rechecks every derived ID list before
  // creating one positional placeholder per ID (well below D1's 100 limit).
  return db.prepare(sql(ids.map(() => '?').join(','))).all<T>(ids)
}

function valueSnapshot(row: Row): Member['before'] {
  return {
    status: normalize(row.status, 'completed'),
    return_type: normalize(row.return_type, 'manual'),
    supplier_settlement: normalize(row.supplier_settlement, 'refund'),
  }
}

function statusMovementType(scope: Member['scope'], quantity: number): string {
  if (scope === 'supplier') return quantity > 0 ? 'supplier_return_reversal' : 'supplier_return'
  return quantity > 0 ? 'return' : 'return_reversal'
}

// 6.0.966: the stock of every member moves in a FIXED number of statements (about eight), however many lines and linked take-backs the action carries.
// A Free invocation allows 50 D1 queries and the old shape spent 6-7 on every stock line, so a cancel of a 5-line exchange could not fit. Each statement
// is one set-based write over a JSON array of the deltas, grouped to the key it writes (product, product + branch, lot + branch); the movements stay one
// row per delta. The guards check the END state of each key (stock + the net delta >= 0), which is what the one-by-one order was enforcing. Damaged-stock
// lots are rare and keep their own per-lot statements.
const roundQuantity = (value: number): number => Math.round(value * 1e9) / 1e9
const j = (path: string, alias = 'x'): string => `json_extract(${alias}.value,'$.${path}')`

function stockStatements(members: readonly Member[], direction: 1 | -1, user: SessionUser, stamp: string): Statement[] {
  type Plain = { product: number; name: string | null; branch: number; branchName: string | null; addressed: string | null; batch: number | null; q: number; usd: number | null; khr: number | null; type: string; returnId: number }
  const plain: Plain[] = []
  const lots: Array<{ member: Member; delta: StockDelta; quantity: number }> = []
  for (const member of members) {
    for (const delta of member.stock) {
      const quantity = delta.quantity * direction
      if (delta.damagedLotId) { lots.push({ member, delta, quantity }); continue }
      plain.push({ product: Number(delta.productId), name: delta.productName, branch: Number(delta.branchId), branchName: delta.addressed ? delta.branchName ?? null : null, addressed: delta.addressed ?? null,
        batch: delta.batchId ? Number(delta.batchId) : null, q: quantity, usd: delta.costUsd, khr: delta.costKhr, type: statusMovementType(member.scope, quantity), returnId: member.id })
    }
  }
  const positive = new Set<number>()
  for (const row of plain) if (row.q > 0) positive.add(row.product)
  for (const lot of lots) if (lot.quantity > 0) positive.add(Number(lot.delta.productId))
  const out: Statement[] = []
  if (positive.size) out.push(productStockGuardStatement([...positive], 'active'))
  if (plain.length) {
    const products = new Map<number, number>()
    const pairs = new Map<string, { product: number; branch: number; q: number }>()
    const batches = new Map<string, { batch: number; product: number; branch: number; q: number; raise: number }>()
    for (const row of plain) {
      products.set(row.product, roundQuantity((products.get(row.product) ?? 0) + row.q))
      const pairKey = `${row.product}:${row.branch}`
      const pair = pairs.get(pairKey) ?? { product: row.product, branch: row.branch, q: 0 }
      pair.q = roundQuantity(pair.q + row.q); pairs.set(pairKey, pair)
      if (row.batch) {
        const batchKey = `${row.batch}:${row.branch}`
        const lot = batches.get(batchKey) ?? { batch: row.batch, product: row.product, branch: row.branch, q: 0, raise: 0 }
        lot.q = roundQuantity(lot.q + row.q); if (row.q > 0) lot.raise = 1; batches.set(batchKey, lot)
      }
    }
    const productRows = JSON.stringify([...products].map(([id, q]) => ({ id, q })))
    const pairRows = JSON.stringify([...pairs.values()])
    const batchRows = JSON.stringify([...batches.values()])
    const branchIds = JSON.stringify([...new Set(plain.map((row) => row.branch))])
    out.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@products) x WHERE NOT EXISTS(SELECT 1 FROM products WHERE id=${j('id')} AND stock_quantity+${j('q')}>=0))
      AND NOT EXISTS(SELECT 1 FROM json_each(@branches) x WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=x.value))
      AND NOT EXISTS(SELECT 1 FROM json_each(@pairs) x WHERE ${j('q')}<0 AND NOT EXISTS(SELECT 1 FROM branch_stock WHERE product_id=${j('product')} AND branch_id=${j('branch')} AND quantity+${j('q')}>=0))
      AND NOT EXISTS(SELECT 1 FROM json_each(@batches) x WHERE NOT EXISTS(SELECT 1 FROM product_batches WHERE id=${j('batch')} AND variant_product_id=${j('product')})
        OR (${j('q')}<0 AND NOT EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=${j('batch')} AND branch_id=${j('branch')} AND quantity+${j('q')}>=0)))`,
    { products: productRows, branches: branchIds, pairs: pairRows, batches: batchRows }))
    // A proposed row must pass CHECK(quantity >= 0) before SQLite looks for the conflict, so a negative net rides in as 0 and the conflict branch adds the real figure.
    out.push({
      sql: `INSERT INTO branch_stock(product_id,branch_id,quantity)
        SELECT ${j('product')},${j('branch')},MAX(${j('q')},0) FROM json_each(@pairs) x WHERE ${j('q')}<>0
        ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=branch_stock.quantity+(SELECT ${j('q', 'd')} FROM json_each(@pairs) d WHERE ${j('product', 'd')}=excluded.product_id AND ${j('branch', 'd')}=excluded.branch_id)`,
      params: { pairs: pairRows },
    })
    out.push({
      sql: `UPDATE products SET stock_quantity=stock_quantity+(SELECT ${j('q', 'd')} FROM json_each(@products) d WHERE ${j('id', 'd')}=products.id), updated_at=@stamp
        WHERE id IN (SELECT ${j('id', 'd')} FROM json_each(@products) d)`,
      params: { products: productRows, stamp },
    })
    if (batches.size) {
      // Customer restores and supplier-return reversals must make the exact archived lot selectable before adding stock, including undo/redo.
      if ([...batches.values()].some((lot) => lot.raise)) {
        out.push({
          sql: `UPDATE product_batches SET is_active=1 WHERE is_active IS NOT 1 AND id IN (SELECT ${j('batch', 'd')} FROM json_each(@batches) d WHERE ${j('raise', 'd')}=1)`,
          params: { batches: batchRows },
        })
      }
      out.push({
        sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity,updated_at)
          SELECT ${j('batch')},${j('branch')},MAX(${j('q')},0),@stamp FROM json_each(@batches) x WHERE ${j('q')}<>0
          ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=branch_batch_stock.quantity+(SELECT ${j('q', 'd')} FROM json_each(@batches) d WHERE ${j('batch', 'd')}=excluded.batch_id AND ${j('branch', 'd')}=excluded.branch_id), updated_at=@stamp`,
        params: { batches: batchRows, stamp },
      })
    }
    out.push({
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,addressed_branch_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
        SELECT ${j('product', 'm')},${j('name', 'm')},${j('branch', 'm')},${j('branchName', 'm')},${j('addressed', 'm')},${j('type', 'm')},${j('q', 'm')},${j('usd', 'm')},${j('khr', 'm')},
          ROUND(${j('usd', 'm')}*ABS(${j('q', 'm')}),4),ROUND(${j('khr', 'm')}*ABS(${j('q', 'm')}),4),@reason,${j('returnId', 'm')},@userId,@userName,${j('batch', 'm')}
        FROM json_each(@movements) m ORDER BY CAST(m.key AS INTEGER)`,
      params: { movements: JSON.stringify(plain), reason: `${direction > 0 ? 'Apply' : 'Undo'} grouped return status`, userId: user.id ?? null, userName: actorSnapshot(user) },
    })
  }
  for (const { member, delta, quantity } of lots) {
    const params = { product: delta.productId, branch: delta.branchId, batch: delta.batchId, lot: delta.damagedLotId, quantity, stamp }
    out.push(guard('EXISTS(SELECT 1 FROM damaged_stock_lots WHERE id=@lot AND return_id=@returnId AND product_id=@product AND branch_id IS @branch AND (batch_id IS NULL OR EXISTS(SELECT 1 FROM product_batches WHERE id=damaged_stock_lots.batch_id AND variant_product_id=@product)) AND quantity_remaining+@quantity BETWEEN 0 AND quantity)', { ...params, returnId: member.id }))
    out.push({ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining+@quantity, updated_at=@stamp WHERE id=@lot', params })
    out.push({
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id${delta.addressed ? ',branch_name,addressed_branch_name' : ''},movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
            VALUES(@product,@name,@branch${delta.addressed ? ',@branchName,@addressed' : ''},@type,@quantity,@usd,@khr,ROUND(@usd*ABS(@quantity),4),ROUND(@khr*ABS(@quantity),4),@reason,@returnId,@userId,@userName,@batch)`,
      params: {
        product: delta.productId,
        name: delta.productName,
        branch: delta.branchId,
        ...(delta.addressed ? { branchName: delta.branchName ?? null, addressed: delta.addressed } : {}),
        type: quantity > 0 ? 'damage_in' : 'damage_reversal',
        quantity,
        usd: delta.costUsd,
        khr: delta.costKhr,
        reason: `${direction > 0 ? 'Apply' : 'Undo'} grouped return status`,
        returnId: member.id,
        userId: user.id ?? null,
        userName: actorSnapshot(user),
        batch: delta.batchId,
      },
    })
  }
  return out
}

// The replacement sale must still be exactly as the plan read it. The check rides inside the member's own guard statement (every statement counts
// against a Free invocation), so it is a predicate here and the write is the only statement of its own.
function creditStatePredicate(state: SaleCreditState, saleId: number): { predicate: string; params: Row } {
  return {
    predicate: 'EXISTS(SELECT 1 FROM sales WHERE id=@creditSale AND payment_details IS @creditDetails AND payment_method IS @creditMethod AND amount_paid_usd IS @creditUsd AND amount_paid_khr IS @creditKhr AND sale_status IS @creditStatus)',
    params: { creditSale: saleId, creditDetails: state.payment_details, creditMethod: state.payment_method, creditUsd: state.amount_paid_usd, creditKhr: state.amount_paid_khr, creditStatus: state.sale_status },
  }
}

function mergeGuard(statement: Statement, predicate: string, params: Row): void {
  const tail = ') THEN 1 ELSE 0 END'
  const at = statement.sql.lastIndexOf(tail)
  statement.sql = `${statement.sql.slice(0, at)} AND (${predicate})${statement.sql.slice(at)}`
  Object.assign(statement.params, params)
}

// The credit move of every exchange return in the group: ONE write of the replacement sales' payment columns (each row is the exact stored state on the side
// being written), however many exchanges are cancelled together.
function creditStatements(members: readonly Member[], direction: 1 | -1, stamp: string): Statement[] {
  const rows = members.flatMap((member) => {
    const credit = member.credit
    if (!credit) return []
    const to = direction > 0 ? credit.after : credit.before
    return [{ saleId: credit.saleId, pm: to.payment_method, pd: to.payment_details, pu: to.amount_paid_usd, pk: to.amount_paid_khr, st: to.sale_status }]
  })
  if (!rows.length) return []
  const pick = (path: string) => `(SELECT json_extract(u.value,'$.${path}') FROM json_each(@rows) u WHERE json_extract(u.value,'$.saleId')=sales.id)`
  return [{ sql: `UPDATE sales SET payment_method=${pick('pm')},payment_details=${pick('pd')},amount_paid_usd=${pick('pu')},amount_paid_khr=${pick('pk')},sale_status=${pick('st')},updated_at=@stamp
      WHERE id IN (SELECT json_extract(u.value,'$.saleId') FROM json_each(@rows) u)`, params: { rows: JSON.stringify(rows), stamp } }]
}

// What a replay or an apply writes for its members, in a count that does not grow with them: ONE stock group for all, the credit move of each exchange return
// (one per exchange), and ONE update of the returns rows. A linked replacement return is already completed when the cancel is applied: nothing to write on
// the way in except its debt/cash split (the credit it was refunded against is gone); on undo and redo it is written like any other member.
function memberGroupStatements(members: readonly Member[], direction: 1 | -1, user: SessionUser, stamp: string, applying = false): Statement[] {
  const written = members.filter((member) => member.changed && !(applying && member.linked))
  const out: Statement[] = [...stockStatements(written, direction, user, stamp)]
  out.push(...creditStatements(written, direction, stamp))
  type ReturnRow = { id: number; full: 0 | 1; status?: string; returnType?: string; settlement?: string; money: 0 | 1; owed: number | null; currency: string | null }
  const rows = members.filter((member) => member.changed).flatMap((member): ReturnRow[] => {
    if (applying && member.linked) {
      return member.money ? [{ id: member.id, full: 0, money: 1, owed: member.money.after.owed_reduction_usd, currency: member.money.after.refund_currency }] : []
    }
    const target = direction > 0 ? member.after : member.before
    const money = member.money ? (direction > 0 ? member.money.after : member.money.before) : null
    return [{ id: member.id, full: 1, status: target.status, returnType: target.return_type, settlement: target.supplier_settlement, money: money ? 1 : 0, owed: money?.owed_reduction_usd ?? null, currency: money?.refund_currency ?? null }]
  })
  if (rows.length) {
    const pick = (path: string) => `(SELECT json_extract(u.value,'$.${path}') FROM json_each(@rows) u WHERE json_extract(u.value,'$.id')=returns.id)`
    out.push({
      sql: `UPDATE returns SET
          status=CASE WHEN ${pick('full')}=1 THEN ${pick('status')} ELSE status END,
          return_type=CASE WHEN ${pick('full')}=1 THEN ${pick('returnType')} ELSE return_type END,
          supplier_settlement=CASE WHEN ${pick('full')}=1 THEN ${pick('settlement')} ELSE supplier_settlement END,
          owed_reduction_usd=CASE WHEN ${pick('money')}=1 THEN ${pick('owed')} ELSE owed_reduction_usd END,
          refund_currency=CASE WHEN ${pick('money')}=1 THEN ${pick('currency')} ELSE refund_currency END,
          updated_at=@stamp
        WHERE id IN (SELECT json_extract(u.value,'$.id') FROM json_each(@rows) u)`,
      params: { rows: JSON.stringify(rows), stamp },
    })
  }
  return out
}

// The guards of a group are one statement, or a few when their parameters would pass the 100 a D1 statement may bind: every guard is a statement of its own
// otherwise, and each counts against a Free invocation. Parameters are renamed per guard so equal names with different values cannot collide.
const GUARD_SQL = /^INSERT INTO return_bulk_guards\(guard_value\) SELECT CASE WHEN \(([\s\S]*)\) THEN 1 ELSE 0 END$/
const MERGED_GUARD_PARAMETER_LIMIT = 80
function mergeGuards(statements: readonly Statement[]): Statement[] {
  const out: Statement[] = []
  let predicates: string[] = []
  let params: Row = {}
  let counter = 0
  const flush = () => {
    if (predicates.length) out.push(guard(predicates.map((predicate) => `(${predicate})`).join(' AND '), params))
    predicates = []; params = {}
  }
  for (const statement of statements) {
    const match = GUARD_SQL.exec(statement.sql)
    if (!match) { flush(); out.push(statement); continue }
    const names = Object.keys(statement.params)
    if (Object.keys(params).length + names.length > MERGED_GUARD_PARAMETER_LIMIT) flush()
    const tag = `g${counter++}_`
    predicates.push(match[1].replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (all, name: string) => name in statement.params ? `@${tag}${name}` : all))
    for (const name of names) params[`${tag}${name}`] = statement.params[name]
  }
  flush()
  return out
}

/**
 * The money half of a status change (owner, 29 Sep 2026): a restored return
 * splits its refund again into debt lowered and cash (lib/returnRefundSplit.ts
 * planReturnMoney) and sets member.money. A return never moves the payment
 * state (owner, 20 Oct 2026), so a change that would leave a paid sale owing
 * again is refused instead.
 */
async function planStatusMoney(db: D1Compat, members: Member[]): Promise<void> {
  const touched = members.filter(member => member.changed && member.updateSale && member.saleId && member.scope === 'customer' && !member.linked)
  for (const [saleId, money] of await readSalesReturnMoney(db, [...new Set(touched.map(member => member.saleId!))])) {
    const own = touched.filter(member => member.saleId === saleId)
    const status = new Map(own.map(member => [member.id, member.after.status]))
    const restored = own.filter(member => member.after.status === 'completed').map(member => member.id).sort((a, b) => a - b)
    const rows = money.returns.map(row => ({ id: Number(row.id), active: (status.get(Number(row.id)) ?? row.status) !== 'cancelled',
      refundUsd: row.total_refund_usd, owedReductionUsd: row.owed_reduction_usd,
      currency: restored.includes(Number(row.id)) ? row.refund_currency ?? 'USD' : row.refund_currency }))
    let plan: ReturnType<typeof planReturnMoney>
    try { plan = planReturnMoney({ sale: money.sale, returns: rows, recompute: restored }) } catch (error) {
      if (error instanceof ReturnMoneyError) fail(error.message, 409, error.code)
      throw error
    }
    if (plan.reopensPaidSaleDebt) fail(RETURN_REOPENS_PAID_SALE_DEBT_ERROR, 409, RETURN_REOPENS_PAID_SALE_DEBT)
    for (const id of restored) {
      const stored = money.returns.find(row => Number(row.id) === id)
      if (!stored || !plan.owedReductionUsd.has(id)) continue
      const currency = stored.refund_currency == null ? null : String(stored.refund_currency)
      own.find(member => member.id === id)!.money = {
        before: { owed_reduction_usd: Number(stored.owed_reduction_usd) || 0, refund_currency: currency },
        after: { owed_reduction_usd: plan.owedReductionUsd.get(id)!, refund_currency: currency ?? 'USD' },
      }
    }
  }
}

function auditStatement(user: SessionUser, operationId: string, action: string, count: number): Statement {
  const details = JSON.stringify({ kind: RETURN_BULK_ACTION_KIND, count })
  return {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
          VALUES(@userId,@userName,@action,'return',@id,@details,'returns',@id,@details)`,
    params: { userId: user.id ?? null, userName: actorSnapshot(user), action, id: operationId, details },
  }
}

function assertBounded(statements: Statement[], snapshot: Snapshot, eventsBytes = 0): void {
  try {
    assertSaleRecordBatchBounds(snapshot.members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) : statements.length, snapshot, eventsBytes)
  } catch (_) {
    fail('Selection is too large for one atomic action. Select fewer returns.', 400)
  }
}

type SaleTagRow = { saleId: number; sale_status: string | null; status_before_return: string | null; return_state: string | null; delivery_pending: number | null; tagAfter: SaleReturnState | null }

// Each touched sale as stored, and the tag its returns give once every changed member stands at `target`
// (lib/returnCreateAction.ts saleReturnStateSql, imported units included). One read.
async function saleTagRows(db: D1Compat, members: Member[], target: 'before' | 'after'): Promise<SaleTagRow[]> {
  const overrides = members.filter((member) => member.changed && member.updateSale && member.saleId && member.scope === 'customer')
    .map((member) => ({ id: member.id, status: member[target].status }))
  const saleIds = [...new Set(members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]
  if (!saleIds.length) return []
  const effective = `(COALESCE((SELECT json_extract(o.value,'$.status') FROM json_each(@overrides) o
    WHERE CAST(json_extract(o.value,'$.id') AS INTEGER)=r.id),COALESCE(r.status,'completed')))`
  const rows = await db.prepare(`
    SELECT s.id AS saleId,s.sale_status,s.status_before_return,s.return_state,s.delivery_pending,
      ${saleReturnStateSql('s.id', `${effective}!='cancelled'`)} AS tagAfter
    FROM sales s
    WHERE EXISTS(SELECT 1 FROM json_each(@saleIds) ids WHERE CAST(ids.value AS INTEGER)=s.id)
    ORDER BY s.id
  `).all<SaleTagRow>({ overrides: JSON.stringify(overrides), saleIds: JSON.stringify(saleIds) })
  return rows.map(row => ({ ...row, saleId: Number(row.saleId) }))
}

// The sales write of one touched sale: the exact (v1) tag when the entitlement computed one, else the tag read in-batch.
function saleTagStatement(row: SaleTagRow, stamp: string, exact: Map<number, SaleReturnState | null>): Statement {
  return saleReturnTagStatement({ saleId: row.saleId, stamp,
    tag: exact.has(row.saleId) ? exact.get(row.saleId)! : { sql: saleReturnStateSql('@saleId') },
    retired: carriesRetiredReturnLabel(row) ? saleStoredState(row) : null })
}

function returnSaleRecordEvents(snapshot: Snapshot, generation: number, via: 'apply' | 'undo' | 'redo', user: SessionUser, stamp: string) {
  return buildSaleRecordEventsInsert((snapshot.saleStatuses || []).flatMap((status) => {
    // A change of payment state alone (a restore that clears the debt) is recorded as that state moving.
    const paid = status.before === status.after && status.paymentBefore !== undefined && status.paymentBefore !== status.paymentAfter
    const left = paid ? status.paymentBefore! : status.before
    const right = paid ? status.paymentAfter! : status.after
    const before = via === 'undo' ? right : left
    const after = via === 'undo' ? left : right
    if (before === after) return []
    const related = snapshot.members.filter((member) => member.changed && member.saleId === status.saleId).map((member) => member.returnNumber)
    return [{
      saleId: status.saleId, sourceKind: 'return_bulk' as const, sourceId: snapshot.operationId,
      generation, kind: 'status_changed' as const, via,
      subject: related.join(', ').slice(0, 240) || null,
      actorId: user.id, actorUsername: actorSnapshot(user), occurredAt: stamp,
      changes: [{
        field: 'sale_status' as const,
        before: { state: 'known_value' as const, value: before },
        after: { state: 'known_value' as const, value: after },
      }],
    }]
  }))
}

function permission(user: SessionUser): void {
  if (getActionTier(user, 'returns', 'bulk') !== 'full') fail('Bulk Returns access is required.', 403)
}

const ENTITLEMENT_GRAPH_MAX_BYTES = 1_500_000
function entitlementGraphExpression(): string {
  return `json_object(
    'returns',COALESCE((SELECT json_group_array(json_object(
      'id',id,'sale_id',sale_id,'status',status,'updated_at',updated_at,
      'money_precision_version',money_precision_version,'calculated_refund_usd',calculated_refund_usd,
      'rounding_adjustment_usd',rounding_adjustment_usd,'total_refund_usd',total_refund_usd,'total_refund_khr',total_refund_khr
    )) FROM (SELECT id,sale_id,status,updated_at,money_precision_version,calculated_refund_usd,
      rounding_adjustment_usd,total_refund_usd,total_refund_khr FROM returns
      WHERE COALESCE(return_scope,'customer')='customer'
        AND EXISTS(SELECT 1 FROM json_each(@entitlementSaleIds) ids WHERE CAST(ids.value AS INTEGER)=sale_id)
      ORDER BY id)),json('[]')),
    'items',COALESCE((SELECT json_group_array(json_object(
      'id',id,'return_id',return_id,'sale_item_id',sale_item_id,'product_id',product_id,'quantity',quantity,
      'total_usd',total_usd,'refund_snapshot_json',refund_snapshot_json
    )) FROM (SELECT ri.id,ri.return_id,ri.sale_item_id,ri.product_id,ri.quantity,ri.total_usd,ri.refund_snapshot_json
      FROM return_items ri JOIN returns r ON r.id=ri.return_id
      WHERE COALESCE(r.return_scope,'customer')='customer'
        AND EXISTS(SELECT 1 FROM json_each(@entitlementSaleIds) ids WHERE CAST(ids.value AS INTEGER)=r.sale_id)
      ORDER BY ri.id)),json('[]'))
  )`
}

async function v1EntitlementGuards(db: D1Compat, members: Member[], target: 'before' | 'after'): Promise<{
  guards: Statement[]; exactTags: Map<number, SaleReturnState | null>
}> {
  const changed = members.filter(member => member.changed && member.scope === 'customer'
    && member.saleId && member.before.status !== member.after.status)
  const saleIds = [...new Set(changed.map(member => member.saleId!))]
  if (!saleIds.length) return { guards: [], exactTags: new Map() }
  const entitlementSaleIds = JSON.stringify(saleIds)
  const graph = await db.prepare(`SELECT ${entitlementGraphExpression()} AS value`).get<{ value: string }>({ entitlementSaleIds })
  const authorityJson = String(graph?.value || '')
  if (!authorityJson || new TextEncoder().encode(authorityJson).byteLength > ENTITLEMENT_GRAPH_MAX_BYTES) {
    fail('The exact refund history is too large to restore safely.', 400)
  }
  const parsed = JSON.parse(authorityJson) as { returns: Row[]; items: Row[] }
  if (!Array.isArray(parsed.returns) || !Array.isArray(parsed.items) || parsed.items.length > 1_000) {
    fail('The exact refund history is too large to restore safely.', 400)
  }
  const override = new Map(changed.map(member => [member.id, member[target].status]))
  const saleLines = await db.prepare(`SELECT s.id AS sale_id,
    si.id AS sale_item_id,si.product_id,si.product_name,si.quantity,si.returned_quantity FROM sales s JOIN sale_items si ON si.sale_id=s.id
    WHERE EXISTS(SELECT 1 FROM json_each(@saleIds) ids WHERE CAST(ids.value AS INTEGER)=s.id)
    ORDER BY s.id,si.id`).all<Row>({ saleIds: entitlementSaleIds })
  const exactTags = new Map<number, SaleReturnState | null>()
  for (const saleId of saleIds) {
    const headers = parsed.returns.filter(row => Number(row.sale_id) === saleId)
    if (!headers.some(row => Number(row.money_precision_version) === 1)) {
      // Legacy (v0) sale: no exact-refund authority to validate, but the
      // quantity cap POST / enforces still holds. A transition that brings a
      // cancelled return back must not leave more units returned against a
      // sale line than it sold -- matched by sale_item_id, else product_id,
      // exactly as assertReturnCreateCapacity matches a new return.
      const reactivates = headers.some(row => override.has(Number(row.id))
        && override.get(Number(row.id)) !== 'cancelled' && normalize(row.status, 'completed') === 'cancelled')
      if (reactivates) {
        const activeIds = new Set(headers.filter(row =>
          (override.get(Number(row.id)) ?? normalize(row.status, 'completed')) !== 'cancelled').map(row => Number(row.id)))
        const activeLines = parsed.items.filter(item => activeIds.has(Number(item.return_id))).map(item => ({
          sale_item_id: item.sale_item_id == null ? null : Number(item.sale_item_id),
          product_id: item.product_id == null ? null : Number(item.product_id),
          quantity: Number(item.quantity),
        }))
        const soldLines = saleLines.filter(row => Number(row.sale_id) === saleId).map(row => ({
          id: Number(row.sale_item_id), product_id: row.product_id == null ? null : Number(row.product_id),
          quantity: Number(row.quantity), product_name: row.product_name == null ? null : String(row.product_name),
          returned_quantity: row.returned_quantity,
        }))
        // RET-B F4: the units the import recorded as already returned count
        // too. RET-B E1 refuses every cancel/restore on a stock-skipped sale
        // (every sales-import:% sale, since F4 and migration 0235), so this
        // guards sales 0235 does not mark (ops legacy-sale:% imports) and any
        // future relaxing of E1.
        try {
          assertReturnCreateCapacity(soldLines, importedReturnLines(soldLines), activeLines)
        } catch (error) {
          fail(`Restoring this return would count more units as returned than the sale sold. ${(error as Error).message}`, 409, 'return_restore_over_capacity',
            error instanceof ReturnCapacityError ? error.params ?? undefined : undefined)
        }
      }
      continue
    }
    const materialize = (rows: Row[]) => rows.map(row => ({
      id: Number(row.id), sale_id: saleId, money_precision_version: Number(row.money_precision_version) as 1,
      calculated_refund_usd: Number(row.calculated_refund_usd), rounding_adjustment_usd: Number(row.rounding_adjustment_usd),
      total_refund_usd: Number(row.total_refund_usd), total_refund_khr: Number(row.total_refund_khr),
      items: parsed.items.filter(item => Number(item.return_id) === Number(row.id)).map(item => ({
        sale_item_id: item.sale_item_id == null ? null : Number(item.sale_item_id), quantity: Number(item.quantity),
        total_usd: Number(item.total_usd), refund_snapshot_json: item.refund_snapshot_json == null ? null : String(item.refund_snapshot_json),
      })),
    })) as CustomerReturnRestorationV1[]
    const cohort = (projected: boolean) => materialize(headers.filter(row => {
      const status = projected ? override.get(Number(row.id)) ?? normalize(row.status, 'completed') : normalize(row.status, 'completed')
      return status !== 'cancelled'
    }))
    const projected = cohort(true)
    try {
      // A transition may remove an aggregate-invalid historical cohort, but a
      // selected v1 member itself must always have intact immutable authority.
      for (const row of materialize(headers.filter(row => override.has(Number(row.id))
        && Number(row.money_precision_version) === 1))) validateCustomerReturnRestorationMemberV1(row)
      if (projected.length) {
        validateCustomerReturnRestorationCohortV1(projected)
      }
    } catch {
      fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
    }
    const activeIds = new Set(projected.map(row => row.id))
    const lines = saleLines.filter(row => Number(row.sale_id) === saleId)
    const linesById = new Map(lines.map(line => [Number(line.sale_item_id), line]))
    const returned = new Map<number, number[]>()
    for (const item of parsed.items.filter(item => activeIds.has(Number(item.return_id)))) {
      const id = Number(item.sale_item_id)
      if (!Number.isSafeInteger(id) || id <= 0) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
      const line = linesById.get(id)
      if (!line || line.product_id !== item.product_id) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
      const quantities = returned.get(id) || []
      quantities.push(Number(item.quantity)); returned.set(id, quantities)
    }
    if (!lines.length) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
    let fullyReturned = projected.length > 0
    try {
      for (const line of lines) {
        const remainder = subtractDecimalSum(Number(line.quantity), returned.get(Number(line.sale_item_id)) || [])
        if (remainder.startsWith('-')) fail('The exact refund entitlement changed. Review the return history before restoring it.', 409)
        if (remainder !== '0') fullyReturned = false
      }
    } catch { fail('The exact refund entitlement changed. Review the return history before restoring it.', 409) }
    exactTags.set(saleId, !projected.length ? null : fullyReturned ? 'full' : 'partial')
  }
  return { guards: [guard(`${entitlementGraphExpression()}=@entitlementAuthorityJson`, { entitlementSaleIds, entitlementAuthorityJson: authorityJson })],
    exactTags }
}

// ---- the replacement left with the customer (6.0.958) ------------------------------------------------------------------------------------------

/** A line of a one-step exchange's replacement sale: what was sold, and how many units of it are still with the customer. */
export type ReplacementOutstandingLine = {
  id: number
  sale_item_id: number | null
  product_id: number | null
  product_name: string | null
  branch_id: number | null
  batch_id: number | null
  /** Units still with the customer: what the replacement sale sold less what active returns of that sale took back. */
  quantity: number
  applied_price_usd: number
  applied_price_khr: number
}
export type ReplacementOutstanding = {
  return_id: number
  sale_id: number
  receipt_number: string | null
  money_precision_version: number
  exchange_rate: number
  lines: ReplacementOutstandingLine[]
}
// Every line of the replacement sale, taken back or not (`quantity` is what is left, 0 for a line that is fully back), with the catalog
// price the price floor holds the units that stay to.
type ExchangeSaleMoney = {
  source_return_id: number | null; sale_status: string | null; return_state: string | null; payment_method: string | null; payment_details: string | null
  amount_paid_usd: number; amount_paid_khr: number; total_usd: number; exchange_rate: number; refund_usd: number; refund_owed_usd: number
  change_usd: number; change_khr: number
  // The sale's own money and every return on it, read by the same statement (no extra D1 query): what a take-back's debt/cash split is planned against.
  stored: SaleReturnMoney
}
type ReplacementInfo = Omit<ReplacementOutstanding, 'lines'> & { lines: Array<ReplacementOutstandingLine & { catalog_usd: number | null }>; money: ExchangeSaleMoney }

function recordedCatalog(itemsJson: unknown, index: number): number | null {
  if (typeof itemsJson !== 'string' || itemsJson.length > 200_000) return null
  try {
    const items = JSON.parse(itemsJson)
    const value = Array.isArray(items) ? Number(items[index]?.catalog_usd) : NaN
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch { return null }
}

async function readReplacementInfo(db: D1Compat, returnIds: number[]): Promise<Map<number, ReplacementInfo>> {
  const infos = new Map<number, ReplacementInfo>()
  if (!returnIds.length) return infos
  const rows = await rowsForIds<Row>(db, returnIds, (marks) => `
    SELECT rri.return_id,rri.id,rri.sale_item_id,rri.product_id,rri.product_name,rri.branch_id,rri.batch_id,
      COALESCE(si.quantity,0) AS sale_quantity,
      COALESCE(si.applied_price_usd,rri.applied_price_usd) AS applied_price_usd,COALESCE(si.applied_price_khr,rri.applied_price_khr) AS applied_price_khr,
      MAX(COALESCE(si.returned_quantity,0),0)+COALESCE((SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r2 ON r2.id=ri.return_id
        WHERE ri.sale_item_id=rri.sale_item_id AND COALESCE(r2.status,'completed')<>'cancelled'),0) AS returned_quantity,
      s.id AS sale_id,s.sale_status,s.receipt_number,s.exchange_rate,s.money_precision_version,p.selling_price_usd,s.items AS sale_items_json,
      s.source_return_id,s.return_state,s.payment_method,s.payment_details,s.amount_paid_usd,s.amount_paid_khr,s.total_usd,s.change_usd,s.change_khr,
      r.total_refund_usd AS refund_usd,r.owed_reduction_usd AS refund_owed_usd,s.calculated_total_usd,s.status_before_return,
      ${saleReturnMoneySql('s')}
    FROM return_replacement_items rri
    JOIN returns r ON r.id=rri.return_id
    LEFT JOIN sales s ON s.id=r.replacement_sale_id
    LEFT JOIN sale_items si ON si.id=rri.sale_item_id AND si.sale_id=r.replacement_sale_id
    LEFT JOIN products p ON p.id=rri.product_id
    WHERE rri.return_id IN (${marks}) ORDER BY rri.return_id,rri.id LIMIT 301`)
  if (rows.length > 300) fail('Select fewer returns with replacement lines.', 400)
  for (const row of rows) {
    const returnId = Number(row.return_id)
    const info = infos.get(returnId) ?? {
      return_id: returnId, sale_id: Number(row.sale_id) || 0, receipt_number: (row.receipt_number as string | null) ?? null,
      money_precision_version: Number(row.money_precision_version) || 0, exchange_rate: Number(row.exchange_rate) || 0, lines: [],
      money: {
        source_return_id: row.source_return_id == null ? null : Number(row.source_return_id), sale_status: (row.sale_status as string | null) ?? null,
        return_state: (row.return_state as string | null) ?? null, payment_method: (row.payment_method as string | null) ?? null,
        payment_details: (row.payment_details as string | null) ?? null, amount_paid_usd: Number(row.amount_paid_usd) || 0, amount_paid_khr: Number(row.amount_paid_khr) || 0,
        total_usd: Number(row.total_usd) || 0, exchange_rate: Number(row.exchange_rate) || 0, change_usd: Number(row.change_usd) || 0, change_khr: Number(row.change_khr) || 0,
        refund_usd: Number(row.refund_usd) || 0, refund_owed_usd: Number(row.refund_owed_usd) || 0,
        stored: saleReturnMoney({ id: row.sale_id, sale_status: row.sale_status, status_before_return: row.status_before_return, total_usd: row.total_usd, amount_paid_usd: row.amount_paid_usd,
          amount_paid_khr: row.amount_paid_khr, exchange_rate: row.exchange_rate, money_precision_version: row.money_precision_version, calculated_total_usd: row.calculated_total_usd, return_money_json: row.return_money_json }),
      },
    }
    // A cancelled replacement sale (or a line the sale no longer has) has nothing left with the customer.
    const gone = normalize(row.sale_status) === 'cancelled' || row.sale_item_id == null || !(Number(row.sale_quantity) > 0)
    const left = gone ? 0 : Math.max(0, Number(subtractDecimalSum(Number(row.sale_quantity) || 0, [Number(row.returned_quantity) || 0])))
    info.lines.push({
      id: Number(row.id), sale_item_id: row.sale_item_id == null ? null : Number(row.sale_item_id), product_id: row.product_id == null ? null : Number(row.product_id),
      product_name: (row.product_name as string | null) ?? null, branch_id: row.branch_id == null ? null : Number(row.branch_id),
      batch_id: row.batch_id == null ? null : Number(row.batch_id), quantity: left,
      applied_price_usd: Number(row.applied_price_usd) || 0, applied_price_khr: Number(row.applied_price_khr) || 0,
      // The catalog price the line was sold against, recorded on the sale when the exchange was made (release review P2-2: a catalog that moved since is not what
      // the floor holds the units to); today's catalog only for a sale that recorded none.
      catalog_usd: recordedCatalog(row.sale_items_json, info.lines.length) ?? (row.selling_price_usd == null ? null : Number(row.selling_price_usd)),
    })
    infos.set(returnId, info)
  }
  return infos
}

/**
 * What each exchange return still has with the customer: the replacement lines whose units no active return took back (the Returns screen
 * asks about exactly these before cancelling the return). Returns with nothing left, or no replacement sale, are absent.
 */
export async function readReplacementOutstanding(db: D1Compat, returnIds: number[]): Promise<ReplacementOutstanding[]> {
  const infos = await readReplacementInfo(db, returnIds)
  return [...infos.values()].flatMap(({ lines, money: _money, ...info }) => {
    const left = lines.filter((line) => line.quantity > 0).map(({ catalog_usd: _catalog, ...line }) => line)
    return left.length ? [{ ...info, lines: left }] : []
  })
}

/**
 * The answer every request that CANCELS an exchange return must give (owner, 22 Oct 2026: "if cancel, ask if replacement also cancel, if so,
 * choose some or all"). A line's outstanding units are what the replacement sale sold less what active returns took back from it; when any are
 * left the request must SAY what happens to them -- replacement.return_ids: the returns the till made to take units back, [] to keep them all --
 * or it is refused with every line to choose from. A request never silently leaves a replacement behind. The units that stay are priced as they
 * would be for a sale with no return behind them (nothing returned), so a caller without the POS price grant cannot cancel the return out from
 * under a replacement that was only discounted because of it (release review, P3-3).
 */
async function planReplacementChoices(db: D1Compat, request: BulkRequest, returns: Row[], user: SessionUser | undefined): Promise<Map<number, ReplacementInfo>> {
  const cancelling = request.items.filter((item) => {
    const row = returns.find((candidate) => Number(candidate.id) === item.id)
    return !!row && normalize(row.status, 'completed') === request.source && normalize(row.return_scope, 'customer') !== 'supplier' && Number(row.replacement_sale_id) > 0
  })
  const infos = await readReplacementInfo(db, cancelling.map((item) => item.id))
  // A dry run judges the choice as if the take-back it announces already existed: those units are not with the customer any more.
  for (const item of request.items) {
    const info = infos.get(item.id)
    for (const planned of item.replacement?.planned ?? []) {
      const line = info?.lines.find((candidate) => candidate.sale_item_id === planned.sale_item_id)
      if (!line || planned.quantity > line.quantity + 1e-9) fail(`Return ${item.id} has no such replacement units to take back.`, 400, 'return_cancel_replacement_invalid')
      line.quantity = Math.max(0, Number(subtractDecimalSum(line.quantity, [planned.quantity])))
    }
  }
  const undecided = request.items.flatMap((item) => {
    const info = infos.get(item.id)
    const kept = info ? info.lines.filter((line) => line.quantity > 0) : []
    if (item.replacement?.return_ids.length && !info) fail(`Return ${item.id} has no replacement items to cancel.`, 400, 'return_cancel_replacement_invalid')
    return kept.length && !item.replacement ? [{ info: info!, kept }] : []
  })
  if (undecided.length) {
    fail('A return being cancelled has replacement items still with the customer. Say whether they are cancelled too.', 409, 'return_cancel_replacement_choice_required', undefined, {
      replacements: undecided.map(({ info, kept }) => ({
        return_id: info.return_id, sale_id: info.sale_id, receipt_number: info.receipt_number, money_precision_version: info.money_precision_version, exchange_rate: info.exchange_rate,
        lines: kept.map(({ catalog_usd: _catalog, ...line }) => line),
      })),
    })
  }
  // The units that stay behind a cancelled return: priced like a sale of their own for a caller who may not set prices.
  if (user && !canSetSalePrice(user)) {
    for (const item of request.items) {
      const info = infos.get(item.id)
      const stay = info ? info.lines.filter((line) => line.quantity > 0 && line.product_id != null) : []
      if (!info || !stay.length || !(info.exchange_rate > 0)) continue
      const lines: ReplacementPriceLine[] = stay.map((line) => {
        const catalogUsd = sellingPriceCeilCent(line.catalog_usd ?? line.applied_price_usd)
        return {
          productId: line.product_id!, quantity: line.quantity, priceUsd: line.applied_price_usd, priceKhr: line.applied_price_khr,
          catalogUsd, catalogKhr: multiplyMoney4(catalogUsd, info.exchange_rate), returned: [],
        }
      })
      const offender = await firstDisallowedReplacementPrice(db, lines, info.exchange_rate)
      if (offender) fail(RETURN_REPLACEMENT_PRICE_REFUSAL.error, 403, RETURN_REPLACEMENT_PRICE_REFUSAL.code, undefined, { product_id: offender.productId })
    }
  }
  return infos
}

// ---- the refund credit of a cancelled exchange (6.0.963) -----------------------------------------------------------------------------------------
// A one-step exchange pays its replacement sale partly with the refund it books: the first tender row of the sale is that credit (flagged
// refund_credit). Cancelling the return cancels the refund, so the credit no longer pays for anything: owner, 22 Oct 2026, "Mark it Not Paid".
// The credit row leaves the sale's payments, the sale reads Not Paid for that share (the existing Not Paid rules: receivables, the drawer's cash
// tenders and the reports all read the sale as stored), and a take-back return of the sale splits its refund again, debt first, against the sale as
// it now stands -- so the customer ends up having paid for exactly what they keep. Nothing is deleted: the exact columns on both sides ride in the
// snapshot, which is what undo and redo replay, and the Records line of the sale shows its payment state moving.
const CREDIT_TOLERANCE = 0.005
const money4 = (value: number): number => Math.round(value * 10000) / 10000

type TenderRow = { method?: unknown; amount_usd?: unknown; amount_khr?: unknown; refund_credit?: unknown }

// ONLY the flag identifies the credit row (6.0.964). Matching the first row by amount would take a customer's own cash payment of the same size for the credit
// and delete it; no exchange without the flag exists (v1 exchanges are new), so there is nothing a guess would be needed for.
function creditRowIndex(rows: TenderRow[]): number {
  return rows.findIndex((row) => row && row.refund_credit === true)
}

async function planCreditReversals(request: BulkRequest, members: Member[], replacement: Map<number, ReplacementInfo>): Promise<SaleStatusSnapshot[]> {
  if (request.field !== 'status' || request.target !== 'cancelled') return []
  const events: SaleStatusSnapshot[] = []
  for (const member of members) {
    if (member.linked || !member.changed || member.scope !== 'customer') continue
    const info = replacement.get(member.id)
    const sale = info?.money
    if (!info || !sale || info.money_precision_version !== 1 || sale.source_return_id !== member.id || normalize(sale.sale_status) === 'cancelled') continue
    const creditUsd = money4(sale.refund_usd - sale.refund_owed_usd)
    if (!(creditUsd > 0)) continue
    let rows: TenderRow[]
    try { rows = JSON.parse(sale.payment_details || '[]') } catch { continue }
    if (!Array.isArray(rows)) continue
    const index = creditRowIndex(rows)
    if (index < 0) continue
    // The change handed out beside the credit is cash that left the drawer against a sale the credit no longer pays: the debt would have to carry it and
    // every settlement path keep it. Until it does, cancelling such an exchange is refused whole (6.0.964, release review P1-1).
    if (sale.change_usd > 0 || sale.change_khr > 0) {
      fail('This exchange gave change back. Cancel its replacement sale in Sales first, then cancel this return.', 409, 'return_cancel_exchange_change')
    }
    const credit = Number(rows[index].amount_usd) || 0
    const rest = rows.filter((_, position) => position !== index)
    const before: SaleCreditState = {
      payment_method: sale.payment_method, payment_details: sale.payment_details, amount_paid_usd: sale.amount_paid_usd,
      amount_paid_khr: sale.amount_paid_khr, sale_status: normalize(sale.sale_status, 'completed'),
    }
    const paidUsd = Math.max(0, money4(sale.amount_paid_usd - credit))
    const rate = sale.exchange_rate > 0 ? sale.exchange_rate : 0
    const owed = money4(sale.total_usd - paidUsd - (sale.amount_paid_khr && rate ? sale.amount_paid_khr / rate : 0))
    const methods = [...new Set(rest.map((row) => String(row.method ?? '')).filter(Boolean))]
    const after: SaleCreditState = {
      payment_method: methods.join(' + ') || null, payment_details: JSON.stringify(rest), amount_paid_usd: paidUsd, amount_paid_khr: sale.amount_paid_khr,
      sale_status: before.sale_status === 'completed' && owed > CREDIT_TOLERANCE ? 'awaiting_payment' : before.sale_status,
    }
    member.credit = { saleId: info.sale_id, usd: credit, before, after }
    // A take-back of the replacement was refunded as if the credit had been paid in cash: split it again, debt first, against the sale as it stands now.
    const takeBacks = members.filter((candidate) => candidate.linked && candidate.saleId === info.sale_id)
    if (takeBacks.length) {
      const stored = sale.stored
      {
        const ids = takeBacks.map((candidate) => candidate.id).sort((a, b) => a - b)
        let plan: ReturnType<typeof planReturnMoney>
        try {
          plan = planReturnMoney({
            sale: { ...stored.sale, sale_status: after.sale_status, amount_paid_usd: after.amount_paid_usd, amount_paid_khr: after.amount_paid_khr },
            returns: stored.returns.map((row) => ({ id: Number(row.id), active: normalize(row.status, 'completed') !== 'cancelled', refundUsd: row.total_refund_usd,
              owedReductionUsd: row.owed_reduction_usd, currency: row.refund_currency ?? 'USD' })),
            recompute: ids,
          })
        } catch (error) {
          if (error instanceof ReturnMoneyError) fail(error.message, 409, error.code)
          throw error
        }
        for (const takeBack of takeBacks) {
          const row = stored.returns.find((candidate) => Number(candidate.id) === takeBack.id)
          if (!row || !plan.owedReductionUsd.has(takeBack.id)) continue
          const currency = row.refund_currency == null ? null : String(row.refund_currency)
          takeBack.money = {
            before: { owed_reduction_usd: Number(row.owed_reduction_usd) || 0, refund_currency: currency },
            after: { owed_reduction_usd: plan.owedReductionUsd.get(takeBack.id)!, refund_currency: currency ?? 'USD' },
          }
        }
      }
    }
    const stateOf = (status: string) => saleReturnRecordWord({ saleStatus: status, returnState: sale.return_state === 'full' || sale.return_state === 'partial' ? sale.return_state : null, deliveryPending: false })
    events.push({ saleId: info.sale_id, before: stateOf(before.sale_status), after: stateOf(after.sale_status), paymentBefore: before.sale_status, paymentAfter: after.sale_status })
  }
  return events
}

/**
 * Restoring an exchange return whose credit was reversed would book its refund again with nothing paying the replacement sale for it. The way back
 * is the Undo of the cancel, which puts the credit and the take-backs back exactly; a restore from the list is refused whole.
 */
async function refuseRestoreWithoutCredit(db: D1Compat, request: BulkRequest, returns: Row[]): Promise<void> {
  if (request.field !== 'status' || request.target !== 'completed') return
  const ids = request.items.map((item) => item.id).filter((id) => returns.some((row) => Number(row.id) === id && Number(row.replacement_sale_id) > 0 && normalize(row.status, 'completed') === request.source))
  if (!ids.length) return
  const sales = await rowsForIds<Row>(db, ids, (marks) => `SELECT s.source_return_id,s.payment_details,s.sale_status,s.money_precision_version FROM sales s WHERE s.source_return_id IN (${marks})`)
  for (const sale of sales) {
    const returnRow = returns.find((row) => Number(row.id) === Number(sale.source_return_id))
    if (!returnRow || Number(sale.money_precision_version) !== 1 || normalize(sale.sale_status) === 'cancelled') continue
    const creditUsd = money4((Number(returnRow.total_refund_usd) || 0) - (Number(returnRow.owed_reduction_usd) || 0))
    if (!(creditUsd > 0)) continue
    let rows: TenderRow[] = []
    try { rows = JSON.parse(String(sale.payment_details || '[]')) } catch { rows = [] }
    if (Array.isArray(rows) && creditRowIndex(rows) >= 0) continue
    fail('This exchange return was cancelled and its refund credit was moved to Not Paid. Undo that cancel from the history instead of restoring the return here. Nothing was changed.', 409, 'return_restore_exchange_credit')
  }
}

async function buildMembers(db: D1Compat, request: BulkRequest, redirectTarget: number | null = null, user?: SessionUser): Promise<{ members: Member[]; guards: Statement[]; replacement: Map<number, ReplacementInfo>; memberGuards: Map<number, Statement> }> {
  const ids = request.items.map((item) => item.id)
  // The returns the till made to take replacement units back are read, guarded and stocked together with the selected ones.
  const linkedIds = [...new Set(request.items.flatMap((item) => item.replacement?.return_ids ?? []))].sort((a, b) => a - b)
  if (linkedIds.some((id) => ids.includes(id))) fail('A replacement return cannot also be one of the selected returns.', 400, 'return_cancel_replacement_invalid')
  if (ids.length + linkedIds.length > RETURN_BULK_LIMIT) fail(`Select between 1 and ${RETURN_BULK_LIMIT} returns including their replacement returns.`, 400)
  const returns = await rowsForIds<Row>(db, [...ids, ...linkedIds], (marks) => `SELECT r.*,COALESCE(v.revision,0) AS write_revision,${movementFingerprint('r.id')} AS movement_fingerprint FROM returns r LEFT JOIN return_write_revisions v ON v.return_id=r.id WHERE r.id IN (${marks})`)
  await refuseRestoreWithoutCredit(db, request, returns)
  const replacement = request.field === 'status' && request.target === 'cancelled'
    ? await planReplacementChoices(db, request, returns, user)
    : new Map<number, ReplacementInfo>()
  for (const id of linkedIds) {
    if (!returns.some((candidate) => Number(candidate.id) === id)) fail(`Return ${id} changed. The entire group was rejected; refresh before retrying.`)
  }
  const requestedMatching = request.items.flatMap((expected) => {
    const row = returns.find((candidate) => Number(candidate.id) === expected.id)
    if (!row) fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    const scope = normalize(row.return_scope, 'customer') === 'supplier' ? 'supplier' : 'customer'
    const current = request.field === 'status' ? normalize(row.status, 'completed') : normalize(row[request.field], request.field === 'supplier_settlement' ? 'refund' : 'manual')
    return (request.field === 'status' || request.field === methodField(scope)) && current === request.source ? [expected.id] : []
  })
  const matchingIds = [...requestedMatching, ...linkedIds]
  if (returns.some((row) => matchingIds.includes(Number(row.id)) && row.movement_fingerprint === null)) fail(`A matching return exceeds ${RETURN_BULK_MOVEMENT_LIMIT} stock movements.`, 400)
  const items = await rowsForIds<ReturnItem>(db, matchingIds, (marks) => `SELECT ri.* FROM return_items ri WHERE ri.return_id IN (${marks}) ORDER BY ri.id LIMIT 301`)
  if (items.length > 300) fail('Select fewer return lines (maximum 300).', 400)
  const allocations = await rowsForIds<Allocation>(db, matchingIds, (marks) => `SELECT a.* FROM return_item_batch_allocations a JOIN return_items ri ON ri.id=a.return_item_id WHERE ri.return_id IN (${marks}) ORDER BY a.id LIMIT 401`)
  if (allocations.length > 400) fail('Select fewer received-date allocations to return (maximum 400).', 400)
  const damaged = await rowsForIds<DamagedLot>(db, matchingIds, (marks) => `SELECT * FROM damaged_stock_lots WHERE return_id IN (${marks}) ORDER BY id LIMIT 301`)
  if (damaged.length > 300) fail('Select fewer damaged-stock rows.', 400)
  const trackedProducts = new Set<number>()
  if (matchingIds.length) {
    const tracked = await rowsForIds<{ id: number }>(db, matchingIds, (marks) => `SELECT DISTINCT pb.variant_product_id AS id FROM product_batches pb JOIN return_items ri ON ri.product_id=pb.variant_product_id WHERE ri.return_id IN (${marks})`)
    tracked.forEach((row) => trackedProducts.add(Number(row.id)))
  }
  const linkedSaleIds = [...new Set(returns.filter((row) => matchingIds.includes(Number(row.id))).map((row) => Number(row.sale_id)).filter((id) => id > 0))]
  const linkedSales = linkedSaleIds.length
    ? await rowsForIds<{ id: number; sale_status: string | null; status_before_return: string | null; stock_skipped: number | null; write_revision: number }>(db, linkedSaleIds, (marks) => `SELECT s.id,s.sale_status,s.status_before_return,s.stock_skipped,COALESCE(v.revision,0) AS write_revision FROM sales s LEFT JOIN sale_write_revisions v ON v.sale_id=s.id WHERE s.id IN (${marks})`)
    : []

  const members: Member[] = []
  const guards: Statement[] = []
  const memberGuards = new Map<number, Statement>()
  // A line recorded at a branch that has since been retired (Old Shop -> LC Store) moves its stock at the active
  // branch the operator confirmed (X-Branch-Redirect; branch_redirect_required until then), in the lot that exists
  // there now; the return keeps its own branch and label. While every branch is active nothing is redirected and
  // nothing below changes.
  const resolver = new BranchEffectResolver(await readBranchDirectory(db), redirectTarget)
  const work = [
    ...request.items.map((expected) => ({ expected, parent: null as number | null })),
    ...request.items.flatMap((item) => (item.replacement?.return_ids ?? []).map((id) => ({
      expected: { id, expected_status: 'completed', expected_method: '', expected_updated_at: null as string | null }, parent: item.id as number | null,
    }))),
  ]
  for (const { expected, parent } of work) {
    const row = returns.find((candidate) => Number(candidate.id) === expected.id)
    if (!row) {
      fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    }
    const scope: Member['scope'] = normalize(row.return_scope, 'customer') === 'supplier' ? 'supplier' : 'customer'
    const linked = parent !== null
    const linkedTo = parent !== null ? replacement.get(parent) : undefined
    if (parent !== null) {
      // Only a completed customer return of THIS exchange's replacement sale, taking back only units that sale sold as this exchange's lines.
      const lineIds = new Set((linkedTo?.lines ?? []).map((line) => line.sale_item_id))
      const own = items.filter((item) => item.return_id === expected.id)
      if (scope !== 'customer' || !linkedTo || normalize(row.status, 'completed') !== 'completed' || Number(row.sale_id) !== linkedTo.sale_id || expected.id < parent
        || !own.length || own.some((item) => !lineIds.has(Number(item.sale_item_id)))) {
        fail(`Return ${expected.id} is not a return of the replacement items of return ${parent}.`, 409, 'return_cancel_replacement_invalid')
      }
    }
    // A linked return is the cancelled side of this action's undo: before the action it did not exist as completed, after it is (see Member.linked).
    const before = linked ? { ...valueSnapshot(row), status: 'cancelled' } : valueSnapshot(row)
    const current = request.field === 'status' ? before.status : before[request.field]
    const fieldMatchesScope = request.field === 'status' || request.field === methodField(scope)
    const changed = linked || (fieldMatchesScope && current === request.source)
    if (!linked && changed && (before.status !== expected.expected_status || methodValue(row) !== expected.expected_method || (row.updated_at ?? null) !== expected.expected_updated_at)) {
      fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    }
    const after = linked ? { ...before, status: 'completed' } : { ...before, ...(changed ? { [request.field]: request.target } : {}) }
    const member: Member = {
      id: expected.id,
      returnNumber: String(row.return_number || expected.id),
      saleId: Number(row.sale_id) || null,
      saleRevision: null,
      moneyPrecisionVersion: Number(row.money_precision_version) || 0,
      scope,
      before,
      after,
      changed,
      reason: changed ? 'changed' : fieldMatchesScope ? 'source_mismatch' : 'scope_mismatch',
      updateSale: false,
      stock: [],
      ...(linked ? { linked: true as const } : {}),
    }
    if (changed) {
      // One guard statement per changed return (the revision it was read at and the stock movements it carries): every statement counts against a Free invocation.
      const memberGuard = guard(`NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance') AND EXISTS(SELECT 1 FROM returns WHERE id=@id) AND COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0)=@revision AND ${movementFingerprint('@id')}=@fingerprint`,
        { id: expected.id, revision: Number(row.write_revision) || 0, fingerprint: row.movement_fingerprint })
      guards.push(memberGuard)
      memberGuards.set(expected.id, memberGuard)
    }

    if (changed && request.field === 'status') {
      const cancelling = before.status === 'completed' && after.status === 'cancelled'
      const restoring = before.status === 'cancelled' && after.status === 'completed'
      if (!cancelling && !restoring) fail(`Return ${expected.id} has an unsupported status transition.`, 400)
      const linkedSale = member.saleId ? linkedSales.find((sale) => Number(sale.id) === member.saleId) : null
      member.saleRevision = linkedSale ? Number(linkedSale.write_revision) || 0 : null
      if (linkedSale) guards.push(guard("EXISTS(SELECT 1 FROM sales WHERE id=@saleId) AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0)=@saleRevision", { saleId: linkedSale.id, saleRevision: linkedSale.write_revision }))
      // RET-B E1 (owner default D1, 5 Oct 2026): a sale recorded without stock
      // changes (stock_skipped -- every sales import since F4) never took its
      // units off the shelf, so cancelling or restoring its return cannot infer
      // which way stock should move. Refused with a code the till translates.
      if (linkedSale && Number(linkedSale.stock_skipped) === 1) fail(`Return ${expected.id} belongs to a stock-skipped sale (recorded without stock changes, such as an imported sale). Cancelling or restoring it would move stock that never moved, so nothing was changed.`, 409, 'return_stock_skipped_sale')
      const parentCancelled = normalize(linkedSale?.sale_status) === 'cancelled'
      if (linkedSale && parentCancelled) {
        fail(`Return ${expected.id} belongs to a cancelled sale. Restore the sale before changing this return status.`, 409)
      }
      if (linkedSale && !parentCancelled && ['returned', 'partial_return'].includes(normalize(linkedSale.sale_status)) && !normalize(linkedSale.status_before_return)) {
        fail(`Return ${expected.id} belongs to a historical sale whose pre-return status was not recorded. Change it individually after confirming the original sale state.`, 409)
      }
      member.updateSale = !!linkedSale && !parentCancelled
      const ownItems = items.filter((item) => item.return_id === expected.id)
      const handledDamagedGroups = new Set<string>()
      const memberStockStart = member.stock.length
      const landings = new Map<number, { effectName: string | null; label: string | null }>()
      for (const item of ownItems) {
        const quantity = Number(item.quantity) || 0
        if (!(quantity > 0)) continue
        const productId = Number(item.product_id) || 0
        const recordedBranchId = Number(item.branch_id || row.branch_id) || 0
        if (!productId || !recordedBranchId) fail(`Return ${expected.id} has a stock-moving line without a product or branch.`, 400)
        const stockAction = normalize(item.stock_action, Number(item.return_to_stock) === 1 ? 'restock' : 'none')
        if (scope === 'customer' && stockAction === 'none') continue
        let landing: ReturnType<BranchEffectResolver['effect']> = null
        try { landing = resolver.effect(recordedBranchId) } catch (error) {
          if (error instanceof BranchRetiredNoSuccessorError) fail(error.message, 409, error.code, undefined, error.redirect ? { redirect: error.redirect } : undefined)
          throw error
        }
        // The branch the stock moves at; `recordedBranchId` stays the one the rows were written under.
        const branchId = landing?.redirected ? landing.effectBranchId : recordedBranchId
        if (landing?.redirected) {
          // Held (damaged) units still at the retired branch refuse; units the cutover moved to the successor are found at the landing branch below.
          if (scope === 'customer' && stockAction === 'damaged' && !damaged.some((lot) => Number(lot.return_id) === expected.id && Number(lot.product_id) === productId && Number(lot.branch_id) === branchId)) fail(BRANCH_RETIRED_DAMAGED_ERROR, 409, BRANCH_RETIRED_DAMAGED_CODE)
          const ownLabel = Number(row.branch_id) === landing.addressedBranchId && typeof row.branch_name === 'string' && row.branch_name ? row.branch_name : null
          landings.set(branchId, { effectName: landing.effectName, label: ownLabel ?? landing.addressedName ?? landing.effectName })
        }
        if (scope === 'customer' && stockAction === 'damaged') {
          const damagedGroup = `${productId}:${branchId}`
          if (handledDamagedGroups.has(damagedGroup)) continue
          handledDamagedGroups.add(damagedGroup)
          const groupedItems = ownItems.filter((candidate) => Number(candidate.product_id) === productId
            && (resolver.effectId(Number(candidate.branch_id || row.branch_id)) ?? Number(candidate.branch_id || row.branch_id)) === branchId
            && normalize(candidate.stock_action, Number(candidate.return_to_stock) === 1 ? 'restock' : 'none') === 'damaged')
          const lots = damaged.filter((lot) => Number(lot.return_id) === expected.id && Number(lot.product_id) === productId && Number(lot.branch_id) === branchId)
          if (!lots.length) fail(`Return ${expected.id} has no damaged-stock provenance and cannot change status safely.`, 400)
          const itemQuantity = groupedItems.reduce((sum, candidate) => sum + (Number(candidate.quantity) || 0), 0)
          const lotQuantity = lots.reduce((sum, lot) => sum + (Number(lot.quantity) || 0), 0)
          if (Math.abs(itemQuantity - lotQuantity) > 0.000001) fail(`Return ${expected.id} has incomplete damaged-stock provenance.`, 400)
          const costUsd = groupedRecordedCost(groupedItems, 'cost_price_usd', itemQuantity)
          const costKhr = groupedRecordedCost(groupedItems, 'cost_price_khr', itemQuantity)
          for (const lot of lots) {
            if ((cancelling || linked) && Number(lot.quantity_remaining) !== Number(lot.quantity)) fail(`Damaged stock from return ${expected.id} has already been consumed.`, 409)
            if (restoring && !linked && Number(lot.quantity_remaining) !== 0) fail(`Damaged stock from return ${expected.id} is not fully cancelled.`, 409)
            member.stock.push({ productId, productName: item.product_name, branchId, batchId: lot.batch_id, damagedLotId: lot.id, quantity: cancelling ? -Number(lot.quantity) : Number(lot.quantity), costUsd, costKhr, movementType: '' })
          }
          continue
        }
        const ownAllocations = allocations.filter((allocation) => allocation.return_item_id === item.id)
        if (ownAllocations.length) {
          const allocated = ownAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0)
          if (Math.abs(allocated - quantity) > 0.000001) fail(`Return ${expected.id} has incomplete received-date provenance.`, 400)
          for (const allocation of ownAllocations) {
            if (Number(allocation.branch_id) !== recordedBranchId) fail(`Return ${expected.id} has a lot allocation for a different branch.`, 400)
            member.stock.push({ productId, productName: item.product_name, branchId, batchId: Number(allocation.batch_id), damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * Number(allocation.quantity), costUsd: recordedCost(item.cost_price_usd), costKhr: recordedCost(item.cost_price_khr), movementType: '' })
          }
        } else if (item.batch_id) {
          member.stock.push({ productId, productName: item.product_name, branchId, batchId: Number(item.batch_id), damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * quantity, costUsd: recordedCost(item.cost_price_usd), costKhr: recordedCost(item.cost_price_khr), movementType: '' })
        } else if (trackedProducts.has(productId)) {
          fail(`Return ${expected.id} predates exact received-date tracking. Its stock cannot be changed safely in bulk; edit stock with the recorded received-date details first.`, 400)
        } else {
          member.stock.push({ productId, productName: item.product_name, branchId, batchId: null, damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * quantity, costUsd: recordedCost(item.cost_price_usd), costKhr: recordedCost(item.cost_price_khr), movementType: '' })
        }
      }
      for (const [landingBranchId, { effectName, label }] of landings) {
        const own = member.stock.slice(memberStockStart).filter((delta) => delta.branchId === landingBranchId)
        const folded = await foldedLotSurvivors(db, landingBranchId, own.filter((delta) => delta.batchId).map((delta) => Number(delta.batchId)))
        for (const delta of own) {
          if (delta.batchId) delta.batchId = folded.get(Number(delta.batchId)) ?? delta.batchId
          delta.branchName = effectName
          delta.addressed = label ?? effectName ?? 'retired branch'
        }
      }
    }
    members.push(member)
  }
  const effectGuards = resolver.guards()
  if (effectGuards.length) guards.push(guard(branchEffectGuardPredicate('@effects'), { effects: JSON.stringify(effectGuards) }))
  return { members, guards, replacement, memberGuards }
}

export async function notifyReturnBulkAction(env: Env): Promise<void> {
  await Promise.allSettled([
    bumpVersion(env, 'returns'), bumpVersion(env, 'products'), bumpVersion(env, 'sales'),
    ...(['returns', 'products', 'inventory', 'sales'] as const).map((channel) => broadcast(env, channel, { action: 'update' })),
  ])
}

/**
 * The take-back the till announces is made BEFORE the cancel, in invocations of its own. On a plan that runs few D1 queries per invocation (Free: 50) one
 * return fits only one line (the return's own admission, test-return-exchange-cancel-free-native.cjs), so the till makes one single-line return per ticked line
 * -- each a complete return of the replacement sale, with its own request id -- and the cancel links them all in one batch whose size no longer grows with them
 * (6.0.966). A plan with room (Paid: 1000) takes all the lines as ONE return. The dry run therefore counts the returns the till will make, and refuses, before
 * anything is made, a selection that would link more returns than one action may carry.
 */
const SMALL_PLAN_QUERY_LIMIT = 200
function takeBackPerLine(env: Env): boolean {
  return getPlanLimits(env).d1QueriesPerInvocation < SMALL_PLAN_QUERY_LIMIT
}
function assertTakeBackFitsPlan(env: Env, request: BulkRequest): void {
  const perLine = takeBackPerLine(env)
  let announced = 0
  for (const item of request.items) {
    const lines = item.replacement?.planned?.length ?? 0
    const returns = (item.replacement?.return_ids.length ?? 0) + (perLine ? lines : Math.min(lines, 1))
    if (returns > REPLACEMENT_RETURNS_PER_ITEM) {
      fail('This return is too large for the current plan. Return fewer items or received dates, then try again.', 400, 'customer_return_over_plan_budget')
    }
    announced += perLine ? lines : Math.min(lines, 1)
  }
  if (request.items.length + announced > RETURN_BULK_LIMIT) fail(`Select between 1 and ${RETURN_BULK_LIMIT} returns including their replacement returns.`, 400)
}

export async function applyReturnBulkAction(env: Env, user: SessionUser, raw: Row, redirectTarget: number | null = null, queryBudget?: ReturnBulkQueryBudget): Promise<Row> {
  return (await applyReturnBulkActionOutcome(env, user, raw, redirectTarget, queryBudget)).receipt
}

/**
 * The receipt, and whether THIS call's own batch wrote it. `wrote` is false
 * for every replay of a request id: a sequential retry (early replay below),
 * a retry that overtook a slow original, and the original overtaken by its
 * retry (either replay path). routes/returns.ts announces a status change to
 * Telegram only when `wrote` is true, so one write is announced once even
 * when the app's own retry (Returns.tsx, same client_request_id after its
 * client timeout) races the first request (R-telegram E1, 27 Sep 2026). A
 * check made BEFORE the write cannot say this; only the batch outcome can.
 */
export type ReturnBulkOutcome = { receipt: Row; wrote: boolean }

export async function applyReturnBulkActionOutcome(env: Env, user: SessionUser, raw: Row, redirectTarget: number | null = null, queryBudget?: ReturnBulkQueryBudget): Promise<ReturnBulkOutcome> {
  permission(user)
  const request = parseRequest(raw)
  if (request.dry_run) assertTakeBackFitsPlan(env, request)
  const db = getDb(env)
  const canonical = JSON.stringify(request)
  const previous = request.dry_run ? undefined : await db.prepare('SELECT request_json,receipt_json FROM return_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
  if (previous) {
    if (previous.request_json !== canonical) fail('Request id was already used with different data.')
    return { receipt: JSON.parse(String(previous.receipt_json)) as Row, wrote: false }
  }
  const { members, guards, replacement, memberGuards } = await buildMembers(db, request, redirectTarget, user)
  // What the operator selected is what the receipt, the counts and the Telegram alert speak of; the linked replacement returns ride in the snapshot.
  const selected = members.filter((member) => !member.linked)
  const entitlement = await v1EntitlementGuards(db, members, 'after')
  guards.push(...entitlement.guards)
  const operationId = crypto.randomUUID()
  const stamp = new Date().toISOString()
  const saleRows = request.field === 'status' ? await saleTagRows(db, selected, 'after') : []
  if (request.field === 'status') await planStatusMoney(db, members)
  const creditEvents = await planCreditReversals(request, members, replacement)
  for (const member of members) {
    if (!member.credit) continue
    const check = creditStatePredicate(member.credit.before, member.credit.saleId)
    mergeGuard(memberGuards.get(member.id)!, check.predicate, check.params)
  }
  const snapshot: Snapshot = { version: 1, operationId, field: request.field, members, tagged: true,
    saleStatuses: saleRows.map(row => {
      const stored = saleStoredState(row)
      const tag = entitlement.exactTags.has(row.saleId) ? entitlement.exactTags.get(row.saleId)! : row.tagAfter
      return { saleId: row.saleId, before: saleReturnRecordWord(stored), after: saleReturnRecordWord({ ...stored, returnState: tag }) }
    }).concat(creditEvents) }
  const changedIds = selected.filter((member) => member.changed).map((member) => member.id)
  const unchangedIds = selected.filter((member) => !member.changed).map((member) => member.id)
  const receipt = {
    operationId,
    changedIds,
    unchangedIds,
    changedCount: changedIds.length,
    unchangedCount: unchangedIds.length,
    currentReplayGeneration: 0,
    items: selected.map((member) => ({
      id: member.id,
      return_number: member.returnNumber,
      before: request.field === 'status' ? member.before.status : member.before[request.field],
      after: request.field === 'status' ? member.after.status : member.after[request.field],
      changed: member.changed,
      reason: member.reason,
    })),
  }
  const statements: Statement[] = [
    ...mergeGuards(guards),
    { sql: 'INSERT INTO return_bulk_operations(id,actor_id,request_id,request_json,receipt_json) VALUES(@id,@actor,@request,@canonical,@receipt)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical, receipt: JSON.stringify(receipt) } },
  ]
  statements.push(...memberGroupStatements(members, 1, user, stamp, true))
  for (const row of saleRows) statements.push(saleTagStatement(row, stamp, entitlement.exactTags))
  const recordEvents = returnSaleRecordEvents(snapshot, 0, 'apply', user, stamp)
  if (recordEvents) statements.push(recordEvents.statement)
  statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: RETURN_BULK_ACTION_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: actorSnapshot(user) } })
  statements.push({ sql: 'UPDATE return_bulk_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })
  const historyIndex = statements.length
  statements.push({
    sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
          SELECT 'returns','return',id,@label,@reversible,@status,
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'field',@field,'source',@source,'target',@target,'changed_count',@changed,'unchanged_count',@unchanged),
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'field',@field,'source',@source,'target',@target,'changed_count',@changed,'unchanged_count',@unchanged),
            @actor,@name FROM return_bulk_operations WHERE id=@id`,
    params: { id: operationId, label: `${changedIds.length} returns: ${request.field} ${request.source} → ${request.target}; ${unchangedIds.length} unchanged${members.some(member => member.linked) ? `; ${members.filter(member => member.linked).length} replacement return(s) taken back with it` : ''}${members.some(member => member.credit) ? `; refund credit of ${members.filter(member => member.credit).length} replacement sale(s) moved to Not Paid` : ''}`, reversible: changedIds.length ? 1 : 0, status: changedIds.length ? 'undoable' : 'recorded', kind: RETURN_BULK_ACTION_KIND, field: request.field, source: request.source, target: request.target, changed: changedIds.length, unchanged: unchangedIds.length, actor: user.id, name: actorSnapshot(user) },
  })
  statements.push({ sql: "UPDATE return_bulk_operations SET history_id=last_insert_rowid(),receipt_json=json_set(receipt_json,'$.actionHistoryId',last_insert_rowid()) WHERE id=@id", params: { id: operationId } })
  const changedMembers = members.filter((candidate) => candidate.changed)
  if (changedMembers.length) {
    const memberId = "json_extract(j.value,'$.id')"
    const memberSale = "json_extract(j.value,'$.saleId')"
    statements.push({ sql: `INSERT INTO return_bulk_members(operation_id,return_id,revision,sale_id,sale_revision,stock_fingerprint)
      SELECT @operation,${memberId},COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=${memberId}),0),${memberSale},
        CASE WHEN ${memberSale} IS NULL THEN NULL ELSE COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=${memberSale}),0) END,${movementFingerprint(memberId)}
      FROM json_each(@members) j ORDER BY CAST(j.key AS INTEGER)`, params: { operation: operationId, members: JSON.stringify(changedMembers.map((member) => ({ id: member.id, saleId: member.saleId }))) } })
  }
  statements.push(auditStatement(user, operationId, 'return_fields_bulk', changedIds.length))
  statements.push({ sql: 'DELETE FROM return_bulk_guards', params: {} })
  assertBounded(statements, snapshot, recordEvents?.eventsBytes || 0)
  if (request.dry_run) {
    // A take-back the till announces becomes a linked member of this action: its guard, its split update and its membership row ride in the statements above.
    const announced = request.items.filter((item) => item.replacement?.planned?.length).length
    if (queryBudget) assertReturnBulkBudget(env, queryBudget.statementsUsed(), members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length + announced) : statements.length + announced, queryBudget.reserveStatements)
    // takeBackPerLine tells the till how to make the take-backs it announced: one return per line on a plan this small, one return for all the lines otherwise.
    return { receipt: { dryRun: true, ok: true, statements: statements.length + announced, takeBackPerLine: takeBackPerLine(env) }, wrote: false }
  }
  if (queryBudget) assertReturnBulkBudget(env, queryBudget.statementsUsed(), members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) : statements.length, queryBudget.reserveStatements)
  try {
    const results = await (members.some(member => member.stock.length > 0) ? executeStockTransaction(db, statements, 'retry') : db.batch(statements))
    return { receipt: { ...receipt, actionHistoryId: Number(results[historyIndex].meta.last_row_id) }, wrote: true }
  } catch (error) {
    const retry = await db.prepare('SELECT request_json,receipt_json FROM return_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
    if (retry?.request_json === canonical) {
      const stored = JSON.parse(String(retry.receipt_json)) as Row
      // operationId is this call's own random UUID: the stored receipt carries
      // it only when THIS batch committed and the error came after the commit.
      // Any other receipt was written by a concurrent call with the same id.
      return { receipt: stored, wrote: stored.operationId === operationId }
    }
    const activeGuard = productStockGuardError(error)

    if (activeGuard) throw activeGuard

    if (/constraint/i.test(String(error))) fail('A return or its stock changed. Nothing in the group was applied.')
    throw error
  }
}

export async function replayReturnBulkAction(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row, queryBudget?: ReturnBulkQueryBudget): Promise<void> {
  permission(user)
  if (!Number.isSafeInteger(generation) || Number(generation) < 0) fail('Refresh history before replaying this group.')
  const db = getDb(env)
  const operation = await db.prepare('SELECT o.*,s.payload_json,s.kind,s.status AS snapshot_status FROM return_bulk_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.history_id=?').get<Row>([historyId])
  if (!operation || operation.kind !== RETURN_BULK_ACTION_KIND || operation.id !== payload.operation_id || operation.snapshot_id !== payload.snapshot_id || Number(operation.generation) !== Number(generation)) fail('This grouped Return action changed or its snapshot does not match.')
  const snapshot = JSON.parse(String(operation.payload_json)) as Snapshot
  if (snapshot.version !== 1 || snapshot.operationId !== operation.id || snapshot.members.length > RETURN_BULK_LIMIT) fail('Unsupported Return bulk snapshot.')
  const expectedStatus = direction === 'undo' ? 'undoable' : 'redoable'
  const nextStatus = direction === 'undo' ? 'redoable' : 'undoable'
  const snapshotStatus = direction === 'undo' ? 'applied' : 'reversed'
  const directionSign: 1 | -1 = direction === 'undo' ? -1 : 1
  const stamp = new Date().toISOString()
  const statements: Statement[] = [guard("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance') AND EXISTS(SELECT 1 FROM return_bulk_operations o JOIN action_history h ON h.id=o.history_id JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@operation AND o.generation=@generation AND h.id=@history AND h.status=@expectedStatus AND s.kind=@kind AND s.status=@snapshotStatus AND s.payload_json=@snapshot)", { operation: operation.id, generation, history: historyId, expectedStatus, kind: RETURN_BULK_ACTION_KIND, snapshotStatus, snapshot: operation.payload_json })]
  const replayEntitlement = await v1EntitlementGuards(db, snapshot.members, direction === 'undo' ? 'before' : 'after')
  statements.push(...replayEntitlement.guards)
  const replayGuards: Statement[] = []
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) {
    const replayGuard = guard(`EXISTS(SELECT 1 FROM returns r JOIN return_bulk_members m ON m.return_id=r.id WHERE m.operation_id=@operation AND r.id=@id AND m.revision=COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=r.id),0) AND m.stock_fingerprint=${movementFingerprint('r.id')} AND (m.sale_id IS NULL OR (EXISTS(SELECT 1 FROM sales WHERE id=m.sale_id) AND m.sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=m.sale_id),0))))`, { operation: operation.id, id: member.id })
    if (member.credit) {
      const check = creditStatePredicate(directionSign > 0 ? member.credit.before : member.credit.after, member.credit.saleId)
      mergeGuard(replayGuard, check.predicate, check.params)
    }
    replayGuards.push(replayGuard)
  }
  statements.push(...mergeGuards(replayGuards))
  statements.push(...memberGroupStatements(snapshot.members, directionSign, user, stamp))
  // The tag is derived again from the returns as the replay leaves them, never copied from the snapshot:
  // snapshots written before 0263 carry retired status words.
  const replaySales = snapshot.tagged
    ? [...new Set(snapshot.members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]
      .map((saleId): SaleTagRow => ({ saleId, sale_status: null, status_before_return: null, return_state: null, delivery_pending: null, tagAfter: null }))
    : await saleTagRows(db, snapshot.members, direction === 'undo' ? 'before' : 'after')
  for (const row of replaySales) statements.push(saleTagStatement(row, stamp, replayEntitlement.exactTags))
  const nextGeneration = Number(generation) + 1
  const recordEvents = returnSaleRecordEvents(snapshot, nextGeneration, direction, user, stamp)
  if (recordEvents) statements.push(recordEvents.statement)
  const replayedIds = snapshot.members.filter((candidate) => candidate.changed).map((member) => member.id)
  if (replayedIds.length) statements.push({ sql: `UPDATE return_bulk_members SET revision=COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=return_bulk_members.return_id),0),sale_revision=CASE WHEN sale_id IS NULL THEN NULL ELSE COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_write_revisions.sale_id=return_bulk_members.sale_id),0) END,stock_fingerprint=${movementFingerprint('return_bulk_members.return_id')} WHERE operation_id=@operation AND return_id IN (SELECT value FROM json_each(@ids))`, params: { operation: operation.id, ids: JSON.stringify(replayedIds) } })
  statements.push({ sql: 'UPDATE return_bulk_operations SET generation=generation+1 WHERE id=@operation', params: { operation: operation.id } })
  statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=@stamp WHERE id=@id', params: { id: operation.snapshot_id, status: direction === 'undo' ? 'reversed' : 'applied', stamp } })
  statements.push({ sql: "UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id", params: { id: historyId, status: nextStatus, stamp, generation: Number(generation) + 1 } })
  statements.push(auditStatement(user, String(operation.id), `action_${direction}`, snapshot.members.filter((member) => member.changed).length))
  statements.push({ sql: 'DELETE FROM return_bulk_guards', params: {} })
  assertBounded(statements, snapshot, recordEvents?.eventsBytes || 0)
  if (queryBudget) assertReturnBulkBudget(env, queryBudget.statementsUsed(), snapshot.members.some(member => member.stock.length > 0) ? stockTransactionStatementCount(statements.length) : statements.length, queryBudget.reserveStatements)
  try {
    await (snapshot.members.some(member => member.stock.length > 0) ? executeStockTransaction(db, statements, 'retry') : db.batch(statements))
  } catch (error) {
    const activeGuard = productStockGuardError(error)

    if (activeGuard) throw activeGuard

    if (/constraint/i.test(String(error))) fail('A return, its stock, or this replay changed. Nothing in the group was applied.')
    throw error
  }
}
