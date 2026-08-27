// Pure view-model helpers for StockActionImportModal (§12/§13). Extracted so
// the two-screen flow's decision logic -- is it still analyzing, does it need
// explicit confirmation, can the Confirm button fire -- is unit-testable
// without rendering React (same pattern posCore / stockHealthSummary follow).

export interface StockImportSummary {
  created?: number
  updated?: number
  skipped?: number
  errored?: number
  total?: number
  requires_stock_action_confirmation?: boolean
  stock_action_confirmation_rows?: number
}

export interface StockImportJob {
  id?: string | number
  status?: string
  summary?: StockImportSummary
  last_error?: string | null
}

// Analyze is done (the review screen can show real numbers) only at one of
// these statuses; anything else means the queue is still working.
export const STOCK_IMPORT_TERMINAL_ANALYZE = new Set([
  'awaiting_review', 'failed', 'cancelled', 'completed', 'completed_with_errors',
])

function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

// A create/upload/get response may be the job itself or { job }. Return the
// job object only when it actually carries an id.
export function unwrapImportJob(payload: unknown): StockImportJob | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const nested = record.job && typeof record.job === 'object' ? record.job as StockImportJob : null
  const job = (nested && nested.id != null) ? nested : (record as StockImportJob)
  return job && job.id != null ? job : null
}

export interface StockImportReviewState {
  analyzing: boolean
  failed: boolean
  conflictRows: number
  needsConfirm: boolean
  actionable: number
  errored: number
  skipped: number
  total: number
  /** The Confirm & Import button may fire. */
  canConfirm: boolean
}

/**
 * Derives the review screen's state from the polled job. `confirmChecked` is
 * the operator's explicit acknowledgement of the conflict gate; it only
 * matters when the analysis actually flagged conflicts.
 */
export function deriveStockImportReview(
  job: StockImportJob | null,
  confirmChecked: boolean,
  fallbackRowCount = 0,
): StockImportReviewState {
  const status = String(job?.status || '')
  const analyzing = !STOCK_IMPORT_TERMINAL_ANALYZE.has(status)
  const failed = status === 'failed'
  const summary = job?.summary || {}
  const conflictRows = count(summary.stock_action_confirmation_rows)
  const needsConfirm = summary.requires_stock_action_confirmation === true && conflictRows > 0
  const actionable = count(summary.created) + count(summary.updated)
  const errored = count(summary.errored)
  const skipped = count(summary.skipped)
  const total = count(summary.total) || count(fallbackRowCount)
  // Nothing to do if analyze isn't done, it failed, or no row would change
  // (all skipped and none errored). When conflicts exist, the operator must
  // tick the confirmation box first.
  const canConfirm = !analyzing && !failed && (actionable + errored) > 0 && (!needsConfirm || confirmChecked)
  return { analyzing, failed, conflictRows, needsConfirm, actionable, errored, skipped, total, canConfirm }
}
