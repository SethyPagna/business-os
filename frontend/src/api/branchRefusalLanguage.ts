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
  bulk_delete_queue_unavailable: 'bulk_delete_queue_unavailable',
  bulk_delete_queue_resume_required: 'bulk_delete_queue_resume_required',
  product_has_stock: 'product_has_stock',
  product_status_unsupported: 'product_status_unsupported',
  product_replacement_incomplete: 'product_replacement_incomplete',
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
