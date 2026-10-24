// 6.0.970: /products/filters, /batches/tracked-product-ids and /possible-duplicates are cached on the
// versions of what they read. Runs the REAL routes over the migrated schema with a version-keyed fake cache and
// counts D1 statements: a repeat at the same versions reads nothing, a write that bumps a version recomputes,
// dismissing a duplicate cluster bumps the version, and the key separates different queries.
//
// Run: node scripts/test-catalog-read-version-cache-pure.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const versions = {}
const store = new Map()
const bump = async (_env, ns) => { versions[ns] = (versions[ns] || 0) + 1 }
const cacheOverride = {
  cachedJsonResponse: async (request, _ctx, version, _ttl, producer) => {
    const key = `${request.url}#${version}`
    if (store.has(key)) return JSON.parse(store.get(key))
    const value = await producer()
    store.set(key, JSON.stringify(value))
    return value
  },
  getVersion: async () => '0',
  getVersionWithFallback: async (_env, ns) => String(versions[ns] || 0),
  bumpVersion: bump,
  bumpVersions: async (env, list) => { for (const ns of list) await bump(env, ns) },
}
const h = createProductsRouteHarness({ overrides: { '../lib/cache': cacheOverride } })
const batches = h.load('routes/batches.ts').default
const ctx = { waitUntil: (p) => { p?.catch?.(() => {}) }, passThroughOnException: () => {} }
let statements = 0
const originalPrepare = h.db.prepare
h.db.prepare = (sql) => { statements += 1; return originalPrepare(sql) }
const get = async (pathname, app = h.app) => {
  const before = statements
  const res = await app.request(`http://local${pathname}`, { method: 'GET' }, { DB: h.raw }, ctx)
  return { status: res.status, json: await res.json().catch(() => null), reads: statements - before }
}
const addProduct = (id, brand, barcode) => h.raw.db.exec(`INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch';
  INSERT INTO products(id,name,brand,barcode,is_active,stock_quantity) VALUES(${id},'Item ${id}','${brand}','${barcode}',1,1);
  DELETE FROM system_flags WHERE key='stock_transaction_permit';`)

;(async () => {
  addProduct(1, 'Alpha', '8851000000011')
  addProduct(2, 'Beta', '8851000000028')

  const first = await get('/filters')
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.deepEqual(first.json.brands, ['Alpha', 'Beta'])
  assert.ok(first.reads > 0)
  const again = await get('/filters')
  assert.equal(again.reads, 0, 'same versions: /filters reads nothing from D1')
  assert.deepEqual(again.json, first.json)
  const other = await get('/filters?branchId=1')
  assert.ok(other.reads > 0, 'a different query is a different cache entry')

  addProduct(3, 'Gamma', '8851000000035')
  await bump(null, 'products')
  const changed = await get('/filters')
  assert.deepEqual(changed.json.brands, ['Alpha', 'Beta', 'Gamma'], 'a products bump makes the new brand visible')
  for (const ns of ['stock', 'settings', 'promotions']) {
    await get('/filters'); await bump(null, ns)
    assert.ok((await get('/filters')).reads > 0, `a ${ns} bump recomputes /filters`)
  }

  const dup = await get('/possible-duplicates')
  assert.equal(dup.status, 200, JSON.stringify(dup.json))
  assert.equal((await get('/possible-duplicates')).reads, 0, 'possible-duplicates repeat reads nothing')
  const productsBefore = versions.products || 0
  h.setActionTier(() => 'full')
  const dismissed = await h.request('POST', '/possible-duplicates/dismiss', { type: 'barcode', value: '8851000000011' })
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.json))
  assert.ok((versions.products || 0) > productsBefore, 'dismissing a cluster bumps the products version')
  assert.ok((await get('/possible-duplicates')).reads > 0, 'after a dismissal the list is recomputed')

  const tracked = await get('/tracked-product-ids?branchId=1', batches)
  assert.equal(tracked.status, 200, JSON.stringify(tracked.json))
  assert.ok(Array.isArray(tracked.json.productIds) && tracked.reads > 0)
  assert.equal((await get('/tracked-product-ids?branchId=1', batches)).reads, 0, 'tracked ids repeat reads nothing')
  assert.ok((await get('/tracked-product-ids?branchId=2', batches)).reads > 0, 'a different branch is a different entry')
  for (const ns of ['products', 'stock', 'inventory']) {
    await bump(null, ns)
    assert.ok((await get('/tracked-product-ids?branchId=1', batches)).reads > 0, `a ${ns} bump recomputes tracked ids`)
  }
  console.log('PASS catalog read caches: hit at same versions, recompute on bump, dismissal invalidates')
})().catch((error) => { console.error(error); process.exitCode = 1 })
