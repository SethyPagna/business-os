import type { D1Compat } from './db'
import type { SessionUser } from './auth'
import type { Env } from '../index'
import type { ParsedDatedCountEntry } from './datedStockCountRoute'
import { canonicalOfflineSaleOwner, offlineSaleOwnerError } from './offlineSaleOwnership'
import { normalizeTransferRequestId } from './transferOperationReceipt'
import { canonicalProductConflictJson } from './productConflictMergeBatch'
import { currentRequestMetrics } from './requestMetrics'
import { getPlanLimits } from './planTier'
import { buildAuditStatement } from './audit'
import { prepareDatedStockCountPlan, DatedStockCountConflictError } from './datedStockCountApply'
import { executeStockTransaction, stockTransactionStatementCount, StockTransactionUnavailableError } from './stockTransaction'
import { productStockGuardError } from './productStockGuard'
import { IMPORT_BRANCH_COLUMNS_SQL } from './importBranchAuthority'

export const DATED_COUNT_APPLY_MESSAGES = {
  dated_count_invalid_id: 'Keep the original dated stock count request. Refresh the app before retrying it.',
  dated_count_owner_mismatch: 'Keep the original dated stock count request and retry from its original account and server.',
  dated_count_request_conflict: 'This request ID belongs to a different dated stock count. Keep the original request and review it before retrying.',
  dated_count_reset_conflict: 'This dated stock count request was invalidated by a reset or restore. Review the current stock before creating a new request.',
  dated_count_outcome_unknown: 'The dated stock count result could not be confirmed. Keep the original request and retry it with the same ID.',
  dated_count_receipt_unavailable: 'Dated stock count recording is unavailable. Keep the original request and retry after the application is updated.',
  dated_count_over_plan_budget: 'This whole dated stock count exceeds the request budget. Nothing was applied. Review a smaller complete count before creating a new request.',
} as const

type RefusalCode = keyof typeof DATED_COUNT_APPLY_MESSAGES
export class DatedCountApplyReceiptError extends Error {
  constructor(readonly code: RefusalCode, readonly status: 400 | 409 | 503) {
    super(DATED_COUNT_APPLY_MESSAGES[code])
  }
  body() {
    return { success: false, code: this.code, error: this.message,
      ...(this.code === 'dated_count_over_plan_budget' ? { can_review_again: true } : {}),
      ...(this.code === 'dated_count_outcome_unknown' ? { action: 'retry_same_request' } : {}) }
  }
}

export function datedCountApplyIntent(user: SessionUser, url: string, body: Record<string, unknown>, entries: ParsedDatedCountEntry[], redirectTarget: number | null) {
  const requestId = typeof body.client_request_id === 'string' ? normalizeTransferRequestId(body.client_request_id) : null
  if (!requestId) throw new DatedCountApplyReceiptError('dated_count_invalid_id', 400)
  const owner = canonicalOfflineSaleOwner(user, url)
  if (offlineSaleOwnerError(body.offline_owner, owner)) throw new DatedCountApplyReceiptError('dated_count_owner_mismatch', 409)
  return { actorId: user.id, requestId, requestJson: canonicalProductConflictJson({ version: 1, kind: 'dated-count-apply', owner, entries, redirectTarget }) }
}
export type DatedCountApplyIntent = ReturnType<typeof datedCountApplyIntent>

// Cache bump can read versions, reserve Free KV quota and fall back to a D1
// upsert: each may retry once. Broadcasts have no D1 reads. Lost-ACK recovery
// still refreshes readers, so its receipt read and cache tails both need room.
const APPLY_CACHE_TAIL_ATTEMPTS = 6
const APPLY_RECOVERY_ATTEMPTS = 1
export function datedCountApplyBudget(db: D1Compat, env: Env) {
  const metrics = currentRequestMetrics()
  if (!metrics) throw new DatedCountApplyReceiptError('dated_count_receipt_unavailable', 503)
  const cap = getPlanLimits(env).d1QueriesPerInvocation
  const admit = (count: number, tail = APPLY_CACHE_TAIL_ATTEMPTS + APPLY_RECOVERY_ATTEMPTS) => {
    if (metrics.invocation.attemptedStatements + count + tail > cap) throw new DatedCountApplyReceiptError('dated_count_over_plan_budget', 409)
  }
  const reads = Object.create(db) as D1Compat
  let branchSnapshot: Promise<unknown> | undefined
  reads.prepare = ((sql: string) => {
    const statement = db.prepare(sql)
    if (!statement.getOnce || !statement.allOnce) throw new DatedCountApplyReceiptError('dated_count_receipt_unavailable', 503)
    return { ...statement,
      get: (params?: Record<string, unknown>) => { admit(1); return statement.getOnce!(params) },
      all: (params?: Record<string, unknown>) => {
        if (sql === `SELECT ${IMPORT_BRANCH_COLUMNS_SQL} FROM branches` && params == null) {
          if (!branchSnapshot) { admit(1); branchSnapshot = statement.allOnce!(params) }
          return branchSnapshot
        }
        admit(1); return statement.allOnce!(params)
      },
    }
  }) as D1Compat['prepare']
  return { db: reads, admit }
}

