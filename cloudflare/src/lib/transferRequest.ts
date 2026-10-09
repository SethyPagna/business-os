import type { Context, Handler } from 'hono'
import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getDb, isRetryableD1Error, type D1Compat } from './db'
import { requestMetricsOf } from './requestMetrics'
import { getPlanLimits } from './planTier'
import { executeStockTransaction, StockTransactionOutcomeUnknownError } from './stockTransaction'
import { ordinaryBusinessMaintenanceGuard } from './businessMaintenanceGuard'
import { findTransferReceipt, type TransferReceiptRow } from './transferOperationReceipt'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersions } from './cache'

type TransferContext = Context<{ Bindings: Env; Variables: { user: SessionUser } }>
export class TransferQueryBudgetError extends Error {
  readonly code = 'transfer_query_budget_exceeded'
  constructor() { super('This transfer is too large for the current plan. Transfer fewer products or received dates, then try again.') }
}
export function transferRequest(handler: Handler<{ Bindings: Env; Variables: { user: SessionUser } }>): Handler<{ Bindings: Env; Variables: { user: SessionUser } }> {
  return async (c, next) => {
    try { return await handler(c, next) } catch (error) {
      if (error instanceof TransferQueryBudgetError) return c.json({ error: error.message, code: error.code }, 409)
      throw error
    }
  }
}
export function transferRequestDb(c: TransferContext): D1Compat {
  const db = getDb(c.env)
  const metrics = requestMetricsOf(c)
  const limit = getPlanLimits(c.env).d1QueriesPerInvocation
  let local = 0
  const used = () => metrics?.invocation.attemptedStatements ?? local
  const check = (count: number) => { if (used() + count > limit) throw new TransferQueryBudgetError() }
  const counted = Object.create(db) as D1Compat
  counted.prepare = sql => {
    const statement = db.prepare(sql)
    return {
      get: <T>(params?: import('../lib/db').BindParams) => {
        check(1); local++
        if (!statement.getOnce) throw new Error('Transfers require single-attempt reads')
        return statement.getOnce<T>(params)
      },
      all: <T>(params?: import('../lib/db').BindParams) => {
        check(1); local++
        if (!statement.allOnce) throw new Error('Transfers require single-attempt reads')
        return statement.allOnce<T>(params)
      },
      run: params => statement.run(params),
    }
  }
  counted.batchOnce = statements => {
    // Cache fallback: version read, Free quota upsert, version upsert, each
    // with at most two attempts. Telegram: one stock snapshot once, settings
    // at most twice. A lost acknowledgement also needs one receipt read.
    const tailStatements = 2 + (getPlanLimits(c.env).tier === 'free' ? 2 : 0) + 2 + 1 + 2 + 1
    check(statements.length + tailStatements)
    local += statements.length
    return db.batchOnce(statements)
  }
  return counted
}
export async function commitTransfer(db: D1Compat, statements: Parameters<D1Compat['batchOnce']>[0]): Promise<TransferReceiptRow> {
  const receiptIndex = statements.length - 1
  const receipt = statements[receiptIndex]
  if (!receipt?.sql.startsWith('UPDATE transfer_operation_receipts SET status=\'committed\'')) throw new Error('Transfer plan has no final receipt')
  let results: Awaited<ReturnType<typeof executeStockTransaction>>
  try {
    results = await executeStockTransaction(db, [...statements.slice(0, -1), {
      ...receipt, sql: receipt.sql + ' RETURNING actor_id,request_id,request_digest,request_json,response_json,status',
    }, ordinaryBusinessMaintenanceGuard], 'once')
  } catch (error) {
    if (isRetryableD1Error(error)) throw new StockTransactionOutcomeUnknownError()
    throw error
  }
  const row = results[receiptIndex]?.results?.[0] as TransferReceiptRow | undefined
  if (!row?.response_json || row.status !== 'committed') throw new StockTransactionOutcomeUnknownError()
  return row
}
export async function transferOnHand(db: D1Compat, fromBranchId: number, toBranchId: number, pairs: Array<{ productId: number; destProductId: number }>) {
  const rows = await db.prepare(`SELECT json_extract(value,'$.productId') product_id,
      json_extract(value,'$.destProductId') dest_product_id,
      (SELECT quantity FROM branch_stock WHERE product_id=json_extract(value,'$.productId') AND branch_id=@fromBranch) from_on_hand,
      (SELECT quantity FROM branch_stock WHERE product_id=json_extract(value,'$.destProductId') AND branch_id=@toBranch) to_on_hand,
      (SELECT stock_quantity FROM products WHERE id=json_extract(value,'$.destProductId')) total_on_hand
    FROM json_each(@pairs)`).all<{ product_id: number; dest_product_id: number; from_on_hand: number | null; to_on_hand: number | null; total_on_hand: number | null }>({ fromBranch: fromBranchId, toBranch: toBranchId, pairs: JSON.stringify(pairs) })
  return new Map(rows.map(row => [`${row.product_id}:${row.dest_product_id}`, row]))
}

export function refreshTransferReaders(c: TransferContext) {
  c.executionCtx.waitUntil(broadcast(c.env, 'branches', { action: 'transfer' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'products', { action: 'update' }))
  c.executionCtx.waitUntil(broadcast(c.env, 'inventory', { action: 'transfer' }))
  c.executionCtx.waitUntil(bumpVersions(c.env, ['products', 'stock']))
}

export async function recoverTransferReceipt(db: D1Compat, actorId: number, requestId: string) {
  try { return await findTransferReceipt(db, actorId, requestId) }
  catch { throw new StockTransactionOutcomeUnknownError() }
}

