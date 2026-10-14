// Cost-unknown slice S11 (security): branch stock VALUE is acquisition-cost
// information. GET /api/branches/:id/stock returned `total_value_usd` and
// `positive_value_usd` to every caller with branch access because neither key
// carries a token the response projection (acquisitionCostResponses) redacts.
// This runs the REAL route module, the REAL projection middleware and a real
// SQLite database, and asserts a caller without product_cost_view receives no
// value key at all (absent, not null and not 0), while a cost viewer still gets
// the figure and the unknown-product count.
//
// Run (from cloudflare/): node scripts/test-cost-s11-branch-value-redaction-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const REAL = new Set(['acquisitionCostAccess', 'permissions', 'familyStockStats', 'familyPagination', 'lowStockSettings',
  'productStockGuard', 'productSearchQuery', 'sqlBinding', 'searchMatch', 'moneyPrecision', 'costValue', 'branches'])
const noop = new Proxy(function noop() {}, { get: (_t, key) => key === 'default' ? noop : noop, apply: () => undefined })
const state = { db: null }
const routes = new Map()
const middleware = []

class HonoStub {
  use(_pattern, ...handlers) { middleware.push(...handlers) }
  route() {}
  on() {}
  all() {}
}
for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  HonoStub.prototype[method] = function register(routePath, ...handlers) { routes.set(`${method.toUpperCase()} ${routePath}`, handlers) }
}

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const requireShim = (request) => {
    if (request === 'hono') return { Hono: HonoStub }
    if (!request.startsWith('.')) return require(request)
    const base = path.basename(request)
    if (base === 'db') return { getDb: () => state.db }
    if (base === 'auth') return { requireAuth: noop }
    if (!REAL.has(base)) return noop
    return load(path.resolve(path.dirname(file), `${request}.ts`))
  }
  new Function('require', 'module', 'exports', output)(requireShim, mod, mod.exports)
  return mod.exports
}

function adapter(d1) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get: async (params) => statement.get(params || {}) ?? null,
        all: async (params) => statement.all(params || {}),
        run: async (params) => statement.run(params || {}),
      }
    },
    batch: (statements) => d1.batch(statements),
  }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log('PASS', name) }

const costRedaction = () => load(path.join(SRC, 'lib', 'acquisitionCostAccess.ts')).acquisitionCostResponses

async function call(user, routeKey, query = {}) {
  const handlers = routes.get(routeKey)
  assert.ok(handlers, `route ${routeKey} registered`)
  const handler = handlers[handlers.length - 1]
  let out = null
  const ctx = {
    env: {},
    get: (key) => key === 'user' ? user : undefined,
    header() {},
    req: { path: '/api/branches/1/stock', param: () => '1', query: (key) => query[key], json: async () => ({}) },
    json: (value, status = 200) => { out = { value: JSON.parse(JSON.stringify(value)), status } },
  }
  await costRedaction()(ctx, async () => { await handler(ctx) })
  return out
}

async function main() {
  load(path.join(SRC, 'routes', 'branches.ts'))
  const d1 = openDb(loadAll())
  state.db = adapter(d1)
  d1.prepare("INSERT OR IGNORE INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  const product = d1.prepare(`INSERT INTO products (id, name, stock_quantity, cost_price_usd, cost_price_khr, purchase_price_usd, is_active, is_group)
    VALUES (@id, @name, @qty, @usd, @khr, @usd, 1, 0)`)
  product.run({ id: 1, name: 'Costed', qty: 5, usd: 2, khr: 8000 })
  product.run({ id: 2, name: 'Unknown cost', qty: 3, usd: null, khr: null })
  const stock = d1.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@id, 1, @qty)')
  stock.run({ id: 1, qty: 5 })
  stock.run({ id: 2, qty: 3 })

  const viewer = { id: 7, username: 'finance', role: 'staff', permissions: JSON.stringify({ branches: true, product_cost_view: true }) }
  const plain = { id: 8, username: 'cashier', role: 'staff', permissions: JSON.stringify({ branches: true }) }
  const valueKeys = (summary) => Object.keys(summary).filter((key) => /value/i.test(key))

  await check('paged branch stock: a caller WITHOUT product_cost_view receives no value key at all', async () => {
    const res = await call(plain, 'GET /:id/stock', { page: '1' })
    assert.equal(res.status, 200)
    assert.ok(res.value.summary, 'summary present')
    assert.equal(res.value.summary.total_products, 2, 'non-cost figures still served')
    assert.deepEqual(valueKeys(res.value.summary), [], 'no total_value_usd / positive_value_usd / stock_value_* key (absent, not 0)')
    assert.ok(!JSON.stringify(res.value).includes('"cost_price_usd":'), 'row cost columns stay redacted as before')
  })

  await check('paged branch stock: a cost viewer still receives the figure and the unknown-product counts', async () => {
    const res = await call(viewer, 'GET /:id/stock', { page: '1' })
    assert.equal(res.status, 200)
    const s = res.value.summary
    assert.equal(s.total_value_usd, 10, '5 x $2; the NULL-cost product is not priced')
    assert.equal(s.positive_value_usd, 10)
    assert.equal(s.stock_value_unknown_products, 1)
    assert.equal(s.positive_stock_value_unknown_products, 1)
  })

  await check('control: the org-wide summary was already redacted for a non-viewer and still serves the viewer', async () => {
    const hidden = await call(plain, 'GET /summary')
    assert.deepEqual(valueKeys(hidden.value), [], 'no stock_value_* key without cost view')
    assert.equal(hidden.value.total_products, 2)
    const shown = await call(viewer, 'GET /summary')
    assert.equal(shown.value.stock_value_usd, 10)
    assert.equal(shown.value.stock_value_unknown_products, 1)
  })

  console.log(`\n${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
