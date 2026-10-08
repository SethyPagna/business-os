// Shared operator messages for dated-count writes and saved decision recovery.
export const DATED_STOCK_COUNT_APPLY_ERRORS: Record<string, readonly [key: string, fallback: string]> = {
  dated_stock_count_conflict: ['dated_count_apply_conflict', 'The stock count history changed. An earlier attempt may have been saved. Check its history before reviewing and applying again.'],
  invalid_client_request_id: ['dated_decision_invalid_id', 'The saved decision request identity is invalid. Keep browser storage and check its history before submitting again.'],
  dated_decision_outcome_unknown: ['dated_decision_outcome_unknown', 'The decision result could not be confirmed. Some decisions may already be saved. Resume the saved decisions with the same request.'],
  dated_decision_reset_conflict: ['dated_decision_reset_conflict', 'The catalog was reset. These saved decisions cannot continue. Review the file again to submit new decisions.'],
  dated_decision_owner_mismatch: ['dated_decision_owner_mismatch', 'Keep these saved decisions. Sign in to their original account and server to continue.'],
  dated_decision_request_conflict: ['dated_decision_request_conflict', 'This request identity belongs to different decisions. Keep the saved identity and check its history before continuing.'],
  dated_decision_budget_exhausted: ['dated_decision_retry_pending', 'Some decisions may already be saved. Resume the saved decisions to continue with the same request.'],
  dated_decision_retry_pending: ['dated_decision_retry_pending', 'Some decisions may already be saved. Resume the saved decisions to continue with the same request.'],
  dated_decision_storage_unreadable: ['dated_decision_storage_unreadable', 'Saved decisions could not be read. Keep browser storage and check their history before submitting again.'],
  dated_decision_storage_save_failed: ['dated_decision_storage_save_failed', 'The decision identity could not be saved. Keep this window open and retry with the same decisions.'],
  dated_decision_pending_choices: ['dated_decision_pending_choices', 'Resume the saved decisions before submitting different choices.'],
  dated_decision_missing: ['dated_decision_missing', 'No saved decisions are available for this account and server. Check their history before submitting again.'],
  dated_decision_retirement_failed: ['dated_decision_retirement_failed', 'The catalog was reset, but the exact saved identity could not be cleared safely. Keep this window and browser storage; check the original account, server and decision history before reviewing again.'],
}

export function datedStockCountApplyErrorText(error: unknown, tr: (key: string, fallback: string) => string): string {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>
  const entry = DATED_STOCK_COUNT_APPLY_ERRORS[String(source.code || '')]
  if (entry) return tr(entry[0], entry[1])
  const message = String(source.message ?? source.error ?? '')
  return message || tr('dated_count_apply_failed', 'The import failed to apply.')
}
