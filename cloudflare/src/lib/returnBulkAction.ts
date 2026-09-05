import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { bumpVersion } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'

export const RETURN_BULK_ACTION_KIND = 'return.fields.bulk'
export const RETURN_BULK_LIMIT = 25
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
  }>
}

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

type StockDelta = {
  productId: number
  productName: string | null
  branchId: number
  batchId: number | null
  damagedLotId: number | null
  quantity: number
  costUsd: number
  costKhr: number
  movementType: string
}

type Member = {
  id: number
  returnNumber: string
  saleId: number | null
  saleRevision: number | null
  scope: 'customer' | 'supplier'
  before: { status: string; return_type: string; supplier_settlement: string }
  after: { status: string; return_type: string; supplier_settlement: string }
  changed: boolean
  reason: 'changed' | 'source_mismatch' | 'scope_mismatch'
  updateSale: boolean
  stock: StockDelta[]
}

type Snapshot = { version: 1; operationId: string; field: ReturnField; members: Member[] }

export class ReturnBulkError extends Error {
  constructor(message: string, readonly statusCode: 400 | 403 | 409 = 409) {
    super(message)
  }
}

function fail(message: string, status: 400 | 403 | 409 = 409): never {
  throw new ReturnBulkError(message, status)
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

function parseRequest(raw: Row): BulkRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('A bulk return action is required.', 400)
  const allowed = ['client_request_id', 'field', 'source', 'target', 'items']
  if (Object.keys(raw).some((key) => !allowed.includes(key))) fail('Unsupported bulk return field.', 400)
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
    if (!item || typeof item !== 'object' || keys.some((key) => !['id', 'expected_status', 'expected_method', 'expected_updated_at'].includes(key))
      || !Number.isSafeInteger(id) || id <= 0 || ids.has(id)
      || typeof item.expected_status !== 'string' || typeof item.expected_method !== 'string'
      || !(typeof item.expected_updated_at === 'string' || item.expected_updated_at === null)) {
      fail('Unique return ids and expected states are required.', 400)
    }
    ids.add(id)
    return {
      id,
      expected_status: normalize(item.expected_status, 'completed'),
      expected_method: normalize(item.expected_method),
      expected_updated_at: item.expected_updated_at as string | null,
    }
  }).sort((left, right) => left.id - right.id)
  return { client_request_id: raw.client_request_id, field, source, target, items }
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

