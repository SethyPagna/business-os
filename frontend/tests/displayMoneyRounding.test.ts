// Displayed money rounds to the NEAREST cent; a selling price keeps rounding UP (owner, 24 Sep 2026). Lane MONEY-1, 4 Nov 2026.
//
// The shared formatters fmtUSD / fmtKHR (AppContext.tsx) used to run every figure through normalizePriceValue, the selling-price
// rounder (Math.ceil), so a Tax of $2.161 read "$2.17" and the summary lines added to a cent more than the total beside them.
// DISCRIMINATING: each row below separates the right rule from the plausible wrong ones --
//   * ceil everywhere (the old behaviour): 2.161 -> 2.17, red here;
//   * floor everywhere: 2.165 -> 2.16, red here;
//   * float Math.round(x * 100) / 100: 1.005 -> 1.00 (1.005 * 100 is 100.49999999999999), red here;
//   * "fixing" the price rounder itself instead of the display: a price of 2.161 must still be 2.17, red on the price rows.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { transformSync } from 'esbuild'
import {
  formatPriceNumber, normalizePriceValue, normalizeSellingPrice, roundUpToDecimals, toFiniteNumber,
} from '../src/utils/pricing.ts'
import { formatMoneyNumber, roundDisplayMoney } from '../src/utils/displayMoney.ts'

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('displayed money is the nearest cent, half away from zero, read from the exact decimal', () => {
  const rows: Array<[unknown, number]> = [
    [2.161, 2.16], [2.165, 2.17], [2.1649, 2.16], [2.169, 2.17], [2.164999, 2.16], [1.005, 1.01], [23.771, 23.77], [0.005, 0.01], [0.0049, 0],
    [4.7475, 4.75], [-2.161, -2.16], [-2.165, -2.17], [-0.004, 0], [0, 0], [3, 3], ['2.161', 2.16], [null, 0], [undefined, 0], ['abc', 0], [Number.NaN, 0],
  ]
  for (const [value, expected] of rows) assert.equal(roundDisplayMoney(value), expected, `roundDisplayMoney(${String(value)})`)
  assert.ok(!Object.is(roundDisplayMoney(-0.004), -0), 'a sub-cent negative is 0, never "-0.00"')
  // Past the exact kernel's bound the display still answers (nearest), it does not throw.
  assert.equal(roundDisplayMoney(250_000_000_000.126), 250_000_000_000.13)
})

runTest('the formatted figure carries two decimals and thousands separators', () => {
  assert.equal(formatMoneyNumber(2.161), '2.16')
  assert.equal(formatMoneyNumber(1234.5), '1,234.50')
  assert.equal(formatMoneyNumber(-1234.565), '-1,234.57')
  assert.equal(formatMoneyNumber(null), '0.00')
})

runTest('a selling price still rounds UP: the price rounders are unchanged', () => {
  assert.equal(normalizePriceValue(2.161), 2.17)
  assert.equal(normalizePriceValue(2.111), 2.12)
  assert.equal(normalizePriceValue(1.001), 1.01)
  assert.equal(roundUpToDecimals(2.161, 2), 2.17)
  assert.equal(normalizeSellingPrice(2.161), 2.17)
  assert.equal(formatPriceNumber(2.161), '2.17')
  assert.equal(formatPriceNumber(3), '3.00')
})

runTest('the same 2.161 is $2.17 as a price and $2.16 as a figure: the two rules disagree on purpose', () => {
  assert.notEqual(normalizePriceValue(2.161), roundDisplayMoney(2.161))
  assert.notEqual(formatPriceNumber(2.161), formatMoneyNumber(2.161))
})

runTest('the summary the cashier reads foots: subtotal - discount + tax is the total, each line at the nearest cent', () => {
  // $25.00 - $3.39 = $21.61; 10% tax = $2.161; total $23.771 -> payable $23.77.
  const lines = [25, -3.39, 2.161].map(roundDisplayMoney)
  assert.deepEqual(lines, [25, -3.39, 2.16])
  assert.equal(Math.round(lines.reduce((sum, value) => sum + value, 0) * 100) / 100, roundDisplayMoney(23.771))
  // Rounded up (the old fmtUSD) the same lines add to 23.78 and disagree with the total beside them.
  const upLines = [25, -3.39, 2.161].map((value) => value < 0 ? -normalizePriceValue(-value) : normalizePriceValue(value))
  assert.notEqual(Math.round(upLines.reduce((sum, value) => sum + value, 0) * 100) / 100, roundDisplayMoney(23.771))
})

