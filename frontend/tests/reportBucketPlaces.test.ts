// AL finding L3, owner decision 13 Oct 2026: split reports show 4-decimal
// amounts. Every bucket row -- day, week, month, customer, cashier, branch,
// hour, payment method, product, courier, receipt -- prints 4 places so the
// rows add up exactly to the Overview; a single headline total keeps cents.
// The Worker already sends bucket rows at 4 places (cloudflare
// scripts/test-report-bucket-precision-pure.cjs); this file pins the screens
// and exports that print them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatReportMoney, formatUsd4, type ReportMoneyDeps } from '../src/utils/reportMoney.ts'
import { normalizeTotals, sumTotals, type ReportTotals } from '../src/components/sales/reports/reportModel.ts'

let passed = 0
const test = (name: string, fn: () => void): void => { fn(); passed += 1; console.log(`PASS ${name}`) }
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const RATE = 4000
const deps = (displayCurrency: string): ReportMoneyDeps => ({
  displayCurrency,
  fmtUSD: (v) => `$${(Number(v) || 0).toFixed(2)}`,
  fmtKHR: (v) => `${Math.round(Number(v) || 0).toLocaleString('en-US')}៛`,
  khrToUsd: (v) => (Number(v) || 0) / RATE,
  usdToKhr: (v) => (Number(v) || 0) * RATE,
  usdSymbol: '$',
})

test('a split row prints 4 places in USD and BOTH; the headline default keeps cents', () => {
  assert.equal(formatReportMoney(0.005, undefined, deps('usd'), 4), '$0.0050')
  assert.equal(formatReportMoney(0.005, undefined, deps('usd')), '$0.01', 'control: the same figure as a headline is cents')
  assert.equal(formatReportMoney(0.005, 4000, deps('both'), 4), '$0.0050 · 4,000៛')
  // A riel amount folds into the 4-place dollar figure exactly once.
  assert.equal(formatReportMoney(1, 2, deps('usd'), 4), '$1.0005')
  // Riel already prints finer than a 4-place dollar, so KHR mode is unchanged.
  assert.equal(formatReportMoney(0.005, undefined, deps('khr'), 4), formatReportMoney(0.005, undefined, deps('khr')))
})

test('formatUsd4 rounds half-up by magnitude to 4 places and groups thousands', () => {
  assert.equal(formatUsd4(1234.56785), '$1,234.5679')
  assert.equal(formatUsd4(-0.00005), '$-0.0001')
  assert.equal(formatUsd4(300, '៛'), '៛300.0000')
})

test('formatUsd4 prints a value that is not a finite number as zero instead of throwing, as the cents formatter does', () => {
  for (const bad of [Infinity, -Infinity, NaN]) assert.equal(formatUsd4(bad), '$0.0000', String(bad))
  assert.equal(formatUsd4(Infinity, '៛'), '៛0.0000')
  assert.equal(formatReportMoney(Infinity, undefined, deps('usd'), 4), '$0.0000')
  assert.equal(formatReportMoney(Infinity, 4000, deps('both'), 4), '$0.0000 · 4,000៛', 'a bad dollar figure leaves the riel figure beside it')
})

test('bucket rows sum to the window at 4 places; the same rows at cents would not', () => {
  const row = (cost: number, profit: number) => normalizeTotals({ revenue_usd: 1.005, tx_count: 1, cost_usd: cost, profit_usd: profit, net_sales_usd: 1 }) as ReportTotals
  const sum = sumTotals([row(0.005, 0.995), row(0.005, 0.995)])
  assert.equal(sum.cost_usd, 0.01)
  assert.equal(sum.profit_usd, 1.99)
  assert.equal(sum.revenue_usd, 2.01)
  const cents = sumTotals([row(0.01, 1), row(0.01, 1)])
  assert.notEqual(cents.cost_usd, sum.cost_usd, 'control: cent-rounded rows add up to $0.02, not the $0.01 the Overview prints')
})

test('every split-row table, card and export prints through the 4-place formatter', () => {
  const hub = read('src/components/sales/ReportsHub.tsx')
  assert.match(hub, /makeReportMoneyFormatter\(\{ displayCurrency: options\.currency, fmtUSD, fmtKHR, khrToUsd, usdToKhr, usdSymbol \}, 4\)/)
  assert.match(hub, /fmtMoney,\n\s+fmtBucketMoney,/)
  for (const rel of ['GroupedReport', 'PeriodReport', 'SalesListReport', 'OverviewReport']) {
    const source = read(`src/components/sales/reports/${rel}.tsx`)
    assert.match(source, /const fmtRow = p\.fmtBucketMoney \?\? fmtMoney/, `${rel} derives its row formatter`)
    // Every ReportTable a view renders over split rows uses fmtRow.
    const tables = [...source.matchAll(/<ReportTable[\s\S]*?\/>/g)].map((m) => m[0])
    assert.ok(tables.length > 0, `${rel} renders a table`)
    for (const table of tables) {
      if (/surfaceKey="reports-overview-(reasons|types)"|surfaceKey=\{`reports-sales-export-/.test(table)) continue
      assert.match(table, /fmtMoney=\{fmtRow\}/, `${rel}: ${table.slice(0, 80)}`)
    }
  }
  const grouped = read('src/components/sales/reports/GroupedReport.tsx')
  assert.equal((grouped.match(/csvColumnsFor\(columns, fmtRow\)/g) || []).length, 3, 'products, couriers and groups export through fmtRow')
  assert.match(grouped, /renderProductCard\(row, tr, fmtRow\)/)
  // The summary line is a headline: it keeps cents.
  assert.match(grouped, /`\$\{basisLabel\} \$\{fmtMoney\(totalBasis\)\}`/)
  const period = read('src/components/sales/reports/PeriodReport.tsx')
  assert.match(period, /csvColumnsFor\(columns, fmtRow\)/)
  assert.match(period, /`\$\{basisLabel\} \$\{fmtMoney\(basisValue\(totals, options\.basis\)\)\}`/)
  const sales = read('src/components/sales/reports/SalesListReport.tsx')
  assert.match(sales, /language: language \|\| 'en', fmtMoney: fmtRow,/, 'the receipt export prints 4 places')
  assert.match(sales, /value: fmtRow\(r\.net_revenue_usd\)/, 'a receipt detail matches its row')
})

test('the Sales strip payment rows and the Dashboard period export carry 4 places', () => {
  const strip = read('src/components/sales/Sales.tsx')
  assert.match(strip, /fmtSplitUsd\(Number\(\(row as Record<string, unknown>\)\.collected_usd\) \|\| 0\)/)
  assert.match(strip, /value: fmtUSD\(revenueUsd\),/, 'the headline Revenue card keeps cents')
  const dashboard = read('src/components/dashboard/dashboardExport.ts')
  const salesRows = dashboard.slice(dashboard.indexOf('function buildDashboardSalesRows'), dashboard.indexOf('function buildDashboardTopProductRows'))
  assert.equal((salesRows.match(/splitCsv\(/g) || []).length, 8, 'every money column of a period row')
  assert.doesNotMatch(salesRows, /priceCsv\(/)
  assert.match(dashboard, /Metric: 'Revenue \(USD\)', Value: priceCsv\(metricTotals\.revenue_usd\)/, 'the KPI headline keeps cents')
})

console.log(`\n${passed} 4-place bucket display tests passed`)
