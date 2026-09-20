/** Planning arithmetic only. No route is certified by using this helper. */
export type TransferInvocationBudget = {
  tier: 'free' | 'paid'
  alreadyUsed: number
  remainingReads: number
  completionQueries: number
  retryQueries: number
  safetyQueries: number
  /** Run/chunk CAS, progress writes, and other statements outside the old planner. */
  extraAtomicStatements: number
}

export function transferStatementAllowance(budget: TransferInvocationBudget): number {
  if (budget.tier !== 'free' && budget.tier !== 'paid') throw new Error('An explicit deployment tier is required')
  const counts = [budget.alreadyUsed, budget.remainingReads, budget.completionQueries,
    budget.retryQueries, budget.safetyQueries, budget.extraAtomicStatements]
  if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Query reserves must be nonnegative safe integers')
  const reserved = counts.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(reserved)) throw new Error('Query reserve overflow')
  return Math.max(0, (budget.tier === 'free' ? 50 : 1000) - reserved)
}

/** Existing transferOperation shape: not a substitute for checking actual SQL length. */
export function transferStatementEstimate(lines: number, allocations: number, clones: number): number {
  if ([lines, allocations, clones].some(value => !Number.isSafeInteger(value) || value < 0)
    || clones > allocations) throw new Error('Invalid transfer statement counts')
  const result = 17 + 2 * lines + allocations + clones
  if (!Number.isSafeInteger(result)) throw new Error('Statement estimate overflow')
  return result
}

/** Call again with the actual statement count before any future atomic write. */
export function assertTransferStatementsFit(budget: TransferInvocationBudget, actualStatements: number): void {
  if (!Number.isSafeInteger(actualStatements) || actualStatements < 0
    || actualStatements > transferStatementAllowance(budget)) throw new Error('Transfer exceeds invocation query budget')
}
