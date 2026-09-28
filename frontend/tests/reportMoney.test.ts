// Pins the Reports display-currency formatter (utils/reportMoney.ts). The
// user's hard requirements (Aug 31 2026): the setting only CHANGES HOW money
// is SHOWN — it must never mutate/break the stored data, and toggling the
// setting and back must return the identical figure ("changing reverting
// doesn't show different because conversion is different ... just one source
// of truth but shown differently based on the settings").
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { formatReportMoney, makeReportMoneyFormatter, type ReportMoneyDeps } from '../src/utils/reportMoney.ts'
import { actualUsdValue } from '../src/utils/financialPrecision.ts'
import { normalizePriceValue } from '../src/utils/pricing.ts'
import * as reportModel from '../src/components/sales/reports/reportModel.ts'
import { num, pct, round2 } from '../src/components/sales/reports/reportModel.ts'

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

// ---- SCAN1 M3: a refund is ONE amount -------------------------------------
// A customer return stores its refund in dollars AND the riel equivalent at
// the return's own rate (cloudflare/src/lib/customerReturnEntitlement.ts:
// total_refund_khr = multiplyMoney4(usd, rate); the legacy path sums the sale
// lines' riel twins). The Reports hub handed that pair to the fold above as if
// it were a fee's two native amounts, so one $10.00 refund read $20.25 in USD
// mode and "$10.00 · 41,000៛" (two refunds) in BOTH mode. These cases run the
// REAL column definitions and the REAL cell/CSV formatters on a paired row.
const reportsDir = new URL('../src/components/sales/reports/', import.meta.url)
const readReport = (name: string) => fs.readFileSync(new URL(name, reportsDir), 'utf8')
const between = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `slice ${start} .. ${end}`)
  return stripTypeScriptTypes(source.slice(from, to).replaceAll('export function', 'function'))
}
type Column = { key: string; kind?: string; value: (row: unknown) => unknown; khr?: (row: unknown) => number }
type Fmt = (usd: number, khr?: number) => string
const tableSource = readReport('ReportTable.tsx')
const table = new Function('num', 'fmtInt', 'fmtQty', 'fmtPct', 'fmtDateOnly', 'fmtDateTime24',
  `${between(tableSource, 'export function formatCell', 'function isNumericKind')}
   ${between(tableSource, 'export function csvColumnsFor', 'export default function ReportTable')}
   return { formatCell, csvColumnsFor }`)(num, String, String, String, String, String) as {
  formatCell: (column: Column, row: unknown, fmtMoney: Fmt) => unknown
  csvColumnsFor: (columns: Column[], fmtMoney: Fmt) => Array<{ header: string; value: (row: unknown) => unknown }>
}
const returnsSource = readReport('ReturnsReport.tsx')
const overviewSource = readReport('OverviewReport.tsx')
const returnsHelpers = new Function('num', 'round2', 'pct',
  `${between(returnsSource, 'function money(raw', 'export default function ReturnsReport')}
   return { moneyColumns, mapReturnRow }`)(num, round2, pct) as {
  moneyColumns: (tr: (key: string, fallback: string) => string, totalUsd: number) => Column[]
  mapReturnRow: (raw: unknown, index: number) => Record<string, unknown>
}
// $10.00 refunded at 4,100 -- the pair as GET /api/returns/report sends it.
// The display rate (RATE, 4,000) differs from the return's own rate on purpose.
const pairedRefund = { count: 1, refund_usd: 10, refund_khr: 41_000 }
const refundColumn = returnsHelpers.moneyColumns((_key, fallback) => fallback, 10).find((column) => column.key === 'refund')!
const cell = (currency: string) => String(table.formatCell(refundColumn, pairedRefund, makeReportMoneyFormatter(deps(currency))))

test('M3: a paired refund cell shows ONE amount in every display currency', () => {
  assert.equal(cell('usd'), '$10.00', 'USD mode: the refund, not the refund plus its own riel twin ($20.25)')
  assert.equal(cell('khr'), '40,000៛', 'KHR mode converts the dollar refund at the main rate, like revenue -- never 41,000 + 40,000')
  assert.equal(cell('both'), '$10.00', 'BOTH mode shows the refund once, not "$10.00 · 41,000៛" (which reads as two refunds)')
})

