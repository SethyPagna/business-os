'use strict'
// Stored daily totals: the day accumulator (SalesDailyExactSum) gives EXACTLY the kernel's own sum, only cheaper.
//   The kernel's ReportExactDecimal.add reduces by gcd on every add (31 money keys x every sale); SalesDailyExactSum adds numerators per denominator and
//   reduces once. A sum of rationals does not depend on how it is carried, so the result must be identical: proven here against the kernel's own adds on
//   randomised days (decimal money, riel over 3 rates, legacy pro-rata fractions, negatives, zeros, empty days, order shuffles).
// Run (from cloudflare/): node scripts/test-sales-daily-accumulator-pure.cjs
const assert = require('node:assert/strict')
const { createLoader } = require('./harness/sales-daily-load.cjs')

const { src } = createLoader()
const T = src('lib/salesDailyTotals.ts')
const { ReportExactDecimal: E } = src('lib/reportMoneyPrecision.ts')

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

let seed = 99
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const RATES = ['4100', '4087', '4093']
const fact = () => {
  const k = rnd(), sign = rnd() < 0.2 ? '-' : ''
  if (k < 0.08) return E.zero()
  if (k < 0.5) return E.recorded(sign + (rnd() * 500).toFixed(4))
  if (k < 0.8) return E.recorded(String(Math.round(rnd() * 400000) * 100)).divide(E.recorded(RATES[Math.floor(rnd() * RATES.length)]))
  return E.recorded(sign + (rnd() * 50).toFixed(2)).multiply(E.recorded((rnd() * 300).toFixed(2))).divide(E.recorded((1 + rnd() * 300).toFixed(2)))
}
const kernelSum = (facts) => facts.reduce((a, b) => a.add(b), E.zero())
const accSum = (facts) => facts.reduce((acc, f) => acc.add(f), new T.SalesDailyExactSum())

check('A1 an empty day and all-zero days are "0"', () => {
  assert.equal(new T.SalesDailyExactSum().text(), '0')
  assert.equal(accSum([E.zero(), E.zero()]).text(), '0')
  assert.equal(accSum([E.recorded('5'), E.recorded('-5')]).text(), '0')
})

check('A2 800 random days of 1-120 facts: text, exact value and 4-place rounding equal the kernel adds, in any order', () => {
  for (let day = 0; day < 800; day += 1) {
    const facts = Array.from({ length: 1 + Math.floor(rnd() * 120) }, fact)
    const expected = kernelSum(facts)
    const acc = accSum(facts)
    assert.equal(acc.text(), T.exactToText(expected), `day ${day}`)
    assert.equal(acc.toExact().compare(expected), 0)
    assert.equal(acc.toExact().toText(4), expected.toText(4))
    const shuffled = [...facts].sort(() => rnd() - 0.5)
    assert.equal(accSum(shuffled).text(), T.exactToText(expected), 'order must not matter')
  }
})

check('A3 the sum is carried through the text codec unchanged (a day above the 1e11 input cap in numerator and denominator)', () => {
  const facts = RATES.map((r) => E.recorded('25000').divide(E.recorded(r))).concat([E.recorded('1').divide(E.recorded('3')), E.recorded('-7').divide(E.recorded('9'))])
  const acc = accSum(facts)
  assert.equal(acc.text(), T.exactToText(kernelSum(facts)))
  assert.equal(T.exactToText(acc.toExact()), acc.text())
  assert.ok(acc.text().length > 20)
})

check('A4 CONTROL: a deliberately wrong carry (dropping a mixed denominator) is detected by the same comparison', () => {
  const facts = [E.recorded('1').divide(E.recorded('3')), E.recorded('1').divide(E.recorded('4')), E.recorded('1').divide(E.recorded('6'))]
  const right = accSum(facts).text()
  assert.equal(right, '3/4')
  // the same arithmetic with the lcm step replaced by a plain product of denominators and NO final reduction would give 13/36... or an unreduced text
  const wrong = facts.reduce((acc, f) => { const { n, d } = f.value; return { n: acc.n * d + n * acc.d, d: acc.d * d } }, { n: 0n, d: 1n })
  assert.notEqual(`${wrong.n}/${wrong.d}`, right, 'an unreduced sum is not the canonical text, so the comparison would catch a carry that forgot to reduce')
})

check('A5 an unreadable kernel value fails loudly instead of summing wrong', () => {
  assert.throws(() => new T.SalesDailyExactSum().add({}), /exact_value_unreadable/)
  assert.throws(() => new T.SalesDailyExactSum().addFraction(1n, 0n), /fraction_zero_denominator/)
})

console.log(`\n${passed} checks passed`)
