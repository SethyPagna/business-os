import type { D1Compat } from './db'
import type { Env } from '../index'
import { lineWaitsForApproval, waitingLineSql } from './inventoryCheckSessions'

/** A database that predates the counts tables (0259, 0286) holds nothing: asked directly, the missing table is the answer, with no schema scan first (a probe of sqlite_master reads the whole schema on a cold isolate). */
const missingCountTable = (error: unknown): boolean => /no such table:?\s*inventory_check_(items|approvals)/i.test(error instanceof Error ? error.message : String(error))
import { readSwitch } from './readSwitches'

/*
 * Fix stock (ic_fix_stock) opens the Set session for a count that shows an Issue. While that count waits for approval it must not be settled around the
 * approval, so a direct Set is HELD for as long as any count of that product at that branch is a difference nobody has applied, rejected or had replaced
 * (owner rule: a direct Set is held while that product's count waits).
 *
 * The hold is decided by what the server knows, never by what the client names: every scoped Set (POST /api/inventory/adjust with setScope, and the received-date
 * Set of Products, PATCH /api/batches/:id/branches/:branchId) asks scopedSetHeld() before it writes, whatever its request id says. The one exemption is the approval's own
 * write: it carries the approvalClaim of the approval that is applying it, and that approval's lines are the only ones it steps over. A claim that is not held writes
 * nothing anyway (stockMutationReceipt.ts checks it inside the stock batch), so a made-up claim buys nothing but the approval it names.
 * A Fix stock request that names its count (icfix_<session id>_<product id>_<random>) is still held for that count alone, on any /adjust.
 */

const FIX_STOCK_REQUEST = /^icfix_([A-Za-z0-9-]{1,64})_(\d{1,12})_[A-Za-z0-9]{6,32}$/

export function fixStockCountOf(requestId: unknown): { sessionId: string; productId: number } | null {
  const match = typeof requestId === 'string' ? FIX_STOCK_REQUEST.exec(requestId) : null
  const productId = match ? Number(match[2]) : 0
  return match && Number.isSafeInteger(productId) && productId > 0 ? { sessionId: match[1], productId } : null
}

export const FIX_STOCK_COUNT_PENDING = {
  error: 'Set is blocked while a count of this product is waiting for approval. Approve or reject that count first.',
  code: 'inventory_check_count_pending',
} as const

/** The session of a body's approvalClaim, when it has the shape of one (the receipt wrapper refuses a malformed claim and guards a well-formed one inside the stock batch). */
export function approvalClaimSession(body: Record<string, unknown>): string | null {
  const claim = body.approvalClaim
  const sessionId = claim && typeof claim === 'object' && !Array.isArray(claim) ? (claim as Record<string, unknown>).sessionId : null
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 120 ? sessionId : null
}

// alsoBranchId: the branch a confirmed redirect (X-Branch-Redirect) lands the write on when the addressed branch was disabled; a count waiting THERE holds the Set as much as one at the addressed branch.
type Scope = { productId: number; branchId: number; alsoBranchId?: number | null; exceptSession?: string | null }

/** Does ANY count of this product at this branch still wait for approval (other than the approval that is writing)? The product's lines at the branch come from index 0285, each approval is a primary-key step. */
export async function waitingCountHolds(db: D1Compat, scope: Scope): Promise<boolean> {
  try {
    const row = await db.prepare(`SELECT 1 AS waiting FROM inventory_check_items i JOIN inventory_check_approvals a ON a.session_id=i.session_id
      WHERE i.product_id=@productId AND i.branch_id IN (@branchId,@alsoBranchId) AND a.session_id IS NOT @except AND ${waitingLineSql('a', 'i')} LIMIT 1`)
      .get<{ waiting: number }>({ productId: scope.productId, branchId: scope.branchId, alsoBranchId: scope.alsoBranchId ?? scope.branchId, except: scope.exceptSession ?? null })
    return row?.waiting === 1
  } catch (error) {
    if (missingCountTable(error)) return false
    throw error
  }
}

/** The hold of a scoped Set. Only while the counts queue is live (ic_fix_stock): with it OFF no count can be approved, so nothing may be held for one. */
export async function scopedSetHeld(env: Env, db: D1Compat, scope: Scope): Promise<boolean> {
  if (!await readSwitch(env, 'ic_fix_stock')) return false
  return waitingCountHolds(db, scope)
}

/**
 * True when the request is held. `widened` asks for the product-wide hold (any waiting count of that product at that branch, whatever the request id is); without it only the count
 * the id names is held. A count that does not exist, or an approval table that is not there yet, holds nothing; a read that fails is not guessed.
 */
export async function fixStockHeldByApproval(db: D1Compat, requestId: unknown, widened?: Scope): Promise<boolean> {
  if (widened && await waitingCountHolds(db, widened)) return true
  const count = fixStockCountOf(requestId)
  if (!count) return false
  try { return await lineWaitsForApproval(db, count.sessionId, count.productId) } catch (error) {
    if (missingCountTable(error)) return false
    throw error
  }
}
