// Actual Hono Dashboard handlers, production SQL/helpers and the shared sales
// snapshot against the complete migrated SQLite schema. No network or D1 writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const root = path.resolve(__dirname, '../src')
const modules = new Map()
const db = openDb(loadAll())
let user = { id: 1, username: 'admin', role_code: 'admin' }
let reads = 0
const filtersSeen = []
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
function load(file) {
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }; modules.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: file,
  }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => {
      if (!user) return c.json({ error: 'Unauthenticated' }, 401)
      c.set('user', user); return next()
    } }
    if (name === '../lib/db' || name === './db') return {
      ...load(path.join(root, 'lib/db.ts')), getDb: () => { reads++; return db },
    }
    if (name === '../lib/salesAnalytics') {
      const real = load(path.join(root, 'lib/salesAnalytics.ts'))
      return { ...real,
        getSalesTotalsAndPeriodSeries: async (env, filters, granularity) => {
          filtersSeen.push({ kind: 'shared', ...filters })
          return real.getSalesTotalsAndPeriodSeries(env, filters, granularity)
        },
        getSalesTotals: async (env, filters) => {
          filtersSeen.push({ kind: 'previous', ...filters })
          return real.getSalesTotals(env, filters)
        },
      }
    }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const app = new Hono()
app.onError(error => { throw error })
app.route('/', load(path.join(root, 'routes/compat.ts')).default)
const env = { DB: {}, CACHE: { get: async () => null, put: async () => {} } }
let checks = 0
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++ }
async function request(endpoint, query, status = 200) {
  const waits = []
  const response = await app.request(`http://local.test${endpoint}?${new URLSearchParams(query)}`, {}, env,
    { waitUntil: p => waits.push(p), passThroughOnException() {} })
  await Promise.all(waits)
  equal(response.status, status, `${endpoint}: ${JSON.stringify(query)}`)
  return response.json()
}
const dates = { startDate: '2026-09-10', endDate: '2026-09-12', branchId: '1' }
// Local Sep 10 22:00 through Sep 12 02:00 INCLUSIVE minute: one continuous
// interval, including all of Sep 11, not a daily 22:00-02:00 mask.
const timed = { ...dates, createdFrom: '2026-09-10T15:00:00.000Z', createdTo: '2026-09-11T19:01:00.000Z' }
const selected = [2, 3, 4, 5, 6, 7]
const sortedIds = rows => rows.map(row => row.id).sort((a, b) => a - b)
async function main() {
  db.exec(`INSERT INTO products (id, name, unit, is_active, stock_quantity, cost_price_usd, expiry_date)
    VALUES (1, 'Timed item', 'pcs', 1, 0, 2, date('now', '+1 day'))`)
  const times = [
    '2026-09-10 14:59:59',       // before start
    '2026-09-10 15:00:00',       // inclusive start, space
    '2026-09-10T15:00:00.000Z',  // inclusive start, ISO
    '2026-09-11 05:00:00',       // interior local noon: must survive continuous scope
    '2026-09-11T19:00:59.000Z',  // last selected minute, ISO
    '2026-09-11 19:00:59',       // last selected minute, space
    '2026-09-11T19:00:59.999Z',  // fractional last second also in selected minute
    '2026-09-11 19:01:00',       // exclusive upper bound, space
    '2026-09-11T19:01:00.000Z',  // exclusive upper bound, ISO
    '2026-09-12 05:00:00',       // later in selected local end day
    '2026-01-01 05:00:00',       // outside all selected days
  ]
  for (const [index, createdAt] of times.entries()) {
    const id = index + 1
    db.prepare(`INSERT INTO sales (id, receipt_number, created_at, sale_status, branch_id, branch_name,
      subtotal_usd, total_usd, total_khr, customer_name, customer_id, payment_method)
      VALUES (@id, @receipt, @createdAt, 'completed', 1, 'Main', 10, 10, 40000, 'Buyer', 1, 'Cash')`)
      .run({ id, receipt: `T-${id}`, createdAt })
    db.prepare(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, applied_price_usd, total_usd, cost_price_usd)
      VALUES (@id, 1, 'Timed item', 1, 10, 10, 2)`).run({ id })
    for (const scope of ['customer', 'supplier']) {
      db.prepare(`INSERT INTO returns (return_number, created_at, sale_id, return_scope, status, branch_id,
        total_refund_usd, supplier_compensation_usd, supplier_loss_usd)
        VALUES (@number, @createdAt, NULL, @scope, 'completed', 1, 1, 2, 3)`)
        .run({ number: `${scope}-${id}`, createdAt, scope })
    }
  }
  // A refund posted AFTER the selected window still reverses its sale's
  // revenue, while activity cards use the refund's own created_at.
  db.prepare(`INSERT INTO returns (return_number, created_at, sale_id, return_scope, status, branch_id, total_refund_usd)
    VALUES ('late-refund', '2026-09-15 05:00:00', 2, 'customer', 'completed', 1, 2)`).run()
  db.prepare(`INSERT INTO sales (id, receipt_number, created_at, sale_status, branch_id, subtotal_usd, total_usd)
    VALUES (20, 'other-branch', '2026-09-11 05:00:00', 'completed', 2, 100, 100),
           (21, 'cancelled', '2026-09-11 05:00:00', 'cancelled', 1, 100, 100)`).run()

  const summary = await request('/dashboard', timed)
  equal(summary.today_count, 6, 'summary selected sale count')
  equal(summary.today_total, 60, 'summary selected gross amount')
  equal(summary.today_return_count, 6, 'summary return-date activity excludes supplier and late refund')
  equal(summary.today_return_usd, 6, 'summary refund amount')
  equal(sortedIds(summary.recent_sales), [...selected, 21], 'recent sales preserves cancelled visibility and branch filter')
  equal(summary.out_of_stock_count, 1, 'stock alert remains catalog-wide')
  equal(summary.expiring_count, 1, 'expiry alert remains catalog-wide')

  filtersSeen.length = 0
  const analytics = await request('/analytics', timed)
  equal(analytics.totals.tx_count, 6, 'real shared snapshot selects same six receipts')
  equal(analytics.totals.revenue_usd, 58, 'late refund remains attributed to its sale')
  equal(analytics.periodData.reduce((sum, row) => sum + row.revenue_usd, 0), 58, 'period series agrees with shared totals')
  equal(analytics.periodReturns.return_count, 6, 'customer activity continuous bounds')
  equal(analytics.periodSupplierReturns.return_count, 6, 'supplier activity continuous bounds')
  equal(analytics.periodSupplierReturns.supplier_compensation_usd, 12, 'supplier compensation scoped')
  for (const [name, key] of [['byPayment', 'count'], ['byBranch', 'tx_count'], ['topProducts', 'qty_sold'], ['topProductsQty', 'qty_sold'], ['topCustomers', 'sale_count'], ['hourlyDist', 'count']]) {
    equal(analytics[name].reduce((sum, row) => sum + row[key], 0), 6, `${name} continuous window`)
    equal(analytics[name].reduce((sum, row) => sum + row[name === 'topCustomers' ? 'net_revenue_usd' : 'revenue_usd'], 0), 58, `${name} sale-date refund semantics`)
  }
  equal(filtersSeen, [
    { kind: 'shared', ...dates, createdFrom: '2026-09-10 15:00:00', createdTo: '2026-09-11 19:01:00' },
    { kind: 'previous', startDate: '2026-09-07', endDate: '2026-09-09', branchId: '1', createdFrom: '2026-09-07 15:00:00', createdTo: '2026-09-08 19:01:00' },
  ], 'shared and previous-period calls preserve clock endpoints and three-calendar-day shift')
  const startup = await request('/dashboard/startup', timed)
  equal(startup.summary, summary, 'startup summary matches standalone')
  equal(startup.analytics, analytics, 'startup analytics matches standalone')

  for (const [insight, key, expected] of [['recent_sales', 'id', [...selected, 21]], ['top_products', 'qty_sold', [6]], ['top_products_qty', 'qty_sold', [6]], ['top_customers', 'sale_count', [6]], ['expiring_products', 'id', [1]]]) {
    const list = await request('/dashboard/insight-list', { ...timed, insight })
    equal(list.items.map(row => row[key]).sort((a, b) => a - b), expected, `${insight} drilldown parity`)
  }
  const fullDay = await request('/dashboard', dates)
  equal(fullDay.today_count, 10, 'date-only includes complete selected days')
  equal((await request('/analytics', dates)).totals.tx_count, 10, 'date-only real snapshot parity')
  const minute = { startDate: '2026-09-12', endDate: '2026-09-12', branchId: '1', createdFrom: '2026-09-11T19:00:00Z', createdTo: '2026-09-11T19:01:00Z' }
  equal((await request('/dashboard', minute)).today_count, 3, 'one selected minute includes all seconds and fractions')
  const all = { rangeScope: 'all', startDate: '', endDate: '', branchId: '1' }
  equal((await request('/dashboard', all)).today_count, 11, 'explicit all-time remains unbounded')
  filtersSeen.length = 0
  equal((await request('/analytics', all)).totals.tx_count, 11, 'all-time snapshot remains unbounded')
  equal(filtersSeen.length, 1, 'all-time only calls combined snapshot, no previous period')
  equal(filtersSeen[0].createdFrom, undefined, 'all-time has no timestamp bound')

  const invalid = [
    { ...dates, startDate: '2026-02-30' }, { ...dates, startDate: 'garbage' },
    { ...dates, endDate: '2026-09-09' }, { startDate: '2026-09-10' }, { endDate: '2026-09-10' },
    { ...dates, startDate: '2026-09-10T00:00:00Z' },
    { ...dates, createdFrom: timed.createdFrom }, { ...dates, createdTo: timed.createdTo },
    { ...timed, createdFrom: '' }, { ...timed, createdTo: '' },
    { ...timed, createdFrom: '2026-02-30T15:00:00Z' }, { ...timed, createdFrom: '2026-09-10T25:00:00Z' },
    { ...timed, createdTo: 'not-a-time' }, { ...timed, createdTo: timed.createdFrom },
    { ...timed, createdFrom: timed.createdTo, createdTo: timed.createdFrom },
    { ...timed, createdFrom: '2026-09-10T15:00:00.500Z' },
    { ...all, createdFrom: timed.createdFrom, createdTo: timed.createdTo },
    { createdFrom: timed.createdFrom, createdTo: timed.createdTo },
  ]
  for (const endpoint of ['/dashboard', '/analytics', '/dashboard/startup', '/dashboard/insight-list']) {
    for (const query of invalid) {
      reads = 0
      const body = await request(endpoint, { ...query, insight: 'recent_sales' }, 400)
      equal(typeof body.error, 'string', 'invalid bounds return useful error')
      equal(reads, 0, 'invalid bounds fail before opening database')
    }
  }
  user = { id: 2, username: 'employee', role_code: 'employee', permissions: JSON.stringify({ dashboard: true }) }
  equal('cost_usd' in (await request('/analytics', timed)).totals, false, 'cost hidden without cost-view grant')
  user.permissions = JSON.stringify({ dashboard: true, product_cost_view: true })
  equal('cost_usd' in (await request('/analytics', timed)).totals, true, 'cost-view grant preserved')
  user.permissions = '{}'
  reads = 0
  await request('/dashboard/startup', timed, 403)
  equal(reads, 0, 'Dashboard permission denied before reading data')
  console.log(`PASS ${checks} Dashboard timed-range SQL/handler checks`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.db.close())
