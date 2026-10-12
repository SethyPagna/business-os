import type { D1Compat, BindParams } from './db'
import type { SessionUser } from './auth'
import type { ProductMergeCaseSnapshot } from './productMergeSnapshot'
import type { ProductMergeForwardStockIdentity } from './productMergeForwardStock'
import type { ProductMergeForwardCatalogOptions, ProductMergeForwardCatalogPlan } from './productMergeForwardCatalog'
import { productMergeGalleryAdditions } from './productMergeForwardCatalog'
import { readProductMergeReservations } from './productMergeReservations'
import { planProductMergeForwardStock } from './productMergeForwardStock'
import { PRODUCT_MERGE_PLAN_V2, PRODUCT_MERGE_TRANSITION_V2, productMergePointer } from './productMergeProtocol'
import { stockActorParams, stockActorPredicate } from './stockActorGuard'
import { getActionTier } from './permissions'
import { canEditAcquisitionCosts } from './acquisitionCostAccess'
import { sumCountedQuantities } from './countedDamagedStock'
import { executeStockTransaction, stockTransactionStatementCount, StockTransactionOutcomeUnknownError, StockTransactionUnavailableError } from './stockTransaction'

type Statement = { sql: string; params?: BindParams }
export type ProductMergeRequest = { keeperId: number; loserId: number; requestId: string; requestDigest: string }
export type ProductMergeRequestBudget = { limit: number; used: () => number; tailReserve: number }
export type ProductMergeRequestAuthority = { predicate: string; params: Record<string, unknown> }
export type ProductMergeRequestPreparation = {
  snapshot: ProductMergeCaseSnapshot
  identity: Pick<ProductMergeForwardStockIdentity, 'planId' | 'transitionId' | 'historyId' | 'origins'>
  guards: Statement[]
  afterStatements?: Statement[]
  catalog?: ProductMergeForwardCatalogOptions
}
export type ProductMergeReceipt = {
  keptId: number; mergedId: number; operationId: string; actionHistoryId: number
  planId: number; generation: 0; quantityMoved: number
}
export class ProductMergeRequestError extends Error {
  constructor(readonly code: 'merge_request_conflict' | 'merge_request_budget' | 'merge_request_permission') {
    super(code); this.name = 'ProductMergeRequestError'
  }
}
const conflict = (): never => { throw new ProductMergeRequestError('merge_request_conflict') }
function catalogPermission(user: SessionUser, required: ProductMergeForwardCatalogPlan['requiredPermissions']): void {
  if (!required || ['image', 'priceEdit', 'productEdit', 'acquisitionCostEdit'].some(key => typeof required[key as keyof typeof required] !== 'boolean')) conflict()
  if ((required.image && getActionTier(user, 'products', 'image') !== 'full')
    || (required.productEdit && getActionTier(user, 'products', 'edit') !== 'full')
    || (required.priceEdit && (getActionTier(user, 'products', 'edit') !== 'full' || getActionTier(user, 'products', 'price') === 'none'))
    || (required.acquisitionCostEdit && !canEditAcquisitionCosts(user))) throw new ProductMergeRequestError('merge_request_permission')
}
function admit(budget: ProductMergeRequestBudget, statements: number): void {
  const used = budget.used()
  if (![budget.limit, used, statements, budget.tailReserve].every(value => Number.isSafeInteger(value) && value >= 0)
    || used + statements + budget.tailReserve > budget.limit) throw new ProductMergeRequestError('merge_request_budget')
}
function validate(user: SessionUser, request: ProductMergeRequest): void {
  if (user.is_active !== 1 || (user.must_change_password ?? 0) !== 0
    || getActionTier(user, 'products', 'merge_duplicates') !== 'full') throw new ProductMergeRequestError('merge_request_permission')
  if (![user.id, request.keeperId, request.loserId].every(id => Number.isSafeInteger(id) && id > 0)
    || request.keeperId === request.loserId || typeof request.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(request.requestId)
    || typeof request.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(request.requestDigest)) conflict()
}

export async function prepareProductMergeRequest(
  db: D1Compat, snapshot: ProductMergeCaseSnapshot, operationId: string,
  catalog: Omit<ProductMergeForwardCatalogOptions, 'imageIds'>, budget: ProductMergeRequestBudget,
  guards: Statement[] = [],
): Promise<ProductMergeRequestPreparation> {
  admit(budget, 1)
  const { imageIds, ...identity } = await readProductMergeReservations(db, snapshot, operationId, productMergeGalleryAdditions(snapshot).length)
  return { snapshot, identity, guards, catalog: { ...catalog, imageIds } }
}