// The real formatters, taken from the AppContext source text and run: fmtUSD / fmtKHR are the shared "displayed money" formatters.
const appContext = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function realFormatters() {
  const start = appContext.indexOf('const fmtUSD = useCallback')
  const end = appContext.indexOf('const formatPrice = useCallback')
  assert.ok(start > 0 && end > start, 'fmtUSD and formatPrice are found in AppContext.tsx')
  const snippet = appContext.slice(start, end)
  const js = transformSync(`function build(useCallback: any, roundDisplayMoney: any, normalizePriceValue: any, usdSymbol: string, khrSymbol: string) {\n${snippet}\nreturn { fmtUSD, fmtKHR }\n}`, { loader: 'ts', format: 'cjs' }).code
  const build = new Function('module', `${js}\nreturn build`)({}) as (...args: unknown[]) => { fmtUSD: (n: unknown) => string; fmtKHR: (n: unknown) => string }
  return build((fn: unknown) => fn, roundDisplayMoney, normalizePriceValue, '$', '៛')
}

runTest('the shared fmtUSD and fmtKHR (AppContext.tsx) show the nearest cent', () => {
  const { fmtUSD, fmtKHR } = realFormatters()
  assert.equal(fmtUSD(2.161), '$2.16', 'Tax $2.161 reads $2.16, not $2.17')
  assert.equal(fmtUSD(23.771), '$23.77')
  assert.equal(fmtUSD(2.165), '$2.17')
  assert.equal(fmtUSD(1234.5), '$1,234.50')
  assert.equal(fmtUSD(0), '$0.00')
  assert.equal(fmtUSD(undefined), '$0.00')
  assert.equal(fmtKHR(19000), '19,000.00៛')
  assert.equal(fmtKHR(19000.4), '19,000.40៛')
})

runTest('AppContext no longer runs displayed money or the report currency fold through the selling-price rounder', () => {
  const display = appContext.slice(appContext.indexOf('const fmtUSD = useCallback'), appContext.indexOf('const formatPrice = useCallback'))
  assert.doesNotMatch(display, /normalizePriceValue/, 'fmtUSD / fmtKHR must not call the selling-price rounder')
  const fold = appContext.slice(appContext.indexOf('const usdToKhr = useCallback'), appContext.indexOf('const formatDateTime = useCallback'))
  assert.doesNotMatch(fold, /normalizePriceValue/, 'usdToKhr / khrToUsd convert the exact amount')
  assert.equal(toFiniteNumber(2.161) * 4100, 2.161 * 4100, 'the fold keeps the cents it was given')
})

runTest('the no-provider fallback in AppContextCore reads the exact decimal too: 10.075 is $10.08, equal to roundDisplayMoney on every tie', () => {
  const core = fs.readFileSync(new URL('../src/app/AppContextCore.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const start = core.indexOf('function normalizePriceValue(value: unknown): number {')
  const end = core.indexOf('\nexport function isBrokenLocalizedString')
  assert.ok(start > 0 && end > start, 'the fallback rounder is found in AppContextCore.tsx')
  const js = transformSync(`${core.slice(start, end)}\nmodule.exports = normalizePriceValue`, { loader: 'ts', format: 'cjs' }).code
  const holder = { exports: null as unknown as (value: unknown) => number }
  new Function('module', js)(holder)
  const fallback = holder.exports
  for (const value of [10.075, 2.155, 1.005, 23.775, 1.115, 0.005, 4.7475, 8.345, 0.285, 1.255, 7.835, 2.161, 2.165, 2.1649, -2.165, -0.004, 0, 3, 250_000_000_000.126, 1e-9, 12345678.905]) {
    assert.equal(fallback(value), roundDisplayMoney(value), `fallback(${value})`)
  }
  assert.equal(fallback(10.075), 10.08, 'the float rounding this replaced read 10.07')
  assert.equal(fallback('abc'), 0)
  assert.ok(!Object.is(fallback(-0.004), -0), 'never -0')
  // Every exact half-cent tie as the decimal a response carries it ("1.465"), not as float arithmetic's 1.4649999999999999.
  for (let cents = 0; cents <= 2000; cents += 1) {
    const tie = Number(`${(cents / 100).toFixed(2)}5`)
    assert.equal(fallback(tie), roundDisplayMoney(tie), `grid ${tie}`)
    assert.equal(fallback(-tie), roundDisplayMoney(-tie), `grid -${tie}`)
  }
  assert.equal(fallback(1e-7), 0, 'an exponent form still answers')
  assert.equal(fallback(0.004), 0)
  assert.equal(fallback(0.005), 0.01)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
