// 6.0.952 (owner, 22 Oct 2026): "replacement actually isn't replacing but changing or adding both ... they can replace and also add items."
// A replacement row has no cap on its quantity. The units a returned unit of the same product covers go out at the price the sale
// recorded; every other unit (more of that product, or any other product) is a new purchase at the catalog price. The Worker holds a
// caller without the POS price grant to the same floor (cloudflare/scripts/test-return-replacement-defaults-parity-pure.cjs proves the
// two agree over a grid); this pins the screen's own arithmetic.
import assert from 'node:assert/strict'
import { planReplacementParts, replacementPartsTotalUsd, replacementRowsTotalUsd, resolveSameItemCatalog, type ReplacementPart } from '../src/components/returns/helpers/replacementPricing.ts'

const row = (key: string, productId: number, quantity: number, catalogUsd: number | null = 5, catalogKhr: number | null = 20000) => ({ key, productId, quantity, catalogUsd, catalogKhr })
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

// Several returned lines of one product: each covered unit is priced at ITS OWN line, highest recorded price first -- never one pooled
// lowest price (release review c2f27dce6, P1-1). 2 at $3 and 1 at $2.50 back, 5 out: 2 at $3, 1 at $2.50, then the 2 extras at the catalog.
const perLine = planReplacementParts([row('a', 1, 5)], [back(1, 2, 3, 12000), back(1, 1, 2.5, 10000)], 4000)
assert.deepEqual(shape(perLine.get('a')), [[2, 3, 12000, true], [1, 2.5, 10000, true], [2, 5, 20000, false]])
// The same lines listed cheapest first rank the same: the order the lines arrive in never matters.
assert.deepEqual(shape(planReplacementParts([row('a', 1, 5)], [back(1, 1, 2.5, 10000), back(1, 2, 3, 12000)], 4000).get('a')), shape(perLine.get('a')))
console.log('PASS several returned lines keep their own recorded prices, highest first')

// The review's two probes. 2 x $5 + 1 x $0 back (refund $10), all swapped: the screen charges $10, not $0.
const catalog5 = (key: string, quantity: number) => row(key, 1, quantity, 5, 20000)
const buy2get1 = [back(1, 2, 5, 20000), back(1, 1, 0, 0)]
const oneRow = planReplacementParts([catalog5('a', 3)], buy2get1, 4000)
assert.deepEqual(shape(oneRow.get('a')), [[2, 5, 20000, true], [1, 0, 0, true]])
assert.equal(replacementPartsTotalUsd(oneRow.get('a')!), 10)
// ... one `Same item` chip per sale line: chip 1 takes the units of the dearest line, chip 2 the next -- still $10 in all.
const chips = planReplacementParts([catalog5('chip1', 2), catalog5('chip2', 1)], buy2get1, 4000)
assert.deepEqual(shape(chips.get('chip1')), [[2, 5, 20000, true]])
assert.deepEqual(shape(chips.get('chip2')), [[1, 0, 0, true]])
assert.equal(replacementRowsTotalUsd([replacementPartsTotalUsd(chips.get('chip1')!), replacementPartsTotalUsd(chips.get('chip2')!)]), 10)
// 2 x $5 + 2 x $4.50 back (refund $19): $19, not four at $4.50 ($18).
const halves = [back(1, 2, 5, 20000), back(1, 2, 4.5, 18000)]
const nineteen = planReplacementParts([catalog5('a', 4)], halves, 4000)
assert.deepEqual(shape(nineteen.get('a')), [[2, 5, 20000, true], [2, 4.5, 18000, true]])
assert.equal(replacementPartsTotalUsd(nineteen.get('a')!), 19)
const nineteenChips = planReplacementParts([catalog5('chip1', 2), catalog5('chip2', 2)], halves, 4000)
assert.equal(replacementRowsTotalUsd([replacementPartsTotalUsd(nineteenChips.get('chip1')!), replacementPartsTotalUsd(nineteenChips.get('chip2')!)]), 19)
console.log('PASS 2 x $5 + 1 x $0 is $10 and 2 x $5 + 2 x $4.50 is $19, in one row or one row per line')

