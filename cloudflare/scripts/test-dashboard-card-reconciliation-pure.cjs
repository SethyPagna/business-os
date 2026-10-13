'use strict'
// One revenue definition, sliced. The Dashboard's payment-method and branch cards
// and the Sales export preview's by_status / by_product splits used to be SQL of
// their own (net sale minus refund per group, every sale's rounding adjustment
// left out; the export reconciled its rows to the cent by largest remainder). They
// disagreed with Reports' buckets and with the Dashboard's own headline by a few
// cents, more with volume (Sonnet area review of release 2, finding 4).
//
// They are now slices of the kernel's verified snapshot, at 4 places (owner,
// 13 Oct 2026: split reports carry 4 decimals, a single headline keeps cents).
// This is the reviewer's reconciliation fuzz (4-decimal prices, costs and delivery
// fees, partial and full refunds, rounding adjustments, two branches, three payment
// methods, cancelled sales) pointed at those slices:
//
//   * every Dashboard card row equals the Reports bucket of the same key, 4 places,
//   * the cards sum to the Reports payment / branch buckets exactly,
//   * the headline (cents) is within half a cent of what the rows sum to,
//   * the export's by_status and by_product rows sum to the same figure exactly,
//   * the Dashboard's top customers, busy hours and top products (SF-4, release-2 refuter) are the
//     Reports customer / hour buckets and the export's product rows, at 4 places,
//   * and the Dashboard path reads the database no more than getSalesTotals does.
//
// Controls: the OLD card SQL is run on the same database and must miss the headline
// by more than half a cent on some seed (the instrument sees the gap); cent-rounded
// rows must fail the 4-place check; and three mutants of the new code (cards rounded
// to cents, product allocation without its remainder, product revenue without the
// rounding adjustment) must each be caught.
//
// Run: node scripts/test-dashboard-card-reconciliation-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const r4 = (value) => Number(Number(value).toFixed(4))
const r2 = (value) => Number(Number(value).toFixed(2))

