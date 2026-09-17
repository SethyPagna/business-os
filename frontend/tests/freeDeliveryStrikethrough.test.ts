// Owner (Sep 17, P10-24): "for free it should also cross out the delivery.
// like if free, the driver if exist should be crossed out. a line across the
// name. so it is visually intuitive."
//
// Before this, only the KHR delivery amount was struck through
// (SaleDetailModal's money block). Everywhere the DRIVER was the thing being
// read -- the Sales list column, the mobile card, the sale's own detail rows --
// a delivery the shop paid for and one the customer paid for looked identical.
//
// A test that only checked "the predicate returns true for a free delivery"
// would pass against `() => true`, which would strike out every driver in the
// shop. So each case here is paired with its opposite: a charged delivery, a
// sale that is not a delivery at all, and a row that never loaded the field.
//
// Run: node --experimental-strip-types frontend/tests/freeDeliveryStrikethrough.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isDeliveryFreeForCustomer } from '../src/utils/salesDriverLabel.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const read = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

runTest('only a delivery the shop absorbed counts as free', () => {
  assert.equal(
    isDeliveryFreeForCustomer({ is_delivery: 1, delivery_fee_paid_by: 'store' }),
    true,
    'the shop paying the fee is exactly what the money block already prints as Free',
  )
  assert.equal(
    isDeliveryFreeForCustomer({ is_delivery: 1, delivery_fee_paid_by: 'customer' }),
    false,
    'a delivery the customer paid for must never be struck through',
  )
  assert.equal(
    isDeliveryFreeForCustomer({ is_delivery: 0, delivery_fee_paid_by: 'store' }),
    false,
    'a walk-in sale has no delivery to give away',
  )
  assert.equal(
    isDeliveryFreeForCustomer({ is_delivery: 1 }),
    false,
    'a row that never loaded the payer reads as customer-paid -- absent must not mean free',
  )
  assert.equal(isDeliveryFreeForCustomer(null), false, 'no sale, nothing struck through')
  assert.equal(isDeliveryFreeForCustomer(undefined), false, 'no sale, nothing struck through')
})

runTest('the delivery header the predicate reads is declared on the list row', () => {
  // GET /sales projects s.*, but the frontend row type has to name the fields
  // or the strike-through silently reads undefined on every row.
  const surface = read('components/sales/SalesListSurface.tsx')
  assert.match(surface, /is_delivery\?: number \| boolean \| null/, 'the list row must declare is_delivery')
  assert.match(surface, /delivery_fee_paid_by\?: string \| null/, 'the list row must declare the fee payer')
})

runTest('every surface that shows a driver strikes it through, none on its own terms', () => {
  // Cross-surface rule: the Sales list column, its mobile card and the sale
  // detail all decide this from ONE predicate, so they cannot drift apart.
  const surface = read('components/sales/SalesListSurface.tsx')
  assert.match(surface, /import \{ isDeliveryFreeForCustomer, resolveDriverLabel \}/, 'the list must use the shared predicate')
  assert.equal(
    (surface.match(/const driverFree = isDeliveryFreeForCustomer\(sale\)/g) || []).length,
    2,
    'both the desktop row and the mobile card must resolve it',
  )
  assert.match(
    surface,
    /md:table-cell\$\{driverFree \? ' line-through' : ''\}/,
    'the desktop Driver column must strike through on a free delivery',
  )
  assert.match(
    surface,
    /className=\{driverFree \? 'line-through' : undefined\}/,
    'the mobile card must strike through on a free delivery',
  )

  const detail = read('components/sales/SaleDetailModal.tsx')
  assert.match(
    detail,
    /valueLink=\{deliveryDriverName \? <span className=\{deliveryPaidByStore \? 'line-through' : undefined\}>/,
    'the sale detail driver row must strike through on a free delivery',
  )
  // The amount half of the same fact was already struck through; it must stay.
  assert.match(
    detail,
    /deliveryPaidByStore \? <span className="line-through">\{fmtKHR\(deliveryFeeKhr\)\}<\/span>/,
    'the KHR amount strike-through this feature extends must not be lost',
  )
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All freeDeliveryStrikethrough tests passed')
}
