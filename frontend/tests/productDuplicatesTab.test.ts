// Pins the Products → Duplicates review section's multi-select bulk
// contract, which deliberately mirrors the contacts Possible Duplicates
// panel (cross-surface rule): per-cluster checkboxes, Select all over the
// FILTERED view, a bulk bar with icon-only Merge/Dismiss selected, sequential calls
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

test('the durable group review is the ONLY selected-merge entry point — the retired exact-pairs batch preview is gone', () => {
  // Sep 13's 194529b3 repointed "Merge selected" onto the durable group
  // review (openSelectedGroupReview); the older exact-pairs-only preview
  // (openSelectedMergeReview / batchPreview / SelectedConflictMergeReviewModal)
  // was left behind unreachable and is now removed entirely (P7 debloat).
  for (const deadSymbol of [
    'openSelectedMergeReview', 'resumeSelectedMergeReview', 'refreshSelectedMergeReview',
    'closeSelectedMergeReview', 'executeSelectedMergeBody', 'applySelectedMergeReview',
    'batchPreview', 'batchLocalSkipped', 'batchChoices', 'batchResult', 'batchApplyBody',
    'batchCommittedCases', 'batchChangedCases', 'batchUnknownOutcome', 'batchNeedsRefresh',
    'batchRequestRef', 'batchWriteInFlightRef', 'partitionSelectedConflictClusters',
    'previewSelectedConflictMerges', 'runSelectedConflictMergeBatch', 'makeSelectedConflictMergeApplyBody',
    'preserveSelectedConflictChoices', 'selectedConflictChangedCases', 'mergeSelectedConflictCommittedCases',
    'selectedConflictCanResumeSameRequest',
  ]) {
    assert.ok(!src.includes(deadSymbol), `${deadSymbol} must not remain — it was only reachable from the retired exact-pairs batch preview`)
  }
  // The default export used to render the exact-pairs review; only the named
  // group-review export (the file itself still holds both modals) is imported now.
  assert.doesNotMatch(src, /<SelectedConflictMergeReviewModal/, 'the retired default-export modal is never rendered')
  assert.doesNotMatch(src, /import SelectedConflictMergeReviewModal[,\s]/, 'the retired default export is never imported')
})

