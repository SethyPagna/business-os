const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const single = require('./test-counted-sale-status-exact-native.cjs')

const quantities = f => ({ physical: f.state().physical, cache: f.state().cache,
  receipts: f.state().lots, tags: f.state().tags })
const state = f => ({ ...single.state(f), bulk: f.sql.prepare('SELECT * FROM sale_bulk_operations ORDER BY id').all(),
  members: f.sql.prepare('SELECT * FROM sale_bulk_members ORDER BY operation_id,sale_id').all(),
  snapshots: f.sql.prepare('SELECT * FROM undo_snapshots ORDER BY id').all() })

async function positive(makeWorker, tier, receipt, partial) {
  const { f, saleId } = await single.scenario(makeWorker, tier, receipt, partial)
  try {
    const initial = quantities(f)
    const row = f.sql.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales WHERE id=?').get(saleId)
    const body = { client_request_id: 'group-cancel', items: [row], target_status: 'cancelled', cancel_reason: 'mistake' }
    const result = await f.call('/sales/bulk-status', body)
    assert.equal(result.status, 200, JSON.stringify(result.json))
    assert.equal(f.state().physical, partial ? 0.8 : 1, 'group cancellation restores ordinary and tagged physical exactly once')
    assert.equal(f.state().cache, partial ? 0.8 : 1)
    assert.equal(f.state().tags[0].quantity_remaining, partial ? 0.5 : 0.6)
    if (receipt) assert.equal(f.state().lots[0].quantity, partial ? 0.8 : 1)
    const committed = state(f)
    assert.equal((await f.call('/sales/bulk-status', body)).status, 200)
    assert.deepEqual(state(f), committed, 'same operation replay writes no new business/history rows')
    const historyId = result.json.actionHistoryId
    const undone = await f.call('/action-history/' + historyId + '/undo', { expected_generation: 0 })
    assert.equal(undone.status, 200, JSON.stringify(undone.json))
    assert.deepEqual(quantities(f), initial, 'compensating undo restores exact prior quantities and identities')
    const redone = await f.call('/action-history/' + historyId + '/redo', { expected_generation: 1 })
    assert.equal(redone.status, 200, JSON.stringify(redone.json))
    assert.equal(f.state().physical, partial ? 0.8 : 1)
    assert.equal(f.state().tags[0].quantity_remaining, partial ? 0.5 : 0.6)
    console.log('PASS grouped cancel/replay/undo/redo ' + JSON.stringify({ tier, receipt, partial }))
  } finally { f.sql.close() }
}

async function main() {
  const makeWorker = await h.bundle.exports.bundleWorker()
  if (process.argv.includes('--base')) return positive(makeWorker, 'paid', true, true)
  for (const tier of ['paid', 'free']) for (const receipt of [true, false]) for (const partial of [true, false]) {
    await positive(makeWorker, tier, receipt, partial)
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { positive, state, quantities }
