'use strict'
// AL finding L4 (13 Oct 2026): a cost viewer without the courier-cost permission
// (sales:view_courier_cost, lib/courierCostAccess.ts) must not be able to
// recover the courier's actual cost. Dropping the courier-cost keys is not
// enough -- the kernel's profit is revenue - cost + fees - courier cost, so
// with revenue, cost and fees public the cost falls out by subtraction. The
// cost viewer is sent GOODS profit (revenue - cost) with
// `profit_excludes_delivery: true`. This file pins the restatement itself
// (lib/reportProfitView.ts) and that every report gate a cost viewer can
// reach routes through it; test-al-money-l-native.cjs checks the mounted
// /overview and /periods end to end.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')

const root = path.join(__dirname, '..')
const load = (relative) => {
  const mod = { exports: {} }
  const source = transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(require, mod, mod.exports)
  return mod.exports
}
const { costViewProfit, COURIER_COST_KEYS } = load('src/lib/reportProfitView.ts')

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }
// The recovery the finding names: fee - (profit - revenue + cost).
const recovered = (row) => Number((row.recognized_delivery_usd - (row.profit_usd - row.revenue_usd + row.cost_usd)).toFixed(4))

// An administrator's window: $10 revenue, $4 goods cost, a $2 fee charged and
// a $1.50 courier, so profit is 10 - 4 + 2 - 1.5 = 6.5.
const admin = {
  revenue_usd: 10, cost_usd: 4, profit_usd: 6.5, margin_pct: 65, recognized_delivery_usd: 2, delivery_usd: 2,
  recognized_delivery_cost_usd: 1.5, delivery_actual_cost_usd: 1.5, delivery_actual_cost_count: 1,
  delivery_margin_usd: 0.5, delivery_net_usd: 0.5, pending_delivery_cost_usd: 0.25,
  pending_revenue_usd: 3, pending_cost_usd: 1, pending_profit_usd: 2.75, pending_delivery_usd: 1,
  removal_loss_usd: 0.5, revenue_after_losses_usd: 9.5, profit_after_losses_usd: 6,
}

check('control: on the administrator figures the courier cost IS recoverable ($1.50)', () => {
  assert.equal(recovered(admin), 1.5)
})

const seen = costViewProfit(admin)
check(`cost view: courier-cost keys are gone (${COURIER_COST_KEYS.length} keys)`, () => {
  for (const key of COURIER_COST_KEYS) assert.equal(key in seen, false, key)
})
check(`cost view: profit is goods only, $${seen.profit_usd}, and recovers the fee, not the courier ($${recovered(seen)})`, () => {
  assert.equal(seen.profit_usd, 6)
  assert.notEqual(recovered(seen), 1.5)
  assert.equal(seen.profit_excludes_delivery, true)
})
check('cost view: margin, pending profit and profit-incl-losses are restated on the same basis', () => {
  assert.equal(seen.margin_pct, 60)
  assert.equal(seen.pending_profit_usd, 2, 'pending revenue 3 - pending cost 1; the pending courier is not a term')
  assert.equal(seen.profit_after_losses_usd, 5.5)
  // Pending block: the old pending_profit (2.75) with pending revenue, cost and
  // fee public gave the pending courier (0.25) by subtraction too.
  assert.notEqual(Number((1 - (seen.pending_profit_usd - 3 + 1)).toFixed(4)), 0.25)
})
check('cost view: public figures are untouched and absent keys stay absent', () => {
  for (const key of ['revenue_usd', 'cost_usd', 'recognized_delivery_usd', 'delivery_usd', 'pending_revenue_usd', 'removal_loss_usd']) assert.equal(seen[key], admin[key], key)
  const bare = costViewProfit({ revenue_usd: 5, cost_usd: 2, profit_usd: 3 })
  assert.deepEqual(Object.keys(bare).sort(), ['cost_usd', 'profit_excludes_delivery', 'profit_usd', 'revenue_usd'])
  // A row with no profit figure (a day-report receipt row) gains no flag.
  assert.deepEqual(costViewProfit({ revenue_usd: 1.005, collected_usd: 1.01 }), { revenue_usd: 1.005, collected_usd: 1.01 })
})
check('a business-summary receipt row: gross profit is net revenue less its cost', () => {
  const row = costViewProfit({ net_revenue_usd: 10.005, cost_usd: 4.0025, gross_profit_usd: 7.5025, delivery_usd: 2 })
  assert.equal(row.gross_profit_usd, 6.0025, 'a 4-place bucket row stays at 4 places')
  assert.equal(row.profit_excludes_delivery, true)
})

// Every route gate a cost viewer reaches must restate profit through the helper.
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const reports = read('src/routes/reports.ts')
const sales = read('src/routes/sales.ts')
const compat = read('src/routes/compat.ts')
check('reports.ts: gateTotals and the business-summary row gate route the cost view through costViewProfit', () => {
  assert.match(reports, /if \(!isAdmin && canViewCosts && !canViewCourier\) \{[\s\S]{0,400}return costViewProfit\(gateTotals\(row, true, true, places\)\)/)
  assert.match(reports, /export function gateBusinessSummarySaleRow\(row: Record<string, unknown>, isAdmin: boolean, canViewCosts = isAdmin, canViewCourier = isAdmin\)/)
  assert.match(reports, /if \(!isAdmin && !canViewCourier\) return costViewProfit\(adminRow\)/)
  assert.equal((reports.match(/gateBusinessSummarySaleRow\(row, isAdmin, /g) || []).length, 2, 'the export and the paged list pass both authorities')
})
check('sales.ts: the strip, daily report, day report, customer totals and the export summary use the cost view', () => {
  assert.match(sales, /if\(canViewCosts\)return costViewProfit\(row\)/)
  assert.match(sales, /const summaryView = canViewCourierCost\(exportUser\) \|\| !canViewAcquisitionCosts\(exportUser\) \? summary : \{ \.\.\.summary,\s+gross_profit_usd: goodsProfitUsd,/)
  assert.match(sales, /const goodsProfitUsd = round2\(netRevenueUsd - salesTotals\.cost_usd\)/)
  assert.match(sales, /period, summary: summaryView,/)
})
check('compat.ts: Dashboard period rows pass the same gate as its totals', () => {
  assert.match(compat, /periodData: \(periodData \|\| \[\]\)\.map\(\(row\) => gateTotals\(row as unknown as Record<string, unknown>, isAdmin, canViewCosts, BUCKET_MONEY_PLACES, canViewCourier\)\)/)
})

console.log(`\nALL ${passed} CHECKS PASSED (cost viewer receives goods profit; the courier cost is not recoverable)`)
