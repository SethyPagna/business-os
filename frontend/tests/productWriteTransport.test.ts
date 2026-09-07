import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeDuplicateChunkCanContinueAutomatically, mergeDuplicateChunkRequiresManualResume } from '../src/components/products/mergeDuplicatesRun.ts'
import { cacheGet, cacheSet } from '../src/api/http.ts'
import { invalidateProductReadCacheForReconciliation } from '../src/api/productReadTransport.ts'

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

console.log('PASS product merge auto-continues normal budget yields and stops on infrastructure interruption')