function stockStatements(member: Member, direction: 1 | -1, user: SessionUser, stamp: string): Statement[] {
  const out: Statement[] = []
  for (const delta of member.stock) {
    const quantity = delta.quantity * direction
    const params = {
      product: delta.productId,
      branch: delta.branchId,
      batch: delta.batchId,
      lot: delta.damagedLotId,
      quantity,
      stamp,
    }
    if (delta.damagedLotId) {
      out.push(guard('EXISTS(SELECT 1 FROM damaged_stock_lots WHERE id=@lot AND return_id=@returnId AND product_id=@product AND branch_id IS @branch AND (batch_id IS NULL OR EXISTS(SELECT 1 FROM product_batches WHERE id=damaged_stock_lots.batch_id AND variant_product_id=@product)) AND quantity_remaining+@quantity BETWEEN 0 AND quantity)', { ...params, returnId: member.id }))
      out.push({ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining+@quantity, updated_at=@stamp WHERE id=@lot', params })
    } else {
      out.push(guard('EXISTS(SELECT 1 FROM products WHERE id=@product AND stock_quantity+@quantity>=0) AND EXISTS(SELECT 1 FROM branches WHERE id=@branch) AND (@quantity>=0 OR EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND quantity+@quantity>=0))', params))
      out.push({
        sql: quantity < 0
          ? 'UPDATE branch_stock SET quantity=quantity+@quantity WHERE product_id=@product AND branch_id=@branch'
          : 'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(@product,@branch,@quantity) ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=quantity+@quantity',
        params,
      })
      out.push({ sql: 'UPDATE products SET stock_quantity=stock_quantity+@quantity, updated_at=@stamp WHERE id=@product', params })
      if (delta.batchId) {
        out.push(guard('EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND variant_product_id=@product) AND (@quantity>=0 OR EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND quantity+@quantity>=0))', params))
        out.push({
          sql: quantity < 0
            ? 'UPDATE branch_batch_stock SET quantity=quantity+@quantity,updated_at=@stamp WHERE batch_id=@batch AND branch_id=@branch'
            : 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(@batch,@branch,@quantity) ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+@quantity,updated_at=@stamp',
          params,
        })
      }
    }
    out.push({
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,movement_type,quantity,unit_cost_usd,unit_cost_khr,reason,reference_id,user_id,user_name,batch_id)
            VALUES(@product,@name,@branch,@type,@quantity,@usd,@khr,@reason,@returnId,@userId,@userName,@batch)`,
      params: {
        product: delta.productId,
        name: delta.productName,
        branch: delta.branchId,
        type: delta.damagedLotId ? (quantity > 0 ? 'damage_in' : 'damage_reversal') : statusMovementType(member.scope, quantity),
        quantity,
        usd: delta.costUsd,
        khr: delta.costKhr,
        reason: `${direction > 0 ? 'Apply' : 'Undo'} grouped return status`,
        returnId: member.id,
        userId: user.id ?? null,
        userName: user.name ?? null,
        batch: delta.batchId,
      },
    })
  }
  return out
}

function memberStatements(member: Member, direction: 1 | -1, user: SessionUser, stamp: string): Statement[] {
  if (!member.changed) return []
  const target = direction > 0 ? member.after : member.before
  return [
    ...stockStatements(member, direction, user, stamp),
    {
      sql: `UPDATE returns SET status=@status,return_type=@return_type,supplier_settlement=@supplier_settlement,updated_at=@stamp WHERE id=@id`,
      params: { ...target, stamp, id: member.id },
    },
  ]
}

function saleStatusStatement(saleId: number, stamp: string): Statement {
  return {
    sql: `UPDATE sales SET sale_status = CASE
            WHEN NOT EXISTS(SELECT 1 FROM returns r WHERE r.sale_id=@saleId AND COALESCE(r.status,'completed')!='cancelled' AND COALESCE(r.return_scope,'customer')='customer') THEN COALESCE(status_before_return,'completed')
            WHEN NOT EXISTS(
              SELECT 1 FROM sale_items si
              WHERE si.sale_id=@saleId AND COALESCE((
                SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id
                WHERE r.sale_id=@saleId AND COALESCE(r.status,'completed')!='cancelled' AND COALESCE(r.return_scope,'customer')='customer'
                  AND (ri.sale_item_id=si.id OR (ri.sale_item_id IS NULL AND ri.product_id=si.product_id))
              ),0) < si.quantity
            ) THEN 'returned'
            ELSE 'partial_return' END,
          updated_at=@stamp WHERE id=@saleId`,
    params: { saleId, stamp },
  }
}

function auditStatement(user: SessionUser, operationId: string, action: string, count: number): Statement {
  const details = JSON.stringify({ kind: RETURN_BULK_ACTION_KIND, count })
  return {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
          VALUES(@userId,@userName,@action,'return',@id,@details,'returns',@id,@details)`,
    params: { userId: user.id ?? null, userName: user.name ?? null, action, id: operationId, details },
  }
}

function assertBounded(statements: Statement[], snapshot: Snapshot): void {
  if (statements.length > 500 || new TextEncoder().encode(JSON.stringify(snapshot)).length > 512000) {
    fail('Selection is too large for one atomic action. Select fewer returns.', 400)
  }
}

function permission(user: SessionUser): void {
  if (getActionTier(user, 'returns', 'edit') !== 'full') fail('Full Access to Returns is required.', 403)
}

async function buildMembers(db: D1Compat, request: BulkRequest): Promise<{ members: Member[]; guards: Statement[] }> {
  const ids = request.items.map((item) => item.id)
  const returns = await rowsForIds<Row>(db, ids, (marks) => `SELECT r.*,COALESCE(v.revision,0) AS write_revision,${movementFingerprint('r.id')} AS movement_fingerprint FROM returns r LEFT JOIN return_write_revisions v ON v.return_id=r.id WHERE r.id IN (${marks})`)
  const matchingIds = request.items.flatMap((expected) => {
    const row = returns.find((candidate) => Number(candidate.id) === expected.id)
    if (!row) fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    const scope = normalize(row.return_scope, 'customer') === 'supplier' ? 'supplier' : 'customer'
    const current = request.field === 'status' ? normalize(row.status, 'completed') : normalize(row[request.field], request.field === 'supplier_settlement' ? 'refund' : 'manual')
    return (request.field === 'status' || request.field === methodField(scope)) && current === request.source ? [expected.id] : []
  })
  if (returns.some((row) => matchingIds.includes(Number(row.id)) && row.movement_fingerprint === null)) fail(`A matching return exceeds ${RETURN_BULK_MOVEMENT_LIMIT} stock movements.`, 400)
  const items = await rowsForIds<ReturnItem>(db, matchingIds, (marks) => `SELECT ri.* FROM return_items ri WHERE ri.return_id IN (${marks}) ORDER BY ri.id LIMIT 301`)
  if (items.length > 300) fail('Select fewer return lines (maximum 300).', 400)
  const allocations = await rowsForIds<Allocation>(db, matchingIds, (marks) => `SELECT a.* FROM return_item_batch_allocations a JOIN return_items ri ON ri.id=a.return_item_id WHERE ri.return_id IN (${marks}) ORDER BY a.id LIMIT 401`)
  if (allocations.length > 400) fail('Select fewer return lot allocations (maximum 400).', 400)
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
  for (const expected of request.items) {
    const row = returns.find((candidate) => Number(candidate.id) === expected.id)
    if (!row) {
      fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    }
    const scope: Member['scope'] = normalize(row.return_scope, 'customer') === 'supplier' ? 'supplier' : 'customer'
    const before = valueSnapshot(row)
    const current = request.field === 'status' ? before.status : before[request.field]
    const fieldMatchesScope = request.field === 'status' || request.field === methodField(scope)
    const changed = fieldMatchesScope && current === request.source
    if (changed && (before.status !== expected.expected_status || methodValue(row) !== expected.expected_method || (row.updated_at ?? null) !== expected.expected_updated_at)) {
      fail(`Return ${expected.id} changed. The entire group was rejected; refresh before retrying.`)
    }
    const after = { ...before, ...(changed ? { [request.field]: request.target } : {}) }
    const member: Member = {
      id: expected.id,
      returnNumber: String(row.return_number || expected.id),
      saleId: Number(row.sale_id) || null,
      saleRevision: null,
      scope,
      before,
      after,
      changed,
      reason: changed ? 'changed' : fieldMatchesScope ? 'source_mismatch' : 'scope_mismatch',
      updateSale: false,
      stock: [],
    }
    if (changed) {
      guards.push(guard("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore') AND EXISTS(SELECT 1 FROM returns WHERE id=@id) AND COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0)=@revision", { id: expected.id, revision: Number(row.write_revision) || 0 }))
      guards.push(guard(`${movementFingerprint('@id')}=@fingerprint`, { id: expected.id, fingerprint: row.movement_fingerprint }))
    }

    if (changed && request.field === 'status') {
      const cancelling = before.status === 'completed' && after.status === 'cancelled'
      const restoring = before.status === 'cancelled' && after.status === 'completed'
      if (!cancelling && !restoring) fail(`Return ${expected.id} has an unsupported status transition.`, 400)
      const linkedSale = member.saleId ? linkedSales.find((sale) => Number(sale.id) === member.saleId) : null
      member.saleRevision = linkedSale ? Number(linkedSale.write_revision) || 0 : null
      if (linkedSale) guards.push(guard("EXISTS(SELECT 1 FROM sales WHERE id=@saleId) AND COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0)=@saleRevision", { saleId: linkedSale.id, saleRevision: linkedSale.write_revision }))
      if (linkedSale && Number(linkedSale.stock_skipped) === 1) fail(`Return ${expected.id} belongs to a stock-skipped sale. Its stock provenance must be resolved before changing the return status.`, 409)
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
      for (const item of ownItems) {
        const quantity = Number(item.quantity) || 0
        if (!(quantity > 0)) continue
        const productId = Number(item.product_id) || 0
        const branchId = Number(item.branch_id || row.branch_id) || 0
        if (!productId || !branchId) fail(`Return ${expected.id} has a stock-moving line without a product or branch.`, 400)
        const stockAction = normalize(item.stock_action, Number(item.return_to_stock) === 1 ? 'restock' : 'none')
        if (scope === 'customer' && stockAction === 'none') continue
        if (scope === 'customer' && stockAction === 'damaged') {
          const damagedGroup = `${productId}:${branchId}`
          if (handledDamagedGroups.has(damagedGroup)) continue
          handledDamagedGroups.add(damagedGroup)
          const groupedItems = ownItems.filter((candidate) => Number(candidate.product_id) === productId
            && Number(candidate.branch_id || row.branch_id) === branchId
            && normalize(candidate.stock_action, Number(candidate.return_to_stock) === 1 ? 'restock' : 'none') === 'damaged')
          const lots = damaged.filter((lot) => Number(lot.return_id) === expected.id && Number(lot.product_id) === productId && Number(lot.branch_id) === branchId)
          if (!lots.length) fail(`Return ${expected.id} has no damaged-stock provenance and cannot change status safely.`, 400)
          const itemQuantity = groupedItems.reduce((sum, candidate) => sum + (Number(candidate.quantity) || 0), 0)
          const lotQuantity = lots.reduce((sum, lot) => sum + (Number(lot.quantity) || 0), 0)
          if (Math.abs(itemQuantity - lotQuantity) > 0.000001) fail(`Return ${expected.id} has incomplete damaged-stock provenance.`, 400)
          const costUsd = groupedItems.reduce((sum, candidate) => sum + (Number(candidate.cost_price_usd) || 0) * (Number(candidate.quantity) || 0), 0) / itemQuantity
          const costKhr = groupedItems.reduce((sum, candidate) => sum + (Number(candidate.cost_price_khr) || 0) * (Number(candidate.quantity) || 0), 0) / itemQuantity
          for (const lot of lots) {
            if (cancelling && Number(lot.quantity_remaining) !== Number(lot.quantity)) fail(`Damaged stock from return ${expected.id} has already been consumed.`, 409)
            if (restoring && Number(lot.quantity_remaining) !== 0) fail(`Damaged stock from return ${expected.id} is not fully cancelled.`, 409)
            member.stock.push({ productId, productName: item.product_name, branchId, batchId: lot.batch_id, damagedLotId: lot.id, quantity: cancelling ? -Number(lot.quantity) : Number(lot.quantity), costUsd, costKhr, movementType: '' })
          }
          continue
        }
        const ownAllocations = allocations.filter((allocation) => allocation.return_item_id === item.id)
        if (ownAllocations.length) {
          const allocated = ownAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0)
          if (Math.abs(allocated - quantity) > 0.000001) fail(`Return ${expected.id} has incomplete lot provenance.`, 400)
          for (const allocation of ownAllocations) {
            if (Number(allocation.branch_id) !== branchId) fail(`Return ${expected.id} has a lot allocation for a different branch.`, 400)
            member.stock.push({ productId, productName: item.product_name, branchId, batchId: Number(allocation.batch_id), damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * Number(allocation.quantity), costUsd: Number(item.cost_price_usd) || 0, costKhr: Number(item.cost_price_khr) || 0, movementType: '' })
          }
        } else if (item.batch_id) {
          member.stock.push({ productId, productName: item.product_name, branchId, batchId: Number(item.batch_id), damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * quantity, costUsd: Number(item.cost_price_usd) || 0, costKhr: Number(item.cost_price_khr) || 0, movementType: '' })
        } else if (trackedProducts.has(productId)) {
          fail(`Return ${expected.id} predates exact lot tracking. Its stock cannot be changed safely in bulk; edit stock with the recorded lot details first.`, 400)
        } else {
          member.stock.push({ productId, productName: item.product_name, branchId, batchId: null, damagedLotId: null, quantity: (scope === 'customer' ? (cancelling ? -1 : 1) : (cancelling ? 1 : -1)) * quantity, costUsd: Number(item.cost_price_usd) || 0, costKhr: Number(item.cost_price_khr) || 0, movementType: '' })
        }
      }
    }
    members.push(member)
  }
  return { members, guards }
}

export async function notifyReturnBulkAction(env: Env): Promise<void> {
  await Promise.allSettled([
    bumpVersion(env, 'returns'), bumpVersion(env, 'products'), bumpVersion(env, 'sales'),
    ...(['returns', 'products', 'inventory', 'sales'] as const).map((channel) => broadcast(env, channel, { action: 'update' })),
  ])
}

export async function applyReturnBulkAction(env: Env, user: SessionUser, raw: Row): Promise<Row> {
  permission(user)
  const request = parseRequest(raw)
  const db = getDb(env)
  const canonical = JSON.stringify(request)
  const previous = await db.prepare('SELECT request_json,receipt_json FROM return_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
  if (previous) {
    if (previous.request_json !== canonical) fail('Request id was already used with different data.')
    return JSON.parse(String(previous.receipt_json)) as Row
  }
  const { members, guards } = await buildMembers(db, request)
  const operationId = crypto.randomUUID()
  const stamp = new Date().toISOString()
  const snapshot: Snapshot = { version: 1, operationId, field: request.field, members }
  const changedIds = members.filter((member) => member.changed).map((member) => member.id)
  const unchangedIds = members.filter((member) => !member.changed).map((member) => member.id)
  const receipt = {
    operationId,
    changedIds,
    unchangedIds,
    changedCount: changedIds.length,
    unchangedCount: unchangedIds.length,
    currentReplayGeneration: 0,
    items: members.map((member) => ({
      id: member.id,
      return_number: member.returnNumber,
      before: request.field === 'status' ? member.before.status : member.before[request.field],
      after: request.field === 'status' ? member.after.status : member.after[request.field],
      changed: member.changed,
      reason: member.reason,
    })),
  }
  const statements: Statement[] = [
    ...guards,
    { sql: 'INSERT INTO return_bulk_operations(id,actor_id,request_id,request_json,receipt_json) VALUES(@id,@actor,@request,@canonical,@receipt)', params: { id: operationId, actor: user.id, request: request.client_request_id, canonical, receipt: JSON.stringify(receipt) } },
  ]
  for (const member of members) statements.push(...memberStatements(member, 1, user, stamp))
  for (const saleId of [...new Set(members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]) statements.push(saleStatusStatement(saleId, stamp))
  statements.push({ sql: 'INSERT INTO undo_snapshots(kind,payload_json,created_by_id,created_by_name) VALUES(@kind,@payload,@actor,@name)', params: { kind: RETURN_BULK_ACTION_KIND, payload: JSON.stringify(snapshot), actor: user.id, name: user.name } })
  statements.push({ sql: 'UPDATE return_bulk_operations SET snapshot_id=last_insert_rowid() WHERE id=@id', params: { id: operationId } })
  const historyIndex = statements.length
  statements.push({
    sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
          SELECT 'returns','return',id,@label,@reversible,@status,
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'field',@field,'source',@source,'target',@target,'changed_count',@changed,'unchanged_count',@unchanged),
            json_object('applier',@kind,'snapshot_id',snapshot_id,'operation_id',id,'generation',0,'field',@field,'source',@source,'target',@target,'changed_count',@changed,'unchanged_count',@unchanged),
            @actor,@name FROM return_bulk_operations WHERE id=@id`,
    params: { id: operationId, label: `${changedIds.length} returns: ${request.field} ${request.source} → ${request.target}; ${unchangedIds.length} unchanged`, reversible: changedIds.length ? 1 : 0, status: changedIds.length ? 'undoable' : 'recorded', kind: RETURN_BULK_ACTION_KIND, field: request.field, source: request.source, target: request.target, changed: changedIds.length, unchanged: unchangedIds.length, actor: user.id, name: user.name },
  })
  statements.push({ sql: "UPDATE return_bulk_operations SET history_id=last_insert_rowid(),receipt_json=json_set(receipt_json,'$.actionHistoryId',last_insert_rowid()) WHERE id=@id", params: { id: operationId } })
  for (const member of members.filter((candidate) => candidate.changed)) {
    statements.push({ sql: `INSERT INTO return_bulk_members(operation_id,return_id,revision,sale_id,sale_revision,stock_fingerprint) VALUES(@operation,@id,COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0),@saleId,CASE WHEN @saleId IS NULL THEN NULL ELSE COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=@saleId),0) END,${movementFingerprint('@id')})`, params: { operation: operationId, id: member.id, saleId: member.saleId } })
  }
  statements.push(auditStatement(user, operationId, 'return_fields_bulk', changedIds.length))
  statements.push({ sql: 'DELETE FROM return_bulk_guards', params: {} })
  assertBounded(statements, snapshot)
  try {
    const results = await db.batch(statements)
    return { ...receipt, actionHistoryId: Number(results[historyIndex].meta.last_row_id) }
  } catch (error) {
    const retry = await db.prepare('SELECT request_json,receipt_json FROM return_bulk_operations WHERE actor_id=@actor AND request_id=@request').get<Row>({ actor: user.id, request: request.client_request_id })
    if (retry?.request_json === canonical) return JSON.parse(String(retry.receipt_json)) as Row
    if (/constraint/i.test(String(error))) fail('A return or its stock changed. Nothing in the group was applied.')
    throw error
  }
}

export async function replayReturnBulkAction(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Row): Promise<void> {
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
  const statements: Statement[] = [guard("NOT EXISTS(SELECT 1 FROM system_flags WHERE key='maintenance' AND json_extract(value,'$.mode')='restore') AND EXISTS(SELECT 1 FROM return_bulk_operations o JOIN action_history h ON h.id=o.history_id JOIN undo_snapshots s ON s.id=o.snapshot_id WHERE o.id=@operation AND o.generation=@generation AND h.id=@history AND h.status=@expectedStatus AND s.kind=@kind AND s.status=@snapshotStatus AND s.payload_json=@snapshot)", { operation: operation.id, generation, history: historyId, expectedStatus, kind: RETURN_BULK_ACTION_KIND, snapshotStatus, snapshot: operation.payload_json })]
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) {
    statements.push(guard(`EXISTS(SELECT 1 FROM returns r JOIN return_bulk_members m ON m.return_id=r.id WHERE m.operation_id=@operation AND r.id=@id AND m.revision=COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=r.id),0) AND m.stock_fingerprint=${movementFingerprint('r.id')} AND (m.sale_id IS NULL OR (EXISTS(SELECT 1 FROM sales WHERE id=m.sale_id) AND m.sale_revision=COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=m.sale_id),0))))`, { operation: operation.id, id: member.id }))
  }
  for (const member of snapshot.members) statements.push(...memberStatements(member, directionSign, user, stamp))
  for (const saleId of [...new Set(snapshot.members.filter((member) => member.changed && member.updateSale && member.saleId).map((member) => member.saleId!))]) statements.push(saleStatusStatement(saleId, stamp))
  for (const member of snapshot.members.filter((candidate) => candidate.changed)) statements.push({ sql: `UPDATE return_bulk_members SET revision=COALESCE((SELECT revision FROM return_write_revisions WHERE return_id=@id),0),sale_revision=CASE WHEN sale_id IS NULL THEN NULL ELSE COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_write_revisions.sale_id=return_bulk_members.sale_id),0) END,stock_fingerprint=${movementFingerprint('@id')} WHERE operation_id=@operation AND return_id=@id`, params: { operation: operation.id, id: member.id } })
  statements.push({ sql: 'UPDATE return_bulk_operations SET generation=generation+1 WHERE id=@operation', params: { operation: operation.id } })
  statements.push({ sql: 'UPDATE undo_snapshots SET status=@status,updated_at=@stamp WHERE id=@id', params: { id: operation.snapshot_id, status: direction === 'undo' ? 'reversed' : 'applied', stamp } })
  statements.push({ sql: "UPDATE action_history SET status=@status,last_error=NULL,updated_at=@stamp,undo_payload=json_set(undo_payload,'$.generation',@generation),redo_payload=json_set(redo_payload,'$.generation',@generation) WHERE id=@id", params: { id: historyId, status: nextStatus, stamp, generation: Number(generation) + 1 } })
  statements.push(auditStatement(user, String(operation.id), `action_${direction}`, snapshot.members.filter((member) => member.changed).length))
  statements.push({ sql: 'DELETE FROM return_bulk_guards', params: {} })
  assertBounded(statements, snapshot)
  try {
    await db.batch(statements)
  } catch (error) {
    if (/constraint/i.test(String(error))) fail('A return, its stock, or this replay changed. Nothing in the group was applied.')
    throw error
  }
}
