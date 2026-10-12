import type { BindParams } from './db'
import type { ProductMergeCaseSnapshot } from './productMergeSnapshot'
import type { ProductMergeForwardCatalogPlan } from './productMergeForwardCatalog'
import { planProductMergeCaseSnapshot, productMergeCaptureGuard } from './productMergeSnapshot'
import { planProductMergeOrigins } from './productMergeOriginPlan'
import { planExactProductMergeStock } from './countedProductMerge'
import { catalogCostRecomputeStatement } from './catalogCostRecompute'
import { MERGE_PRICE_FIELDS } from './productMerge'
import { RESOLVE_CHOICE_VALUE_COLUMNS } from './productResolveChoices'
import { PRODUCT_MERGE_PLAN_V2, PRODUCT_MERGE_TRANSITION_V2, productMergePointer, type ProductMergePointer } from './productMergeProtocol'

type Statement = { sql: string; params?: BindParams }
type SnapshotRow = { id: number; kind: string; status: string; payload_json: string; created_by_id: number }
type HistoryRow = { id: number; scope: string; entity: string; entity_id: string; status: string; undo_payload: string; redo_payload: string; created_by_id: number }
export type ProductMergeReplayEvidence = { plan: SnapshotRow; history: HistoryRow; seal: SnapshotRow }
export type ProductMergeReplayIdentity = { transitionId: number; actorId: number; actorName: string | null; direction: 'undo' | 'redo'; pointer: ProductMergePointer }

