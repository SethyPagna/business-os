import { transferStatementAllowance, transferStatementEstimate, type TransferInvocationBudget } from './transferRunBudget'
import type { TransferLotCursor, TransferLotPage } from './transferRunLots'
import { subtractDecimalSum } from './moneyPrecision'

// Existing transfer routes have no quantity scale/range contract beyond finite
// positive numbers. This UNUSED planner deliberately fails closed above the safe
// integer magnitude, and on any derived decimal that cannot roundtrip through
// a JSON number. This is a proposed planner admission rule, not a route change.
export const MAX_TRANSFER_PLANNING_QUANTITY = Number.MAX_SAFE_INTEGER
function validQuantity(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TRANSFER_PLANNING_QUANTITY
}
function subtractQuantity(total: number, part: number): number {
  const exact = subtractDecimalSum(total, [part])
  const result = Number(exact)
  if (!Number.isFinite(result) || result < 0 || result > MAX_TRANSFER_PLANNING_QUANTITY
    || subtractDecimalSum(exact, [result]) !== '0') throw new Error('Transfer quantity cannot be represented exactly')
  return result
}

export type TransferRunFragment = {
  productId: number; quantity: number
  allocations: Array<{ batchId: number; quantity: number }>
  untrackedQuantity: number; remainingQuantity: number
  after: TransferLotCursor | null; complete: boolean; estimatedStatements: number
}

/** Smallest partition: one source product, bounded lots. Caller keeps the original
 * request/key immutable and seals each fragment before commit. No money enters or
 * leaves this helper: the existing server movement snapshot policy remains owner.
 * `mayCloneLots` conservatively budgets every allocation as a new destination lot.
 * A page's exhaustion is observational; atomic stock/untracked guards remain mandatory.
 */
export function planTransferRunFragment(input: {
  remainingQuantity: number; page: TransferLotPage
  budget: TransferInvocationBudget; mayCloneLots: boolean
}): TransferRunFragment {
  const { page, budget, mayCloneLots } = input
  if (!Number.isSafeInteger(page.productId) || page.productId <= 0
    || !Number.isSafeInteger(page.branchId) || page.branchId <= 0
    || typeof page.exhausted !== 'boolean' || typeof mayCloneLots !== 'boolean'
    || (page.selectedBatchId !== null && (!Number.isSafeInteger(page.selectedBatchId) || page.selectedBatchId <= 0))) {
    throw new Error('Invalid lot page scope')
  }
  if (!validQuantity(input.remainingQuantity)) throw new Error('Invalid remaining transfer quantity')
  // Validate the existing exact-decimal kernel resource limits before planning.
  subtractQuantity(input.remainingQuantity, 0)
  const allowance = transferStatementAllowance(budget)
  const base = transferStatementEstimate(1, 0, 0)
  if (allowance < base) throw new Error('No transfer fits the invocation reserve')
  const maxLots = Math.floor((allowance - base) / (mayCloneLots ? 2 : 1))
  const seen = new Set<number>()
  for (const lot of page.lots) {
    if (!Number.isSafeInteger(lot.batchId) || lot.batchId <= 0 || seen.has(lot.batchId)
      || !validQuantity(lot.available)
      || lot.cursor.productId !== page.productId || lot.cursor.branchId !== page.branchId
      || lot.cursor.batchId !== lot.batchId) throw new Error('Invalid lot page')
    seen.add(lot.batchId)
    subtractQuantity(lot.available, 0)
  }
  if (page.selectedBatchId !== null && (!page.exhausted || page.lots.length !== 1
    || page.lots[0].batchId !== page.selectedBatchId || page.lots[0].available < input.remainingQuantity)) {
    throw new Error('Selected lot no longer has enough stock')
  }
  let remaining = input.remainingQuantity
  const allocations: TransferRunFragment['allocations'] = []
  let after: TransferLotCursor | null = null
  for (const lot of page.lots.slice(0, maxLots)) {
    if (remaining <= 0) break
    const quantity = Math.min(remaining, lot.available)
    allocations.push({ batchId: lot.batchId, quantity })
    after = { ...lot.cursor }
    remaining = subtractQuantity(remaining, quantity)
  }
  // A budget-clipped page is NOT exhausted. Never mint an untracked remainder.
  const untrackedQuantity = page.selectedBatchId === null && page.exhausted
    && allocations.length === page.lots.length ? remaining : 0
  remaining = subtractQuantity(remaining, untrackedQuantity)
  const quantity = subtractQuantity(input.remainingQuantity, remaining)
  if (!(quantity > 0)) throw new Error('No transfer progress fits this page and budget')
  return { productId: page.productId, quantity, allocations, untrackedQuantity,
    remainingQuantity: remaining, after, complete: remaining === 0,
    estimatedStatements: transferStatementEstimate(1, allocations.length, mayCloneLots ? allocations.length : 0) }
}
