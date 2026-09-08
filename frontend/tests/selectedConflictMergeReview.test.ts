import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'components', 'products', 'SelectedConflictMergeReviewModal.tsx'), 'utf8')

assert.match(source, /item\.before\.keeper\.name[\s\S]*item\.before\.discarded\.name/, 'the keeper and discarded identities are visible together')
assert.match(source, /item\.before\.keeper\.barcode[\s\S]*item\.before\.discarded\.barcode/, 'both exact identity barcodes remain visible')
assert.match(source, /item\.before\.keeper\.is_active[\s\S]*item\.before\.discarded\.is_active/, 'authoritative active state is not hidden')
for (const field of ['cost_price_usd', 'cost_price_khr', 'selling_price_usd', 'selling_price_khr']) {
  assert.ok(source.includes(field), `before/after review must render ${field}`)
}
for (const field of ['keeper_quantity', 'discarded_quantity', 'keeper_lot_count', 'discarded_lot_count']) {
  assert.ok(source.includes(field), `before review must show ${field}`)
}
assert.match(source, /const resolvedChoice = choice \|\| \(!item\.needs_stock_choice \? 'merge' : null\)/, 'an unstocked pair can show its deterministic After state without inventing a stock choice')
assert.match(source, /after_by_stock_choice\[resolvedChoice\]/, 'the visible After state follows the explicit stock decision')
assert.match(source, /\(\['merge', 'write_off'\] as const\)\.map/, 'both stock outcomes are offered')
assert.match(source, /checked=\{choice === value\}/)
assert.match(source, /disabled=\{choiceDisabled\}/, 'stock decisions are frozen after confirmation so the visible projection matches the retained request body')
assert.doesNotMatch(source, /useState<SelectedConflictStockChoice>/, 'the component must not preselect a destructive stock outcome')
assert.match(source, /selectedConflictChoicesComplete\(preview\.cases, choices\)/, 'confirmation waits for every required stock choice')
assert.match(source, /&& !needsRefresh/, 'a stale preview cannot be reconfirmed')
assert.match(source, /onClick=\{onRefresh\}/, 'the operator can explicitly reload a stale manifest')
assert.match(source, /<ConfirmDialog[\s\S]*layer="nested"/, 'one explicit final confirmation sits above the combined review')
assert.match(source, /committedCases\.map/, 'committed pairs remain visible while a conflicted remainder is reviewed again')
assert.match(source, /result\.refusals\.map/)
assert.match(source, /result\.pendingCaseKeys\.map/, 'pending cases remain named separately from committed and refused work')
assert.match(source, /result\.remainingCaseCount == null \? tr\('unknown'/, 'unknown remaining work is never rendered as zero')
assert.match(source, /item\.undoReady[\s\S]*item\.actionHistoryId[\s\S]*item\.undoAvailability === 'pending'[\s\S]*item\.operationId/, 'each committed pair exposes ready, pending, or terminally unavailable Undo truth')
assert.match(source, /unknownOutcome[\s\S]*selected_conflict_unknown_outcome/, 'an uncertain write outcome has a distinct reconciliation message')
assert.match(source, /canResume[\s\S]*onClick=\{onResume\}/, 'timeout and retryable interruptions expose a same-request resume action')
assert.match(source, /canRepreview[\s\S]*onClick=\{onRefresh\}/, 'state conflicts re-preview the remaining pairs instead of retrying stale state')
assert.match(source, /previousReview[\s\S]*selected_conflict_changed_since_review[\s\S]*selected_conflict_previous_review_values/, 'a changed fingerprint shows the previous reviewed values beside the fresh review')
assert.match(source, /gallery\.slice\(0, 4\)[\s\S]*gallery\.length > 4[\s\S]*setExpanded/, 'large galleries show their full count and an explicit expansion action')
assert.match(source, /tr\('primary', 'Primary'\)/, 'image projections label the primary image independently from the gallery')
assert.match(source, /onClick=\{onClose\}>\{working \? tr\('selected_conflict_cancel_and_refresh'/, 'Cancel remains available during the request and refreshes through the owner')

assert.match(source, /export function SelectedConflictGroupReviewModal/, 'the N-row workflow has a distinct review-only surface')
for (const field of ['barcode', 'category', 'brand', 'unit']) {
  assert.match(source, new RegExp(`field="${field}_source_id"`), `the resolved ${field} must come from an explicit member source`)
}
for (const field of ['supplier_name', 'received_at', 'expiry_date', 'lot_code', 'batch_key', 'received_quantity', 'received_cost_usd', 'unit_cost_usd', 'payment_status', 'credit_due_date']) {
  assert.ok(source.includes(field), `member lot history must expose ${field}`)
}
assert.match(source, /group\.stock\.rows\.filter\(\(row\) => row\.product_id === member\.id\)/, 'before stock stays attributed to each member')
assert.match(source, /group\.stock\.projected_by_branch\.map/, 'resolved stock is shown by branch')
assert.match(source, /group\.lots\.projected_quantity/, 'resolved lot quantity is visible')
assert.match(source, /group\.economics\.merged/, 'server-computed original-group economics drive the After display')
assert.match(source, /distinct non-zero values from the original group/, 'the immutable group-wide cost rule is explained')
assert.match(source, /Manual barcode editing is not part of this review/, 'barcode resolution is source selection rather than a free-text edit')
assert.match(source, /disabled title=\{tr\('selected_conflict_phase_one_notice'/, 'Apply is visibly and truthfully unavailable in Phase 1')
assert.doesNotMatch(source.slice(source.indexOf('export function SelectedConflictGroupReviewModal')), /onConfirm|runSelectedConflictMergeBatch/, 'the Phase 1 group review cannot execute a write')
assert.match(source, /onPreviousPage[\s\S]*onNextPage/, 'one modal pages through the durable global review')
assert.match(source.slice(source.indexOf('export function SelectedConflictGroupReviewModal')), /ModalCloseContext\.Consumer[\s\S]*requestClose \|\| onClose/, 'the footer Close preserves locally selected sources through the same unsaved guard as the header X')

console.log('PASS selected conflict combined review shows exact before/after, explicit choices, partial truth, and independent undo identities')
