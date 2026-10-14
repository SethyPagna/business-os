'use strict'
// The Dashboard "view more" lists (top customers, top products by revenue, top products by quantity) end to end, on the
// real routes with D1 and the Workers Cache API: the list is the card's own ranking, deeper; opening it again within the
// cache window costs a handful of statements, not a second verified snapshot read; and a new sale, a rename or another
// range never serves rows that no longer match.
//
// Fixture: three products, four customers, six sales on 2026-10-05, so every ranking has an order to get wrong
// (the revenue order and the quantity order of the products differ).
//
// Run (from cloudflare/):  node scripts/test-dashboard-insight-list-cache-native.cjs
// Negative controls rewrite source text in memory at bundle time (--wrong=<name>), each must turn the run red:
//   ignore-versions   the key drops the sales version (a new sale keeps serving the old rows)
//   ignore-kind       the key drops the ranking kind (one ranking served as another)
//   ignore-branch     the key drops the branch
//   frozen-names      cached product rows keep the name they were stored with
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const DRC = 'src/lib/dashboardRankingsCache.ts'
const ROUTE = 'src/routes/compat.ts'
const patchFor = (name) => ({
  'ignore-versions': [{ name, file: DRC, from: 'versions[index]]', to: "namespace === 'sales' ? '' : versions[index]]" }],
  'ignore-kind': [{ name, file: DRC, from: "['kind', kind], ", to: '' }],
  'ignore-branch': [{ name, file: DRC, from: "['branchId', filters.branchId], ", to: '' }],
  'frozen-names': [{ name, file: ROUTE, from: "const items = kind === 'top_customers' ? rows : (await applyLiveProductNames(env, [rows as DashboardProductRow[]]))[0]", to: 'const items = rows' }],
})[name]
const flag = name => (process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const WRONG = flag('wrong')
if (WRONG && !patchFor(WRONG)) throw new Error(`unknown --wrong=${WRONG}`)
const day = (date, hourUtc = 3) => `${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`
const QUOTE = (total) => ({ gross_usd: total, product_discount_usd: 0, manual_discount_usd: 0, total_usd: total, total_khr: total * 4000 })
const RANGE = 'startDate=2026-10-05&endDate=2026-10-05'
const KINDS = [['top_customers', 'topCustomers'], ['top_products', 'topProducts'], ['top_products_qty', 'topProductsQty']]

async function main() {
  const h = await H.startWorker({ patches: WRONG ? patchFor(WRONG) : [] })
  const r = H.recorder('DIC')
  try {
    // price: P1 10 (qty small, big revenue), P2 2 (qty large, small revenue), P3 5
    await H.seedProduct(h, 801, 'DIC Serum', 10, 1000, 1)
    await H.seedProduct(h, 802, 'DIC Wipes', 2, 1000, 1)
    await H.seedProduct(h, 803, 'DIC Toner', 5, 1000, 1)
    for (const [id, name, phone] of [[31001, 'DIC Ann', '0121001'], [31002, 'DIC Bo', '0121002'], [31003, 'DIC Chea', '0121003'], [31004, 'DIC Dara', '0121004']]) {
      await h.db.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)').bind(id, name, phone).run()
    }
    let n = 0
    const sell = async (customerId, lines, date = '2026-10-05', extra = {}) => {
      n += 1
      const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
      const res = await H.createSale(h, { key: `dic-${n}`, createdAt: day(date), customerId,
        lines: lines.map(line => ({ productId: line.productId, quantity: line.quantity, quote: QUOTE(line.price * line.quantity) })),
        paymentDetails: [{ method: 'Cash', amount_usd: total, amount_khr: 0 }], extra })
      assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300))
      return res
    }
    await sell(31001, [{ productId: 801, quantity: 1, price: 10 }, { productId: 802, quantity: 8, price: 2 }])
    await sell(31001, [{ productId: 803, quantity: 2, price: 5 }])
    await sell(31002, [{ productId: 802, quantity: 20, price: 2 }])
    await sell(31003, [{ productId: 801, quantity: 8, price: 10 }])
    await sell(31004, [{ productId: 803, quantity: 1, price: 5 }])
    await sell(31002, [{ productId: 801, quantity: 1, price: 10 }])

    const list = async (kind, label, query = RANGE) => {
      const res = await h.call('GET', H.fresh(`/api/dashboard/insight-list?${query}&insight=${kind}`), undefined, label)
      assert.equal(res.status, 200, `${label} answered ${res.status} ${JSON.stringify(res.body).slice(0, 150)}`)
      return { ...res, statements: h.metrics[h.metrics.length - 1].statements }
    }

    // ---- cold: nothing stored, each list builds only its own ranking -------------------
    const cold = {}
    for (const [kind] of KINDS) cold[kind] = await list(kind, `cold ${kind}`)
    r.check('cold lists rank correctly: customers by revenue, products by revenue, products by quantity', () => {
      const customers = cold.top_customers.body.items.map(row => row.net_revenue_usd)
      assert.deepEqual(customers, [...customers].sort((a, b) => b - a), 'customers are ordered by revenue')
      const revenue = cold.top_products.body.items.map(row => row.revenue_usd)
      const qty = cold.top_products_qty.body.items.map(row => row.qty_sold)
      assert.deepEqual(revenue, [...revenue].sort((a, b) => b - a), 'products are ordered by revenue')
      assert.deepEqual(qty, [...qty].sort((a, b) => b - a), 'products are ordered by quantity')
      assert.notDeepEqual(cold.top_products.body.items.map(row => row.product_name), cold.top_products_qty.body.items.map(row => row.product_name), 'the two product orders differ in this fixture')
      assert.equal(cold.top_customers.body.items[0].customer_name, 'DIC Chea')
      assert.equal(cold.top_products.body.items[0].product_name, 'DIC Serum')
      assert.equal(cold.top_products_qty.body.items[0].product_name, 'DIC Wipes')
    })

    // ---- the card is the same ranking, and stores it ------------------------------------
    const card = await h.call('GET', H.fresh(`/api/analytics?${RANGE}&granularity=day`), undefined, 'dashboard card')
    r.check('the card shows the same rows as the lists, in the same order', () => {
      assert.equal(card.status, 200)
      for (const [kind, key] of KINDS) assert.deepEqual(card.body[key], cold[kind].body.items.slice(0, 20), `${key} equals the head of the ${kind} list`)
    })

    // ---- warm: a second open reads what the card stored ---------------------------------
    const warm = {}
    for (const [kind] of KINDS) warm[kind] = await list(kind, `warm ${kind}`)
    r.check('a warm list is the cold list, row for row', () => {
      for (const [kind] of KINDS) assert.deepEqual(warm[kind].body, cold[kind].body, kind)
    })
    r.check('a warm list costs at most 3 D1 statements (no second snapshot read)', () => {
      for (const [kind] of KINDS) assert.ok(warm[kind].statements <= 3, `${kind} took ${warm[kind].statements} statements; cold took ${cold[kind].statements}`)
      for (const [kind] of KINDS) assert.ok(cold[kind].statements > warm[kind].statements + 5, `${kind}: the cold read (${cold[kind].statements}) is the snapshot cost the cache removes`)
    })

    // ---- the key separates what it must ---------------------------------------------------
    const otherDay = await list('top_products', 'other day', 'startDate=2026-10-04&endDate=2026-10-04')
    const branch2 = await list('top_products', 'branch 2', `${RANGE}&branchId=2`)
    r.check('another range or another branch is never served from these rows', () => {
      assert.deepEqual(otherDay.body.items, [], 'a day with no sales has no ranking')
      assert.deepEqual(branch2.body.items, [], 'branch 2 sold nothing')
    })
    const asCustomers = await list('top_customers', 'customers again')
    r.check('a ranking kind is never served as another', () => {
      assert.ok('customer_name' in asCustomers.body.items[0] && !('product_name' in asCustomers.body.items[0]))
      assert.ok('product_name' in warm.top_products.body.items[0])
    })

    // ---- a name change shows at once on a stored list --------------------------------------
    await h.db.prepare("UPDATE products SET name = 'DIC Serum Renamed' WHERE id = 801").run()
    const renamed = await list('top_products', 'renamed product')
    r.check('a stored product row shows the product under its current name', () => {
      assert.equal(renamed.body.items[0].product_name, 'DIC Serum Renamed')
    })

    // ---- a new sale makes the stored rows unreachable ----------------------------------------
    await sell(31004, [{ productId: 801, quantity: 10, price: 10 }])
    const afterSale = {}
    for (const [kind] of KINDS) afterSale[kind] = await list(kind, `after a new sale ${kind}`)
    r.check('a new sale changes every list at once (stored rows are not served past a write)', () => {
      assert.equal(afterSale.top_customers.body.items[0].customer_name, 'DIC Dara', 'DIC Dara is now the top customer')
      assert.equal(afterSale.top_customers.body.items[0].net_revenue_usd, 105)
      assert.equal(afterSale.top_products.body.items[0].revenue_usd, 200)
      assert.notDeepEqual(afterSale.top_products.body.items, renamed.body.items)
    })
    const freshCard = await h.call('GET', H.fresh(`/api/analytics?${RANGE}&granularity=day`), undefined, 'dashboard card after write')
    r.check('the lists after the write equal a fresh card', () => {
      const fresh = freshCard
      for (const [kind, key] of KINDS) assert.deepEqual(fresh.body[key], afterSale[kind].body.items.slice(0, 20), `${key} equals the head of the ${kind} list`)
    })

  } finally {
    await h.mf.dispose?.()
  }
  const failed = r.results.filter(entry => !entry.ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} dashboard insight list cache: ${r.results.length - failed.length}/${r.results.length} checks hold${WRONG ? ` (mutant --wrong=${WRONG})` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error); process.exit(1) })
