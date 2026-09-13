// WRONG CALCULATIONS gate (owner instruction, Sep 14 2026).
//
// Every other money test in this directory pins a HAND-PICKED case: the basket
// someone already found broken. This one attacks the opposite risk -- an
// arithmetic defect nobody has met yet -- by generating thousands of baskets
// from a seeded PRNG and asserting the invariants that must hold for all of
// them. It drives the shipped kernels (lib/moneyPrecision, lib/saleTotals,
// lib/saleMoneyPrecision, lib/refundMoneyPrecision, lib/saleItemPricing,
// lib/customerReturnEntitlement, lib/saleLineAddition) transpiled from source
// exactly the way test-payment-fx-pure.cjs mounts routes/sales.ts, so a change
// to any of those files is what turns this red.
//
// THE ORACLE IS INDEPENDENT. Checking a kernel against itself proves nothing,
// so every generated amount is also carried as an exact BigInt at the
// four-decimal scale and the expected total/rounding/KHR conversion is
// recomputed here with integer arithmetic (see `Exact` below). The kernels and
// the oracle are two implementations that must agree.
//
// WHAT IS ASSERTED, PER GENERATED CASE:
//   * a header total is never negative, and the v1 kernel REFUSES an
//     over-discounted basket instead of recording one (the v0 path does not --
//     that difference is pinned as its own case, not smoothed over);
//   * lines + tax + customer-billed delivery - discounts == the header's
//     calculated total, exactly, with one rounding at the end;
//   * total_khr is the sale's USD total converted at the sale's rate, NOT
//     stepped to 100 riel -- see the KHR note on the totals phase;
//   * four-place and cent rounding are idempotent and order-independent;
//   * change is never negative and converts the EXACT surplus at the change
//     rate, never the cent-rounded change;
//   * a refund never exceeds its line's net entitlement and the active cohort
//     never exceeds the sale's payout cap, including after a cohort member is
//     cancelled;
//   * everything is deterministic: the same input twice, and a quote
//     re-evaluated from its own persisted snapshot, reproduce themselves.
//
// REPLAY: the seed is printed on any failure and can be forced with
//   BOS_FUZZ_SEED=<n> node test-sale-money-invariants-fuzz-pure.cjs
// Case volume can be scaled with BOS_FUZZ_SCALE (default 1) when hunting.
//
// NOT mounted here: lib/salesAnalytics needs a live D1/better-sqlite3 dataset
// rather than generated values and is fuzzed by test-stats-non-negative-pure /
// test-sales-revenue-convergence-pure; lib/saleLineAddition is mounted only for
// recomputeSaleMoneyAfterLineChange, the part of it that is pure money.
//
// Run (from cloudflare/scripts/): node test-sale-money-invariants-fuzz-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const cache = new Map()
// Same discipline as test-payment-fx-pure.cjs: modules named here load for
// REAL; anything else resolves to an empty stub. Every money kernel under test
// is real, so no stub can quietly answer for arithmetic.
const actual = new Set([
  'moneyPrecision', 'saleMoneyPrecision', 'refundMoneyPrecision', 'financialPrecision',
  'saleTotals', 'saleItemPricing', 'promotionRules', 'customerReturnEntitlement',
  'saleLineAddition', 'salesStatus', 'saleTransitions', 'nativeSaleChange',
])
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  const sourcePath = path.join(root, 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
  }).outputText
  const req = (name) => {
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const money = load('lib/moneyPrecision.ts')
const saleMoney = load('lib/saleMoneyPrecision.ts')
const refundMoney = load('lib/refundMoneyPrecision.ts')
const totals = load('lib/saleTotals.ts')
const pricing = load('lib/saleItemPricing.ts')
const entitlement = load('lib/customerReturnEntitlement.ts')
const lineAddition = load('lib/saleLineAddition.ts')
const nativeChange = load('lib/nativeSaleChange.ts')

// ---------------------------------------------------------------------------
// Seeded PRNG. mulberry32: tiny, deterministic, and identical on every
// platform, so a failing seed reported from CI replays here byte for byte.
// ---------------------------------------------------------------------------
const SEED = Number(process.env.BOS_FUZZ_SEED || 20260914) >>> 0
const SCALE = Math.max(0.05, Number(process.env.BOS_FUZZ_SCALE || 1))
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rng = mulberry32(SEED)
const int = (min, max) => min + Math.floor(rng() * (max - min + 1))
const pick = (values) => values[int(0, values.length - 1)]
/** A decimal with 0..places fractional digits, as a NUMBER (what routes get).
 * `+ 0` normalizes the negative zero Math.round produces for small negative
 * draws: -0 as an INPUT is its own boundary case (see below), not something
 * every generated amount should silently carry. */
const decimal = (min, max, places) => {
  const factor = 10 ** places
  return Math.round((min + rng() * (max - min)) * factor) / factor + 0
}

// ---------------------------------------------------------------------------
// The independent oracle: exact arithmetic at the four-decimal scale using
// BigInt, with no call into any kernel. Generated inputs are constructed with
// at most four decimals, so `units()` is lossless for them.
// ---------------------------------------------------------------------------
const Exact = {
  units(value) {
    const text = typeof value === 'string' ? value : String(value)
    assert.ok(/^-?\d+(\.\d{1,4})?$/.test(text), `oracle got a value it cannot represent exactly: ${text}`)
    const negative = text.startsWith('-')
    const [whole, fraction = ''] = text.replace('-', '').split('.')
    const scaled = BigInt(whole) * 10000n + BigInt((fraction + '0000').slice(0, 4))
    return negative ? -scaled : scaled
  },
  /** Nearest, ties away from zero -- the rule moneyPrecision.units() implements. */
  divideRound(top, bottom) {
    const negative = (top < 0n) !== (bottom < 0n)
    const a = top < 0n ? -top : top
    const b = bottom < 0n ? -bottom : bottom
    let q = a / b
    if ((a % b) * 2n >= b) q += 1n
    return negative ? -q : q
  },
  toNumber(units4) { return Number(units4) / 10000 },
  /** Round four-decimal units to whole cents, returned at the 4dp scale. */
  toCents(units4) { return Exact.divideRound(units4, 100n) * 100n },
}

// ---------------------------------------------------------------------------
// Harness. Neighbouring scripts print PASS/FAIL per case; a fuzz run prints
// one line per PHASE and, on failure, the seed plus the exact case that broke
// so it can be replayed.
// ---------------------------------------------------------------------------
let failures = 0
function phase(name, count, body) {
  const started = Date.now()
  const problems = []
  for (let index = 0; index < count; index++) {
    try { body(index) } catch (error) {
      if (problems.length < 3) problems.push(`  case ${index}: ${String(error && error.message || error).split('\n').slice(0, 6).join('\n  ')}`)
      if (problems.length >= 3) { problems.push(`  ... stopped after 3 of an unknown number of failures`); break }
    }
  }
  const ms = Date.now() - started
  if (problems.length) {
    failures++
    console.log(`FAIL ${name} (${count} cases, ${ms}ms) -- replay with BOS_FUZZ_SEED=${SEED}`)
    console.log(problems.join('\n'))
  } else {
    console.log(`PASS ${name} (${count} cases, ${ms}ms)`)
  }
}
function single(name, body) {
  try { body(); console.log(`PASS ${name}`) } catch (error) {
    failures++
    console.log(`FAIL ${name}`)
    console.log(String(error && error.message || error).split('\n').map(l => `     ${l}`).join('\n'))
  }
}
const n = (count) => Math.max(1, Math.round(count * SCALE))

// ===========================================================================
// PHASE 1 -- the money kernel's own algebra.
// ===========================================================================
phase('money kernel: rounding is idempotent, addition is exact and reversible', n(4000), () => {
  const places = int(0, 4)
  const a = decimal(-500, 5000, places)
  const b = decimal(0, 5000, int(0, 4))
  const rounded4 = money.roundMoney4(a)
  assert.equal(money.roundMoney4(rounded4), rounded4, 'roundMoney4 is not idempotent')
  const rounded2 = money.roundMoney2(a)
  assert.equal(money.roundMoney2(rounded2), rounded2, 'roundMoney2 is not idempotent')
  // Inputs carry at most four decimals, so rounding cannot move them.
  assert.equal(rounded4, a, 'a four-decimal input did not survive roundMoney4 unchanged')
  assert.equal(money.addMoney4(a, b), money.addMoney4(b, a), 'addMoney4 is not commutative')
  assert.equal(Exact.units(money.addMoney4(a, b)), Exact.units(a) + Exact.units(b), 'addMoney4 disagrees with exact integer addition')
  assert.equal(money.subtractMoney4(money.addMoney4(a, b), b), a, 'add then subtract did not return the original amount')
  assert.equal(Exact.units(money.roundMoney2(a)), Exact.toCents(Exact.units(a)), 'roundMoney2 is not nearest-cent, ties away from zero')
})

single('the money kernel canonicalizes negative zero and rejects the shapes that are not money', () => {
  // -0 arrives from float arithmetic (Math.round of a small negative) and from
  // clients; the kernel must hand back a plain 0, since a stored -0 is the
  // artifact the legacy-total case below documents.
  assert.equal(Object.is(money.roundMoney4(-0), 0), true)
  assert.equal(Object.is(money.roundMoney4('-0'), 0), true)
  assert.equal(Object.is(money.roundMoney2(-0), 0), true)
  assert.equal(money.sumMoney4([-0, 0, -0]), 0)
  // Blank, currency-formatted, boolean and non-finite inputs are NOT zero: a
  // kernel that coerces them is how a missing field becomes a free item.
  for (const bad of ['', '   ', '$1.00', '1,000', true, false, null, undefined, NaN, Infinity, '1.2.3', {}]) {
    assert.throws(() => money.roundMoney4(bad), /invalid_decimal/, `roundMoney4 accepted ${JSON.stringify(bad)}`)
  }
  // ... but the explicitly nullable boundary keeps "unknown" as null.
  assert.equal(money.nullableMoney4(null), null)
  assert.equal(money.nullableMoney4(''), null)
  assert.equal(money.nullableMoney4('12.3456'), 12.3456)
  // A numeric string from a CSV is money; its decimal text is the truth.
  assert.equal(money.roundMoney4('0.00005'), 0.0001)
  assert.equal(money.roundMoney4('-0.00005'), -0.0001, 'ties must round away from zero on both signs')
  assert.equal(money.divideMoney4(1, 3), 0.3333)
  assert.throws(() => money.divideMoney4(1, 0), /division_by_zero/)
})

phase('money kernel: sums are order-independent and multiplication is exact', n(2000), () => {
  const values = Array.from({ length: int(1, 12) }, () => decimal(0, 900, int(0, 4)))
  const forward = money.sumMoney4(values)
  const reversed = money.sumMoney4([...values].reverse())
  const shuffled = [...values].sort(() => (rng() < 0.5 ? -1 : 1))
  assert.equal(forward, reversed, 'sumMoney4 depends on term order')
  assert.equal(forward, money.sumMoney4(shuffled), 'sumMoney4 depends on term order')
  assert.equal(Exact.units(forward), values.reduce((sum, value) => sum + Exact.units(value), 0n), 'sumMoney4 disagrees with exact integer summation')
  // Quantity/rate keeps its own precision; only the product is rounded, once.
  const amount = decimal(0, 500, int(0, 4))
  const quantity = pick([1, 2, 3, 0.25, 0.5, 1.5, 2.75])
  const product = money.multiplyMoney4(amount, quantity)
  const oracle = Exact.divideRound(Exact.units(amount) * Exact.units(quantity), 10000n)
  assert.equal(Exact.units(product), oracle, `multiplyMoney4(${amount}, ${quantity}) disagrees with the exact product`)
  assert.ok(product >= 0, 'a nonnegative amount times a positive quantity produced a negative')
})

phase('money kernel: the selling-price ceiling never rounds a price DOWN', n(1000), () => {
  const raw = decimal(0, 400, int(0, 4))
  const ceiled = money.sellingPriceCeilCent(raw)
  assert.ok(ceiled >= raw, `sellingPriceCeilCent(${raw}) = ${ceiled} is below the input`)
  assert.ok(ceiled - raw < 0.01, 'the ceiling moved the price by a whole cent or more')
  assert.equal(money.sellingPriceCeilCent(ceiled), ceiled, 'the selling-price ceiling is not idempotent')
  assert.equal(money.roundMoney2(ceiled), ceiled, 'the selling-price ceiling did not produce whole cents')
})

phase('money kernel: settlement splits a total into payable cents plus a signed residue', n(2000), () => {
  const raw = decimal(0, 9000, 4)
  const split = money.settlementRounding4(raw)
  assert.equal(split.internalTotal4, money.roundMoney4(raw))
  assert.equal(money.roundMoney2(split.payableTotal2), split.payableTotal2, 'the payable total is not whole cents')
  assert.ok(Math.abs(split.roundingAdjustment4) <= 0.005, `residue ${split.roundingAdjustment4} exceeds half a cent`)
  // The equation must close EXACTLY, not within a tolerance: this is the line
  // that keeps a rounding residue from becoming a silent shortfall.
  assert.equal(money.subtractDecimalSum(split.payableTotal2, [split.internalTotal4, split.roundingAdjustment4]), '0')
  assert.equal(Exact.units(split.payableTotal2), Exact.toCents(Exact.units(split.internalTotal4)))
})

// ===========================================================================
// PHASE 2 -- whole baskets through computeSaleTotals, v1 (captured) and v0
// (legacy). This is the surface where a delivery fee once failed to reach the
// recorded total, so delivery/tax/discount combinations are generated together
// rather than one at a time.
//
// KHR NOTE: the project's 100-riel rule is a PHYSICAL counter rule, not a
// ledger rule. lib/financialPrecision.ts states it explicitly ("Physical
// 100-riel counter rounding is a separate workflow rule and does not belong in
// this module") and the step constant lives on lib/nativeSaleChange.ts
// (NATIVE_CHANGE_KHR_STEP) where the change actually handed back is planned.
// So the assertion below is that total_khr is the EXACT conversion of the USD
// total at the sale's rate -- and, separately, that the 100-riel step is still
// 100 and still lives on the change kernel. A sale total quietly snapped to
// 100 riel would be a wrong calculation, not a courtesy.
// ===========================================================================
function basket(version) {
  const lineCount = int(1, 12)
  const lines = []
  for (let index = 0; index < lineCount; index++) {
    const quantity = pick([1, 1, 2, 3, 5, 0.25, 0.5, 1.5, 2.5, 12])
    const unit = decimal(0.01, 250, version === 1 ? int(1, 4) : int(1, 2))
    lines.push({ quantity, unit, total: money.multiplyMoney4(unit, quantity) })
  }
  const subtotal = money.sumMoney4(lines.map(line => line.total))
  // Discounts are bounded by the basket on purpose: an over-discounted basket
  // is its own named case below, not noise mixed into the totals invariants.
  const discount = rng() < 0.35 ? Math.min(subtotal, decimal(0, subtotal, int(0, 4))) : 0
  const membership = rng() < 0.25 ? Math.min(money.subtractMoney4(subtotal, discount), decimal(0, 20, int(0, 4))) : 0
  const tax = rng() < 0.3 ? decimal(0, 12, int(0, 4)) : 0
  const isDelivery = rng() < 0.4
  const deliveryFee = isDelivery ? decimal(0, 8, int(0, 2)) : 0
  const deliveryFeePaidBy = isDelivery ? pick(['customer', 'store', 'shop', '']) : 'customer'
  const exchangeRate = pick([3900, 4000, 4050, 4100, 4137.5, 4150, 4200, 3987.5])
  return { lines, subtotal, discount, membership, tax, isDelivery, deliveryFee, deliveryFeePaidBy, exchangeRate }
}

function tender(rng2, totalGuess) {
  const mode = pick(['absent', 'null', 'blank', 'zero', 'exact', 'over', 'khr-only', 'mixed'])
  if (mode === 'absent') return { usd: undefined, khr: undefined }
  if (mode === 'null') return { usd: null, khr: null }
  if (mode === 'blank') return { usd: '', khr: '' }
  if (mode === 'zero') return { usd: 0, khr: 0 }
  if (mode === 'exact') return { usd: money.roundMoney2(totalGuess), khr: 0 }
  if (mode === 'over') return { usd: money.roundMoney2(totalGuess + decimal(0.01, 20, 2)), khr: 0 }
  if (mode === 'khr-only') return { usd: 0, khr: Math.round(totalGuess * 4200) + int(0, 5000) }
  return { usd: money.roundMoney2(totalGuess / 2), khr: int(0, 40000) }
}

phase('v1 baskets: the header total is the exact basket equation, rounded once', n(1500), () => {
  const spec = basket(1)
  const billedDelivery = spec.isDelivery && spec.deliveryFeePaidBy === 'customer' ? spec.deliveryFee : 0
  const paid = tender(rng, spec.subtotal)
  const input = {
    moneyPrecisionVersion: 1,
    subtotalUsd: spec.subtotal, discountUsd: spec.discount, membershipDiscountUsd: spec.membership,
    taxUsd: spec.tax, isDelivery: spec.isDelivery, deliveryFeeUsd: spec.deliveryFee,
    deliveryFeePaidBy: spec.deliveryFeePaidBy, exchangeRate: spec.exchangeRate,
    changeExchangeRate: pick(['', null, '4000', 4100, '0', 'not-a-rate']),
    rawAmountPaidUsd: paid.usd, rawAmountPaidKhr: paid.khr,
  }
  const result = totals.computeSaleTotals(input)

  const oracleCalculated = Exact.units(spec.subtotal) - Exact.units(spec.discount)
    - Exact.units(spec.membership) + Exact.units(spec.tax) + Exact.units(billedDelivery)
  assert.ok(oracleCalculated >= 0n, 'oracle built a negative basket; the generator, not the kernel, is wrong')
  assert.equal(Exact.units(result.calculatedTotalUsd), oracleCalculated,
    `calculated total ${result.calculatedTotalUsd} != exact basket ${Exact.toNumber(oracleCalculated)}`)
  assert.equal(Exact.units(result.totalUsd), Exact.toCents(oracleCalculated), 'the payable total is not the calculated total rounded to cents')
  assert.equal(Exact.units(result.totalUsd) - Exact.units(result.calculatedTotalUsd), Exact.units(result.roundingAdjustmentUsd),
    'calculated + adjustment does not equal the payable total')
  assert.ok(result.totalUsd >= 0, `negative header total ${result.totalUsd}`)
  assert.ok(result.customerDeliveryFeeUsd >= 0 && result.customerDeliveryFeeUsd === billedDelivery,
    'a store-absorbed delivery fee reached the customer bill (or a customer-paid one did not)')

  // KHR: exact conversion of the PAYABLE total at the sale's rate.
  assert.equal(Exact.units(result.totalKhr),
    Exact.divideRound(Exact.units(result.totalUsd) * Exact.units(spec.exchangeRate), 10000n),
    `total_khr ${result.totalKhr} is not total_usd ${result.totalUsd} converted at ${spec.exchangeRate}`)

  assert.ok(result.changeUsd >= 0 && result.changeKhr >= 0, `negative change ${result.changeUsd}/${result.changeKhr}`)
  assert.ok(result.amountPaidUsd >= 0 && result.amountPaidKhr >= 0, 'negative tender was recorded')
  if (paid.usd === 0 && paid.khr === 0) {
    // The bug this kernel was extracted for: a genuinely tendered 0 must not
    // be read as "the client sent nothing" and replaced with the total.
    assert.equal(result.amountPaidUsd, 0, 'a tendered 0 USD was replaced by the total')
    assert.equal(result.changeUsd, 0, 'change was handed back on a sale where nothing was tendered')
  }
  if (paid.usd === undefined || paid.usd === null || paid.usd === '') {
    assert.equal(result.amountPaidUsd, result.totalUsd, 'an absent tender did not fall back to the total')
  }
  // Determinism: same input, same answer.
  assert.deepEqual(totals.computeSaleTotals(input), result, 'computeSaleTotals is not deterministic')
})

phase('v0 (legacy) baskets: totals stay nonnegative, cent-clean and delivery-aware', n(1500), () => {
  const spec = basket(0)
  const billedDelivery = spec.isDelivery && String(spec.deliveryFeePaidBy || 'customer') === 'customer'
    ? totals.round2(spec.deliveryFee) : 0
  const paid = tender(rng, spec.subtotal)
  const result = totals.computeSaleTotals({
    subtotalUsd: spec.subtotal, discountUsd: spec.discount, membershipDiscountUsd: spec.membership,
    taxUsd: spec.tax, isDelivery: spec.isDelivery, deliveryFeeUsd: spec.deliveryFee,
    deliveryFeePaidBy: spec.deliveryFeePaidBy, exchangeRate: spec.exchangeRate,
    rawAmountPaidUsd: paid.usd, rawAmountPaidKhr: paid.khr,
  })
  const oracle = Exact.units(spec.subtotal) - Exact.units(spec.discount) - Exact.units(spec.membership)
    + Exact.units(spec.tax) + Exact.units(billedDelivery)
  assert.ok(result.totalUsd >= 0, `negative legacy total ${result.totalUsd}`)
  // `+ 0` normalizes NEGATIVE ZERO, which the legacy path really can produce --
  // see the named case below. Object.is(-0, 0) is false, so without this the
  // whole phase would fail on an artifact that has its own dedicated case.
  assert.equal(totals.round2(result.totalUsd), result.totalUsd + 0, 'the legacy total is not whole cents')
  // v0 rounds with round2() over float arithmetic; it must still land on the
  // nearest cent to the exact basket -- half a cent at most, compared in
  // integer units because the float difference at an exact tie (x.xx5) reads
  // as 0.005000000000109 and would fail a naive `<= 0.005`.
  const drift = Exact.units(result.totalUsd) - oracle
  assert.ok((drift < 0n ? -drift : drift) <= 50n,
    `legacy total ${result.totalUsd} is more than half a cent from the exact basket ${Exact.toNumber(oracle)}`)
  assert.equal(result.totalKhr, Math.round(result.totalUsd * spec.exchangeRate), 'legacy total_khr is not the converted total')
  assert.equal(result.customerDeliveryFeeUsd, billedDelivery, 'legacy delivery billing disagrees with the shared rule')

  // CHANGE, v0 vs v1 -- a real difference, pinned rather than papered over.
  // The legacy path records change as a signed difference, so an UNDERPAID
  // (credit) sale stores a NEGATIVE change_usd; the v1 kernel
  // (nativeChangeAmounts) reports zero change and no overpayment instead.
  // Both are asserted so neither can quietly adopt the other's behaviour.
  const surplusTop = (Exact.units(result.amountPaidUsd) - Exact.units(result.totalUsd)) * Exact.units(spec.exchangeRate)
    + Exact.units(result.amountPaidKhr) * 10000n
  if (surplusTop > 0n) assert.ok(result.changeUsd >= 0, `overpaid sale recorded negative change ${result.changeUsd}`)
  if (surplusTop < 0n) assert.ok(result.changeUsd <= 0, `underpaid sale recorded positive change ${result.changeUsd}`)
  const v1 = totals.computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: money.roundMoney4(result.totalUsd), discountUsd: 0, membershipDiscountUsd: 0,
    taxUsd: 0, isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: spec.exchangeRate,
    rawAmountPaidUsd: result.amountPaidUsd, rawAmountPaidKhr: result.amountPaidKhr,
  })
  assert.ok(v1.changeUsd >= 0 && v1.changeKhr >= 0, `v1 handed back negative change ${v1.changeUsd}/${v1.changeKhr}`)
  if (surplusTop <= 0n) assert.equal(v1.changeUsd, 0, 'v1 invented change on an underpaid sale')
})

