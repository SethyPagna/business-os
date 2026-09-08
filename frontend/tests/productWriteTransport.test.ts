import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeDuplicateChunkCanContinueAutomatically, mergeDuplicateChunkRequiresManualResume } from '../src/components/products/mergeDuplicatesRun.ts'
import { cacheGet, cacheSet } from '../src/api/http.ts'
import { invalidateProductReadCacheForReconciliation } from '../src/api/productReadTransport.ts'
import { makeSelectedConflictMergeApplyBody } from '../src/api/productWriteTransport.ts'

assert.equal(mergeDuplicateChunkRequiresManualResume({ interruptionCode: 'merge_infrastructure_interrupted' }), true)
assert.equal(mergeDuplicateChunkRequiresManualResume({ interruptionCode: 'merge_budget_reached' }), false)
assert.equal(mergeDuplicateChunkRequiresManualResume(undefined), false)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: true, maxAdditionalRequests: 4 }), true)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: false, maxAdditionalRequests: 4 }), false)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({ interruptionCode: 'merge_budget_reached', madeProgress: true, maxAdditionalRequests: null }), false)

const here = dirname(fileURLToPath(import.meta.url))
const products = readFileSync(join(here, '..', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
assert.match(products, /calls \+= 1\s+const result = await productApi\.mergeDuplicates/, 'a first-request timeout still records a possibly committed write attempt')
assert.match(products, /if \(calls > 0 \|\| controller\.signal\.aborted\) \{\s+await productApi\.invalidateProductReadCacheForReconciliation\(\)\s+await load\(true\)/, 'every started unknown-outcome POST invalidates product reads before reloading authoritative state')
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

const transport = readFileSync(join(here, '..', 'src', 'api', 'productWriteTransport.ts'), 'utf8')
const preview = {
  success: true as const,
  manifest_version: 1 as const,
  manifest_digest: `sha256-${'a'.repeat(64)}`,
  skipped: [],
  cases: [
    { ordinal: 0, case_key: 'barcode:one', keep_id: 1, merge_id: 2, needs_stock_choice: true, state_digest: `sha256-${'b'.repeat(64)}`, blocked: null, before: {}, after_by_stock_choice: {} },
    { ordinal: 1, case_key: 'barcode:two', keep_id: 3, merge_id: 4, needs_stock_choice: false, state_digest: `sha256-${'c'.repeat(64)}`, blocked: null, before: {}, after_by_stock_choice: {} },
    { ordinal: 2, case_key: 'barcode:blocked', keep_id: 5, merge_id: 6, needs_stock_choice: false, state_digest: `sha256-${'d'.repeat(64)}`, blocked: { code: 'busy', message: 'busy' }, before: {}, after_by_stock_choice: {} },
  ],
}
const applyBody = makeSelectedConflictMergeApplyBody(preview as never, { 'barcode:one': 'write_off' }, 'stable-request')
assert.equal(applyBody.client_request_id, 'stable-request')
assert.deepEqual(applyBody.cases.map((item) => item.stock), ['write_off', null])
assert.deepEqual(applyBody.cases.map((item) => item.ordinal), [0, 1], 'actionable cases are densely reindexed after display-only blocked rows are removed')
assert.ok(!applyBody.cases.some((item) => item.case_key === 'barcode:blocked'), 'a preview-blocked case is display-only and never sent to apply')
const allBlockedBody = makeSelectedConflictMergeApplyBody({ ...preview, cases: [preview.cases[2]] } as never, {}, 'all-blocked')
assert.deepEqual(allBlockedBody.cases, [], 'an all-blocked preview produces no mutation cases')
assert.match(transport, /previewSelectedConflictMerges[\s\S]*apiFetch\([\s\S]*'POST',[\s\S]*'\/api\/products\/possible-duplicates\/merge-batch\/preview'/)
const selectedApply = transport.slice(transport.indexOf('export async function runSelectedConflictMergeBatch'), transport.indexOf('// Zero-quantity product cleanup'))
assert.match(selectedApply, /while \(attempts < callCeiling\)/)
assert.match(selectedApply, /selectedConflictCanContinueAutomatically\(result\)/)
assert.match(selectedApply, /const absoluteCallCeiling = Math\.max\(1, Math\.min\(14, body\.cases\.length \+ 2\)\)/, 'a repeated budget response cannot extend continuation forever')
assert.match(selectedApply, /callCeiling = Math\.min\(absoluteCallCeiling,/, 'the backend allowance remains under the client case-based ceiling')
assert.match(selectedApply, /cacheInvalidate\('products'\)[\s\S]*cacheInvalidate\('inventory'\)/)
assert.doesNotMatch(selectedApply, /\broute\(/, 'manifest-bound writes must never enter offline replay')
assert.equal((selectedApply.match(/\/api\/products\/possible-duplicates\/merge-batch'/g) || []).length, 1, 'all continuation calls reuse the same endpoint and body')

console.log('PASS product merge transports preserve bounded continuation, manifests, stock choices, and reconciliation')
