// Pure helpers for StockActionImportModal (§12). The old two-screen review
// view-model (deriveStockImportReview, the paged resolved-rows unwrap and
// describe helpers) was removed with the second server-side review screen
// itself: the modal now follows the review-first direct-apply contract every
// sibling importer uses -- rows are reviewed client-side BEFORE upload and
// the job applies in the background via ServerImportReviewScreen's
// autoApprove (carrying the stock confirm flag).

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

// A create/upload/get response may be the job itself or { job }. Return the
// job object only when it actually carries an id.
export function unwrapImportJob(payload: unknown): StockImportJob | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const nested = record.job && typeof record.job === 'object' ? record.job as StockImportJob : null
  const job = (nested && nested.id != null) ? nested : (record as StockImportJob)
  return job && job.id != null ? job : null
}