test('N-row selections open one durable paged group review', () => {
  assert.match(src, /buildSelectedConflictGroupReviewRequest\(targets, createClientRequestId\('product-conflict-group-review'\), removalReasons\)/)
  assert.match(src, /createSelectedConflictGroupReview\(body, \{ signal: request\.signal \}\)/)
  assert.match(src, /setGroupReviewPages\(\[review\]\)/)
  assert.match(src, /getSelectedConflictGroupReviewPage\(current\.review_id, cursor, SELECTED_CONFLICT_GROUP_REVIEW_PAGE_LIMIT/)
  assert.match(src, /next\.draft_digest === current\.draft_digest[\s\S]*next\.page\.cursor !== cursor/, 'a mismatched page cannot be joined to a different or changed review')
  assert.match(src, /<SelectedConflictGroupReviewModal/)
  assert.match(src, /buildSelectedConflictGroupReviewRequest/, 'the durable group review request builder is wired for every selection')
  // P6-9: "Review selected actions" and "Merge selected" used to render as two
  // separate buttons calling the exact same openSelectedGroupReview() handler
  // with the same title -- a leftover from Sep 13's "Route duplicate
  // selections through durable group review" migration, which repointed
  // Merge selected at the new flow but left the older review-only button in
  // place, now doing nothing different. One button, doing the one thing it
  // does (open the auto-resolve review), replaces both.
  const groupReviewButtonCount = (src.match(/onClick=\{\(\) => void openSelectedGroupReview\(\)\}/g) || []).length
  assert.equal(groupReviewButtonCount, 1, 'the bulk bar must offer exactly one button that opens the group review, not a duplicate')
  assert.match(src, /Remove independently in the global review[\s\S]*Reason for removing this product/, 'independent removal is explicit and requires its own reason')
  assert.doesNotMatch(src, /selected_conflict_remove_unavailable/, 'the reviewed removal path is no longer presented as unavailable')
  assert.match(src, /const groupReviewRequestRef = useRef\(createSelectedConflictRequestCoordinator\(\)\)/, 'the group review has its own request coordinator')
})

test('independent removal is rendered only when the caller has product-delete authority', () => {
  assert.match(src, /ProductDuplicatesTab\(\{ t, notify, canRemoveProduct, onMergeLeadingZero,/)
  assert.match(src, /selected && canRemoveProduct \? \(/, 'the selected-row removal control is absent when deletion is unavailable')
  assert.match(src, /canRemoveProduct=\{canRemoveProduct\}/, 'every rendered cluster receives the same resolved delete capability')
  const products = readFileSync(join(here, '..', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
  assert.match(products, /const canRemoveProduct = can\('products', 'delete'\)/)
  assert.match(products, /<ProductDuplicatesTab\s+t=\{t\}\s+notify=\{notify\}\s+canRemoveProduct=\{canRemoveProduct\}\s+onMergeLeadingZero=\{openLeadingZeroMergeReview\}/)
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
  assert.doesNotMatch(src.slice(src.indexOf('const executeSelectedGroupApply'), src.indexOf('const applySelectedGroupReview')), /deleteProduct|handleApplyDecisions|runSelectedConflictMergeBatch/, 'global independent removals do not use direct delete or legacy pair merge')
})

test('dismiss remains sequential and the group review write path owns its own cancellation and reload', () => {
  assert.match(src, /bulk_dismissing_progress/)
  assert.match(src, /catch \{\s*\n\s*failed \+= 1/, 'one failed cluster must not abort the rest')
  assert.match(src, /bulk_dismiss_partial_failure/)
  assert.match(src, /const writeWillReconcileWhenSettled = groupWriteInFlightRef\.current/)
  assert.match(src, /groupWriteInFlightRef\.current = false[\s\S]*await load\(\)/, 'a cancelled or unknown write reloads only after transport cache invalidation settles')
  assert.match(src, /if \(!writeWillReconcileWhenSettled\) void load\(\)/, 'closing a read-only review refreshes immediately without racing an in-flight write')
  assert.match(src, /t\(`selected_conflict_\$\{code\}`\)/, 'stable API error codes use the bilingual error map before server fallback prose')
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

test('the card has ONE Resolve and none of the retired Keep / Merge / Apply / edit-modal code', () => {
  // Owner, 30 Sep 2026: "i tried to do the keep and merge etc.. they are not
  // working". Keep and Merge were only toggles; the one action that wrote was
  // a small Apply behind "decide every row". The card now mirrors the contacts
  // card: one Resolve opens the shared grid with every product of the group.
  for (const zombie of ['decisions', 'setDecisions', 'everyDecided', 'canApply', 'onApplyDecisions', 'editTarget', 'setEditTarget', 'updateProduct',
    'dup_decide_all_hint', 'dup_pick_one_keep', 'resolve_duplicate_inline_hint', 'product_duplicates_hint', 'InfoHint']) {
    assert.ok(!src.includes(zombie), zombie + ' is retired from the card')
  }
  assert.match(src, /onResolve: \(\) => void/)
  assert.match(src, /onClick=\{onResolve\}[\s\S]{0,400}<Merge aria-hidden="true" className="h-4 w-4" \/>[\s\S]{0,40}\{t\('resolve'\) \|\| 'Resolve'\}/, 'Resolve is the merge icon plus one word')
  assert.match(src, /<ConflictIcon aria-hidden="true"/, 'the card header carries the conflict triangle')
  assert.match(src, /onResolve=\{\(\) => openResolve\(cluster\)\}/, 'the card opens the grid on the whole cluster')
})

test('Dismiss confirms with before and after; the toolbar and bulk buttons are icon-only with a translated tooltip', () => {
  assert.match(src, /setConfirmDismiss\(true\)/)
  assert.match(src, /items=\{\[\s*\{ label: t\('before'\) \|\| 'Before', value: t\('needs_review'\) \|\| 'Needs review' \},\s*\{ label: t\('after'\) \|\| 'After', value: t\('kept_separate'\)/, 'Dismiss shows before and after')
  assert.match(src, /onConfirm=\{\(\) => \{ setConfirmDismiss\(false\); onDismiss\(\) \}\}/, 'nothing is dismissed before the confirm')
  for (const label of ['dismissLabel', 'refreshLabel', 'leadingZeroLabel', 'bulkMergeLabel', 'bulkDismissLabel', 'selectAllLabel', 'clearSelectionLabel']) {
    assert.match(src, new RegExp('title=\\{' + label + '\\}\\s*aria-label=\\{' + label + '\\}'), label + ' is both the tooltip and the accessible name')
  }
  assert.match(src, /<AppSelect[\s\S]{0,400}ariaLabel=\{t\('type'\) \|\| 'Type'\}/, 'the severity pills are one select')
})

test('Resolve minimizes to a chip that keeps the choices, and restoring reopens the grid with them', () => {
  assert.match(src, /onMinimize=\{parkResolve\}/)
  assert.match(src, /initialDraft=\{resolving\.draft\}/)
  assert.match(src, /kind: 'product_resolve'[\s\S]{0,200}payload: \{ cluster: resolving\.cluster, draft \}/, 'the chip carries the group and the draft')
  assert.match(src, /openResolve\(parked\.cluster, parked\.draft\)/, 'restore hands the draft back to the grid')
  assert.match(src, /consumePendingRestore\('product_resolve'\)/, 'a chip restored before the tab mounted is still honoured')
  const minimized = readFileSync(join(here, '..', 'src', 'utils', 'minimizedWork.ts'), 'utf8')
  assert.match(minimized, /\| 'product_resolve'/)
  assert.match(minimized, /product_resolve: \{ permissionKey: 'products', actionKey: 'merge_duplicates' \}/, 'a restored chip is re-checked against the merge permission')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll productDuplicatesTab tests passed')
