// 6.0.970: GET /api/sales/stats hands its date/time window to readSalesReportSnapshot as well as to
// the list scope, so the keyset walks start inside the window. The cohort must not change.
//
// Proves, over a fixture with sales inside and outside the window (including both local-day edges),
// a return dated AFTER its sale (and one dated inside the window on a sale outside it), a Not Paid
// sale settled later and one outside the window: the old call (empty filter + scope) and the new call
// (window filter + the same scope) return the same snapshot and the same totals (revenue, Not Paid
// pending/owed, revenue_without_not_paid) for every window shape, and the window is really in the SQL.
//
// Run: node scripts/test-sales-stats-window-parity-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(relative, overrides = {}) {
  const file = path.resolve(root, relative)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), id)) + '.ts', overrides)
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

const sql = new Database(':memory:')
sql.pragma('foreign_keys = OFF')
for (const migration of loadAll()) sql.exec(migration)
const insertSale = sql.prepare(`INSERT INTO sales (id, receipt_number, created_at, updated_at, sale_status, branch_id, subtotal_usd, total_usd, amount_paid_usd, cashier_id, cashier_name, payment_method)
  VALUES (@id, @rn, @at, @upd, @status, @branch, @total, @total, @paid, 1, 'Dara', 'Cash')`)
const insertItem = sql.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, quantity, total_usd, cost_price_usd, branch_id) VALUES (?, 1, ?, 1, ?, 0.4, ?)')
const insertReturn = sql.prepare("INSERT INTO returns (id, return_number, sale_id, total_refund_usd, status, return_scope, created_at) VALUES (?, ?, ?, ?, 'completed', 'customer', ?)")
const insertReturnItem = sql.prepare('INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, quantity, total_usd, cost_price_usd, return_to_stock) VALUES (?, ?, 1, ?, 1, ?, 0.4, 1)')
const sales = [
  // [id, created_at UTC, status, branch, total, paid, updated_at]
  [1, '2026-09-09 16:59:59', 'completed', 1, 11, 11], // local 09-09 23:59:59 -> outside
  [2, '2026-09-09 17:00:00', 'completed', 1, 12, 12], // local 09-10 00:00 -> inside
  [3, '2026-09-10 05:00:00', 'completed', 2, 13, 13], // inside, other branch
  [4, '2026-09-10 08:00:00', 'awaiting_payment', 1, 14, 0, '2026-09-20 08:00:00'], // Not Paid, settled later
  [5, '2026-09-10 16:59:59', 'completed', 1, 15, 15], // local 23:59:59 -> inside
  [6, '2026-09-10 17:00:00', 'completed', 1, 16, 16], // local 09-11 00:00 -> outside
  [7, '2026-09-10 09:00:00', 'cancelled', 1, 17, 17], // inside, void
  [8, '2026-09-05 09:00:00', 'awaiting_payment', 1, 18, 0], // Not Paid, outside
  [9, '2026-09-10 09:30:00', 'completed', 1, 19, 19], // inside, returned later
  [10, '2026-09-04 09:30:00', 'completed', 1, 20, 20], // outside, return dated inside window
  [11, '2026-09-15 09:30:00', 'completed', 1, 21, 21],
  [12, '2026-09-10 10:00:00', 'completed', 1, 22, 22, null, 2], // sale in branch 1, its item in branch 2 (inside the window)
]
for (const [id, at, status, branch, total, paid, upd, itemBranch] of sales) {
  insertSale.run({ id, rn: `R${id}`, at, upd: upd || at, status, branch, total, paid })
  insertItem.run(id, `P${id}`, total, itemBranch || branch)
}
insertReturn.run(1, 'RT1', 9, 5, '2026-09-12 03:00:00'); insertReturnItem.run(1, 9, 'P9', 5)
insertReturn.run(2, 'RT2', 10, 7, '2026-09-10 03:00:00'); insertReturnItem.run(2, 10, 'P10', 7)
insertReturn.run(3, 'RT3', 3, 4, '2026-09-30 03:00:00'); insertReturnItem.run(3, 3, 'P3', 4)

const captured = []
const db = { prepare(query) { const stmt = sql.prepare(query); return {
  all(params = {}) { captured.push({ query, params }); return stmt.all(params) },
  get(params = {}) { captured.push({ query, params }); return stmt.get(params) },
} } }
const bdw = load('src/lib/businessDateWindow.ts')
const lib = load('src/lib/salesAnalytics.ts', {
  './db': { getDb: () => db },
  './removalLosses': load('src/lib/removalLosses.ts'),
  './businessDateWindow': bdw,
  './reportMoneyPrecision': load('src/lib/reportMoneyPrecision.ts', { './moneyPrecision': load('src/lib/moneyPrecision.ts') }),
})

// Mirrors the route's where-building for the window and the list filters.
function build(query) {
  const where = ['1=1'], params = {}
  if (query.startDate) { where.push(bdw.localDateAtOrAfter('s.created_at')); params.startDate = query.startDate }
  if (query.endDate) { where.push(bdw.localDateAtOrBefore('s.created_at')); params.endDate = query.endDate }
  if (query.startTime && query.endTime) { where.push(bdw.localTimeRangeClause('s.created_at')); params.startTime = query.startTime; params.endTime = query.endTime }
  if (query.status) { where.push("COALESCE(s.sale_status,'completed') = @status"); params.status = query.status }
  if (query.branchId) {
    where.push('(s.branch_id = @branchId OR EXISTS (SELECT 1 FROM sale_items sif WHERE sif.sale_id = s.id AND sif.branch_id = @branchId))')
    params.branchId = query.branchId
  }
  return { where, params }
}
const windowOf = (q) => ({ startDate: q.startDate || null, endDate: q.endDate || null, startTime: q.startTime || null, endTime: q.endTime || null })

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