const conflict = (): never => { throw new Error('merge_state_conflict') }
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return conflict()
  return value as Record<string, unknown>
}
const parse = (value: string) => {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 1024 * 1024) return conflict()
  try { return object(JSON.parse(value)) } catch { return conflict() }
}
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function planProductMergeReplay(current: ProductMergeCaseSnapshot, evidence: ProductMergeReplayEvidence, identity: ProductMergeReplayIdentity) {
  const { plan: planRow, history, seal } = evidence
  const plan = parse(planRow.payload_json), previous = parse(seal.payload_json), head = parse(history.undo_payload)
  const { transitionId, actorId, actorName, direction } = identity
  const pointer = identity.pointer
  if (!positiveId(transitionId) || !positiveId(actorId) || transitionId === planRow.id || transitionId === seal.id
    || (actorName !== null && typeof actorName !== 'string') || !['undo', 'redo'].includes(direction)
    || !positiveId(planRow.id) || planRow.kind !== PRODUCT_MERGE_PLAN_V2 || planRow.status !== 'recorded'
    || plan.version !== 2 || !positiveId(plan.actor_id) || planRow.created_by_id !== plan.actor_id
    || !positiveId(plan.history_id) || !positiveId(plan.keeper_id) || !positiveId(plan.loser_id) || plan.keeper_id === plan.loser_id
    || typeof plan.operation_id !== 'string' || typeof plan.source_capture !== 'string'
    || history.id !== plan.history_id || history.created_by_id !== plan.actor_id || history.scope !== 'products'
    || history.entity !== 'product_merge' || history.entity_id !== plan.operation_id || history.redo_payload !== history.undo_payload
    || !same(head, pointer) || !same(pointer, productMergePointer(planRow.id, plan.operation_id, pointer.generation, pointer.seal_id))
    || pointer.generation < 0 || history.status !== (direction === 'undo' ? 'undoable' : 'redoable')
    || (pointer.generation % 2 === 0 ? direction !== 'undo' : direction !== 'redo')
    || seal.id !== pointer.seal_id || seal.kind !== PRODUCT_MERGE_TRANSITION_V2 || seal.status !== 'sealed'
    || seal.created_by_id !== previous.actor_id || !positiveId(previous.actor_id)
    || previous.plan_id !== planRow.id || previous.history_id !== history.id || previous.operation_id !== plan.operation_id
    || previous.keeper_id !== plan.keeper_id || previous.loser_id !== plan.loser_id
    || previous.to_generation !== pointer.generation || previous.from_generation !== pointer.generation - 1
    || previous.direction !== (pointer.generation % 2 === 0 ? 'redo' : 'undo')) return conflict()
  const keeperId = plan.keeper_id, loserId = plan.loser_id, operationId = plan.operation_id
  const sourceRead = planProductMergeCaseSnapshot(keeperId, loserId, []).reads[0]
  const decode = (data: unknown) => planProductMergeCaseSnapshot(keeperId, loserId, [])
    .decode(new Map([['capture', [{ data, oversized: 0 }]]]))
  const original = decode(plan.source_capture)
  const sourceGuard = productMergeCaptureGuard(current)
  if (!same(previous.post_capture, JSON.parse(String(sourceGuard.params.observedCapture)))
    || current.canonicalProduct?.id !== keeperId || current.duplicateProduct?.id !== loserId
    || current.canonicalProduct.is_active !== 1 || current.duplicateProduct.is_active !== (direction === 'undo' ? 0 : 1)) return conflict()
  const saved = object(plan.origins)
  if (!Array.isArray(saved.receiptOrigins) || !Array.isArray(saved.tagOrigins)) return conflict()
  const origins = planProductMergeOrigins(original, { operationId,
    receiptIds: saved.receiptOrigins.map(value => { const row = object(value); return { sourceReceiptId: Number(object(row.original).id), targetReceiptId: Number(row.targetReceiptId) } }),
    tagIds: saved.tagOrigins.map(value => { const row = object(value); return { sourceTagId: Number(object(row.original).id), targetTagId: Number(row.targetTagId) } }),
  })
  const { receiptClones: _receipts, tagClones: _tags, ...expectedOrigins } = origins
  if (!same(expectedOrigins, saved)) return conflict()
  const exact = planExactProductMergeStock(original, 'merge')
  const undo = direction === 'undo'
  const write = (sql: string, params?: BindParams): Statement => ({ sql, params })
  const guard = (predicate: string, params: BindParams) => write(`SELECT CASE WHEN ${predicate} THEN 1 ELSE json_extract('[1]','$[merge_state_conflict]') END`, params)
  const statements: Statement[] = [sourceGuard, guard(`EXISTS(SELECT 1 FROM undo_snapshots p JOIN action_history h ON h.id=@historyId
    JOIN undo_snapshots s ON s.id=@sealId WHERE p.id=@planId AND p.kind=@planKind AND p.status='recorded' AND p.payload_json=@plan
    AND p.created_by_id=@originalActor AND h.scope='products' AND h.entity='product_merge' AND h.entity_id=@operationId
    AND h.created_by_id=p.created_by_id AND h.undo_payload=@prior AND h.redo_payload=@prior AND h.status=@historyStatus
    AND s.kind=@sealKind AND s.status='sealed' AND s.payload_json=@seal AND s.created_by_id=@sealActor)`,
  { planId: planRow.id, historyId: history.id, sealId: seal.id, planKind: PRODUCT_MERGE_PLAN_V2, plan: planRow.payload_json,
    originalActor: plan.actor_id, operationId, prior: history.undo_payload, historyStatus: history.status,
    sealKind: PRODUCT_MERGE_TRANSITION_V2, seal: seal.payload_json, sealActor: seal.created_by_id })]
  const branches = [...new Set(origins.physicalEdges.filter(edge => edge.quantity > 0).map(edge => edge.original.branchId))]
  statements.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@branches) r WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=r.value AND is_active=1))`, { branches: JSON.stringify(branches) }))

  let requiredPermissions: ProductMergeForwardCatalogPlan['requiredPermissions'] | null = null
  const catalogStatements: Statement[] = []
  const patchProduct = (id: number, patch: Record<string, unknown>) => {
    const allowed = new Set<string>([...RESOLVE_CHOICE_VALUE_COLUMNS, ...MERGE_PRICE_FIELDS, 'cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'parent_id', 'updated_at'])
    for (const [field, value] of Object.entries(patch)) {
      if (!allowed.has(field) || value !== null && !['string', 'number'].includes(typeof value)
        || typeof value === 'number' && !Number.isFinite(value)) return conflict()
    }
    if (Object.keys(patch).length) catalogStatements.push(write(`UPDATE products SET ${Object.keys(patch).map(field => `${field}=@${field}`).join(',')} WHERE id=@productId`, { ...patch, productId: id }))
  }
  if (plan.catalog !== undefined) {
    const catalog = object(plan.catalog), effects = object(catalog.effects), refs = object(catalog.beforeRefs)
    const reference = (section: string, rows: readonly { id: number }[]) => rows.map((row, index) => ({ section, index, id: row.id }))
    const expectedRefs = { keeper: { section: 'canonicalProduct', index: 0, id: keeperId }, loser: { section: 'duplicateProduct', index: 0, id: loserId },
      keeperImages: reference('canonicalImages', original.canonicalImageRows), loserImages: reference('duplicateImages', original.duplicateImageRows),
      children: reference('childProducts', original.childProductRows), promotions: reference('promotionRules', original.promotionRuleRows) }
    const permissions = object(catalog.requiredPermissions)
    if (catalog.version !== 1 || !same(refs, expectedRefs)
      || ['image', 'priceEdit', 'productEdit', 'acquisitionCostEdit'].some(key => typeof permissions[key] !== 'boolean')
      || !Array.isArray(effects.imageRows) || !Array.isArray(effects.removedImageIds) || !Array.isArray(effects.childRows) || !Array.isArray(effects.promotionRows)
      || !same(effects.removedImageIds, original.duplicateImageRows.map(row => row.id))) return conflict()
    requiredPermissions = permissions as ProductMergeForwardCatalogPlan['requiredPermissions']
    for (const [id, before, patch] of [[keeperId, original.canonicalProduct!, object(effects.keeperPatch)], [loserId, original.duplicateProduct!, object(effects.loserPatch)]] as const) {
      patchProduct(id, undo ? Object.fromEntries(Object.keys(patch).map(key => [key, before[key]])) : patch)
    }
    const images = effects.imageRows.map(value => object(value))
    if (images.some(row => !positiveId(row.id) || row.product_id !== keeperId || typeof row.image_path !== 'string'
      || !Number.isSafeInteger(row.sort_order) || typeof row.created_at !== 'string')
      || new Set(images.map(row => row.id)).size !== images.length
      || images.some(row => [...original.canonicalImageRows, ...original.duplicateImageRows].some(before => before.id === row.id))) return conflict()
    const absentIds = undo ? original.duplicateImageRows.map(row => row.id) : images.map(row => row.id)
    statements.push(guard('NOT EXISTS(SELECT 1 FROM product_images WHERE id IN(SELECT value FROM json_each(@ids)))', { ids: JSON.stringify(absentIds) }))
    const removedIds = undo ? images.map(row => row.id) : original.duplicateImageRows.map(row => row.id)
    if (removedIds.length) catalogStatements.push(write('DELETE FROM product_images WHERE id IN(SELECT value FROM json_each(@ids))', { ids: JSON.stringify(removedIds) }))
    const restoredImages = undo ? original.duplicateImageRows : images
    if (restoredImages.length) catalogStatements.push(write(`INSERT INTO product_images(id,product_id,image_path,sort_order,created_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.product_id'),json_extract(value,'$.image_path'),json_extract(value,'$.sort_order'),json_extract(value,'$.created_at') FROM json_each(@rows)`, { rows: JSON.stringify(restoredImages) }))
    const children = effects.childRows.map(value => object(value))
    if (children.length !== original.childProductRows.length || children.some((row, index) => row.id !== original.childProductRows[index].id
      || row.parent_id !== (row.id === keeperId ? null : keeperId) || typeof row.updated_at !== 'string')) return conflict()
    const currentChildren = (undo ? children : original.childProductRows).filter(row => row.id !== keeperId)
    statements.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@rows) r WHERE NOT EXISTS(SELECT 1 FROM products p
      WHERE p.id=json_extract(r.value,'$.id') AND p.parent_id IS json_extract(r.value,'$.parent_id') AND p.updated_at IS json_extract(r.value,'$.updated_at')))`, { rows: JSON.stringify(currentChildren) }))
    const targetChildren = undo ? original.childProductRows : children
    if (targetChildren.length) catalogStatements.push(write(`UPDATE products SET
      parent_id=(SELECT json_extract(value,'$.parent_id') FROM json_each(@rows) WHERE json_extract(value,'$.id')=products.id),
      updated_at=(SELECT json_extract(value,'$.updated_at') FROM json_each(@rows) WHERE json_extract(value,'$.id')=products.id)
      WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(@rows))`, { rows: JSON.stringify(targetChildren) }))
    const promotions = effects.promotionRows.map(value => object(value))
    if (new Set(promotions.map(row => row.id)).size !== promotions.length || promotions.some(row => !original.promotionRuleRows.some(before => before.id === row.id)
      || typeof row.product_ids !== 'string' || typeof row.updated_at !== 'string')) return conflict()
    const targetPromotions = undo ? promotions.map(row => original.promotionRuleRows.find(before => before.id === row.id)!) : promotions
    if (targetPromotions.length) catalogStatements.push(write(`UPDATE promotion_rules SET
      product_ids=(SELECT json_extract(value,'$.product_ids') FROM json_each(@rows) WHERE json_extract(value,'$.id')=promotion_rules.id),
      updated_at=(SELECT json_extract(value,'$.updated_at') FROM json_each(@rows) WHERE json_extract(value,'$.id')=promotion_rules.id)
      WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(@rows))`, { rows: JSON.stringify(targetPromotions) }))
  }
  if (undo) {
    patchProduct(keeperId, { cost_price_usd: original.canonicalProduct!.cost_price_usd, purchase_price_usd: original.canonicalProduct!.purchase_price_usd })
  }
  const nextPointer = productMergePointer(planRow.id, operationId, pointer.generation + 1, transitionId)
  const next = JSON.stringify(nextPointer)
  const transition = JSON.stringify({ operation_id: operationId, plan_id: planRow.id, history_id: history.id, keeper_id: keeperId, loser_id: loserId,
    actor_id: actorId, from_generation: pointer.generation, to_generation: nextPointer.generation, direction,
    prior_pointer: history.undo_payload, source_capture: sourceGuard.params.observedCapture })
  statements.push(write(`INSERT INTO undo_snapshots(id,kind,status,payload_json,created_by_id,created_by_name)
    VALUES(@id,@kind,'prepared',@payload,@actorId,@actorName)`, { id: transitionId, kind: PRODUCT_MERGE_TRANSITION_V2, payload: transition, actorId, actorName }))
  if (undo) statements.push(write('UPDATE products SET is_active=1 WHERE id=@loserId', { loserId }))
  const receiptIds = new Map(origins.receiptOrigins.map(row => [row.original.id, row.targetReceiptId]))
  const receipts = [...original.canonicalBatchStockRows.map(row => ({ batch_id: row.batch_id, branch_id: row.branch_id, quantity: row.quantity })),
    ...original.duplicateBatchStockRows.map(row => ({ batch_id: undo ? row.batch_id : receiptIds.get(row.batch_id), branch_id: row.branch_id, quantity: row.quantity }))]
  statements.push(write(`UPDATE branch_batch_stock SET quantity=0 WHERE quantity<>0 AND batch_id IN(SELECT id FROM product_batches WHERE variant_product_id IN(@keeperId,@loserId))`, { keeperId, loserId }),
    write(`INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)
      SELECT json_extract(value,'$.batch_id'),json_extract(value,'$.branch_id'),json_extract(value,'$.quantity') FROM json_each(@rows) WHERE 1
      ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=excluded.quantity`, { rows: JSON.stringify(receipts) }))
  const tags = original.damagedStockRows.map(row => ({ id: row.id, quantity: row.quantity_remaining }))
  if (!undo) for (const row of origins.tagOrigins) { const tag = tags.find(tag => tag.id === row.original.id)!; tags.push({ id: row.targetTagId, quantity: tag.quantity }); tag.quantity = 0 }
  statements.push(write('UPDATE damaged_stock_lots SET quantity_remaining=0 WHERE product_id IN(@keeperId,@loserId) AND quantity_remaining<>0', { keeperId, loserId }),
    write(`UPDATE damaged_stock_lots SET quantity_remaining=(SELECT json_extract(value,'$.quantity') FROM json_each(@rows) WHERE json_extract(value,'$.id')=damaged_stock_lots.id)
      WHERE id IN(SELECT json_extract(value,'$.id') FROM json_each(@rows))`, { rows: JSON.stringify(tags) }))
  const branchRows = undo ? [...original.canonicalStockBefore.map(row => ({ product_id: keeperId, ...row })), ...original.duplicateStockRows.map(row => ({ product_id: loserId, ...row }))]
    : [...exact.keeperByBranch].map(([branch_id, quantity]) => ({ product_id: keeperId, branch_id, quantity }))
  statements.push(write('UPDATE branch_stock SET quantity=0 WHERE product_id IN(@keeperId,@loserId) AND quantity<>0', { keeperId, loserId }),
    write(`INSERT INTO branch_stock(product_id,branch_id,quantity)
      SELECT json_extract(value,'$.product_id'),json_extract(value,'$.branch_id'),json_extract(value,'$.quantity') FROM json_each(@rows) WHERE 1
      ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=excluded.quantity`, { rows: JSON.stringify(branchRows) }),
    write('UPDATE products SET stock_quantity=CASE id WHEN @keeperId THEN @keeperTotal ELSE @loserTotal END,updated_at=CURRENT_TIMESTAMP WHERE id IN(@keeperId,@loserId)',
      { keeperId, loserId, keeperTotal: undo ? exact.keeperSource.total : exact.keeperTotal, loserTotal: undo ? exact.duplicateSource.total : 0 }))
  const movements = origins.physicalEdges.filter(edge => edge.quantity > 0).flatMap(edge => [
    { ...(undo ? edge.effect : edge.original), quantity: -edge.quantity, ordinal: edge.ordinal },
    { ...(undo ? edge.original : edge.effect), quantity: edge.quantity, ordinal: edge.ordinal },
  ]).map(edge => ({ ...edge, productName: (edge.productId === keeperId ? original.canonicalProduct : original.duplicateProduct)!.name }))
  statements.push(write(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,batch_id,movement_type,quantity,reason,reference_id,user_id,user_name)
    SELECT json_extract(m.value,'$.productId'),json_extract(m.value,'$.productName'),json_extract(m.value,'$.branchId'),b.name,json_extract(m.value,'$.batchId'),
      'adjustment',json_extract(m.value,'$.quantity'),json_object('operation','product.merge','operation_id',@operationId,'generation',@generation,
        'ordinal',json_extract(m.value,'$.ordinal'),'condition_tag',json_extract(m.value,'$.conditionTag'),'damaged_lot_id',json_extract(m.value,'$.damagedLotId')),
      @historyId,@actorId,@actorName FROM json_each(@rows) m JOIN branches b ON b.id=json_extract(m.value,'$.branchId')`,
    { rows: JSON.stringify(movements), operationId, generation: nextPointer.generation, historyId: history.id, actorId, actorName }), ...catalogStatements)
  if (!undo) statements.push(catalogCostRecomputeStatement(keeperId), write('UPDATE products SET is_active=0 WHERE id=@loserId', { loserId }))
  statements.push(write(`UPDATE action_history SET undo_payload=@next,redo_payload=@next,status=@status,updated_at=CURRENT_TIMESTAMP
    WHERE id=@historyId AND undo_payload=@prior AND redo_payload=@prior`, { next, status: undo ? 'redoable' : 'undoable', historyId: history.id, prior: history.undo_payload }),
    write(`UPDATE undo_snapshots SET status='sealing',payload_json=json_set(payload_json,'$.post_capture',json((SELECT data FROM (${sourceRead.sql}) WHERE oversized=0))) WHERE id=@transitionId`, { ...sourceRead.params, transitionId }))
  return { statements, pointer: nextPointer, requiredPermissions, moved: exact.moved }
}