single('an over-discounted basket: v1 refuses it, v0 records it (documented difference)', () => {
  const over = {
    subtotalUsd: 10, discountUsd: 12, membershipDiscountUsd: 0, taxUsd: 0,
    isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer',
    exchangeRate: 4100, rawAmountPaidUsd: 0, rawAmountPaidKhr: 0,
  }
  // v1 is the path every new sale takes: a basket that foots below zero is a
  // refusal, never a recorded negative.
  assert.throws(() => totals.computeSaleTotals({ ...over, moneyPrecisionVersion: 1 }),
    /money_precision_negative_total/, 'the v1 kernel accepted an over-discounted basket')
  // v0 is the historical storage shape and has no such guard. This is pinned so
  // that if the legacy path is ever hardened the change is a deliberate edit to
  // this case rather than an unnoticed behaviour swap.
  assert.equal(totals.computeSaleTotals(over).totalUsd, -2)
})

single('a legacy basket discounted to exactly zero records NEGATIVE ZERO (found by fuzzing, seed 20260914 case 1108)', () => {
  // 45.675 - 39.087 - 6.588 is -7.1e-15 in binary floating point, and
  // round2()'s Math.round then returns -0, so sales.total_usd/total_khr can be
  // stored as -0 by the v0 path. It compares equal to 0 with ==, serializes as
  // "0" in JSON, and is invisible to every existing test -- but Object.is
  // distinguishes it and a formatter that checks `value < 0` or prints the sign
  // can render "-$0.00", which the owner's "never show a negative total" rule
  // forbids. Pinned as the CURRENT behaviour, not endorsed: reported to the
  // coordinator on 2026-09-14. If the legacy path is ever normalized (e.g.
  // `total || 0`), invert this case to assert Object.is(totalUsd, -0) === false
  // and say so here.
  const legacy = totals.computeSaleTotals({
    subtotalUsd: 45.675, discountUsd: 39.087, membershipDiscountUsd: 6.588, taxUsd: 0,
    isDelivery: true, deliveryFeeUsd: 6, deliveryFeePaidBy: 'store', exchangeRate: 4100,
    rawAmountPaidUsd: '', rawAmountPaidKhr: '',
  })
  assert.equal(Object.is(legacy.totalUsd, -0), true, 'the -0 artifact is gone; invert this case and record the change')
  // `===` (not assert.equal, which is Object.is) is the point here: -0 is
  // arithmetically zero, which is exactly why nothing else notices it.
  assert.ok(legacy.totalUsd === 0, 'a -0 total must still compare equal to zero')
  assert.equal(JSON.stringify(legacy.totalUsd), '0', 'a -0 total must still serialize as 0')
  // The v1 kernel cannot produce it: the same basket is a refusal there, and a
  // basket that foots to exactly zero yields a clean +0.
  assert.throws(() => totals.computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: 45.675, discountUsd: 39.087, membershipDiscountUsd: 6.5881, taxUsd: 0,
    isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: 4100,
    rawAmountPaidUsd: 0, rawAmountPaidKhr: 0,
  }), /money_precision_negative_total/)
  const exactZero = totals.computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: 45.675, discountUsd: 39.087, membershipDiscountUsd: 6.588, taxUsd: 0,
    isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: 4100,
    rawAmountPaidUsd: 0, rawAmountPaidKhr: 0,
  })
  assert.equal(Object.is(exactZero.totalUsd, -0), false, 'the v1 path produced a negative zero')
})

