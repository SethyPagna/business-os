const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const replay = require('./test-counted-stock-session-replay-native.cjs')

async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  const { CountedStockConflictError, isCountedStockConflict } = h.loadStockSession('lib/countedDamagedStock.ts')
  assert.equal(isCountedStockConflict(new CountedStockConflictError()), true)
  for (const tier of ['free', 'paid']) {
    const f = await h.world(worker, tier, 'zero', h.seed(.1, true))
    try {
      let guardError
      try { f.sql.prepare("SELECT json_extract('[]', '$[counted_quantity_conflict]')").get() } catch (error) { guardError = error }
      assert.ok(guardError instanceof Error)
      assert.equal(isCountedStockConflict(guardError), true, 'actual JSON guard remains a stock conflict')
      const result = await f.call('/inventory/sessions', {
        client_request_id: 'classifier-' + tier, mode: 'stock_in',
        items: [{ line_id: 'one', kind: 'receive', product_id: 1, branch_id: 1, batch_id: 1, quantity: .2, received_date: '2026-10-09', unit_cost_usd: 2 }],
      })
      assert.equal(result.status, 200, JSON.stringify(result))
      const before = f.state()
      const snapshot = f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=(SELECT snapshot_id FROM stock_session_operations)').get().payload_json
      f.sql.exec('CREATE TEMP TABLE classifier_unrelated(counted_quantity_conflict INTEGER CHECK(counted_quantity_conflict=1));CREATE TEMP TRIGGER classifier_late BEFORE UPDATE OF generation ON stock_session_operations BEGIN INSERT INTO classifier_unrelated VALUES(0);END')
      const url = '/action-history/' + result.json.actionHistoryId + '/undo'
      const body = { expected_generation: 0, require_applied: true }
      const rejected = await f.call(url, body)
      console.log('CLASSIFIER ' + JSON.stringify({ tier, status: rejected.status, code: rejected.json.code }))
      assert.equal(rejected.status, 503, 'an unrelated CHECK using the marker as a column name is not a business conflict')
      assert.equal(rejected.json.success, false)
      assert.deepEqual(f.state(), before, 'the entire failed transaction rolls back')
      assert.equal(f.sql.prepare('SELECT generation FROM stock_session_operations').get().generation, 0)
      assert.equal(f.sql.prepare('SELECT payload_json FROM undo_snapshots WHERE id=(SELECT snapshot_id FROM stock_session_operations)').get().payload_json, snapshot)
      let constraintError
      try { f.sql.exec('INSERT INTO classifier_unrelated VALUES(0)') } catch (error) { constraintError = error }
      assert.ok(constraintError instanceof Error)
      assert.equal(isCountedStockConflict(constraintError), false)
      f.sql.exec('DROP TRIGGER classifier_late')
      assert.equal((await f.call(url, body)).status, 200)
      assert.equal(f.state().physical, .1)
      const undone = f.state()
      assert.equal((await f.call(url, body)).status, 200)
      assert.deepEqual(f.state(), undone, 'retry does not duplicate compensation')
    } finally { f.sql.close() }
    await replay.exercise(worker, tier, true, .2, 'stock')
    await replay.exercise(worker, tier, true, .2, 'tagMember')
  }
  console.log('PASS shared conflict classifier: typed/SQL conflicts and unrelated CHECK rollback/retry on both plans')
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
