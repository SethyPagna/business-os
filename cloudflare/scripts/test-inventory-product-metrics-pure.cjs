const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')

function loadTs(relativePath, exactStubs = {}) {
  const filePath = path.join(srcRoot, relativePath)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText
  const fallback = new Proxy({}, { get: (_target, property) => property === 'default' ? {} : () => undefined })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(exactStubs, request)) return exactStubs[request]
    if (request.startsWith('.')) return fallback
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const loaded = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      loaded.exports, require, loaded, filePath, path.dirname(filePath),
    )
    return loaded.exports
  } finally {
    Module._load = originalLoad
  }
}

const localDateAtOrAfter = (column) => `date(${column}, '+7 hours') >= @startDate AND ${column} >= date(@startDate, '-1 day')`
const localDateAtOrBefore = (column) => `date(${column}, '+7 hours') <= @endDate AND ${column} < date(@endDate, '+1 day')`
const recognizedExpr = (prefix) => `COALESCE(NULLIF(${prefix}sale_status, ''), 'completed') <> 'cancelled'`
const inventory = loadTs('routes/inventory.ts', {
  hono: { Hono },
  '../lib/businessDateWindow': { localDateAtOrAfter, localDateAtOrBefore },
  '../lib/salesAnalytics': { recognizedExpr },
  '../index': {},
})
const familyPagination = loadTs('lib/familyPagination.ts')
const permissions = loadTs('lib/permissions.ts')
const { attachInventoryProductMetrics } = inventory

assert.equal(typeof attachInventoryProductMetrics, 'function')

function dbAdapter(d1, trace = []) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get(params) { trace.push({ kind: 'get', sql, params }); return statement.get(params || {}) },
        all(params) { trace.push({ kind: 'all', sql, params }); return statement.all(params || {}) },
        run(params) { trace.push({ kind: 'run', sql, params }); return statement.run(params || {}) },
      }
    },
    batch(statements) { return d1.batch(statements) },
  }
}

