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
const MONEY = 'function reportMoney(row: ReportScalarRow, key: string, version: 0 | 1, nullableZero = true): ReportExactDecimal {'
const MONEY_COUNT = `${MONEY}\n  const reads = (globalThis as { __saleMoneyReads?: Record<string, number> }).__saleMoneyReads\n  if (reads && Object.hasOwn(reads, key)) reads[key] += 1`
const REUSED = '    const { subtotal, storeDiscount, membershipDiscount } = fact'
const REPARSED = "    const subtotal = reportMoney(sale, 'subtotal_usd', version)\n    const storeDiscount = reportMoney(sale, 'discount_usd', version)\n    const membershipDiscount = reportMoney(sale, 'membership_discount_usd', version)"

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

async function headerReads(patches = []) {
  const world = makeKernelWorld({ patches: [{ file: 'src/lib/salesAnalytics.ts', from: DERIVE, to: COUNT },
    { file: 'src/lib/salesAnalytics.ts', from: MONEY, to: MONEY_COUNT }, ...patches] })
  try {
    seed(world)
    world.sqlite.exec('UPDATE sales SET subtotal_usd=subtotal_usd+0.75,discount_usd=0.5,membership_discount_usd=0.25')
    const a = world.analytics, snapshot = await a.readSalesReportSnapshot(world.env, FILTERS)
    assert.ok(snapshot.sales.length > 0)
    globalThis.__saleFactPasses = 0
    globalThis.__saleMoneyReads = { subtotal_usd: 0, discount_usd: 0, membership_discount_usd: 0 }
    const pack = value => ({ value, diagnostic: a.reportMoneyDiagnostic(value) })
    const totals = pack(a.salesTotalsFromSnapshot(snapshot)), first = { ...globalThis.__saleMoneyReads }
    const precise = pack(a.salesTotalsFromSnapshot(snapshot, 4)), status = pack(a.exportStatusSplitFromSnapshot(snapshot))
    const repeated = { ...globalThis.__saleMoneyReads }, repeatedPasses = globalThis.__saleFactPasses
    const copied = { ...snapshot, sales: snapshot.sales.map(row => ({ ...row })) }
    const fresh = pack(a.salesTotalsFromSnapshot(copied)), afterFresh = { ...globalThis.__saleMoneyReads }
    return { count: snapshot.sales.length, first, repeated, repeatedPasses, afterFresh,
      freshPasses: globalThis.__saleFactPasses, answers: { totals, precise, status, fresh } }
  } finally {
    delete globalThis.__saleMoneyReads
    world.sqlite.close()
  }
}
function assertHeaderReuse(result) {
  for (const key of ['subtotal_usd', 'discount_usd', 'membership_discount_usd']) {
    assert.equal(result.first[key], result.count, `${key} parsed once per sale`)
    assert.equal(result.repeated[key], result.count, `${key} reused across views`)
    assert.equal(result.afterFresh[key], result.count * 2, `${key} parsed for a fresh snapshot`)
  }
  assert.equal(result.repeatedPasses, 1)
  assert.equal(result.freshPasses, 2)
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
  let reused
  await check('three sale headers are parsed once and reused across views; a fresh snapshot derives again', async () => {
    reused = await headerReads()
    assertHeaderReuse(reused)
    assert.deepEqual(reused.answers.fresh, reused.answers.totals)
    assert.equal(reused.answers.totals.value.store_discount_usd, reused.count * 0.5)
    assert.equal(reused.answers.totals.value.membership_discount_usd, reused.count * 0.25)
  })
  await check('control: redundant reparses preserve money and diagnostics but fail the cost check', async () => {
    const mutant = await headerReads([{ file: 'src/lib/salesAnalytics.ts', from: REUSED, to: REPARSED }])
    assert.deepEqual(mutant.answers, reused.answers)
    assert.throws(() => assertHeaderReuse(mutant), /parsed once per sale/)
  })
  await check('control: swapping retained amounts is caught despite unchanged parse counts', async () => {
    const mutant = await headerReads([{ file: 'src/lib/salesAnalytics.ts', from: REUSED,
      to: '    const { subtotal: storeDiscount, storeDiscount: subtotal, membershipDiscount } = fact' }])
    assertHeaderReuse(mutant)
    assert.notDeepEqual(mutant.answers, reused.answers)
  })
  console.log(`\nGREEN shared sale facts: ${passed} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
