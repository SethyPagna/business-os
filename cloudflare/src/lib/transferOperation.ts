import { executeStockTransaction, stockTransactionStatementCount, StockTransactionUnavailableError, StockTransactionOutcomeUnknownError } from './stockTransaction'
import { productStockGuardError } from './productStockGuard'
import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { CountedStockBatchPlan, countedStockFactsSql, CountedStockConflictError, subtractCountedQuantity, sumCountedQuantities } from './countedDamagedStock'
import { MoneyPrecisionError } from './moneyPrecision'
import { stockActorParams, stockActorPredicate } from './stockActorGuard'
import { canonicalTransferAuthorityGuardStatement } from './canonicalBranchIdentity'
import { transferIntentAuditStatement } from './transferOperationReceipt'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersions } from './cache'
import { currentRequestMetrics } from './requestMetrics'
import { getPlanLimits } from './planTier'
import { resolveMovementCostSnapshot, type MovementCostPair } from './movementCostSnapshot'

export const TRANSFER_OPERATION_KIND = 'stock.transfer'
type Statement = { sql: string; params?: Record<string, unknown> }
type Scope = 'branches' | 'inventory'
type Lot = { id: number; variant_product_id: number; batch_key: string; lot_code: string | null; received_at: string | null; expiry_date: string | null; notes: string | null }
type Allocation = { source_batch_id: number; destination_batch_id: number | null; destination_batch_key: string; quantity: number; source_snapshot: Lot; destination_snapshot: Lot | null; cost_snapshot: MovementCostPair }
type Member = { source_product_id: number; destination_product_id: number; source_branch_id: number; destination_branch_id: number; quantity: number; untracked_quantity: number; source_snapshot: string; destination_snapshot: string; allocations_json: string; ordinal: number }
export type TransferLine = { productId: number; destProductId: number; quantity: number; batchId?: number | null }
export type TransferAllocationSummary = Readonly<{
  ordinal: number
  takes: readonly Readonly<{ batchId: number; quantity: number; receivedAt: string | null; lotCode: string | null }>[]
  untrackedQuantity: number
}>
// Every way a transfer can be refused once it reaches the planner, as the
// exact English the Worker sends. Each sentence is the English of the pack key
// with the same name, so frontend/src/api/branchRuleErrors.ts can show it in
// the operator's language (Worker-side parity:
// scripts/test-transfer-lots-exceed-branch-pure.cjs).
export const TRANSFER_REFUSALS = {
  transfer_stock_changed: 'The products or stock in this transfer changed while it was being saved. Nothing was moved. Refresh and try again.',
  transfer_selected_lot_short: 'The selected received date no longer has enough stock.',
  transfer_too_many_lots: 'This transfer has too many received dates. Split it into smaller transfers.',
  transfer_maintenance_active: 'Maintenance is in progress. No stock was transferred; try again shortly.',
} as const
export type TransferRefusalCode = keyof typeof TRANSFER_REFUSALS
export class TransferConflictError extends Error {
  statusCode = 409
  code: string
  constructor(message: string, code = 'stock_conflict') { super(message); this.code = code }
}
const isTransferStockConflict = (error: unknown) => error instanceof CountedStockConflictError
  || (error instanceof Error ? error.message : String(error)).includes('$[counted_quantity_conflict]')
const refuse = (code: Exclude<TransferRefusalCode, 'transfer_maintenance_active'>) => new TransferConflictError(TRANSFER_REFUSALS[code], code)
const productSnapshotSql = `json_object('id',id,'name',name,'barcode',barcode,'created_at',created_at,'is_active',is_active)`
const lotSnapshotSql = `json_object('id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,'lot_code',lot_code,'received_at',received_at,'expiry_date',expiry_date,'notes',notes)`
const receiptSql = `(SELECT id FROM transfer_operation_receipts WHERE operation_id=@operation)`
const assert = (condition: string, params: Record<string, unknown>): Statement => ({ sql: `INSERT INTO branches(name) SELECT NULL WHERE COALESCE((${condition}),0)=0`, params })

