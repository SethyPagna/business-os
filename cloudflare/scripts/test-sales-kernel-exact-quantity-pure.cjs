'use strict'
// Quantities and averages leave the kernel exact, at the places of the row they sit on.
//
//   1. getProductSalesReport sums each product's quantity (and the window's) as exact decimals. A float sum
//      reports 0.1 + 0.2 as 0.30000000000000004, and ten lines of 0.1 as 0.9999999999999999.
//   2. The Dashboard / export product rows (productRevenueGroups) sum quantities the same way and round the
//      displayed quantity from the exact value: 1.005 shows as 1.01, where a float round reads 1.00, and the
//      "Other products" row adds its groups exactly (0.5 + 0.505 is 1.005, not 1.00).
//   2b. A stored quantity that itself carries float noise (0.30000000000000004) is summed and reported as 0.3; the
//      report neither fails nor repeats the noise.
//   3. avg_order_usd follows the places of the row it sits on: 4 places on a bucket row, cents on the headline.
//      Rounding the average to cents on a 4-place row made the row disagree with its own revenue / tx_count.
//
// Each case runs on the real kernel and again with a mutant that restores the old float behaviour; the file only
// passes when every mutant is caught.
//
// Run (from cloudflare/): node scripts/test-sales-kernel-exact-quantity-pure.cjs
const assert = require('node:assert/strict')
const { makeKernelWorld } = require('./harness/kernel_sqlite_world.cjs')

const FILE = 'src/lib/salesAnalytics.ts'
const FILTERS = { startDate: '2026-10-01', endDate: '2026-10-31' }

function world(patches, sales) {
  const w = makeKernelWorld({ patches })
  const { sqlite } = w
  for (const column of ['barcode TEXT', 'category TEXT', 'stock_quantity REAL']) sqlite.exec(`ALTER TABLE products ADD COLUMN ${column}`)
  const product = sqlite.prepare('INSERT OR IGNORE INTO products(id,name) VALUES(?,?)')
  const sale = sqlite.prepare("INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,payment_method,subtotal_usd,total_usd,amount_paid_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd) VALUES(?,?,'completed',1,'Shop','Cash',?,?,?,1,?,0)")
  const item = sqlite.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(?,?,?,?,?,?,1)')
  let itemId = 0
  sales.forEach((lines, index) => {
    const id = index + 1
    const total = lines.reduce((acc, line) => acc + line.total, 0)
    sale.run(id, '2026-10-02 03:00:00', total, total, total, total)
    for (const line of lines) { product.run(line.product, `P${line.product}`); item.run(++itemId, id, line.product, `P${line.product}`, line.qty, line.total) }
  })
  return w
}

// ---- fixtures -----------------------------------------------------------------------------------------------
// ten products of 0.1 first, then one product sold as 0.1 and 0.2 in two sales
const reportSales = [
  ...Array.from({ length: 10 }, (_, i) => [{ product: 11 + i, qty: 0.1, total: 1 }]),
  [{ product: 1, qty: 0.1, total: 1 }], [{ product: 1, qty: 0.2, total: 1 }],
]
// 101 products: the 99 dearest are named, the two cheapest fall into "Other products" (0.5 + 0.505 = 1.005)
const splitSales = Array.from({ length: 101 }, (_, i) => {
  const k = i + 1
  return [{ product: k, qty: k === 101 ? 1.005 : k === 1 ? 0.5 : k === 2 ? 0.505 : 1, total: k }]
})
// three sales that add up to 10.00 over 3 transactions: 10 / 3 = 3.3333
const averageSales = [[{ product: 1, qty: 1, total: 3.33 }], [{ product: 1, qty: 1, total: 3.33 }], [{ product: 1, qty: 1, total: 3.34 }]]

const noisySales = [[{ product: 1, qty: 0.30000000000000004, total: 1 }]]