type ReceiptRow = { request_json: string; result_json: string; invalidated_at: string | null }
export async function readDatedCountApplyReceipt(db: D1Compat, intent: DatedCountApplyIntent): Promise<Record<string, unknown> | null> {
  let row: ReceiptRow | undefined
  try {
    row = await db.prepare('SELECT request_json,result_json,invalidated_at FROM dated_count_apply_receipts WHERE actor_id=@actorId AND request_id=@requestId')
      .get<ReceiptRow>({ actorId: intent.actorId, requestId: intent.requestId })
  } catch (error) {
    if (error instanceof DatedCountApplyReceiptError) throw error
    throw new DatedCountApplyReceiptError('dated_count_receipt_unavailable', 503)
  }
  if (!row) return null
  if (row.invalidated_at) throw new DatedCountApplyReceiptError('dated_count_reset_conflict', 409)
  if (row.request_json !== intent.requestJson) throw new DatedCountApplyReceiptError('dated_count_request_conflict', 409)
  let result: Record<string, unknown>
  try { result = JSON.parse(row.result_json) } catch { throw new DatedCountApplyReceiptError('dated_count_outcome_unknown', 503) }
  if (!result || result.success !== true) throw new DatedCountApplyReceiptError('dated_count_outcome_unknown', 503)
  return { ...result, replayed: true }
}

export async function commitDatedCountApplyReceipt(
  db: D1Compat, budget: ReturnType<typeof datedCountApplyBudget>, intent: DatedCountApplyIntent,
  plan: Parameters<typeof prepareDatedStockCountPlan>[1], actorName: string | null, entryCount: number,
) {
  const prepared = await prepareDatedStockCountPlan(budget.db, plan, { userId: intent.actorId, userName: actorName })
  const result = { success: true, ...prepared.result }
  const receipt = { sql: `INSERT INTO dated_count_apply_receipts(actor_id,request_id,request_json,result_json)
    VALUES(@actorId,@requestId,@requestJson,@resultJson)`, params: { ...intent, resultJson: JSON.stringify(result) } }
  const audit = buildAuditStatement(intent.actorId, actorName, 'dated_stock_count_import', 'inventory', null,
    { client_request_id: intent.requestId, entryCount, ...prepared.result })
  const statements = [receipt, ...prepared.statements, audit]
  budget.admit(stockTransactionStatementCount(statements.length) + prepared.branchGuardCount)
  try {
    await executeStockTransaction(prepared.db, statements, 'once')
    return result
  } catch (error) {
    try {
      budget.admit(1, APPLY_CACHE_TAIL_ATTEMPTS)
      const recovery = Object.create(db) as D1Compat
      recovery.prepare = ((sql: string) => {
        const statement = db.prepare(sql)
        if (!statement.getOnce) throw new DatedCountApplyReceiptError('dated_count_outcome_unknown', 503)
        return { get: statement.getOnce.bind(statement) }
      }) as D1Compat['prepare']
      const saved = await readDatedCountApplyReceipt(recovery, intent)
      if (saved) return saved
    } catch (recoveryError) {
      if (recoveryError instanceof DatedCountApplyReceiptError && recoveryError.status === 409) throw recoveryError
      throw new DatedCountApplyReceiptError('dated_count_outcome_unknown', 503)
    }
    if (error instanceof StockTransactionUnavailableError) throw new DatedCountApplyReceiptError('dated_count_receipt_unavailable', 503)
    if (error instanceof DatedStockCountConflictError || productStockGuardError(error)) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (/guard_value|stock_session_guards/i.test(message)) throw new DatedStockCountConflictError()
    throw new DatedCountApplyReceiptError('dated_count_outcome_unknown', 503)
  }
}
