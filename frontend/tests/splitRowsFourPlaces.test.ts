// Split rows carry 4 decimals, headline totals stay in cents (owner, 13 Oct 2026).
//
// The Dashboard's payment-method and branch cards, their CSV exports, and the Sales export
// preview's by-status / by-product rows are SLICES of one revenue figure. The Worker now
// returns them at the Reports bucket precision (4 places); if the screen formats them to
// cents the rows stop adding up to the window figure by a visible cent. The headline KPI
// cards must keep cents. This pins both halves so neither drifts back.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { formatUsd4 } from '../src/utils/reportMoney.ts'

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}
const read = (relative: string): string => fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const dashboard = read('../src/components/dashboard/Dashboard.tsx')
const dashboardExport = read('../src/components/dashboard/dashboardExport.ts')
const exportModal = read('../src/components/sales/ExportModal.tsx')

test('control: formatUsd4 keeps the four places a cents formatter would drop', () => {
  assert.equal(formatUsd4(79.9945, '$'), '$79.9945')
  assert.notEqual(formatUsd4(79.9945, '$'), '$79.99')
})

test('Dashboard: the payment and branch cards, their detail rows and the branch bars format at 4 places', () => {
  assert.match(dashboard, /const fmtSplitUsd = useCallback\(\(value: unknown\): string => formatUsd4\(Number\(value\) \|\| 0, usdSymbol\), \[usdSymbol\]\)/)
  assert.equal((dashboard.match(/fmtUSD=\{fmtSplitUsd\}/g) || []).length, 2, 'both card components get the split formatter')
  assert.match(dashboard, /label: translateOr\('revenue', 'Revenue'\), value: fmtSplitUsd\(branch\.revenue_usd \|\| 0\)/)
  assert.match(dashboard, /label: translateOr\('revenue', 'Revenue'\), value: fmtSplitUsd\(payment\.revenue_usd \|\| 0\)/)
})

test('Dashboard: the headline KPI cards keep cents', () => {
  assert.match(dashboard, /value: fmtUSD\(aRevenue\),/)
  assert.doesNotMatch(dashboard, /fmtSplitUsd\(aRevenue\)/)
  assert.doesNotMatch(dashboard, /fmtSplitUsd\(aProfit\)/)
})

test('Dashboard CSV: payment and branch revenue export at 4 places, not as a rounded price', () => {
  assert.match(dashboardExport, /Method: p\.payment_method \|\| '',\n\s+Count: p\.count \|\| 0,\n\s+Revenue: splitCsv\(p\.revenue_usd\)/)
  assert.match(dashboardExport, /Branch: b\.branch_name \|\| '',\n\s+Tx: b\.count \|\| 0,\n\s+Revenue: splitCsv\(b\.revenue_usd\)/)
  assert.doesNotMatch(dashboardExport, /Revenue: priceCsv\(p\.revenue_usd\)/)
  assert.doesNotMatch(dashboardExport, /Revenue: priceCsv\(b\.revenue_usd\)/)
})

test('Sales export preview: the status and product rows format at 4 places, the summary figures keep cents', () => {
  assert.match(exportModal, /const fmtSplitUsd = \(value: number\): string => formatUsd4\(Number\(value\) \|\| 0, String\(settings\?\.currency_usd_symbol \|\| '\$'\)\)/)
  assert.match(exportModal, /\{fmtSplitUsd\(row\.revenue \|\| 0\)\}/)
  assert.match(exportModal, /\{fmtSplitUsd\(row\.revenue_usd \|\| 0\)\}/)
  assert.doesNotMatch(exportModal, /fmtUSD\(row\.revenue(_usd)? \|\| 0\)/)
  assert.match(exportModal, /\[tr\('net_revenue', 'Net Revenue'\), fmtUSD\(preview\.summary\?\.net_revenue_usd \|\| 0\)\]/)
})

if (failed) process.exitCode = 1
