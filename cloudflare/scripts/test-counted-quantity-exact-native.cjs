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

    for (const mutation of ['cache', 'receipt', 'metadata', 'tag-insert', 'tag-delete', 'tag-identity', 'clear-rival']) {
      for (const action of ['tag', 'clear']) {
        const r = await world(makeWorker, tier, 'zero', seed(0.3, batch))
        try {
          assert.equal((await tag(r, 0.1, batch, 'quantity-race-seed')).status, 200)
          const before = r.state()
          let rival
          if (mutation === 'cache') rival = [{ sql: 'UPDATE products SET stock_quantity=0.4 WHERE id=1' }]
          if (mutation === 'receipt') rival = [{ sql: 'UPDATE branch_batch_stock SET quantity=@quantity WHERE batch_id=1 AND branch_id=1', params: { quantity: batch ? 0.2 : 0.1 } }]
          if (mutation === 'metadata') rival = [{ sql: 'UPDATE product_batches SET unit_cost_usd=3 WHERE id=1' }]
          if (mutation === 'tag-insert') rival = [{ sql: "INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,@batch,0.05,0.05,'damaged','remove')", params: { batch: batch ? 1 : null } }]
          if (mutation === 'tag-delete') rival = [{ sql: 'DELETE FROM damaged_stock_lots WHERE id=1' }]
          if (mutation === 'tag-identity') rival = [{ sql: "UPDATE damaged_stock_lots SET condition_tag='opened' WHERE id=1" }]
          if (mutation === 'clear-rival') rival = [{ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=0.05 WHERE id=1' }]
          r.competeBeforeCommit(rival)
          const result = action === 'tag' ? await tag(r, 0.1, batch, 'quantity-race-request') : await clear(r, 0.1, 'quantity-race-request')
          assert.equal(result.status, 409, mutation + '/' + action)
          assert.ok(['counted_quantity_conflict', 'tagged_lot_conflict'].includes(result.json.code))
          assert.doesNotMatch(JSON.stringify(result.json), /json_extract|bad JSON path|SQLITE/)
          assert.deepEqual(r.state().history, before.history)
          assert.deepEqual(r.state().movements, before.movements)
          assert.equal(r.sql.prepare('SELECT COUNT(*) n FROM stock_session_guards').get().n, 0)
          console.log('PASS actual rival transaction refused ' + tier + ' receipt=' + batch + ' ' + mutation + '/' + action)
        } finally { r.sql.close() }
      }
    }

    const failure = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(failure, 0.3, batch, 'quantity-failure-seed')).status, 200)
      const before = failure.state()
      const rawDb = failure.env.DB
      let failFacts = true
      failure.env.DB = new Proxy(rawDb, { get(target, key) {
        if (key === 'prepare') return sql => {
          if (failFacts && sql.includes("'product',json_array")) { failFacts = false; throw new Error('injected unknown facts driver') }
          return target.prepare(sql)
        }
        return target[key]
      } })
      assert.equal((await clear(failure, 0.1, 'quantity-unknown-facts')).status, 500)
      assert.deepEqual(failure.state(), before, 'unknown read error cannot become a stock conflict')
      failure.failWhenSqlMatches(/UPDATE damaged_stock_lots SET quantity_remaining=/)
      const unknown = await clear(failure, 0.1, 'quantity-unknown-driver')
      assert.equal(unknown.status, 503)
      assert.equal(unknown.json.code, 'stock_request_outcome_unknown', 'the existing receipt contract handles unknown dispatched failures')
      assert.deepEqual(failure.state(), before, 'unexpected driver exception rolls back the whole clear/history batch')
      assert.equal((await clear(failure, 0.1, 'quantity-unknown-driver')).status, 200)
      failure.loseNextCommitAcknowledgement()
      assert.equal((await clear(failure, 0.2, 'quantity-lost-ack')).status, 503)
      const committed = failure.state()
      const unresolved = await clear(failure, 0.2, 'quantity-lost-ack')
      assert.equal(unresolved.status, 409)
      assert.equal(unresolved.json.code, 'stock_request_partially_applied')
      assert.deepEqual(failure.state(), committed, 'the original unknown-outcome receipt never applies a second time')
      assert.deepEqual(quantities(failure), { physical: 1, cache: 1, tags: [0] })
      console.log('PASS unknown read500/dispatched503 atomic rollback/retry and exact lost-ACK replay ' + tier + ' receipt=' + batch)
    } finally { failure.sql.close() }

    const ordered = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(ordered, 0.3, batch, 'quantity-ordered-seed')).status, 200)
      const counted = loadStockSession('lib/countedDamagedStock.ts')
      const stock = loadStockSession('lib/stockTransaction.ts')
      const db = loadStockSession('lib/db.ts').getDb(ordered.env)
      const observed = await db.prepare(`SELECT ${counted.countedStockFactsSql('@product', '@branch')} facts`).get({ product: 1, branch: 1 })
      const exact = new counted.CountedStockPlan(observed.facts, 1)
      const identity = { lotId: 1, productId: 1, branchId: 1, batchId: batch ? 1 : null }
      await stock.executeStockTransaction(db, [
        ...counted.planExactCountedTaggedChange(exact, identity, 0.1, 'clear'),
        ...counted.planExactCountedTaggedChange(exact, identity, 0.1, 'consume'),
        ...counted.planExactCountedTaggedChange(exact, identity, 0.1, 'restore'),
      ], 'once')
      assert.deepEqual(quantities(ordered), { physical: 1, cache: 1, tags: [0.2] })
      console.log('PASS projected clear/consume/restore in ONE real atomic batch ' + tier + ' receipt=' + batch)
    } finally { ordered.sql.close() }

    for (const direction of ['undo', 'redo']) {
      const h = await world(makeWorker, tier, 'zero', seed(1, batch))
      try {
        assert.equal((await tag(h, 0.3, batch, 'quantity-history-seed')).status, 200)
        assert.equal((await clear(h, 0.1, 'quantity-history-clear')).status, 200)
        if (direction === 'redo') assert.equal((await replay(h, 'undo')).status, 200)
        const before = h.state()
        h.competeBeforeCommit([{ sql: "INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(1,1,@batch,0.05,0.05,'opened','remove')", params: { batch: batch ? 1 : null } }])
        assert.equal((await replay(h, direction)).status, 409)
        assert.deepEqual(h.state().movements, before.movements)
        assert.deepEqual(h.state().history, before.history)
        assert.equal(h.state().tags.length, 2, 'rival row remains, replay membership guard refuses')
        console.log('PASS whole membership rival UndoRedo refusal ' + tier + ' receipt=' + batch + ' ' + direction)
      } finally { h.sql.close() }
    }

    const authority = await world(makeWorker, tier, 'zero', seed(1, batch))
    try {
      assert.equal((await tag(authority, 0.3, batch, 'quantity-authority-seed')).status, 200)
      const before = authority.state()
      authority.sql.exec("INSERT INTO roles(id,code,name,permissions)VALUES(900,'quantity-denied','Denied','{}');UPDATE users SET role_id=900,permissions='{}' WHERE id=7")
      assert.equal((await clear(authority, 0.1, 'quantity-authority-clear')).status, 403)
      assert.equal((await tag(authority, 0.1, batch, 'quantity-authority-tag')).status, 403)
      assert.deepEqual(authority.state(), before)
      console.log('PASS same-session live authority revocation refuses tag/clear ' + tier + ' receipt=' + batch)
    } finally { authority.sql.close() }
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { world, bundle, loadStockSession, tag, clear, seed, quantities, replay }