single('a basket discounted to nothing cannot carry tax: the allocator refuses, it does not invent a weight', () => {
  // Found by fuzzing (seed 20260914, case 129). allocateReceiptLines spreads
  // discount/membership/tax across lines in proportion to their value; when
  // every line is worth 0 there is no proportion to spread by, so a nonzero
  // amount to allocate is refused rather than dropped onto an arbitrary line.
  // The generator above therefore stops generating tax on a zero-value basket,
  // and this case keeps the refusal itself under test.
  assert.throws(() => pricing.allocateReceiptLines({
    version: 1, lines: [{ line_key: 'a', amount: 0 }, { line_key: 'b', amount: 0 }],
    discount_usd: 0, membership_discount_usd: 0, tax_usd: 0.5,
  }), /Captured item pricing needs review/)
  // ... while a zero basket with nothing to allocate is perfectly fine.
  const empty = pricing.allocateReceiptLines({
    version: 1, lines: [{ line_key: 'a', amount: 0 }], discount_usd: 0, membership_discount_usd: 0, tax_usd: 0,
  })
  assert.equal(empty.get('a').net_entitlement_usd, 0)
})

single('the odd cent goes to the largest remainder, and equal remainders are broken by line key', () => {
  // A discount that does not divide evenly leaves a unit over, and WHICH line
  // gets it is a decision, not an accident: allocateLineMoney4 is a largest-
  // remainder allocation. Every weaker invariant -- the parts still sum to the
  // whole, no part is negative, each part is within one tick of its exact share
  // -- stays true if the leftover is handed to the SMALLEST remainder instead,
  // so the fuzz phases cannot see that flip. These two fixed baskets can: they
  // were added on 2026-09-14 after mutating the sort direction left the whole
  // suite green.
  const uneven = pricing.allocateLineMoney4(1, [{ line_key: 'a', amount: 1 }, { line_key: 'b', amount: 2 }])
  // Exact shares are 0.33333... and 0.66666...; b holds the larger remainder.
  assert.equal(uneven.get('a'), 0.3333, 'the smaller line was given the odd unit')
  assert.equal(uneven.get('b'), 0.6667, 'the largest remainder did not receive the odd unit')
  assert.equal(money.sumMoney4([uneven.get('a'), uneven.get('b')]), 1, 'the allocation does not add back up')

  // Three equal lines: the remainders tie, so the tie-break is the line KEY and
  // not the order the lines happened to arrive in. Input order is deliberately
  // reversed here; a tie-break that followed input order would answer 'z'.
  const tied = pricing.allocateLineMoney4(0.01, [{ line_key: 'z', amount: 1 }, { line_key: 'y', amount: 1 }, { line_key: 'x', amount: 1 }])
  assert.deepEqual([...tied].sort((left, right) => left[0] < right[0] ? -1 : 1),
    [['x', 0.0034], ['y', 0.0033], ['z', 0.0033]], 'tied remainders were not broken by line key')
  assert.equal(money.sumMoney4([...tied.values()]), 0.01, 'the tied allocation does not add back up')
})

