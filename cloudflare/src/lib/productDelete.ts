import type { SessionUser } from './auth'
import { actorSnapshot } from './actorSnapshot'
import type { getDb } from './db'

export const PRODUCT_REMOVE_ACTION_KIND = 'product.remove'
export const PRODUCT_REMOVE_MAX_SOURCE_BYTES = 384 * 1024
export const PRODUCT_REMOVE_MAX_LOTS = 1000

export type ProductRemoveStatement = { sql: string; params?: Record<string, unknown> }

export type ProductRemovePlan = {
  version: 1
  product_id: number
  reason: string
  product: Record<string, unknown>
  branch_stock: Array<Record<string, unknown>>
  batches: Array<Record<string, unknown>>
  branch_batch_stock: Array<Record<string, unknown>>
  product_images: Array<Record<string, unknown>>
  child_links: Array<Record<string, unknown>>
  source_bytes: number
  state_digest: string
}

export type ProductRemoveOperationRow = {
  operation_id: string
  actor_id: number
  requester_id: number
  source: 'direct' | 'conflict_review'
  request_id: string
  review_id: string | null
  action_ordinal: number | null
  product_id: number
  reason: string
  state_digest: string
  plan_digest: string
  plan_json: string
  status: 'reviewed' | 'blocked' | 'ready' | 'approval_pending' | 'undo_ready' | 'refused' | 'reversed'
  pending_action_id: number | null
  undo_snapshot_id: number | null
  action_history_id: number | null
  generation: number
  response_json: string | null
}

