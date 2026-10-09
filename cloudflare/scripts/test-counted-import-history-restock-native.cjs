const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function scenario(makeWorker, tier, receipt, fractional, mode = 'normal') {
  let worker
  const initial = fractional ? .1 : 1
  const quantity = fractional ? .2 : 2
  const expected = mode === 'multiple' ? .4 : fractional ? .3 : 3
  const f = await h.world(() => { worker = makeWorker(); return worker }, tier, 'zero', sql => {
    h.seed(mode === 'tagged' ? 0 : initial, receipt)(sql)
    sql.exec("UPDATE products SET name_normalized='serum' WHERE id=1; UPDATE product_batches SET lot_code='LOT-1' WHERE id=1")
    if (mode === 'tagged') sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
      VALUES(1,1,1,${receipt ? 1 : 'NULL'},.1,.1,'damaged','remove',2)`)
  })
  try {
    const jobId = `history-restock-${tier}-${receipt}-${fractional}-${mode}`
    const pending = []
    f.env.ASSETS = { list: async () => ({ objects: [], truncated: false }), delete: async () => {} }
    f.env.IMPORT_QUEUE = { send: async body => pending.push(body) }
    f.sql.prepare(`INSERT INTO import_jobs(id,type,status,phase,created_by_id,created_by_name,total_rows,materialize_done,policy_json,summary_json)
      VALUES(?,'sales','awaiting_review','awaiting_review',7,'Admin',1,1,'{}','{}')`).run(jobId)
    const data = { _rowNumber: 2, receipt_number: jobId, sale_date: '2026-10-08 12:00', branch: 'Shop',
      barcode: 'SER-1', name: 'Serum', quantity: String(quantity), returned_quantity: String(quantity),
      unit_price_usd: '2', sale_status: 'returned', ...(receipt ? { batch_label: 'LOT-1' } : {}) }
    f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)VALUES(?,0,2,?)').run(jobId, JSON.stringify(data))
    if (mode === 'multiple') {
      f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)VALUES(?,1,3,?)')
        .run(jobId, JSON.stringify({ ...data, _rowNumber: 3, quantity: '.1', returned_quantity: '.1' }))
      f.sql.prepare('UPDATE import_jobs SET total_rows=2 WHERE id=?').run(jobId)
    }
    const raw = f.env.DB
    let queries = 0
    let physicalDispatches = 0
    let injected = false
    let beforeRefusal
    const business = () => Object.fromEntries(['products', 'branch_stock', 'branch_batch_stock', 'product_batches',
      'damaged_stock_lots', 'sales', 'sale_items', 'inventory_movements', 'import_sales_commits']
      .map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const wrap = statement => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args) => wrap(target.bind(...args))
      if (['all', 'first', 'run'].includes(key)) return (...args) => { queries++; return target[key](...args) }
      return target[key]
    } })
    f.env.DB = new Proxy(raw, { get(target, key) {
      if (key === 'prepare') return sql => wrap(target.prepare(sql))
      if (key === 'batch') return statements => {
        queries += statements.length
        if (statements.some(statement => /INSERT INTO sales\s*\(/.test(statement.text))) {
          physicalDispatches++
          if (!injected && mode === 'ack') { injected = true; f.loseNextCommitAcknowledgement() }
          if (!injected && mode === 'rollback') { injected = true; f.failWhenSqlMatches(/INSERT INTO inventory_movements/) }
          if (!injected && ['actor', 'role'].includes(mode)) {
            injected = true
            beforeRefusal = business()
            if (mode === 'actor') f.sql.exec('UPDATE users SET is_active=0 WHERE id=7')
            else f.sql.exec("INSERT INTO roles(id,code,name,permissions) VALUES(900,'history-denied','Denied','{}'); UPDATE users SET role_id=900,permissions='{}' WHERE id=7")
          }
        }
        return target.batch(statements)
      }
      return target[key]
    } })
    assert.equal((await f.call('/import-jobs/' + jobId + '/approve', {})).status, 200)
    async function invoke(body) {
      queries = 0
      let acknowledged = false
      let retried = false
      await worker.default.queue({ queue: 'business-os-import', messages: [{ body, timestamp: new Date(), attempts: 1,
        ack() { acknowledged = true }, retry() { retried = true } }] }, f.env)
      console.log(JSON.stringify({ tier, receipt, fractional, mode, queries, acknowledged, retried, physicalDispatches }))
      assert.ok(queries <= (tier === 'free' ? 50 : 1000), 'full queue invocation stays within plan cap')
      if (retried && ['ack', 'rollback', 'actor', 'role'].includes(mode)) pending.push(body)
      else assert.equal(retried, false)
    }
    for (let step = 0; pending.length && step < 12; step++) await invoke(pending.shift())
    assert.equal(pending.length, 0, 'queue completed within bounded continuations')
    const job = f.sql.prepare('SELECT status,phase,last_error FROM import_jobs WHERE id=?').get(jobId)
    console.log('HISTORICAL_RESULT', JSON.stringify({ tier, receipt, fractional, job, state: f.state(),
      seals: f.sql.prepare('SELECT * FROM import_sales_commits').all() }))
    if (['actor', 'role'].includes(mode)) {
      assert.equal(injected, true)
      assert.notEqual(job.status, 'completed')
      assert.deepEqual(business(), beforeRefusal, 'revoked authority refuses every sale, seal and stock write')
      await invoke({ jobId, kind: 'apply' })
      assert.deepEqual(business(), beforeRefusal, 'redelivery does not bypass revoked authority')
      return
    }
    assert.equal(job.status, 'completed', JSON.stringify(job))
    assert.equal(f.state().physical, expected)
    assert.equal(f.state().cache, expected)
    assert.equal(f.state().lots[0].quantity, receipt ? expected : 0)
    const sales = f.sql.prepare('SELECT * FROM sales ORDER BY id').all()
    assert.equal(sales.length, 1)
    assert.equal(sales[0].stock_skipped, 1)
    const movements = f.sql.prepare("SELECT * FROM inventory_movements WHERE movement_type='return'").all()
    assert.equal(movements.length, mode === 'multiple' ? 2 : 1)
    assert.equal(movements[0].quantity, quantity)
    assert.equal(movements[0].batch_id, receipt ? 1 : null)
    const before = f.state()
    const seals = f.sql.prepare('SELECT * FROM import_sales_commits').all()
    await invoke({ jobId, kind: 'apply' })
    assert.deepEqual(f.state(), before)
    assert.deepEqual(f.sql.prepare('SELECT * FROM sales ORDER BY id').all(), sales)
    assert.deepEqual(f.sql.prepare('SELECT * FROM import_sales_commits').all(), seals)
    if (mode === 'ack') assert.equal(physicalDispatches, 1, 'lost acknowledgement never redispatches the physical batch')
    if (mode === 'tagged') {
      assert.equal(f.state().tags[0].quantity_remaining, .1)
      assert.equal((await h.clear(f, .1, jobId + '-clear')).status, 200)
      assert.equal(f.state().physical, expected, 'clearing tag preserves total physical quantity')
      assert.equal(f.state().tags[0].quantity_remaining, 0)
    }
  } finally { f.sql.close() }
}

async function main() {
  const makeWorker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) {
    for (const fractional of [false, true]) await scenario(makeWorker, tier, receipt, fractional)
    for (const mode of ['tagged', 'multiple', 'ack', 'rollback', 'actor', 'role']) await scenario(makeWorker, tier, receipt, true, mode)
  }
  console.log('counted historical import restock: PASS')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { scenario }
