// Regression coverage for sale creation against the real Hono route and the
// complete migrated SQLite schema. The wrapper deliberately reports the
// trigger-inclusive D1 changes count for INSERT sales: migration 0120's
// sale_revision_sales_insert trigger makes a successful production write 2.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
const USER = {
  id: 71,
  username: 'sale_cashier',
  name: 'Sale Cashier',
  permissions: JSON.stringify({ pos: true }),
}

const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', USER); return next() } },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
  },
  '../lib/telegram': {
    formatSaleTelegramLines: () => [],
    sendTelegramEvent: async () => {},
    telegramMoney: (value) => String(value ?? ''),
  },
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/sales.ts').default
const executionCtx = {
  waitUntil(promise) { promise?.catch?.(() => {}) },
  passThroughOnException() {},
}

function routeDb(db) {
  const api = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        all: (params) => statement.all(params),
        get: (params) => statement.get(params),
        run: async (params) => {
          const result = statement.run(params)
          const directChanges = Number(result.meta?.changes || 0)
          return {
            ...result,
            // Native D1 includes sale_revision_sales_insert's write in this
            // metadata. node:sqlite reports only the direct INSERT.
            changes: /INSERT\s+INTO\s+sales\s*\(/i.test(sql) && directChanges > 0
              ? directChanges + 1
              : directChanges,
            lastInsertRowid: Number(result.meta?.last_row_id || 0),
          }
        },
      }
    },
    batch: (statements) => db.batch(statements),
    exec: (sql) => db.exec(sql),
  }
  api.staging = api
  return api
}

function fixture() {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  db.prepare(`INSERT INTO products(id,name,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
              VALUES(10,'Powder','POWDER',10,9.5,38000,4,16000,1)`).run()
  db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,10)').run()
  return { raw: db, route: routeDb(db) }
}

function request(clientRequestId) {
  return {
    branch_id: 1,
    items: [{ product_id: 10, quantity: 1, branch_id: 1, applied_price_usd: 9.5 }],
    exchange_rate: 4000,
    payment_method: 'Cash',
    payment_currency: 'USD',
    amount_paid_usd: 9.5,
    client_request_id: clientRequestId,
  }
}

async function postSale(db, body) {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db }, executionCtx)
  return { status: response.status, body: await response.json() }
}

;(async () => {
  {
    const f = fixture()
    const created = await postSale(f.route, request('trigger-inclusive-create'))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_write_revisions').get().n, 1)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 9)
    console.log('PASS trigger-inclusive D1 changes=2 is accepted as a successful sale header')

    const replay = await postSale(f.route, request('trigger-inclusive-create'))
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.duplicate, true)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 1)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 9)
    console.log('PASS complete idempotent replay returns the original sale without applying stock twice')
  }

  {
    const f = fixture()
    f.raw.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,branch_name,cashier_name,payment_method,total_usd,sale_status)
                   VALUES('ORPHAN','orphan-replay',1,'Shop','Sale Cashier','Cash',9.5,'completed')`).run()
    const replay = await postSale(f.route, request('orphan-replay'))
    assert.equal(replay.status, 409, JSON.stringify(replay.body))
    assert.equal(replay.body.code, 'sale_incomplete')
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1)
    assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 0)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity, 10)
    console.log('PASS an itemless header is never reported as a completed idempotent replay')
  }
})().catch((error) => { console.error(error); process.exit(1) })
