// Physical D1 statement budget of the image-only Products list (6.0.854).
//
// The image-only /search leaves the shared edge cache (a payload cached for one
// grant set must never reach another), so every request pays for its own reads.
// This drives the REAL Worker (index.ts: real cookie auth, session, middleware)
// over the full migration schema with a 500-row catalog (100 name families x 5
// rows, one lot each) and counts every statement that reaches D1 -- the same
// instrument test-intake-full-request-budget.cjs uses -- for cold and warm
// requests, both page sizes, with and without a search, and with every filter.
// The free plan's conservative per-invocation cap is 50 statements.
//
// Run (from cloudflare/): node scripts/test-products-image-only-request-budget.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const header = fs.readFileSync(path.join(__dirname, 'test-stock-session-route-budget-native.cjs'), 'utf8').split('const metrics=')[0]
const load = new Function('require', '__dirname', header + ';return load;')(require, __dirname)
globalThis.__WORKER_BUILD_REVISION__ = 'image-only-budget-fixture'
globalThis.__WORKER_BUILT_AT__ = '2026-10-19T00:00:00Z'
let build = 0
let observed
const metrics = load('lib/requestMetrics.ts')
const originalMiddleware = metrics.requestMetricsMiddleware
metrics.requestMetricsMiddleware = async (c, next) => {
  await originalMiddleware(c, next)
  observed = c.get('requestMetrics')
}
const worker = load('index.ts').default
const core = load('lib/coreDataInvariants.ts')
const { fixture } = require('./test-stock-session-atomic.cjs')
globalThis.fetch = async () => new Response('{"ok":true}')
// Only the full-access comparison reads reach the shared Cache API; the image-only path never does (asserted below).
let cacheTouches = 0
globalThis.caches = { default: { match: async () => { cacheTouches += 1; return undefined }, put: async () => { cacheTouches += 1 } } }

const FAMILIES = 100
const ROWS = 5
const CAP = 50
const GRANTS = {
  products_image_only: true,
  products_image_only_show_price: true, products_image_only_show_barcode: true, products_image_only_show_category: true,
  products_image_only_show_brand: true, products_image_only_show_stock: true, products_image_only_show_branch_stock: true,
  products_image_only_show_batches: true,
}

function seedCatalog(f) {
  const categories = ['Skin', 'Hair', 'Makeup', 'Body']
  const brands = ['Acme', 'Beta', 'Delta', 'Echo', 'Fox']
  const insertProduct = f.sql.prepare(`INSERT INTO products(id,name,barcode,category,brand,cost_price_usd,cost_price_khr,stock_quantity,is_active)
    VALUES(?,?,?,?,?,2,0,0,1)`)
  const insertStock = f.sql.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,?)')
  const insertLot = f.sql.prepare("INSERT INTO product_batches(variant_product_id,batch_key,received_at,is_active) VALUES(?,?,?,1)")
  seedStockFixture(f.sql, () => {
    let id = 100
    for (let family = 0; family < FAMILIES; family += 1) {
      for (let row = 0; row < ROWS; row += 1) {
        id += 1
        insertProduct.run(id, `Family ${String(family).padStart(3, '0')}`, `BC-${family}-${row}`, categories[family % 4], brands[family % 5])
        insertStock.run(id, (family + row) % 7)
        insertLot.run(id, `budget-${id}`, `2026-10-${String(1 + (family % 28)).padStart(2, '0')}`)
      }
    }
  })
}