export class ProductRemoveError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 | 413 = 409) {
    super(message)
    this.name = 'ProductRemoveError'
  }
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256-${[...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

function rows<T extends Record<string, unknown>>(value: T[]): T[] {
  return value.map((row) => ({ ...row }))
}

export async function prepareProductRemovePlan(
  db: ReturnType<typeof getDb>,
  productId: number,
  reason: string,
): Promise<ProductRemovePlan> {
  const product = await db.prepare('SELECT * FROM products WHERE id=@product').get<Record<string, unknown>>({ product: productId })
  if (!product) throw new ProductRemoveError('product_not_found', 'Product not found.', 404)
  if (Number(product.is_active) !== 1 || Number(product.is_group) === 1) {
    throw new ProductRemoveError('product_not_removable', 'Only an active non-group product can be removed.')
  }
  const lotCount = await db.prepare('SELECT COUNT(*) AS count FROM product_batches WHERE variant_product_id=@product')
    .get<{ count: number }>({ product: productId })
  if (Number(lotCount?.count) > PRODUCT_REMOVE_MAX_LOTS) {
    throw new ProductRemoveError('remove_graph_too_large', 'This product has too many receipt lots for one reversible removal.', 413)
  }
  const branchStock = rows(await db.prepare(`SELECT bs.id,bs.product_id,bs.branch_id,bs.quantity,bs.rfid_confirmed_qty,b.name AS branch_name
    FROM branch_stock bs LEFT JOIN branches b ON b.id=bs.branch_id WHERE bs.product_id=@product ORDER BY bs.id`)
    .all<Record<string, unknown>>({ product: productId }))
  const batches = rows(await db.prepare(`SELECT id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,synthetic,
      created_at,updated_at,batch_number,supplier_id,supplier_name,payment_status,credit_due_date,unit_cost_usd,
      received_quantity,received_branch_id,received_cost_usd
    FROM product_batches WHERE variant_product_id=@product ORDER BY id`).all<Record<string, unknown>>({ product: productId }))
  const branchBatchStock = rows(await db.prepare(`SELECT bbs.id,bbs.batch_id,bbs.branch_id,bbs.quantity,bbs.created_at,bbs.updated_at
    FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id=bbs.batch_id
    WHERE pb.variant_product_id=@product ORDER BY bbs.id`).all<Record<string, unknown>>({ product: productId }))
  const productImages = rows(await db.prepare(`SELECT id,product_id,image_path,sort_order,created_at
    FROM product_images WHERE product_id=@product ORDER BY id`).all<Record<string, unknown>>({ product: productId }))
  const childLinks = rows(await db.prepare(`SELECT id,parent_id FROM products WHERE parent_id=@product ORDER BY id`)
    .all<Record<string, unknown>>({ product: productId }))
  const source = { product: { ...product }, branch_stock: branchStock, batches, branch_batch_stock: branchBatchStock,
    product_images: productImages, child_links: childLinks }
  const sourceBytes = byteLength(source)
  if (sourceBytes > PRODUCT_REMOVE_MAX_SOURCE_BYTES) {
    throw new ProductRemoveError('remove_graph_too_large', 'This product graph is too large for one reversible removal.', 413)
  }
  return {
    version: 1, product_id: productId, reason, ...source, source_bytes: sourceBytes,
    state_digest: await sha256({ version: 1, product_id: productId, reason, source }),
  }
}

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Unsafe database column in product removal snapshot.')
  return `"${value}"`
}

function exactObjectSql(alias: string, object: Record<string, unknown>, parameter: string): string {
  const fields = Object.keys(object)
  if (!fields.length) return '0'
  return fields.map((field) => `${alias}.${identifier(field)} IS json_extract(@${parameter},'$.${field}')`).join('\n        AND ')
}

function exactRowsSql(args: {
  table: string
  alias: string
  scope: string
  rows: Array<Record<string, unknown>>
  parameter: string
  identity: string[]
}): string {
  const columns = args.rows[0] ? Object.keys(args.rows[0]).filter((field) => field !== 'branch_name') : args.identity
  const matches = columns.map((field) => `${args.alias}.${identifier(field)} IS json_extract(expected.value,'$.${field}')`).join('\n              AND ')
  return `(SELECT COUNT(*) FROM ${args.table} ${args.alias} WHERE ${args.scope})=json_array_length(json(@${args.parameter}))
      AND NOT EXISTS (SELECT 1 FROM json_each(json(@${args.parameter})) expected WHERE NOT EXISTS (
        SELECT 1 FROM ${args.table} ${args.alias} WHERE ${args.scope}${matches ? `\n              AND ${matches}` : ''}
      ))`
}

function expectedDeletedPlan(plan: ProductRemovePlan, transitionStamp: string): ProductRemovePlan {
  return {
    ...plan,
    product: { ...plan.product, is_active: 0, stock_quantity: 0, rfid_confirmed_qty: 0, updated_at: transitionStamp },
    branch_stock: plan.branch_stock.map((row) => ({ ...row, quantity: 0, rfid_confirmed_qty: 0 })),
    batches: plan.batches.map((row) => ({ ...row, is_active: 0, updated_at: transitionStamp })),
    branch_batch_stock: plan.branch_batch_stock.map((row) => ({ ...row, quantity: 0, updated_at: transitionStamp })),
  }
}

export function productRemoveGraphGuard(
  plan: ProductRemovePlan,
  expected: 'source' | 'deleted',
  transitionStamp?: string,
): ProductRemoveStatement {
  const snapshot = expected === 'source' ? plan : expectedDeletedPlan(plan, String(transitionStamp || ''))
  const productColumns = Object.keys(snapshot.product)
  if (!productColumns.length) throw new Error('Product removal snapshot is missing the product row.')
  return {
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM products p WHERE p.id=@product
        AND ${exactObjectSql('p', snapshot.product, 'productJson')})
      AND ${exactRowsSql({ table: 'branch_stock', alias: 'bs', scope: 'bs.product_id=@product', rows: snapshot.branch_stock,
        parameter: 'stockJson', identity: ['id', 'product_id', 'branch_id', 'quantity', 'rfid_confirmed_qty'] })}
      AND ${exactRowsSql({ table: 'product_batches', alias: 'pb', scope: 'pb.variant_product_id=@product', rows: snapshot.batches,
        parameter: 'batchesJson', identity: ['id'] })}
      AND ${exactRowsSql({ table: 'branch_batch_stock', alias: 'bbs', scope: 'bbs.batch_id IN (SELECT id FROM product_batches WHERE variant_product_id=@product)',
        rows: snapshot.branch_batch_stock, parameter: 'batchStockJson', identity: ['id'] })}
      AND ${exactRowsSql({ table: 'product_images', alias: 'pi', scope: 'pi.product_id=@product', rows: snapshot.product_images,
        parameter: 'imagesJson', identity: ['id'] })}
      AND ${exactRowsSql({ table: 'products', alias: 'child', scope: 'child.parent_id=@product', rows: snapshot.child_links,
        parameter: 'childrenJson', identity: ['id', 'parent_id'] })}
      THEN 1 ELSE json_extract('', '$') END AS product_remove_graph_guard`,
    params: {
      product: plan.product_id, productJson: JSON.stringify(snapshot.product), stockJson: JSON.stringify(snapshot.branch_stock),
      batchesJson: JSON.stringify(snapshot.batches), batchStockJson: JSON.stringify(snapshot.branch_batch_stock),
      imagesJson: JSON.stringify(snapshot.product_images), childrenJson: JSON.stringify(snapshot.child_links),
    },
  }
}

export async function productRemovePlanDigest(plan: ProductRemovePlan): Promise<string> {
  return sha256(plan)
}

export function productRemoveQueueStatements(args: {
  plan: ProductRemovePlan
  operationId: string
  requestId: string
  user: SessionUser
  planDigest: string
}): ProductRemoveStatement[] {
  const userName = actorSnapshot(args.user)
  const payload = JSON.stringify({ kind: 'product.remove.pending', operation_id: args.operationId, plan_digest: args.planDigest })
  return [productRemoveGraphGuard(args.plan, 'source'), {
    sql: `INSERT INTO product_remove_operations(operation_id,actor_id,requester_id,source,request_id,product_id,reason,
      state_digest,plan_digest,plan_json,status)
      VALUES(@operation,@actor,@actor,'direct',@request,@product,@reason,@stateDigest,@planDigest,@plan,'approval_pending')`,
    params: { operation: args.operationId, actor: args.user.id, request: args.requestId, product: args.plan.product_id,
      reason: args.plan.reason, stateDigest: args.plan.state_digest, planDigest: args.planDigest, plan: JSON.stringify(args.plan) },
  }, {
    sql: `INSERT INTO pending_actions(section,action_type,entity_type,entity_id,payload_json,summary,status,requested_by,requested_by_name)
      VALUES('products','delete','product',@product,@payload,@summary,'open',@actor,@actorName)`,
    params: { product: args.plan.product_id, payload, summary: `Remove product #${args.plan.product_id}`,
      actor: args.user.id, actorName: userName },
  }, {
    sql: `UPDATE product_remove_operations SET pending_action_id=last_insert_rowid(),updated_at=CURRENT_TIMESTAMP
      WHERE operation_id=@operation AND status='approval_pending' AND pending_action_id IS NULL`,
    params: { operation: args.operationId },
  }]
}

