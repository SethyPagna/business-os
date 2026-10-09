const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const helperFile = path.join(__dirname, 'test-counted-set-native.cjs')
const helper = new Module(helperFile, module)
helper.filename = helperFile; helper.paths = module.paths
helper._compile(fs.readFileSync(helperFile, 'utf8').split('async function main() {')[0] + '\nmodule.exports={world,bundle,loadStockSession}', helperFile)
const { world, bundle, loadStockSession } = helper.exports

function tag(f, quantity, batch, key) {
  return f.call('/inventory/adjust', { type: 'remove', productId: 1, branchId: 1, ...(batch ? { batchId: 1 } : {}),
    quantity, conditionTag: 'damaged', reason: 'Exact decimal tag', client_request_id: key })
}
function clear(f, quantity, key, action = 'restore') {
  return f.call('/inventory/tagged-lots/' + action, { productId: 1, branchId: 1, quantity,
    conditionTag: 'damaged', reason: 'Exact decimal clear', client_request_id: key })
}
function seed(physical, batch) {
  return sql => sql.exec(`UPDATE products SET stock_quantity=${physical} WHERE id=1;
    UPDATE branch_stock SET quantity=${physical} WHERE product_id=1 AND branch_id=1;
    UPDATE branch_batch_stock SET quantity=${batch ? physical : 0} WHERE batch_id=1 AND branch_id=1;`)
}
function quantities(f) {
  return { physical: f.state().physical, cache: f.state().cache, tags: f.state().tags.map(row => row.quantity_remaining) }
}
async function replay(f, direction) {
  const h = f.sql.prepare("SELECT id,undo_payload,redo_payload FROM action_history WHERE entity='stock_condition' ORDER BY id DESC LIMIT 1").get()
  const pointer = JSON.parse(h[direction + '_payload'])
  return f.call(`/action-history/${h.id}/${direction}`, { expected_generation: pointer.generation })
}

async function main() {
  const makeWorker = await bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const batch of [true, false]) {
    const f = await world(makeWorker, tier, 'zero', seed(0.3, batch))
    try {
      assert.equal((await tag(f, 0.1, batch, 'quantity-first-tag')).status, 200)
      assert.equal((await tag(f, 0.2, batch, 'quantity-second-tag')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0.1, 0.2] })
      assert.equal((await tag(f, 0.01, batch, 'quantity-over-tag')).status, 409)
      assert.equal((await clear(f, 0.3, 'quantity-full-clear')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0, 0] })
      assert.equal((await replay(f, 'undo')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0.1, 0.2] })
      assert.equal((await replay(f, 'redo')).status, 200)
      assert.deepEqual(quantities(f), { physical: 0.3, cache: 0.3, tags: [0, 0] })
      console.log('PASS exact sequential tags/FIFO multi-lot clear/UndoRedo ' + tier + ' receipt=' + batch)
    } finally { f.sql.close() }

    const c = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(c, 0.3, batch, 'quantity-clear-tag')).status, 200)
      assert.equal((await clear(c, 0.1, 'quantity-clear-first')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.2] })
      assert.equal((await clear(c, 0.2, 'quantity-clear-second')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0] })
      assert.equal((await replay(c, 'undo')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.2] })
      assert.equal((await clear(c, 0.2, 'quantity-exact-dispose', 'dispose')).status, 200)
      assert.deepEqual(quantities(c), { physical: 0.8, cache: 0.8, tags: [0] })
      assert.equal((await replay(c, 'undo')).status, 200)
      assert.deepEqual(quantities(c), { physical: 1, cache: 1, tags: [0.2] })
      console.log('PASS exact partial clear/dispose/physical cache/Undo ' + tier + ' receipt=' + batch)
    } finally { c.sql.close() }
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { world, bundle, loadStockSession, tag, clear, seed, quantities, replay }
