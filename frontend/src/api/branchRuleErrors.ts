// The Worker's branch-rule refusals, mapped back onto the pack keys the
// pickers already show.
//
// The rules live in cloudflare/src/lib/branchRoleGuards.ts and are enforced
// on POST /sales, /sales/:id/items, /sales/:id/amendments, /returns,
// /branches/transfer, /branches/transfer-bulk and /inventory/transfer. Each
// of those returns a 400 whose `error` is the EXACT English of a pack key --
// deliberately, so a rejection that outruns the UI (a stale tab, an
// amendment posted from a modal, an API caller) can be
// shown to the operator in their own language instead of surfacing as an
// English sentence in the middle of a Khmer screen.
//
// This is the client half of that coupling. Newer branch-configuration
// refusals carry a stable code, while older Workers and the direction/selling
// rules still expose only their exact English message. Keep both lookups so an
// in-flight older deployment remains localized. The English strings below are
// pinned against en.json by frontend/tests/productSheetState.test.ts and
// against the Worker's constants by Cloudflare's branch guard tests.
export const BRANCH_RULE_MESSAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['Points were not added. Loyalty must be on, and the activity must be eligible. Activity from before the reset or while loyalty was off cannot earn points.', 'loyalty_points_disabled'],
  ["This stock change is too large for the current plan. Use fewer products or received dates, then try again.", 'stock_session_query_budget_exceeded'],
  ["This return is too large for the current plan. Return fewer items or received dates, then try again.", 'customer_return_over_plan_budget'],
  ["This stock action is too large for the current plan. Use fewer items or received dates, then try again.", 'stock_import_unit_over_tier_budget'],
  ["This stock file is too large to check against one stock snapshot on the current plan. Split it into smaller files, then try again.", 'stock_import_reconcile_over_tier_budget'],
  ["Stock imports are temporarily unavailable. Ask an administrator to check the import service, then retry this job. Saved stock actions will not be applied again.", 'import_queue_required'],
  ['Products with stock cannot be removed. Stock can only be added to products that have not been removed.', 'product_has_stock'],
  ['This edit would merge this product into an existing product. Change the name or barcode, or ask someone who can merge products.', 'product_merge_permission_required'],
  ['This branch edit can no longer be verified. Refresh Branches and submit a new edit.', 'branch_edit_conflict'],
  ['Branch review is not ready. Refresh after the update and try again.', 'branch_review_schema_required'],
  ['Sales can only be recorded at a selling branch.', 'branch_not_sellable'],
  ['Transfers move stock only between a selling branch and a storage branch.', 'transfer_branches_pair_only'],
  ['Stock transfer is unavailable because the branch setup does not have a selling branch and a storage branch that are both active. Ask an administrator to check the branch records before trying again.', 'canonical_branch_configuration_invalid'],
  // The sale and expense writers' branch refusals (cloudflare/src/lib/branchRoleGuards.ts): role-neutral, true before and
  // after the cutover, each the English of the pack key named after its code.
  ['The sale and all of its lines must use the same branch.', 'sale_branch_mismatch'],
  ['The branch or received date changed while this sale was being recorded. Refresh the sale and pick the current received date before trying again.', 'sale_identity_conflict'],
  ['Stock changed while this sale was being saved. Nothing was recorded. Try again.', 'sale_stock_changed'],
  ['Stock without a received date must be a regular sale line with a branch.', 'unrecorded_stock_line_invalid'],
  ['Every expense must use an active selling branch.', 'fee_branch_invalid'],
  ['Choose an existing sale recorded at a selling branch.', 'fee_sale_invalid'],
  ['The linked sale and expense must use the same branch.', 'fee_sale_branch_mismatch'],
  // TRANSFER_REFUSALS in cloudflare/src/lib/transferOperation.ts: what the
  // three transfer routes answer when the planner or the batch's guards refuse.
  ['The products or stock in this transfer changed while it was being saved. Nothing was moved. Refresh and try again.', 'transfer_stock_changed'],
  ['The selected received date no longer has enough stock.', 'transfer_selected_lot_short'],
  ['This transfer has too many received dates. Split it into smaller transfers.', 'transfer_too_many_lots'],
  ['Maintenance is in progress. No stock was transferred; try again shortly.', 'transfer_maintenance_active'],
]

