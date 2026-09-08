import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildSelectedConflictGroupReviewRequest,
  selectedConflictGroupChoiceComplete,
  selectedConflictGroupLoadedProgress,
  selectedConflictGroupSourceValue,
} from '../src/utils/selectedConflictActionReview.ts'

const clusters = [
  {
    type: 'name' as const,
    value: ' Face Wash ',
    severity: 'same_name' as const,
    products: [
      { id: 9, name: 'Face Wash', barcode: 'ABC', cost_price_usd: 4, selling_price_usd: 8, stock_quantity: 2, image_path: null },
      { id: 3, name: 'Face Wash', barcode: 'XYZ', cost_price_usd: 6, selling_price_usd: 9, stock_quantity: 4, image_path: null },
      { id: 9, name: 'duplicate response row', barcode: 'ABC', cost_price_usd: 4, selling_price_usd: 8, stock_quantity: 2, image_path: null },
    ],
  },
  {
    type: 'barcode' as const,
    value: ' 00123 ',
    severity: 'same_barcode' as const,
    products: [
      { id: 20, name: 'Shade A', barcode: '00123', cost_price_usd: 1, selling_price_usd: 2, stock_quantity: 0, image_path: null },
      { id: 21, name: 'Shade B', barcode: '00123', cost_price_usd: 3, selling_price_usd: 5, stock_quantity: 0, image_path: null },
    ],
  },
]

const body = buildSelectedConflictGroupReviewRequest(clusters, 'review-1')
assert.deepEqual(body, {
  manifest_version: 1,
  resolution_version: 2,
  client_request_id: 'review-1',
  merge_groups: [
    { group_key: 'name:face wash', member_ids: [3, 9] },
    { group_key: 'barcode:00123', member_ids: [20, 21] },
  ],
  remove_rows: [],
})
assert.throws(() => buildSelectedConflictGroupReviewRequest(clusters, '  '), /stable client request ID/)

const options = {
  barcode_source_ids: [3, 9],
  category_source_ids: [3, 9],
  brand_source_ids: [3, 9],
  unit_source_ids: [3, 9],
}
assert.equal(selectedConflictGroupChoiceComplete(options, [3, 9], undefined), false)
assert.equal(selectedConflictGroupChoiceComplete(options, [3, 9], {
  keeper_id: 3,
  barcode_source_id: 9,
  category_source_id: 3,
  brand_source_id: 3,
  unit_source_id: 9,
}), true)
assert.equal(selectedConflictGroupChoiceComplete(options, [3, 9], {
  keeper_id: 99,
  barcode_source_id: 9,
  category_source_id: 3,
  brand_source_id: 3,
  unit_source_id: 9,
}), false)

const members = [
  { id: 3, barcode: '', category: null, brand: 'Brand A', unit: 'pcs' },
  { id: 9, barcode: 'XYZ', category: 'Skin', brand: null, unit: '' },
]
assert.equal(selectedConflictGroupSourceValue(members, 3, 'barcode'), '', 'an explicit blank source is preserved')
assert.equal(selectedConflictGroupSourceValue(members, 9, 'category'), 'Skin')
assert.equal(selectedConflictGroupSourceValue(members, undefined, 'unit'), undefined, 'unselected is distinct from a chosen blank')

assert.deepEqual(selectedConflictGroupLoadedProgress([
  { groups: [{ ordinal: 0 }, { ordinal: 1 }], next_cursor: '2' },
  { groups: [{ ordinal: 1 }, { ordinal: 2 }], next_cursor: null },
], 1600), { loaded: 3, total: 1600, complete: true })

const transportSource = readFileSync(fileURLToPath(new URL('../src/api/productWriteTransport.ts', import.meta.url)), 'utf8')
assert.match(transportSource, /manifest_version: 1[\s\S]*resolution_version: 2[\s\S]*status: 'draft'/, 'the frozen v2 review response is discriminated from the legacy pair preview')
const createAt = transportSource.indexOf('export function createSelectedConflictGroupReview')
const pageAt = transportSource.indexOf('export function getSelectedConflictGroupReviewPage')
const legacyApplyAt = transportSource.indexOf('export function makeSelectedConflictMergeApplyBody')
assert.ok(createAt > 0 && pageAt > createAt && legacyApplyAt > pageAt, 'the v2 transport is defined independently from the legacy apply body')
const createTransport = transportSource.slice(createAt, pageAt)
const pageTransport = transportSource.slice(pageAt, legacyApplyAt)
assert.match(createTransport, /apiFetch\([\s\S]*'POST',[\s\S]*'\/api\/products\/possible-duplicates\/merge-batch\/preview',[\s\S]*body,[\s\S]*MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS/, 'v2 preview uses the read-only legacy endpoint without route/offline replay')
assert.doesNotMatch(createTransport, /\broute\(/, 'a durable review request cannot enter the offline product-write replay queue')
assert.match(pageTransport, /reviews\/\$\{encodeId\(reviewId\)\}\?cursor=\$\{encodeURIComponent\(safeCursor\)\}&limit=\$\{safeLimit\}/, 'review pages use the actor-scoped review id and bounded decimal cursor')
assert.match(pageTransport, /Math\.max\(1, Math\.min\(100,/, 'the client honors the backend page ceiling')

console.log('PASS selected conflict N-row review request, explicit sources, blank values, and paged progress')
