// Pins the Products → Duplicates review section's multi-select bulk
// contract, which deliberately mirrors the contacts Possible Duplicates
// panel (cross-surface rule): per-cluster checkboxes, Select all over the
// FILTERED view, a bulk bar with Merge/Dismiss selected, sequential calls
// with visible progress, and — the safety-critical part — bulk merge only
// ever automated for exact same-name + same-cost barcode pairs. Similar-name
// and same-barcode/different-name conflicts stay manual; keeper selection is
// stock-aware, while an extra-zero pair keeps the clean barcode so stock can
// be folded onto it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'components', 'products', 'ProductDuplicatesTab.tsx'), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('every cluster card carries a selection checkbox and a selected ring', () => {
  assert.match(src, /type="checkbox"/)
  assert.match(src, /onChange=\{onToggleSelect\}/)
  assert.match(src, /selected \? 'ring-2 ring-blue-400/, 'a selected card must be visibly distinct')
})

test('Select all selects the FILTERED view, not hidden clusters', () => {
  assert.match(src, /setSelectedKeys\(new Set\(visibleClusters\.map\(\(cluster\) => clusterKey\(cluster\)\)\)\)/)
})

test('selected merge partitions candidates before requesting one combined preview', () => {
  assert.match(src, /const partition = partitionSelectedConflictClusters\(targets\)/)
  assert.match(src, /previewSelectedConflictMerges\(partition\.cases, \{ signal: request\.signal \}\)/)
  assert.match(src, /setBatchLocalSkipped\(partition\.skipped\)/, 'client-ineligible and over-limit selections stay visible in the review')
  assert.match(src, /preserveSelectedConflictChoices\(previous\.cases, preview\.cases, current\)/, 'an explicit re-preview keeps a stock choice only when pair membership and keeper are unchanged')
  assert.match(src, /<SelectedConflictMergeReviewModal/, 'all eligible pairs share one before/after review')
})