// The pre-rename and pre-consolidation sentences, which name Shop and Warehouse or the old "two operating branches". A
// Worker still in flight (or a queued response) sends these; they map onto the neutral keys so the operator reads the
// same role-neutral text in either language, and none of them has to equal a pack text.
export const LEGACY_BRANCH_RULE_MESSAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['This atomic stock action exceeds the deployment query budget. Split the receipt into smaller independent actions or use the paid deployment.', 'stock_import_unit_over_tier_budget'],
  ['This reconcile sheet cannot be classified against one stock snapshot within the deployment query budget. Split the sheet or use the paid deployment.', 'stock_import_reconcile_over_tier_budget'],
  ['Stock action imports require the import queue. Restore the queue binding, then retry this job. Saved stock actions will not be applied again.', 'import_queue_required'],
  ['Only allow Shop sale. Please transfer to Shop first.', 'branch_not_sellable'],
  ['Sales can only be recorded at the Shop. Transfer Warehouse stock to the Shop first.', 'branch_not_sellable'],
  ['Transfers move stock only between Shop and Warehouse.', 'transfer_branches_pair_only'],
  ['Transfers move stock only between the two operating branches.', 'transfer_branches_pair_only'],
  ['Transfers move stock from Warehouse to Shop.', 'transfer_branches_pair_only'],
  ['Stock transfer is unavailable because the branch setup must contain exactly one active Shop and one active Warehouse. Ask an administrator to repair the branch records before trying again.', 'canonical_branch_configuration_invalid'],
  ['The sale header and every line must use the same Shop branch.', 'sale_branch_mismatch'],
  ['The sale header and every added line must use the same Shop branch.', 'sale_branch_mismatch'],
  ['The sale header and every amended line must use the same Shop branch.', 'sale_branch_mismatch'],
  ['The sale header and replacement line must use the same Shop branch.', 'sale_branch_mismatch'],
  ['The Shop or batch changed while this sale was being recorded. Refresh the sale and pick the current batch before trying again.', 'sale_identity_conflict'],
  ['Unrecorded stock must be a regular Shop sale line.', 'unrecorded_stock_line_invalid'],
  ['Every expense must use the active Shop branch.', 'fee_branch_invalid'],
  ['Choose an existing sale recorded at the Shop.', 'fee_sale_invalid'],
  ['The linked sale and expense must use the same Shop branch.', 'fee_sale_branch_mismatch'],
  // CANONICAL_BRANCH_IDENTITY_ERROR (409, code canonical_branch_identity_locked) is still this sentence: the Worker's
  // constant is pinned by test-undo-appliers-pure.cjs. The pack text it maps to is role-neutral (the branches are Old
  // Shop and LC Store after the cutover) and is what the operator reads; the code maps there first.
  ['Branches are fixed to Shop and Warehouse. You can edit their details, but you cannot add, rename, deactivate, or delete a branch.', 'canonical_branch_identity_locked'],
]