single('the 100-riel step is a CHANGE rule, not a sale-total rule', () => {
  // Owner rule: KHR change is handed over in 100-riel increments. That step
  // belongs to the physical change plan; a sale's total_khr is the exact
  // conversion. Both halves are asserted so neither can drift into the other.
  assert.equal(nativeChange.NATIVE_CHANGE_KHR_STEP, 100)
  const exactConversion = totals.computeSaleTotals({
    moneyPrecisionVersion: 1, subtotalUsd: 3.33, discountUsd: 0, membershipDiscountUsd: 0, taxUsd: 0,
    isDelivery: false, deliveryFeeUsd: 0, deliveryFeePaidBy: 'customer', exchangeRate: 4137.5,
    rawAmountPaidUsd: 3.33, rawAmountPaidKhr: 0,
  })
  assert.equal(exactConversion.totalKhr, money.multiplyMoney4(3.33, 4137.5))
  assert.notEqual(exactConversion.totalKhr % 100, 0, 'this case stopped discriminating: pick a total that is not a round 100 riel')
})

phase('native change: the exact surplus converts, never the cent-rounded change', n(1500), () => {
  const payable = decimal(0, 400, 2)
  const paidUsd = decimal(0, 500, 2)
  const paidKhr = int(0, 400000)
  const rate = pick([3900, 4000, 4100, 4137.5, 4200])
  const changeRate = pick([3900, 4000, 4100, 4200])
  const result = money.nativeChangeAmounts({ paidUsd, paidKhr, payableUsd: payable, exchangeRate: rate, changeExchangeRate: changeRate })
  // Exact surplus as a rational: paidUsd + paidKhr/rate - payable, which at the
  // four-decimal integer scale is surplusTop / surplusBottom with
  //   surplusTop    = (u(paidUsd) - u(payable)) * u(rate) + 10000 * u(paidKhr)
  //   surplusBottom = 10000 * u(rate)
  const rateUnits = Exact.units(rate)
  const surplusTop = (Exact.units(paidUsd) - Exact.units(payable)) * rateUnits + Exact.units(paidKhr) * 10000n
  const surplusBottom = 10000n * rateUnits
  assert.equal(result.hasOverpayment, surplusTop > 0n, 'overpayment was reported for the wrong sign of surplus')
  assert.ok(result.changeUsd >= 0 && result.changeKhr >= 0, 'negative change')
  if (surplusTop <= 0n) {
    assert.equal(result.changeUsd, 0)
    assert.equal(result.changeKhr, 0)
    return
  }
  assert.equal(Exact.units(result.changeUsd), Exact.divideRound(surplusTop * 100n, surplusBottom) * 100n,
    'changeUsd is not the exact surplus rounded to cents')
  // The whole point of this assertion: converting the CENT-ROUNDED change
  // instead of the exact surplus shifts whole tens of riel (2.2051 * 4000 =
  // 8,820 vs 2.21 * 4000 = 8,840), so the oracle converts the surplus itself.
  const khrOracle = Exact.divideRound(surplusTop * Exact.units(changeRate), surplusBottom * 10000n)
  assert.equal(result.changeKhr, Number(khrOracle), 'changeKhr was derived from the rounded USD change instead of the exact surplus')
})