export async function readProductMergeReceipt(db: D1Compat, user: SessionUser, request: ProductMergeRequest, authority?: ProductMergeRequestAuthority): Promise<ProductMergeReceipt | null> {
  validate(user, request)
  const query = db.prepare(`SELECT (${stockActorPredicate} AND (${authority?.predicate ?? '1'})) actor_authorized,p.id plan_id,p.payload_json IS NOT NULL found,
    CASE WHEN length(CAST(p.payload_json AS BLOB))<=1048576 THEN p.payload_json END plan_json,
    h.id history_id,t.id seal_id,
    COALESCE(p.status='recorded' AND h.scope='products' AND h.entity='product_merge'
      AND h.created_by_id=p.created_by_id AND h.entity_id=json_extract(p.payload_json,'$.operation_id')
      AND h.status='undoable' AND h.undo_payload=h.redo_payload
      AND json_extract(h.undo_payload,'$.applier')='product.merge' AND json_extract(h.undo_payload,'$.version')=2
      AND json_extract(h.undo_payload,'$.plan_id')=p.id AND json_extract(h.undo_payload,'$.generation')=0
      AND json_extract(h.undo_payload,'$.operation_id')=h.entity_id
      AND t.kind=@transitionKind AND t.status='sealed'
      AND json_extract(t.payload_json,'$.plan_id')=p.id AND json_extract(t.payload_json,'$.history_id')=h.id
      AND json_extract(t.payload_json,'$.operation_id')=h.entity_id AND json_extract(t.payload_json,'$.to_generation')=0,0) head_valid
    FROM (SELECT 1) base LEFT JOIN undo_snapshots p ON p.kind=@planKind AND p.created_by_id=@stockActorId
      AND json_extract(p.payload_json,'$.request_id')=@requestId
    LEFT JOIN action_history h ON h.id=json_extract(p.payload_json,'$.history_id')
    LEFT JOIN undo_snapshots t ON t.id=json_extract(h.undo_payload,'$.seal_id')`)
  const params = { ...stockActorParams(user), ...authority?.params, requestId: request.requestId, planKind: PRODUCT_MERGE_PLAN_V2, transitionKind: PRODUCT_MERGE_TRANSITION_V2 }
  const row = await (query.getOnce ? query.getOnce<Record<string, unknown>>(params) : query.get<Record<string, unknown>>(params))
  if (row?.actor_authorized !== 1) throw new ProductMergeRequestError('merge_request_permission')
  if (row.found !== 1) return null
  if (row.head_valid !== 1 || typeof row.plan_json !== 'string') conflict()
  let plan: Record<string, unknown>
  try { plan = JSON.parse(row.plan_json as string) } catch { return conflict() }
  if (plan.version !== 2 || plan.actor_id !== user.id || plan.request_id !== request.requestId
    || plan.request_digest !== request.requestDigest || plan.keeper_id !== request.keeperId || plan.loser_id !== request.loserId
    || plan.history_id !== row.history_id || typeof plan.operation_id !== 'string') conflict()
  productMergePointer(Number(row.plan_id), plan.operation_id as string, 0, Number(row.seal_id))
  if (plan.catalog !== undefined) {
    const catalog = plan.catalog as { version?: unknown; requiredPermissions: ProductMergeForwardCatalogPlan['requiredPermissions'] } | null
    if (catalog?.version !== 1) conflict()
    catalogPermission(user, catalog!.requiredPermissions)
  }
  const origins = plan.origins as { physicalEdges?: { quantity: number }[] } | undefined
  if (!origins || !Array.isArray(origins.physicalEdges) || origins.physicalEdges.some(edge => !edge || typeof edge.quantity !== 'number' || !Number.isFinite(edge.quantity) || edge.quantity < 0)) conflict()
  return { keptId: request.keeperId, mergedId: request.loserId, operationId: plan.operation_id as string,
    actionHistoryId: Number(row.history_id), planId: Number(row.plan_id), generation: 0,
    quantityMoved: sumCountedQuantities(origins!.physicalEdges!.map(edge => edge.quantity)) }
}

export async function executeProductMergeRequest(
  db: D1Compat, user: SessionUser, request: ProductMergeRequest, budget: ProductMergeRequestBudget,
  prepare: () => Promise<ProductMergeRequestPreparation>,
  authority?: ProductMergeRequestAuthority,
): Promise<{ receipt: ProductMergeReceipt; replayed: boolean }> {
  validate(user, request)
  admit(budget, 1)
  const previous = await readProductMergeReceipt(db, user, request, authority)
  if (previous) return { receipt: previous, replayed: true }
  const prepared = await prepare()
  if (prepared.snapshot.canonicalProduct?.id !== request.keeperId || prepared.snapshot.duplicateProduct?.id !== request.loserId) conflict()
  const identity = { ...prepared.identity, actorId: user.id, actorName: user.name || user.username,
    requestId: request.requestId, requestDigest: request.requestDigest }
  const compiled = planProductMergeForwardStock(prepared.snapshot, identity, prepared.catalog)
  if (compiled.catalog) catalogPermission(user, compiled.catalog.requiredPermissions)
  const statements: Statement[] = [{ sql: `SELECT CASE WHEN ${stockActorPredicate} AND (${authority?.predicate ?? '1'})
    THEN 1 ELSE json_extract('[1]','$[merge_request_permission]') END`, params: { ...stockActorParams(user), ...authority?.params } },
    ...prepared.guards, ...compiled.statements, ...prepared.afterStatements ?? []]
  admit(budget, stockTransactionStatementCount(statements.length) + 1)
  const receipt: ProductMergeReceipt = { keptId: request.keeperId, mergedId: request.loserId, operationId: identity.origins.operationId,
    actionHistoryId: identity.historyId, planId: identity.planId, generation: 0, quantityMoved: compiled.moved }
  try {
    await executeStockTransaction(db, statements, 'once')
    return { receipt, replayed: false }
  } catch (error) {
    let recovered: ProductMergeReceipt | null
    try { recovered = await readProductMergeReceipt(db, user, request, authority) }
    catch (recoveryError) {
      if (recoveryError instanceof ProductMergeRequestError) throw recoveryError
      throw new StockTransactionOutcomeUnknownError()
    }
    if (recovered) return { receipt: recovered, replayed: true }
    if (error instanceof StockTransactionUnavailableError || /merge_|constraint failed|malformed JSON|bad JSON path|syntax error|no such (table|column)/i.test(String(error))) throw error
    throw new StockTransactionOutcomeUnknownError()
  }
}
