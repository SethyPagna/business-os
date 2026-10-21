// Products list -> held ("tagged") stock used to be a SECOND request per list open and per page/search
// change (GET /api/inventory/tagged-lots). GET /api/products/search?include=tagged_lots now folds the same
// groups into the answer. Pinned here:
//  1. the folded groups equal the separate endpoint's answer for the page's ids (parity), incl. ordering;
//  2. no include -> no key (POS and every other caller pay nothing); folded groups never enter `items`;
//  3. the groups are live: a cache hit still shows a lot written after the page was cached;
//  4. a caller without Inventory view gets no key (the separate endpoint's refusal is unchanged).
//
// Run: node scripts/test-products-search-tagged-lots-include-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

let checks = 0
function check(label, cond) { assert.ok(cond, `FAIL: ${label}`); checks++; console.log(`  ok  ${label}`) }

const ADMIN = { id: 71, username: 'till', name: 'Till', role_code: 'admin', organization_id: null,
  permissions: JSON.stringify({ all: true }), role_permissions: JSON.stringify({ all: true }) }
const PRODUCTS_ONLY = { id: 72, username: 'emp', name: 'Emp', role_code: 'employee', organization_id: null,
  permissions: JSON.stringify({}), role_permissions: JSON.stringify({ products: true }) }
let USER = ADMIN

const moduleCache = new Map()
const SRC = path.join(__dirname, '..', 'src')
const stubs = {
  'lib/audit.ts': { audit: async () => {} },
  'durable-objects/broadcastHub.ts': { broadcast: async () => {} },
}
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: sourcePath,
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

const cacheStore = new Map()
globalThis.caches = {
  default: {
    match: async (request) => (cacheStore.has(request.url) ? new Response(cacheStore.get(request.url)) : undefined),
    put: async (request, response) => { cacheStore.set(request.url, await response.text()) },
  },
}
const kv = new Map()
const CACHE = { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)) }, delete: async (k) => { kv.delete(k) } }

const raw = openDb(loadAll())
seedStockFixture(raw.db, () => {
  raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1),(2,'Store',0,1)").run()
  for (const [id, name] of [[10, 'Powder Foundation'], [11, 'Powder Brush'], [12, 'Rose Serum']]) {
    raw.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active,updated_at)
      VALUES(?,?,?,?,5,9.5,38000,4,16000,1,'2026-09-01 00:00:00')`).run([id, name, `SKU${id}`, `88500000${id}`])
    raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run([id])
  }
})
const addLot = (productId, branchId, tag, qty) => seedStockFixture(raw.db, () => raw.prepare(
  'INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,quantity,quantity_remaining,condition_tag) VALUES(?,?,?,?,?,?)',
).run([productId, `P${productId}`, branchId, qty, qty, tag]))
addLot(10, 1, 'damaged', 2); addLot(10, 1, 'damaged', 1); addLot(10, 2, 'expired', 4); addLot(11, 1, 'opened', 3)
addLot(12, 1, 'broken', 9) // outside the "powder" page

let pageQueries = 0
const db = {
  prepare(sql) { if (/\bmatched AS\b/.test(sql)) pageQueries++; return raw.prepare(sql) },
  batch: async (statements) => { if (statements.some((s) => /\bmatched AS\b/.test(s.sql))) pageQueries++; return raw.batch(statements) },
  exec: (sql) => raw.exec(sql),
}
db.staging = db
const env = { DB: db, CACHE, ENVIRONMENT: 'test' }
const app = new Hono()
app.route('/api/products', load('routes/products.ts').default)
app.route('/api/inventory', load('routes/inventory.ts').default)

async function get(url) {
  const waits = []
  const response = await app.request(`http://localhost${url}`, {}, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} })
  const text = await response.text()
  await Promise.all(waits)
  return { status: response.status, json: JSON.parse(text) }
}

;(async () => {
  const LIST = '/api/products/search?query=powder&page=1&pageSize=20&sort=name_asc'
  const FOLD = `${LIST}&include=branch_stock,images,batches,tagged_lots`
  const folded = await get(FOLD)
  check(`folded list answers 200 (${folded.status})`, folded.status === 200)
  const ids = folded.json.items.map((r) => r.id)
  check('page holds exactly the two powder products', ids.length === 2 && ids.includes(10) && ids.includes(11))
  const separate = await get(`/api/inventory/tagged-lots?productIds=${ids.join(',')}`)
  check('separate endpoint answers', separate.status === 200 && separate.json.items.length === 3)
  check('PARITY: folded groups deep-equal the separate endpoint for the page ids', JSON.stringify(folded.json.tagged_lots) === JSON.stringify(separate.json.items))
  check('the other page lot (product 12) is not folded in', !folded.json.tagged_lots.some((g) => g.product_id === 12))
  check('items rows carry no tagged data and stock is the sellable figure (5)', folded.json.items.every((r) => r.stock_quantity === 5 && !('tagged_lots' in r)))

  const plain = await get(`${LIST}&include=branch_stock,images,batches`)
  check('no include=tagged_lots -> no tagged_lots key', plain.status === 200 && !('tagged_lots' in plain.json))

  const before = pageQueries
  addLot(11, 2, 'broken', 7)
  const after = await get(FOLD)
  check('cache hit: the page query did not re-run', pageQueries === before)
  check('LIVE: a lot written after caching is in the folded groups', after.json.tagged_lots.some((g) => g.product_id === 11 && g.condition_tag === 'broken' && g.quantity === 7))
  const separate2 = await get(`/api/inventory/tagged-lots?productIds=${ids.join(',')}`)
  check('still equal to the separate endpoint after the write', JSON.stringify(after.json.tagged_lots) === JSON.stringify(separate2.json.items))

  USER = PRODUCTS_ONLY
  const denied = await get(FOLD)
  check(`no Inventory view: list still answers (${denied.status}) without the key`, denied.status === 200 && !('tagged_lots' in denied.json))
  const refused = await get(`/api/inventory/tagged-lots?productIds=${ids.join(',')}`)
  check(`separate endpoint still refuses that caller (${refused.status})`, refused.status === 403)
  console.log(`\n${checks} checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
