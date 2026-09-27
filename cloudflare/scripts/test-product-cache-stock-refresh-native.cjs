// I2-1: a sale no longer discards every cached catalog page, and another till
// still sees the new stock at once.
//
// Real Hono routes (routes/sales.ts POST /, routes/products.ts GET /search and
// GET /), the REAL lib/cache.ts (version bumps, Cache API keys) over a KV Map
// and a Map-backed caches.default, and the fully migrated node:sqlite schema.
//
//  1. Till A reads a POS search page (cache miss: the page query runs). Till B
//     reads the same URL (cache hit: the page query does not run).
//  2. Till B records a real sale through POST /api/sales.
//     The sale bumps 'stock' and leaves the 'products' version alone.
//  3. Till A reads the page again: still a cache hit (the page query does not
//     re-run -- the pre-fix code re-ran it after every sale), and the row shows
//     the NEW stock_quantity, branch_stock, batch_count and updated_at.
//     POSITIVE CONTROL: the stored cache entry itself still says the OLD stock,
//     so the refresh, not a re-query, delivered the new numbers.
//  4. The refreshed hit is byte-identical to a fresh uncached computation.
//  5. Stock-dependent membership (stockState=out): a sale that empties a
//     product moves it INTO the cached "out" page on the very next read.
//  6. GET /api/products (the bare list) refreshes the same way.
//  7. Source: every sale write path bumps 'stock', none bumps 'products'; the
//     portal key includes 'stock'.
//
// Run: node scripts/test-product-cache-stock-refresh-native.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let checks = 0
function check(label, cond) {
  assert.ok(cond, `FAIL: ${label}`)
  checks++
  console.log(`  ok  ${label}`)
}

const USER = {
  id: 71, username: 'till', name: 'Till', role_code: 'admin', organization_id: null,
  permissions: JSON.stringify({ all: true }), role_permissions: JSON.stringify({ all: true }),
}

// ---- module loader (real sources, a few side-effect modules stubbed) -------
const moduleCache = new Map()
const SRC = path.join(__dirname, '..', 'src')
const stubs = {
  'lib/audit.ts': { audit: async () => {} },
  'durable-objects/broadcastHub.ts': { broadcast: async () => {} },
  'lib/telegram.ts': {
    formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [],
    sendTelegramEvent: async () => {}, telegramMoney: (value) => String(value ?? ''),
  },
}
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  new Function('require', 'module', 'exports', output)((request) => {
    if (!request.startsWith('.')) return request.startsWith('cloudflare:') ? { DurableObject: class {} } : require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    const file = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`
    if (stubs[file]) return stubs[file]
    if (file === 'lib/db.ts') return { ...load(file), getDb: (env) => env.DB }
    if (file === 'lib/auth.ts') return { ...load(file), requireAuth: async (c, next) => { c.set('user', USER); return next() }, getSessionUser: async () => USER }
    return load(file)
  }, mod, mod.exports)
  return mod.exports
}

// ---- Cache API + KV --------------------------------------------------------
const cacheStore = new Map()
globalThis.caches = {
  default: {
    match: async (request) => (cacheStore.has(request.url) ? new Response(cacheStore.get(request.url)) : undefined),
    put: async (request, response) => { cacheStore.set(request.url, await response.text()) },
  },
}
const kv = new Map()
const CACHE = {
  get: async (key) => (kv.has(key) ? kv.get(key) : null),
  put: async (key, value) => { kv.set(key, String(value)) },
  delete: async (key) => { kv.delete(key) },
}

// ---- fixture ---------------------------------------------------------------
const raw = openDb(loadAll())
raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
const insertProduct = raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at)
  VALUES(?,?,?,?,?,9.5,38000,4,16000,1,'2026-09-01 00:00:00')`)
const stockProduct = (id, name, qty) => {
  insertProduct.run([id, name, name.toUpperCase().replace(/\W/g, ''), `88500000${id}`, qty])
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)').run([id, qty])
  raw.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number)
    VALUES(?,?,?,?,'2027-06-01','2026-09-01',1,1)`).run([500 + id, id, `lot-${id}`, `LOT-${id}`])
  raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run([500 + id, qty])
}
stockProduct(10, 'Powder Foundation', 10)
stockProduct(11, 'Powder Brush', 1)
stockProduct(12, 'Rose Serum', 5)

// Count executions of the family page query -- the expensive part the cache
// exists to skip. familyPagination's CTE is the only SQL naming `matched AS`.
let pageQueries = 0
const counted = (sql) => { if (/\bmatched AS\b/.test(sql)) pageQueries++ }
const db = {
  prepare(sql) { counted(sql); return raw.prepare(sql) },
  // One page read = one batch (COUNT + page), counted once.
  batch: async (statements) => { if (statements.some((s) => /\bmatched AS\b/.test(s.sql))) pageQueries++; return raw.batch(statements) },
  exec: (sql) => raw.exec(sql),
}
db.staging = db
const env = { DB: db, CACHE, ENVIRONMENT: 'test' }

const app = new Hono()
app.route('/api/sales', load('routes/sales.ts').default)
app.route('/api/products', load('routes/products.ts').default)

async function call(method, route, body) {
  const waits = []
  const response = await app.request(`http://localhost${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, { waitUntil: (promise) => waits.push(promise), passThroughOnException() {} })
  const text = await response.text()
  await Promise.all(waits)
  return { status: response.status, text, json: JSON.parse(text) }
}

function saleOf(productId, quantity, requestId) {
  return {
    branch_id: 1, money_precision_version: 1, exchange_rate: 4000,
    payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: 9.5 * quantity,
    client_request_id: requestId,
    offline_owner: { version: 1, actor_id: USER.id, organization_id: null, authority: 'http://localhost', runtime: 'cloudflare-workers' },
    items: [{
      product_id: productId, quantity, branch_id: 1, batch_id: 500 + productId,
      applied_price_usd: 9.5, client_line_key: `line-${requestId}`, pricing_source: 'selling',
      pricing_quote: { gross_usd: 9.5 * quantity, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5 * quantity, total_khr: 38000 * quantity },
    }],
  }
}

