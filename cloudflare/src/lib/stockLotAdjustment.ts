import { getDb, type D1Compat } from './db'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getActionTier } from './permissions'
import { actorSnapshot } from './actorSnapshot'
import { transferRequestDigest } from './transferOperationReceipt'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from './cache'

export const STOCK_LOT_SET_KIND = 'stock.quantity_set'
export class StockLotConflict extends Error { statusCode = 409 }
type Statement = { sql: string; params?: Record<string, unknown> }
type Snapshot = { productId: number; branchId: number; batchId: number; product: string; branch: string; lot: string; branchQuantity: number; lotQuantity: number; branchExists: number; lotExists: number }
type Request = { productId: number; branchId: number; batchId: number; quantity: number; setScope: 'lot' | 'branch'; reason: string; expectedLotQuantity?: number; expectedBranchQuantity?: number }
type Operation = { id: string; request_json: string; response_json: string; before_json: string; after_json: string; revision_json: string; history_id: number; generation: number; state: string }
const revisionsSql = `json_object(
  'product',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key=printf('%d',@product)),0),
  'branch',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='branch' AND entity_key=printf('%d',@branch)),0),
  'batch',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='batch' AND entity_key=printf('%d',@batch)),0),
  'stock',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='branch_stock' AND entity_key=printf('%d:%d',@product,@branch)),0),
  'lot_stock',COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='branch_batch_stock' AND entity_key=printf('%d:%d',@batch,@branch)),0))`
const productSql = `json_object('id',id,'name',name,'created_at',created_at,'is_active',is_active)`
const branchSql = `json_object('id',id,'name',name,'is_active',is_active)`
const lotSql = `json_object('id',id,'variant_product_id',variant_product_id,'batch_key',batch_key,'received_at',received_at,'expiry_date',expiry_date,'supplier_id',supplier_id,'supplier_name',supplier_name,'is_active',is_active)`
const guard = (condition: string, params: Record<string, unknown>): Statement => ({ sql: `INSERT INTO stock_session_guards(guard_value) SELECT 0 WHERE COALESCE((${condition}),0)=0`, params })

async function snapshot(db: D1Compat, request: Request): Promise<Snapshot> {
  const params = { product: request.productId, branch: request.branchId, batch: request.batchId }
  const row = await db.prepare(`SELECT
    (SELECT ${productSql} FROM products WHERE id=@product AND is_active=1) product,
    (SELECT ${branchSql} FROM branches WHERE id=@branch AND is_active=1) branch,
    (SELECT ${lotSql} FROM product_batches WHERE id=@batch AND variant_product_id=@product AND is_active=1 AND date(received_at) IS NOT NULL) lot,
    COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0) branchQuantity,
    COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch),0) lotQuantity,
    EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch) branchExists,
    EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch) lotExists`).get<Snapshot>(params)
  if (!row?.product || !row.branch || !row.lot) throw new StockLotConflict('The product, branch or selected received date is no longer available.')
  return { ...row, productId: request.productId, branchId: request.branchId, batchId: request.batchId }
}

