'use strict'
// W3 Slice A (bump-before-response), behaviour. A write route must advance the cache versions BEFORE it answers, so the very next read by the
// same actor (the bell's version-gated fresh read, a stock-filtered product list, the duplicate list) keys on the new version and shows the new
// state. The version-keyed fake cache below makes every bump SLOW (BUMP_MS): a bump left in waitUntil finishes after the response, and the
// next GET, issued the instant the response resolves, is served the old body from the cache. The old routes fail both checks:
//   1. ORDER   -- the bump completed before the response resolved, and no broadcast was issued before the bump completed (peers refetch on it);
//   2. STATE   -- the cached GET shapes answer exactly what a fresh compute answers, with NO waiting on background work in between.
// Real routes (POST /api/inventory/adjust, PATCH /api/batches/:id/branches/:branchId, POST /api/products, the stock-in line edit), the real stock
// writer, every migration. The waitUntil promises are collected and only awaited at the very end, as the Worker's own request does not wait for them.
// Also: on Free a write costs ONE quota_usage upsert however many namespaces it bumps (TEST_PLAN_TIER=free), checked on the real cache.ts.
// Run: node scripts/test-bump-before-response-native.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const BUMP_MS = 120
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const versions = {}
const store = new Map()
const events = []
const advance = async (namespaces) => {
  await sleep(BUMP_MS)
  for (const namespace of namespaces) versions[namespace] = (versions[namespace] || 0) + 1
  events.push(`bump-done:${namespaces.join('+')}`)
}
const cacheOverride = {
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
  bumpVersion: async (_env, namespace) => { events.push(`bump-start:${namespace}`); await advance([namespace]) },
  bumpVersions: async (_env, list) => { events.push(`bump-start:${list.join('+')}`); await advance([...new Set(list)]) },
  cacheIdentity: () => undefined,
  isUnsafeVersion: () => false,
  deploymentId: () => 'dev',
}
const h = createProductsRouteHarness({
  overrides: {
    '../lib/cache': cacheOverride,
    '../durable-objects/broadcastHub': { broadcast: async (_env, channel) => { events.push(`broadcast:${channel}`) } },
  },
})
h.setUser({ id: 1, username: 'tester', name: 'Test User', role_code: 'admin', role_id: 1, permissions: '{}', organization_id: null, is_active: 1 })
const inventory = h.load('routes/inventory.ts').default
const batches = h.load('routes/batches.ts').default
const pending = []
const send = async (app, method, url, body) => {
  const response = await app.request(`http://local${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    { DB: h.raw }, { waitUntil: (promise) => { pending.push(promise); promise?.catch?.(() => {}) }, passThroughOnException: () => {} })
  events.push('response')
  return { status: response.status, json: await response.json().catch(() => null) }
}
const permit = (sql) => h.raw.db.exec(`INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'; ${sql}; DELETE FROM system_flags WHERE key='stock_transaction_permit'`)

// Every cached GET shape a write below can change: list membership, stock-dependent membership, the vocabulary, the duplicate list.
const SHAPES = [
  [h.app, '/'], [h.app, '/search?page=1&pageSize=20'], [h.app, '/search?page=1&pageSize=20&stockState=out'], [h.app, '/search?page=1&pageSize=20&stockState=low'],
  [h.app, '/filters'], [h.app, '/filters?stockState=low'], [h.app, '/possible-duplicates'], [h.app, '/search-index'],
]
const answers = async () => { const out = []; for (const [app, url] of SHAPES) { const got = await send(app, 'GET', url); out.push([url, got.status, got.json]) } return out }
events.length = 0

async function scenario(label, run, namespaces) {
  store.clear()
  await answers() // warm every shape at the current versions
  assert.ok(store.size > 0, `${label}: the shapes were cached`)
  events.length = 0
  const done = await run()
  assert.equal(done.status, 200, `${label}: the write is applied: ${JSON.stringify(done.json)}`)
  const responseAt = events.indexOf('response')
  const bumpDoneAt = events.findIndex((event) => event.startsWith('bump-done:') && namespaces.some((namespace) => event.split(':')[1].split('+').includes(namespace)))
  assert.ok(bumpDoneAt >= 0, `${label}: bumped ${namespaces.join('/')} (${events.join(' > ')})`)
  assert.ok(bumpDoneAt < responseAt, `${label}: the bump finished before the response resolved (${events.join(' > ')})`)
  const broadcastAt = events.findIndex((event) => event.startsWith('broadcast:'))
  assert.ok(broadcastAt < 0 || broadcastAt > bumpDoneAt, `${label}: no broadcast is issued before the bump (${events.join(' > ')})`)
  const next = await answers() // the actor's very next reads, nothing awaited in between
  const cached = next.map((entry) => JSON.stringify(entry))
  store.clear()
  const fresh = (await answers()).map((entry) => JSON.stringify(entry))
  for (let index = 0; index < SHAPES.length; index++) assert.equal(cached[index], fresh[index], `${label}: ${SHAPES[index][1]} right after the response equals a fresh compute`)
  console.log(`PASS ${label}`)
}

async function main() {
  permit(`INSERT INTO branches(id,name,is_default,is_active) SELECT 1,'Shop',1,1 WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=1);
    INSERT INTO products(id,name,brand,barcode,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum','Alpha','8851000000011',1,10,2,5),(2,'Toner','Beta','8851000000028',1,4,2,5),(3,'Cream','Alpha','8851000000035',1,6,2,5);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10),(2,1,4),(3,1,6);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(10,1,'OLD','OLD','2026-09-02',1,3,1),(20,2,'T','T','2026-09-02',1,3,1),(30,3,'C','C','2026-09-02',1,3,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,10),(20,1,4),(30,1,6)`)

  await scenario('POST /api/inventory/adjust (remove the last units)', () => send(inventory, 'POST', '/adjust', { type: 'remove', productId: 2, branchId: 1, quantity: 4, reason: 'Damaged', client_request_id: 'bump-order-remove-1' }), ['products'])
  await scenario('POST /api/inventory/adjust (a scoped Set)', () => send(inventory, 'POST', '/adjust', { type: 'set', setScope: 'lot', productId: 3, branchId: 1, batchId: 30, quantity: 1, expectedLotQuantity: 6, reason: 'Physical count', client_request_id: 'bump-order-set-0001' }), ['products', 'stock'])
  await scenario('PATCH /api/batches/:id/branches/:branchId (set one lot)', () => send(batches, 'PATCH', '/10/branches/1', { quantity: 2, expectedLotQuantity: 10, reason: 'Physical count', client_request_id: 'bump-order-patch-1' }), ['products', 'stock'])
  await scenario('POST /api/products (create)', () => send(h.app, 'POST', '/', { name: 'Mask', brand: 'Gamma', barcode: '8851000000042', selling_price_usd: 7, cost_price_usd: 3 }), ['products'])

  // Every bump of a request is ONE call into the cache module (on Free that is one quota upsert, not one per namespace).
  events.length = 0
  const added = await send(inventory, 'POST', '/adjust', { type: 'remove', productId: 1, branchId: 1, quantity: 1, reason: 'Damaged', client_request_id: 'bump-order-rem-002' })
  assert.equal(added.status, 200, JSON.stringify(added.json))
  assert.equal(events.filter((event) => event.startsWith('bump-start:')).length, 1, `one bump call per write (${events.join(' > ')})`)
  await Promise.allSettled(pending)
  console.log('PASS test-bump-before-response-native: 4 routes, ordering and next-read state, one bump call per write')
}
main().catch((error) => { console.error(error); process.exit(1) })