// ---- mutants: the old float behaviour, one per sink --------------------------------------------------------
// rowQty and totalQty put back the plain `+= Number(...)` accumulation and the unconverted number.
const mutants = {
  rowQty: [
    { file: FILE, from: 'saleIds: new Set<number>(), qty: ReportExactDecimal.zero(),\n      lineSales', to: 'saleIds: new Set<number>(), qty: 0,\n      lineSales' },
    { file: FILE, from: 'group.qty = group.qty.add(quantity)\n    group.saleIds', to: 'group.qty += Number(item.quantity)\n    group.saleIds' },
    { file: FILE, from: 'qty: reportQuantity(group.qty),\n', to: 'qty: group.qty,\n' },
    { file: FILE, from: 'all.qty = all.qty.add(group.qty); all.lineSales', to: 'all.qty = all.qty.add(ReportExactDecimal.recorded(String(group.qty))); all.lineSales' },
  ],
  totalQty: [
    { file: FILE, from: 'const all = { sales: new Set<number>(), qty: ReportExactDecimal.zero(), lineSales', to: 'const all = { sales: new Set<number>(), qty: 0, lineSales' },
    { file: FILE, from: 'all.qty = all.qty.add(group.qty); all.lineSales', to: 'all.qty += reportQuantity(group.qty); all.lineSales' },
    { file: FILE, from: 'qty: reportQuantity(all.qty), line_sales_usd', to: 'qty: all.qty, line_sales_usd' },
  ],
  noisyQty: [{ file: FILE, from: 'return Number(sum.toText(QUANTITY_SUM_PLACES))', to: 'return sum.toExactNumber()' }],
  average: [{ file: FILE, from: 'ReportExactDecimal.recorded(String(bucket.tx))).toNumber(places)', to: 'ReportExactDecimal.recorded(String(bucket.tx))).toNumber()' }],
  namedQty: [
    { file: FILE, from: 'product_name: group.name, qty_sold: group.qty.toNumber(2),', to: 'product_name: group.name, qty_sold: round2(Number(group.qty.toText(12))),' },
    { file: FILE, from: '    qty_sold: group.qty.toNumber(2), revenue_usd: group.units / MONEY_UNITS,\n  }))', to: '    qty_sold: round2(Number(group.qty.toText(12))), revenue_usd: group.units / MONEY_UNITS,\n  }))' },
  ],
  otherQty: [{ file: FILE, from: 'rest.reduce((acc, group) => acc.add(group.qty), ReportExactDecimal.zero()).toNumber(2)', to: 'round2(rest.reduce((acc, group) => acc + Number(group.qty.toText(12)), 0))' }],
}

// ---- the cases -------------------------------------------------------------------------------------------------
const cases = {
  async rowQty(patches) {
    const report = await world(patches, reportSales).analytics.getProductSalesReport({}, FILTERS)
    return report.rows.find((row) => row.product_id === 1).qty
  },
  async totalQty(patches) {
    return (await world(patches, reportSales).analytics.getProductSalesReport({}, FILTERS)).totals.qty
  },
  async noisyQty(patches) {
    return (await world(patches, noisySales).analytics.getProductSalesReport({}, FILTERS)).rows[0].qty
  },
  async average(patches) {
    const w = world(patches, averageSales)
    const snapshot = await w.analytics.readSalesReportSnapshot(w.env, FILTERS)
    const grouped = await w.analytics.getSalesGroupedReport(w.env, FILTERS, 'payment_method')
    return { row: grouped.rows[0].avg_order_usd, headline: w.analytics.salesTotalsFromSnapshot(snapshot).avg_order_usd }
  },
  async namedQty(patches) {
    const w = world(patches, splitSales)
    const snapshot = await w.analytics.readSalesReportSnapshot(w.env, FILTERS)
    const split = await w.analytics.exportProductSplitFromSnapshot(w.env, snapshot)
    const rankings = w.analytics.dashboardRankingsFromSnapshot(snapshot)
    return { export: split.find((row) => row.product_id === 101).qty_sold, dashboard: rankings.topProducts.find((row) => row.product_id === 101).qty_sold }
  },
  async otherQty(patches) {
    const w = world(patches, splitSales)
    const snapshot = await w.analytics.readSalesReportSnapshot(w.env, FILTERS)
    return (await w.analytics.exportProductSplitFromSnapshot(w.env, snapshot)).find((row) => row.product_name === 'Other products').qty_sold
  },
}
const expected = {
  rowQty: 0.3,
  totalQty: 1.3,
  noisyQty: 0.3,
  average: { row: 3.3333, headline: 3.33 },
  namedQty: { export: 1.01, dashboard: 1.01 },
  otherQty: 1.01,
}
const labels = {
  rowQty: 'a product sold as 0.1 and 0.2 reports 0.3 (not 0.30000000000000004)',
  totalQty: 'the window total of ten 0.1 lines and 0.3 reports 1.3 (not a float sum)',
  noisyQty: 'a stored quantity of 0.30000000000000004 reports 0.3 and does not fail the report',
  average: 'avg_order_usd is 3.3333 on a 4-place bucket row and 3.33 on the headline',
  namedQty: 'a quantity of 1.005 shows as 1.01 on the export row and the Dashboard ranking',
  otherQty: 'the "Other products" row adds 0.5 + 0.505 exactly and shows 1.01',
}

async function main() {
  // the instrument: the float drift this file guards is real on this machine
  assert.notEqual(0.1 + 0.2, 0.3)
  assert.notEqual(Array(10).fill(0.1).reduce((a, b) => a + b, 0) + 0.3, 1.3)
  assert.equal(Math.round(1.005 * 100) / 100, 1)
  assert.equal(Math.round((0.5 + 0.505) * 100) / 100, 1)
  let passed = 0
  for (const name of Object.keys(cases)) {
    assert.deepEqual(await cases[name]([]), expected[name], labels[name])
    passed += 1; console.log(`PASS ${labels[name]}`)
    // a mutant is caught when it answers wrongly or refuses outright
    const caught = await cases[name](mutants[name]).then((value) => { try { assert.deepEqual(value, expected[name]); return false } catch { return true } }, () => true)
    assert.ok(caught, `control: the old-behaviour mutant of "${name}" must be caught`)
    passed += 1; console.log(`PASS control: the old-behaviour mutant of "${name}" is caught`)
  }
  console.log(`\nGREEN exact quantities and averages: ${passed} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
