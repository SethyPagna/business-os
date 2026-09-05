// Pins the Reports display-currency formatter (utils/reportMoney.ts). The
// user's hard requirements (Aug 31 2026): the setting only CHANGES HOW money
// is SHOWN — it must never mutate/break the stored data, and toggling the
// setting and back must return the identical figure ("changing reverting
// doesn't show different because conversion is different ... just one source
// of truth but shown differently based on the settings").
import assert from 'node:assert/strict'
import { formatReportMoney, makeReportMoneyFormatter, type ReportMoneyDeps } from '../src/utils/reportMoney.ts'
import { actualUsdValue } from '../src/utils/financialPrecision.ts'
import { normalizePriceValue } from '../src/utils/pricing.ts'

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

// Simple, deterministic fakes at a fixed rate of 4000៛/$.
const RATE = 4000
const fmtUSD = (v: number | string) => `$${(Number(v) || 0).toFixed(2)}`
const fmtKHR = (v: number | string) => `${Math.round(Number(v) || 0).toLocaleString('en-US')}៛`
const deps = (displayCurrency: string): ReportMoneyDeps => ({
  displayCurrency,
  fmtUSD,
  fmtKHR,
  khrToUsd: (v) => (Number(v) || 0) / RATE,
  usdToKhr: (v) => (Number(v) || 0) * RATE,
})

// The real AppContext fmtUSD path: normalizePriceValue deliberately rounds
// pricing upward. Report totals must arrive here already quantized to their
// separate nearest-cent display policy.
const productionFmtUSD = (value: number | string) => `$${normalizePriceValue(value).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`
const productionDeps = (displayCurrency: string, rate = RATE): ReportMoneyDeps => ({
  displayCurrency,
  fmtUSD: productionFmtUSD,
  fmtKHR,
  khrToUsd: (value) => (Number(value) || 0) / rate,
  usdToKhr: (value) => (Number(value) || 0) * rate,
})

test('BOTH mode shows each raw amount as-is, NO conversion', () => {
  // A KHR-only fee (the reported $0.00 case) shows its KHR, not $0.
  assert.equal(formatReportMoney(0, 40000, deps('BOTH')), '40,000៛')
  // A USD-only fee shows its USD.
  assert.equal(formatReportMoney(12.5, 0, deps('both')), '$12.50')
  // A row carrying both shows both, "·"-joined.
  assert.equal(formatReportMoney(12.5, 40000, deps('both')), '$12.50 · 40,000៛')
  // Nothing at all -> a clean $0.00, never an empty string.
  assert.equal(formatReportMoney(0, 0, deps('both')), '$0.00')
})

test('USD mode folds KHR into USD at the rate; KHR mode folds USD into KHR', () => {
  // 40,000៛ at 4000 = $10 -> shown as USD.
  assert.equal(formatReportMoney(0, 40000, deps('USD')), '$10.00')
  // $10 -> 40,000៛ under KHR.
  assert.equal(formatReportMoney(10, 0, deps('KHR')), '40,000៛')
  // A mixed row sums both into the target currency.
  assert.equal(formatReportMoney(5, 40000, deps('usd')), '$15.00') // 5 + 10
  assert.equal(formatReportMoney(5, 40000, deps('khr')), '60,000៛') // 40000 + 20000
})

test('production regression: Sep 5 KHR expenses display $16.97, not upward-rounded $16.98', () => {
  const rate = 4065
  const nativeUsd = 0
  const nativeKhr = 69000
  const exactFoldedUsd = nativeKhr / rate
  assert.equal(exactFoldedUsd.toFixed(12), '16.974169741697')
  assert.equal(productionFmtUSD(exactFoldedUsd), '$16.98', 'the unchanged global pricing formatter still rounds upward')
  assert.equal(formatReportMoney(nativeUsd, nativeKhr, productionDeps('usd', rate)), '$16.97')
})

