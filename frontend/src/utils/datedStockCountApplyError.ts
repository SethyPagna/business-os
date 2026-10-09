// Shared operator messages for dated-count writes and saved decision recovery.
export const DATED_STOCK_COUNT_APPLY_ERRORS: Record<string, readonly [key: string, fallback: string]> = {
  dated_count_invalid_id: ['dated_count_invalid_id', "The saved count request identity is invalid. Keep this window and check its history before submitting again."],
  dated_count_owner_mismatch: ['dated_count_owner_mismatch', "Keep this saved count. Sign in to its original account and server to continue."],
  dated_count_request_conflict: ['dated_count_request_conflict', "This request identity belongs to different count entries. Keep the saved identity and check its history before continuing."],
  dated_count_reset_conflict: ['dated_count_reset_conflict', "The catalog was reset or restored. This saved count cannot continue. Review the file again to submit a new count."],
  dated_count_outcome_unknown: ['dated_count_outcome_unknown', "The count result could not be confirmed. It may already be saved. Resume the saved count with the same request."],
  dated_count_receipt_unavailable: ['dated_count_receipt_unavailable', "Count recording is temporarily unavailable. Keep the saved count and retry the same request after refreshing."],
  dated_count_over_plan_budget: ['dated_count_over_plan_budget', "This count needs more recording capacity. Keep its saved request. Review a smaller count only when the server confirms that nothing was saved."],
  dated_count_storage_unreadable: ['dated_count_storage_unreadable', "The saved count could not be read. Keep browser storage and check its history before submitting again."],
  dated_count_storage_save_failed: ['dated_count_storage_save_failed', "The count identity could not be saved. Keep this window open and retry with the same saved count."],
  dated_count_pending_review: ['dated_count_pending_review', "Resume the saved count before reviewing a different count."],
  dated_count_missing: ['dated_count_missing', "No saved count is available for this account and server. Check its history before submitting again."],
  dated_count_retirement_failed: ['dated_count_retirement_failed', "The catalog was reset or restored, but the exact saved count identity could not be cleared safely. Keep this window and browser storage; check the original account, server and count history before reviewing again."],
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