type CapturedLot = Lot & { is_active: number | null; unit_cost_usd: number | null }
type TransferFacts = { id: number; branchId: number; snapshot: string; cost_price_usd: number | null; cost_price_khr: number | null; catalog: string; facts: string }
type TransferPhysical = { guards: Statement[]; writes: Statement[] }
const receiptCatalogSql = (product: string) => `(SELECT json_group_array(json_object(
  'id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,'lot_code',lot_code,'received_at',received_at,
  'expiry_date',expiry_date,'notes',notes,'is_active',is_active,'unit_cost_usd',unit_cost_usd))
  FROM (SELECT * FROM product_batches WHERE variant_product_id=${product} ORDER BY id LIMIT 10001))`

async function captureTransferStock(db: D1Compat, pairs: { productId: number; branchId: number }[]) {
  const unique = [...new Map(pairs.map(pair => [`${pair.productId}:${pair.branchId}`, pair])).values()]
  const rows = await db.prepare(`SELECT source.id,CAST(json_extract(j.value,'$.branchId') AS INTEGER) branchId,
    (SELECT ${productSnapshotSql} FROM products WHERE id=source.id) snapshot,source.cost_price_usd,source.cost_price_khr,
    ${receiptCatalogSql('source.id')} catalog,
    ${countedStockFactsSql('source.id', "CAST(json_extract(j.value,'$.branchId') AS INTEGER)", '(SELECT json_group_array(id) FROM (SELECT id FROM product_batches WHERE variant_product_id=source.id ORDER BY id LIMIT 10001))')} facts
    FROM json_each(@pairs) j JOIN products source ON source.id=json_extract(j.value,'$.productId') AND source.is_active=1`)
    .all<TransferFacts>({ pairs: JSON.stringify(unique) })
  if (rows.length !== unique.length) throw refuse('transfer_stock_changed')
  const stock = new CountedStockBatchPlan(rows, { deferPhysicalWrites: true })
  const guards: Statement[] = stock.takePreimageGuards()
  const products = new Map(rows.map(row => [row.id, row]))
  const lots = new Map<number, CapturedLot>()
  for (const row of products.values()) {
    const catalog = JSON.parse(row.catalog) as CapturedLot[]
    if (catalog.length > 10000) throw refuse('transfer_too_many_lots')
    for (const lot of catalog) lots.set(lot.id, lot)
    guards.push(assert(`${receiptCatalogSql('@product')}=@catalog`, { product: row.id, catalog: row.catalog }))
  }
  return { stock, guards, products, lots }
}

function lotSnapshot(lot: Lot): Lot {
  return { id: lot.id, variant_product_id: lot.variant_product_id, batch_key: lot.batch_key, lot_code: lot.lot_code,
    received_at: lot.received_at, expiry_date: lot.expiry_date, notes: lot.notes }
}

export function canReplayTransferPayload(user: SessionUser, payload: Record<string, unknown>): boolean {
  return (payload.permission === 'branches' || payload.permission === 'inventory')
    && getActionTier(user, payload.permission, 'transfer') === 'full'
}

/** Planning is read-only. New batch IDs are resolved by their unique key inside
 * the final batch, never by reserving IDs or writing a preliminary lot. */