test('N-row selections can open one durable paged review without replacing the legacy pair merge', () => {
  assert.match(src, /buildSelectedConflictGroupReviewRequest\(targets, createClientRequestId\('product-conflict-group-review'\), groupRemovalReasons\)/)
  assert.match(src, /createSelectedConflictGroupReview\(body, \{ signal: request\.signal \}\)/)
  assert.match(src, /setGroupReviewPages\(\[review\]\)/)
  assert.match(src, /getSelectedConflictGroupReviewPage\(current\.review_id, cursor, SELECTED_CONFLICT_GROUP_REVIEW_PAGE_LIMIT/)
  assert.match(src, /next\.draft_digest === current\.draft_digest[\s\S]*next\.page\.cursor !== cursor/, 'a mismatched page cannot be joined to a different or changed review')
  assert.match(src, /<SelectedConflictGroupReviewModal/)
  assert.match(src, /selected_conflict_group_review_action/)
  assert.match(src, /selected_conflict_merge_exact_pairs/, 'the existing pair-only write remains separately available')
  assert.match(src, /Remove independently in the global review[\s\S]*Reason for removing this product/, 'independent removal is explicit and requires its own reason')
  assert.doesNotMatch(src, /selected_conflict_remove_unavailable/, 'the reviewed removal path is no longer presented as unavailable')
  assert.match(src, /groupReviewRequestRef[\s\S]*batchRequestRef/, 'read-only paging and legacy writes have independent cancellation ownership')
})

test('independent removal is rendered only when the caller has product-delete authority', () => {
  assert.match(src, /ProductDuplicatesTab\(\{ t, notify, canRemoveProduct \}/)
  assert.match(src, /selected && canRemoveProduct \? \(/, 'the selected-row removal control is absent when deletion is unavailable')
  assert.match(src, /canRemoveProduct=\{canRemoveProduct\}/, 'every rendered cluster receives the same resolved delete capability')
  const products = readFileSync(join(here, '..', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
  assert.match(products, /const canRemoveProduct = can\('products', 'delete'\)/)
  assert.match(products, /<ProductDuplicatesTab t=\{t\} notify=\{notify\} canRemoveProduct=\{canRemoveProduct\}/)
})

test('global review freezes once, then reuses one apply receipt across bounded continuation', () => {
  assert.match(src, /buildSelectedConflictGroupFinalizeRequest\(review, groups, groupReviewChoices\)/)
  assert.match(src, /finalizeSelectedConflictGroupReview\(review\.review_id, body, \{ signal: request\.signal \}\)/)
  assert.match(src, /setGroupApplyBody\(makeSelectedConflictGroupApplyBody\(finalized\)\)/, 'the server manifest is converted to one stable apply body')
  assert.match(src, /while \(calls < callCeiling\)[\s\S]*applySelectedConflictGroupReview\(body/, 'continuations reuse the same frozen body')
  assert.match(src, /if \(!result\.continuation_required\)/, 'the client stops when the backend says no executable continuation remains')
  assert.match(src, /result\.approval_required[\s\S]*No pending removal was reported as completed/, 'review-tier removals remain visibly pending')
  assert.match(src, /const code = String\(\(error as \{ code\?: unknown \} \| null\)\?\.code \|\| ''\)[\s\S]*setGroupApplyError\(\{ code, message:/, 'stable backend interruption codes reach the review recovery surface')
  assert.match(src, /selectedConflictOutcomeIsUnknown\(error\)/, 'ambiguous transport outcomes expose same-receipt resume')
  assert.match(src, /if \(!groupFinalizeResult\) setGroupReviewChoices/, 'late input cannot mutate the finalized review')
  assert.doesNotMatch(src.slice(src.indexOf('const executeSelectedGroupApply'), src.indexOf('const refreshSelectedMergeReview')), /deleteProduct|handleApplyDecisions|runSelectedConflictMergeBatch/, 'global independent removals do not use direct delete or legacy pair merge')
})

test('dismiss remains sequential while merge uses the atomic batch continuation contract', () => {
  assert.match(src, /bulk_dismissing_progress/)
  assert.match(src, /catch \{\s*\n\s*failed \+= 1/, 'one failed cluster must not abort the rest')
  assert.match(src, /bulk_dismiss_partial_failure/)
  assert.match(src, /makeSelectedConflictMergeApplyBody\(batchPreview, batchChoices, createClientRequestId\('product-conflict-merge'\)\)/, 'one stable request id is created at final confirmation')
  assert.match(src, /setBatchApplyBody\(body\)[\s\S]*executeSelectedMergeBody\(body\)/, 'the exact confirmed request body is retained before the first write')
  assert.match(src, /resumeSelectedMergeReview[\s\S]*executeSelectedMergeBody\(batchApplyBody\)/, 'manual resume reuses the same request id, manifest, cases, and choices')
  assert.match(src, /choicesFrozen=\{Boolean\(batchApplyBody\)\}/, 'stock controls freeze for the lifetime of the confirmed request receipt')
  assert.match(src, /if \(!batchApplyBody\) setBatchChoices/, 'late input cannot change the projection while Resume retains the original body')
  assert.match(src, /runSelectedConflictMergeBatch\(body, \{/)
  assert.match(src, /for \(const item of result\.committedCases\) next\.delete\(item\.caseKey\)/, 'only committed pairs leave the current selection')
  assert.match(src, /batchWriteInFlightRef\.current = false[\s\S]*await load\(\)/, 'a cancelled or unknown write reloads only after transport cache invalidation settles')
  assert.match(src, /if \(!writeWillReconcileWhenSettled\) void load\(\)/, 'closing a read-only preview refreshes immediately without racing an in-flight write')
  assert.match(src, /t\(`selected_conflict_\$\{code\}`\)/, 'stable API error codes use the bilingual error map before server fallback prose')
  assert.match(src, /selectedConflictChangedCases\(previous\.cases, preview\.cases\)/, 'a fresh preview retains the old values for every changed fingerprint')
})

test('selection is cleared after any bulk action and pruned when a cluster resolves', () => {
  assert.match(src, /setSelectedKeys\(new Set\(\)\)/)
  const removeBlock = src.slice(src.indexOf('const removeCluster'), src.indexOf('const toggleSelected'))
  assert.match(removeBlock, /next\.delete\(id\)/, 'merging/dismissing a cluster individually must drop it from the selection too')
})

test('the bulk bar reuses the contacts panel\'s shared vocabulary (one review pattern everywhere)', () => {
  for (const key of ['duplicates_bulk_selected_count', 'duplicates_bulk_merge_action', 'duplicates_bulk_dismiss_action', 'select_all', 'clear_selection']) {
    assert.ok(src.includes(key), `${key} should be the same key the contacts DuplicatesTab uses`)
  }
})

test('legacy direct groups apply only after EVERY row is decided, with exactly one Keep', () => {
  // Decide-all-then-apply: per-row Keep/Merge decisions,
  // Apply armed only when the whole group is decided with one keeper.
  assert.match(src, /const \[decisions, setDecisions\] = useState<Record<number, 'keep' \| 'merge'>>/)
  assert.match(src, /const everyDecided = cluster\.products\.every\(\(product\) => decisions\[product\.id\]\)/)
  assert.match(src, /const canApply = Boolean\(keeper\) && everyDecided && merges\.length > 0/)
  assert.match(src, /onApplyDecisions\(keeper, merges\)/)
  assert.match(src, /if \(next\[Number\(id\)\] === 'keep'\) delete next\[Number\(id\)\]/, 'picking a new Keep demotes the old keeper to undecided')
})

test('Resolve edits IN PLACE via a float — the tab never navigates away', () => {
  assert.match(src, /const \[editTarget, setEditTarget\] = useState<ClusterProduct \| null>/)
  assert.match(src, /updateProduct\(editTarget\.id, \{/)
  assert.match(src, /<Modal title=/, 'the edit float is the shared Modal')
  assert.ok(!src.includes('onResolve'), 'no navigation-out prop remains')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll productDuplicatesTab tests passed')
