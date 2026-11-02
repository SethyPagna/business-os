// A Worker refusal that names a branch rule, restated in the UI language by its CODE.
//
// These refusals used to reach a Khmer screen as English, because most surfaces show error.message as the Worker wrote
// it: the sale writers' "not a selling branch" and "header and lines must use the same branch", the expense writers'
// branch refusals, and two POS refusals. Each now carries a stable code and a role-neutral English sentence that is the
// pack key's, word for word (cloudflare/src/lib/branchRoleGuards.ts; pinned by
// cloudflare/scripts/test-cutover-li-pack-parity-pure.cjs). api/http.ts calls this on every refused response, so a
// surface that shows error.message gets the pack text with no wiring of its own, the way actionHistoryTransport.ts
// restates a replay refusal. English is the Worker's own sentence, so only a Khmer UI loads a pack.
//
// This is deliberately a short list. A refusal with its own localizer (branchRuleErrors.ts's transfer and branch-edit
// codes, returns/helpers/returnRefusalError.ts, saleSubmitErrors.ts) is not restated here.
export const RESTATED_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  stock_schema_unavailable: 'stock_receipt_unavailable',
  stock_transaction_outcome_unknown: 'stock_request_outcome_unknown',
  loyalty_points_disabled: 'loyalty_points_disabled',
  bulk_price_outcome_unknown: 'bulk_price_outcome_unknown',
  stock_session_query_budget_exceeded: 'stock_session_query_budget_exceeded',
  customer_return_over_plan_budget: 'customer_return_over_plan_budget',
  stock_import_unit_over_tier_budget: 'stock_import_unit_over_tier_budget',
  stock_import_reconcile_over_tier_budget: 'stock_import_reconcile_over_tier_budget',
  import_queue_required: 'import_queue_required',
  import_apply_permission_revoked: 'import_apply_permission_revoked',
  bulk_delete_queue_unavailable: 'bulk_delete_queue_unavailable',
  bulk_delete_queue_resume_required: 'bulk_delete_queue_resume_required',
  product_has_stock: 'product_has_stock',
  repair_integrity_restore_permission_required: 'repair_integrity_restore_permission_required',
  product_status_unsupported: 'product_status_unsupported',
  product_replacement_incomplete: 'product_replacement_incomplete',
  // PUT /products/:id that would fold the row into another product, by an editor whose merge switch is off.
  product_merge_permission_required: 'product_merge_permission_required',
  // Return money and product supplier refusals (6.0.930): the Worker sends these codes with an English sentence that is the pack key's, word for word.
  customer_return_owed_unreadable: 'customer_return_owed_unreadable',
  return_refund_khr_unavailable: 'return_refund_khr_unavailable',
  return_reopens_paid_sale_debt: 'return_reopens_paid_sale_debt',
  product_supplier_edit_required: 'product_supplier_edit_required',
  // Return and supplier-return refusals (6.0.926 follow-up). The last three are the Worker's own sentence word for word; idempotency_conflict is shared by every request-id
  // refusal (about fifteen Worker sentences), so its pack text is one operator-language sentence for the whole class, not any one of them.
  idempotency_conflict: 'idempotency_conflict',
  // Six Worker sites (sales.ts: new sale, added lines, amendment; returns.ts: create twice, edit), four sentences, one meaning: the request or the
  // stored return is in the older money format and the sale no longer accepts it. The current app always sends v1, so the reader is never on an
  // old app -- one class sentence: nothing saved, keep the record, a manager or admin can update its money details (6.0.992). EditReturnModal shows the stored-return case before any edit.
  money_precision_review_needed: 'money_precision_review_needed',
  return_replacement_price_forbidden: 'return_replacement_price_forbidden',
  return_edit_replacement_floor: 'return_edit_replacement_floor',
  return_restore_exchange_credit: 'return_restore_exchange_credit',
  return_restore_sale_repriced: 'return_restore_sale_repriced',
  return_export_too_large: 'return_export_too_large',
  return_statement_changed: 'return_statement_changed',
  return_export_maintenance: 'return_export_maintenance',
  return_export_range_invalid: 'return_export_range_invalid',
  return_export_ids_invalid: 'return_export_ids_invalid',
  return_export_cursor_invalid: 'return_export_cursor_invalid',
  return_cancel_exchange_change: 'return_cancel_exchange_change',
  return_exchange_line_no_lot: 'return_exchange_line_no_lot',
  supplier_return_failed: 'supplier_return_failed',
  return_edit_failed: 'return_edit_failed',
  // An import file that would move stock, approved by a user without Adjust / receive at Full (6.0.926 / 6.0.946; the Worker's sentence word for word).
  product_import_stock_adjust_required: 'product_import_stock_adjust_required',
  // A changed default selling / wholesale price without products:price (PUT /products, the products import price gate).
  product_price_edit_required: 'product_price_edit_required',
  branch_not_sellable: 'branch_not_sellable',
  sale_branch_mismatch: 'sale_branch_mismatch',
  sale_identity_conflict: 'sale_identity_conflict',
  unrecorded_stock_line_invalid: 'unrecorded_stock_line_invalid',
  fee_branch_invalid: 'fee_branch_invalid',
  fee_sale_invalid: 'fee_sale_invalid',
  fee_sale_branch_mismatch: 'fee_sale_branch_mismatch',
  // The disabled-branch family (CUTOVER-LR). The redirect pair normally reaches the operator as the redirect float
  // (api/branchRedirect.ts); a surface without that host still gets the sentence in its language.
  branch_redirect_required: 'branch_redirect_required',
  branch_redirect_target_invalid: 'branch_redirect_target_invalid',
  branch_retired_no_successor: 'branch_retired_no_successor',
  branch_retired_damaged_stock: 'branch_retired_damaged_stock',
}