export function productRemoveApplyStatements(args: {
  plan: ProductRemovePlan
  operationId: string
  source: 'direct' | 'conflict_review'
  requestId: string
  reviewId?: string | null
  actionOrdinal?: number | null
  user: SessionUser
  transitionStamp: string
  planDigest: string
  pendingActionId?: number | null
}): ProductRemoveStatement[] {
  const { plan } = args
  const userName = actorSnapshot(args.user)
  const pointer = JSON.stringify({ applier: PRODUCT_REMOVE_ACTION_KIND, operation_id: args.operationId, generation: 0 })
  const snapshot = JSON.stringify({ version: 1, operation_id: args.operationId, generation: 0, transition_stamp: args.transitionStamp, plan })
  const details = JSON.stringify({ operation_id: args.operationId, reason: plan.reason, source: args.source })
  return [{
    sql: `INSERT INTO product_remove_operations(operation_id,actor_id,requester_id,source,request_id,review_id,action_ordinal,
      product_id,reason,state_digest,plan_digest,plan_json,status,pending_action_id)
      VALUES(@operation,@actor,@actor,@source,@request,@review,@ordinal,@product,@reason,@stateDigest,@planDigest,@plan,'ready',@pending)
      ON CONFLICT(actor_id,source,request_id) DO NOTHING`,
    params: { operation: args.operationId, actor: args.user.id, source: args.source, request: args.requestId,
      review: args.reviewId ?? null, ordinal: args.actionOrdinal ?? null, product: plan.product_id, reason: plan.reason,
      stateDigest: plan.state_digest, planDigest: args.planDigest, plan: JSON.stringify(plan), pending: args.pendingActionId ?? null },
  }, {
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM product_remove_operations
      WHERE operation_id=@operation AND actor_id=@actor AND source=@source AND request_id=@request
        AND product_id=@product AND state_digest=@stateDigest AND plan_digest=@planDigest AND status='ready' AND generation=0
        AND ((@review IS NULL AND review_id IS NULL) OR review_id=@review)
        AND ((@pending IS NULL AND pending_action_id IS NULL) OR pending_action_id=@pending))
      AND (@pending IS NULL OR EXISTS(SELECT 1 FROM pending_actions WHERE id=@pending AND status='open'))
      AND NOT EXISTS(SELECT 1 FROM stock_session_members sm JOIN stock_session_operations so ON so.id=sm.operation_id
        JOIN action_history ah ON ah.id=so.history_id WHERE sm.product_id=@product AND ah.status IN ('undoable','redoable'))
      THEN 1 ELSE json_extract('', '$') END AS product_remove_receipt_guard`,
    params: { operation: args.operationId, actor: args.user.id, source: args.source, request: args.requestId,
      product: plan.product_id, stateDigest: plan.state_digest, planDigest: args.planDigest,
      review: args.reviewId ?? null, pending: args.pendingActionId ?? null },
  }, productRemoveGraphGuard(plan, 'source'), {
    sql: `INSERT INTO undo_snapshots(kind,status,payload_json,created_by_id,created_by_name)
      VALUES(@kind,'applied',@payload,@actor,@actorName)`,
    params: { kind: PRODUCT_REMOVE_ACTION_KIND, payload: snapshot, actor: args.user.id, actorName: userName },
  }, {
    sql: `UPDATE product_remove_operations SET undo_snapshot_id=last_insert_rowid() WHERE operation_id=@operation AND status='ready'`,
    params: { operation: args.operationId },
  }, {
    sql: `INSERT INTO action_history(scope,entity,entity_id,label,undo_label,redo_label,reversible,status,undo_payload,redo_payload,
      created_by_id,created_by_name)
      VALUES('products','product',@product,@label,'Restore removed product','Remove product again',1,'undoable',@pointer,@pointer,@actor,@actorName)`,
    params: { product: String(plan.product_id), label: `Removed product ${String(plan.product.name || `#${plan.product_id}`)}`,
      pointer, actor: args.user.id, actorName: userName },
  }, {
    sql: `UPDATE product_remove_operations SET action_history_id=last_insert_rowid() WHERE operation_id=@operation AND status='ready'`,
    params: { operation: args.operationId },
  }, {
    sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,reason,user_id,user_name,created_at)
      SELECT @product,@productName,CAST(json_extract(value,'$.branch_id') AS INTEGER),json_extract(value,'$.branch_name'),
        'write_off',CAST(json_extract(value,'$.quantity') AS REAL),@reason,@actor,@actorName,@stamp
      FROM json_each(@rows) WHERE CAST(json_extract(value,'$.quantity') AS REAL)>0`,
    params: { product: plan.product_id, productName: plan.product.name ?? null, reason: plan.reason,
      actor: args.user.id, actorName: userName, stamp: args.transitionStamp, rows: JSON.stringify(plan.branch_stock) },
  }, {
    sql: `UPDATE products SET is_active=0,stock_quantity=0,rfid_confirmed_qty=0,updated_at=@stamp WHERE id=@product`,
    params: { stamp: args.transitionStamp, product: plan.product_id },
  }, {
    sql: `UPDATE branch_stock SET quantity=0,rfid_confirmed_qty=0 WHERE product_id=@product`,
    params: { product: plan.product_id },
  }, {
    sql: `UPDATE branch_batch_stock SET quantity=0,updated_at=@stamp
      WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id=@product)`,
    params: { stamp: args.transitionStamp, product: plan.product_id },
  }, {
    sql: `UPDATE product_batches SET is_active=0,updated_at=@stamp WHERE variant_product_id=@product`,
    params: { stamp: args.transitionStamp, product: plan.product_id },
  }, {
    sql: `INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,table_name,record_id,new_value)
      VALUES(@actor,@actorName,'delete','product',@product,@details,'products',@product,@details)`,
    params: { actor: args.user.id, actorName: userName, product: String(plan.product_id), details },
  }, ...(args.pendingActionId ? [{
    sql: `UPDATE pending_actions SET status='approved',reviewed_by=@actor,reviewed_by_name=@actorName,
      reviewed_at=@stamp,updated_at=@stamp WHERE id=@pending AND status='open'`,
    params: { actor: args.user.id, actorName: userName, stamp: args.transitionStamp, pending: args.pendingActionId },
  }] : []), {
    sql: `UPDATE product_remove_operations SET status='undo_ready',generation=0,
      last_transition_request_id=@request,last_transition_direction='apply',last_transition_from_generation=0,
      last_transition_to_generation=0,response_json=json_object('success',json('true'),'operation_id',@operation,
        'product_id',@product,'status','undo_ready','action_history_id',action_history_id,'generation',0),updated_at=@stamp
      WHERE operation_id=@operation AND status='ready' AND undo_snapshot_id IS NOT NULL AND action_history_id IS NOT NULL`,
    params: { request: args.requestId, operation: args.operationId, product: plan.product_id, stamp: args.transitionStamp },
  }]
}