export const BRANCH_RULE_CODE_KEYS: Readonly<Record<string, string>> = {
  stock_schema_unavailable: 'stock_receipt_unavailable',
  stock_transaction_outcome_unknown: 'stock_request_outcome_unknown',
  loyalty_points_disabled: 'loyalty_points_disabled',
  bulk_price_outcome_unknown: 'bulk_price_outcome_unknown',
  bulk_price_request_not_saved: 'bulk_price_request_not_saved',
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
  product_merge_permission_required: 'product_merge_permission_required',
  customer_return_owed_unreadable: 'customer_return_owed_unreadable',
  return_refund_khr_unavailable: 'return_refund_khr_unavailable',
  return_reopens_paid_sale_debt: 'return_reopens_paid_sale_debt',
  product_supplier_edit_required: 'product_supplier_edit_required',
  idempotency_conflict: 'idempotency_conflict',
  return_replacement_price_forbidden: 'return_replacement_price_forbidden',
  return_edit_replacement_floor: 'return_edit_replacement_floor',
  return_restore_exchange_credit: 'return_restore_exchange_credit',
  return_restore_sale_repriced: 'return_restore_sale_repriced',
  return_export_too_large: 'return_export_too_large',
  return_statement_changed: 'return_statement_changed',
  return_export_maintenance: 'return_export_maintenance',
  return_cancel_exchange_change: 'return_cancel_exchange_change',
  return_exchange_line_no_lot: 'return_exchange_line_no_lot',
  supplier_return_failed: 'supplier_return_failed',
  return_edit_failed: 'return_edit_failed',
  product_import_stock_adjust_required: 'product_import_stock_adjust_required',
  product_price_edit_required: 'product_price_edit_required',
  branch_edit_conflict: 'branch_edit_conflict',
  branch_review_schema_required: 'branch_review_schema_required',
  canonical_branch_configuration_invalid: 'canonical_branch_configuration_invalid',
  canonical_branch_identity_locked: 'canonical_branch_identity_locked',
  branch_not_sellable: 'branch_not_sellable',
  transfer_direction_invalid: 'transfer_branches_pair_only',
  transfer_stock_changed: 'transfer_stock_changed',
  transfer_selected_lot_short: 'transfer_selected_lot_short',
  transfer_too_many_lots: 'transfer_too_many_lots',
  sale_branch_mismatch: 'sale_branch_mismatch',
  sale_identity_conflict: 'sale_identity_conflict',
  sale_stock_changed: 'sale_stock_changed',
  unrecorded_stock_line_invalid: 'unrecorded_stock_line_invalid',
  fee_branch_invalid: 'fee_branch_invalid',
  fee_sale_invalid: 'fee_sale_invalid',
  fee_sale_branch_mismatch: 'fee_sale_branch_mismatch',
  branch_redirect_required: 'branch_redirect_required',
  branch_redirect_target_invalid: 'branch_redirect_target_invalid',
  branch_retired_no_successor: 'branch_retired_no_successor',
  branch_retired_damaged_stock: 'branch_retired_damaged_stock',
}

type BranchRuleErrorLike = {
  code?: unknown
  error?: unknown
  message?: unknown
}

function branchRuleErrorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const candidate = value as BranchRuleErrorLike
    if (typeof candidate.message === 'string') return candidate.message
    if (typeof candidate.error === 'string') return candidate.error
  }
  return value == null ? '' : String(value)
}

/**
 * The pack key for a Worker branch-rule refusal, or null when this message is
 * not one of them.
 *
 * The comparison tolerates a message the caller has already decorated
 * ("Error: <message>", a trailing period from a notify helper) because the
 * error paths that show these differ in how much they wrap: POS notifies the
 * raw `result.error`, TransferModal runs it through getErrorMessage, and
 * Inventory rethrows it as an Error whose message is the sentence.
 */
export function branchRuleMessageKey(message: unknown): string | null {
  const text = branchRuleErrorText(message).trim()
  if (!text) return null
  for (const [english, key] of [...BRANCH_RULE_MESSAGE_KEYS, ...LEGACY_BRANCH_RULE_MESSAGE_KEYS]) {
    if (text === english || text.includes(english)) return key
  }
  return null
}

/** Prefer the Worker's stable code, retaining exact-message compatibility. */
export function branchRuleErrorKey(error: unknown): string | null {
  if (typeof error === 'string' && Object.prototype.hasOwnProperty.call(BRANCH_RULE_CODE_KEYS, error)) {
    return BRANCH_RULE_CODE_KEYS[error]
  }
  if (error && typeof error === 'object') {
    const code = (error as BranchRuleErrorLike).code
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(BRANCH_RULE_CODE_KEYS, code)) return BRANCH_RULE_CODE_KEYS[code]
  }
  const savedCode = /^([a-z_]+):/.exec(branchRuleErrorText(error))?.[1]
  if (savedCode && Object.prototype.hasOwnProperty.call(BRANCH_RULE_CODE_KEYS, savedCode)) return BRANCH_RULE_CODE_KEYS[savedCode]
  return branchRuleMessageKey(error)
}

/**
 * The message to show. A branch-rule refusal comes back translated; anything
 * else is returned untouched, so this can wrap an error path without having
 * to know what else that path can produce.
 */
