'use strict'
// INV S6, replan note 9: a scoped Set bumps the `stock` cache version instead of `products` behind the read switch `stock_bump_narrow` (default OFF). A cache keyed only on `products` that
// reads stock would go stale, so this proves, with the switch OFF and ON, that after every kind of Set EVERY cached GET shape answers exactly what a fresh compute answers:
//   - a Set that changes quantities only (the same effect as a sale) bumps `stock` alone with the switch ON, and `products` with it OFF (byte-identical to before);
//   - a Set that is more than a quantity change (a received date that had no row at the branch, a retired date put back in use) bumps `products` with the switch ON too.
// Real routes (POST /api/inventory/adjust, PATCH /api/batches/:id/branches/:branchId, GET /api/products and its siblings), the real stock writer, a version-keyed fake cache, every migration.
// Run: node scripts/test-stock-bump-narrow-native.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const versions = {}
const bumps = []
const store = new Map()
const bump = async (_env, namespace) => { bumps.push(namespace); versions[namespace] = (versions[namespace] || 0) + 1 }
const cacheOverride = {
  // Cached the way the Worker caches it: one entry per request URL and per version key.
  cachedJsonResponse: async (request, _ctx, version, _ttl, producer) => {
    const key = `${request.url}#${version}`
    if (store.has(key)) return JSON.parse(store.get(key))
    const value = await producer()
    store.set(key, JSON.stringify(value))
    return value
  },
  getVersion: async () => '0',
  getVersionWithFallback: async (_env, namespace) => String(versions[namespace] || 0),
  getVersionsWithFallback: async (_env, namespaces) => namespaces.map((namespace) => String(versions[namespace] || 0)),
  bumpVersion: bump,
  bumpVersions: async (env, list) => { for (const namespace of list) await bump(env, namespace) },
  cacheIdentity: () => undefined,
  isUnsafeVersion: () => false,
  deploymentId: () => 'dev',
}
const h = createProductsRouteHarness({ overrides: { '../lib/cache': cacheOverride } })
h.setUser({ id: 1, username: 'tester', name: 'Test User', role_code: 'admin', role_id: 1, permissions: '{}', organization_id: null, is_active: 1 })
const inventory = h.load('routes/inventory.ts').default
const batches = h.load('routes/batches.ts').default
const sales = h.load('routes/sales.ts').default
const { resetReadSwitchMemo } = h.load('lib/readSwitches.ts')
const ctx = { waitUntil: promise => { promise?.catch?.(() => {}) }, passThroughOnException: () => {} }
const send = async (app, method, url, body) => {
  const pending = []
  const response = await app.request(`http://local${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, { DB: h.raw }, { ...ctx, waitUntil: promise => pending.push(promise) })
  await Promise.allSettled(pending)
  return { status: response.status, json: await response.json().catch(() => null) }
}
const permit = sql => h.raw.db.exec(`INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'; ${sql}; DELETE FROM system_flags WHERE key='stock_transaction_permit';`)
const setSwitch = state => {
  h.raw.db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  if (state) h.raw.db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-09T00:00:00.000Z', set_by: 1, switches: { stock_bump_narrow: state } }))
  resetReadSwitchMemo()
}
// Every cached GET shape that can read what a Set changes: the product list and search (membership cached, rows refreshed), a membership that depends on stock, the filter vocabulary, the duplicate
// and data-gap lists, the search index, and the tracked-product ids. Each is answered from its cache entry, then from nothing at all.
const SHAPES = [
  [h.app, '/'], [h.app, '/search?page=1&pageSize=20'], [h.app, '/search?page=1&pageSize=20&branchId=1'], [h.app, '/search?page=1&pageSize=20&stockState=out'],
  [h.app, '/search?page=1&pageSize=20&stockState=low'], [h.app, '/search?page=1&pageSize=20&include=lots&branchId=1'], [h.app, '/filters'], [h.app, '/possible-duplicates'],
  [h.app, '/search-index'], [batches, '/tracked-product-ids?branchId=1'],
  // The Sales page's stats strip and stats carry the stock removal loss, read from the movements a Set writes: keyed on the sales, returns, customers, products AND stock versions.
  [sales, '/stats-strip?startDate=2020-01-01&endDate=2099-12-31'], [sales, '/stats?startDate=2020-01-01&endDate=2099-12-31'],
]
const answers = async () => { const out = []; for (const [app, url] of SHAPES) { const got = await send(app, 'GET', url); out.push([url, got.status, got.json]) } return out }
async function equalsFresh(label) {
  const cached = await answers() // served from the cache wherever its versions still match
  const hits = store.size
  store.clear()
  const fresh = await answers() // computed from the database
  assert.ok(hits > 0, `${label}: the shapes were cached`)
  for (let index = 0; index < SHAPES.length; index++) {
    assert.equal(cached[index][1], 200, `${label}: ${cached[index][0]} answers`)
    assert.deepEqual(cached[index][2], fresh[index][2], `${label}: ${cached[index][0]} equals a fresh compute`)
  }
}

async function main() {
  permit(`INSERT INTO branches(id,name,is_default,is_active) SELECT 1,'Shop',1,1 WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=1);
    INSERT OR IGNORE INTO branches(id,name,is_default,is_active) VALUES(2,'Store',0,1);
    INSERT INTO products(id,name,brand,barcode,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum','Alpha','8851000000011',1,10,2,5),(2,'Toner','Beta','8851000000028',1,4,2,5),(3,'Cream','Alpha','8851000000035',1,0,2,5);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10),(2,1,4);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(10,1,'OLD','OLD','2026-09-02',1,3,1),(11,1,'NEW','NEW','2026-09-09',2,5,1),(20,2,'T','T','2026-09-02',1,3,1),(30,3,'C','C','2026-09-02',1,3,0);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,3),(11,1,7),(20,1,4)`)

  // [name, request, the namespaces a Set of that kind bumps with the switch ON]
  const sets = [
    ['quantity only (the effect of a sale): a lowering Set of a date that holds stock', () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 11, quantity: 5, expectedLotQuantity: 7, reason: 'Physical count', client_request_id: 'narrow-lower-0001' }), ['stock']],
    ['quantity only, from Products > Manage received dates (PATCH)', () => send(batches, 'PATCH', '/10/branches/1', { quantity: 2, expectedLotQuantity: 3, reason: 'Physical count', client_request_id: 'narrow-patch-0001' }), ['stock']],
    ['quantity only: a raise of a date that already has its row', () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 2, branchId: 1, batchId: 20, quantity: 6, expectedLotQuantity: 4, reason: 'Physical count', client_request_id: 'narrow-raise-0001' }), ['stock']],
    ['more than a quantity: a date that had no row at the branch gets one', () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 1, branchId: 2, batchId: 11, quantity: 3, expectedLotQuantity: 0, reason: 'Physical count', client_request_id: 'narrow-row-00001' }), ['products']],
    ['more than a quantity: a retired received date put back in use', () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 3, branchId: 1, batchId: 30, quantity: 2, expectedLotQuantity: 0, reason: 'Physical count', client_request_id: 'narrow-active-001' }), ['products']],
  ]
  let n = 0
  for (const state of [undefined, 'off', 'on']) {
    for (const [name, run, narrow] of sets) {
      // each (switch, Set) pair starts from the same stock
      const tag = `${state ?? 'unset'} / ${name}`
      setSwitch(state)
      permit(`UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=10 AND branch_id=1; UPDATE branch_batch_stock SET quantity=7 WHERE batch_id=11 AND branch_id=1; UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=20 AND branch_id=1;
        DELETE FROM branch_batch_stock WHERE batch_id IN (11,30) AND branch_id=2; DELETE FROM branch_batch_stock WHERE batch_id=30 AND branch_id=1; UPDATE product_batches SET is_active=0 WHERE id=30;
        UPDATE branch_stock SET quantity=10 WHERE product_id=1 AND branch_id=1; UPDATE branch_stock SET quantity=4 WHERE product_id=2 AND branch_id=1; DELETE FROM branch_stock WHERE product_id IN (1,3) AND branch_id=2; DELETE FROM branch_stock WHERE product_id=3;
        UPDATE products SET stock_quantity=10 WHERE id=1; UPDATE products SET stock_quantity=4 WHERE id=2; UPDATE products SET stock_quantity=0 WHERE id=3;
        DELETE FROM stock_lot_adjustment_operations; DELETE FROM stock_mutation_receipts`)
      // The reset above is a write the app did not make: forget every cached entry, as a restore or an import does.
      store.clear() // no version is bumped here: a reader keyed on neither version must be caught by the Set under test, not rescued by this reset
      await equalsFresh(`${tag}: before the Set`) // warm every shape at the current versions
      bumps.length = 0
      const done = await run()
      assert.equal(done.status, 200, `${tag}: the Set is applied: ${JSON.stringify(done.json)}`)
      assert.deepEqual(bumps.filter(namespace => namespace === 'products' || namespace === 'stock'), state === 'on' ? narrow : ['products'],
        `${tag}: bumps ${state === 'on' ? 'only what the change needs' : 'products, exactly as before the switch existed'}`)
      await equalsFresh(`${tag}: after the Set`)
      n++
    }
  }
  console.log(`PASS test-stock-bump-narrow-native: ${n} (switch, Set) pairs, ${SHAPES.length} cached GET shapes each, cached equals fresh`)
}
main().catch(error => { console.error(error); process.exit(1) })
