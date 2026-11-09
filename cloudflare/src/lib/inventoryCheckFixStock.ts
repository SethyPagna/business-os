import type { D1Compat } from './db'
import { approvalsAvailable, lineWaitsForApproval, productWaitsForApproval } from './inventoryCheckSessions'

/*
 * Fix stock (ic_fix_stock) opens the Set session for a count that shows an Issue. While that count waits for approval it must not be settled around the
 * approval, so the stock request Fix stock sends names the count it fixes in its id (icfix_<session id>_<product id>_<random>) and the stock writers
 * refuse it for as long as that line is a difference nobody has applied or rejected. A request that names no count is never held.
 */

const FIX_STOCK_REQUEST = /^icfix_([A-Za-z0-9-]{1,64})_(\d{1,12})_[A-Za-z0-9]{6,32}$/

export function fixStockCountOf(requestId: unknown): { sessionId: string; productId: number } | null {
  const match = typeof requestId === 'string' ? FIX_STOCK_REQUEST.exec(requestId) : null
  const productId = match ? Number(match[2]) : 0
  return match && Number.isSafeInteger(productId) && productId > 0 ? { sessionId: match[1], productId } : null
}

export const FIX_STOCK_COUNT_PENDING = {
  error: 'This count is waiting for approval. Approve or reject it first.',
  code: 'inventory_check_count_pending',
} as const

/** True when the count the request names still waits for approval. A count that does not exist, or an approval table that is not there yet, holds nothing; a read that fails is not guessed. */
export async function fixStockHeldByApproval(db: D1Compat, requestId: unknown, widened?: { productId: number; branchId: number }): Promise<boolean> {
  const count = fixStockCountOf(requestId)
  if (!count) return false
  if (!await approvalsAvailable(db)) return false
  if (await lineWaitsForApproval(db, count.sessionId, count.productId)) return true
  // ic_lot_counts widens the hold from the named count to ANY count of that product at that branch that still waits: a direct Set never settles stock around a queued count.
  return widened ? productWaitsForApproval(db, widened.productId, widened.branchId) : false
}
