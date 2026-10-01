import { HTTPException } from 'hono/http-exception'
import type { D1Compat } from './db'

export const STOCK_LIFECYCLE_CODE = 'stock_lifecycle_dependency'
export const STOCK_LIFECYCLE_MESSAGE = 'This stock source has a linked supplier claim or disposition. Its quantity, receipt, lineage and linked expenses cannot change until the linked lifecycle supports this action.'

export function stockLifecycleRefusal(error: unknown) {
  if (!(error instanceof Error)) return null
  const native = error as Error & { code?: string; errcode?: number }
  const nativeTrigger = native.code === 'ERR_SQLITE_ERROR' && native.errcode === 1811 && error.message === STOCK_LIFECYCLE_CODE
  const d1Trigger = /^D1_ERROR:\s*stock_lifecycle_dependency:\s*SQLITE_CONSTRAINT(?:_TRIGGER)?$/i.test(error.message)
  if (!(error instanceof StockLifecycleError) && !nativeTrigger && !d1Trigger) return null
  return { error: STOCK_LIFECYCLE_MESSAGE, code: STOCK_LIFECYCLE_CODE }
}

export class StockLifecycleError extends HTTPException {
  readonly statusCode = 409
  readonly code = STOCK_LIFECYCLE_CODE
  constructor() {
    super(409, { message: STOCK_LIFECYCLE_CODE, res: Response.json({ error: STOCK_LIFECYCLE_MESSAGE, code: STOCK_LIFECYCLE_CODE }, { status: 409 }) })
  }
}

export async function assertStockLifecycleMutable(db: D1Compat, scope: { movementId?: number; batchId?: number; productId?: number; branchId?: number; feeId?: number }) {
  const objects = await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('stock_disposition_sources','stock_funding_dependencies','stock_disposition_fees')").all<{ name: string }>()
  const present = new Set(objects.map(row => row.name))
  if (scope.feeId && present.has('stock_disposition_fees')) {
    if (await db.prepare('SELECT 1 FROM stock_disposition_fees WHERE fee_id=@id LIMIT 1').get({ id: scope.feeId })) throw new StockLifecycleError()
    return
  }
  const clauses: string[] = [], params: Record<string, unknown> = {}
  for (const [field, column] of [['movementId','movement_id'],['batchId','batch_id'],['productId','product_id'],['branchId','branch_id']] as const) {
    if (scope[field] != null) { clauses.push(`${column}=@${field}`); params[field] = scope[field] }
  }
  if (!clauses.length) return
  for (const table of ['stock_disposition_sources','stock_funding_dependencies']) {
    if (present.has(table) && await db.prepare(`SELECT 1 FROM ${table} WHERE ${clauses.join(' AND ')} LIMIT 1`).get(params)) throw new StockLifecycleError()
  }
}
