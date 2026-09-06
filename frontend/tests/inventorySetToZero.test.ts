import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockAdjustQuantityError, STOCK_ADJUST_QUANTITY_FALLBACKS } from '../src/utils/stockReceiptFields.ts'

// The checkout is CRLF on disk and LF in the index; the pins are written
// against LF so they hold in both.
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Set-to-zero is how a branch is emptied: "I counted the shelf, there is
// nothing left." The Worker already accepts it -- routes/inventory.ts splits
// the guard by type (`type === 'set' ? !(quantity >= 0) : !(quantity > 0)`)
// -- and FastStockInModal already reads the same rule client-side. The two
// remaining adjust surfaces (the Inventory page's per-row adjust, and the
// Products page's StockAdjustModal) still refused it with one blanket
// positive-quantity check, so the same operator counting the same empty shelf
// got a refusal on two of four surfaces.
//
// ONE rule, ONE implementation: `stockAdjustQuantityError` in
// utils/stockReceiptFields.ts, which both surfaces call and which returns the
// PACK KEY of the refusal (never a hard-coded English string).

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const inventorySource = read('../src/components/inventory/Inventory.tsx')
const adjustModalSource = read('../src/components/products/forms/StockAdjustModal.tsx')
const stockModalsSource = read('../src/components/inventory/InventoryStockModals.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

// -- the behavioural discriminator: the input the old code and the new code
// disagree on. `set` + "0" was a refusal; it is now postable.
runTest('a set to zero is postable; an add or a remove of zero is not', () => {
  assert.equal(stockAdjustQuantityError('set', '0'), null)
  assert.equal(stockAdjustQuantityError('set', 0), null)
  assert.equal(stockAdjustQuantityError('set', '  0  '), null)
  assert.equal(stockAdjustQuantityError('add', '0'), 'invalid_quantity')
  assert.equal(stockAdjustQuantityError('remove', '0'), 'invalid_quantity')
})

runTest('an empty box never means "set to zero", and stock cannot go below nothing', () => {
  // Number('') is 0 -- an empty field must refuse, not silently empty a branch.
  assert.equal(stockAdjustQuantityError('set', ''), 'fast_stockin_set_qty')
  assert.equal(stockAdjustQuantityError('set', '   '), 'fast_stockin_set_qty')
  assert.equal(stockAdjustQuantityError('set', null), 'fast_stockin_set_qty')
  assert.equal(stockAdjustQuantityError('set', undefined), 'fast_stockin_set_qty')
  assert.equal(stockAdjustQuantityError('set', '-1'), 'fast_stockin_set_qty')
  assert.equal(stockAdjustQuantityError('set', 'abc'), 'fast_stockin_set_qty')
})

runTest('a positive quantity passes on every type', () => {
  for (const type of ['add', 'remove', 'set']) {
    assert.equal(stockAdjustQuantityError(type, '3'), null, type)
    assert.equal(stockAdjustQuantityError(type, 3), null, type)
  }
  assert.equal(stockAdjustQuantityError('add', ''), 'invalid_quantity')
  assert.equal(stockAdjustQuantityError('add', '-2'), 'invalid_quantity')
  assert.equal(stockAdjustQuantityError('remove', 'abc'), 'invalid_quantity')
})

runTest('the refusal names a pack key that exists in BOTH packs', () => {
  for (const key of ['invalid_quantity', 'fast_stockin_set_qty']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
    assert.match(String(km[key]), /[ក-៿]/, `km.${key} is Khmer`)
    assert.equal(typeof STOCK_ADJUST_QUANTITY_FALLBACKS[key as 'invalid_quantity'], 'string', `fallback.${key}`)
  }
})

// -- and the two call sites actually route through it, with no hard-coded
// English left behind on either.
runTest('the Inventory page per-row adjust dropped its blanket positive guard', () => {
  assert.doesNotMatch(inventorySource, /if \(!qty \|\| qty <= 0\) return notify\('Invalid quantity'/)
  assert.match(inventorySource, /const quantityError = stockAdjustQuantityError\(adjustForm\.type, adjustForm\.quantity\)/)
  assert.match(inventorySource, /if \(quantityError\) return notify\(tr\(quantityError, STOCK_ADJUST_QUANTITY_FALLBACKS\[quantityError\]\), 'error'\)/)
})

runTest('the Products page StockAdjustModal dropped the identical guard', () => {
  assert.doesNotMatch(adjustModalSource, /if \(!qty \|\| qty <= 0\) \{ notify\('Invalid quantity'/)
  assert.match(adjustModalSource, /const quantityError = stockAdjustQuantityError\(adjustForm\.type, adjustForm\.quantity\)/)
  assert.match(adjustModalSource, /if \(quantityError\) \{ notify\(tr\(quantityError, STOCK_ADJUST_QUANTITY_FALLBACKS\[quantityError\]\), 'error'\); return \}/)
})

runTest('both surfaces import the one helper rather than re-deriving the rule', () => {
  for (const source of [inventorySource, adjustModalSource]) {
    assert.match(source, /stockAdjustQuantityError/)
    assert.match(source, /STOCK_ADJUST_QUANTITY_FALLBACKS/)
  }
})

// -- the shared form both surfaces render must not fight the rule with its
// own input floor: a set can be typed down to 0, an add/remove cannot.
runTest('the shared adjust form floors the Qty input at 0 only in set mode', () => {
  // Read the ONE element, not the whole file -- the cost and price inputs
  // below it legitimately carry min="0" and must not answer for this one.
  const start = stockModalsSource.indexOf('id="inventory-adjust-quantity"')
  assert.notEqual(start, -1, 'the adjust quantity input is still identifiable')
  const element = stockModalsSource.slice(start, stockModalsSource.indexOf('/>', start) + 2)
  assert.ok(element.includes("min={adjustForm.type === 'set' ? 0 : 1}"), element)
  assert.doesNotMatch(element, /min="0"/)
  assert.doesNotMatch(element, /min="1"/)
})

if (failed > 0) {
  process.exitCode = 1
}