function makeWorld(seedValue, count, patches = []) {
  const cache = new Map()
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,phone TEXT,gender TEXT,is_anonymous INTEGER DEFAULT 0);
    CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE fees(id INTEGER PRIMARY KEY,sale_id INTEGER,fee_type TEXT);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,created_at TEXT,sale_status TEXT,branch_id INTEGER,branch_name TEXT,
      cashier_id INTEGER,cashier_name TEXT,customer_id INTEGER,customer_name TEXT,customer_phone TEXT,receipt_number TEXT,payment_method TEXT,
      subtotal_usd REAL,discount_usd REAL DEFAULT 0,membership_discount_usd REAL DEFAULT 0,tax_usd REAL DEFAULT 0,total_usd REAL,
      delivery_fee_usd REAL DEFAULT 0,delivery_fee_paid_by TEXT DEFAULT 'customer',delivery_actual_cost_usd REAL,is_delivery INTEGER DEFAULT 0,
      delivery_contact_id INTEGER,delivery_contact_name TEXT,
      source_return_id INTEGER,amount_paid_usd REAL,money_precision_version INTEGER NOT NULL DEFAULT 0,
      calculated_total_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0);
    CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,product_name TEXT,quantity REAL,total_usd REAL,
      cost_price_usd REAL,product_discount_usd REAL DEFAULT 0,manual_discount_usd REAL DEFAULT 0);
    CREATE TABLE returns(id INTEGER PRIMARY KEY,sale_id INTEGER,status TEXT DEFAULT 'completed',return_scope TEXT DEFAULT 'customer',
      total_refund_usd REAL,money_precision_version INTEGER NOT NULL DEFAULT 0,calculated_refund_usd REAL,rounding_adjustment_usd REAL NOT NULL DEFAULT 0);
    CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,cost_price_usd REAL,quantity REAL,stock_action TEXT,return_to_stock INTEGER,
      sale_item_id INTEGER,total_usd REAL,refund_snapshot_json TEXT);
  `)
  let statements = 0
  const db = { prepare(query) {
    const stmt = sqlite.prepare(query)
    return { all(params = {}) { statements += 1; return stmt.all(Array.isArray(params) ? params : params) },
      get(params = {}) { statements += 1; return stmt.get(params) } }
  } }
  function load(relative, overrides = {}) {
    const file = path.resolve(root, relative)
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }; cache.set(file, mod)
    let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    for (const patch of patches.filter((p) => file.replaceAll('\\', '/').endsWith(`/${p.file}`))) {
      assert.equal(text.split(patch.from).length - 1, 1, `mutant anchor must occur once: ${patch.from.slice(0, 70)}`)
      text = text.replace(patch.from, () => patch.to)
    }
    const source = transformSync(text, { loader: 'ts', format: 'cjs', target: 'es2022' }).code
    new Function('require', 'module', 'exports', source)((id) => {
      if (id in overrides) return overrides[id]
      if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts', overrides)
      return require(id)
    }, mod, mod.exports)
    return mod.exports
  }
  const money = load('src/lib/moneyPrecision.ts')
  const analytics = load('src/lib/salesAnalytics.ts', { './db': { getDb: () => db }, './removalLosses': load('src/lib/removalLosses.ts'),
    './businessDateWindow': load('src/lib/businessDateWindow.ts'), './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': money }) })
  const entitlement = load('src/lib/customerReturnEntitlement.ts')

  let seed = seedValue
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const pick = (arr) => arr[ri(0, arr.length - 1)]
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13']
  const branches = [[1, 'Shop'], [2, 'Store']]
  const cashiers = [[11, 'Mia'], [12, 'Sok'], [13, 'Lina']]
  const methods = ['Cash', 'ABA', 'Wing']
  const couriers = [[21, 'Courier A'], [22, 'Courier B']]
  let nextReturn = 1
  const insSale = sqlite.prepare('INSERT INTO sales(id,created_at,sale_status,branch_id,branch_name,cashier_id,cashier_name,customer_id,customer_name,receipt_number,payment_method,subtotal_usd,total_usd,delivery_fee_usd,delivery_fee_paid_by,delivery_actual_cost_usd,is_delivery,delivery_contact_id,delivery_contact_name,money_precision_version,calculated_total_usd,rounding_adjustment_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
  const insItem = sqlite.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,total_usd,cost_price_usd) VALUES(?,?,?,?,?,?,?)')
  const insRet = sqlite.prepare('INSERT INTO returns(id,sale_id,total_refund_usd,money_precision_version,calculated_refund_usd,rounding_adjustment_usd) VALUES(?,?,?,1,?,?)')
  const insRetItem = sqlite.prepare("INSERT INTO return_items(id,return_id,cost_price_usd,quantity,stock_action,return_to_stock,sale_item_id,total_usd,refund_snapshot_json) VALUES(?,?,?,?,'restock',1,?,?,?)")
  for (let c = 0; c < 7; c++) sqlite.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)').run(c + 1, 'Cust' + c, '01' + c)
  for (let p = 0; p < 5; p++) sqlite.prepare('INSERT INTO products(id,name) VALUES(?,?)').run(700 + p, 'Live P' + p)
  let itemId = 0
  for (let id = 1; id <= count; id++) {
    const [bid, bname] = pick(branches), [cid, cname] = pick(cashiers)
    // One to three product lines; the sale's value is their sum, so the lines are what a product split allocates over.
    const lineCount = ri(1, 3)
    const lines = Array.from({ length: lineCount }, (_, k) => {
      const qty = ri(1, 3)
      return { qty, unit: r4(ri(1, 99999) / 10000), cost: r4(ri(0, 60000) / 10000), product: 700 + ((id + k) % 5) }
    })
    const lineTotals = lines.map((line) => r4(line.unit * line.qty))
    const subtotal = r4(lineTotals.reduce((acc, value) => acc + value, 0))
    const delivery = rnd() < 0.4 ? r4(ri(0, 30000) / 10000) : 0
    const paidBy = delivery && rnd() < 0.2 ? 'store' : 'customer'
    const actual = delivery ? r4(ri(0, 25000) / 10000) : null
    const custFee = paidBy === 'store' ? 0 : delivery
    const raw = r4(subtotal + custFee)
    const payable = Math.floor((Math.round(raw * 10000) + 50) / 100) / 100
    const adj = r4(payable - raw)
    const [courierId, courierName] = pick(couriers)
    const d = pick(days), hh = String(ri(0, 15)).padStart(2, '0')
    const status = rnd() < 0.05 ? 'cancelled' : 'completed'
    insSale.run(id, d + ' ' + hh + ':00:00', status, bid, bname, cid, cname, (id % 7) + 1, 'Cust' + (id % 7), 'R' + id, pick(methods),
      subtotal, payable, delivery, paidBy, actual, delivery ? 1 : 0, delivery ? courierId : null, delivery ? courierName : null, raw, adj)
    const itemIds = lines.map((line, k) => { itemId += 1; insItem.run(itemId, id, line.product, 'P' + (line.product - 700), line.qty, lineTotals[k], line.cost); return itemId })
    const mode = rnd()
    // A refund of the first line (whole when a single-unit sale, sometimes one unit of several).
    if (status === 'completed' && mode < 0.35) {
      const line = lines[0], total = lineTotals[0]
      const full = mode < 0.15 || line.qty === 1
      const steps = full ? Array(line.qty).fill(1) : [1]
      let before = 0
      const allocation = { discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, net_entitlement_usd: total }
      for (const units of steps) {
        if (before + units > line.qty) break
        const after = before + units
        const bm = entitlement.prorateCustomerReturnMoney4(total, before, line.qty), am = entitlement.prorateCustomerReturnMoney4(total, after, line.qty)
        const calc = r4(am - bm)
        const payout = Math.floor((Math.round(calc * 10000) + 50) / 100) / 100
        const snapshot = JSON.stringify({ version: 1, sale_id: id, sale_item_id: itemIds[0], line_key: 'line-' + id, pool_key: 'pool-' + id, source_sale_revision: 1,
          source_pricing_snapshot_digest: 'a'.repeat(64), sold_quantity: line.qty, return_quantity: units, returned_quantity_before: before, returned_quantity_after: after,
          receipt_allocation: allocation, net_entitlement_usd: total, calculated_refund_before_usd: bm, calculated_refund_after_usd: am, calculated_refund_usd: calc,
          calculated_refund_khr: r4(calc * 4000), exchange_rate: 4000, sale_product_entitlement_usd: total, sale_product_payout_cap_usd: payable })
        const rid = nextReturn++
        insRet.run(rid, id, payout, calc, r4(payout - calc))
        insRetItem.run(rid, rid, line.cost, units, itemIds[0], calc, snapshot)
        before = after
      }
    }
  }
  return { analytics, sqlite, days, getStatements: () => statements, resetStatements: () => { statements = 0 } }
}

const sum = (rows, key) => r4(rows.reduce((acc, row) => acc + Number(row[key] || 0), 0))
const near = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance + 1e-9, `${message}: ${a} vs ${b}`)

/** Every claim of the reconciliation for one world; throws on the first that fails. */
async function reconcile(world, { cards = 'new' } = {}) {
  const { analytics, sqlite, days } = world
  const f = { startDate: days[0], endDate: days[days.length - 1] }
  const headline = await analytics.getSalesTotals({}, f)
  world.resetStatements()
  const dashboard = await analytics.getSalesTotalsAndPeriodSeries({}, f, 'day')
  const dashboardStatements = world.getStatements()
  world.resetStatements()
  await analytics.getSalesTotals({}, f)
  const totalsStatements = world.getStatements()
  assert.equal(dashboard.totals.revenue_usd, headline.revenue_usd, 'the Dashboard KPI is the Reports headline')
  assert.ok(dashboardStatements <= totalsStatements, `the Dashboard path reads ${dashboardStatements} statements; getSalesTotals alone reads ${totalsStatements}`)

  const reportsPay = (await analytics.getSalesGroupedReport({}, f, 'payment_method', 1000)).rows.filter((row) => row.tx_count > 0)
  const reportsBranch = (await analytics.getSalesGroupedReport({}, f, 'branch', 1000)).rows.filter((row) => row.tx_count > 0)
  let byPayment = dashboard.byPayment, byBranch = dashboard.byBranch
  if (cards === 'legacy') {
    const { netSaleExpr, netRefundExpr, CUSTOMER_REFUND_JOIN, recognizedExpr } = analytics
    const q = (grp) => sqlite.prepare(`SELECT ${grp} AS k, COUNT(*) AS count, COALESCE(SUM(${netSaleExpr('s.')} - ${netRefundExpr('s.', 'rf.')}),0) AS revenue_usd
       FROM sales s ${CUSTOMER_REFUND_JOIN}s.id WHERE date(s.created_at) BETWEEN @a AND @b AND ${recognizedExpr('s.')} GROUP BY ${grp}`).all({ a: f.startDate, b: f.endDate })
    byPayment = q("COALESCE(NULLIF(TRIM(s.payment_method), ''), 'Unknown')").map((row) => ({ method: row.k, count: row.count, revenue_usd: row.revenue_usd }))
    byBranch = q('s.branch_id').map((row) => ({ branch_id: row.k, count: row.count, tx_count: row.count, revenue_usd: row.revenue_usd }))
  }
  if (cards === 'cents') {
    byPayment = byPayment.map((row) => ({ ...row, revenue_usd: r2(row.revenue_usd) }))
    byBranch = byBranch.map((row) => ({ ...row, revenue_usd: r2(row.revenue_usd) }))
  }

  // cards == Reports buckets, row by row and in total, 4 places
  assert.deepEqual(byPayment.map((row) => [row.method, row.count, row.revenue_usd]).sort(),
    reportsPay.map((row) => [row.label || 'Unknown', row.tx_count, row.revenue_usd]).sort(), 'payment card rows are the Reports payment buckets')
  assert.deepEqual(byBranch.map((row) => [row.branch_id, row.count, row.revenue_usd]).sort(),
    reportsBranch.map((row) => [row.entity_id, row.tx_count, row.revenue_usd]).sort(), 'branch card rows are the Reports branch buckets')
  assert.equal(sum(byPayment, 'revenue_usd'), sum(reportsPay, 'revenue_usd'), 'payment card sum, 4 places')
  assert.equal(sum(byBranch, 'revenue_usd'), sum(reportsBranch, 'revenue_usd'), 'branch card sum, 4 places')
  // headline within half a cent of what the rows sum to; counts add up to the headline's
  near(sum(byPayment, 'revenue_usd'), headline.revenue_usd, 0.005, 'payment cards vs headline')
  near(sum(byBranch, 'revenue_usd'), headline.revenue_usd, 0.005, 'branch cards vs headline')
  assert.equal(byPayment.reduce((acc, row) => acc + row.count, 0), headline.tx_count, 'payment card counts add up to the headline count')
  assert.equal(byBranch.reduce((acc, row) => acc + row.count, 0), headline.tx_count, 'branch card counts add up to the headline count')

  // the export splits, off the export's own snapshot
  const snapshot = await analytics.readSalesReportSnapshot({}, f)
  const byStatus = analytics.exportStatusSplitFromSnapshot(snapshot)
  const byProduct = await analytics.exportProductSplitFromSnapshot({}, snapshot)
  assert.equal(sum(byStatus, 'revenue'), sum(reportsPay, 'revenue_usd'), 'by_status sums to the Reports buckets, 4 places')
  assert.equal(sum(byProduct, 'revenue_usd'), sum(reportsPay, 'revenue_usd'), 'by_product sums to the Reports buckets, 4 places')
  near(sum(byStatus, 'revenue'), headline.revenue_usd, 0.005, 'by_status vs headline')
  near(sum(byProduct, 'revenue_usd'), headline.revenue_usd, 0.005, 'by_product vs headline')
  assert.equal(byStatus.reduce((acc, row) => acc + row.count, 0), snapshot.sales.length + snapshot.voidSales.length, 'by_status counts every sale, voided ones included')
  assert.equal(byStatus.find((row) => row.status === 'cancelled')?.revenue ?? 0, 0, 'a voided sale carries no revenue')
  assert.ok(byProduct.every((row) => row.product_name !== 'Unallocated sales' || row.product_id === null))
  assert.ok(byProduct.filter((row) => /^Live P/.test(row.product_name)).length > 0, 'a product exports under its live name')

  // the Dashboard's other rankings, off the same snapshot
  const reportsCustomer = (await analytics.getSalesGroupedReport({}, f, 'customer', 1000)).rows.filter((row) => row.tx_count > 0)
  const reportsHour = (await analytics.getSalesGroupedReport({}, f, 'hour', 1000)).rows.filter((row) => row.tx_count > 0)
  const ranked = analytics.dashboardRankingsFromSnapshot(snapshot, 1000)
  assert.deepEqual(ranked.topCustomers.map((row) => [row.customer_name, row.sale_count, row.gross_revenue_usd, row.total_refund_usd, row.net_revenue_usd]),
    reportsCustomer.map((row) => [row.label, row.tx_count, row.gross_sales_usd, row.refund_usd, row.revenue_usd]), 'top customers are the Reports customer buckets, in order')
  assert.deepEqual(ranked.hourlyDist.map((row) => [row.hour, row.count, row.revenue_usd]),
    reportsHour.map((row) => [Number(row.key), row.tx_count, row.revenue_usd]), 'busy hours are the Reports hour buckets')
  assert.equal(sum(ranked.topCustomers, 'net_revenue_usd'), sum(reportsPay, 'revenue_usd'), 'top customers add up to the Reports buckets, 4 places')
  assert.equal(sum(ranked.hourlyDist, 'revenue_usd'), sum(reportsPay, 'revenue_usd'), 'busy hours add up to the Reports buckets, 4 places')
  assert.equal(sum(ranked.topProducts, 'revenue_usd'), sum(reportsPay, 'revenue_usd'), 'top products add up to the Reports buckets, 4 places')
  assert.deepEqual(ranked.topProducts.map((row) => [row.product_id, row.qty_sold, row.revenue_usd]).sort(),
    byProduct.map((row) => [row.product_id, row.qty_sold, row.revenue_usd]).sort(), 'the Dashboard and the export preview share one product allocation')
  assert.deepEqual(dashboard.topCustomers, ranked.topCustomers.slice(0, 20), 'the Dashboard path returns the first 20 of the same ranking')
  assert.deepEqual(dashboard.hourlyDist, ranked.hourlyDist)
  return { headline, byPayment, byBranch, byStatus, byProduct, dashboardStatements, totalsStatements }
}

const SEEDS = [12345, 777, 4242, 99, 31337, 2026]
async function main() {
  let passed = 0
  const ok = (name) => { passed += 1; console.log(`PASS ${name}`) }
  const rows = []
  for (const seed of SEEDS) {
    for (const count of [120, 200]) {
      const world = makeWorld(seed, count)
      const got = await reconcile(world)
      rows.push({ seed, count, headline: got.headline.revenue_usd, cards: sum(got.byPayment, 'revenue_usd'), branches: sum(got.byBranch, 'revenue_usd'),
        status: sum(got.byStatus, 'revenue'), product: sum(got.byProduct, 'revenue_usd'), dashboard: got.dashboardStatements, totals: got.totalsStatements })
    }
  }
  ok(`fuzz: ${rows.length} worlds (${SEEDS.length} seeds x 120/200 sales): cards, status and product rows add up to the Reports buckets exactly and sit within half a cent of the headline`)
  for (const row of rows.slice(0, 4)) {
    console.log(`  seed ${row.seed} x ${row.count}: headline ${row.headline} | payment cards ${row.cards} | branch cards ${row.branches} | by_status ${row.status} | by_product ${row.product} | statements dashboard ${row.dashboard} <= totals ${row.totals}`)
  }

  // ---- controls: the instrument must see what it claims to ----
  let legacyGaps = 0, legacyRejected = 0, centsRejected = 0
  const gaps = []
  for (const seed of SEEDS) {
    const world = makeWorld(seed, 200)
    const f = { startDate: world.days[0], endDate: world.days[world.days.length - 1] }
    const headline = await world.analytics.getSalesTotals({}, f)
    const { netSaleExpr, netRefundExpr, CUSTOMER_REFUND_JOIN, recognizedExpr } = world.analytics
    const legacy = world.sqlite.prepare(`SELECT COALESCE(SUM(${netSaleExpr('s.')} - ${netRefundExpr('s.', 'rf.')}),0) AS revenue_usd FROM sales s ${CUSTOMER_REFUND_JOIN}s.id
       WHERE date(s.created_at) BETWEEN @a AND @b AND ${recognizedExpr('s.')}`).get({ a: f.startDate, b: f.endDate })
    const gap = r4(headline.revenue_usd - legacy.revenue_usd)
    gaps.push(gap)
    if (Math.abs(gap) > 0.005) legacyGaps += 1
    for (const [cards, bump] of [['legacy', () => { legacyRejected += 1 }], ['cents', () => { centsRejected += 1 }]]) {
      try { await reconcile(world, { cards }) } catch { bump() }
    }
  }
  console.log(`  old card SQL minus headline, per seed (x 200 sales): ${gaps.join(', ')}`)
  assert.ok(legacyGaps >= SEEDS.length - 1, `the old card SQL is more than half a cent off the headline on ${legacyGaps}/${SEEDS.length} seeds`)
  assert.equal(legacyRejected, SEEDS.length, 'the reconciliation rejects the old card rows on every seed')
  assert.equal(centsRejected, SEEDS.length, 'the reconciliation rejects cent-rounded rows on every seed')
  ok(`control: the old card SQL misses the headline by more than half a cent on ${legacyGaps}/${SEEDS.length} seeds and is rejected on ${legacyRejected}; cent-rounded rows are rejected on ${centsRejected}`)

  // ---- mutants of the new code ----
  const SA = 'src/lib/salesAnalytics.ts'
  const mutants = [
    { name: 'cards rounded to cents', patches: [{ file: SA, from: 'method: row.label || \'Unknown\', payment_method: row.label || \'Unknown\', count: row.tx_count, revenue_usd: row.revenue_usd,',
      to: 'method: row.label || \'Unknown\', payment_method: row.label || \'Unknown\', count: row.tx_count, revenue_usd: Math.round(row.revenue_usd * 100) / 100,' }] },
    { name: 'product allocation drops its remainder', patches: [{ file: SA, from: 'for (let i = 0; i < left; i += 1) parts[order[i % order.length].index] += 1', to: '' }] },
    { name: 'product revenue without the rounding adjustment', patches: [{ file: SA, from: 'const units = toUnits(fact.net.add(fact.adjustment).subtract(fact.refund))', to: 'const units = toUnits(fact.net.subtract(fact.refund))' }] },
    { name: 'top customers rounded to cents', patches: [{ file: SA, from: 'total_refund_usd: row.refund_usd, net_revenue_usd: row.revenue_usd,', to: 'total_refund_usd: row.refund_usd, net_revenue_usd: Math.round(row.revenue_usd * 100) / 100,' }] },
    { name: 'busy hours rounded to cents', patches: [{ file: SA, from: '.map((row) => ({ hour: Number(row.key), count: row.tx_count, revenue_usd: row.revenue_usd }))', to: '.map((row) => ({ hour: Number(row.key), count: row.tx_count, revenue_usd: Math.round(row.revenue_usd * 100) / 100 }))' }] },
    { name: 'status revenue taken from the legacy basis', patches: [{ file: SA, from: 'revenue: exactReportTotals(bucket, snapshot, BUCKET_MONEY_PLACES).revenue_usd,', to: 'revenue: exactReportTotals(bucket, snapshot, 2).revenue_usd,' }] },
  ]
  for (const mutant of mutants) {
    let caught = 0
    for (const seed of SEEDS) {
      try { await reconcile(makeWorld(seed, 200, mutant.patches)) } catch { caught += 1 }
    }
    assert.ok(caught >= SEEDS.length - 1, `mutant "${mutant.name}" was caught on ${caught}/${SEEDS.length} seeds`)
    ok(`mutant (${mutant.name}) is caught on ${caught}/${SEEDS.length} seeds`)
  }
  console.log(`GREEN dashboard card and export split reconciliation: ${passed} checks hold`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
