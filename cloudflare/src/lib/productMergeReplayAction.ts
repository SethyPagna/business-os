import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getDb } from './db'
import { getActionTier } from './permissions'
import { canEditAcquisitionCosts } from './acquisitionCostAccess'
import { stockActorParams, stockActorPredicate } from './stockActorGuard'
import { getPlanLimits } from './planTier'
import { currentRequestMetrics } from './requestMetrics'
import { buildAuditStatement } from './audit'
import { planProductMergeReplay, type ProductMergeReplayEvidence } from './productMergeReplay'
import { planProductMergeCaseSnapshot } from './productMergeSnapshot'
import { PRODUCT_MERGE_PLAN_V2, type ProductMergePointer } from './productMergeProtocol'
import { executeStockTransaction, stockTransactionStatementCount, StockTransactionUnavailableError } from './stockTransaction'
import { bumpVersions } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'

type Permissions = { image: boolean; productEdit: boolean; priceEdit: boolean; acquisitionCostEdit: boolean }
const ACK_RECOVERY_READ_ATTEMPTS = 1
const HISTORY_RESPONSE_READ_ATTEMPTS = 5
const CACHE_INVALIDATION_READ_WRITE_ATTEMPTS = 6
const RAW_MAINTENANCE_MARGIN = 1
const MERGE_REPLAY_TAIL_STATEMENTS = ACK_RECOVERY_READ_ATTEMPTS + HISTORY_RESPONSE_READ_ATTEMPTS + CACHE_INVALIDATION_READ_WRITE_ATTEMPTS + RAW_MAINTENANCE_MARGIN
export type ProductMergeReplayAuthority = { predicate: string; params: Record<string, unknown> }
const fail = (code: string, statusCode = 409): never => {
  throw Object.assign(new Error(code === 'merge_replay_outcome_unknown'
    ? 'The merge replay result could not be confirmed. Retry this same generation.'
    : code === 'merge_replay_over_plan_budget' ? 'This merge replay exceeds the available request capacity. No changes were saved.'
    : code === 'merge_replay_permission' ? 'Your access changed. Sign in again before continuing.'
    : 'The saved merge or current products changed. Refresh history before continuing.'), { code, statusCode })
}
function required(planJson: string): Permissions {
  const plan = JSON.parse(planJson)
  if (plan.version !== 2) return fail('undo_history_unusable')
  if (plan.catalog === undefined) return { image: false, productEdit: false, priceEdit: false, acquisitionCostEdit: false }
  const requirements = plan.catalog?.requiredPermissions
  if (plan.catalog?.version !== 1 || !requirements || ['image', 'productEdit', 'priceEdit', 'acquisitionCostEdit'].some(key => typeof requirements[key] !== 'boolean')) return fail('undo_history_unusable')
  return requirements
}
function permissionError(user: SessionUser, requirements: Permissions): string | null {
  if (requirements.image && getActionTier(user, 'products', 'image') !== 'full') return 'image_permission_required'
  if (requirements.productEdit && getActionTier(user, 'products', 'edit') !== 'full') return 'product_edit_permission_required'
  if (requirements.priceEdit && (getActionTier(user, 'products', 'edit') !== 'full' || getActionTier(user, 'products', 'price') === 'none')) return 'price_permission_required'
  if (requirements.acquisitionCostEdit && !canEditAcquisitionCosts(user)) return 'cost_permission_required'
  return null
}
export async function productMergeReplayRequirements(env: Env, payload: Record<string, unknown>): Promise<Permissions> {
  const row = await getDb(env).prepare(`SELECT payload_json FROM undo_snapshots WHERE id=@planId AND kind=@kind AND status='recorded'
    AND json_extract(payload_json,'$.operation_id')=@operationId AND length(CAST(payload_json AS BLOB))<=1048576`)
    .get<{ payload_json: string }>({ planId: payload.plan_id, kind: PRODUCT_MERGE_PLAN_V2, operationId: payload.operation_id })
  if (!row) return fail('undo_history_unusable')
  return required(row.payload_json)
}
export async function productMergeReplayPermissionError(env: Env, payload: Record<string, unknown>, user: SessionUser): Promise<string | null> {
  try { return permissionError(user, await productMergeReplayRequirements(env, payload)) } catch { return 'product_edit_permission_required' }
}

