import assert from 'node:assert/strict'
import { formatPortalBucketText, mergeBucketItems, mergeWishlistItems } from '../src/components/catalog/portalBucket.ts'
import { assistantRowNames, portalRowFromProduct } from '../src/components/catalog/portalProductNames.ts'

// One name rule: the official name is the name on the List, Saved, the copied
// text and the assistant rows, with the shop name as the second line.

const product = {
  id: 7,
  name: 'A&F Authentic EDT 100ml',
  description: 'Official Product Name:\nAbercrombie & Fitch Authentic Man Eau de Toilette 100 ml',
  category: 'Perfume',
  brand: 'A&F',
}
const OFFICIAL = 'Abercrombie & Fitch Authentic Man Eau de Toilette 100 ml'

// The stored row: heading as the name, shop name as its own field.
const row = portalRowFromProduct(product)
assert.equal(row.name, OFFICIAL)
assert.equal(row.shopLine, 'A&F Authentic EDT 100ml')

// It survives the same sanitiser a stored read and a server payload go through.
const [list] = mergeBucketItems([], [{ ...row, qty: 2 }])
assert.equal(list.name, OFFICIAL)
assert.equal(list.shopLine, 'A&F Authentic EDT 100ml')
const [saved] = mergeWishlistItems([], [row])
assert.equal(saved.name, OFFICIAL)
assert.equal(saved.shopLine, 'A&F Authentic EDT 100ml')

// The copied text uses the official name, the shop name in brackets after it.
const text = formatPortalBucketText([list], 'Shop')
assert.ok(text.includes(`1. ${OFFICIAL} [A&F Authentic EDT 100ml] x2`), text)
assert.ok(!/^1\. A&F Authentic EDT 100ml/m.test(text), 'the shop name does not lead the line')

// A product with no official name keeps its own name and has no shop line.
const plain = portalRowFromProduct({ id: 8, name: 'Night Cream', description: 'A rich cream.' })
assert.equal(plain.name, 'Night Cream')
assert.equal('shopLine' in plain, false)

// An item saved on a visitor's device before this change has only a name.
const [old] = mergeBucketItems([], [{ id: 3, name: 'Old saved serum', qty: 1 }])
assert.equal(old.name, 'Old saved serum')
assert.equal(old.shopLine, undefined)
const [oldSaved] = mergeWishlistItems([{ id: 4, name: 'Old saved toner' }], [])
assert.equal(oldSaved.name, 'Old saved toner')
assert.ok(formatPortalBucketText([old]).includes('1. Old saved serum x1'))
assert.ok(!formatPortalBucketText([old]).includes('['), 'no empty brackets for an old item')

// The assistant row: the Worker sends the shop name; the loaded product gives the heading.
const result = { product_id: 7, name: 'A&F Authentic EDT 100ml' }
assert.deepEqual(assistantRowNames(result, [product]), { heading: OFFICIAL, shopLine: 'A&F Authentic EDT 100ml' })
assert.deepEqual(assistantRowNames({ product_id: '7', name: 'x' }, [product]).heading, OFFICIAL, 'ids match as strings')
// Not loaded: the result's own name, nothing invented.
assert.deepEqual(assistantRowNames(result, [{ id: 99, name: 'Other' }]), { heading: 'A&F Authentic EDT 100ml', shopLine: '' })
assert.deepEqual(assistantRowNames(result, undefined), { heading: 'A&F Authentic EDT 100ml', shopLine: '' })

console.log('PASS the List, Saved, copied text and assistant rows use the official name; old saved items still render')
