const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const single = require('./test-counted-sale-status-exact-native.cjs')

const quantities = f => ({ physical: f.state().physical, cache: f.state().cache,
  receipts: f.state().lots, tags: f.state().tags })
const state = f => ({ ...single.state(f), bulk: f.sql.prepare('SELECT * FROM sale_bulk_operations ORDER BY id').all(),
  members: f.sql.prepare('SELECT * FROM sale_bulk_members ORDER BY operation_id,sale_id').all(),
  snapshots: f.sql.prepare('SELECT * FROM undo_snapshots ORDER BY id').all() })
const request = (f, ids, key = 'group-cancel', target = 'cancelled') => ({ client_request_id: key,
  items: ids.map(id => f.sql.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales WHERE id=?').get(id)),
  target_status: target, ...(target === 'cancelled' ? { cancel_reason: 'mistake' } : {}) })

async function ownership(makeWorker) {
  for (const tier of ['paid', 'free']) for (const mode of ['conflict', 'race', 'null', 'retired', 'successor', 'retired-null', 'unconfirmed']) {
    const redirected = ['retired', 'successor', 'retired-null', 'unconfirmed'].includes(mode)
    const factory = () => {
      const worker = makeWorker(), fetch = worker.default.fetch
      return { ...worker, default: { ...worker.default, fetch: (req, ...args) => {
        if (redirected && mode !== 'unconfirmed') { req = new Request(req); req.headers.set('X-Branch-Redirect', '2') }
        return fetch(req, ...args)
      } } }
    }
    const { f, saleId, stock, db } = await single.scenario(factory, tier, true, true)
    try {
      await stock.executeStockTransaction(db, [{ sql: "INSERT INTO branches(id,name,is_active,role)VALUES(2,'Successor',1,'shop')" }], 'once')
      if (redirected) await stock.executeStockTransaction(db, [
        { sql: "UPDATE branches SET is_active=0,is_default=0,successor_branch_id=2 WHERE id=1" },
        { sql: 'UPDATE branches SET is_default=1 WHERE id=2' },
        { sql: 'INSERT INTO branch_stock(product_id,branch_id,quantity)VALUES(1,2,0.4)' },
        { sql: 'UPDATE branch_stock SET quantity=0 WHERE product_id=1 AND branch_id=1' },
        { sql: 'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(1,2,0.4)' },
        { sql: 'UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=1 AND branch_id=1' },
        { sql: 'UPDATE damaged_stock_lots SET branch_id=2 WHERE id=1' },
      ], 'once')
      const allocationBranch = ['conflict', 'successor'].includes(mode) ? '2' : ['null', 'retired-null'].includes(mode) ? 'NULL' : '1'
      await stock.executeStockTransaction(db, [{ sql: 'UPDATE sale_item_batch_allocations SET branch_id=' + allocationBranch }], 'once')
      let before = state(f)
      if (mode === 'race') f.beforeCommit(async () => {
        await stock.executeStockTransaction(db, [{ sql: 'UPDATE sale_item_batch_allocations SET branch_id=2' }], 'once')
        before = state(f)
      })
      const result = await f.call('/sales/bulk-status', request(f, [saleId]))
      if (['conflict', 'race', 'unconfirmed'].includes(mode)) {
        assert.equal(result.status, 409, JSON.stringify(result.json)); assert.deepEqual(state(f), before)
      } else {
        assert.equal(result.status, 200, JSON.stringify(result.json)); assert.equal(f.state().cache, 0.8)
        assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=?').get(redirected ? 2 : 1).quantity, 0.8)
        if (redirected) assert.equal(f.state().physical, 0)
        assert.deepEqual(state(f).conditions, before.conditions, 'original tagged sale source stays immutable')
        assert.equal(f.sql.prepare('SELECT branch_id FROM sale_item_batch_allocations ORDER BY id LIMIT 1').get().branch_id,
          allocationBranch === 'NULL' ? null : Number(allocationBranch), 'original allocation branch is not repointed')
        const historyId = result.json.actionHistoryId
        assert.equal((await f.call('/action-history/' + historyId + '/undo', { expected_generation: 0 })).status, 200)
        assert.equal(f.state().cache, 0.4)
        assert.equal((await f.call('/action-history/' + historyId + '/redo', { expected_generation: 1 })).status, 200)
        assert.equal(f.state().cache, 0.8)
      }
      console.log('PASS grouped original allocation ownership/confirmed successor ' + JSON.stringify({ tier, mode }))
    } finally { f.sql.close() }
  }
}

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
  if (process.argv.includes('--ownership-only')) return ownership(makeWorker)
  for (const tier of ['paid', 'free']) for (const receipt of [true, false]) for (const partial of [true, false]) {
    await positive(makeWorker, tier, receipt, partial)
  }
  await ownership(makeWorker)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { positive, state, quantities }