export async function planTransferOperation(db: D1Compat, args: {
  user: SessionUser; requestId: string; requestJson: string; digest: string;
  scope: Scope; fromBranchId: number; toBranchId: number; reason: string;
  lines: TransferLine[]; response: Record<string, unknown>;
}): Promise<{ statements: Statement[]; operationId: string; allocationSummaries: readonly TransferAllocationSummary[] }> {
  const operationId = crypto.randomUUID()
  const params = { operation: operationId, actor: args.user.id, name: actorSnapshot(args.user), request: args.requestId,
    requestJson: args.requestJson, digest: args.digest, scope: args.scope }
  const statements: Statement[] = [canonicalTransferAuthorityGuardStatement(args.fromBranchId, args.toBranchId), {
    sql: `INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,status,operation_id,provenance_version,replay_state,generation)
      VALUES(@actor,@request,@digest,@requestJson,'planning',@operation,1,'applied',0)`, params,
  }, transferIntentAuditStatement({ actorId: args.user.id, actorName: actorSnapshot(args.user), requestId: args.requestId, requestJson: args.requestJson, digest: args.digest, bulk: args.lines.length > 1 })]
  const allocationSummaries: TransferAllocationSummary[] = []
  const pendingLots = new Map<string, string>()

  const captured = await captureTransferStock(db, args.lines.flatMap(line => [
    { productId: line.productId, branchId: args.fromBranchId }, { productId: line.destProductId, branchId: args.toBranchId },
  ]))
  const { stock, guards, products: productById, lots: lotById } = captured
  const linePlans = args.lines.map(line => {
    const exact = stock.get(line.productId, args.fromBranchId)
    const lots = exact.projectedReceiptSources().sort((left, right) => left.fifoRank - right.fifoRank)
    let uncovered = line.quantity
    const takes: { batchId: number; quantity: number }[] = []
    for (const lot of lots) {
      if (line.batchId != null && lot.batchId !== line.batchId) continue
      const quantity = Math.min(uncovered, lot.available)
      if (quantity <= 0) continue
      guards.push(...exact.changeOrdinary(lot.batchId, quantity, 'consume'))
      takes.push({ batchId: lot.batchId, quantity })
      uncovered = subtractCountedQuantity(uncovered, [quantity])
      if (uncovered === 0) break
    }
    if (line.batchId != null && uncovered > 0) throw refuse('transfer_selected_lot_short')
    if (uncovered > 0) guards.push(...exact.changeOrdinary(null, uncovered, 'consume'))
    return { takes, uncovered }
  })
  const pendingReceives = new Map<string, { productId: number; key: string; quantities: number[] }>()

  for (const [ordinal, line] of args.lines.entries()) {
    const sourceProduct = productById.get(line.productId)
    const destinationProduct = line.productId === line.destProductId ? sourceProduct : productById.get(line.destProductId)
    const snapshots = [sourceProduct, destinationProduct]
    if (snapshots.some(row => !row)) throw refuse('transfer_stock_changed')
    // Only planning reads mutable catalog costs. Both movement directions and
    // every later replay consume the same immutable source-cost provenance.
    const fallback = { fallbackUnitCostUsd: sourceProduct!.cost_price_usd, fallbackUnitCostKhr: sourceProduct!.cost_price_khr }
    const { takes, uncovered } = linePlans[ordinal]
    const allocations: Allocation[] = []
    for (const take of takes) {
      const source = lotById.get(take.batchId)
      if (!source) throw refuse('transfer_stock_changed')
      const costSnapshot = resolveMovementCostSnapshot({ quantity: take.quantity,
        // Lots store USD only. KHR uses the captured source product currency,
        // never a guessed exchange rate or destination product's cost.
        components: [{ quantity: take.quantity, unitCostUsd: source.unit_cost_usd }], ...fallback })
      const sourceLot = lotSnapshot(source)
      let destination: Lot | null = sourceLot
      let key = sourceLot.batch_key
      if (line.destProductId !== line.productId) {
        const lotCode = String(sourceLot.lot_code || '').trim() || null
        const match = [...lotById.values()].filter(lot => lot.variant_product_id === line.destProductId && lot.is_active === 1
          && (lotCode ? lot.batch_key === lotCode : !!sourceLot.expiry_date && lot.expiry_date === sourceLot.expiry_date)).sort((left, right) => left.id - right.id)[0]
        destination = match ? lotSnapshot(match) : null
        const pendingKey = `${line.destProductId}:${lotCode || sourceLot.expiry_date || sourceLot.id}`
        key = destination?.batch_key || pendingLots.get(pendingKey) || lotCode || `transfer-${crypto.randomUUID()}`
        if (!destination && !pendingLots.has(pendingKey)) {
          pendingLots.set(pendingKey, key)
          statements.push({ sql: `INSERT INTO product_batches(variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,is_active,batch_number,unit_cost_usd)
            SELECT @product,@key,@lot,@received,@expiry,@notes,1,COALESCE(MAX(batch_number),0)+1,@usd FROM product_batches WHERE variant_product_id=@product`,
          params: { product: line.destProductId, key, lot: lotCode, received: sourceLot.received_at, expiry: sourceLot.expiry_date, notes: sourceLot.notes,
            usd: costSnapshot.unitCostUsd } })
        }
      }
      if (destination) guards.push(...stock.get(line.destProductId, args.toBranchId).changeOrdinary(destination.id, take.quantity, 'receive'))
      else {
        const receiveKey = `${line.destProductId}:${key}`
        const pending = pendingReceives.get(receiveKey) ?? { productId: line.destProductId, key, quantities: [] }
        pending.quantities.push(take.quantity)
        pendingReceives.set(receiveKey, pending)
      }
      allocations.push({ source_batch_id: take.batchId, destination_batch_id: destination?.id ?? null, destination_batch_key: key, quantity: take.quantity, source_snapshot: sourceLot, destination_snapshot: destination, cost_snapshot: costSnapshot })
    }
    if (uncovered > 0) guards.push(...stock.get(line.destProductId, args.toBranchId).changeOrdinary(null, uncovered, 'receive'))
    // Detached, immutable notification metadata from the exact source snapshots
    // persisted below. Consumers never allocate again or mutate the SQL plan.
    allocationSummaries.push(Object.freeze({ ordinal, untrackedQuantity: uncovered,
      takes: Object.freeze(allocations.map(allocation => Object.freeze({
        batchId: allocation.source_batch_id, quantity: allocation.quantity,
        receivedAt: allocation.source_snapshot.received_at, lotCode: allocation.source_snapshot.lot_code,
      }))),
    }))
    const member: Member = { ordinal, source_product_id: line.productId, destination_product_id: line.destProductId,
      source_branch_id: args.fromBranchId, destination_branch_id: args.toBranchId, quantity: line.quantity,
      untracked_quantity: uncovered, source_snapshot: JSON.stringify({ ...JSON.parse(snapshots[0]!.snapshot),
        untracked_cost_snapshot: uncovered > 0 ? resolveMovementCostSnapshot({ quantity: uncovered, ...fallback }) : null }),
      destination_snapshot: snapshots[1]!.snapshot, allocations_json: JSON.stringify(allocations) }
    statements.push({ sql: `INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      SELECT ${receiptSql},@ordinal,@sourceProduct,@destProduct,@sourceBranch,@destBranch,@quantity,@untracked,@sourceSnapshot,@destSnapshot,
        (SELECT json_group_array(json_set(a.value,'$.destination_batch_id',b.id,'$.destination_snapshot',json(${lotSnapshotSql.replaceAll(/\b(id|variant_product_id|batch_key|lot_code|received_at|expiry_date|notes)\b(?=[,)])/g, 'b.$1')})))
         FROM json_each(@allocations) a JOIN product_batches b ON b.variant_product_id=@destProduct AND b.batch_key=json_extract(a.value,'$.destination_batch_key') AND b.is_active=1)`,
      params: { operation: operationId, ordinal, sourceProduct: line.productId, destProduct: line.destProductId, sourceBranch: args.fromBranchId, destBranch: args.toBranchId,
        quantity: line.quantity, untracked: uncovered, sourceSnapshot: member.source_snapshot, destSnapshot: member.destination_snapshot, allocations: member.allocations_json } })
  }
  for (const pending of pendingReceives.values()) {
    const receipt = stock.get(pending.productId, args.toBranchId).receiveProjectedCreatedReceipt(pending.key, sumCountedQuantities(pending.quantities))
    guards.push(...receipt.guards, ...receipt.statements)
  }
  statements.unshift(assert(stockActorPredicate, stockActorParams(args.user)), ...guards)
  const payload = JSON.stringify({ applier: TRANSFER_OPERATION_KIND, operation_id: operationId, generation: 0, permission: args.scope })
  statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    VALUES(@scope,'stock_transfer',@operation,@label,1,'undoable',@payload,@payload,@actor,@name)`, params: { ...params, payload, label: `${args.lines.length} stock transfer${args.lines.length === 1 ? '' : 's'}` } },
  { sql: `UPDATE transfer_operation_receipts SET action_history_id=last_insert_rowid() WHERE operation_id=@operation`, params })
  statements.push(...transferEffectStatements(operationId, false, 0, args.user, args.reason, { guards: [], writes: stock.takeFinalPhysicalWrites() }))
  statements.push({ sql: `UPDATE transfer_operation_receipts SET status='committed',response_json=json_set(@response,'$.operation_id',operation_id,'$.action_history_id',action_history_id,'$.generation',0,'$.provenance_version',1,
      '$.destBatchId',CASE WHEN @explicit=1 THEN (SELECT json_extract(allocations_json,'$[0].destination_batch_id') FROM transfer_operation_members WHERE receipt_id=transfer_operation_receipts.id AND ordinal=0) ELSE NULL END),updated_at=CURRENT_TIMESTAMP WHERE operation_id=@operation`,
    params: { operation: operationId, response: JSON.stringify(args.response), explicit: args.lines.length === 1 && args.lines[0].batchId != null ? 1 : 0 } })
  // D1 bound/query limits are explicit; no partial chunk commits of a transfer.
  if (stockTransactionStatementCount(statements.length) > 5000) throw refuse('transfer_too_many_lots')
  return { statements, operationId, allocationSummaries: Object.freeze(allocationSummaries) }
}

export type TransferRefusal = { status: 409 | 503; body: { error: string; code: string } }

/** The response for a transfer that was refused rather than failed, or null
 * for a genuine server error. Covers the planner's own refusals, every guard
 * in the batch (the NOT NULL sentinel of `assert`, which the canonical-branch
 * guard shares -- a guard trips only when state moved after the route's own
 * checks) and the ordinary maintenance guard. Callers check for a committed
 * receipt first: a same-key request that won the race is a replay. */
export function transferRefusal(error: unknown): TransferRefusal | null {
  if (error instanceof StockTransactionUnavailableError) return { status: 503, body: { error: error.message, code: error.code } }
  if (isTransferStockConflict(error) || error instanceof MoneyPrecisionError) return { status: 409, body: { error: TRANSFER_REFUSALS.transfer_stock_changed, code: 'transfer_stock_changed' } }
  if (error instanceof TransferConflictError) return { status: 409, body: { error: error.message, code: error.code } }
  const activeGuard = productStockGuardError(error)
  if (activeGuard) return { status: 409, body: { error: activeGuard.message, code: activeGuard.code } }
  const message = error instanceof Error ? error.message : String(error ?? '')
  // House convention (stockLotAdjustment, stockInLineEdit): 503, retry later.
  if (/ordinary_business_maintenance_active/.test(message)) return { status: 503, body: { error: TRANSFER_REFUSALS.transfer_maintenance_active, code: 'maintenance_active' } }
  if (/NOT NULL constraint failed: branches\.name/i.test(message)) return { status: 409, body: { error: TRANSFER_REFUSALS.transfer_stock_changed, code: 'transfer_stock_changed' } }
  return null
}

export function transferEffectStatements(operation: string, reverse: boolean, generation: number, user: SessionUser, reason: string, physical: TransferPhysical): Statement[] {
  const from = reverse ? 'destination' : 'source'
  const to = reverse ? 'source' : 'destination'
  const members = `SELECT m.*,m.${from}_product_id AS from_product,m.${to}_product_id AS to_product,
    m.${from}_branch_id AS from_branch,m.${to}_branch_id AS to_branch,
    m.${from}_snapshot AS from_snapshot,m.${to}_snapshot AS to_snapshot
    FROM transfer_operation_members m WHERE m.receipt_id=${receiptSql}`
  const allocations = `SELECT m.*,json_extract(a.value,'$.${from}_batch_id') AS from_batch,json_extract(a.value,'$.${to}_batch_id') AS to_batch,
    json_extract(a.value,'$.quantity') AS take_quantity,json_extract(a.value,'$.${from}_snapshot') AS from_lot_snapshot,
    json_extract(a.value,'$.${to}_snapshot') AS to_lot_snapshot,json_extract(a.value,'$.cost_snapshot') AS movement_cost
    FROM (${members}) m,json_each(m.allocations_json) a`
  const params = { operation, generation, reason, actor: user.id, name: actorSnapshot(user) }
  return [
    ...physical.guards,
    { sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM (${members}) m JOIN products p ON p.id=m.to_product
        WHERE m.quantity>0 AND p.is_active IS NOT 1) THEN json_extract('[]','$[product_has_stock]') ELSE 1 END`, params },
    assert(`NOT EXISTS(SELECT 1 FROM (${members}) m WHERE
      COALESCE((SELECT ${productSnapshotSql} FROM products WHERE id=m.from_product)=json_remove(m.from_snapshot,'$.untracked_cost_snapshot'),0)=0
      OR COALESCE((SELECT ${productSnapshotSql} FROM products WHERE id=m.to_product)=json_remove(m.to_snapshot,'$.untracked_cost_snapshot'),0)=0)`, params),
    assert(`NOT EXISTS(SELECT 1 FROM (${allocations}) a WHERE
      COALESCE((SELECT ${lotSnapshotSql} FROM product_batches WHERE id=a.from_batch AND is_active=1)=a.from_lot_snapshot,0)=0
      OR COALESCE((SELECT ${lotSnapshotSql} FROM product_batches WHERE id=a.to_batch AND is_active=1)=a.to_lot_snapshot,0)=0)`, params),
    ...physical.writes,
    { sql: `INSERT INTO stock_transfers(product_id,product_name,from_branch_id,to_branch_id,from_branch_name,to_branch_name,quantity,notes,user_id,user_name,client_request_id,receipt_id,member_ordinal,generation)
      SELECT from_product,json_extract(from_snapshot,'$.name'),from_branch,to_branch,
        (SELECT name FROM branches WHERE id=from_branch),(SELECT name FROM branches WHERE id=to_branch),quantity,
        CASE WHEN from_product<>to_product THEN @reason||' -- Added to existing product "'||json_extract(to_snapshot,'$.name')||'" (#'||to_product||') at '||(SELECT name FROM branches WHERE id=to_branch) ELSE @reason END,
        @actor,@name,@operation,receipt_id,ordinal,@generation FROM (${members})`, params },
    ...(['out', 'in'] as const).map(direction => {
      const side = direction === 'out' ? 'from' : 'to'
      // Missing legacy provenance stays NULL: replay must never invent costs
      // from today's product or lot, including on the reversed/incoming side.
      const costColumns = (json: string) => ['unitCostUsd', 'unitCostKhr', 'totalCostUsd', 'totalCostKhr']
        .map(field => `json_extract(${json},'$.${field}')`).join(',')
      return { sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,user_id,user_name,batch_id,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr)
        SELECT ${side}_product,json_extract(${side}_snapshot,'$.name'),${side}_branch,(SELECT name FROM branches WHERE id=${side}_branch),
          'transfer_${direction}',take_quantity,@reason,@actor,@name,${side}_batch,${costColumns('movement_cost')} FROM (${allocations})
        UNION ALL SELECT ${side}_product,json_extract(${side}_snapshot,'$.name'),${side}_branch,(SELECT name FROM branches WHERE id=${side}_branch),
          'transfer_${direction}',untracked_quantity,@reason,@actor,@name,NULL,${costColumns("json_extract(source_snapshot,'$.untracked_cost_snapshot')")} FROM (${members}) WHERE untracked_quantity>0`, params }
    }),
  ]
}

async function executeTransferReplay(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, expectedGeneration: unknown, payload: Record<string, unknown>): Promise<void> {
  const db = getDb(env)
  if (!Number.isSafeInteger(expectedGeneration) || Number(expectedGeneration)<0 || !canReplayTransferPayload(user, payload)) throw new TransferConflictError('An authorized transfer generation is required.')
  const operation = await db.prepare(`SELECT * FROM transfer_operation_receipts WHERE operation_id=@operation AND action_history_id=@history AND provenance_version=1 AND status='committed'`).get<Record<string, unknown>>({ operation: payload.operation_id, history: historyId })
  if (!operation) throw new TransferConflictError('This transfer has no exact replay provenance.')
  const request = JSON.parse(String(operation.request_json))
  const permission = request.kind === 'inventory-transfer' ? 'inventory' : 'branches'
  if (payload.permission !== permission || getActionTier(user, permission, 'transfer') !== 'full') throw new TransferConflictError('Transfer permission changed.')
  const target = direction === 'undo' ? 'reversed' : 'applied'
  const oldState = direction === 'undo' ? 'applied' : 'reversed'
  const generation = Number(expectedGeneration)
  if (Number(operation.generation) === generation+1 && operation.replay_state === target) return
  if (operation.generation !== generation || payload.generation !== generation || operation.replay_state !== oldState) throw new TransferConflictError('This transfer generation is stale. Refresh its history.')
  const memberColumns = 'receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json'
  const memberFingerprint = `(SELECT json_group_array(json_array(${memberColumns})) FROM
    (SELECT * FROM transfer_operation_members WHERE receipt_id=@receipt ORDER BY ordinal))`
  const members = await db.prepare(`SELECT m.*,${memberFingerprint} member_fingerprint FROM transfer_operation_members m WHERE receipt_id=@receipt ORDER BY ordinal`)
    .all<Member & { member_fingerprint: string }>({ receipt: operation.id })
  if (!members.length) throw new TransferConflictError('This transfer has no exact allocation mapping.')
  const captured = await captureTransferStock(db, members.flatMap(member => [
    { productId: member.source_product_id, branchId: member.source_branch_id },
    { productId: member.destination_product_id, branchId: member.destination_branch_id },
  ]))
  const physicalGuards = [...captured.guards, assert(stockActorPredicate, stockActorParams(user))]
  for (const member of members) {
    const allocations = JSON.parse(member.allocations_json) as Allocation[]
    if (!Array.isArray(allocations) || !Number.isFinite(member.quantity) || member.quantity <= 0
      || !Number.isFinite(member.untracked_quantity) || member.untracked_quantity < 0
      || allocations.some(allocation => !Number.isFinite(allocation.quantity) || allocation.quantity <= 0)
      || subtractCountedQuantity(member.quantity, [member.untracked_quantity, ...allocations.map(allocation => allocation.quantity)]) !== 0) throw refuse('transfer_stock_changed')
    const source = captured.stock.get(member.source_product_id, member.source_branch_id)
    const destination = captured.stock.get(member.destination_product_id, member.destination_branch_id)
    for (const allocation of allocations) {
      if (!Number.isSafeInteger(allocation.source_batch_id) || !Number.isSafeInteger(allocation.destination_batch_id)) throw refuse('transfer_stock_changed')
      const changes = direction === 'undo'
        ? [[destination, allocation.destination_batch_id, 'consume'], [source, allocation.source_batch_id, 'receive']] as const
        : [[source, allocation.source_batch_id, 'consume'], [destination, allocation.destination_batch_id, 'receive']] as const
      for (const [plan, batchId, action] of changes) physicalGuards.push(...plan.changeOrdinary(batchId, allocation.quantity, action))
    }
    if (member.untracked_quantity > 0) {
      const changes = direction === 'undo' ? [[destination, 'consume'], [source, 'receive']] as const : [[source, 'consume'], [destination, 'receive']] as const
      for (const [plan, action] of changes) physicalGuards.push(...plan.changeOrdinary(null, member.untracked_quantity, action))
    }
  }
  physicalGuards.push(assert(`${memberFingerprint}=@members`, { receipt: operation.id, members: members[0].member_fingerprint }))
  const params = { operation: payload.operation_id, history: historyId, generation, next: generation+1, oldState, target, status: direction === 'undo' ? 'redoable' : 'undoable', previousStatus: direction === 'undo' ? 'undoable' : 'redoable', payload: JSON.stringify(payload) }
  const statements: Statement[] = [canonicalTransferAuthorityGuardStatement(members[0].source_branch_id, members[0].destination_branch_id),
    assert(`EXISTS(SELECT 1 FROM transfer_operation_receipts r JOIN action_history h ON h.id=r.action_history_id
      WHERE r.operation_id=@operation AND r.action_history_id=@history AND r.generation=@generation AND r.replay_state=@oldState AND h.status=@previousStatus
      AND json_extract(h.undo_payload,'$.applier')='stock.transfer' AND json_extract(h.redo_payload,'$.applier')='stock.transfer'
      AND json_extract(h.undo_payload,'$.operation_id')=@operation AND json_extract(h.redo_payload,'$.operation_id')=@operation
      AND json_extract(h.undo_payload,'$.generation')=@generation AND json_extract(h.redo_payload,'$.generation')=@generation
      AND json_extract(h.undo_payload,'$.permission')=json_extract(@payload,'$.permission')
      AND json_extract(h.redo_payload,'$.permission')=json_extract(@payload,'$.permission'))`, params),
    ...transferEffectStatements(String(payload.operation_id), direction === 'undo', generation+1, user, `Transfer ${direction}: ${request.reason}`, { guards: physicalGuards, writes: captured.stock.takeFinalPhysicalWrites() }),
    { sql: `UPDATE transfer_operation_receipts SET generation=@next,replay_state=@target,updated_at=CURRENT_TIMESTAMP WHERE operation_id=@operation AND generation=@generation`, params },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,undo_payload=json_set(undo_payload,'$.generation',@next),redo_payload=json_set(redo_payload,'$.generation',@next) WHERE id=@history`, params },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES(@actor,@name,@action,'stock_transfer',@operation,@details)`, params: { actor: user.id, name: actorSnapshot(user), action: `action_${direction}`, operation: payload.operation_id, details: JSON.stringify({ operation_id: payload.operation_id, history_id: historyId, generation: generation+1 }) } },
  ]
  const limits = getPlanLimits(env)
  const metrics = currentRequestMetrics()
  const completionReserve = limits.tier === 'free' ? 10 : 8
  if (!metrics || metrics.invocation.attemptedStatements + stockTransactionStatementCount(statements.length) + completionReserve > limits.d1QueriesPerInvocation) throw refuse('transfer_too_many_lots')
  try { await executeStockTransaction(db, statements, 'once') } catch (error) {
    let current: { generation: number; replay_state: string } | undefined
    try { current = await db.prepare(`SELECT generation,replay_state FROM transfer_operation_receipts WHERE operation_id=@operation`).get<{ generation: number; replay_state: string }>({ operation: payload.operation_id }) }
    catch { throw Object.assign(new StockTransactionOutcomeUnknownError(), { statusCode: 503 }) }
    if (current?.generation === generation+1 && current.replay_state === target) return
    const activeGuard = productStockGuardError(error)
    if (activeGuard) throw activeGuard
    const refusal = transferRefusal(error)
    if (refusal) throw Object.assign(new Error(refusal.body.error), { code: refusal.body.code, statusCode: refusal.status })
    throw Object.assign(new StockTransactionOutcomeUnknownError(), { statusCode: 503 })
  }
}

export async function replayTransferOperation(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, expectedGeneration: unknown, payload: Record<string, unknown>): Promise<void> {
  try { await executeTransferReplay(env, user, direction, historyId, expectedGeneration, payload) }
  catch (error) {
    if (isTransferStockConflict(error) || error instanceof MoneyPrecisionError) throw refuse('transfer_stock_changed')
    throw error
  }
}

export async function notifyTransferOperation(env: Env): Promise<void> {
  await Promise.all([broadcast(env, 'branches', { action: 'transfer' }), broadcast(env, 'products', { action: 'update' }), broadcast(env, 'inventory', { action: 'transfer' }), bumpVersions(env, ['products', 'stock'])])
}
