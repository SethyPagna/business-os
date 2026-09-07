import assert from 'node:assert/strict'
import fs from 'node:fs'

const route = fs.readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')
const transport = fs.readFileSync(new URL('../src/api/productWriteTransport.ts', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/products/MergeDuplicatesReviewModal.tsx', import.meta.url), 'utf8')

assert.match(route, /export const MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST = 25/,
  'each request has a bounded product limit')
assert.match(route, /export const MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER = 2/,
  'only a simple three-row identity cluster can be folded without a manifest')
assert.match(route, /export const MERGE_DUPLICATES_REQUEST_STATEMENT_BUDGET = 700/,
  'the route keeps an explicit whole-request D1 statement budget')
assert.match(route, /statementCount: countedDb\.statementCount\(\)/,
  'the between-cluster budget check includes statements already consumed by the request')
assert.match(route, /mergedProductsCount > 0 && mergedProductsCount \+ group\.duplicates\.length > MERGE_DUPLICATES_MAX_PRODUCTS_PER_REQUEST/,
  'the product limit is enforced between complete identity clusters')

const previewAt = route.indexOf("app.get('/merge-duplicates/preview'")
const postAt = route.indexOf("app.post('/merge-duplicates'", previewAt)
assert.ok(previewAt > 0 && postAt > previewAt, 'preview and mutation routes are both present')
const preview = route.slice(previewAt, postAt)
const postEnd = route.indexOf('// ---------------------------------------------------------------------------', postAt)
const post = route.slice(postAt, postEnd > postAt ? postEnd : undefined)

assert.match(preview, /group\.duplicates\.length > MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER[\s\S]*cluster_exceeds_atomic_limit/,
  'preview reports oversized identity clusters as unchanged')
assert.match(post, /group\.duplicates\.length > MERGE_DUPLICATES_MAX_DUPLICATES_PER_CLUSTER[\s\S]*cluster_exceeds_atomic_limit[\s\S]*continue/,
  'POST refuses an oversized cluster before folding any member')
assert.match(preview, /group\.duplicates\.length > 1[\s\S]*complexLinkedProductIds[\s\S]*cluster_requires_manifest/,
  'preview reports linked multi-product clusters as requiring a manifest')
assert.match(post, /group\.duplicates\.length > 1[\s\S]*complexMultiClusterProductIds[\s\S]*cluster_requires_manifest[\s\S]*continue/,
  'POST refuses a linked multi-product cluster before folding any member')
assert.match(route, /SELECT DISTINCT product_id FROM branch_stock/)
assert.match(route, /SELECT DISTINCT product_id FROM product_images/)
assert.match(route, /NULLIF\(TRIM\(image_path\),''\) IS NOT NULL/,
  'complex-cluster preflight includes a product primary image')
assert.match(route, /const MERGE_DUPLICATES_MULTI_PREFLIGHT_MAX_PRODUCT_IDS = 600/,
  'multi-cluster preflight has a conservative catalog bound')
const preflightStart = route.indexOf('function multiClusterComplexLinkPlan')
const preflightEnd = route.indexOf('async function readDuplicatePreviewCatalog', preflightStart)
assert.ok(preflightStart > 0 && preflightEnd > preflightStart, 'complex-cluster preflight is a bounded helper')
assert.doesNotMatch(route.slice(preflightStart, preflightEnd), /\bUNION\b/,
  'complex preflight uses bounded batch members instead of an oversized compound SELECT')

assert.match(post, /interruptionCode = 'merge_budget_reached'[\s\S]*break/,
  'a normal time or statement budget yield stops before the next cluster')
assert.match(post, /isProductMergeInfrastructureError\(error\)[\s\S]*interruptionCode = 'merge_infrastructure_interrupted'[\s\S]*break mergeGroups/,
  'an infrastructure failure after durable work stops the request')
assert.match(post, /remainingProducts = remainingGroups[\s\S]*: null/,
  'remaining product count is unknown when reconciliation could not run')
assert.match(post, /remainingGroupCount: remainingGroups\?\.length \?\? null/,
  'remaining group count is nullable after infrastructure interruption')
assert.match(post, /maxAdditionalRequests: interruptionCode === 'merge_budget_reached'[\s\S]*\? groups\.length[\s\S]*: remainingGroups\?\.length \?\? null/,
  'only a normal budget yield receives a conservative automatic continuation bound')
assert.match(post, /const onlyRefusedCasesRemain = remainingGroups != null[\s\S]*refusedCaseKeys\.has/,
  'blocked-only is derived from a completed reconciliation of every remaining case')
assert.match(post, /const complete = remainingProducts === 0/,
  'blocked cases never make the response claim the catalog is complete')
assert.match(post, /blockedOnly: onlyRefusedCasesRemain/,
  'the response distinguishes reviewed refusals from an infrastructure interruption')

assert.match(transport, /remainingProducts: number \| null/)
assert.match(transport, /remainingGroupCount: number \| null/)
assert.match(transport, /maxAdditionalRequests: number \| null/,
  'the client contract preserves unknown reconciliation values')
assert.match(route, /processedCaseKeys/)
assert.match(route, /resolveProductMergeClusterPlanEconomics\(clusterPlan\)/)
assert.match(route, /bulkClusterPlan: clusterPlan/)
assert.match(route, /readAppliedBulkClusterPlan/)
assert.match(route, /await finalizeAtomicMergeHistory\(env, atomicHistory\.operationId, reversal, db\)/,
  'history finalization uses the counted database adapter')
assert.doesNotMatch(post, /recordBulkMergeUndoSnapshot/,
  'the bulk route does not add a second undo snapshot beside atomic fold history')

assert.equal((modal.match(/onClick=\{onConfirm\}/g) || []).length, 1, 'the reviewed catalog run has one confirmation action')
assert.match(modal, /one confirmation starts a bounded, resumable merge/)
assert.match(modal, /whole group\\u2019s distinct valid non-zero costs/)
assert.match(modal, /highest retail and wholesale prices are kept/)
assert.match(modal, /mergeableDuplicateProductCount/)
assert.match(modal, /group\(s\) are quarantined and will remain unchanged/)

console.log('productMergeBulkRun: all checks passed')