async function world() {
  const f = fixture()
  f.env.PLAN_TIER = 'free'
  load('lib/planTier.ts').__resetPlanTierCacheForTests()
  await core.ensureCoreDataInvariants(f.env)
  f.sql.exec(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active)
    SELECT 7,'admin','Admin','fixture',id,'{"all":true}',1 FROM roles WHERE code='admin' LIMIT 1`)
  f.sql.exec("INSERT INTO roles(id,name,permissions,code) VALUES(90,'Viewer','{}','viewer')")
  f.sql.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active) VALUES(8,'viewer','Viewer','fixture',90,?,1)").run(JSON.stringify(GRANTS))
  await core.ensureCoreDataInvariants(f.env)
  seedCatalog(f)
  const tokens = { 7: 'budget-admin-cookie', 8: 'budget-viewer-cookie' }
  for (const [userId, token] of Object.entries(tokens)) {
    f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,NULL)').run(
      Number(userId), createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 29 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString())
  }
  f.env.BROADCAST_HUB = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('{}') }) }
  f.env.CACHE = { get: async () => null, put: async () => { throw Error('KV unavailable') }, delete: async () => {} }
  f.env.BUSINESS_OS_ADMIN_URL = 'https://admin.budget.example'
  globalThis.__WORKER_BUILD_HASH__ = 'unique-image-only-' + ++build
  f.sql.prepare('INSERT INTO system_flags(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    'core_invariants_build', JSON.stringify({ status: 'verified', build: globalThis.__WORKER_BUILD_REVISION__ + ':' + globalThis.__WORKER_BUILD_HASH__, at: Date.now(), watermark: 1 }))
  let physical = 0
  let log = []
  const note = (sql, prefix = '') => log.push(prefix + sql.replace(/\s+/g, ' ').slice(0, 120))
  const raw = f.env.DB
  const statement = (p) => new Proxy(p, { get(t, key) {
    if (key === 'bind') return (...v) => statement(t.bind(...v))
    if (key === 'unmetered') return t
    if (['all', 'run', 'first'].includes(key)) return async (...v) => {
      physical += 1
      note(t.text)
      if (physical > CAP) throw new Error(`conservative free cap exceeded: ${physical} (${t.text.slice(0, 80)})`)
      return t[key](...v)
    }
    return t[key]
  } })
  f.env.DB = new Proxy(raw, { get(t, key) {
    if (key === 'prepare') return (sql) => statement(t.prepare(sql))
    if (key === 'batch') return (ss) => {
      physical += ss.length
      ss.forEach((s) => note(s.text, 'batch: '))
      if (physical > CAP) throw new Error(`conservative free cap exceeded: ${physical}`)
      // The stock fixture's batch() shim only runs writes (it returns metadata, never rows), so a
      // batch made purely of reads -- the family count+page pair, the facet pair -- is answered
      // statement by statement with real rows. Still one admission-counted round trip above.
      if (ss.every((s) => /^\s*(WITH|SELECT)\b/i.test(s.text))) return Promise.all(ss.map((s) => s.unmetered.all()))
      return t.batch(ss)
    }
    return t[key]
  } })
  const read = async (userId, query, cold) => {
    if (cold) { load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests() }
    physical = 0
    log = []
    const pending = []
    const response = await worker.fetch(new Request(`https://admin.budget.example/api/products/search?${query}`, {
      headers: { cookie: `bos_session=${tokens[userId]}`, origin: 'https://admin.budget.example' },
    }), f.env, { waitUntil(p) { pending.push(Promise.resolve(p)) }, passThroughOnException() {} })
    const body = await response.json()
    const tasks = await Promise.allSettled(pending)
    assert.equal(tasks.filter((task) => task.status === 'rejected').length, 0)
    if (process.env.BUDGET_DEBUG || observed.invocation.attemptedStatements !== physical) console.log(log.map((line, i) => `${i + 1}. ${line}`).join('\n'))
    assert.equal(observed.invocation.attemptedStatements, physical, 'invocation admission count equals the physical statements')
    return { status: response.status, body, physical }
  }
  return { f, read }
}

;(async () => {
  const { f, read } = await world()
  let cases = 0
  const matrix = []
  for (const pageSize of [20, 100]) for (const search of ['', 'query=Family%20040']) for (const filters of ['', 'category=Skin&brand=Acme&stockState=in_stock&startDate=2026-10-01&endDate=2026-10-28&sort=name_desc']) {
    matrix.push({ pageSize, search, filters })
  }
  for (const { pageSize, search, filters } of matrix) {
    const query = [`pageSize=${pageSize}`, search, filters].filter(Boolean).join('&')
    const label = `pageSize=${pageSize} ${search ? 'search' : 'browse'} ${filters ? 'all-filters' : 'no-filters'}`
    const cold = await read(8, query, true)
    assert.equal(cold.status, 200, `${label} cold -> ${JSON.stringify(cold.body).slice(0, 200)}`)
    const warm = await read(8, query, false)
    assert.equal(warm.status, 200)
    assert.deepEqual(warm.body.items.map((row) => row.id), cold.body.items.map((row) => row.id))
    assert.ok(cold.physical <= CAP && warm.physical <= CAP, `${label}: cold ${cold.physical}, warm ${warm.physical}`)
    assert.ok(cold.body.items.length > 0 && !('promotion_rules' in cold.body))
    console.log(`MEASURE ${label}: cold=${cold.physical} warm=${warm.physical} rows=${cold.body.items.length} total=${cold.body.total}`)
    cases += 1
  }
  assert.equal(cacheTouches, 0, 'the image-only list never reads or writes the shared response cache')
  // Comparison only: the same browse for a full-access reader (shared-cache path, cache stubbed empty).
  const admin = await read(7, 'pageSize=100', true)
  assert.equal(admin.status, 200)
  console.log(`MEASURE baseline admin pageSize=100 browse: cold=${admin.physical}`)
  f.sql.close()
  console.log(`PASS ${cases} image-only list cases fit the free-plan ${CAP}-statement cap (cold and warm) with binding parity`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