test('M3: the CSV export carries the refund once, as a plain number', () => {
  const [csvRefund] = table.csvColumnsFor([refundColumn], makeReportMoneyFormatter(deps('usd')))
  assert.equal(csvRefund.value(pairedRefund), 10)
})

test('M3: fees keep additive folding -- their two amounts are independent native payments', () => {
  assert.equal(formatReportMoney(5, 40000, deps('usd')), '$15.00')
  assert.equal(formatReportMoney(5, 40000, deps('both')), '$5.00 · 40,000៛')
})

test('M3: the riel twin never enters a Reports hub refund figure', () => {
  // Root cause, not symptom: every refund cell, the summary line, the totals
  // row and the row detail read one figure. A report that still maps or passes
  // refund_khr can fold it again (the per-return list, the summary line and the
  // Overview's by-reason fold each did).
  assert.equal('refund_khr' in returnsHelpers.mapReturnRow({ refund_usd: 10, refund_khr: 41_000 }, 0), false)
  const carriesTwin = (source: string) => /refund_khr/.test(source)
  assert.equal(carriesTwin('{ key: \'refund\', value: (r) => r.refund_usd, khr: (r) => r.refund_khr }'), true, 'negative control: the predicate sees the defect')
  assert.equal(carriesTwin(returnsSource), false, 'ReturnsReport.tsx reads refund_usd only')
  assert.equal(carriesTwin(overviewSource), false, 'OverviewReport.tsx reads refund_usd only')
})

