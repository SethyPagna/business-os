import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSelectedConflictGroupReviewRequest } from '../src/utils/selectedConflictActionReview.ts'

const rows = Array.from({ length: 20 }, (_, index) => ({
  type: 'leadingzero' as const, severity: 'leading_zero' as const, value: String(1000 + index),
  products: [index * 3 + 1, index * 3 + 2, index * 3 + 3].map((id) => ({
    id, name: `Item ${index}`, barcode: String(1000 + index), cost_price_usd: 0,
    selling_price_usd: 8, stock_quantity: 1, image_path: null,
  })),
}))
const request = buildSelectedConflictGroupReviewRequest(rows, 'review-large-selection')
assert.equal(request.resolution_version, 2)
assert.equal(request.merge_groups.length, 20, 'new batch review must not truncate at twelve pairs')
assert.equal(request.merge_groups.flatMap((group) => group.member_ids).length, 60, 'three-row groups remain complete')
assert.deepEqual(request.remove_rows, [], 'leading-zero review must not infer independent removal')

const tab = readFileSync(new URL('../src/components/products/ProductDuplicatesTab.tsx', import.meta.url), 'utf8')
assert.match(tab, /onClick=\{\(\) => void openSelectedGroupReview\(clusters\.filter\(\(cluster\) => cluster\.severity === 'leading_zero'\), \{\}\)\}/)
assert.doesNotMatch(tab, /onClick=\{onMergeLeadingZero\}/)
assert.match(tab, /t\('cost_price'\).*money\(product\.cost_price_usd\)/)
assert.match(tab, /t\('selling_price'\).*money\(product\.selling_price_usd\)/)
assert.doesNotMatch(tab, /money\(product\.cost_price_usd\)\} →/)
assert.match(tab, /candidate\.products\.some\(\(product\) => Number\(product\.id\) === id\)/, 'collision routing requires persisted server evidence for both ids')
assert.match(tab, /products: cluster\.products\.filter\(\(product\) => ids\.has\(Number\(product\.id\)\)\)/, 'collision review excludes unrelated siblings')
assert.match(tab, /product_collision_review_unavailable/, 'missing evidence refuses review')
console.log('PASS durable merge routing, complete group membership, labeled economics and evidence-bound collision handoff')
