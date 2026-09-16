// The "wholesale only > N" automation deferred by migration 0093 and
// specified by the shop owner's 2026-09-04 ruling.
//
// The two things worth pinning here are not the happy path (a big line gets
// the wholesale price) but the two ways this kind of automation goes wrong in
// a real till:
//   - it must DEFAULT OFF, so a shop that upgrades without being asked keeps
//     charging exactly what it charged yesterday;
//   - it must never fight the cashier. It may only reverse its OWN work, and
//     a line a human has ruled on is off limits forever.
//
// Run: node tests/wholesaleAutoPricing.test.ts
import assert from 'node:assert/strict'
import {
  resolveWholesaleAutoRule,
  applyWholesaleAutoPricing,
  WHOLESALE_AUTO_DEFAULT_MIN_QTY,
  type ProductRecord,
} from '../src/components/pos/posCore.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// A cart line for a product that sells at $12 and wholesales at $8.
function line(overrides: Record<string, unknown> = {}): ProductRecord {
  return {
    id: 1,
    cart_line_id: 'L1',
    quantity: 1,
    selling_price_usd: 12,
    selling_price_khr: 48000,
    wholesale_price_usd: 8,
    wholesale_price_khr: 32000,
    applied_price_usd: 12,
    applied_price_khr: 48000,
    base_price_usd: 12,
    base_price_khr: 48000,
    price_mode: 'selling',
    ...overrides,
  } as ProductRecord
}

const ON = { enabled: true, minQuantity: 10 }

// --- 1. the rule resolver, and the default that matters ------------------

runTest('the automation is OFF when nothing has ever been configured', () => {
  const rule = resolveWholesaleAutoRule({})
  assert.equal(rule.enabled, false, 'an unconfigured shop must not auto-apply wholesale')
  assert.equal(rule.minQuantity, WHOLESALE_AUTO_DEFAULT_MIN_QTY)
})

runTest('only the literal string "true" turns it on', () => {
  // Unlike the default-ON toggles elsewhere in Settings, anything unset,
  // blank or garbled must read as OFF -- this one changes what a customer
  // is charged.
  assert.equal(resolveWholesaleAutoRule({ pos_wholesale_auto_enabled: 'true' }).enabled, true)
  assert.equal(resolveWholesaleAutoRule({ pos_wholesale_auto_enabled: 'TRUE' }).enabled, true)
  for (const value of ['false', '', '1', 'yes', 'on', 'nonsense', null, undefined]) {
    assert.equal(
      resolveWholesaleAutoRule({ pos_wholesale_auto_enabled: value }).enabled, false,
      `${JSON.stringify(value)} must not enable the automation`,
    )
  }
})

runTest('a missing or nonsensical threshold falls back to the default, never to 0', () => {
  // A threshold of 0 would mean "every line is wholesale" -- not a threshold
  // at all, and a silent repricing of the entire shop.
  for (const value of ['', '0', '-5', 'abc', null, undefined]) {
    assert.equal(
      resolveWholesaleAutoRule({ pos_wholesale_auto_min_qty: value }).minQuantity,
      WHOLESALE_AUTO_DEFAULT_MIN_QTY,
      `${JSON.stringify(value)} must fall back to the default threshold`,
    )
  }
  assert.equal(resolveWholesaleAutoRule({ pos_wholesale_auto_min_qty: '24' }).minQuantity, 24)
  assert.equal(resolveWholesaleAutoRule({ pos_wholesale_auto_min_qty: '3.7' }).minQuantity, 3)
})

// --- 2. the threshold is "> N", not ">= N" --------------------------------

runTest('a line is left alone while the automation is off, however large', () => {
  const { cart, changed } = applyWholesaleAutoPricing([line({ quantity: 500 })], { enabled: false, minQuantity: 10 })
  assert.equal(changed, false)
  assert.equal(cart[0].price_mode, 'selling')
  assert.equal(cart[0].applied_price_usd, 12)
})

runTest('the threshold is strictly greater than N -- exactly N does not qualify', () => {
  const at = applyWholesaleAutoPricing([line({ quantity: 10 })], ON)
  assert.equal(at.changed, false, 'quantity == N must stay at the selling price ("wholesale only > N")')
  assert.equal(at.cart[0].price_mode, 'selling')

  const over = applyWholesaleAutoPricing([line({ quantity: 11 })], ON)
  assert.equal(over.changed, true)
  assert.equal(over.cart[0].price_mode, 'wholesale')
  assert.equal(over.cart[0].applied_price_usd, 8)
  assert.equal(over.cart[0].base_price_usd, 8)
  assert.equal(over.cart[0].wholesale_auto, true, 'the automation must stamp the line it moved')
})