// Fewer out than back: the dearest returned units cover them first (3 back = 2 x $5 + 1 x $0, 2 out -> 2 x $5, never the $0 unit).
assert.deepEqual(shape(planReplacementParts([catalog5('a', 2)], buy2get1, 4000).get('a')), [[2, 5, 20000, true]])
// More out than back: the extras are a purchase at the catalog price (3 back, 4 out -> $10 + $5).
const four = planReplacementParts([catalog5('a', 4)], buy2get1, 4000)
assert.deepEqual(shape(four.get('a')), [[2, 5, 20000, true], [1, 0, 0, true], [1, 5, 20000, false]])
assert.equal(replacementPartsTotalUsd(four.get('a')!), 15)
// Two rows of one product share the list in row order: the second row gets what the first left.
const shared = planReplacementParts([catalog5('a', 1), catalog5('b', 3)], buy2get1, 4000)
assert.deepEqual(shape(shared.get('a')), [[1, 5, 20000, true]])
assert.deepEqual(shape(shared.get('b')), [[1, 5, 20000, true], [1, 0, 0, true], [1, 5, 20000, false]])
// Lines at one price are one part, however many lines there are; a line with no dollar price covers nothing.
assert.deepEqual(shape(planReplacementParts([catalog5('a', 4)], [back(1, 2, 3, 12000), back(1, 2, 3, 12000)], 4000).get('a')), [[4, 3, 12000, true]])
assert.deepEqual(shape(planReplacementParts([catalog5('a', 3)], [back(1, 2, null, null), back(1, 1, 3, 12000)], 4000).get('a')), [[1, 3, 12000, true], [2, 5, 20000, false]])
// Equal dollar prices rank by riel, the dearer riel first (the Worker ranks the same way).
assert.deepEqual(shape(planReplacementParts([catalog5('a', 1)], [back(1, 1, 3, 11000), back(1, 1, 3, 12500)], 4000).get('a')), [[1, 3, 12500, true]])
console.log('PASS the dearest returned units cover first; rows share one list; unpriced lines cover nothing')

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

// 6.0.960 (release review c2f27dce6, P3-4) + 6.0.958 (coordinator P3-B): the "Same item" shortcut's catalog read needs the Products view, which a
// role with Returns alone lacks (403). When it is refused or fails the shortcut still works, but the price of its extras is UNKNOWN -- not a guess
// from the sale line's snapshot (the catalog may have moved since, and a till must never show or post a price the Worker will not charge). Such
// extras are posted with no price and the Worker prices them; the screen names no figure for them.
const refused = async () => { throw new Error('You do not have permission to view Products') }
let reads = 0
const readCatalog = async () => { reads += 1; return { selling_price_usd: 6, selling_price_khr: 24000 } }
assert.deepEqual(await resolveSameItemCatalog(readCatalog), { usd: 6, khr: 24000, fromCatalog: true }, 'a readable catalog is the price')
assert.equal(reads, 1)
const unknown = { usd: null, khr: null, fromCatalog: false }
assert.deepEqual(await resolveSameItemCatalog(refused), unknown, 'a refused read leaves the price unknown, not a number from the sale')
assert.deepEqual(await resolveSameItemCatalog(async () => { throw new TypeError('Failed to fetch') }), unknown, 'a network failure does too')
// A read that WORKED and found no product is not a failure to paper over: nothing to swap for. A catalog row with no price is a price of 0 that WAS read.
assert.equal(await resolveSameItemCatalog(async () => null), null)
assert.equal(await resolveSameItemCatalog(async () => undefined), null)
assert.deepEqual(await resolveSameItemCatalog(async () => ({})), { usd: 0, khr: 0, fromCatalog: true })
// The returned units keep their own sale lines' prices; only the extras are unknown.
const unread = (await resolveSameItemCatalog(refused))!
const sameItemPlan = planReplacementParts([row('a', 7, 3, unread.usd, unread.khr)], [back(7, 1, 4, 16000)], 4000)
assert.deepEqual(shape(sameItemPlan.get('a')), [[1, 4, 16000, true], [2, null, null, false]])
assert.equal(replacementPartsTotalUsd(sameItemPlan.get('a')!), null, 'a row with an unknown price has no total to show')
// ... and a row that is all swapped keeps its figure even though the catalog is unknown: that price is the sale line's, which the Worker charges.
const swappedOnly = planReplacementParts([row('a', 7, 1, unread.usd, unread.khr)], [back(7, 1, 4, 16000)], 4000)
assert.deepEqual(shape(swappedOnly.get('a')), [[1, 4, 16000, true]])
assert.equal(replacementPartsTotalUsd(swappedOnly.get('a')!), 4)
// Nothing returned of it (or no recorded price): the whole row is the unknown catalog price.
assert.deepEqual(shape(planReplacementParts([row('a', 7, 2, unread.usd, unread.khr)], [], 4000).get('a')), [[2, null, null, false]])
// The sum over rows is unknown as soon as one row is; an empty list is a known 0.
assert.equal(replacementRowsTotalUsd([4, null]), null)
assert.equal(replacementRowsTotalUsd([4, 6]), 10)
assert.equal(replacementRowsTotalUsd([]), 0)
assert.equal(replacementPartsTotalUsd([]), 0)
console.log('PASS the Same item catalog read leaves its extras with no price when it is refused or fails; nothing is guessed from the sale')
