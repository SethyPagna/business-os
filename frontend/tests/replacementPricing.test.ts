// 6.0.952 (owner, 22 Oct 2026): "replacement actually isn't replacing but changing or adding both ... they can replace and also add items."
// A replacement row has no cap on its quantity. The units a returned unit of the same product covers go out at the price the sale
// recorded; every other unit (more of that product, or any other product) is a new purchase at the catalog price. The Worker holds a
// caller without the POS price grant to the same floor (cloudflare/scripts/test-return-replacement-defaults-parity-pure.cjs proves the
// two agree over a grid); this pins the screen's own arithmetic.
import assert from 'node:assert/strict'
import { planReplacementParts, replacementPartsTotalUsd, type ReplacementPart } from '../src/components/returns/helpers/replacementPricing.ts'

const row = (key: string, productId: number, quantity: number, catalogUsd = 5, catalogKhr: number | null = 20000) => ({ key, productId, quantity, catalogUsd, catalogKhr })
const back = (productId: number, quantity: number, soldUsd: number | null = 3, soldKhr: number | null = 12000) => ({ productId, quantity, soldUsd, soldKhr })
const shape = (parts: ReplacementPart[] | undefined) => (parts || []).map((part) => [part.quantity, part.priceUsd, part.priceKhr, part.swapped])

// 1 back at $3, 10 out: the swapped unit at $3, the other nine at the catalog $5 -- never ten at $3.
const headline = planReplacementParts([row('a', 1, 10)], [back(1, 1)], 4000)
assert.deepEqual(shape(headline.get('a')), [[1, 3, 12000, true], [9, 5, 20000, false]])
assert.equal(replacementPartsTotalUsd(headline.get('a')!), 48)
console.log('PASS 1 back / 10 out: one unit at the sold price, nine at the catalog price')

// No cap and nothing forced: fewer or as many as were returned is all swapped; the straight swap is one part.
assert.deepEqual(shape(planReplacementParts([row('a', 1, 2)], [back(1, 3)], 4000).get('a')), [[2, 3, 12000, true]])
assert.deepEqual(shape(planReplacementParts([row('a', 1, 3)], [back(1, 3)], 4000).get('a')), [[3, 3, 12000, true]])
assert.deepEqual(shape(planReplacementParts([row('a', 1, 1000)], [back(1, 3)], 4000).get('a')), [[3, 3, 12000, true], [997, 5, 20000, false]])
console.log('PASS fewer, equal and far more than returned: the quantity is never capped, only its price is split')

// Any other product is a new purchase at its catalog price, whatever was returned; so is a product with no recorded sold price.
assert.deepEqual(shape(planReplacementParts([row('o', 2, 10, 4, 16000)], [back(1, 1)], 4000).get('o')), [[10, 4, 16000, false]])
assert.deepEqual(shape(planReplacementParts([row('a', 1, 2)], [back(1, 1, null, null)], 4000).get('a')), [[2, 5, 20000, false]])
assert.deepEqual(shape(planReplacementParts([row('a', 1, 2)], [], 4000).get('a')), [[2, 5, 20000, false]], 'no returned line: all catalog')
console.log('PASS another product, or no recorded price, is sold at the catalog price')

// Units returned of ANOTHER product do not cover this product's units.
assert.deepEqual(shape(planReplacementParts([row('a', 1, 2)], [back(1, 1), back(2, 1, 1, 4000)], 4000).get('a')), [[1, 3, 12000, true], [1, 5, 20000, false]])
console.log("PASS another product's returned units cover nothing")

// Two rows of one product (two lots) share ONE pool of covered units, in row order: the same returned unit is not spent twice.
const twoRows = planReplacementParts([row('a', 1, 1), row('b', 1, 9)], [back(1, 1)], 4000)
assert.deepEqual(shape(twoRows.get('a')), [[1, 3, 12000, true]])
assert.deepEqual(shape(twoRows.get('b')), [[9, 5, 20000, false]])
const threeRows = planReplacementParts([row('a', 1, 2), row('b', 1, 2), row('c', 1, 6)], [back(1, 3)], 4000)
assert.deepEqual([...threeRows.values()].map((parts) => shape(parts)), [[[2, 3, 12000, true]], [[1, 3, 12000, true], [1, 5, 20000, false]], [[6, 5, 20000, false]]])
console.log('PASS rows of one product share the returned units; none is used twice')

// Several returned lines of one product pool their units, at the lowest recorded price (as the Worker does).
const pooled = planReplacementParts([row('a', 1, 5)], [back(1, 2, 3, 12000), back(1, 1, 2.5, 10000)], 4000)
assert.deepEqual(shape(pooled.get('a')), [[3, 2.5, 10000, true], [2, 5, 20000, false]])
console.log('PASS several returned lines pool their units at the lowest recorded price')

// A sale line the import left without a riel price is worth its dollar price at the sale rate, whole riel, rounded down.
assert.deepEqual(shape(planReplacementParts([row('a', 1, 1)], [back(1, 1, 2.99, null)], 4000).get('a')), [[1, 2.99, 11960, true]])
assert.deepEqual(shape(planReplacementParts([row('a', 1, 1)], [back(1, 1, 3, null)], 4100).get('a')), [[1, 3, 12300, true]])
assert.deepEqual(shape(planReplacementParts([row('a', 1, 1)], [back(1, 1, 3, null)], 0).get('a')), [[1, 3, null, true]], 'no usable rate: no riel figure (the Worker then uses the catalog riel price)')
assert.deepEqual(shape(planReplacementParts([row('a', 1, 1)], [back(1, 1, 3, 11000)], 4000).get('a')), [[1, 3, 11000, true]], 'a recorded riel price wins')
console.log('PASS the riel price of an imported line is its dollars at the sale rate, rounded down')

// A product with no catalog riel price posts none (the Worker fills it); the dollar split is unchanged.
assert.deepEqual(shape(planReplacementParts([row('a', 1, 3, 5, null)], [back(1, 1)], 4000).get('a')), [[1, 3, 12000, true], [2, 5, null, false]])
console.log('PASS a missing catalog riel price is left out, not posted as 0')

// Returned quantities are decimals: the parts always add back to the row.
const half = planReplacementParts([row('a', 1, 2)], [back(1, 0.5)], 4000)
assert.equal(shape(half.get('a')).reduce((sum, part) => sum + Number(part[0]), 0), 2)
assert.deepEqual(shape(half.get('a')).map((part) => part[0]), [0.5, 1.5])
console.log('PASS decimal returned quantities split without float residue')
