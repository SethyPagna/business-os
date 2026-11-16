// AL finding L4 (13 Oct 2026): the courier's actual cost is administrator-only.
// The Worker sends a cost viewer who is not an administrator GOODS profit
// (revenue - cost) with `profit_excludes_delivery: true` and no courier-cost
// keys (cloudflare scripts/test-report-cost-view-profit-pure.cjs). These
// checks pin the screens: they must not bridge that profit with the delivery
// fee (which printed the courier cost back as a "Rounding" line), must not
// print a $0.00 courier cost, and must name the figure for what it is.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildIncomeStatement, hasProfit, normalizeTotals, profitLabel, sumTotals, type ReportTotals } from '../src/components/sales/reports/reportModel.ts'
import { equationResidual, profitTerms } from '../src/utils/statsFormulas.ts'

let passed = 0
const test = (name: string, fn: () => void): void => { fn(); passed += 1; console.log(`PASS ${name}`) }
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tr = (_key: string, fallback: string) => fallback
const khrToUsd = (khr: number) => khr / 4000

// The administrator's window: revenue 10, cost 4, a $2 fee charged and a
// $1.50 courier -> profit 6.50.
const admin = {
  tx_count: 1, gross_sales_usd: 10, revenue_usd: 10, net_sales_usd: 10, collected_total_usd: 12, delivery_usd: 2, delivery_sale_count: 1,
  recognized_delivery_usd: 2, recognized_delivery_cost_usd: 1.5, delivery_actual_cost_usd: 1.5, delivery_actual_cost_count: 1,
  delivery_margin_usd: 0.5, delivery_net_usd: 0.5, cost_usd: 4, profit_usd: 6.5,
}
// What the same window looks like to a cost viewer after the Worker's gate.
const costView = {
  tx_count: 1, gross_sales_usd: 10, revenue_usd: 10, net_sales_usd: 10, collected_total_usd: 12, delivery_usd: 2, delivery_sale_count: 1,
  recognized_delivery_usd: 2, cost_usd: 4, profit_usd: 6, profit_excludes_delivery: true,
}
const keys = (lines: ReturnType<typeof buildIncomeStatement>) => lines.map((line) => line.key)

test('normalizeTotals carries the goods-profit flag and notices the courier cost was not sent', () => {
  const seen = normalizeTotals(costView)!
  assert.equal(seen.profit_excludes_delivery, true)
  assert.equal(seen.courier_cost_hidden, true)
  const full = normalizeTotals(admin)!
  assert.equal(full.profit_excludes_delivery, undefined, 'control: the administrator has no flag')
  assert.equal(full.courier_cost_hidden, undefined)
})

test('a cost viewer statement: goods bridge, no delivery terms, no rounding line, honest label', () => {
  const lines = buildIncomeStatement({ sales: normalizeTotals(costView), profitMode: 'gross', khrToUsd })
  const k = keys(lines)
  for (const key of ['delivery_collected', 'delivery_paid', 'profit_rounding', 'delivery_actual_cost', 'delivery_net']) {
    assert.equal(k.includes(key), false, `${key} is not printed for a goods-only profit`)
  }
  assert.ok(k.includes('delivery_charged'), 'the fee charged is public and stays as a memo')
  const profit = lines.find((line) => line.key === 'gross_profit')!
  assert.equal(profit.usd, 6)
  assert.equal(profit.labelKey, 'rpt_profit_excl_delivery')
  assert.equal(profit.hintKey, 'rpt_hint_profit_excl_delivery')
})

test('control: the administrator statement keeps the delivery bridge and the courier memo', () => {
  const lines = buildIncomeStatement({ sales: normalizeTotals(admin), profitMode: 'gross', khrToUsd })
  const k = keys(lines)
  for (const key of ['delivery_collected', 'delivery_paid', 'delivery_actual_cost', 'delivery_net']) assert.ok(k.includes(key), key)
  assert.equal(k.includes('profit_rounding'), false, 'the full bridge foots')
  assert.equal(lines.find((line) => line.key === 'gross_profit')!.labelKey, 'rpt_gross_profit')
  // The old behaviour on the cost viewer's figures: bridging the goods profit
  // with the fee prints a "Rounding" of -$2.00, the fee itself.
  const bridged = buildIncomeStatement({ sales: { ...normalizeTotals(costView)!, profit_excludes_delivery: undefined }, profitMode: 'gross', khrToUsd })
  assert.equal(bridged.find((line) => line.key === 'profit_rounding')?.usd, -2)
})

