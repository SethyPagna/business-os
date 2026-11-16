'use strict'
// Stored daily totals: the payload text codec is LOSSLESS for every exact value the report kernel can produce.
//   textToExact(exactToText(x)) must equal x for a day's SUM of fractions, whose numerator and denominator are far above the 1e11 input-money cap
//   (a KHR deposit over its rate, a legacy pro-rata refund, the lcm of several rates) while the value itself is a normal amount. Before this test the codec
//   sent every part up to 2^53 through the kernel's INPUT check and threw aggregate_overflow for any part in (1e11, 2^53]: 822 of 2000 realistic sums.
//   The property sweep refuses to pass unless it really drew parts in that band, so it cannot go green by missing the failing range.
// Run (from cloudflare/): node scripts/test-sales-daily-exact-prop-pure.cjs
const assert = require('node:assert/strict')
const { createLoader } = require('./harness/sales-daily-load.cjs')

const { src } = createLoader()
const T = src('lib/salesDailyTotals.ts')
const { ReportExactDecimal: E } = src('lib/reportMoneyPrecision.ts')
const { MAX_MONEY_ABS } = src('lib/moneyPrecision.ts')

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const innerOf = (x) => x.value
const roundTrips = (x) => {
  const text = T.exactToText(x)
  const back = T.textToExact(text)
  assert.equal(back.compare(x), 0, `value changed through the text ${text.slice(0, 80)}`)
  assert.equal(T.exactToText(back), text, 'the text is not stable')
  return text
}
// Builds an exact integer of any size from kernel arithmetic only (every recorded input stays under the 1e11 input cap): base-1e9 digits, Horner.
const big = (n) => {
  const negative = n < 0n
  let a = negative ? -n : n
  const digits = []
  do { digits.unshift(a % 1000000000n); a /= 1000000000n } while (a > 0n)
  const v = digits.reduce((acc, digit) => acc.multiply(E.recorded('1000000000')).add(E.recorded(digit.toString())), E.zero())
  return negative ? E.zero().subtract(v) : v
}
const BAND_LOW = BigInt(MAX_MONEY_ABS), BAND_HIGH = BigInt(Number.MAX_SAFE_INTEGER)
const inBand = (x) => { const { n, d } = innerOf(x); const an = n < 0n ? -n : n; return (an > BAND_LOW && an <= BAND_HIGH) || (d > BAND_LOW && d <= BAND_HIGH) }

let seed = 12345
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const RATES = ['4100', '4087', '4093', '4111']
const fact = () => {
  const k = rnd(), money = (rnd() * 500).toFixed(4), sign = rnd() < 0.2 ? '-' : ''
  if (k < 0.4) return E.recorded(sign + money)
  if (k < 0.7) return E.recorded(String(Math.round(rnd() * 400000) * 100)).divide(E.recorded(RATES[Math.floor(rnd() * RATES.length)]))
  return E.recorded(sign + (rnd() * 50).toFixed(2)).multiply(E.recorded((rnd() * 300).toFixed(2))).divide(E.recorded((1 + rnd() * 300).toFixed(2)))
}

check('P1 the failing range: every numerator or denominator in (1e11, 2^53] and around every boundary round-trips', () => {
  const edges = [BAND_LOW - 1n, BAND_LOW, BAND_LOW + 1n, 2n * BAND_LOW, 123456789012n, 999999999999999n, BAND_HIGH - 1n, BAND_HIGH, BAND_HIGH + 1n, BAND_HIGH + 2n, 10n ** 18n + 7n]
  for (const n of edges) {
    roundTrips(big(n))
    roundTrips(big(-n))
    roundTrips(big(n).divide(big(7n)))
    roundTrips(E.recorded('3').divide(big(n | 1n)))
    roundTrips(big(n | 1n).divide(big((n | 1n) + 2n)))
  }
  const sevenths = E.recorded('123456789').multiply(E.recorded('1000')).add(E.recorded('12')).divide(E.recorded('7'))
  assert.equal(T.exactToText(sevenths), '123456789012/7')
  roundTrips(sevenths)
})

check('P2 a day of riel deposits at 4 exchange rates (a 14-digit denominator) round-trips', () => {
  const sum = RATES.reduce((s, r) => s.add(E.recorded('25000').divide(E.recorded(r))), E.zero())
  assert.ok(innerOf(sum).d > BAND_LOW, 'the fixture must really have a denominator above the input cap')
  roundTrips(sum)
  for (const take of [1, 2, 3, 4]) roundTrips(RATES.slice(0, take).reduce((s, r) => s.add(E.recorded('41000').divide(E.recorded(r))), E.zero()))
})

check('P3 legacy pro-rata refunds (refund x net / subtotal) summed over several sales round-trip', () => {
  const sum = [['5.25', '37.45', '41.10'], ['2.10', '19.99', '23.37'], ['7.00', '88.13', '90.01']]
    .reduce((s, [r, n, sub]) => s.add(E.recorded(r).multiply(E.recorded(n)).divide(E.recorded(sub))), E.zero())
  assert.ok(inBand(sum), "the fixture must have a numerator or denominator in the failing band")
  roundTrips(sum)
})

check('P4 property: 3000 random day sums of 1-14 kernel-like facts all round-trip, and a large share really sits in the failing band', () => {
  let band = 0, over = 0
  for (let i = 0; i < 3000; i += 1) {
    const k = 1 + Math.floor(rnd() * 14)
    let sum = E.zero()
    for (let j = 0; j < k; j += 1) sum = sum.add(fact())
    if (inBand(sum)) band += 1
    const { n, d } = innerOf(sum)
    if (n > BAND_HIGH || d > BAND_HIGH) over += 1
    roundTrips(sum)
  }
  assert.ok(band > 200, `only ${band} sums drew a part in (1e11, 2^53]: the sweep would not catch the old bound`)
  assert.ok(over > 100, `only ${over} sums went past 2^53`)
})

check('P5 the text sum equals the kernel sum for random days (so a stored day adds up exactly as the raw kernel does)', () => {
  for (let i = 0; i < 500; i += 1) {
    const facts = Array.from({ length: 1 + Math.floor(rnd() * 8) }, fact)
    const kernel = facts.reduce((a, b) => a.add(b), E.zero())
    const viaText = T.sumFractionTexts(facts.map(T.exactToText))
    assert.equal(viaText, T.exactToText(kernel))
    assert.equal(T.textToExact(viaText).compare(kernel), 0)
    assert.equal(T.textToExact(viaText).toText(4), kernel.toText(4))
  }
})

check('P6 the text cap is a sanity bound for stored data, not an input cap: a 600-digit exact value is stored and read back, an absurd one is refused', () => {
  let huge = E.recorded('1')
  for (let i = 0; i < 60; i += 1) huge = huge.multiply(E.recorded('9999999999')) // 600 digits
  assert.ok(T.exactToText(huge).length > 590)
  roundTrips(huge)
  assert.equal(T.isCanonicalFractionText('9'.repeat(T.SALES_DAILY_MAX_FRACTION_CHARS + 1)), false)
  assert.equal(T.isCanonicalFractionText('9'.repeat(T.SALES_DAILY_MAX_FRACTION_CHARS)), true)
})

console.log(`\n${passed} checks passed`)