runTest('a second pass over an already-correct cart reports no change', () => {
  // The POS runs this on every cart mutation; if it never settled it would
  // re-render forever.
  const first = applyWholesaleAutoPricing([line({ quantity: 11 })], ON)
  const second = applyWholesaleAutoPricing(first.cart, ON)
  assert.equal(second.changed, false, 'the pass must settle after one application')
})

runTest('a product with no wholesale price is never moved', () => {
  const noTier = line({ quantity: 99, wholesale_price_usd: 0, wholesale_price_khr: 0 })
  const { changed, cart } = applyWholesaleAutoPricing([noTier], ON)
  assert.equal(changed, false)
  assert.equal(cart[0].price_mode, 'selling')
})

// --- 3. it reverses its own work, and ONLY its own work -------------------

runTest('dropping the quantity back under the threshold restores the selling price', () => {
  const up = applyWholesaleAutoPricing([line({ quantity: 11 })], ON)
  assert.equal(up.cart[0].price_mode, 'wholesale')

  const down = applyWholesaleAutoPricing([{ ...up.cart[0], quantity: 4 }], ON)
  assert.equal(down.changed, true)
  assert.equal(down.cart[0].price_mode, 'selling')
  assert.equal(down.cart[0].applied_price_usd, 12, 'the line must return to full price, never keep a stale cut')
  assert.equal(down.cart[0].wholesale_auto, false)
})

runTest('switching the automation off releases the lines it had taken', () => {
  const up = applyWholesaleAutoPricing([line({ quantity: 11 })], ON)
  const off = applyWholesaleAutoPricing(up.cart, { enabled: false, minQuantity: 10 })
  assert.equal(off.changed, true)
  assert.equal(off.cart[0].price_mode, 'selling')
  assert.equal(off.cart[0].applied_price_usd, 12)
})

runTest('a wholesale line the CASHIER picked is never downgraded by the automation', () => {
  // No wholesale_auto stamp => the automation did not put it there, so the
  // automation has no business taking it away when the quantity is small.
  const manual = line({ quantity: 1, price_mode: 'wholesale', applied_price_usd: 8, base_price_usd: 8 })
  const { changed, cart } = applyWholesaleAutoPricing([manual], ON)
  assert.equal(changed, false, 'a hand-picked tier must survive an automation pass')
  assert.equal(cart[0].price_mode, 'wholesale')
  assert.equal(cart[0].applied_price_usd, 8)
})

runTest('a line the cashier has ruled on is excluded in both directions', () => {
  // This is the flag that stops the cart chip and the automation fighting:
  // without it, tapping the chip off would drop the line to 'selling' and the
  // next pass would immediately put it back, so the button would look broken.
  const optedOut = line({ quantity: 50, wholesale_auto: false, wholesale_auto_optout: true })
  const { changed, cart } = applyWholesaleAutoPricing([optedOut], ON)
  assert.equal(changed, false, 'an opted-out line must not be re-upgraded however large')
  assert.equal(cart[0].price_mode, 'selling')
})

runTest('a manually priced line is never taken over', () => {
  const edited = line({ quantity: 99, manual_discount_type: 'fixed', manual_discount_value: 2 })
  const { changed } = applyWholesaleAutoPricing([edited], ON)
  assert.equal(changed, false, 'the cashier has already said what this line costs')
})

runTest('promotion lines are left to the promotion pass', () => {
  const promo = line({ quantity: 99, price_mode: 'promotion' })
  const { changed } = applyWholesaleAutoPricing([promo], ON)
  assert.equal(changed, false)
})

// --- 4. mixed carts -------------------------------------------------------

runTest('only the qualifying lines in a mixed cart move', () => {
  const cart = [
    line({ cart_line_id: 'A', quantity: 11 }),
    line({ cart_line_id: 'B', quantity: 2 }),
    line({ cart_line_id: 'C', quantity: 40, price_mode: 'promotion' }),
  ]
  const { cart: next, changed } = applyWholesaleAutoPricing(cart, ON)
  assert.equal(changed, true)
  assert.equal(next[0].price_mode, 'wholesale')
  assert.equal(next[1].price_mode, 'selling')
  assert.equal(next[2].price_mode, 'promotion')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll wholesale auto-pricing tests passed')
