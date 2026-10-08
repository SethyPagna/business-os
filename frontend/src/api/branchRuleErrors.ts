// The Worker's branch-rule refusals, mapped back onto the pack keys the
// pickers already show.
//
// The rules live in cloudflare/src/lib/branchRoleGuards.ts and are enforced
// on POST /sales, /sales/:id/items, /sales/:id/amendments, /returns,
// /branches/transfer, /branches/transfer-bulk and /inventory/transfer. Each
// of those returns a 400 whose `error` is the EXACT English of a pack key --
// deliberately, so a rejection that outruns the UI (an offline sale replayed
// later, a stale tab, an amendment posted from a modal, an API caller) can be
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
  ["This stock change is too large for the current plan. Use fewer products or received dates, then try again.", 'stock_session_query_budget_exceeded'],
  ["This return is too large for the current plan. Return fewer items or received dates, then try again.", 'customer_return_over_plan_budget'],
  ["This stock action is too large for the current plan. Use fewer items or received dates, then try again.", 'stock_import_unit_over_tier_budget'],
  ["This stock file is too large to check against one stock snapshot on the current plan. Split it into smaller files, then try again.", 'stock_import_reconcile_over_tier_budget'],
  ["Stock imports are temporarily unavailable. Ask an administrator to check the import service, then retry this job. Saved stock actions will not be applied again.", 'import_queue_required'],
  ['Products with stock cannot be removed. Stock can only be added to products that have not been removed.', 'product_has_stock'],
  ['This branch edit can no longer be verified. Refresh Branches and submit a new edit.', 'branch_edit_conflict'],
  ['Branch review is not ready. Refresh after the update and try again.', 'branch_review_schema_required'],
  ['Sales can only be recorded at a selling branch.', 'branch_not_sellable'],
  ['Transfers move stock only between a selling branch and a storage branch.', 'transfer_branches_pair_only'],
  ['Stock transfer is unavailable because the branch setup does not have a selling branch and a storage branch that are both active. Ask an administrator to check the branch records before trying again.', 'canonical_branch_configuration_invalid'],
  // The sale and expense writers' branch refusals (cloudflare/src/lib/branchRoleGuards.ts): role-neutral, true before and
  // after the cutover, each the English of the pack key named after its code.
  ['The sale and all of its lines must use the same branch.', 'sale_branch_mismatch'],
  ['The branch or received date changed while this sale was being recorded. Refresh the sale and pick the current received date before trying again.', 'sale_identity_conflict'],
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
  bulk_price_outcome_unknown: 'bulk_price_outcome_unknown',
  bulk_price_request_not_saved: 'bulk_price_request_not_saved',
  stock_session_query_budget_exceeded: 'stock_session_query_budget_exceeded',
  customer_return_over_plan_budget: 'customer_return_over_plan_budget',
  stock_import_unit_over_tier_budget: 'stock_import_unit_over_tier_budget',
  stock_import_reconcile_over_tier_budget: 'stock_import_reconcile_over_tier_budget',
  import_queue_required: 'import_queue_required',
  bulk_delete_queue_unavailable: 'bulk_delete_queue_unavailable',
  bulk_delete_queue_resume_required: 'bulk_delete_queue_resume_required',
  product_has_stock: 'product_has_stock',
  product_status_unsupported: 'product_status_unsupported',
  product_replacement_incomplete: 'product_replacement_incomplete',
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
 * N12: POST /review/:id/approve refuses a requester approving their own request
 * (`review_self_approval`) and a reviewer without Full access to the request's
 * section (`review_section_full_required`). Returns the translated sentence for
 * either code, or null for any other error so the caller falls through to its
 * normal localisation.
 */
export function reviewApprovalRefusalText(code: unknown, section: unknown, t: (key: string) => string | undefined): string | null {
  if (code === 'review_self_approval') {
    return t('review_self_approval') || 'You cannot approve your own request. Another reviewer must approve it.'
  }
  if (code === 'review_section_full_required') {
    const name = String(section ?? '')
    return (t('review_section_full_required') || 'Approving this request needs Full access to {section}. Ask a reviewer who has it.')
      .replace('{section}', t(name) || name)
  }
  return null
}
