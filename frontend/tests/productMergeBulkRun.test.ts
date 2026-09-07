import assert from 'node:assert/strict'
import fs from 'node:fs'

const route = fs.readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/products/MergeDuplicatesReviewModal.tsx', import.meta.url), 'utf8')

assert.match(route, /const MAX_MERGES_PER_REQUEST = 25/)
assert.match(route, /group\.duplicates\.length > MAX_MERGES_PER_REQUEST[\s\S]*?cluster_exceeds_atomic_limit/)
assert.match(route, /remainingProductsBefore[\s\S]*?madeProgress[\s\S]*?stalled/)
assert.match(route, /remainingGroupCount: remainingGroups\.length/)
assert.match(route, /maxAdditionalRequests: remainingGroups\.length/)
assert.match(route, /processedCaseKeys/)
assert.match(route, /mergeableDuplicateProductCount/)
assert.match(route, /blockedGroupCount/)
assert.match(route, /resolveProductMergeClusterPlanEconomics\(clusterPlan\)/)
assert.match(route, /bulkClusterPlan: clusterPlan/)
assert.match(route, /readAppliedBulkClusterPlan/)
assert.match(route, /await finalizeAtomicMergeHistory/)
assert.doesNotMatch(route.slice(route.indexOf("app.post('/merge-duplicates'"), route.indexOf('// ---------------------------------------------------------------------------', route.indexOf("app.post('/merge-duplicates'"))), /recordBulkMergeUndoSnapshot/)

assert.equal((modal.match(/onClick=\{onConfirm\}/g) || []).length, 1, 'the reviewed catalog run has one confirmation action')
assert.match(modal, /one confirmation starts a bounded, resumable merge/)
assert.match(modal, /whole group\\u2019s distinct valid non-zero costs/)
assert.match(modal, /highest retail and wholesale prices are kept/)
assert.match(modal, /mergeableDuplicateProductCount/)
assert.match(modal, /group\(s\) are quarantined and will remain unchanged/)

console.log('productMergeBulkRun: all checks passed')