// ===========================================================================
// PHASE 3 -- the persisted money snapshot. A snapshot that validates itself is
// what later returns, reports and amendments are all quoted from.
// ===========================================================================
phase('sale money snapshots: build, validate, and refuse a tampered equation', n(1500), () => {
  const raw = decimal(0, 5000, 4)
  const built = saleMoney.buildSaleMoneyPrecision(raw)
  assert.equal(built.money_precision_version, 1)
  assert.ok(built.total_usd >= 0 && built.calculated_total_usd >= 0, 'a nonnegative basket produced a negative snapshot')
  assert.deepEqual(saleMoney.validateSaleMoneySnapshot({ ...built }), { ...built }, 'a freshly built snapshot failed its own validator')
  assert.equal(saleMoney.hasRecordedSaleMoneyPrecision({ ...built }), true)
  assert.deepEqual(saleMoney.buildSaleMoneyPrecision(raw), built, 'buildSaleMoneyPrecision is not deterministic')
  // Tamper: move the payable by one cent and the equation must refuse. Without
  // this the whole phase would pass against a validator that returns its input.
  assert.throws(() => saleMoney.validateSaleMoneySnapshot({ ...built, total_usd: money.roundMoney2(built.total_usd + 0.01) }),
    /money_precision_invalid_equation/, 'a tampered payable total validated')
  // A legacy (v0) row carries no calculated total at all; claiming one is a
  // shape error, not a value error.
  assert.throws(() => saleMoney.validateSaleMoneySnapshot({ calculated_total_usd: built.calculated_total_usd, rounding_adjustment_usd: 0.0001, total_usd: built.total_usd }),
    /money_precision_incomplete_snapshot|money_precision_invalid_legacy_shape/)
})

phase('sale children: a basket is canonical as a whole or not at all', n(400), () => {
  const rate = 4100
  const rows = Array.from({ length: int(1, 6) }, () => {
    const unit = decimal(0.01, 90, int(1, 4))
    const quantity = pick([1, 2, 0.5, 3])
    const total = money.multiplyMoney4(unit, quantity)
    return {
      quantity, applied_price_usd: unit, applied_price_khr: money.multiplyMoney4(unit, rate),
      cost_price_usd: null, cost_price_khr: null, total_usd: total, total_khr: money.multiplyMoney4(total, rate),
      product_discount_usd: 0, product_discount_khr: 0, base_price_usd: unit, base_price_khr: money.multiplyMoney4(unit, rate),
      manual_discount_usd: 0, manual_discount_khr: 0,
    }
  })
  totals.assertCanonicalSaleChildren(rows)
  // One line with a missing amount must condemn the WHOLE basket: a v1 parent
  // over a partially-canonical child set is the shape that lets unreviewed
  // historical money masquerade as captured money.
  const broken = rows.map((row, index) => (index === 0 ? { ...row, total_usd: null } : row))
  assert.throws(() => totals.assertCanonicalSaleChildren(broken), /money_precision_basket_review_needed/)
  assert.throws(() => totals.assertCanonicalSaleChildren([]), /money_precision_basket_review_needed/)
})

