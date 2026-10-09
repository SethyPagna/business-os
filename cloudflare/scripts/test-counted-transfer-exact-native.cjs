const path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const req = Module.createRequire(path.join(root, 'cloudflare/package.json'))
const h = req('./scripts/test-counted-quantity-exact-native.cjs')
async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  for (const tier of ['paid', 'free']) for (const receipt of [true, false]) for (const route of ['inventory', 'branches']) {
    const f = await h.world(worker, tier, 'zero', sql => {
      h.seed(0.3, receipt)(sql)
      sql.exec("UPDATE products SET stock_quantity=0.4 WHERE id=1; INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1); INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.1)")
      if (receipt) sql.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,2,0.1)')
    })
    try {
      const tagged = process.argv.includes('--tagged')
      if (tagged) assert.equal((await h.tag(f, 0.1, receipt, 'transfer-ordinary-tag')).status, 200)
      const result = await f.call('/' + route + '/transfer', { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: tagged ? 0.3 : 0.2,
        ...(receipt ? { batchId: 1 } : {}), reason: 'Synthetic exact transfer', transfer_provenance_version: 1, client_request_id: 'fraction-transfer' })
      const after = { products: f.sql.prepare('SELECT id,stock_quantity FROM products').all(),
        branches: f.sql.prepare('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id').all(),
        receipts: f.sql.prepare('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id').all(),
        tags: f.sql.prepare('SELECT product_id,branch_id,batch_id,quantity_remaining,condition_tag FROM damaged_stock_lots ORDER BY id').all() }
      console.log('TRANSFER_OBSERVED ' + JSON.stringify({ tier, receipt, route, tagged, status: result.status, code: result.json.code, error: result.json.error, after }))
      if (!process.argv.includes('--observe')) {
        if (tagged) { assert.equal(result.status, 409, JSON.stringify(result.json)); assert.deepEqual(after.branches.map(row => row.quantity), [0.3, 0.1]); continue }
        assert.equal(result.status, 200, JSON.stringify(result.json))
        assert.deepEqual(after.branches.map(row => row.quantity), [0.1, 0.3])
        assert.equal(after.products[0].stock_quantity, 0.4)
        const members = f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all()
        for (const [direction, generation, expected] of [['undo', 0, [0.3,0.1]], ['redo', 1, [0.1,0.3]]]) {
          const replay = await f.call(`/action-history/${result.json.action_history_id}/${direction}`, { expected_generation: generation })
          assert.equal(replay.status, 200, JSON.stringify(replay.json))
          assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_stock ORDER BY product_id,branch_id').all().map(row => row.quantity), expected)
          assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 0.4)
          assert.deepEqual(f.sql.prepare('SELECT * FROM transfer_operation_members ORDER BY receipt_id,ordinal').all(), members)
          if (receipt) assert.deepEqual(f.sql.prepare('SELECT quantity FROM branch_batch_stock ORDER BY batch_id,branch_id').all().map(row => row.quantity), expected)
          else assert.equal(f.sql.prepare('SELECT SUM(quantity) q FROM branch_batch_stock').get().q, 0)
        }
        console.log('PASS exact transfer, Undo, Redo and immutable provenance ' + tier + ' ' + route + ' receipt=' + receipt)
      }
    } finally { f.sql.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
