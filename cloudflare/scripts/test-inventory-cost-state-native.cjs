const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
  + '\nmodule.exports={fixture,load,USER,overrides,setUser(value){currentUser=value}};', file)
const h = harness.exports
const inventory = h.load('routes/inventory.ts').default
const batches = h.load('routes/batches.ts').default
const review = h.load('lib/productCostReview.ts')
const stock = h.load('lib/stockTransaction.ts')
const cache = h.load('lib/cache.ts')
const admin = { ...h.USER, username: 'admin', role_code: 'admin', permissions: '{"all":true}' }
const reader = { ...h.USER, permissions: '{"inventory":true}' }
const events = []
const versions = []
h.overrides['../lib/cache'].bumpVersion = async (env, namespace) => { versions.push(namespace); await cache.bumpVersion(env, namespace) }
h.overrides['../durable-objects/broadcastHub'].broadcast = async (_env, namespace, payload) => { events.push({ namespace, payload }) }
const pending = []
const ctx = { waitUntil(promise) { pending.push(promise) }, passThroughOnException() {} }
const getItems = (route, body) => route.startsWith('/summary') ? body : route.startsWith('/bootstrap') ? body.products.items : body.items

async function main() {
  const f = h.fixture()
  const raw = f.raw.db
  const env = { DB: f.route, PLAN_TIER: 'paid', CACHE: { get: async () => null, delete: async () => {} } }
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  const responses = new Map()
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    async match(request) { return responses.get(request.url)?.clone() },
    async put(request, response) { responses.set(request.url, response.clone()) },
  } } })
  const call = async (app, url, method = 'GET') => {
    const response = await app.request(url, { method }, env, ctx)
    const body = await response.json()
    return { status: response.status, body }
  }
  try {
    seedStockFixture(raw, () => {
      raw.exec(`INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr)
        VALUES(11,'Cost state missing',2,NULL,NULL,0,0),(12,'Cost state zero',2,0,0,0,0),
          (13,'Cost state known',2,5,20500,5,20500),(14,'Cost state expired lot',0,2,8200,2,8200);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,1,2),(12,1,2),(13,1,2);
        INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_quantity,received_at)
        VALUES(700,14,'cost-state-old',1,2,1,'2026-01-01'),(701,14,'cost-state-new',1,8,1,'2026-02-01')`)
    })
    assert.throws(() => raw.exec('UPDATE branch_stock SET quantity=3 WHERE product_id=11'), /stock_transaction_required/)
    await stock.executeStockTransaction(f.route, review.mergeCostReviewStatements(review.mergeCostOutcome(11, { usd: null, khr: null }), admin), 'retry')
    h.setUser(admin)
    for (const route of ['/products/search?query=Cost%20state', '/bootstrap?query=Cost%20state', '/summary', '/summary?branchId=1']) {
      const result = await call(inventory, route)
      assert.equal(result.status, 200, JSON.stringify(result.body))
      const items = getItems(route, result.body)
      const missing = items.find(row => row.id === 11)
      const zero = items.find(row => row.id === 12)
      const known = items.find(row => row.id === 13)
      assert.equal(missing?.cost_needs_review, true, `${route} carries the review flag`)
      assert.equal(zero?.cost_needs_review, false, `${route} carries a boolean false control`)
      assert.equal(missing.cost_price_usd, null)
      assert.equal(zero.cost_price_usd, 0)
      assert.equal(known.cost_price_usd, 5)
      assert.equal(missing.stock_value_usd, null, `${route} cannot value unknown positive stock`)
      assert.equal(zero.stock_value_usd, 0, `${route} values genuine zero stock cost`)
      assert.ok(Array.isArray(missing.branch_stock))
      assert.equal(missing.branch_stock[0].quantity, 2)
      for (const item of items) {
        assert.equal(Object.hasOwn(item, 'cost_review_key'), false, `${route} never leaks the protected identity`)
        assert.equal(Object.hasOwn(item, 'branch_stock_json'), false)
      }
      h.setUser(reader)
      const denied = await call(inventory, route)
      assert.equal(denied.status, 200)
      for (const item of getItems(route, denied.body)) {
        for (const key of ['cost_price_usd', 'purchase_price_usd', 'stock_value_usd', 'cost_needs_review', 'cost_review_key']) {
          assert.equal(Object.hasOwn(item, key), false, `${route} redacts ${key} without cost permission`)
        }
      }
      h.setUser(admin)
    }
    const metadata = await call(inventory, '/products/search?metadataOnly=1')
    assert.equal(metadata.status, 200)
    assert.deepEqual(metadata.body.items, [])
    assert.ok(metadata.body.total > 0)
    console.log('PASS actual Inventory search/bootstrap/branch and global summary: NULL/zero/known, review boolean, private identity and cost permission')

    assert.equal(raw.prepare('SELECT cost_price_usd value FROM products WHERE id=14').get().value, 8)
    raw.exec("INSERT OR REPLACE INTO cache_versions(namespace,version) VALUES('products',1)")
    let cacheMisses = 0
    const cachedCost = async () => cache.cachedJsonResponse(new Request('https://fixture.invalid/api/products/14'), ctx,
      await cache.getVersionWithFallback(env, 'products'), 20, () => {
        cacheMisses++
        return raw.prepare('SELECT cost_price_usd value FROM products WHERE id=14').get().value
      })
    assert.equal(await cachedCost(), 8)
    await Promise.all(pending.splice(0))
    assert.equal(await cachedCost(), 8)
    assert.equal(cacheMisses, 1, 'control proves the response is warm before the mutation')
    versions.length = 0
    events.length = 0
    const deleted = await call(batches, '/701', 'DELETE')
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body))
    await Promise.all(pending.splice(0))
    assert.equal(raw.prepare('SELECT cost_price_usd value FROM products WHERE id=14').get().value, 2, 'deactivating the newest empty recorded lot changes catalog fallback')
    assert.equal(await cachedCost(), 2, 'actual namespace-versioned cache must not retain the pre-deactivation cost')
    assert.equal(cacheMisses, 2)
    assert.deepEqual(versions, ['products'], 'changed canonical cost invalidates the product cache namespace')
    assert.ok(events.some(event => event.namespace === 'products' && event.payload.id === 14), 'warm clients receive the affected product identity')
    assert.ok(events.some(event => event.namespace === 'inventory' && event.payload.batchId === 701))
    versions.length = 0
    events.length = 0
    const stockBefore = raw.prepare('SELECT * FROM branch_batch_stock WHERE batch_id=500').all()
    assert.equal((await call(batches, '/500', 'DELETE')).status, 400, 'positive-stock lot remains refused')
    assert.equal((await call(batches, '/9999', 'DELETE')).status, 404)
    await Promise.all(pending.splice(0))
    assert.deepEqual(raw.prepare('SELECT * FROM branch_batch_stock WHERE batch_id=500').all(), stockBefore)
    assert.equal(raw.prepare('SELECT is_active FROM product_batches WHERE id=500').get().is_active, 1)
    assert.deepEqual(versions, [], 'refused/missing lot does not invalidate product cache')
    assert.deepEqual(events, [])
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    console.log('PASS actual lot deactivation changes fallback cost and publishes product cache invalidation plus Inventory event')
  } finally {
    await Promise.allSettled(pending.splice(0))
    if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches)
    else delete globalThis.caches
    raw.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
