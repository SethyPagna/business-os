const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function prove(makeWorker, tier, shape) {
  const integer = shape === 'integer', existing = shape.startsWith('existing'), quantity = integer ? 2 : 0.2
  let worker
  const f = await h.world(() => { worker = makeWorker(); return worker }, tier, 'zero', sql => {
    h.seed(0, false)(sql)
    sql.exec("UPDATE products SET name_normalized='serum' WHERE id=1")
    if (existing) sql.exec("UPDATE product_batches SET batch_key='09102026',received_at='2026-10-09',received_quantity=0.1,supplier_name='Original Supplier' WHERE id=1")
    sql.prepare("INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,?,?,?,'damaged','remove',2)").run(existing ? 1 : null, integer ? 1 : 0.1, integer ? 1 : 0.1)
  })
  try {
    const initial = integer ? 1 : 0.1, expected = integer ? 3 : 0.3
    assert.equal(f.state().physical, initial, 'conversion counts original tag exactly once')
    const job = `exact-add-${tier}-${shape}`, pending = []
    f.env.IMPORT_QUEUE = { send: async body => pending.push({ body, attempts: 1 }) }
    f.sql.prepare("INSERT INTO import_jobs(id,type,status,phase,created_by_id,created_by_name,total_rows,materialize_done,policy_json,summary_json)VALUES(?,'stock_actions','awaiting_review','awaiting_review',7,'Admin',1,1,'{}','{}')").run(job)
    const data = { _rowNumber: 2, name: 'Serum', barcode: 'SER-1', date: '2026-10-09', action: 'add', shop: String(quantity), cost_price: '2', supplier: 'Fixture Supplier' }
    f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)VALUES(?,0,2,?)').run(job, JSON.stringify(data))
    const raw = f.env.DB
    let queries = 0, injected = false, unknownRetry = false
    const rival = {
      date: "UPDATE product_batches SET received_at='2026-10-08' WHERE id=1",
      owner: 'UPDATE product_batches SET variant_product_id=2 WHERE id=1',
      actor: 'UPDATE users SET is_active=0 WHERE id=7',
      source: "UPDATE import_job_source_rows SET data_json='{}' WHERE row_number=2",
      member: "INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)VALUES(1,1,1,0,0,'opened','remove',2)",
    }[shape]
    const wrap = stmt => new Proxy(stmt, { get(target, key) {
      if (key === 'bind') return (...args) => wrap(target.bind(...args))
      if (['all', 'first', 'run'].includes(key)) return (...args) => { queries++; return target[key](...args) }
      return target[key]
    } })
    f.env.DB = new Proxy(raw, { get(target, key) {
      if (key === 'prepare') return text => wrap(target.prepare(text))
      if (key === 'batch') return statements => {
        queries += statements.length
        if (!injected && statements.some(s => /INSERT OR IGNORE INTO import_stock_action_commits/.test(s.text))) {
          injected = true
          if (rival) f.competeBeforeCommit([{ sql: rival }])
          if (shape === 'ack') f.loseNextCommitAcknowledgement()
          if (shape === 'late') f.failWhenSqlMatches(/UPDATE import_stock_action_commits SET status/)
        }
        return target.batch(statements)
      }
      return target[key]
    } })
    assert.equal((await f.call(`/import-jobs/${job}/approve`, {})).status, 200)
    let invocations = 0
    while (pending.length && invocations++ < 12) {
      const message = pending.shift()
      queries = 0
      let ack = false, retry = false
      await worker.default.queue({ queue: 'business-os-import', messages: [{ ...message, timestamp: new Date(), ack() { ack = true }, retry() { retry = true } }] }, f.env)
      console.log(JSON.stringify({ tier, shape, invocation: invocations, queries, ack, retry }))
      assert.ok(queries <= (tier === 'free' ? 50 : 1000), 'full consumer invocation including failed tails stays within cap')
      if (retry) { unknownRetry = true; pending.push({ body: message.body, attempts: message.attempts + 1 }) }
    }
    assert.equal(pending.length, 0)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM products').get().n, 1, 'must reuse existing product')
    const commits = f.sql.prepare('SELECT * FROM import_stock_action_commits').all()
    if (rival || shape === 'late') {
      assert.equal(f.state().physical, initial)
      assert.equal(f.state().cache, initial)
      assert.equal(f.state().movements.length, 0, 'late guard/failure rolls back movement and exact physical writes')
      assert.equal(commits.length, 0, 'failed add rolls back applied journal')
      assert.equal(f.state().tags[0].quantity_remaining, initial)
      assert.equal(injected, true)
      console.log(`PASS ${tier} ${shape} rival retained/no add effects`)
      return
    }
    assert.equal(f.state().physical, expected)
    assert.equal(f.state().cache, expected)
    assert.equal(commits.length, 1)
    assert.equal(commits[0].status, 'applied')
    assert.equal(f.state().movements.length, 1)
    assert.equal(f.state().movements[0].quantity, quantity)
    assert.equal(f.state().movements[0].unit_cost_usd, 2)
    assert.equal(f.state().movements[0].total_cost_usd, integer ? 4 : 0.4)
    const movementBatch = f.state().movements[0].batch_id
    const receipt = f.sql.prepare('SELECT * FROM product_batches WHERE id=?').get(movementBatch)
    assert.equal(receipt.received_quantity, existing ? 0.3 : quantity)
    assert.equal(receipt.supplier_name, existing ? 'Original Supplier' : 'Fixture Supplier')
    assert.equal(receipt.unit_cost_usd, 2)
    assert.equal(receipt.received_at, '2026-10-09')
    assert.equal(f.state().tags[0].batch_id, existing ? 1 : null)
    if (shape === 'ack') assert.equal(unknownRetry, true, 'lost committed ACK requests redelivery before sealed recovery')
    const after = f.state()
    queries = 0
    await worker.default.queue({ queue: 'business-os-import', messages: [{ body: { jobId: job, kind: 'apply' }, timestamp: new Date(), attempts: 2, ack() {}, retry() { throw Error('committed redelivery must ack') } }] }, f.env)
    assert.ok(queries <= (tier === 'free' ? 50 : 1000))
    assert.deepEqual(f.state(), after)
    assert.deepEqual(f.sql.prepare('SELECT * FROM import_stock_action_commits').all(), commits)
    console.log(JSON.stringify({ tier, shape, redeliveryQueries: queries }))
    const clear = await f.call('/inventory/tagged-lots/restore', { productId: 1, branchId: 1, quantity: initial, conditionTag: 'damaged', reason: 'Clear original counted tag after import', client_request_id: 'post-import-clear' })
    assert.equal(clear.status, 200)
    assert.equal(f.state().physical, expected)
    assert.equal(f.state().cache, expected)
    assert.equal(f.state().tags[0].quantity_remaining, 0)
    console.log(`PASS ${tier} ${shape} exact add/cost/source/journal/tag clear/replay`)
  } finally { f.sql.close() }
}

async function main() {
  const makeWorker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const shape of ['integer', 'fractional', 'existing', 'ack', 'date', 'owner', 'actor', 'source', 'member', 'late']) await prove(makeWorker, tier, shape)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
