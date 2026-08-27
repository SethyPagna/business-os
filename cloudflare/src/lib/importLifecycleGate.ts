// Pure lifecycle rules shared by import-job mutation routes. Keeping these
// outside the Hono handlers makes the review/apply boundary directly testable
// instead of relying on UI behavior or regex checks over route source.

export type ImportRetryMode = 'analyze' | 'apply' | 'review_required'

function normalizedStatus(status: unknown): string {
  return String(status || '').trim().toLowerCase()
}

/** A CSV is mutable only before a run, or after a failed run needs repair. */
export function canReplaceImportCsv(status: unknown): boolean {
  return ['pending', 'failed'].includes(normalizedStatus(status))
}

/** Review decisions cannot race analyze/apply and stock rows are sealed. */
export function canEditImportDecisions(type: unknown, status: unknown): boolean {
  return String(type || '').trim().toLowerCase() !== 'stock_actions'
    && normalizedStatus(status) === 'awaiting_review'
}

/** Awaiting review must go through /approve; retry is never an apply bypass. */
export function retryModeForImportStatus(status: unknown): ImportRetryMode {
  const normalized = normalizedStatus(status)
  if (normalized === 'awaiting_review') return 'review_required'
  return normalized === 'approved' ? 'apply' : 'analyze'
}