// ===========================================================================
// PHASE 4 -- refund cohorts. Every payout settles in cents while entitlement is
// tracked at four places, so the cumulative chain is where a cent can be minted
// or lost.
// ===========================================================================
phase('refund cohorts: cumulative payouts never exceed the cap and never mint a cent', n(1200), () => {
  const cap = money.roundMoney2(decimal(1, 600, 2))
  const previous = []
  let paid = 0
  let rawTotal = 0
  const steps = int(1, 5)
  for (let step = 0; step < steps; step++) {
    const eligible = decimal(0, cap / 2, 4)
    let built
    try { built = refundMoney.buildRefundMoneyPrecision({ eligibleRaw: eligible, originalPayable: cap, previous }) } catch (error) {
      // The only permitted refusal is the cap itself, and only when the chain
      // really does exceed it. A cap error on a chain still under the cap would
      // be a wrong calculation refusing correct money.
      assert.match(String(error.message), /money_precision_refund_cap_exceeded/, `unexpected refund failure: ${error.message}`)
      assert.ok(money.roundMoney2(money.sumMoney4([rawTotal, eligible])) > cap,
        `refund refused at ${money.sumMoney4([rawTotal, eligible])} while the cap is ${cap}`)
      break
    }
    rawTotal = money.sumMoney4([rawTotal, built.calculated_refund_usd])
    paid = money.sumMoney4([paid, built.total_refund_usd])
    previous.push(built)
    assert.ok(built.total_refund_usd >= 0, `negative payout ${built.total_refund_usd}`)
    assert.equal(money.roundMoney2(built.total_refund_usd), built.total_refund_usd, 'a payout is not whole cents')
    assert.ok(Math.abs(built.rounding_adjustment_usd) < 0.01, 'a refund residue reached a whole cent')
    assert.equal(money.subtractMoney4(built.total_refund_usd, built.calculated_refund_usd), built.rounding_adjustment_usd)
    assert.ok(paid <= cap + 1e-9, `cumulative payout ${paid} exceeded the cap ${cap}`)
    // The cumulative payout is the cent-rounding of the cumulative RAW chain,
    // not the sum of independently rounded payouts: that difference is exactly
    // how a half-cent per return turns into real money over a long chain.
    assert.equal(paid, money.roundMoney2(rawTotal), `cumulative payout ${paid} != cents of cumulative entitlement ${rawTotal}`)
    assert.deepEqual(refundMoney.validateRefundMoneySnapshot({ ...built }), { ...built })
  }
})

single('a refund chain is refused, not silently clamped, once the cap is reached', () => {
  const previous = [refundMoney.buildRefundMoneyPrecision({ eligibleRaw: 9.99, originalPayable: 10, previous: [] })]
  assert.throws(() => refundMoney.buildRefundMoneyPrecision({ eligibleRaw: 5, originalPayable: 10, previous }),
    /money_precision_refund_cap_exceeded/)
  // And the boundary itself is payable: 9.99 + 0.01 is exactly the cap.
  const last = refundMoney.buildRefundMoneyPrecision({ eligibleRaw: 0.01, originalPayable: 10, previous })
  assert.equal(money.sumMoney4([previous[0].total_refund_usd, last.total_refund_usd]), 10)
})

// ===========================================================================
// PHASE 5 -- return entitlement over REAL captured baskets: a generated sale is
// priced through lib/saleItemPricing (the same evaluator the POS write uses),
// persisted as a snapshot + sha256 digest exactly as routes/returns.ts does,
// and then returned in partial steps -- including a cohort whose earlier member
// has been cancelled.
// ===========================================================================
const sha256Hex = (text) => crypto.createHash('sha256').update(text).digest('hex')

/**
 * Build a real captured sale: price the basket through the shipped evaluator,
 * materialize each row the way the POS write does, and hash the snapshot into
 * a digest exactly as routes/returns.ts:199 does. `spec.entries` are
 * { unit, quantity, manual } in catalogue terms.
 */
function poolFor(saleId, rate, entries) {
  return {
    version: 1, pool_key: `fuzz-pool-${saleId}`, evaluation_time: '2026-09-14T01:00:00.000Z',
    exchange_rate: rate, rules: [],
    lines: entries.map((entry, index) => ({
      line_key: `fuzz-line-${index}`, source: 'selling', selling_price_input_usd: null,
      manual: entry.manual || { type: 'none', value: 0 },
      product: {
        id: index + 1, selling_price_usd: entry.unit, selling_price_khr: money.multiplyMoney4(entry.unit, rate),
        wholesale_price_usd: null, discount_enabled: false, discount_amount_usd: 0, discount_amount_khr: 0, discount_percent: 0,
      },
    })),
  }
}
const quantitiesFor = (entries) => Object.fromEntries(entries.map((entry, index) => [`fuzz-line-${index}`, entry.quantity]))

function composeSale(spec) {
  const rate = spec.rate
  const pool = poolFor(spec.saleId, rate, spec.entries)
  const lines = pool.lines
  const quantities = quantitiesFor(spec.entries)
  const amounts = pricing.evaluateCapturedPricingPool(pool, quantities)
  const subtotal = money.sumMoney4(lines.map(line => amounts.get(line.line_key).total_usd))
  const allocation = {
    version: 1, lines: lines.map(line => ({ line_key: line.line_key, amount: amounts.get(line.line_key).total_usd })),
    discount_usd: spec.discount, membership_discount_usd: spec.membership, tax_usd: spec.tax,
  }
  const saleLines = lines.map((line, index) => {
    const row = pricing.materializeCapturedPricingRow(
      { id: index + 1, sale_id: spec.saleId, product_id: line.product.id, product_name: `Fuzz ${index}` },
      pool, quantities, line.line_key, allocation,
    )
    return { ...row, pricing_snapshot_digest: sha256Hex(String(row.pricing_snapshot_json)) }
  })
  const netEntitlement = money.sumMoney4(saleLines.map(row => pricing.parseSaleItemPricing(row.pricing_snapshot_json).receipt_allocation.net_entitlement_usd))
  const calculatedTotal = money.sumMoney4([netEntitlement, spec.deliveryFee])
  return {
    sale_id: spec.saleId, id: spec.saleId, sale_revision: spec.revision, money_precision_version: 1,
    calculated_total_usd: calculatedTotal, total_usd: money.roundMoney2(calculatedTotal),
    subtotal_usd: subtotal, discount_usd: spec.discount, membership_discount_usd: spec.membership, tax_usd: spec.tax,
    exchange_rate: rate, customer_delivery_fee_usd: spec.deliveryFee, lines: saleLines,
  }
}