function effects(before: Snapshot, after: Snapshot, user: SessionUser, reason: string, operation: string, setScope: string, generation: number): Statement[] {
  const params = { product: before.productId, branch: before.branchId, batch: before.batchId,
    productSnapshot: before.product, branchSnapshot: before.branch, lotSnapshot: before.lot,
    oldBranch: before.branchQuantity, oldLot: before.lotQuantity, newBranch: after.branchQuantity, newLot: after.lotQuantity,
    actor: user.id, actorName: actorSnapshot(user), reason, operation, delta: Math.abs(after.lotQuantity - before.lotQuantity),
    before: JSON.stringify(before), after: JSON.stringify(after), setScope,
    oldBranchExists: before.branchExists, oldLotExists: before.lotExists, newBranchExists: after.branchExists, newLotExists: after.lotExists,
    movementType: after.lotQuantity < before.lotQuantity ? 'correction_out' : 'correction_in', reference: `stock-set:${operation}:${generation}` }
  return [guard(`
    (SELECT ${productSql} FROM products WHERE id=@product)=@productSnapshot
    AND (SELECT ${branchSql} FROM branches WHERE id=@branch)=@branchSnapshot
    AND (SELECT ${lotSql} FROM product_batches WHERE id=@batch)=@lotSnapshot
    AND COALESCE((SELECT quantity FROM branch_stock WHERE product_id=@product AND branch_id=@branch),0)=@oldBranch
    AND COALESCE((SELECT quantity FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch),0)=@oldLot
    AND EXISTS(SELECT 1 FROM branch_stock WHERE product_id=@product AND branch_id=@branch)=@oldBranchExists
    AND EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch)=@oldLotExists`, params),
    { sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) SELECT @batch,@branch,@newLot WHERE @newLotExists=1
      ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity,updated_at=CURRENT_TIMESTAMP`, params },
    { sql: `DELETE FROM branch_batch_stock WHERE batch_id=@batch AND branch_id=@branch AND @newLotExists=0`, params },
    { sql: `INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT @product,@branch,@newBranch WHERE @newBranchExists=1
      ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=excluded.quantity`, params },
    { sql: `DELETE FROM branch_stock WHERE product_id=@product AND branch_id=@branch AND @newBranchExists=0`, params },
    { sql: `UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(quantity),0) FROM branch_stock WHERE product_id=@product),updated_at=CURRENT_TIMESTAMP WHERE id=@product`, params },
    { sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,reason,user_id,user_name,reference_id,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr)
      SELECT @product,json_extract(@productSnapshot,'$.name'),@branch,json_extract(@branchSnapshot,'$.name'),@batch,@movementType,@delta,@reason,@actor,@actorName,@reference,NULL,NULL,NULL,NULL WHERE @delta>0`, params },
    { sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details)
      VALUES(@actor,@actorName,'stock_set','product',@product,json_object('operation_id',@operation,'setScope',@setScope,'reason',@reason,'before',json(@before),'after',json(@after)))`, params },
  ]
}

export async function applyStockLotSet(db: D1Compat, user: SessionUser, requestId: string, request: Request): Promise<Record<string, unknown>> {
  if (getActionTier(user, 'inventory', 'adjust') !== 'full') throw new StockLotConflict('Full inventory adjustment permission is required.')
  const requestJson = JSON.stringify(request)
  const previous = () => db.prepare('SELECT * FROM stock_lot_adjustment_operations WHERE actor_id=@actor AND request_id=@request').get<Operation>({ actor: user.id, request: requestId })
  const replay = (row: Operation) => {
    if (row.request_json !== requestJson) throw new StockLotConflict('client_request_id was already used for different stock adjustment data.')
    return { ...JSON.parse(row.response_json), replayed: true }
  }
  const existing = await previous()
  if (existing) return replay(existing)
  const before = await snapshot(db, request)
  const keys = { product: request.productId, branch: request.branchId, batch: request.batchId }
  const revisions = (await db.prepare(`SELECT ${revisionsSql} value`).get<{ value: string }>(keys))!.value
  if ((request.expectedLotQuantity !== undefined && request.expectedLotQuantity !== before.lotQuantity)
    || (request.expectedBranchQuantity !== undefined && request.expectedBranchQuantity !== before.branchQuantity)) throw new StockLotConflict('Stock changed since the selected received date was loaded. Refresh and try again.')
  const delta = request.quantity - (request.setScope === 'lot' ? before.lotQuantity : before.branchQuantity)
  const after = { ...before, lotQuantity: before.lotQuantity + delta, branchQuantity: before.branchQuantity + delta }
  after.lotExists = before.lotExists || (after.lotQuantity > 0 ? 1 : 0)
  after.branchExists = before.branchExists || (after.branchQuantity > 0 ? 1 : 0)
  if (![after.lotQuantity, after.branchQuantity].every(value => Number.isFinite(value) && value >= 0)) throw new StockLotConflict('The selected received date does not contain enough stock for this branch correction.')
  const operation = crypto.randomUUID()
  const payload = JSON.stringify({ applier: STOCK_LOT_SET_KIND, operation_id: operation, generation: 0 })
  const response = { success: true, productId: request.productId, branchId: request.branchId, batchId: request.batchId, setScope: request.setScope,
    movementType: 'set', quantity: Math.abs(delta), before, after, operation_id: operation, generation: 0, server_recorded: true }
  const params = { operation, actor: user.id, actorName: actorSnapshot(user), requestId, requestJson, digest: await transferRequestDigest(requestJson),
    response: JSON.stringify(response), before: JSON.stringify(before), after: JSON.stringify(after), payload, label: `Set ${request.setScope} quantity to ${request.quantity}: ${request.reason}`, ...keys, revisions }
  const statements: Statement[] = [
    guard(`${revisionsSql}=@revisions`, params),
    { sql: `INSERT INTO stock_lot_adjustment_operations(id,actor_id,request_id,request_json,request_digest,response_json,before_json,after_json,revision_json)
      VALUES(@operation,@actor,@requestId,@requestJson,@digest,@response,@before,@after,@revisions)`, params },
    ...effects(before, after, user, request.reason, operation, request.setScope, 0),
    { sql: `INSERT INTO action_history(scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id,created_by_name)
      VALUES('inventory','stock_quantity_set',@operation,@label,1,'undoable',@payload,@payload,@actor,@actorName)`, params },
    { sql: `UPDATE stock_lot_adjustment_operations SET history_id=last_insert_rowid(),response_json=json_set(response_json,'$.action_history_id',last_insert_rowid()),revision_json=${revisionsSql} WHERE id=@operation`, params },
  ]
  try { await db.batch(statements) } catch (error) {
    const concurrent = await previous()
    if (concurrent) return replay(concurrent)
    throw new StockLotConflict('Stock changed while saving. No correction was applied; refresh and try again.')
  }
  return JSON.parse((await previous())!.response_json)
}

export async function replayStockLotSet(env: Env, user: SessionUser, direction: 'undo' | 'redo', historyId: number, generation: unknown, payload: Record<string, unknown>): Promise<void> {
  if (getActionTier(user, 'inventory', 'adjust') !== 'full' || !Number.isSafeInteger(generation) || Number(generation) < 0) throw new StockLotConflict('An authorized stock adjustment generation is required.')
  const db = getDb(env)
  const row = await db.prepare('SELECT * FROM stock_lot_adjustment_operations WHERE id=@operation AND history_id=@history').get<Operation>({ operation: payload.operation_id, history: historyId })
  if (!row) throw new StockLotConflict('This correction has no exact stock provenance.')
  const target = direction === 'undo' ? 'reversed' : 'applied'
  const oldState = direction === 'undo' ? 'applied' : 'reversed'
  const next = Number(generation) + 1
  if (row.generation === next && row.state === target) return
  if (row.generation !== generation || payload.generation !== generation || row.state !== oldState) throw new StockLotConflict('This correction generation is stale. Refresh its history.')
  const before = JSON.parse(direction === 'undo' ? row.after_json : row.before_json) as Snapshot
  const after = JSON.parse(direction === 'undo' ? row.before_json : row.after_json) as Snapshot
  const params = { operation: row.id, history: historyId, generation: Number(generation), next, target, oldState,
    status: direction === 'undo' ? 'redoable' : 'undoable', oldStatus: direction === 'undo' ? 'undoable' : 'redoable',
    product: before.productId, branch: before.branchId, batch: before.batchId, revisions: row.revision_json }
  const statements = [guard(`EXISTS(SELECT 1 FROM stock_lot_adjustment_operations o JOIN action_history h ON h.id=o.history_id
    WHERE o.id=@operation AND h.id=@history AND o.generation=@generation AND o.state=@oldState AND h.status=@oldStatus
    AND json_extract(h.undo_payload,'$.applier')='stock.quantity_set' AND json_extract(h.redo_payload,'$.applier')='stock.quantity_set'
    AND json_extract(h.undo_payload,'$.operation_id')=@operation AND json_extract(h.redo_payload,'$.operation_id')=@operation
    AND json_extract(h.undo_payload,'$.generation')=@generation AND json_extract(h.redo_payload,'$.generation')=@generation)`, params),
    guard(`${revisionsSql}=@revisions`, params),
    ...effects(before, after, user, `${direction}: ${JSON.parse(row.request_json).reason}`, row.id, JSON.parse(row.request_json).setScope, next),
    { sql: `UPDATE stock_lot_adjustment_operations SET generation=@next,state=@target,revision_json=${revisionsSql} WHERE id=@operation`, params },
    { sql: `UPDATE action_history SET status=@status,last_error=NULL,updated_at=CURRENT_TIMESTAMP,
      undo_payload=json_set(undo_payload,'$.generation',@next),redo_payload=json_set(redo_payload,'$.generation',@next) WHERE id=@history`, params },
  ]
  try { await db.batch(statements) } catch {
    const current = await db.prepare('SELECT generation,state FROM stock_lot_adjustment_operations WHERE id=@operation').get<Operation>({ operation: row.id })
    if (current?.generation === next && current.state === target) return
    throw new StockLotConflict('Stock or received-date details changed after this correction. Nothing was changed.')
  }
}

export async function notifyStockLotSet(env: Env): Promise<void> {
  await Promise.all([broadcast(env, 'products', { action: 'update' }), broadcast(env, 'inventory', { action: 'adjust' }), bumpVersion(env, 'products')])
}
