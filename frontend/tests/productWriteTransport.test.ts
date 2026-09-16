import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeDuplicateChunkCanContinueAutomatically, mergeDuplicateChunkRequiresManualResume } from '../src/components/products/mergeDuplicatesRun.ts'
import { cacheGet, cacheSet } from '../src/api/http.ts'
import { setSyncServerUrl } from '../src/api/httpState.ts'
import { invalidateProductReadCacheForReconciliation } from '../src/api/productReadTransport.ts'
import {
  applySelectedConflictGroupReview,
  createSelectedConflictGroupReview,
  finalizeSelectedConflictGroupReview,
  getSelectedConflictGroupReviewPage,
  makeSelectedConflictGroupApplyBody,
} from '../src/api/productWriteTransport.ts'

assert.equal(mergeDuplicateChunkRequiresManualResume({ interruptionCode: 'merge_infrastructure_interrupted' }), true)
assert.equal(mergeDuplicateChunkRequiresManualResume({ interruptionCode: 'merge_budget_reached' }), false)
assert.equal(mergeDuplicateChunkRequiresManualResume(undefined), false)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: true, maxAdditionalRequests: 4 }), true)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: false, maxAdditionalRequests: 4 }), false)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: true, maxAdditionalRequests: null }), false)

const here = dirname(fileURLToPath(import.meta.url))
const products = readFileSync(join(here, '..', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
assert.match(products, /calls \+= 1\s+const result = await productApi\.mergeDuplicates/, 'a first-request timeout still records a possibly committed write attempt')
const unknownOutcomeAt = products.indexOf('const startedRun = calls > 0 || controller.signal.aborted')
const unknownOutcomeEnd = products.indexOf('const undoWarning =', unknownOutcomeAt)
assert.ok(unknownOutcomeAt > 0 && unknownOutcomeEnd > unknownOutcomeAt, 'unknown-outcome reconciliation exists as one bounded block')
const unknownOutcomeBlock = products.slice(unknownOutcomeAt, unknownOutcomeEnd)
const recoveryAt = unknownOutcomeBlock.indexOf('setMergeDuplicatesRecovery({')
const invalidateAt = unknownOutcomeBlock.indexOf('await productApi.invalidateProductReadCacheForReconciliation()')
const reloadAt = unknownOutcomeBlock.indexOf('await load(true)', invalidateAt)
assert.ok(recoveryAt > 0 && invalidateAt > recoveryAt && reloadAt > invalidateAt,
  'every started unknown-outcome POST first persists recovery, then invalidates product reads and reloads authoritative state')
cacheSet('products:search:page=1', { items: [{ id: 99 }] })
cacheSet('sales:get', { items: [{ id: 88 }] })
invalidateProductReadCacheForReconciliation()
assert.equal(cacheGet('products:search:page=1'), null, 'unknown product write outcomes cannot reconcile from a fresh search cache')
assert.deepEqual(cacheGet('sales:get'), { items: [{ id: 88 }] }, 'product reconciliation leaves unrelated read caches intact')
const stopAt = products.indexOf('if (mergeDuplicateChunkRequiresManualResume(result))')
const continueAt = products.indexOf('const remainingBefore = Number(result?.remainingProductsBefore)', stopAt)
assert.ok(stopAt > 0 && continueAt > stopAt, 'an interrupted successful response must stop before automatic continuation')
const partialBlock = products.slice(stopAt, continueAt)
assert.match(partialBlock, /await load\(true\)/, 'partial success reloads authoritative product state')
assert.match(partialBlock, /setMergeDuplicatesReviewOpen\(false\)/, 'manual resume must start from a fresh preview')
assert.match(partialBlock, /merge_duplicates_partial_saved/, 'the user sees the committed count')

const budgetAt = products.indexOf("if (result?.interruptionCode === 'merge_budget_reached')")
const completeAt = products.indexOf('if (result?.complete)', budgetAt)
assert.ok(budgetAt > stopAt && completeAt > budgetAt, 'a normal budget yield is handled after infrastructure interruption and before ordinary completion checks')
const budgetBlock = products.slice(budgetAt, completeAt)
assert.match(budgetBlock, /mergeDuplicateChunkCanContinueAutomatically\(result\)/)
assert.match(budgetBlock, /callCeiling = Math\.max\(callCeiling, calls \+ result\.maxAdditionalRequests\)/)
assert.match(budgetBlock, /continue/)
assert.doesNotMatch(budgetBlock, /setMergeDuplicatesReviewOpen\(false\)/, 'a normal safe yield keeps the original confirmation active')
assert.match(products, /if \(result\?\.blockedOnly\)[\s\S]*?completed = true[\s\S]*?break/, 'deliberate refusals reach the summary without another futile request')

const originalFetch = globalThis.fetch

const v2Calls: Array<{ url: string; method: string; body: unknown }> = []
setSyncServerUrl('http://selected-conflict-v2-fixture')
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  v2Calls.push({ url, method: String(init?.method || 'GET'), body })
  if (url.includes('/finalize')) {
    return new Response(JSON.stringify({
      success: true, manifest_version: 1, resolution_version: 2,
      review_id: 'review-v2', manifest_digest: `sha256-${'f'.repeat(64)}`, status: 'finalized',
      counts: { requested_groups: 1, canonical_groups: 1, ready_groups: 1, blocked_groups: 0, total_members: 3, merge_folds: 1, requested_actions: 2, requested_removals: 1, ready_removals: 1, blocked_removals: 0 },
      summary: { groups_ready: 1, groups_blocked: 0, image_effect_groups: 0, removals_ready: 1, removals_blocked: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (url.endsWith('/merge-batch')) {
    return new Response(JSON.stringify({
      success: true, manifest_version: 1, resolution_version: 2,
      review_id: 'review-v2', manifest_digest: `sha256-${'f'.repeat(64)}`, status: 'approval_pending',
      continuation_required: false, approval_required: true,
      counts: { requested_actions: 2, requested_groups: 1, requested_removals: 1, total_members: 3, canonical_groups: 1, pending_groups: 0, partial_groups: 0, completed_groups: 1, refused_groups: 0, blocked_groups: 0, reversed_groups: 0, history_pending_groups: 0, undo_ready_groups: 1, merge_folds: 1, pending_folds: 0, committed_folds: 1, refused_folds: 0, reversed_folds: 0, removal_actions: 1, pending_removals: 0, approval_pending_removals: 1, completed_removals: 0, refused_removals: 0, blocked_removals: 0, reversed_removals: 0 },
      groups: [{ group_key: 'name:serum', status: 'completed', processed_folds: 1, keeper_id: 1, merged_ids: [2], operation_ids: ['fold-1'] }],
      removals: [{ action_ordinal: 1, product_id: 3, status: 'approval_pending', pending_action_id: 44, undo_availability: 'unavailable', generation: 0 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({
    success: true, manifest_version: 1, resolution_version: 2,
    review_id: 'review-v2', draft_digest: `sha256-${'d'.repeat(64)}`, manifest_digest: null, status: 'draft', expires_at: '2026-09-08T17:00:00.000Z',
    counts: { requested_actions: 2, requested_groups: 1, requested_removals: 1, actionable_groups: 1, blocked_groups: 0, total_members: 3 },
    page: { cursor: url.includes('?cursor=1') ? '1' : '0', next_cursor: null, limit: 50, groups: [], removals: [] },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  const previewBody = {
    manifest_version: 1 as const,
    resolution_version: 2 as const,
    client_request_id: 'review-request-v2',
    merge_groups: [{ group_key: 'name:serum', member_ids: [1, 2] }],
    remove_rows: [{ product_id: 3, reason: 'Confirmed obsolete row' }],
  }
  await createSelectedConflictGroupReview(previewBody)
  await getSelectedConflictGroupReviewPage('review-v2', '1', 50)
  const finalizeBody = {
    manifest_version: 1 as const,
    resolution_version: 2 as const,
    review_id: 'review-v2',
    draft_digest: `sha256-${'d'.repeat(64)}`,
    resolutions: [{ group_key: 'name:serum', keeper_id: 1, barcode: { mode: 'member' as const, source_product_id: 1 }, category_source_id: 1, brand_source_id: 2, unit_source_id: 1 }],
  }
  const finalized = await finalizeSelectedConflictGroupReview('review-v2', finalizeBody)
  const groupApplyBody = makeSelectedConflictGroupApplyBody(finalized)
  assert.deepEqual(groupApplyBody, { review_id: 'review-v2', manifest_digest: `sha256-${'f'.repeat(64)}`, client_request_id: 'review-v2' })
  const applied = await applySelectedConflictGroupReview(groupApplyBody)
  assert.equal(applied.approval_required, true)
  assert.equal(applied.continuation_required, false)
  assert.equal(applied.removals[0].status, 'approval_pending')
  assert.deepEqual(v2Calls.map((call) => [call.method, call.url]), [
    ['POST', 'http://selected-conflict-v2-fixture/api/products/possible-duplicates/merge-batch/preview'],
    ['GET', 'http://selected-conflict-v2-fixture/api/products/possible-duplicates/merge-batch/reviews/review-v2?cursor=1&limit=50'],
    ['POST', 'http://selected-conflict-v2-fixture/api/products/possible-duplicates/merge-batch/reviews/review-v2/finalize'],
    ['POST', 'http://selected-conflict-v2-fixture/api/products/possible-duplicates/merge-batch'],
  ])
  assert.deepEqual(v2Calls[0].body, previewBody)
  assert.deepEqual(v2Calls[2].body, finalizeBody)
  assert.deepEqual(v2Calls[3].body, groupApplyBody)
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
}
console.log('PASS v2 group review transport preserves mixed preview, finalize, stable apply, and approval-pending receipts')
