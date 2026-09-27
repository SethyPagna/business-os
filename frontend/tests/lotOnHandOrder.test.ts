// U-cost (owner, 2026-09-25, KIKO 3D Lip Gloss 05): a received lot whose
// remaining quantity is 0 is listed AFTER the lots that still hold stock,
// greyed but viewable, and the cost breakdown tags it 'depleted' (the Worker
// no longer averages it -- cloudflare/scripts/test-migration-0195-on-hand-cost-pure.cjs).
//
// Fixtures put the sold-out lot FIRST in arrival order (it is the earliest
// receipt), so an implementation that keeps the incoming order fails.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getVisibleProductBatches, isDepletedLot, orderLotsOnHandFirst } from '../src/utils/productBatches.ts'
import { costExclusionLabelKey, normalizeCostBreakdown } from '../src/utils/costBreakdownFormat.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

// Depleted = nothing left on hand; anything positive is on hand.
assert.equal(isDepletedLot(0), true)
assert.equal(isDepletedLot('0'), true)
assert.equal(isDepletedLot(undefined), true)
assert.equal(isDepletedLot(-1), true)
assert.equal(isDepletedLot(0.5), false)

// Stable partition: on-hand lots first, sold-out after, each group in arrival order.
const lots = [
  { id: 'A-earliest', quantity: 0 },
  { id: 'B', quantity: 15 },
  { id: 'C', quantity: 0 },
  { id: 'D', quantity: 2 },
]
assert.deepEqual(orderLotsOnHandFirst(lots, (lot) => lot.quantity).map((lot) => lot.id), ['B', 'D', 'A-earliest', 'C'])
assert.deepEqual(lots.map((lot) => lot.id), ['A-earliest', 'B', 'C', 'D'], 'the input array is not reordered in place')
// Double-apply: ordering an already ordered list changes nothing.
const once = orderLotsOnHandFirst(lots, (lot) => lot.quantity)
assert.deepEqual(orderLotsOnHandFirst(once, (lot) => lot.quantity), once)

// The detail views (includeEmpty) get the same order; the compact previews
// still drop sold-out lots entirely.
const product = {
  batches: [
    { id: 1, lot_code: 'early', quantity: 0, branch_stock: [{ branch_id: 1, quantity: 0 }] },
    { id: 2, lot_code: 'late', quantity: 15, branch_stock: [{ branch_id: 1, quantity: 15 }] },
  ],
}
assert.deepEqual(getVisibleProductBatches(product, 'all', { includeEmpty: true }).map((batch) => batch.id), [2, 1])
assert.deepEqual(getVisibleProductBatches(product, 1, { includeEmpty: true }).map((batch) => batch.id), [2, 1])
assert.deepEqual(getVisibleProductBatches(product).map((batch) => batch.id), [2])

// The cost float understands the Worker's new reason and carries the quantity.
assert.equal(costExclusionLabelKey('depleted'), 'cost_breakdown_excluded_depleted')
const breakdown = normalizeCostBreakdown({
  product_id: 7,
  inputs: [
    { source: 'lot', label: 'late', cost_usd: 12.5, cost_khr: null, remaining_quantity: 15, excluded: null },
    { source: 'lot', label: 'early', cost_usd: 12, cost_khr: null, remaining_quantity: 0, excluded: 'depleted' },
    { source: 'lot', label: 'legacy', cost_usd: 9, cost_khr: null, excluded: 'something-new' },
  ],
  distinct_usd: [12.5], mean_usd: 12.5, result_usd: 12.5,
})
assert.deepEqual(breakdown?.inputs.map((row) => [row.excluded, row.remaining_quantity]), [[null, 15], ['depleted', 0], [null, null]])

// Both language packs carry the new label.
for (const pack of ['en', 'km']) {
  const strings = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', `${pack}.json`), 'utf8'))
  assert.ok(typeof strings.cost_breakdown_excluded_depleted === 'string' && strings.cost_breakdown_excluded_depleted.trim(), `${pack}.json has cost_breakdown_excluded_depleted`)
}

console.log('PASS lot lists put on-hand lots first and the cost float tags sold-out lots')