test('a response with cost but no profit prints no profit at all', () => {
  const t = normalizeTotals({ revenue_usd: 10, cost_usd: 4 })!
  assert.equal(t.cost_usd, 4)
  assert.equal(hasProfit(t), false)
  assert.equal('profit_usd' in t, false)
})

test('sums of cost-view rows keep the flag; labels follow it', () => {
  const rows = [normalizeTotals(costView)!, normalizeTotals(costView)!] as ReportTotals[]
  const sum = sumTotals(rows)
  assert.equal(sum.profit_excludes_delivery, true)
  assert.equal(sum.courier_cost_hidden, true)
  assert.equal(profitLabel(sum, tr), 'Profit (excl. delivery)')
  assert.equal(profitLabel(sumTotals([normalizeTotals(admin)!]), tr), 'Gross profit')
})

test('the strip and Dashboard equation foots on goods profit only when told so', () => {
  assert.equal(profitTerms(costView).length, 2)
  assert.equal(equationResidual(6, profitTerms(costView)), 0)
  assert.notEqual(equationResidual(6, profitTerms({ ...costView, profit_excludes_delivery: false })), 0, 'control: the full terms do not foot')
  assert.equal(equationResidual(6.5, profitTerms(admin)), 0)
})

test('every surface that prints profit reads the flag; both packs carry the label', () => {
  const sales = read('src/components/sales/Sales.tsx')
  assert.match(sales, /const profitExclDelivery = \(stripData\?\.totals as Record<string, unknown> \| undefined\)\?\.profit_excludes_delivery === true/)
  assert.match(sales, /profitTerms\(\{ \.\.\.formulaTotals, profit_excludes_delivery: profitExclDelivery \}\)/)
  const dashboard = read('src/components/dashboard/Dashboard.tsx')
  assert.match(dashboard, /profitTerms\(\{ \.\.\.aFormulaTotals, profit_excludes_delivery: aProfitExclDelivery \}\)/)
  assert.match(dashboard, /const aCourierCostShown = typeof analytics\?\.totals\?\.delivery_actual_cost_usd === 'number'/)
  // periodData is now gated like the totals, so without profit there is no profit chart to offer.
  assert.match(dashboard, /\.\.\.\(aHasProfit \? \[\['profit', profitVsCogsLabel\]\]/)
  assert.match(dashboard, /const chartMode: DashboardChartMode = activeChart === 'profit' && !aHasProfit \? 'revenue' : activeChart/)
  assert.match(read('src/components/dashboard/dashboardExport.ts'), /profit_excludes_delivery === true \? 'Est\. Profit excl\. delivery \(USD\)' : 'Est\. Profit \(USD\)'/)
  assert.match(read('src/components/sales/ExportModal.tsx'), /preview\.summary\?\.profit_excludes_delivery === true \? tr\('rpt_profit_excl_delivery'/)
  for (const rel of ['GroupedReport', 'PeriodReport', 'SalesListReport']) {
    assert.match(read(`src/components/sales/reports/${rel}.tsx`), /profitLabel\(/, rel)
  }
  const exportMap = read('src/components/sales/reports/salesReportExport.ts')
  assert.equal((exportMap.match(/profit_excludes_delivery = true/g) || []).length, 2, 'export rows and totals keep the flag')
  for (const lang of ['en', 'km']) {
    const pack = JSON.parse(read(`src/lang/${lang}.json`)) as Record<string, string>
    assert.ok(pack.rpt_profit_excl_delivery && pack.rpt_hint_profit_excl_delivery, `${lang} pack`)
  }
})

console.log(`\n${passed} cost-view profit display tests passed`)
