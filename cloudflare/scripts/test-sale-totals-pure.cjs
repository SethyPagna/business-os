// Regression test for lib/saleTotals.ts -- the money math behind every
// recorded sale.
//
// Two real bugs lived in this arithmetic while it was inline in
// routes/sales.ts, and no existing test could see either one:
//
//   1. DELIVERY FEE MISSING FROM THE RECORDED TOTAL. POS.tsx's cart charged
//      `afterDiscount + tax + customerFee` and printed that on the receipt,
//      but the server recorded `subtotal - discount - membershipDiscount +
//      tax` with no fee term at all. Every delivery sale therefore stored a
//      total BELOW what the cashier actually collected, and the gap flowed
//      onward into change_usd, the Sales page, salesAnalytics and loyalty
//      points accrual. The fee scalars were computed further down the
//      handler, next to the delivery_contacts lookup, so they were not even
//      in scope where the total was built.
//
//   2. KHR-ONLY SALES RECORDED A FABRICATED USD TENDER. `Number(
//      body.amount_paid_usd) || totalUsd` treats a legitimate 0 as "the
//      client didn't send a value" and substitutes the whole total -- so a
//      customer paying entirely in riel was recorded as having handed over
//      the full USD amount, and change_usd became roughly a second full
//      total on top.
//
// Run: node scripts/test-sale-totals-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const srcPath = path.join(cloudflareRoot, 'src', 'lib', 'saleTotals.ts')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sale-totals-'))
const tsPath = path.join(tmpDir, 'saleTotals.ts')
fs.writeFileSync(tsPath, fs.readFileSync(srcPath, 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { computeSaleTotals, round2 } = require(path.join(tmpDir, 'saleTotals.js'))

const RATE = 4100

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

/** A plain non-delivery cash sale, used as the base for each scenario. */
const base = {
  subtotalUsd: 40,
  discountUsd: 0,
  membershipDiscountUsd: 0,
  taxUsd: 0,
  isDelivery: false,
  deliveryFeeUsd: 0,
  deliveryFeePaidBy: 'customer',
  exchangeRate: RATE,
  rawAmountPaidUsd: 40,
  rawAmountPaidKhr: 0,
}

check('baseline: a simple exact-cash USD sale balances to zero change', () => {
  const t = computeSaleTotals(base)
  assert.equal(t.totalUsd, 40)
  assert.equal(t.totalKhr, 40 * RATE)
  assert.equal(t.amountPaidUsd, 40)
  assert.equal(t.changeUsd, 0)
  assert.equal(t.changeKhr, 0)
})

// ---- bug 1: delivery fee ----
check('a CUSTOMER-paid delivery fee is included in the recorded total', () => {
  const t = computeSaleTotals({ ...base, isDelivery: true, deliveryFeeUsd: 2.5, deliveryFeePaidBy: 'customer', rawAmountPaidUsd: 42.5 })
  assert.equal(t.customerDeliveryFeeUsd, 2.5)
  assert.equal(t.totalUsd, 42.5, 'the fee the cashier charged must be in the total that gets stored')
  assert.equal(t.changeUsd, 0, 'paying exactly the charged amount must leave no change')
})

check('a STORE-paid delivery fee does NOT change the customer total', () => {
  const t = computeSaleTotals({ ...base, isDelivery: true, deliveryFeeUsd: 2.5, deliveryFeePaidBy: 'store' })
  assert.equal(t.customerDeliveryFeeUsd, 0)
  assert.equal(t.totalUsd, 40, 'a fee the store absorbs is a cost, not part of the bill')
})

check('a fee on a NON-delivery sale is ignored entirely', () => {
  const t = computeSaleTotals({ ...base, isDelivery: false, deliveryFeeUsd: 9.99, deliveryFeePaidBy: 'customer' })
  assert.equal(t.customerDeliveryFeeUsd, 0)
  assert.equal(t.totalUsd, 40)
})

check('delivery fee combines correctly with discount, membership discount and tax', () => {
  const t = computeSaleTotals({
    ...base, subtotalUsd: 100, discountUsd: 10, membershipDiscountUsd: 5, taxUsd: 3,
    isDelivery: true, deliveryFeeUsd: 4, deliveryFeePaidBy: 'customer', rawAmountPaidUsd: 92,
  })
  assert.equal(t.totalUsd, 92, '100 - 10 - 5 + 3 + 4')
  assert.equal(t.changeUsd, 0)
})

// ---- bug 2: KHR-only tender ----
check('a KHR-only sale records ZERO usd tendered, not a fabricated full total', () => {
  const totalUsd = 40
  const t = computeSaleTotals({ ...base, rawAmountPaidUsd: 0, rawAmountPaidKhr: totalUsd * RATE })
  assert.equal(t.amountPaidUsd, 0, 'no USD was handed over; recording the total as USD invents money')
  assert.equal(t.amountPaidKhr, totalUsd * RATE)
  assert.equal(t.changeUsd, 0, 'paying the exact riel amount must leave no change')
})

check('a split USD + KHR payment settles to zero change', () => {
  const t = computeSaleTotals({ ...base, rawAmountPaidUsd: 20, rawAmountPaidKhr: 20 * RATE })
  assert.equal(t.amountPaidUsd, 20)
  assert.equal(t.amountPaidKhr, 20 * RATE)
  assert.equal(t.changeUsd, 0)
})

check('an ABSENT amount_paid_usd still falls back to the total (the legitimate case)', () => {
  for (const missing of [undefined, null, '', 'abc', NaN]) {
    const t = computeSaleTotals({ ...base, rawAmountPaidUsd: missing })
    assert.equal(t.amountPaidUsd, 40, `absent/non-numeric (${String(missing)}) should assume payment in full`)
  }
})

check('a negative tender is clamped to zero rather than crediting the customer', () => {
  const t = computeSaleTotals({ ...base, rawAmountPaidUsd: -50 })
  assert.equal(t.amountPaidUsd, 0)
})

check('overpayment in riel produces correct USD change', () => {
  const t = computeSaleTotals({ ...base, rawAmountPaidUsd: 0, rawAmountPaidKhr: 45 * RATE })
  assert.equal(t.amountPaidUsd, 0)
  assert.equal(t.changeUsd, 5)
  assert.equal(t.changeKhr, 5 * RATE)
})

// ---- general robustness ----
check('a missing/zero exchange rate falls back to 4100 instead of dividing by zero', () => {
  const t = computeSaleTotals({ ...base, exchangeRate: 0, rawAmountPaidUsd: 0, rawAmountPaidKhr: 40 * 4100 })
  assert.equal(t.totalKhr, 40 * 4100)
  assert.ok(Number.isFinite(t.changeUsd), 'change must never be Infinity/NaN')
  assert.equal(t.changeUsd, 0)
})

check('round2 rounds half up through float noise (1.005 -> 1.01)', () => {
  assert.equal(round2(1.005), 1.01)
  assert.equal(round2(0.1 + 0.2), 0.3)
})

check('totals stay cent-exact across a float-noisy basket', () => {
  const t = computeSaleTotals({ ...base, subtotalUsd: 0.1 + 0.2, taxUsd: 0, rawAmountPaidUsd: 0.3 })
  assert.equal(t.totalUsd, 0.3)
  assert.equal(t.changeUsd, 0)
})

// ---- source lock-in: the route must USE this function, not re-inline it ----
const salesSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'sales.ts'), 'utf8')

check('routes/sales.ts computes totals via computeSaleTotals, and no longer re-derives them inline', () => {
  assert.ok(/computeSaleTotals\(\{/.test(salesSrc), 'sales.ts should call computeSaleTotals')
  assert.ok(
    !/const totalUsd = round2\(subtotalUsd/.test(salesSrc),
    'sales.ts still has the inline total that omitted the delivery fee',
  )
  assert.ok(
    !/Number\(body\.amount_paid_usd\) \|\| totalUsd/.test(salesSrc),
    'sales.ts still has the `|| totalUsd` fallback that fabricates a USD tender for KHR-only sales',
  )
})

check('round2 has exactly one definition in the codebase path under test', () => {
  assert.ok(!/^function round2/m.test(salesSrc), 'sales.ts should import round2, not redeclare it')
  assert.ok(/round2 \} from '\.\.\/lib\/saleTotals'|computeSaleTotals, round2 \}/.test(salesSrc), 'sales.ts should import round2 from lib/saleTotals')
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
