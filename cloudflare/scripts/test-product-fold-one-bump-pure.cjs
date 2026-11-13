'use strict'
// W3 Slice A round 2 (review F3), routes/products.ts. An edit that renames a row onto an existing identity folds it into the survivor. The identity
// write commits before the fold, so a refusal or a fault after it still has to advance the products version -- but the request makes ONE bump
// call (one quota upsert on Free), after the fold and before the response, and announces only after it. Real route and migrated schema, slow
// bump stub, broadcast recorder.
// Run (from cloudflare/): node scripts/test-product-fold-one-bump-pure.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const events = []
const bumps = []
const cacheOverride = {
  cachedJsonResponse: async (_request, _ctx, _version, _ttl, producer) => producer(),
  getVersion: async () => '0',
  getVersionWithFallback: async () => 1,
  getVersionsWithFallback: async (_env, namespaces) => namespaces.map(() => '1'),
  bumpVersion: async (_env, namespace) => cacheOverride.bumpVersions(_env, [namespace]),
  bumpVersions: async (_env, list) => { events.push(`bump-start:${list.join('+')}`); bumps.push([...list]); await sleep(60); events.push(`bump-done:${list.join('+')}`) },
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
const pending = []
const send = async (method, url, body) => {
  events.length = 0; bumps.length = 0
  const response = await h.app.request(`http://local${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    { DB: h.raw }, { waitUntil: (promise) => { pending.push(promise); promise?.catch?.(() => {}) }, passThroughOnException: () => {} })
  events.push('response')
  const json = await response.json().catch(() => null)
  const trace = events.join(' > ')
  await Promise.allSettled(pending.splice(0))
  return { status: response.status, json, trace }
}
const permit = (sql) => h.raw.db.exec(`INSERT OR REPLACE INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'; ${sql}; DELETE FROM system_flags WHERE key='stock_transaction_permit'`)

;(async () => {
  permit(`INSERT INTO branches(id,name,is_default,is_active) SELECT 1,'Shop',1,1 WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=1);
    INSERT INTO products(id,name,brand,barcode,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum','Alpha','8851000000011',1,10,2,5),(2,'Serum twin','Alpha','8851000000028',1,4,2,5);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10),(2,1,4);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(10,1,'A','A','2026-09-02',1,3,1),(20,2,'B','B','2026-09-02',1,3,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,10),(20,1,4)`)
  const folded = await send('PUT', '/2', { name: 'Serum', barcode: '8851000000011' })
  console.log(folded.status, folded.trace)
  assert.equal(folded.status, 200, JSON.stringify(folded.json).slice(0, 400))
  assert.ok(folded.json.merged_into || folded.json.item, 'the edit folded into the survivor')
  assert.equal(bumps.length, 1, `ONE bump call for the whole rename-and-fold request (${folded.trace})`)
  assert.ok(bumps[0].includes('products'))
  const order = folded.trace.split(' > ')
  const done = order.findIndex((event) => event.startsWith('bump-done:'))
  assert.ok(done >= 0 && done < order.indexOf('response'), `the bump finished before the response (${folded.trace})`)
  const broadcast = order.findIndex((event) => event.startsWith('broadcast:'))
  assert.ok(broadcast < 0 || broadcast > done, `no broadcast before the bump finished (${folded.trace})`)
  console.log('PASS test-product-fold-one-bump-pure: rename-and-fold is one bump call, awaited before the response, broadcast after')
  process.exit(0)
})().catch((error) => { console.error(error); process.exit(1) })
