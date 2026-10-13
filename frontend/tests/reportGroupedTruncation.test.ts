// AL Finding L2: GET /api/reports/grouped keeps the top `limit` groups (the
// till asks for 500). With 501 customers the page used to show 500 rows and a
// totals line / CSV summed from them ($500 against the Overview's $501), with
// nothing saying a group was missing. The server now sends total_groups,
// truncated and the window's own totals; the page must say "top N of M" and
// put the window's totals -- not the sum of the rows it holds -- on the totals
// line and in the export. The Overview's payment-method fold follows the same
// rule. Pins:
//   1. topOfLabel in both language packs (the counts and noun substituted,
//      no placeholder left behind).
//   2. GroupedReport takes its totals line from the response's totals when no
//      search narrows the rows, labels the totals row with the cap, appends
//      that totals row to the CSV/print export, and summarises a capped list
//      as "top N of M" (a wrong fix that only adds the label still sums rows).
//   3. OverviewReport counts every payment method on the chip, shares against
//      the window's revenue when capped, and prints the cap under the fold.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPORT_NOUNS, sumTotals, normalizeTotals, topOfLabel } from '../src/components/sales/reports/reportModel.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const pack = (name: string) => JSON.parse(read(`src/lang/${name}.json`)) as Record<string, string>

for (const name of ['en', 'km']) {
  const strings = pack(name)
  const tr = (key: string, fallback: string) => strings[key] ?? fallback
  assert.ok(strings.rpt_top_n_of_m, `${name}: rpt_top_n_of_m exists`)
  const text = topOfLabel(500, 501, REPORT_NOUNS.customer, tr)
  assert.ok(text.includes('500') && text.includes('501'), `${name}: both counts appear (${text})`)
  assert.ok(text.includes(strings.customers.toLowerCase()), `${name}: the plural noun appears (${text})`)
  assert.ok(!/[{}]/.test(text), `${name}: no placeholder is left (${text})`)
}
const en = pack('en')
assert.equal(topOfLabel(1500, 2001, REPORT_NOUNS.product, (key, fallback) => en[key] ?? fallback), 'Top 1,500 of 2,001 products')

// The totals the page must show for a capped list are the window's, which the
// rows cannot reproduce: 500 rows of $1 sum to $500, the window holds $501.
const rows = Array.from({ length: 500 }, () => normalizeTotals({ tx_count: 1, revenue_usd: 1, gross_sales_usd: 1, collected_total_usd: 1 })!)
const windowTotals = normalizeTotals({ tx_count: 501, revenue_usd: 501, gross_sales_usd: 501, collected_total_usd: 501 })!
assert.equal(sumTotals(rows).revenue_usd, 500, 'summing the capped rows is short by the missing group')
assert.equal(windowTotals.revenue_usd, 501)

const grouped = read('src/components/sales/reports/GroupedReport.tsx')
const strip = (s: string) => s.replace(/\s+/g, ' ')
const g = strip(grouped)
assert.match(g, /const totalGroups = Math\.max\(num\(state\.data\?\.total_groups\), raw\.length\)/)
assert.match(g, /const truncated = state\.data\?\.truncated === true \|\| totalGroups > raw\.length/)
assert.match(g, /const windowTotals = !search && state\.data\?\.totals/, 'only an unsearched list may claim the window totals')
assert.match(g, /const totals = \(windowTotals && normalizeTotals\(windowTotals\)\) \|\| sumTotals\(groupRows\)/,
  'the grouped totals line reads the response totals, falling back to the row sum only when searched or absent')
assert.match(g, /const groupTotalsRow: GroupRow \| null = groupRows\.length > 1 \|\| truncated \? \{ \.\.\.totals, key: '__totals', label: totalLabel/)
assert.match(g, /rowsToCsvObjects\(csvColumnsFor\(columns, fmtRow\), groupTotalsRow \? \[\.\.\.groupRows, groupTotalsRow\] : groupRows\)/,
  'the grouped export carries the window totals row')
assert.match(g, /totalsRow=\{groupTotalsRow\}/)
assert.match(g, /summary=\{groupRows\.length \? joinSummary\(\[countPart\(groupRows\.length, REPORT_NOUNS\[by\]\)/)
assert.match(g, /const totalLine = windowTotals \? num\(windowTotals\.line_sales_usd\)/, 'products total line sales from the window')
assert.match(g, /const totalSales = windowTotals \? num\(windowTotals\.sale_count\)/, 'products count distinct sales from the window')
assert.match(g, /productTotalsRow \? \[\.\.\.productRows, productTotalsRow\] : productRows/, 'the products export carries the totals row')
assert.doesNotMatch(g, /const totals = sumTotals\(groupRows\)/, 'the rows-only sum is gone')

const overview = strip(read('src/components/sales/reports/OverviewReport.tsx'))
assert.match(overview, /const paymentGroups = Math\.max\(num\(data\?\.sales\?\.payment_methods_total_groups\), payments\.length\)/)
assert.match(overview, /count: paymentGroups/)
assert.match(overview, /value: \(r\) => pct\(r\.revenue_usd, paymentRevenue\)/)
assert.match(overview, /footer=\{paymentsTruncated \? <p[^>]*>\{topOfLabel\(payments\.length, paymentGroups, REPORT_NOUNS\.payment_method, tr\)\}/)
console.log('PASS capped grouped reports say top N of M and carry the window totals on screen, in exports and in the Overview payments fold')
