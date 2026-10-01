import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stockAdjustQuantityError, STOCK_ADJUST_QUANTITY_FALLBACKS } from '../src/utils/stockReceiptFields.ts'
import { lineEntryRefusal } from '../src/utils/stockSessionDraft.ts'

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
//
// UI-STOCK-3 (30 Sep 2026): both of those surfaces were retired into the one
// Stock Session, whose entry row refuses through lineEntryRefusal
// (utils/stockSessionDraft.ts). The same rule is pinned there, executed; the
// helper's own table stays below until its owner removes it (no caller left).

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

// -- and the one surface left refuses by the same rule, through its own
// pure entry-row check, with pack keys only.
function sessionRefusal(mode: 'add' | 'remove' | 'set', quantity: string) {
  return lineEntryRefusal({
    mode, hasProduct: true, branchId: '1', quantity, unitCost: '2', supplierName: 'S', lotChoice: mode === 'add' ? 'new' : 'none',
    lot: null, canReceive: true, canEditCosts: true, branchQuantity: 5,
  })?.key ?? null
}

runTest('the Stock Session posts a set to zero and refuses a blank or negative one', () => {
  assert.equal(sessionRefusal('set', '0'), null)
  for (const raw of ['', '   ', '-1', 'abc']) assert.equal(sessionRefusal('set', raw), 'fast_stockin_set_qty', JSON.stringify(raw))
  assert.equal(sessionRefusal('remove', '0'), 'fast_stockin_qty')
  assert.equal(sessionRefusal('add', '-2'), 'fast_stockin_qty')
  for (const mode of ['add', 'remove', 'set'] as const) assert.equal(sessionRefusal(mode, '3'), null, mode)
  // An Add of 0 is an all-free item (owner, 30 Sep): its free row carries the units.
  assert.equal(sessionRefusal('add', '0'), null)
  for (const key of ['fast_stockin_qty', 'fast_stockin_set_qty']) {
    assert.equal(typeof en[key], 'string', `en.${key}`)
    assert.equal(typeof km[key], 'string', `km.${key}`)
  }
})

runTest('no retired per-row guard survives on the Inventory page', () => {
  const inventorySource = read('../src/components/inventory/Inventory.tsx')
  assert.doesNotMatch(inventorySource, /if \(!qty \|\| qty <= 0\) return notify\('Invalid quantity'/)
})

if (failed > 0) {
  process.exitCode = 1
}
