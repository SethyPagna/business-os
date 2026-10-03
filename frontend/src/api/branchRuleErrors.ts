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
  ['This branch edit can no longer be verified. Refresh Branches and submit a new edit.', 'branch_edit_conflict'],
  ['Branch review is not ready. Refresh after the update and try again.', 'branch_review_schema_required'],
  ['Only allow Shop sale. Please transfer to Shop first.', 'pos_warehouse_not_sellable'],
  ['Transfers move stock only between Shop and Warehouse.', 'transfer_canonical_pair_only'],
  // Keep the previous one-way response localized while an older cached
  // Worker or queued offline response is still in flight.
  ['Transfers move stock from Warehouse to Shop.', 'transfer_source_warehouse_only'],
  [
    'Stock transfer is unavailable because the branch setup must contain exactly one active Shop and one active Warehouse. Ask an administrator to repair the branch records before trying again.',
    'canonical_branch_configuration_invalid',
  ],
  // TRANSFER_REFUSALS in cloudflare/src/lib/transferOperation.ts: what the
  // three transfer routes answer when the planner or the batch's guards refuse.
  ['The products or stock in this transfer changed while it was being saved. Nothing was moved. Refresh and try again.', 'transfer_stock_changed'],
  ['The selected received date no longer has enough stock.', 'transfer_selected_lot_short'],
  ['This transfer has too many received dates. Split it into smaller transfers.', 'transfer_too_many_lots'],
  ['Maintenance is in progress. No stock was transferred; try again shortly.', 'transfer_maintenance_active'],
]

export const BRANCH_RULE_CODE_KEYS: Readonly<Record<string, string>> = {
  branch_edit_conflict: 'branch_edit_conflict',
  branch_review_schema_required: 'branch_review_schema_required',
  canonical_branch_configuration_invalid: 'canonical_branch_configuration_invalid',
  transfer_stock_changed: 'transfer_stock_changed',
  transfer_selected_lot_short: 'transfer_selected_lot_short',
  transfer_too_many_lots: 'transfer_too_many_lots',
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
  for (const [english, key] of BRANCH_RULE_MESSAGE_KEYS) {
    if (text === english || text.includes(english)) return key
  }
  return null
}

/** Prefer the Worker's stable code, retaining exact-message compatibility. */
export function branchRuleErrorKey(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const code = (error as BranchRuleErrorLike).code
    if (typeof code === 'string' && BRANCH_RULE_CODE_KEYS[code]) return BRANCH_RULE_CODE_KEYS[code]
  }
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

export function localizeBranchSaveError(error: unknown, t: (key: string) => string | undefined): string {
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
    if (detail?.code === code || (!detail?.code && text === legacy)) return t(key) || text
  }
  if (!detail?.code && detail?.status === 403 && text === 'Forbidden') {
    return t('branch_approval_review_permission_revoked') || text
  }
  return localizeBranchSaveError(error, t)
}