export function localizeBranchRuleError(message: unknown, t: (key: string) => string | undefined): string {
  const text = branchRuleErrorText(message)
  const key = branchRuleErrorKey(message)
  if (!key) return text
  return t(key) || text
}

function localizeBranchRefusalError(error: unknown, t: (key: string) => string | undefined): string {
  const text = branchRuleErrorText(error)
  const code = error && typeof error === 'object' ? (error as BranchRuleErrorLike).code : null
  if (code === 'permission_denied' || (!code && text === 'You do not have permission to perform this action')) {
    return t('permission_denied') || text
  }
  if (code === 'write_conflict' || (!code && text === 'This branch changed on another device. Refresh and try again.')) {
    return t('branch_edit_conflict') || text
  }
  return localizeBranchRuleError(error, t)
}

export function localizeBranchSaveError(error: unknown, t: (key: string) => string | undefined): string {
  const detail = error && typeof error === 'object' ? error as BranchRuleErrorLike & { outcome?: unknown } : null
  const fallback = 'The result of this branch edit could not be confirmed. It may have been saved. Refresh Branches and check the details before making another edit.'
  if (detail?.code === 'branch_edit_outcome_unknown'
    || (!detail?.code && branchRuleErrorText(error) === fallback)
    || (detail?.code !== 'unknown_outcome' && (detail?.outcome === 'unknown'
      || ['loader_timeout', 'request_timeout', 'write_outcome_unknown'].includes(String(detail?.code || ''))))) {
    return t('branch_edit_outcome_unknown') || fallback
  }
  return localizeBranchRefusalError(error, t)
}

type BranchReviewIdentity = { section?: unknown; action_type?: unknown; entity_type?: unknown }

export function isBranchReviewUpdate(row: BranchReviewIdentity): boolean {
  return row.section === 'branches' && row.action_type === 'update' && row.entity_type === 'branch'
}

export function localizeBranchReviewError(row: BranchReviewIdentity, error: unknown, t: (key: string) => string | undefined): string {
  const text = branchRuleErrorText(error)
  if (!isBranchReviewUpdate(row)) return error instanceof Error ? error.message : String(error || '')
  const detail = error && typeof error === 'object' ? error as BranchRuleErrorLike & { status?: unknown } : null
  const messages = [
    ['unknown_outcome', 'The result could not be confirmed. Retry the same approval request.', 'branch_approval_unknown_outcome'],
    ['review_permission_revoked', 'Your permission to review has changed. This approval may already have completed. Refresh the review queue.', 'branch_approval_review_permission_revoked'],
    ['request_permission_revoked', 'The requester no longer has permission to edit branches.', 'branch_approval_request_permission_revoked'],
  ] as const
  for (const [code, legacy, key] of messages) {
    const legacyCode = !detail?.code || (code === 'unknown_outcome' && detail.code === 'write_outcome_unknown')
    if (detail?.code === code || (legacyCode && text === legacy)) return t(key) || text
  }
  if (!detail?.code && detail?.status === 403 && text === 'Forbidden') {
    return t('branch_approval_review_permission_revoked') || text
  }
  return localizeBranchRefusalError(error, t)
}

/**
 * The permission a refused reviewer lacks, named the way the Users screen names it: `fees:delete` is the action
 * "Delete expense" (perm_act_<section>_<action>), `product_cost_edit` is "Edit product costs" (perm_<name>). An
 * unknown grant is shown as the Worker named it; a refusal that names none falls back to the request's section.
 */
function reviewPermissionName(permission: unknown, section: unknown, t: (key: string) => string | undefined): string {
  const name = typeof permission === 'string' ? permission.trim() : ''
  if (name) {
    const [permissionSection, action] = name.split(':')
    return t(action ? `perm_act_${permissionSection}_${action}` : `perm_${name}`) || name
  }
  const fallback = String(section ?? '')
  return t(fallback) || fallback
}

