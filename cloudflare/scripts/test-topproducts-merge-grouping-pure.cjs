'use strict'
// p6/efficiency-3 step 3 (coordinator-added linkage sweep finding), re-pointed at the kernel
// (release-2 refuter BL-1, 13 Oct 2026).
//
// The Dashboard's "top products" lists and the Sales export preview's product breakdown used
// to GROUP BY (product_id, product_name) in SQL. After a product merge (migration 0165+) the
// keeper id's sale_items rows carry SEVERAL pre-merge product_name snapshots across different
// sales, so that pair-grouping split one merged product's history back into N rows -- one per
// historical name -- instead of one row under the product's current name.
//
// Both surfaces now read ONE kernel function (productRevenueGroups in lib/salesAnalytics.ts,
// through dashboardRankingsFromSnapshot / exportProductSplitFromSnapshot) and take the display
// name from `products` (applyLiveProductNames / liveProductNames). This test runs those real
// functions against a real SQLite fixture with
//   * one keeper id sold under two legacy names, and the keeper renamed since, and
//   * two NULL-id legacy lines with different names, which must stay two rows (a deleted
//     product's line falls back to its own snapshot name and is never merged into a NULL bucket)
// and requires the Dashboard card, the Dashboard "view more" ranking and the export preview to
// give the same answer: one keeper row, current name, quantity and revenue summed across names.
//
// Controls: three mutants of the kernel are run on the same fixture and each MUST be caught --
// the old (id, name) pair grouping (the regression this locks against), a live-name lookup that
// is skipped, and NULL-id lines merged into one bucket.
//
// Run (from cloudflare/): node scripts/test-topproducts-merge-grouping-pure.cjs
const assert = require('node:assert/strict')
const { makeKernelWorld } = require('./harness/kernel_sqlite_world.cjs')

const FILTERS = { startDate: '2026-10-01', endDate: '2026-10-31' }
const KEY_LINE = "const key = id == null ? `name:${name.trim().toLowerCase()}` : `id:${id}`"
const EXPORT_NAME = 'product_name: (group.id != null && live.get(group.id)) || group.name,'
const DASHBOARD_NAME = 'product_name: (row.product_id != null && live.get(row.product_id)) || row.product_name'

function seed(world) {
  const { sqlite } = world
  sqlite.exec("INSERT INTO products(id,name) VALUES (1,'Current Canonical Name')")
  const sale = sqlite.prepare("INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,payment_method,subtotal_usd,total_usd,amount_paid_usd,money_precision_version,calculated_total_usd,rounding_adjustment_usd) VALUES(?,?,?,?,?,?,?,?,?,1,?,0)")
  const item = sqlite.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(?,?,?,?,?,?,?)')
  const lines = [[100, 1, 'Old Name A', 3, 30], [101, 1, 'Old Name B', 5, 50], [102, 1, 'Old Name A', 2, 20],
    [200, null, 'Legacy Import Row', 1, 9], [201, null, 'Another Legacy Row', 2, 18]]
  lines.forEach(([saleId, productId, name, qty, total], index) => {
    sale.run(saleId, '2026-10-05 03:00:00', 'completed', 1, 'Shop', 'Cash', total, total, total, total)
    item.run(index + 1, saleId, productId, name, qty, total, 1)
  })
}

const shape = (rows) => rows.map((row) => [row.product_id, row.product_name, row.qty_sold, row.revenue_usd])
const sorted = (rows) => shape(rows).map((row) => JSON.stringify(row)).sort()

async function problems(patches = []) {
  const world = makeKernelWorld({ patches })
  seed(world)
  const snapshot = await world.analytics.readSalesReportSnapshot(world.env, FILTERS)
  const ranked = world.analytics.dashboardRankingsFromSnapshot(snapshot)
  const [card, byQty] = await world.analytics.applyLiveProductNames(world.env, [ranked.topProducts, ranked.topProductsQty])
  const exported = await world.analytics.exportProductSplitFromSnapshot(world.env, snapshot)
  const found = []
  const expected = [
    [1, 'Current Canonical Name', 10, 100],
    [null, 'Legacy Import Row', 1, 9],
    [null, 'Another Legacy Row', 2, 18],
  ].map((row) => JSON.stringify(row)).sort()
  for (const [label, rows] of [['Dashboard top products by revenue', card], ['Dashboard top products by quantity', byQty], ['export preview product rows', exported]]) {
    const got = sorted(rows)
    if (JSON.stringify(got) !== JSON.stringify(expected)) found.push(`${label}: ${got.join(' ')}`)
  }
  return found
}

async function main() {
  let passed = 0
  const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`) }

  await check('one keeper id sold under two legacy names is ONE row under its current name, on the Dashboard card, its by-quantity list and the export preview', async () => {
    assert.deepEqual(await problems(), [])
  })

  const mutants = [
    ['the old (product_id, product_name) pair grouping', [{ file: 'src/lib/salesAnalytics.ts', from: KEY_LINE, to: 'const key = `${id}:${name}`' }]],
    ['a live-name lookup that is skipped', [
      { file: 'src/lib/salesAnalytics.ts', from: EXPORT_NAME, to: 'product_name: group.name,' },
      { file: 'src/lib/salesAnalytics.ts', from: DASHBOARD_NAME, to: 'product_name: row.product_name' },
    ]],
    ['NULL-id legacy lines merged into one bucket', [{ file: 'src/lib/salesAnalytics.ts', from: KEY_LINE, to: "const key = id == null ? 'name:' : `id:${id}`" }]],
  ]
  for (const [label, patches] of mutants) {
    await check(`control: ${label} is caught`, async () => {
      const found = await problems(patches)
      assert.ok(found.length > 0, `mutant "${label}" produced the expected rows`)
    })
  }

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