async function kmPackValue(key: string): Promise<string | null> {
  try {
    const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
    if (!language.startsWith('km')) return null
    const pack = (await import('../lang/km.json')).default as Record<string, unknown>
    const value = pack[key]
    return typeof value === 'string' && value.trim() ? value : null
  } catch {
    return null
  }
}

/** The operator went Back from the redirect float: "Nothing was changed. <branch> is disabled." in the UI language. */
export async function restateRedirectDeclined<T extends Error>(error: T, branchName: string): Promise<T> {
  const value = await kmPackValue('branch_redirect_declined')
  if (value) error.message = value.split('{branch}').join(branchName)
  return error
}

export async function restateBranchRefusal<T extends Error & { code?: unknown }>(error: T): Promise<T> {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (!code || !Object.prototype.hasOwnProperty.call(RESTATED_REFUSAL_KEYS, code)) return error
  try {
    const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
    if (!language.startsWith('km')) return error
    const pack = (await import('../lang/km.json')).default as Record<string, unknown>
    const value = pack[RESTATED_REFUSAL_KEYS[code]]
    if (typeof value === 'string' && value.trim()) error.message = value
  } catch {
    // Keep the Worker's English.
  }
  return error
}

// The browser's own sign-in guards (api/actorReadScope.ts), restated the same way by code. English is the guard's own
// sentence, word for word, so only a Khmer UI loads the pack.
export const ACTOR_GUARD_KEYS: Readonly<Record<string, string>> = {
  actor_session_quarantined: 'actor_session_quarantined',
  actor_owner_changed: 'actor_owner_changed',
  stale_read_scope: 'stale_read_scope',
}

export async function restateActorGuard<T extends Error & { code?: unknown }>(error: T): Promise<T> {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (!code || !Object.prototype.hasOwnProperty.call(ACTOR_GUARD_KEYS, code)) return error
  const value = await kmPackValue(ACTOR_GUARD_KEYS[code])
  if (value) error.message = value
  return error
}