function capturedSale(saleId) {
  const rate = pick([3900, 4000, 4100, 4137.5, 4200])
  const entries = Array.from({ length: int(1, 6) }, () => {
    // Catalogue prices are whole cents by policy (sellingPriceCeilCent), so the
    // fractional pressure here comes from QUANTITY and from percent discounts,
    // which is where it comes from in the shop too.
    const unit = money.roundMoney2(decimal(0.5, 120, 2))
    const manualType = pick(['none', 'none', 'fixed', 'percent'])
    return {
      unit, quantity: pick([1, 1, 2, 3, 4, 0.5, 1.5, 2.5]),
      manual: manualType === 'none' ? { type: 'none', value: 0 }
        : manualType === 'fixed' ? { type: 'fixed', value: money.roundMoney4(decimal(0, unit, 2)) }
          : { type: 'percent', value: decimal(0, 100, 2) },
    }
  })
  // Price the basket once up front so the generated discount/membership/tax can
  // be bounded by what the lines are actually worth.
  const subtotal = money.sumMoney4([...pricing.evaluateCapturedPricingPool(
    poolFor(saleId, rate, entries), quantitiesFor(entries),
  ).values()].map(value => value.total_usd))
  const discount = rng() < 0.4 ? Math.min(subtotal, money.roundMoney4(decimal(0, subtotal, 2))) : 0
  const afterStore = money.subtractMoney4(subtotal, discount)
  const membership = rng() < 0.3 ? Math.min(afterStore, money.roundMoney4(decimal(0, 5, 2))) : 0
  // Tax is allocated in proportion to line value, so a basket already
  // discounted to nothing has no weights to spread it over and the allocator
  // refuses it -- see the dedicated case for that refusal.
  const afterMember = money.subtractMoney4(afterStore, membership)
  const tax = afterMember > 0 && rng() < 0.3 ? money.roundMoney4(decimal(0, 6, 2)) : 0
  const deliveryFee = rng() < 0.3 ? money.roundMoney4(decimal(0, 4, 2)) : 0
  return composeSale({ saleId, revision: int(0, 9), rate, entries, discount, membership, tax, deliveryFee })
}

const priorFromQuote = (quote, id) => ({
  id, money_precision_version: 1,
  calculated_refund_usd: quote.calculated_refund_usd, total_refund_usd: quote.total_refund_usd,
  rounding_adjustment_usd: quote.rounding_adjustment_usd,
  items: quote.items.map(item => ({
    sale_item_id: item.sale_item_id, quantity: item.quantity, total_usd: item.total_usd,
    refund_snapshot_json: item.refund_snapshot_json,
  })),
})

function auditQuote(sale, quote, previous) {
  assert.ok(quote.total_refund_usd >= 0, `negative refund ${quote.total_refund_usd}`)
  assert.equal(money.roundMoney2(quote.total_refund_usd), quote.total_refund_usd, 'a refund payout is not whole cents')
  assert.ok(quote.product_payout_cap_usd <= sale.total_usd + 1e-9, 'the payout cap exceeds the sale total')
  const cohortPaid = money.sumMoney4([...previous.map(prior => prior.total_refund_usd), quote.total_refund_usd])
  assert.ok(cohortPaid <= quote.product_payout_cap_usd + 1e-9,
    `active cohort paid ${cohortPaid} above the payout cap ${quote.product_payout_cap_usd}`)
  // Per line: what this quote plus the surviving cohort consumes can never
  // exceed what that line is actually entitled to (plus the documented
  // cancelled-member residue, and not a hundredth more).
  const byLine = new Map()
  for (const prior of previous) {
    for (const item of prior.items) {
      const snapshot = entitlement.parseCustomerReturnRefundSnapshot(item.refund_snapshot_json)
      const aggregate = byLine.get(snapshot.sale_item_id) || { quantity: 0, calculated: 0 }
      aggregate.quantity += snapshot.return_quantity
      aggregate.calculated = money.sumMoney4([aggregate.calculated, snapshot.calculated_refund_usd])
      byLine.set(snapshot.sale_item_id, aggregate)
    }
  }
  for (const item of quote.items) {
    const snapshot = entitlement.parseCustomerReturnRefundSnapshot(item.refund_snapshot_json)
    assert.ok(snapshot, 'a quote line produced a snapshot its own parser rejects')
    assert.equal(snapshot.calculated_refund_usd, item.total_usd)
    assert.equal(snapshot.calculated_refund_khr, money.multiplyMoney4(item.total_usd, sale.exchange_rate))
    const source = sale.lines.find(row => row.id === item.sale_item_id)
    const aggregate = byLine.get(item.sale_item_id) || { quantity: 0, calculated: 0 }
    const consumed = money.sumMoney4([aggregate.calculated, item.total_usd])
    assert.ok(consumed <= money.sumMoney4([snapshot.net_entitlement_usd, entitlement.CUSTOMER_RETURN_COHORT_RESIDUAL_ALLOWANCE_USD]),
      `line ${item.sale_item_id} refunded ${consumed} against a net entitlement of ${snapshot.net_entitlement_usd}`)
    assert.ok(aggregate.quantity + item.quantity <= source.quantity + 1e-9, 'more units were returned than were sold')
    // The line's own prorated target, recomputed independently of the kernel's
    // before/after bookkeeping.
    const target = entitlement.prorateCustomerReturnMoney4(snapshot.net_entitlement_usd, aggregate.quantity + item.quantity, source.quantity)
    assert.ok(consumed <= money.sumMoney4([target, entitlement.CUSTOMER_RETURN_COHORT_RESIDUAL_ALLOWANCE_USD]),
      `line ${item.sale_item_id} consumed ${consumed} above its prorated target ${target}`)
  }
}

single('after a cancellation the freed units are refunded at their own target, not at the residue the survivors hold', () => {
  // The invariants in the fuzz phase below are one-sided (nothing may exceed a
  // cap), so they cannot see a change that makes a refund SMALLER. This case
  // pins the exact figure, on a basket chosen so the arithmetic is decidable by
  // hand: one line, 3 units at $0.50 (gross $1.50) with a $0.50 receipt
  // discount, so its net entitlement is exactly $1.0000 and a third of it is
  // not representable in four places.
  //   target(1) = 0.3333   target(2) = 0.6667   target(3) = 1.0000
  // R1 returns 1 unit -> 0.3333. R2 returns 1 unit -> 0.6667 - 0.3333 = 0.3334.
  // R1 is then CANCELLED, so the active cohort is R2 alone, holding 0.3334 for
  // one unit while one unit's own target is 0.3333: the survivors carry the
  // cancelled member's rounding residue. Re-returning the freed unit must
  // consume only that unit's TARGET (0.3333), paying 0.6667 - 0.3333 = 0.3334
  // -- not 0.6667 - 0.3334 = 0.3333, which is what consuming the residue would
  // pay and is a hundredth of a cent of the customer's money per event.
  const sale = composeSale({
    saleId: 9001, revision: 3, rate: 4100,
    entries: [{ unit: 0.5, quantity: 3, manual: { type: 'none', value: 0 } }],
    discount: 0.5, membership: 0, tax: 0, deliveryFee: 0,
  })
  const saleItemId = sale.lines[0].id
  assert.equal(pricing.parseSaleItemPricing(sale.lines[0].pricing_snapshot_json).receipt_allocation.net_entitlement_usd, 1,
    'this case depends on a net entitlement of exactly 1.0000')
  const request = [{ sale_item_id: saleItemId, quantity: 1 }]
  const first = entitlement.buildCustomerReturnQuoteV1({ sale, requested: request, previous: [] })
  assert.equal(first.items[0].total_usd, 0.3333)
  const second = entitlement.buildCustomerReturnQuoteV1({ sale, requested: request, previous: [priorFromQuote(first, 1)] })
  assert.equal(second.items[0].total_usd, 0.3334)
  // Cancel the first return; quote the freed unit again against the survivor.
  const third = entitlement.buildCustomerReturnQuoteV1({ sale, requested: request, previous: [priorFromQuote(second, 2)] })
  assert.equal(third.items[0].total_usd, 0.3334, 'the freed unit was refunded at the survivors\' residue instead of its own target')
  // The active cohort now holds 0.6668 for two units, a 0.0001 residue above
  // the 0.6667 target -- inside CUSTOMER_RETURN_COHORT_RESIDUAL_ALLOWANCE_USD
  // and, being far below a cent, unable to turn into a cent of payout.
  const cohort = money.sumMoney4([second.items[0].total_usd, third.items[0].total_usd])
  assert.equal(cohort, 0.6668)
  assert.ok(cohort <= money.sumMoney4([0.6667, entitlement.CUSTOMER_RETURN_COHORT_RESIDUAL_ALLOWANCE_USD]))
  assert.equal(money.roundMoney2(cohort), money.roundMoney2(0.6667), 'the residue changed the settled cents')
})