function setupDatabase() {
  const d1 = openDb([])
  d1.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, name TEXT, name_key TEXT, parent_id INTEGER,
      is_active INTEGER DEFAULT 1, created_at TEXT,
      stock_quantity REAL, purchase_price_usd REAL, cost_price_usd REAL,
      purchase_price_khr REAL, cost_price_khr REAL
    );
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL);
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY, branch_id INTEGER, sale_status TEXT, created_at TEXT,
      subtotal_usd REAL, subtotal_khr REAL, discount_usd REAL, discount_khr REAL,
      membership_discount_usd REAL, membership_discount_khr REAL
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER, branch_id INTEGER,
      quantity REAL, total_usd REAL, total_khr REAL, cost_price_usd REAL, cost_price_khr REAL
    );
    CREATE TABLE returns (
      id INTEGER PRIMARY KEY, branch_id INTEGER, status TEXT, return_scope TEXT, created_at TEXT
    );
    CREATE TABLE return_items (
      id INTEGER PRIMARY KEY, return_id INTEGER, product_id INTEGER, branch_id INTEGER,
      quantity REAL, total_usd REAL, total_khr REAL, cost_price_usd REAL, cost_price_khr REAL,
      return_to_stock INTEGER
    );
    INSERT INTO products VALUES
      (1,'Serum','serum',NULL,1,'2026-01-01',14,2,3,8000,12000),
      (2,'Serum','serum',NULL,1,'2026-01-01',7,4,4,16000,16000),
      (3,'Toner','toner',NULL,1,'2026-01-01',6,5,5,20000,20000);
    INSERT INTO branch_stock VALUES (1,1,5),(1,2,9),(2,1,3),(2,2,4),(3,1,6);
    INSERT INTO sales VALUES
      (1,1,'completed','2026-09-04T18:30:00.000Z',20,80000,0,0,0,0),
      (2,1,'awaiting_payment','2026-09-05 03:00:00',50,200000,0,0,0,0),
      (3,2,'completed','2026-09-05 04:00:00',10,40000,0,0,0,0),
      (4,1,'cancelled','2026-09-05 05:00:00',40,160000,0,0,0,0),
      (5,1,'completed','2026-09-05 06:00:00',12,48000,2,8000,0,0),
      (6,1,'completed','2026-08-20 06:00:00',100,400000,0,0,0,0);
    INSERT INTO sale_items VALUES
      (1,1,1,1,2,20,80000,3,12000),
      (2,2,1,1,5,50,200000,3,12000),
      (3,3,1,2,1,10,40000,3,12000),
      (4,4,1,1,4,40,160000,3,12000),
      (5,5,2,1,1,12,48000,4,16000),
      (6,6,1,1,10,100,400000,3,12000);
    INSERT INTO returns VALUES
      (1,1,'completed','customer','2026-09-05 07:00:00'),
      (2,2,'completed','customer','2026-09-05 07:00:00'),
      (3,1,'cancelled','customer','2026-09-05 07:00:00'),
      (4,1,'completed','supplier','2026-09-05 07:00:00');
    INSERT INTO return_items VALUES
      (1,1,1,1,1,10,40000,3,12000,1),
      (2,2,2,2,1,12,48000,4,16000,1),
      (3,3,1,1,1,10,40000,3,12000,1),
      (4,4,1,1,1,10,40000,3,12000,1);
  `)
  return d1
}

async function main() {
  const d1 = setupDatabase()
  const trace = []
  const db = dbAdapter(d1, trace)

  const firstPage = await familyPagination.paginateProductFamilies({
    db,
    selectColumns: 'p.id, p.name',
    joinSql: '',
    whereSql: 'WHERE p.is_active = 1',
    params: {},
    page: 1,
    pageSize: 1,
    familyOrderSql: 'family_name ASC',
    intraFamilyOrderSql: 'id ASC',
  })
  assert.deepEqual(firstPage.items.map((row) => row.id), [1, 2], 'one family slot returns every merged-family row')
  assert.equal(firstPage.total, 2)

  trace.length = 0
  await attachInventoryProductMetrics(db, firstPage.items, {
    branchId: '1',
    startDate: '2026-09-05',
    endDate: '2026-09-05',
  })
  assert.deepEqual(firstPage.items[0], {
    id: 1, name: 'Serum', display_quantity: 5,
    stock_value_usd: 10, stock_value_khr: 40000,
    qty_sold: 6, revenue_usd: 60, revenue_khr: 240000,
    cogs_usd: 18, cogs_khr: 72000, profit_usd: 42,
  }, 'Branch A recognizes awaiting-payment revenue and cost, subtracts customer returns, and excludes cancelled/other-branch rows')
  assert.deepEqual(firstPage.items[1], {
    id: 2, name: 'Serum', display_quantity: 3,
    stock_value_usd: 12, stock_value_khr: 48000,
    qty_sold: 1, revenue_usd: 10, revenue_khr: 40000,
    cogs_usd: 4, cogs_khr: 16000, profit_usd: 6,
  }, 'store discount is allocated from the sale snapshot and Branch B return does not leak into Branch A')

  const metricQueries = trace.filter((entry) => entry.kind === 'all')
  assert.equal(metricQueries.length, 1, 'the whole returned page is enriched by one aggregate query, not N+1')
  assert.deepEqual(JSON.parse(metricQueries[0].params.productIdsJson), [1, 2])
  assert.match(metricQueries[0].sql, /JOIN requested_ids ids ON ids\.product_id = si\.product_id/)
  assert.match(metricQueries[0].sql, /JOIN products p ON p\.id = ids\.product_id/)
  assert.match(metricQueries[0].sql, /si\.branch_id = @branchId/)
  assert.match(metricQueries[0].sql, /date\(s\.created_at, '\+7 hours'\)/)
  assert.match(metricQueries[0].sql, /sale_status, ''\), 'completed'\) <> 'cancelled'/)
  assert.doesNotMatch(metricQueries[0].sql, /NOT IN \('awaiting_payment', 'cancelled'\)/)

  const inventorySource = fs.readFileSync(path.join(srcRoot, 'routes/inventory.ts'), 'utf8')
  assert.doesNotMatch(inventorySource, /NOT IN \('awaiting_payment', 'cancelled'\)/,
    'inventory row and sibling summary calculations must not exclude awaiting-payment sales')
  assert.equal((inventorySource.match(/recognizedExpr\('s\.'\)/g) || []).length, 4,
    'all inventory product revenue/COGS queries share the canonical recognition predicate')

  const secondPage = await familyPagination.paginateProductFamilies({
    db, selectColumns: 'p.id, p.name', joinSql: '', whereSql: 'WHERE p.is_active = 1', params: {},
    page: 2, pageSize: 1, familyOrderSql: 'family_name ASC', intraFamilyOrderSql: 'id ASC',
  })
  assert.deepEqual(secondPage.items.map((row) => row.id), [3], 'family pagination remains intact on page two')
  await attachInventoryProductMetrics(db, secondPage.items, { branchId: '2' })
  assert.equal(secondPage.items[0].display_quantity, 0, 'Branch B stock does not inherit Branch A quantity')

  const branchB = [{ id: 1, name: 'Serum' }]
  await attachInventoryProductMetrics(db, branchB, {
    branchId: '2', startDate: '2026-09-05', endDate: '2026-09-05',
  })
  assert.deepEqual(branchB[0], {
    id: 1, name: 'Serum', display_quantity: 9,
    stock_value_usd: 18, stock_value_khr: 72000,
    qty_sold: 1, revenue_usd: 10, revenue_khr: 40000,
    cogs_usd: 3, cogs_khr: 12000, profit_usd: 7,
  }, 'Branch B receives only its own stock, sale, and return scope')

  const empty = []
  const beforeEmptyQueries = trace.length
  await attachInventoryProductMetrics(db, empty, { branchId: '1' })
  assert.equal(trace.length, beforeEmptyQueries, 'an empty page performs no aggregate query')

  const unchangedOnFailure = [{ id: 1, name: 'Serum' }]
  await assert.rejects(
    attachInventoryProductMetrics({
      prepare() { return { all: async () => { throw new Error('metrics unavailable') } } },
    }, unchangedOnFailure, {}),
    /metrics unavailable/,
  )
  assert.deepEqual(unchangedOnFailure, [{ id: 1, name: 'Serum' }], 'query failure is surfaced, never replaced with invented zero metrics')

  let protectedCalls = 0
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user', c.env.user); await next() })
  app.use('*', async (c, next) => {
    if (permissions.getPermissionTier(c.get('user'), 'inventory') === 'none') return c.json({ error: 'forbidden' }, 403)
    return next()
  })
  app.get('/products/search', async (c) => { protectedCalls++; return c.json({ items: firstPage.items }) })
  const denied = await app.request('/products/search', {}, { user: { role_permissions: '{"products":true}' } })
  assert.equal(denied.status, 403)
  assert.equal(protectedCalls, 0, 'permission denial happens before the product query')
  const reviewViewer = await app.request('/products/search', {}, { user: { role_permissions: '{"inventory":"review"}' } })
  assert.equal(reviewViewer.status, 200, 'review-tier Inventory access retains read permission')
  assert.equal(protectedCalls, 1)

  console.log('inventory product metrics SQLite/Hono tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
