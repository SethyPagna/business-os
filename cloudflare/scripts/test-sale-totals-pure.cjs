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

// ---- Part 539/534: KHR change converts at the dedicated change rate ----
// Live probe that motivated this: POS displayed 8,820 riel of change at a
// configured change rate of 4000, but the stored row said 9,061 (the main
// 4100 rate) -- the books disagreed with what the cashier handed over.
const { resolveChangeExchangeRate } = require(path.join(tmpDir, 'saleTotals.js'))

check('changeKhr uses the configured change rate; payment still converts at the main rate', () => {
  // $9.99 total, 50,000 riel tendered at main 4100: exact overpay 2.2051...,
  // changeUsd stores 2.21, but the riel conversion uses the EXACT value at
  // the 4000 change rate -- 8,820, matching what POS.tsx displays. Rounding
  // to cents first would store 8,840 (a fresh 20-riel books-vs-hand gap).
  const t = computeSaleTotals({
    ...base, subtotalUsd: 9.99, exchangeRate: 4100, changeExchangeRate: '4000',
    rawAmountPaidUsd: 0, rawAmountPaidKhr: 50000,
  })
  const exactChange = 50000 / 4100 - 9.99
  assert.equal(t.changeUsd, round2(exactChange))
  assert.equal(t.changeKhr, Math.round(exactChange * 4000), 'change must convert the EXACT overpay at 4000')
  assert.equal(t.changeKhr, 8820)
  assert.notEqual(t.changeKhr, Math.round(t.changeUsd * 4000), 'round2-first would give 8,840 -- the display mismatch this pins out')
  assert.equal(t.totalKhr, Math.round(9.99 * 4100), 'the total itself stays on the main rate')
})

check('blank/absent/zero change rate falls back to the main rate (pre-534 behavior)', () => {
  const exactChange = 50000 / 4100 - 9.99
  for (const raw of ['', undefined, null, '0', '-5', 'abc']) {
    const t = computeSaleTotals({
      ...base, subtotalUsd: 9.99, exchangeRate: 4100, changeExchangeRate: raw,
      rawAmountPaidUsd: 0, rawAmountPaidKhr: 50000,
    })
    // 9,041 -- the same number POS displays at the fallback rate (the old
    // round2-first server stored 9,061 for this sale).
    assert.equal(t.changeKhr, Math.round(exactChange * 4100), `raw=${String(raw)} must fall back to 4100`)
  }
  assert.equal(resolveChangeExchangeRate('4000', 4100), 4000)
  assert.equal(resolveChangeExchangeRate(' ', 4100), 4100)
})

check('routes/sales.ts feeds the change rate to BOTH write paths (create + deferred-payment settle)', () => {
  assert.ok(/changeExchangeRate: changeExchangeRateSetting/.test(salesSrc), 'POST / must pass the setting into computeSaleTotals')
  assert.ok(/Math\.round\(overpayExactUsd \* resolveChangeExchangeRate\(changeRateRow\?\.value, rate\)\)/.test(salesSrc), 'PATCH /:id/status must convert the EXACT overpay at the change rate')
  assert.ok(!/updateParams\.change_khr = Math\.round\(overpayUsd \* rate\)/.test(salesSrc), 'the main-rate-only overpay conversion must be gone')
})

// Frontend parity: the server twin must stay byte-identical in behavior to
// posCore.ts's resolveChangeExchangeRate (hand-synced pair).
check('resolveChangeExchangeRate matches the frontend twin line for line', () => {
  const frontendSrc = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'components', 'pos', 'posCore.ts'), 'utf8')
  const bodyRe = /const parsed = parseFloat\(String\(rawSetting \?\? ''\)\.trim\(\)\)\s*\n\s*return Number\.isFinite\(parsed\) && parsed > 0 \? parsed : mainRate/
  const backendSrc = fs.readFileSync(srcPath, 'utf8')
  assert.ok(bodyRe.test(frontendSrc), 'frontend resolveChangeExchangeRate body changed -- re-sync the pair')
  assert.ok(bodyRe.test(backendSrc), 'backend resolveChangeExchangeRate body changed -- re-sync the pair')
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