export async function replayProductMergeAction(payload: Record<string, unknown>, context: {
  env: Env; user: SessionUser | null; historyId?: number; generation?: unknown; direction: 'undo' | 'redo'; productMergeReplayAuthority?: ProductMergeReplayAuthority
}) {
  const { env, user, historyId, generation, direction, productMergeReplayAuthority: authority } = context
  if (!user || user.is_active !== 1 || (user.must_change_password ?? 0) !== 0 || getActionTier(user, 'products', 'merge_duplicates') !== 'full' || !authority) return fail('merge_replay_permission', 403)
  if (!Number.isSafeInteger(generation) || Number(generation) < 0 || Number(generation) >= Number.MAX_SAFE_INTEGER - 1) return fail('undo_history_stale', 400)
  if (!Number.isSafeInteger(historyId) || Number(historyId) <= 0 || payload.applier !== 'product.merge' || payload.version !== 2) return fail('undo_history_unusable')
  const db = getDb(env), limit = getPlanLimits(env).d1QueriesPerInvocation
  const used = () => currentRequestMetrics()?.invocation.attemptedStatements ?? Number.NaN
  const admit = (statements: number, tail = MERGE_REPLAY_TAIL_STATEMENTS) => {
    if (!Number.isSafeInteger(used()) || used() + statements + tail > limit) return fail('merge_replay_over_plan_budget', 400)
  }
  const authorityParams = { ...stockActorParams(user), ...authority.params }
  const read = async () => {
    admit(1)
    const row = await db.prepare(`SELECT (${stockActorPredicate} AND (${authority.predicate})) authorized,
      CASE WHEN length(CAST(p.payload_json AS BLOB))<=1048576 AND length(CAST(s.payload_json AS BLOB))<=1048576 THEN
      json_object('plan',json_object('id',p.id,'kind',p.kind,'status',p.status,'payload_json',p.payload_json,'created_by_id',p.created_by_id),
        'history',json_object('id',h.id,'scope',h.scope,'entity',h.entity,'entity_id',h.entity_id,'status',h.status,'undo_payload',h.undo_payload,'redo_payload',h.redo_payload,'created_by_id',h.created_by_id),
        'seal',json_object('id',s.id,'kind',s.kind,'status',s.status,'payload_json',s.payload_json,'created_by_id',s.created_by_id)) END evidence,
      (SELECT COALESCE(MAX(id),0)+1 FROM undo_snapshots) transition_id
      FROM (SELECT 1) base LEFT JOIN action_history h ON h.id=@historyId
      LEFT JOIN undo_snapshots p ON p.id=@planId LEFT JOIN undo_snapshots s ON s.id=json_extract(h.undo_payload,'$.seal_id')`)
      .getOnce!<{ authorized: number; evidence: string | null; transition_id: number }>({ ...authorityParams, historyId, planId: payload.plan_id })
    if (row?.authorized !== 1) return fail('merge_replay_permission', 403)
    if (!row.evidence || !Number.isSafeInteger(row.transition_id) || row.transition_id <= 0) return fail('undo_history_unusable')
    const evidence = JSON.parse(row.evidence) as ProductMergeReplayEvidence
    const plan = JSON.parse(evidence.plan.payload_json), seal = JSON.parse(evidence.seal.payload_json)
    const pointer = JSON.parse(evidence.history.undo_payload) as ProductMergePointer
    if (pointer.plan_id !== payload.plan_id || pointer.operation_id !== payload.operation_id || pointer.applier !== 'product.merge' || pointer.version !== 2) return fail('undo_history_stale')
    const permission = permissionError(user, required(evidence.plan.payload_json))
    if (permission) return fail(permission, 403)
    const sealedCapture = planProductMergeCaseSnapshot(plan.keeper_id, plan.loser_id, []).decode(new Map([['capture', [{ data: JSON.stringify(seal.post_capture), oversized: 0 }]]]))
    planProductMergeReplay(sealedCapture, evidence, { transitionId: row.transition_id, actorId: user.id, actorName: user.name || user.username,
      direction: pointer.generation % 2 === 0 ? 'undo' : 'redo', pointer })
    return { evidence, pointer, seal, plan, transitionId: row.transition_id }
  }
  let observed
  try { observed = await read() } catch (error) {
    if ((error as { statusCode?: unknown }).statusCode) throw error
    return fail('undo_history_unusable')
  }
  const completed = (proof: typeof observed) => proof.pointer.generation === Number(generation) + 1 && proof.seal.direction === direction
    && proof.seal.from_generation === generation && proof.seal.to_generation === Number(generation) + 1
  const outcome = (proof: typeof observed, replayed: boolean) => ({ complete: true, continuation_required: false, processed_children: 1, pending_children: 0, generation: proof.pointer.generation, replayed })
  if (completed(observed)) return outcome(observed, true)
  if (observed.pointer.generation !== generation || (Number(generation) % 2 === 0 ? direction !== 'undo' : direction !== 'redo')) return fail('undo_history_stale')
  admit(1)
  const capturePlan = planProductMergeCaseSnapshot(observed.plan.keeper_id, observed.plan.loser_id, [])
  const captured = await db.batchOnce(capturePlan.reads)
  let compiled
  try {
    compiled = planProductMergeReplay(capturePlan.decode(new Map([['capture', captured[0].results as Array<Record<string, unknown>>]])), observed.evidence,
      { transitionId: observed.transitionId, actorId: user.id, actorName: user.name || user.username, direction, pointer: observed.pointer })
  } catch { return fail('undo_record_changed') }
  const statements = [{ sql: `SELECT CASE WHEN ${stockActorPredicate} AND (${authority.predicate}) THEN 1 ELSE json_extract('[1]','$[merge_replay_permission]') END`, params: authorityParams },
    ...compiled.statements, buildAuditStatement(user.id, user.name, `action_${direction}`, 'product', observed.plan.keeper_id,
      { actionHistoryId: historyId, applier: 'product.merge', version: 2, operationId: observed.plan.operation_id, generation: compiled.pointer.generation })]
  admit(stockTransactionStatementCount(statements.length))
  try {
    await executeStockTransaction(db, statements, 'once')
    return { ...outcome(observed, false), generation: compiled.pointer.generation }
  } catch (error) {
    let recovered
    try { recovered = await read() } catch (recoveryError) {
      if ((recoveryError as { statusCode?: number }).statusCode === 403) throw recoveryError
      return fail('merge_replay_outcome_unknown', 503)
    }
    if (completed(recovered)) return outcome(recovered, true)
    if (error instanceof StockTransactionUnavailableError) return fail('stock_schema_unavailable', 503)
    if (/merge_replay_permission/.test(String(error))) return fail('merge_replay_permission', 403)
    if (/merge_|constraint failed|malformed JSON|bad JSON path|no such (table|column)|syntax error/i.test(String(error))) return fail('undo_record_changed')
    return fail('merge_replay_outcome_unknown', 503)
  }
}

export async function notifyProductMergeReplay(env: Env): Promise<void> {
  await bumpVersions(env, ['stock', 'products'])
  await Promise.all([broadcast(env, 'products', { action: 'update' }), broadcast(env, 'inventory', { action: 'update' })])
}