const row = (payload, id) => payload.items.find((item) => Number(item.id) === id)
const version = (namespace) => kv.get(`v2:${namespace}`) ?? null

;(async () => {
  const URL = '/api/products/search?query=powder&page=1&pageSize=20&surface=pos&sort=name_asc'

  // ---- 1 ----
  const a1 = await call('GET', URL)
  check(`till A first read ok (${a1.status})`, a1.status === 200 && row(a1.json, 10))
  check(`till A first read ran the page query (cache miss) [${pageQueries}]`, pageQueries === 1)
  check('fixture: product 10 starts at 10 units', row(a1.json, 10).stock_quantity === 10)
  const b1 = await call('GET', URL)
  check('till B same URL is a cache hit (page query not re-run)', pageQueries === 1)
  check('till B cache hit is byte-identical to till A miss (nothing changed)', b1.text === a1.text)

  // ---- 2 ----
  const productsBefore = version('products')
  const stockBefore = version('stock')
  const sale = await call('POST', '/api/sales', saleOf(10, 3, 'till-b-sale-1'))
  check(`till B sale recorded (${sale.status})`, sale.status === 200 && sale.json.id)
  check('DB: product 10 branch stock now 7', raw.prepare('SELECT quantity q FROM branch_stock WHERE product_id=10').get().q === 7)
  check(`sale left the 'products' version alone (${productsBefore} -> ${version('products')})`, version('products') === productsBefore)
  check(`sale bumped the 'stock' version (${stockBefore} -> ${version('stock')})`, version('stock') !== stockBefore && version('stock') != null)

  // ---- 3 ----
  const a2 = await call('GET', URL)
  check('till A after the sale: still a cache hit (the page query did not re-run)', pageQueries === 1)
  const live = raw.prepare('SELECT stock_quantity, updated_at FROM products WHERE id=10').get()
  check('till A sees the new stock_quantity (7)', row(a2.json, 10).stock_quantity === 7)
  check('till A sees the new branch_stock (7)', row(a2.json, 10).branch_stock.find((b) => b.branch_id === 1).quantity === 7)
  check('till A sees the live updated_at (edit conflict token matches the row)', row(a2.json, 10).updated_at === live.updated_at && live.updated_at !== '2026-09-01 00:00:00')
  const stored = [...cacheStore.entries()].find(([key]) => key.includes('query=powder'))
  check('POSITIVE CONTROL: the cached page itself still holds the pre-sale stock (10)', stored && row(JSON.parse(stored[1]), 10).stock_quantity === 10)
  check('the untouched row in the same page is unchanged', JSON.stringify(row(a2.json, 11)) === JSON.stringify(row(a1.json, 11)))

  // ---- 4 ----
  cacheStore.clear()
  const fresh = await call('GET', URL)
  check('uncached recomputation ran the page query', pageQueries === 2)
  check('refreshed cache hit is byte-identical to a fresh computation', a2.text === fresh.text)

  // ---- 5 ----
  const OUT = '/api/products/search?page=1&pageSize=20&surface=pos&stockState=out'
  const out1 = await call('GET', OUT)
  check('fixture: "out" page does not list product 11 while it has 1 unit', out1.status === 200 && !row(out1.json, 11))
  const sale2 = await call('POST', '/api/sales', saleOf(11, 1, 'till-b-sale-2'))
  check(`second sale empties product 11 (${sale2.status})`, sale2.status === 200)
  const queriesBefore = pageQueries
  const out2 = await call('GET', OUT)
  check('stock-dependent page re-queried after the sale (keyed on the stock version)', pageQueries === queriesBefore + 1)
  check('"out" page now lists product 11', row(out2.json, 11) && row(out2.json, 11).stock_quantity === 0)

  // ---- 6 ----
  const list1 = await call('GET', '/api/products')
  const listQueries = pageQueries
  await call('POST', '/api/sales', saleOf(12, 2, 'till-b-sale-3'))
  const list2 = await call('GET', '/api/products')
  check('GET /api/products after a sale is a cache hit', pageQueries === listQueries)
  const l1 = list1.json.find((p) => p.id === 12)
  const l2 = list2.json.find((p) => p.id === 12)
  check('GET /api/products shows the new stock (5 -> 3)', l1.stock_quantity === 5 && l2.stock_quantity === 3)

  // ---- 7 ----
  const salesSrc = fs.readFileSync(path.join(SRC, 'routes/sales.ts'), 'utf8')
  const bulkSrc = fs.readFileSync(path.join(SRC, 'lib/saleBulkStatus.ts'), 'utf8')
  const portalSrc = fs.readFileSync(path.join(SRC, 'routes/portal.ts'), 'utf8')
  check("routes/sales.ts bumps 'stock' on its four stock-moving paths", (salesSrc.match(/bumpVersion\(c\.env, 'stock'\)/g) || []).length === 4)
  check("routes/sales.ts bumps 'products' nowhere", !/bumpVersions?\([^)]*'products'/.test(salesSrc))
  check("lib/saleBulkStatus.ts bumps 'stock', not 'products'", /bumpVersion\(env, 'stock'\)/.test(bulkSrc) && !/bumpVersion\(env, 'products'\)/.test(bulkSrc))
  check("portal cache key includes the 'stock' version", /getVersionWithFallback\(c\.env, 'stock'\)/.test(portalSrc))

  console.log(`\n${checks} checks passed`)
})().catch((error) => { console.error(error); process.exit(1) })