test('M3: the Returns hint tells the owner the rule the cells follow, in both packs', () => {
  const packs = Object.fromEntries(['en', 'km'].map((name) => [name,
    JSON.parse(fs.readFileSync(new URL(`../src/lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>]))
  const fallback = /tr\('rpt_hint_returns', '((?:[^'\\]|\\.)*)'\)/.exec(returnsSource)?.[1]
  assert.equal(fallback, packs.en.rpt_hint_returns, 'the in-code fallback is the English pack text')
  for (const [name, pack] of Object.entries(packs)) {
    assert.ok(pack.rpt_hint_returns.toLowerCase().includes(pack.display_currency.toLowerCase()),
      `${name}: refunds are shown in the display currency ("${pack.display_currency}") -- ${pack.rpt_hint_returns}`)
  }
  assert.doesNotMatch(packs.en.rpt_hint_returns, /recorded in/i, 'en no longer says a refund keeps the currency it was recorded in')
  assert.ok(!packs.km.rpt_hint_returns.includes('រូបិយប័ណ្ណដែលបានកត់ត្រា'), 'km no longer says a refund keeps the currency it was recorded in')
})

const require = createRequire(import.meta.url)
const React = require('react') as typeof import('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
type ReturnsReportProps = Record<string, unknown>
function renderReturnsReport(response: unknown, fmtMoney: Fmt, search: string): string {
  const passThrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  const noIcon = () => null
  const reportTable = ({ columns, rows, totalsRow, fmtMoney: money }: { columns: Column[]; rows: unknown[]; totalsRow: unknown; fmtMoney: Fmt }) =>
    React.createElement('table', null, [...rows, ...(totalsRow ? [totalsRow] : [])].map((row, index) =>
      React.createElement('tr', { key: index }, columns.map((column) =>
        React.createElement('td', { key: column.key }, table.formatCell(column, row, money) as React.ReactNode)))))
  const reportFrame = ({ summary, children }: { summary: string; children?: React.ReactNode }) =>
    React.createElement('section', null, React.createElement('p', null, summary), children)
  const modules: Record<string, unknown> = {
    'lucide-react/dist/esm/icons/download.js': { __esModule: true, default: noIcon },
    'lucide-react/dist/esm/icons/printer.js': { __esModule: true, default: noIcon },
    '../../../api/reportsTransport.ts': { getBusinessSummaryReturnsPage: () => Promise.resolve(null) },
    '../../../api/returnsReadTransport.ts': { getReturnsReport: () => Promise.resolve(null) },
    '../../../utils/csv.ts': { downloadCSV: () => undefined },
    '../../../utils/exportOptions.ts': { openPrintExport: () => undefined },
    '../../../utils/formatters.ts': { fmtDateOnly: String, fmtDateTime24: String },
    '../../shared/kit': { Button: passThrough, Chip: passThrough, Fold: passThrough, OverflowMenu: noIcon },
    './ReceiptSheet.tsx': { __esModule: true, default: noIcon },
    './ReportFrame.tsx': { __esModule: true, default: reportFrame, useReportData: () => ({ data: response, loading: false, error: null, reload: () => undefined }) },
    './ReportTable.tsx': { __esModule: true, default: reportTable, csvColumnsFor: table.csvColumnsFor },
    './reportModel.ts': reportModel,
    './reportTypes.ts': { tableLabels: () => ({ total: 'Total' }), exportMenuItems: () => [], rangeSubtitle: () => '' },
    './usePagedReport.ts': { usePagedReport: () => ({ rows: [], hasMore: false, loading: false, loadingMore: false, error: null, reload: () => undefined, loadMore: () => undefined }) },
  }
  const compiled = { exports: {} as { default?: React.ComponentType<ReturnsReportProps> } }
  new Function('require', 'module', 'exports', transformSync(returnsSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)(
    (id: string) => (id in modules ? modules[id] : require(id)), compiled, compiled.exports)
  const tr = (_key: string, fallback: string) => fallback
  return renderToStaticMarkup(React.createElement(compiled.exports.default!, {
    tr, t: (key: string) => key, fmtMoney, style: {}, search, canExport: () => false,
    filters: { startDate: '2026-09-01', endDate: '2026-09-02' }, view: { labelKey: 'returns', fallback: 'Returns' },
  }))
}

test('M3: the rendered Returns report hands fmtMoney each refund once -- summary, search total and totals row', () => {
  const calls: Array<[number, number | undefined]> = []
  const both = makeReportMoneyFormatter(deps('both'))
  const spy: Fmt = (usd, khr) => { calls.push([usd, khr]); return both(usd, khr) }
  const html = renderReturnsReport({
    totals: { count: 2, refund_usd: 15, refund_khr: 61_500 },
    days: [
      { date: '2026-09-01', count: 1, refund_usd: 10, refund_khr: 41_000 },
      { date: '2026-09-02', count: 1, refund_usd: 5, refund_khr: 20_500 },
    ],
  }, spy, '2026-09')
  assert.ok(calls.length >= 5, `the summary, the search total, two rows and the totals row all reached fmtMoney (${calls.length})`)
  assert.deepEqual(calls.filter(([, khr]) => khr !== undefined), [], 'no refund reaches fmtMoney with its riel twin')
  assert.match(html, /Refunds \$15\.00/)
  assert.match(html, /of 2 · \$15\.00/)
  assert.doesNotMatch(html, /៛/, 'BOTH mode prints no riel figure beside a refund')
})

test('M3: every fmtMoney call in ReturnsReport.tsx passes one amount, including the row detail', () => {
  const callsWithSecondAmount = (source: string) => {
    const file = ts.createSourceFile('ReturnsReport.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const lines: number[] = []
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fmtMoney' && node.arguments.length !== 1) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    return lines
  }
  assert.deepEqual(callsWithSecondAmount("const s = fmtMoney(totals.refund_usd, num(state.data?.totals?.['refund' + '_khr']))"), [1],
    'negative control: a riel twin read through a computed key is still a second amount')
  assert.deepEqual(callsWithSecondAmount(returnsSource), [])
  assert.ok(/fmtMoney\(openRow\.refund_usd\)/.test(returnsSource), 'the row detail formats the refund through fmtMoney')
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll reportMoney tests passed')