const cases = {
  'one local day': { startDate: '2026-09-10', endDate: '2026-09-10' },
  'start only': { startDate: '2026-09-10' },
  'end only': { endDate: '2026-09-10' },
  'range': { startDate: '2026-09-05', endDate: '2026-09-12' },
  'day + time of day': { startDate: '2026-09-10', endDate: '2026-09-10', startTime: '10:00', endTime: '23:59' },
  'overnight time window': { startDate: '2026-09-05', endDate: '2026-09-15', startTime: '22:00', endTime: '03:00' },
  'day + branch filter': { startDate: '2026-09-10', endDate: '2026-09-10', branchId: '2' },
  'day + item-branch filter (item in another branch than its sale)': { startDate: '2026-09-10', endDate: '2026-09-10', branchId: '2' },
  'day + Not Paid status': { startDate: '2026-09-10', endDate: '2026-09-10', status: 'awaiting_payment' },
  'day + cancelled status': { startDate: '2026-09-10', endDate: '2026-09-10', status: 'cancelled' },
  'empty window': { startDate: '2027-01-01', endDate: '2027-01-02' },
  'no window at all': {},
  'branch only': { branchId: '2' },
}

;(async () => {
  for (const [name, query] of Object.entries(cases)) {
    await check(`old filter and new filter agree: ${name}`, async () => {
      const { where, params } = build(query)
      const oldSnap = await lib.readSalesReportSnapshot({}, {}, false, lib.salesListFilterReportScope(where, params))
      const newSnap = await lib.readSalesReportSnapshot({}, windowOf(query), false, lib.salesListFilterReportScope(where, params))
      assert.equal(JSON.stringify(newSnap), JSON.stringify(oldSnap))
      assert.deepEqual(lib.salesTotalsFromSnapshot(newSnap), lib.salesTotalsFromSnapshot(oldSnap))
    })
  }

  await check('control: the one-day window really narrows, edges and later events behave', async () => {
    const q = cases['one local day']
    const { where, params } = build(q)
    const snap = await lib.readSalesReportSnapshot({}, windowOf(q), false, lib.salesListFilterReportScope(where, params))
    assert.deepEqual(snap.sales.map((r) => r.id).sort((a, b) => a - b), [2, 3, 4, 5, 9, 12])
    assert.deepEqual(snap.voidSales.map((r) => r.id), [7])
    assert.deepEqual(snap.returns.map((r) => r.sale_id).sort((a, b) => a - b), [3, 9], 'a return dated later follows its sale; a return on an outside sale is excluded')
    const totals = lib.salesTotalsFromSnapshot(snap)
    assert.ok(totals.pending_revenue_usd > 0 && totals.not_paid_owed_usd > 0, 'Not Paid sale counted as pending')
    assert.notEqual(totals.revenue_usd, totals.revenue_without_not_paid_usd)
  })

  await check('the window now reaches the report SQL (item band)', async () => {
    const q = cases['one local day']
    const { where, params } = build(q)
    captured.length = 0
    await lib.readSalesReportSnapshot({}, windowOf(q), false, lib.salesListFilterReportScope(where, params))
    assert.ok(captured.some((c) => /MIN\(si\.id\)/.test(c.query)), 'item band read must run for a windowed stats call')
    assert.ok(captured.some((c) => c.params.startDate === '2026-09-10' && /FROM sales s WHERE/.test(c.query)), 'sales walk carries the window params')
    captured.length = 0
    await lib.readSalesReportSnapshot({}, {}, false, lib.salesListFilterReportScope(where, params))
    assert.ok(!captured.some((c) => /MIN\(si\.id\)/.test(c.query)), 'control: the old call had no band read')
  })

  await check('item-branch control: branch 2 matches the sale whose ITEM is in branch 2', async () => {
    const q = { startDate: '2026-09-10', endDate: '2026-09-10', branchId: '2' }
    const { where, params } = build(q)
    const snap = await lib.readSalesReportSnapshot({}, windowOf(q), false, lib.salesListFilterReportScope(where, params))
    assert.deepEqual(snap.sales.map((r) => r.id).sort((a, b) => a - b), [3, 12])
  })

  await check('regression (binding-limit shape): the item band is scope-free, so a deep search scope cannot nest it past the depth limit', async () => {
    const q = { startDate: '2026-09-10', endDate: '2026-09-10' }
    const where = ['1=1', bdw.localDateAtOrAfter('s.created_at'), bdw.localDateAtOrBefore('s.created_at'), '(' + Array.from({ length: 40 }, (_, i) => `s.customer_name LIKE @t${i}`).join(' OR ') + ')']
    const params = { startDate: q.startDate, endDate: q.endDate, ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`t${i}`, `%nomatch${i}%`])) }
    captured.length = 0
    const wide = await lib.readSalesReportSnapshot({}, windowOf(q), false, lib.salesListFilterReportScope(where, params))
    assert.equal(wide.sales.length, 0)
    const band = captured.find((c) => /MIN\(si\.id\)/.test(c.query))
    assert.ok(band, 'band read ran')
    assert.ok(!/matched_sale|LIKE/.test(band.query), 'band statement carries no scope subquery')
  })

  await check('route passes the window and only the window', async () => {
    const src = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8')
    const block = src.match(/app\.get\('\/stats'[\s\S]*?\n\}\)/)?.[0] || ''
    assert.match(block, /const windowFilter=\{startDate:query\.startDate\|\|null,endDate:query\.endDate\|\|null,startTime:query\.startTime\|\|null,endTime:query\.endTime\|\|null\}/)
    assert.match(block, /readSalesReportSnapshot\(c\.env,windowFilter,false,salesListFilterReportScope\(where,params\)\)/)
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