/**
 * Every refusal POST /review/:id/approve and /reject can answer, as one sentence in the operator's language, or
 * null for any other error so the caller falls through to its normal localisation:
 *   review_self_approval, review_section_full_required, review_identity_conflict
 *   review_action_full_required -- the reviewer lacks the grant the direct route demands (`permission` names it)
 *   review_entity_changed, review_already_decided -- the queue on screen is out of date (reviewStaleDecisionText)
 *   reason_too_long, invalid_reason -- the reject reason (reviewRejectReasonRefusalText)
 *   no_review_applier -- a kind of request with no approval rule (501)
 * `permission` is only read for review_action_full_required.
 */
export function reviewApprovalRefusalText(code: unknown, section: unknown, t: (key: string) => string | undefined, permission?: unknown): string | null {
  if (code === 'review_action_full_required') {
    return (t('review_action_full_required') || 'Approving this request needs full permission for "{permission}". Ask a reviewer who has it.')
      .replace('{permission}', reviewPermissionName(permission, section, t))
  }
  if (code === 'review_entity_changed') return reviewStaleDecisionText('entity_changed', t)
  if (code === 'review_already_decided') return reviewStaleDecisionText('already_decided', t)
  if (code === 'reason_too_long') {
    return (t('reason_too_long') || 'The reason is too long. Use {max} characters or fewer.').replace('{max}', String(REVIEW_REASON_MAX_LENGTH))
  }
  if (code === 'invalid_reason') return t('invalid_reason') || 'The reason must be text. Edit it and try again.'
  if (code === 'no_review_applier') {
    return t('no_review_applier') || 'This kind of request has no approval rule, so it cannot be approved. Reject it, or ask an administrator.'
  }
  if (code === 'review_self_approval') {
    return t('review_self_approval') || 'You cannot approve your own request. Another reviewer must approve it.'
  }
  if (code === 'review_section_full_required') {
    const name = String(section ?? '')
    return (t('review_section_full_required') || 'Approving this request needs Full access to {section}. Ask a reviewer who has it.')
      .replace('{section}', t(name) || name)
  }
  // REVQ-A: approving a queued rename that now matches a product merges it. The merge-specific refusals, each one
  // saying nothing was applied (the confirm and target-changed answers normally open the merge dialog instead).
  if (code === 'review_merge_confirm_required') return t('review_merge_confirm_required') || 'Approving this request merges two products. Review the merge and confirm to continue.'
  if (code === 'review_merge_target_changed') {
    return t('review_merge_target_changed') || 'The merge changed since you reviewed it. Nothing was applied. Review it as it is now and confirm again.'
  }
  if (code === 'review_merge_permission_required') {
    return t('review_merge_permission_required') || 'Approving this request merges products. Only someone who can merge products can approve it. Nothing was applied.'
  }
  if (code === 'merge_state_conflict' || code === 'merge_conflict_retry') {
    return t('review_merge_state_conflict') || 'A product changed while the approval was being applied. Nothing was applied. Reload the queue and try again.'
  }
  if (code === 'review_merge_plan_budget') {
    return t('review_merge_plan_budget') || 'The current plan cannot approve this merge in one step. Nothing was applied. Reject the request and make the edit directly on the product.'
  }
  if (code === 'review_merge_group_row') {
    return t('review_merge_group_row') || 'Group rows cannot be merged. Nothing was applied. Reject this request and merge the variant products instead.'
  }
  if (code === 'request_permission_revoked' && String(section ?? '') === 'products') {
    return t('request_permission_revoked') || 'The requester no longer has the permission this request needs, so nothing was applied. Reject it, or restore their permission and approve again.'
  }
  // Finding I (13 Oct 2026): a queued product create or identity edit that now lands on another product's
  // identity is refused at approval (it would mint a duplicate); the request stays open.
  if (code === 'review_identity_conflict') {
    return t('review_identity_conflict') || 'This request now matches an existing product. Approving it would create a duplicate, so nothing was applied. Reject it and make the change yourself; it will merge into the existing product.'
  }
  return null
}

/** The merge an approval is waiting for the approver to confirm (409 review_merge_confirm_required / _target_changed). */
export type ReviewMergePreview = {
  survivorId: number; survivorName: string; stockMoved: number; priceAfter: number; sessionsClosing: number
  // The queued fields the merge will NOT apply to the kept product, shown before the approver confirms.
  restUnapplied: string[]
  // Sent back with the confirmation: the Worker refuses it (review_merge_target_changed) when either product changed since.
  fingerprint: string
  changed: boolean
}