phase('return entitlement over captured baskets: partial, full, and a cancelled cohort member', n(150), (index) => {
  const sale = capturedSale(index + 1)
  const previous = []
  const returned = new Map()
  // Step 1 -- a partial return of a random subset.
  const first = sale.lines.filter(() => rng() < 0.6).slice(0, 4)
  const requestedFirst = (first.length ? first : [sale.lines[0]]).map(row => ({
    sale_item_id: row.id, quantity: row.quantity > 1 ? Math.max(0.5, Math.floor(row.quantity / 2)) : row.quantity,
  }))
  const quote1 = entitlement.buildCustomerReturnQuoteV1({ sale, requested: requestedFirst, previous })
  auditQuote(sale, quote1, previous)
  // Determinism: the same request against the same sale reproduces the quote
  // byte for byte, snapshots included.
  assert.deepEqual(entitlement.buildCustomerReturnQuoteV1({ sale, requested: requestedFirst, previous }), quote1,
    'the return quote is not deterministic')
  previous.push(priorFromQuote(quote1, 101))
  for (const item of requestedFirst) returned.set(item.sale_item_id, item.quantity)

  // Step 2 -- a second return on the same cohort, up to the full remaining
  // quantity of each line (the "full return" boundary).
  const requestedSecond = sale.lines
    .map(row => ({ sale_item_id: row.id, quantity: row.quantity - (returned.get(row.id) || 0) }))
    .filter(item => item.quantity > 0)
    .slice(0, 4)
  if (requestedSecond.length) {
    const quote2 = entitlement.buildCustomerReturnQuoteV1({ sale, requested: requestedSecond, previous })
    auditQuote(sale, quote2, previous)
    previous.push(priorFromQuote(quote2, 102))
    for (const item of requestedSecond) returned.set(item.sale_item_id, (returned.get(item.sale_item_id) || 0) + item.quantity)
  }

  // Step 3 -- CANCEL the first return and quote again. A cancelled member
  // leaves its four-place residue with the survivors; the cohort must still
  // accept the freed quantity instead of refusing every later return, and must
  // still refuse anything above the entitlement.
  const survivors = previous.filter(prior => prior.id !== 101)
  const freed = requestedFirst.map(item => ({ sale_item_id: item.sale_item_id, quantity: item.quantity })).slice(0, 4)
  const quote3 = entitlement.buildCustomerReturnQuoteV1({ sale, requested: freed, previous: survivors })
  auditQuote(sale, quote3, survivors)
  assert.ok(quote3.total_refund_usd >= 0, 'the post-cancellation quote produced a negative refund')

  // Over-return must be a refusal, never a quote: this is the assertion that
  // keeps the cap from being expressible as "rounding".
  assert.throws(() => entitlement.buildCustomerReturnQuoteV1({
    sale, requested: [{ sale_item_id: sale.lines[0].id, quantity: sale.lines[0].quantity + 1 }], previous,
  }), /customer_return_quantity_exceeded|customer_return_cohort_invalid/)
})

// ===========================================================================
// PHASE 6 -- money recomputed after a line change (remove a line, add a
// delivery fee). The amendment path recomputes the header from the surviving
// children; a drift here is a wrong total on a sale that was already correct.
// ===========================================================================
phase('amendment recompute: removing a line and billing delivery keep the header exact', n(1000), () => {
  const spec = basket(1)
  const removed = spec.lines[int(0, spec.lines.length - 1)]
  const subtotalAfter = money.subtractMoney4(spec.subtotal, removed.total)
  const discount = Math.min(subtotalAfter, spec.discount)
  const deliveryFee = rng() < 0.5 ? decimal(0, 6, 2) : 0
  const sale = {
    exchange_rate: spec.exchangeRate, money_precision_version: 1,
    discount_usd: discount, membership_discount_usd: 0, tax_usd: spec.tax,
    is_delivery: deliveryFee > 0 ? 1 : 0, delivery_fee_usd: deliveryFee,
    delivery_fee_paid_by: pick(['customer', 'store']),
    amount_paid_usd: money.roundMoney2(spec.subtotal), amount_paid_khr: 0,
  }
  const result = lineAddition.recomputeSaleMoneyAfterLineChange({ moneyPrecisionVersion: 1, sale, subtotalUsd: subtotalAfter })
  const billed = sale.is_delivery && sale.delivery_fee_paid_by === 'customer' ? deliveryFee : 0
  const oracle = Exact.units(subtotalAfter) - Exact.units(discount) + Exact.units(spec.tax) + Exact.units(billed)
  assert.ok(result.totalUsd >= 0, `negative total after a line change: ${result.totalUsd}`)
  assert.equal(Exact.units(result.calculatedTotalUsd), oracle, 'the recomputed header does not foot to its surviving lines')
  assert.equal(Exact.units(result.totalUsd), Exact.toCents(oracle), 'the recomputed payable total is not the cent rounding of the basket')
  assert.equal(result.subtotalUsd, subtotalAfter, 'the recomputed subtotal is not the surviving line sum')
  assert.equal(Exact.units(result.totalKhr), Exact.divideRound(Exact.units(result.totalUsd) * Exact.units(spec.exchangeRate), 10000n),
    'the recomputed total_khr is not the converted total')
  // A frozen tender stays frozen: recomputation must not re-derive what the
  // customer handed over.
  assert.equal(result.amountPaidUsd, sale.amount_paid_usd, 'the recorded tender was rewritten by a recompute')
})

console.log(failures
  ? `\n${failures} failing phase(s) -- replay with BOS_FUZZ_SEED=${SEED}`
  : `\nall phases passed (seed ${SEED}, scale ${SCALE})`)
process.exitCode = failures ? 1 : 0
