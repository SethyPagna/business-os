'use strict'
// One verified snapshot, many views: the Dashboard path (headline, period series, payment and branch cards,
// top customers / hours / products) and the Sales export preview (headline, status split, product split)
// each walk the SAME per-sale facts, which are the expensive part of the kernel (exact decimals, return
// cohorts). Release-2 refuter SF-3: 6.0.118 added two groupings to the Dashboard path and two passes to the
// export preview, and the CPU of one request doubled (export 1 pass -> 3, Dashboard 2 -> 7) because every
// view re-derived the facts.
//
// The facts are derived once per snapshot and shared. This test counts derivations on the REAL kernel (the
// derivation function is wrapped in memory) while every view runs on one snapshot, and requires exactly one;
// a mutant without the cache is run on the same fixture and must be caught. It also requires the views to
// agree with each other, so sharing facts cannot hide a view reading someone else's rows.
//
// Run (from cloudflare/): node scripts/test-sales-kernel-shared-facts-pure.cjs
const assert = require('node:assert/strict')
const { makeKernelWorld } = require('./harness/kernel_sqlite_world.cjs')

const FILTERS = { startDate: '2026-10-01', endDate: '2026-10-31' }
const DERIVE = 'function deriveReportSaleFacts(snapshot: SalesReportSnapshot): ReportSaleFacts[] {'
const COUNT = `${DERIVE}\n  ;(globalThis as { __saleFactPasses?: number }).__saleFactPasses = ((globalThis as { __saleFactPasses?: number }).__saleFactPasses || 0) + 1`
const CACHE_HIT = '  const known = SALE_FACTS.get(snapshot)\n  if (known) return known\n'

function seed(world) {
  const { sqlite } = world
  sqlite.exec("INSERT INTO products(id,name) VALUES (1,'P1'),(2,'P2')")
  sqlite.exec("INSERT INTO customers(id,name,phone) VALUES (1,'Alice','011'),(2,'Bob','022')")
  const sale = sqlite.prepare("INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,customer_id,customer_name,payment_method,subtotal_usd,total_usd,amount_paid_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,0)")
  const item = sqlite.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(?,?,?,?,?,?,?)')
  for (let id = 1; id <= 12; id++) {
    const total = 5 + id
    sale.run(id, `2026-10-0${1 + (id % 5)} ${String(2 + (id % 9)).padStart(2, '0')}:00:00`, id === 12 ? 'cancelled' : 'completed', 1 + (id % 2), id % 2 ? 'Shop' : 'Store',
      1 + (id % 2), id % 2 ? 'Alice' : 'Bob', id % 3 ? 'Cash' : 'ABA', total, total, total, total)
    item.run(id, id, 1 + (id % 2), `P${1 + (id % 2)}`, 1 + (id % 3), total, 2)
  }
}

async function run(patches = []) {
  const world = makeKernelWorld({ patches })
  seed(world)
  globalThis.__saleFactPasses = 0
  const a = world.analytics
  // the export preview's views on one snapshot
  const exportSnapshot = await a.readSalesReportSnapshot(world.env, FILTERS)
  const totals = a.salesTotalsFromSnapshot(exportSnapshot)
  const status = a.exportStatusSplitFromSnapshot(exportSnapshot)
  const products = await a.exportProductSplitFromSnapshot(world.env, exportSnapshot)
  const exportPasses = globalThis.__saleFactPasses
  // the Dashboard path: it reads its own snapshot and takes every view from it
  globalThis.__saleFactPasses = 0
  const dashboard = await a.getSalesTotalsAndPeriodSeries(world.env, FILTERS, 'day')
  const dashboardPasses = globalThis.__saleFactPasses
  return { totals, status, products, dashboard, exportPasses, dashboardPasses }
}

async function main() {
  let passed = 0
  const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`) }
  const counted = [{ file: 'src/lib/salesAnalytics.ts', from: DERIVE, to: COUNT }]
  let base
  await check('the export preview (headline, status split, product split) derives the per-sale facts once', async () => {
    base = await run(counted)
    assert.equal(base.exportPasses, 1)
  })
  await check('the Dashboard path (headline, series, payment and branch cards, customers, hours, products) derives the per-sale facts once', () => {
    assert.equal(base.dashboardPasses, 1)
  })
  await check('the views agree: the headline of one is the headline of the other, and the splits add up to it', () => {
    assert.equal(base.dashboard.totals.revenue_usd, base.totals.revenue_usd)
    const sum = (rows, key) => Number(rows.reduce((acc, row) => acc + row[key], 0).toFixed(4))
    assert.equal(sum(base.status, 'revenue'), sum(base.dashboard.byPayment, 'revenue_usd'))
    assert.equal(sum(base.products, 'revenue_usd'), sum(base.dashboard.topCustomers, 'net_revenue_usd'))
    assert.ok(base.totals.revenue_usd > 0 && base.dashboard.byPayment.length >= 2 && base.dashboard.topCustomers.length === 2)
  })
  await check('control: without the cache every view re-derives the facts and this file notices', async () => {
    const mutant = await run([...counted, { file: 'src/lib/salesAnalytics.ts', from: CACHE_HIT, to: '' }])
    assert.ok(mutant.exportPasses >= 3, `export passes ${mutant.exportPasses}`)
    assert.ok(mutant.dashboardPasses >= 5, `dashboard passes ${mutant.dashboardPasses}`)
    assert.deepEqual(mutant.totals, base.totals, 'the answers are the same either way; only the cost differs')
  })
  console.log(`\nGREEN shared sale facts: ${passed} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
