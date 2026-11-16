'use strict'
// MEASUREMENT, not a test (no assertion on time, so it is not named test-*): the CPU of the additive step of one stored day, 31 exact money keys per
// sale, the kernel's own ReportExactDecimal.add (reduces by gcd on every add) against SalesDailyExactSum (common denominator, reduced once).
// The facts are built BEFORE the clock starts, so the number is the summation alone. The two paths must produce the same 31 sums; that is checked here
// too, and proven on randomised days by test-sales-daily-accumulator-pure.cjs.
// Run (from cloudflare/): node scripts/sales-daily-cpu-floor.cjs [salesPerDay ...]
const assert = require('node:assert/strict')
const { createLoader } = require('./harness/sales-daily-load.cjs')

const { src } = createLoader()
const T = src('lib/salesDailyTotals.ts')
const { ReportExactDecimal: E } = src('lib/reportMoneyPrecision.ts')

let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const RATES = ['4100', '4087', '4093']
function factsOfDay(sales) {
  return Array.from({ length: sales }, () => Array.from({ length: 31 }, () => {
    const k = rnd()
    if (k < 0.1) return E.recorded(String(Math.round(rnd() * 400) * 100)).divide(E.recorded(RATES[Math.floor(rnd() * RATES.length)]))
    if (k < 0.12) return E.recorded((rnd() * 50).toFixed(2)).multiply(E.recorded((rnd() * 300).toFixed(2))).divide(E.recorded((1 + rnd() * 300).toFixed(2)))
    return E.recorded((rnd() * 80).toFixed(4))
  }))
}
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6
const oldPath = (facts) => { const keys = Array.from({ length: 31 }, () => E.zero()); for (const sale of facts) for (let k = 0; k < 31; k += 1) keys[k] = keys[k].add(sale[k]); return keys.map(T.exactToText) }
const newPath = (facts) => { const sums = Array.from({ length: 31 }, () => new T.SalesDailyExactSum()); for (const sale of facts) for (let k = 0; k < 31; k += 1) sums[k].add(sale[k]); return sums.map((s) => s.text()) }
const best = (fn, facts) => { let b = Infinity; for (let i = 0; i < 5; i += 1) { const t0 = process.hrtime.bigint(); fn(facts); b = Math.min(b, ms(t0)) } return b }

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite)
for (const sales of sizes.length ? sizes : [14, 300, 900, 3000]) {
  const facts = factsOfDay(sales)
  assert.deepEqual(oldPath(facts), newPath(facts), 'the two paths must give the same 31 sums')
  oldPath(facts); newPath(facts)
  const o = best(oldPath, facts), n = best(newPath, facts)
  console.log(`${String(sales).padStart(5)} sales/day  kernel adds ${o.toFixed(2).padStart(8)} ms   common-denominator sum ${n.toFixed(2).padStart(8)} ms   x${(o / n).toFixed(1)}   per sale ${(n / sales).toFixed(4)} ms`)
}
