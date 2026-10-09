import type { BindParams } from './db'
import type { ProductMergeCaseSnapshot } from './productMergeSnapshot'
import type { MergeOriginReservation } from './productMergeOriginPlan'
import { planProductMergeCaseSnapshot, productMergeCaptureGuard } from './productMergeSnapshot'
import { planProductMergeOrigins } from './productMergeOriginPlan'
import { planExactProductMergeStock } from './countedProductMerge'
import { catalogCostRecomputeStatement } from './catalogCostRecompute'
import { PRODUCT_MERGE_PLAN_V2, PRODUCT_MERGE_TRANSITION_V2, productMergePointer } from './productMergeProtocol'
import { planProductMergeForwardCatalog, type ProductMergeForwardCatalogOptions } from './productMergeForwardCatalog'

type Statement = { sql: string; params?: BindParams }
export type ProductMergeForwardStockIdentity = {
  planId: number
  transitionId: number
  historyId: number
  actorId: number
  actorName: string | null
  requestId: string
  requestDigest: string
  origins: MergeOriginReservation
}

export function planProductMergeForwardStock(snapshot: ProductMergeCaseSnapshot, identity: ProductMergeForwardStockIdentity, catalogOptions?: ProductMergeForwardCatalogOptions) {
  const { planId, transitionId, historyId, actorId, actorName, requestId, requestDigest } = identity
  if ([planId, transitionId, historyId, actorId].some(id => !Number.isSafeInteger(id) || id <= 0)
    || planId === transitionId || typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200
    || typeof requestDigest !== 'string' || !requestDigest.trim() || requestDigest.length > 200
    || (actorName !== null && typeof actorName !== 'string')
    || snapshot.canonicalProduct?.is_active !== 1 || snapshot.duplicateProduct?.is_active !== 1) throw new Error('merge_state_conflict')
  const origins = planProductMergeOrigins(snapshot, identity.origins)
  const exact = planExactProductMergeStock(snapshot, 'merge')
  const { keeperId, loserId, operationId } = origins
  const sourceGuard = productMergeCaptureGuard(snapshot)
  const catalog = catalogOptions ? planProductMergeForwardCatalog(snapshot, catalogOptions) : null
  const catalogGuards = catalog?.admissionGuards.filter(statement => statement.sql !== sourceGuard.sql
    || JSON.stringify(statement.params) !== JSON.stringify(sourceGuard.params)) ?? []
  const sourceCapture = sourceGuard.params.observedCapture
  const sourceRead = planProductMergeCaseSnapshot(keeperId, loserId, []).reads[0]
  const prior = JSON.stringify(productMergePointer(planId, operationId, -1, null))
  const pointer = productMergePointer(planId, operationId, 0, transitionId)
  const next = JSON.stringify(pointer)
  const { receiptClones, tagClones, ...savedOrigins } = origins
  const plan = JSON.stringify({ version: 2, actor_id: actorId, history_id: historyId, operation_id: operationId,
    request_id: requestId, request_digest: requestDigest, keeper_id: keeperId, loser_id: loserId,
    source_capture: sourceCapture, origins: savedOrigins,
    ...(catalog ? { catalog: { version: 1, beforeRefs: catalog.beforeRefs, effects: catalog.effects, requiredPermissions: catalog.requiredPermissions } } : {}) })
  const planBytes = new TextEncoder().encode(plan).byteLength
  if (planBytes > 1024 * 1024) throw new Error('merge_case_snapshot_limit')
  const transition = JSON.stringify({ operation_id: operationId, plan_id: planId, history_id: historyId,
    keeper_id: keeperId, loser_id: loserId, actor_id: actorId, from_generation: -1, to_generation: 0,
    direction: 'redo', prior_pointer: prior, source_capture: sourceCapture })
  const receiptIds = new Map(origins.receiptOrigins.map(row => [row.original.id, row.targetReceiptId]))
  const receiptStock = snapshot.duplicateBatchStockRows.map(row => ({ batch_id: receiptIds.get(row.batch_id), branch_id: row.branch_id, quantity: row.quantity }))
  const branches = [...exact.duplicateSource.quantityByBranch].filter(([, quantity]) => quantity > 0).map(([branchId]) => branchId)
  const targetStock = branches.map(branchId => ({ branch_id: branchId, quantity: exact.keeperByBranch.get(branchId) }))
  const write = (sql: string, params?: BindParams): Statement => ({ sql, params })
  const insertRows = (table: 'product_batches' | 'damaged_stock_lots', rows: Array<{ metadata: Record<string, unknown> }>): Statement[] => {
    if (!rows.length) return []
    const columns = Object.keys(rows[0].metadata)
    if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('merge_state_conflict')
    return [write(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(',')}
      FROM json_each(@rows)`, { rows: JSON.stringify(rows.map(row => row.metadata)) })]
  }
  const movements = origins.physicalEdges.filter(edge => edge.quantity > 0).flatMap(edge => [
    { ...edge.original, quantity: -edge.quantity, productName: snapshot.duplicateProduct!.name, ordinal: edge.ordinal },
    { ...edge.effect, quantity: edge.quantity, productName: snapshot.canonicalProduct!.name, ordinal: edge.ordinal },
  ])
  const statements: Statement[] = [sourceGuard, ...catalogGuards,
    write(`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(@branches) required
      WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=required.value AND is_active=1))
      THEN 1 ELSE json_extract('[1]','$[merge_state_conflict]') END`, { branches: JSON.stringify(branches) }),
    write(`INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id,created_by_name)
      VALUES(@planId,@kind,'recorded',@plan,@actorId,@actorName)`, { planId, kind: PRODUCT_MERGE_PLAN_V2, plan, actorId, actorName }),
    write(`INSERT INTO action_history(id,scope,entity,entity_id,label,status,undo_payload,redo_payload,created_by_id,created_by_name)
      VALUES(@historyId,'products','product_merge',@operationId,@label,'recorded',@prior,@prior,@actorId,@actorName)`,
    { historyId, operationId, label: `Merge product #${loserId} into #${keeperId}`, prior, actorId, actorName }),
    write(`INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id,created_by_name)
      VALUES(@transitionId,@kind,'prepared',@transition,@actorId,@actorName)`,
    { transitionId, kind: PRODUCT_MERGE_TRANSITION_V2, transition, actorId, actorName }),
    ...insertRows('product_batches', receiptClones),
    write(`UPDATE branch_batch_stock SET quantity=0 WHERE quantity<>0 AND batch_id IN
      (SELECT id FROM product_batches WHERE variant_product_id=@loserId)`, { loserId }),
    write(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      SELECT json_extract(value,'$.batch_id'),json_extract(value,'$.branch_id'),json_extract(value,'$.quantity') FROM json_each(@rows)`,
    { rows: JSON.stringify(receiptStock) }),
    write('UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id=@loserId AND quantity_remaining<>0', { loserId }),
    ...insertRows('damaged_stock_lots', tagClones),
    write('UPDATE branch_stock SET quantity=0 WHERE product_id=@loserId AND quantity<>0', { loserId }),
    write(`INSERT INTO branch_stock(product_id,branch_id,quantity)
      SELECT @keeperId,json_extract(value,'$.branch_id'),json_extract(value,'$.quantity') FROM json_each(@rows) WHERE 1
      ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=excluded.quantity`, { keeperId, rows: JSON.stringify(targetStock) }),
    write(`UPDATE products SET stock_quantity=CASE id WHEN @keeperId THEN @total ELSE 0 END,updated_at=CURRENT_TIMESTAMP
      WHERE id IN (@keeperId,@loserId)`, { keeperId, loserId, total: exact.keeperTotal }),
    write(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,reason,reference_id,user_id,user_name)
      SELECT json_extract(m.value,'$.productId'),json_extract(m.value,'$.productName'),json_extract(m.value,'$.branchId'),b.name,
        json_extract(m.value,'$.batchId'),'adjustment',json_extract(m.value,'$.quantity'),
        json_object('operation','product.merge','operation_id',@operationId,'generation',0,'ordinal',json_extract(m.value,'$.ordinal'),
          'condition_tag',json_extract(m.value,'$.conditionTag'),'damaged_lot_id',json_extract(m.value,'$.damagedLotId')),
        @historyId,@actorId,@actorName FROM json_each(@rows) m JOIN branches b ON b.id=json_extract(m.value,'$.branchId')`,
    { operationId, historyId, actorId, actorName, rows: JSON.stringify(movements) }),
    ...(catalog?.statements ?? []),
    catalogCostRecomputeStatement(keeperId),
    write('UPDATE products SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=@loserId', { loserId }),
    write(`UPDATE action_history SET undo_payload=@next,redo_payload=@next,status='undoable',updated_at=CURRENT_TIMESTAMP
      WHERE id=@historyId AND undo_payload=@prior AND redo_payload=@prior`, { next, historyId, prior }),
    write(`UPDATE undo_snapshots SET status='sealing',payload_json=json_set(payload_json,'$.post_capture',
      json((SELECT data FROM (${sourceRead.sql}) WHERE oversized=0))) WHERE id=@transitionId`, { ...sourceRead.params, transitionId }),
  ]
  return { statements, pointer, planBytes, moved: exact.moved, catalog }
}
