'use strict'
// Audit G9: the undo/redo broadcast of a lot-level Set names the product (the history row's entity_id), so a client refreshes that product. Fails on the id-less broadcast.
// Run: node scripts/test-stock-lot-set-broadcast-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const sent = []
const h = createProductsRouteHarness({ overrides: { './cache': { bumpVersion: async () => {} }, '../durable-objects/broadcastHub': { broadcast: async (_env, channel, payload) => { sent.push([channel, payload]) } } } })
const { notifyStockLotSet } = h.load('lib/stockLotAdjustment.ts')
async function main() {
  await notifyStockLotSet({}, 5357)
  assert.deepEqual(sent.filter(([c]) => c === 'products' || c === 'inventory'), [['products', { action: 'update', id: 5357 }], ['inventory', { action: 'adjust', id: 5357 }]], 'both channels name the product')
  sent.length = 0
  await notifyStockLotSet({}, '5357.0') // a legacy history row stores "5357.0"
  assert.equal(sent[0][1].id, 5357, 'a legacy entity_id still resolves')
  sent.length = 0
  await notifyStockLotSet({}, null)
  assert.deepEqual(sent.map(([, p]) => 'id' in p), [false, false], 'no readable id announces the change without one')
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'actionHistory.ts'), 'utf8')
  assert.match(route, /notifyStockLotSet\(c\.env, existing\.entity_id\)/, 'undo/redo passes the history row product')
  console.log('PASS test-stock-lot-set-broadcast-native')
}
main().catch(e => { console.error(e); process.exit(1) })
