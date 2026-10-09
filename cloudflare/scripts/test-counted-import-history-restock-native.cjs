const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function scenario(makeWorker, tier, receipt, fractional) {
  let worker
  const initial = fractional ? .1 : 1
  const quantity = fractional ? .2 : 2
  const expected = fractional ? .3 : 3
  const f = await h.world(() => { worker = makeWorker(); return worker }, tier, 'zero', sql => {
    h.seed(initial, receipt)(sql)
    sql.exec("UPDATE products SET name_normalized='serum' WHERE id=1; UPDATE product_batches SET lot_code='LOT-1' WHERE id=1")
  })
  try {
    const jobId = `history-restock-${tier}-${receipt}-${fractional}`
    const pending = []
    f.env.ASSETS = { list: async () => ({ objects: [], truncated: false }), delete: async () => {} }
    f.env.IMPORT_QUEUE = { send: async body => pending.push(body) }
    f.sql.prepare(`INSERT INTO import_jobs(id,type,status,phase,created_by_id,created_by_name,total_rows,materialize_done,policy_json,summary_json)
      VALUES(?,'sales','awaiting_review','awaiting_review',7,'Admin',1,1,'{}','{}')`).run(jobId)
    const data = { _rowNumber: 2, receipt_number: jobId, sale_date: '2026-10-08 12:00', branch: 'Shop',
      barcode: 'SER-1', name: 'Serum', quantity: String(quantity), returned_quantity: String(quantity),
      unit_price_usd: '2', sale_status: 'returned', ...(receipt ? { batch_label: 'LOT-1' } : {}) }
    f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json)VALUES(?,0,2,?)').run(jobId, JSON.stringify(data))
    const raw = f.env.DB
    let queries = 0
    const wrap = statement => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args) => wrap(target.bind(...args))
      if (['all', 'first', 'run'].includes(key)) return (...args) => { queries++; return target[key](...args) }
      return target[key]
    } })
    f.env.DB = new Proxy(raw, { get(target, key) {
      if (key === 'prepare') return sql => wrap(target.prepare(sql))
      if (key === 'batch') return statements => { queries += statements.length; return target.batch(statements) }
      return target[key]
    } })
    assert.equal((await f.call('/import-jobs/' + jobId + '/approve', {})).status, 200)
    async function invoke(body) {
      queries = 0
      let acknowledged = false
      let retried = false
      await worker.default.queue({ queue: 'business-os-import', messages: [{ body, timestamp: new Date(), attempts: 1,
        ack() { acknowledged = true }, retry() { retried = true } }] }, f.env)
      console.log(JSON.stringify({ tier, receipt, fractional, queries, acknowledged, retried }))
      assert.ok(queries <= (tier === 'free' ? 50 : 1000), 'full queue invocation stays within plan cap')
      assert.equal(retried, false)
    }
    for (let step = 0; pending.length && step < 12; step++) await invoke(pending.shift())
    assert.equal(pending.length, 0, 'queue completed within bounded continuations')
    const job = f.sql.prepare('SELECT status,phase,last_error FROM import_jobs WHERE id=?').get(jobId)
    console.log('HISTORICAL_RESULT', JSON.stringify({ tier, receipt, fractional, job, state: f.state(),
      seals: f.sql.prepare('SELECT * FROM import_sales_commits').all() }))
    assert.equal(job.status, 'completed', JSON.stringify(job))
    assert.equal(f.state().physical, expected)
    assert.equal(f.state().cache, expected)
    assert.equal(f.state().lots[0].quantity, receipt ? expected : 0)
    const sales = f.sql.prepare('SELECT * FROM sales ORDER BY id').all()
    assert.equal(sales.length, 1)
    assert.equal(sales[0].stock_skipped, 1)
    const movements = f.sql.prepare("SELECT * FROM inventory_movements WHERE movement_type='return'").all()
    assert.equal(movements.length, 1)
    assert.equal(movements[0].quantity, quantity)
    assert.equal(movements[0].batch_id, receipt ? 1 : null)
    const before = f.state()
    const seals = f.sql.prepare('SELECT * FROM import_sales_commits').all()
    await invoke({ jobId, kind: 'apply' })
    assert.deepEqual(f.state(), before)
    assert.deepEqual(f.sql.prepare('SELECT * FROM sales ORDER BY id').all(), sales)
    assert.deepEqual(f.sql.prepare('SELECT * FROM import_sales_commits').all(), seals)
  } finally { f.sql.close() }
}

async function main() {
  const makeWorker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const receipt of [false, true]) {
    for (const fractional of [false, true]) await scenario(makeWorker, tier, receipt, fractional)
  }
  console.log('counted historical import restock: PASS')
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { scenario }
