import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { allocateAcrossLots, readFifoLotAvailability } from './productBatches'
import { canonicalTransferAuthorityGuardStatement } from './canonicalBranchIdentity'
import { transferIntentAuditStatement } from './transferOperationReceipt'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'
import { resolveMovementCostSnapshot, type MovementCostPair } from './movementCostSnapshot'

export const TRANSFER_OPERATION_KIND = 'stock.transfer'
type Statement = { sql: string; params?: Record<string, unknown> }
type Scope = 'branches' | 'inventory'
type Lot = { id: number; variant_product_id: number; batch_key: string; lot_code: string | null; received_at: string | null; expiry_date: string | null; notes: string | null }
type Allocation = { source_batch_id: number; destination_batch_id: number | null; destination_batch_key: string; quantity: number; source_snapshot: Lot; destination_snapshot: Lot | null; cost_snapshot: MovementCostPair }
type Member = { source_product_id: number; destination_product_id: number; source_branch_id: number; destination_branch_id: number; quantity: number; untracked_quantity: number; source_snapshot: string; destination_snapshot: string; allocations_json: string; ordinal: number }
export type TransferLine = { productId: number; destProductId: number; quantity: number; batchId?: number | null }
export class TransferConflictError extends Error { statusCode = 409 }
const productSnapshotSql = `json_object('id',id,'name',name,'barcode',barcode,'created_at',created_at,'is_active',is_active)`
const lotSnapshotSql = `json_object('id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,'lot_code',lot_code,'received_at',received_at,'expiry_date',expiry_date,'notes',notes)`
const receiptSql = `(SELECT id FROM transfer_operation_receipts WHERE operation_id=@operation)`
const assert = (condition: string, params: Record<string, unknown>): Statement => ({ sql: `INSERT INTO branches(name) SELECT NULL WHERE COALESCE((${condition}),0)=0`, params })

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
}): Promise<{ statements: Statement[]; operationId: string }> {
  const operationId = crypto.randomUUID()
  const params = { operation: operationId, actor: args.user.id, name: actorSnapshot(args.user), request: args.requestId,
    requestJson: args.requestJson, digest: args.digest, scope: args.scope }
  const statements: Statement[] = [canonicalTransferAuthorityGuardStatement(args.fromBranchId, args.toBranchId), {
    sql: `INSERT INTO transfer_operation_receipts(actor_id,request_id,request_digest,request_json,status,operation_id,provenance_version,replay_state,generation)
      VALUES(@actor,@request,@digest,@requestJson,'planning',@operation,1,'applied',0)`, params,
  }, transferIntentAuditStatement({ actorId: args.user.id, actorName: actorSnapshot(args.user), requestId: args.requestId, requestJson: args.requestJson, digest: args.digest, bulk: args.lines.length > 1 })]
  const members: Member[] = []
  const pendingLots = new Map<string, string>()
  for (const [ordinal, line] of args.lines.entries()) {
    const sourceProduct = await db.prepare(`SELECT ${productSnapshotSql} AS snapshot,cost_price_usd,cost_price_khr FROM products WHERE id=@id AND is_active=1`).get<{ snapshot: string; cost_price_usd: number | null; cost_price_khr: number | null }>({ id: line.productId })
    const destinationProduct = line.productId === line.destProductId ? sourceProduct
      : await db.prepare(`SELECT ${productSnapshotSql} AS snapshot FROM products WHERE id=@id AND is_active=1`).get<{ snapshot: string }>({ id: line.destProductId })
    const snapshots = [sourceProduct, destinationProduct]
    if (snapshots.some(row => !row)) throw new TransferConflictError('A transfer product changed. Refresh and try again.')
    // Only planning reads mutable catalog costs. Both movement directions and
    // every later replay consume the same immutable source-cost provenance.
    const fallback = { fallbackUnitCostUsd: sourceProduct!.cost_price_usd, fallbackUnitCostKhr: sourceProduct!.cost_price_khr }
    statements.push(assert(`EXISTS(SELECT 1 FROM products WHERE id=@product AND cost_price_usd IS @usd AND cost_price_khr IS @khr)`,
      { product: line.productId, usd: sourceProduct!.cost_price_usd, khr: sourceProduct!.cost_price_khr }))
    const lots = await readFifoLotAvailability(db, line.productId, args.fromBranchId)
    const selected = line.batchId == null ? lots : lots.filter(lot => lot.batchId === line.batchId)
    const { takes, uncovered } = allocateAcrossLots(selected, line.quantity)
    if (line.batchId != null && uncovered > 0) throw new TransferConflictError('The selected received date no longer has enough stock.')
    const allocations: Allocation[] = []
    for (const take of takes) {
      const source = await db.prepare(`SELECT ${lotSnapshotSql} AS snapshot,unit_cost_usd FROM product_batches WHERE id=@id AND is_active=1`).get<{ snapshot: string; unit_cost_usd: number | null }>({ id: take.batchId })
      if (!source) throw new TransferConflictError('The source received date changed.')
      const costSnapshot = resolveMovementCostSnapshot({ quantity: take.quantity,
        // Lots store USD only. KHR uses the captured source product currency,
        // never a guessed exchange rate or destination product's cost.
        components: [{ quantity: take.quantity, unitCostUsd: source.unit_cost_usd }], ...fallback })
      statements.push(assert(`EXISTS(SELECT 1 FROM product_batches WHERE id=@batch AND unit_cost_usd IS @usd)`,
        { batch: take.batchId, usd: source.unit_cost_usd }))
      const sourceLot = JSON.parse(source.snapshot) as Lot
      let destination: Lot | null = sourceLot
      let key = sourceLot.batch_key
      if (line.destProductId !== line.productId) {
        const lotCode = String(sourceLot.lot_code || '').trim() || null
        const match = lotCode
          ? await db.prepare(`SELECT ${lotSnapshotSql} AS snapshot FROM product_batches WHERE variant_product_id=@product AND is_active=1 AND batch_key=@key`).get<{ snapshot: string }>({ product: line.destProductId, key: lotCode })
          : sourceLot.expiry_date ? await db.prepare(`SELECT ${lotSnapshotSql} AS snapshot FROM product_batches WHERE variant_product_id=@product AND is_active=1 AND expiry_date=@expiry ORDER BY id LIMIT 1`).get<{ snapshot: string }>({ product: line.destProductId, expiry: sourceLot.expiry_date }) : undefined
        destination = match ? JSON.parse(match.snapshot) as Lot : null
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
      allocations.push({ source_batch_id: take.batchId, destination_batch_id: destination?.id ?? null, destination_batch_key: key, quantity: take.quantity, source_snapshot: sourceLot, destination_snapshot: destination, cost_snapshot: costSnapshot })
    }
    const member: Member = { ordinal, source_product_id: line.productId, destination_product_id: line.destProductId,
      source_branch_id: args.fromBranchId, destination_branch_id: args.toBranchId, quantity: line.quantity,
      untracked_quantity: uncovered, source_snapshot: JSON.stringify({ ...JSON.parse(snapshots[0]!.snapshot),
        untracked_cost_snapshot: uncovered > 0 ? resolveMovementCostSnapshot({ quantity: uncovered, ...fallback }) : null }),
      destination_snapshot: snapshots[1]!.snapshot, allocations_json: JSON.stringify(allocations) }
    members.push(member)
    statements.push({ sql: `INSERT INTO transfer_operation_members(receipt_id,ordinal,source_product_id,destination_product_id,source_branch_id,destination_branch_id,quantity,untracked_quantity,source_snapshot,destination_snapshot,allocations_json)
      SELECT ${receiptSql},@ordinal,@sourceProduct,@destProduct,@sourceBranch,@destBranch,@quantity,@untracked,@sourceSnapshot,@destSnapshot,
        (SELECT json_group_array(json_set(a.value,'$.destination_batch_id',b.id,'$.destination_snapshot',json(${lotSnapshotSql.replaceAll(/\b(id|variant_product_id|batch_key|lot_code|received_at|expiry_date|notes)\b(?=[,)])/g, 'b.$1')})))
         FROM json_each(@allocations) a JOIN product_batches b ON b.variant_product_id=@destProduct AND b.batch_key=json_extract(a.value,'$.destination_batch_key') AND b.is_active=1)`,
      params: { operation: operationId, ordinal, sourceProduct: line.productId, destProduct: line.destProductId, sourceBranch: args.fromBranchId, destBranch: args.toBranchId,
        quantity: line.quantity, untracked: uncovered, sourceSnapshot: member.source_snapshot, destSnapshot: member.destination_snapshot, allocations: member.allocations_json } })
  }
  const payload = JSON.stringify({ applier: TRANSFER_OPERATION_KIND, operation_id: operationId, generation: 0, permission: args.scope })
  statements.push({ sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
    VALUES(@scope,'stock_transfer',@operation,@label,1,'undoable',@payload,@payload,@actor,@name)`, params: { ...params, payload, label: `${args.lines.length} stock transfer${args.lines.length === 1 ? '' : 's'}` } },
  { sql: `UPDATE transfer_operation_receipts SET action_history_id=last_insert_rowid() WHERE operation_id=@operation`, params })
  statements.push(...transferEffectStatements(operationId, false, 0, args.user, args.reason))
  statements.push({ sql: `UPDATE transfer_operation_receipts SET status='committed',response_json=json_set(@response,'$.operation_id',operation_id,'$.action_history_id',action_history_id,'$.generation',0,'$.provenance_version',1,
      '$.destBatchId',CASE WHEN @explicit=1 THEN (SELECT json_extract(allocations_json,'$[0].destination_batch_id') FROM transfer_operation_members WHERE receipt_id=transfer_operation_receipts.id AND ordinal=0) ELSE NULL END),updated_at=CURRENT_TIMESTAMP WHERE operation_id=@operation`,
    params: { operation: operationId, response: JSON.stringify(args.response), explicit: args.lines.length === 1 && args.lines[0].batchId != null ? 1 : 0 } })
  // D1 bound/query limits are explicit; no partial chunk commits of a transfer.
  if (statements.length > 5000) throw new TransferConflictError('This transfer has too many received dates. Split it into smaller transfers.')
  return { statements, operationId }
}

function transferEffectStatements(operation: string, reverse: boolean, generation: number, user: SessionUser, reason: string): Statement[] {
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
  const sources = `SELECT from_product,from_branch,SUM(quantity) AS quantity,SUM(untracked_quantity) AS untracked FROM (${members}) GROUP BY from_product,from_branch`
  const sourceLots = `SELECT from_product,from_branch,from_batch,SUM(take_quantity) AS quantity FROM (${allocations}) GROUP BY from_product,from_branch,from_batch`
  const params = { operation, generation, reason, actor: user.id, name: actorSnapshot(user) }
  return [
    assert(`NOT EXISTS(SELECT 1 FROM (${members}) m WHERE
      COALESCE((SELECT ${productSnapshotSql} FROM products WHERE id=m.from_product)=json_remove(m.from_snapshot,'$.untracked_cost_snapshot'),0)=0
      OR COALESCE((SELECT ${productSnapshotSql} FROM products WHERE id=m.to_product)=json_remove(m.to_snapshot,'$.untracked_cost_snapshot'),0)=0
      OR ABS((SELECT COALESCE(SUM(json_extract(value,'$.quantity')),0) FROM json_each(m.allocations_json))+m.untracked_quantity-m.quantity)>0.000000001)`, params),
    assert(`NOT EXISTS(SELECT 1 FROM (${sources}) m WHERE
      NOT EXISTS(SELECT 1 FROM branch_stock WHERE product_id=m.from_product AND branch_id=m.from_branch AND quantity>=m.quantity)
      OR COALESCE((SELECT quantity FROM branch_stock WHERE product_id=m.from_product AND branch_id=m.from_branch),0)
        -COALESCE((SELECT SUM(bs.quantity) FROM branch_batch_stock bs JOIN product_batches b ON b.id=bs.batch_id
          WHERE b.variant_product_id=m.from_product AND bs.branch_id=m.from_branch),0)<m.untracked)`, params),
    assert(`NOT EXISTS(SELECT 1 FROM (${sourceLots}) m WHERE NOT EXISTS(
      SELECT 1 FROM branch_batch_stock bs JOIN product_batches b ON b.id=bs.batch_id
      WHERE bs.batch_id=m.from_batch AND bs.branch_id=m.from_branch AND b.variant_product_id=m.from_product AND b.is_active=1 AND bs.quantity>=m.quantity))
      AND NOT EXISTS(SELECT 1 FROM (${allocations}) a WHERE
        COALESCE((SELECT ${lotSnapshotSql} FROM product_batches WHERE id=a.from_batch AND is_active=1)=a.from_lot_snapshot,0)=0
        OR COALESCE((SELECT ${lotSnapshotSql} FROM product_batches WHERE id=a.to_batch AND is_active=1)=a.to_lot_snapshot,0)=0)`, params),
    { sql: `UPDATE branch_batch_stock SET quantity=quantity-(SELECT quantity FROM (${sourceLots}) a
      WHERE a.from_batch=branch_batch_stock.batch_id AND a.from_branch=branch_batch_stock.branch_id),updated_at=CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM (${sourceLots}) a WHERE a.from_batch=branch_batch_stock.batch_id AND a.from_branch=branch_batch_stock.branch_id)`, params },
    { sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      SELECT to_batch,to_branch,SUM(take_quantity) FROM (${allocations}) GROUP BY to_batch,to_branch
      ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=CURRENT_TIMESTAMP`, params },
    { sql: `UPDATE branch_stock SET quantity=quantity-(SELECT quantity FROM (${sources}) a
      WHERE a.from_product=branch_stock.product_id AND a.from_branch=branch_stock.branch_id)
      WHERE EXISTS(SELECT 1 FROM (${sources}) a WHERE a.from_product=branch_stock.product_id AND a.from_branch=branch_stock.branch_id)`, params },
    { sql: `INSERT INTO branch_stock(product_id,branch_id,quantity)
      SELECT to_product,to_branch,SUM(quantity) FROM (${members}) GROUP BY to_product,to_branch
      ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=quantity+excluded.quantity`, params },
    { sql: `UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=products.id),updated_at=CURRENT_TIMESTAMP
      WHERE id IN(SELECT from_product FROM (${members}) UNION SELECT to_product FROM (${members}))`, params },
    { sql: `INSERT INTO stock_transfers(product_id,product_name,from_branch_id,to_branch_id,quantity,notes,user_id,user_name,client_request_id,receipt_id,member_ordinal,generation)
      SELECT from_product,json_extract(from_snapshot,'$.name'),from_branch,to_branch,quantity,
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

export async function replayTransferOperation(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, expectedGeneration: unknown, payload: Record<string, unknown>): Promise<void> {
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
  const members = await db.prepare(`SELECT * FROM transfer_operation_members WHERE receipt_id=@receipt ORDER BY ordinal`).all<Member>({ receipt: operation.id })
  if (!members.length) throw new TransferConflictError('This transfer has no exact allocation mapping.')
  const params = { operation: payload.operation_id, history: historyId, generation, next: generation+1, oldState, target, status: direction === 'undo' ? 'redoable' : 'undoable', previousStatus: direction === 'undo' ? 'undoable' : 'redoable', payload: JSON.stringify(payload) }
  const statements: Statement[] = [canonicalTransferAuthorityGuardStatement(members[0].source_branch_id, members[0].destination_branch_id),
    assert(`EXISTS(SELECT 1 FROM transfer_operation_receipts r JOIN action_history h ON h.id=r.action_history_id
      WHERE r.operation_id=@operation AND r.action_history_id=@history AND r.generation=@generation AND r.replay_state=@oldState AND h.status=@previousStatus
      AND json_extract(h.undo_payload,'$.applier')='stock.transfer' AND json_extract(h.redo_payload,'$.applier')='stock.transfer'
      AND json_extract(h.undo_payload,'$.operation_id')=@operation AND json_extract(h.redo_payload,'$.operation_id')=@operation
      AND json_extract(h.undo_payload,'$.generation')=@generation AND json_extract(h.redo_payload,'$.generation')=@generation
      AND json_extract(h.undo_payload,'$.permission')=json_extract(@payload,'$.permission')
      AND json_extract(h.redo_payload,'$.permission')=json_extract(@payload,'$.permission'))`, params),
    ...transferEffectStatements(String(payload.operation_id), direction === 'undo', generation+1, user, `Transfer ${direction}: ${request.reason}`),
    { sql: `UPDATE transfer_operation_receipts SET generation=@next,replay_state=@target,updated_at=CURRENT_TIMESTAMP WHERE operation_id=@operation AND generation=@generation`, params },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,undo_payload=json_set(undo_payload,'$.generation',@next),redo_payload=json_set(redo_payload,'$.generation',@next) WHERE id=@history`, params },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details) VALUES(@actor,@name,@action,'stock_transfer',@operation,@details)`, params: { actor: user.id, name: actorSnapshot(user), action: `action_${direction}`, operation: payload.operation_id, details: JSON.stringify({ operation_id: payload.operation_id, history_id: historyId, generation: generation+1 }) } },
  ]
  try { await db.batch(statements) } catch {
    const current = await db.prepare(`SELECT generation,replay_state FROM transfer_operation_receipts WHERE operation_id=@operation`).get<{ generation: number; replay_state: string }>({ operation: payload.operation_id })
    if (current?.generation === generation+1 && current.replay_state === target) return
    throw new TransferConflictError('The exact transferred stock or product changed. Refresh and check its history.')
  }
}

export async function notifyTransferOperation(env: Env): Promise<void> {
  await Promise.all([broadcast(env, 'branches', { action: 'transfer' }), broadcast(env, 'products', { action: 'update' }), broadcast(env, 'inventory', { action: 'transfer' }), bumpVersion(env, 'products')])
}
