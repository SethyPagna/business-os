// 6.0.970: GET /api/sales/stats hands its date/time window to readSalesReportTotals as well as to
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
const STATS_FLAG_LINES = ['let statusClausePushed = false', '  if (query.status) {', '    const clause = saleStatusFilterClause(String(query.status), params)', '    if (clause) { where.push(clause); statusClausePushed = true }', '  }', '  let branchClausePushed = false', '  if (query.branchId) {', '    branchClausePushed = true'].join('\n')
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
  // the other statuses the Sales filter offers, a branch-2 one among them, and a NULL status (counted as completed): outside the one-day window, inside the range
  [13, '2026-09-11 09:00:00', 'returned', 2, 23, 23],
  [14, '2026-09-11 09:10:00', 'partial_return', 1, 24, 24],
  [15, '2026-09-11 09:20:00', 'awaiting_delivery', 1, 25, 0],
  [16, '2026-09-11 09:30:00', null, 1, 26, 26],
  // return and delivery tags (return_state, delivery_pending, status_before_return) on days 09-11 and 09-12: a cancelled sale can carry a tag, so it falls inside a returned / partial_return / awaiting_delivery scope
  [19, '2026-09-11 10:00:00', 'cancelled', 1, 31, 31, null, null, { return_state: 'partial' }],
  [20, '2026-09-11 10:10:00', 'cancelled', 2, 32, 0, null, null, { delivery_pending: 1 }],
  [21, '2026-09-11 10:20:00', 'returned', 1, 33, 33, null, null, { status_before_return: 'awaiting_payment' }],
  [22, '2026-09-11 10:30:00', 'partial_return', 2, 34, 34, null, null, { status_before_return: 'awaiting_delivery' }],
  [23, '2026-09-11 10:40:00', 'returned', 1, 35, 35, null, null, { status_before_return: 'completed', return_state: 'full' }],
  [24, '2026-09-11 10:50:00', 'completed', 1, 36, 36, null, null, { return_state: 'full', delivery_pending: 1 }],
  [25, '2026-09-11 16:59:59', 'cancelled', 1, 37, 37, null, null, { return_state: 'full' }], // local 09-11 23:59:59 -> inside day 09-11
  [26, '2026-09-11 17:00:00', 'cancelled', 1, 38, 38, null, null, { delivery_pending: 1 }], // local 09-12 00:00 -> day 09-12
  [27, '2026-09-12 16:59:59', 'returned', 1, 39, 0, null, null, { status_before_return: 'awaiting_payment' }], // local 09-12 23:59:59 -> inside
  [28, '2026-09-12 17:00:00', 'partial_return', 2, 40, 40, null, null, { status_before_return: 'awaiting_delivery' }], // local 09-13 00:00 -> outside the range
  [17, '2026-09-11 09:40:00', 'awaiting_payment', 2, 27, 5],
  [18, '2026-09-11 09:50:00', 'cancelled', 2, 28, 28],
]
const setTags = sql.prepare('UPDATE sales SET return_state = @rs, delivery_pending = @dp, status_before_return = @sbr WHERE id = @id')
for (const [id, at, status, branch, total, paid, upd, itemBranch, tags] of sales) {
  insertSale.run({ id, rn: `R${id}`, at, upd: upd || at, status, branch, total, paid })
  if (tags) setTags.run({ id, rs: tags.return_state ?? null, dp: tags.delivery_pending ?? 0, sbr: tags.status_before_return ?? null })
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

// The route's own saleStatusFilterClause, cut out of src/routes/sales.ts (a non-exported function) and compiled against the real lib/salesStatus.
const routeSource = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8').split('\r').join('')
const clauseStart = routeSource.indexOf('function saleStatusFilterClause(')
const clauseEnd = routeSource.indexOf('\n}\n', clauseStart)
assert.ok(clauseStart > 0 && clauseEnd > clauseStart, 'saleStatusFilterClause found in the route')
const clauseCode = transformSync(routeSource.slice(clauseStart, clauseEnd + 2), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
const saleStatusFilterClause = new Function('saleStatusFilterSql', clauseCode + '\nreturn saleStatusFilterClause')(load('src/lib/salesStatus.ts').saleStatusFilterSql)
// Mirrors the route's where-building for the window and the list filters.
function build(query) {
  const where = ['1=1'], params = {}
  if (query.startDate) { where.push(bdw.localDateAtOrAfter('s.created_at')); params.startDate = query.startDate }
  if (query.endDate) { where.push(bdw.localDateAtOrBefore('s.created_at')); params.endDate = query.endDate }
  if (query.startTime && query.endTime) { where.push(bdw.localTimeRangeClause('s.created_at')); params.startTime = query.startTime; params.endTime = query.endTime }
  if (query.status) { const clause = saleStatusFilterClause(String(query.status), params); if (clause) where.push(clause) }
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
  'branch 1 only': { branchId: '1' },
  'range + branch 1': { startDate: '2026-09-05', endDate: '2026-09-12', branchId: '1' },
  'range + branch 2': { startDate: '2026-09-05', endDate: '2026-09-12', branchId: '2' },
  // every status option, an unknown value, each alone (no window), in the range, and beside a branch: the classification (broad / narrow) must never change a figure
  ...Object.fromEntries(['completed', 'awaiting_payment', 'returned', 'partial_return', 'awaiting_delivery', 'cancelled', 'bogus'].flatMap((st) => [
    [`status ${st} all-time`, { status: st }],
    [`status ${st} range`, { startDate: '2026-09-05', endDate: '2026-09-12', status: st }],
    [`status ${st} + branch 1`, { status: st, branchId: '1' }],
    [`status ${st} + branch 2 range`, { startDate: '2026-09-05', endDate: '2026-09-12', status: st, branchId: '2' }],
    [`status ${st} tagged day 09-11`, { startDate: '2026-09-11', endDate: '2026-09-11', status: st }],
    [`status ${st} edge day 09-12`, { startDate: '2026-09-12', endDate: '2026-09-12', status: st }],
    [`status ${st} edge hours 09-11`, { startDate: '2026-09-11', endDate: '2026-09-11', startTime: '23:00', endTime: '23:59', status: st }],
  ])),
  // status lists: a tagged cancelled sale is inside a scope that names another status
  ...Object.fromEntries(['returned,partial_return', 'cancelled,returned', 'completed,cancelled', 'awaiting_delivery,awaiting_payment', 'completed,awaiting_payment', 'cancelled,partial_return'].flatMap((st) => [
    [`status list ${st} all-time`, { status: st }],
    [`status list ${st} range`, { startDate: '2026-09-05', endDate: '2026-09-12', status: st }],
    [`status list ${st} day 09-11 + branch 1`, { startDate: '2026-09-11', endDate: '2026-09-11', status: st, branchId: '1' }],
  ])),
}

;(async () => {
  for (const [name, query] of Object.entries(cases)) {
    // both classifications of the same scope (broad: the plain cancelled predicate and +id paging; narrow: the wrapped predicate): the figures are the same either way, and the same as the old call
    for (const narrow of [false, true]) {
      await check(`old filter and new filter agree (${narrow ? 'narrow' : 'broad'} scope): ${name}`, async () => {
        const { where, params } = build(query)
        const oldSnap = await lib.readSalesReportSnapshot({}, {}, false, lib.salesListFilterReportScope(where, params, narrow))
        const newSnap = await lib.readSalesReportSnapshot({}, windowOf(query), false, lib.salesListFilterReportScope(where, params, narrow))
        assert.equal(JSON.stringify(newSnap), JSON.stringify(oldSnap))
        assert.deepEqual(lib.salesTotalsFromSnapshot(newSnap), lib.salesTotalsFromSnapshot(oldSnap))
        const other = await lib.readSalesReportSnapshot({}, windowOf(query), false, lib.salesListFilterReportScope(where, params, !narrow))
        assert.deepEqual(lib.salesTotalsFromSnapshot(other), lib.salesTotalsFromSnapshot(newSnap), 'broad and narrow classification must give the same totals')
      })
    }
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

  await check('control: the route status clause puts a tagged cancelled sale inside a returned / awaiting_delivery scope', async () => {
    const probe = async (status) => {
      const q = { startDate: '2026-09-11', endDate: '2026-09-11', status }
      const { where, params } = build(q)
      const snap = await lib.readSalesReportSnapshot({}, windowOf(q), false, lib.salesListFilterReportScope(where, params))
      return { sales: snap.sales.map((r) => r.id).sort((a, b) => a - b), voids: snap.voidSales.map((r) => r.id).sort((a, b) => a - b) }
    }
    const partial = await probe('partial_return')
    assert.ok(partial.voids.includes(19), 'cancelled sale 19 (return_state partial) is in the partial_return scope: ' + JSON.stringify(partial))
    assert.ok(partial.sales.includes(22), 'partial_return sale 22 is in the scope')
    const pending = await probe('awaiting_delivery')
    assert.ok(!pending.voids.includes(20), 'a cancelled sale with delivery_pending is not in the delivery queue (route rule): ' + JSON.stringify(pending))
    const full = await probe('returned')
    assert.ok(full.voids.includes(25), 'cancelled sale 25 (return_state full) is in the returned scope: ' + JSON.stringify(full))
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
    assert.match(block, /readSalesHeaderTotals\(c\.env,\s*windowFilter,\s*scope\)/)
    assert.match(block, /salesListFilterReportScope\(where,\s*params,\s*narrowScope\)/)
    assert.match(block, /const narrowScope = where\.length - 1 - windowClauseCount - \(statusClausePushed && statsStatusIsBroad\(String\(query\.status\)\) \? 1 : 0\) - \(branchClausePushed \? 1 : 0\) > 0\r?\n/, 'narrowScope counts the clauses beyond the window and the status test')
    assert.ok(block.split('\r').join('').includes(STATS_FLAG_LINES), 'both clause flags start false and are set where their clause is pushed')
    assert.ok(src.includes("const BROAD_STATS_STATUSES: ReadonlySet<string> = new Set(['completed', 'awaiting_payment'])"), 'only completed and awaiting_payment are broad statuses')
    assert.match(src, /function statsStatusIsBroad\(raw: string\): boolean \{\r?\n  const statuses = raw\.split\(','\)\.map\(\(v\) => v\.trim\(\)\)\.filter\(Boolean\)\r?\n  return statuses\.length > 0 && statuses\.every\(\(status\) => BROAD_STATS_STATUSES\.has\(status\)\)/, 'the status rule: every listed status must be broad')
    assert.match(block, /const scope = where\.length - 1 === windowClauseCount && !openEndedStart \? undefined : salesListFilterReportScope\(where,\s*params,\s*narrowScope\)/, 'only the window drops the scope')
  })

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) process.exit(1)
})().catch((e) => { console.error(e); process.exit(1) })