/**
 * The merge preview carried by a refused approval, or null when the error is anything else. The approver confirms
 * exactly this survivor id: the Worker merges only into the product the approval names (approve body confirm_merge_into),
 * and answers review_merge_target_changed, with the new preview, when it is no longer the right one (`changed`).
 */
export function reviewMergePreview(error: unknown): ReviewMergePreview | null {
  if (!error || typeof error !== 'object') return null
  const { code, preview } = error as { code?: unknown; preview?: unknown }
  if (code !== 'review_merge_confirm_required' && code !== 'review_merge_target_changed') return null
  if (!preview || typeof preview !== 'object') return null
  const p = preview as Record<string, unknown>
  const survivorId = Number(p.survivorId)
  if (!Number.isSafeInteger(survivorId) || survivorId <= 0) return null
  const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return {
    survivorId, survivorName: typeof p.survivorName === 'string' ? p.survivorName : '',
    stockMoved: num(p.stockMoved), priceAfter: num(p.priceAfter), sessionsClosing: Math.max(0, Math.trunc(num(p.sessionsClosing))),
    restUnapplied: Array.isArray(p.restUnapplied) ? p.restUnapplied.filter((field): field is string => typeof field === 'string') : [],
    fingerprint: typeof p.fingerprint === 'string' ? p.fingerprint : '',
    changed: code === 'review_merge_target_changed',
  }
}

/**
 * A reviewer's reject reason is capped like every stock reason. The Worker refuses a longer one
 * (400 reason_too_long) and never truncates it; the Review Queue's field stops at the same number.
 * cloudflare/src/lib/pendingActions.ts REVIEW_REASON_MAX_LENGTH, pinned equal by
 * tests/reviewQueueRejectReason.test.ts. Counted in UTF-16 code units (string.length), the Worker's
 * measure, which is also what the field's maxLength counts.
 */
export const REVIEW_REASON_MAX_LENGTH = 512

export type ReviewStaleDecision = 'entity_changed' | 'already_decided'

/**
 * An approval or rejection the Worker refused because the queue on screen is out of date.
 * `review_entity_changed` -- the record was edited after the request was made, nothing was applied
 * and the request stays open; `review_already_decided` -- another reviewer (or the requester) got
 * there first. The two plain "Already reviewed" 409s of POST /review/:id/approve and /reject carry
 * no code, only that sentence, so exactly that sentence is recognised too; any other uncoded 409
 * (for example a requester whose permission was revoked) is NOT a stale queue.
 * The caller says which it is (reviewStaleDecisionText) and re-reads the queue from the server.
 */
export function reviewStaleDecision(error: unknown): ReviewStaleDecision | null {
  if (!error || typeof error !== 'object') return null
  const { code, status, message } = error as { code?: unknown; status?: unknown; message?: unknown }
  if (code === 'review_entity_changed') return 'entity_changed'
  if (code === 'review_already_decided') return 'already_decided'
  if (!code && Number(status) === 409 && /^Already reviewed( or not found)?$/.test(String(message ?? '').trim())) return 'already_decided'
  return null
}

export function reviewStaleDecisionText(kind: ReviewStaleDecision, t: (key: string) => string | undefined): string {
  return kind === 'entity_changed'
    ? t('review_entity_changed') || 'This record changed after the request was made, so nothing was applied. The request is still open: reject it, or ask for it again.'
    : t('review_already_decided') || 'This request was already decided, or changed, by someone else. The queue has been refreshed.'
}

/**
 * POST /review/:id/reject refuses a reason that is too long (`reason_too_long`) or is not text
 * (`invalid_reason`) and leaves the request open. Returns the sentence for the dialog to show beside
 * the reason, in the operator's language, or null for any other error.
 */
export function reviewRejectReasonRefusalText(error: unknown, t: (key: string) => string | undefined): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  return code === 'reason_too_long' || code === 'invalid_reason' ? reviewApprovalRefusalText(code, null, t) : null
}