test('USD report display uses nearest half-up by magnitude for ties and non-ties', () => {
  const d = productionDeps('usd')
  assert.equal(formatReportMoney(1.005, 0, d), '$1.01', 'positive 5 rounds up')
  assert.equal(formatReportMoney(1.004, 0, d), '$1.00', 'positive 4 rounds down')
  assert.equal(formatReportMoney(-1.005, 0, d), '$-1.01', 'negative tie rounds away from zero')
  assert.equal(formatReportMoney(-1.004, 0, d), '$-1.00', 'negative non-tie rounds toward zero')
})

test('mixed USD/KHR is folded raw and rounded once, never per component', () => {
  const nativeUsd = 10.005
  const nativeKhr = 27860 // 6.965 USD at 4,000
  assert.equal(actualUsdValue(nativeUsd) + actualUsdValue(nativeKhr / RATE), 16.98, 'premature component rounding would be wrong')
  assert.equal(formatReportMoney(nativeUsd, nativeKhr, productionDeps('usd')), '$16.97', 'the raw combined 16.97 is quantized once')
})

test('KHR and BOTH retain their existing conversion and raw-pair behavior', () => {
  const seenUsd: Array<number | string> = []
  const seenKhr: Array<number | string> = []
  const observed: ReportMoneyDeps = {
    displayCurrency: 'both',
    fmtUSD: (value) => { seenUsd.push(value); return `USD:${value}` },
    fmtKHR: (value) => { seenKhr.push(value); return `KHR:${value}` },
    khrToUsd: () => { throw new Error('BOTH must not convert KHR') },
    usdToKhr: () => { throw new Error('BOTH must not convert USD') },
  }
  assert.equal(formatReportMoney(1.005, 1234, observed), 'USD:1.005 · KHR:1234')
  assert.deepEqual(seenUsd, [1.005], 'BOTH passes the raw USD amount through unchanged')
  assert.deepEqual(seenKhr, [1234], 'BOTH passes the raw KHR amount through unchanged')

  const asKhr = { ...productionDeps('khr'), usdToKhr: (value: unknown) => Number(value) * RATE }
  assert.equal(formatReportMoney(1.005, 1234, asKhr), '5,254៛', 'KHR keeps the existing raw conversion-and-sum path')
})

test('default (unknown/blank) behaves as USD', () => {
  assert.equal(formatReportMoney(0, 40000, deps('')), '$10.00')
  assert.equal(formatReportMoney(0, 40000, deps('anything')), '$10.00')
})

test('round-trip is LOSSLESS: the raw pair is the single source of truth', () => {
  // The formatter always reads the SAME immutable (usd, khr); switching the
  // setting never chains a previously-converted value. So USD->KHR->BOTH->USD
  // returns the identical USD string, byte-for-byte.
  const usd = 5, khr = 40000
  const asUsd1 = formatReportMoney(usd, khr, deps('usd'))
  formatReportMoney(usd, khr, deps('khr')) // view as KHR
  formatReportMoney(usd, khr, deps('both')) // view as both
  const asUsd2 = formatReportMoney(usd, khr, deps('usd')) // back to USD
  assert.equal(asUsd1, asUsd2, 'reverting to USD shows the original, not a re-converted value')
})

test('the formatter NEVER mutates its inputs (display-only, no data change)', () => {
  const row = { amount_usd: 5, amount_khr: 40000 }
  const before = JSON.stringify(row)
  for (const cur of ['usd', 'khr', 'both']) formatReportMoney(row.amount_usd, row.amount_khr, deps(cur))
  assert.equal(JSON.stringify(row), before, 'the source row is untouched by any view')
})

test('makeReportMoneyFormatter currries deps and defaults khr to 0', () => {
  const f = makeReportMoneyFormatter(deps('khr'))
  assert.equal(f(10), '40,000៛', 'a USD-only figure (khr omitted) still converts under KHR mode')
  assert.equal(f(0, 40000), '40,000៛')
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll reportMoney tests passed')
