const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')

async function exercise(makeWorker, tier, route, scenario, fragments = 1) {
  let current = makeWorker()
  const factory = () => ({ ensureCoreDataInvariants: current.ensureCoreDataInvariants, default: { fetch: (...args) => current.default.fetch(...args) } })
  const f = await h.world(factory, tier, 'zero', sql => {
    h.seed(fragments, true)(sql)
    sql.exec("INSERT INTO branches(id,name,role,is_default,is_active)VALUES(2,'Storage','warehouse',0,1);UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=1")
    for (let id = 2; id <= fragments; id++) sql.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)VALUES(${id},1,'boundary-${id}','2026-09-01',2,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity)VALUES(${id},1,1)`)
  })
  try {
    current = makeWorker()
    const raw = f.env.DB, failures = new Set()
    let attempted = 0, batches = 0, committed = false, outcomeReads = 0, settingsReads = 0
    f.sql.exec("DELETE FROM cache_versions WHERE namespace IN('products','stock')")
    const reject = (sql, params) => {
      if (!committed) return false
      if (/FROM settings/.test(sql)) settingsReads++
      if (/FROM transfer_operation_receipts/.test(sql)) {
        outcomeReads++
        if (scenario === 'unknown') return true
      }
      if (scenario !== 'tail') return false
      const kind = /SELECT namespace, version FROM cache_versions/.test(sql) ? 'versions'
        : /INSERT INTO quota_usage/.test(sql) ? 'quota'
        : /INSERT INTO cache_versions/.test(sql) ? 'handoff'
        : /FROM settings/.test(sql) ? 'settings' : null
      if (!kind) return false
      const key = kind + ':' + JSON.stringify(params)
      if (failures.has(key)) return false
      failures.add(key)
      return true
    }
    const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args) => wrap(target.bind(...args), sql)
      if (['first', 'all', 'run'].includes(key)) return (...args) => {
        attempted++
        if (reject(sql, target.params)) return Promise.reject(Error('D1_ERROR: synthetic transfer boundary network failure'))
        return target[key](...args)
      }
      return target[key]
    } })
    f.env.DB = new Proxy(raw, { get(target, key) {
      if (key === 'prepare') return sql => wrap(target.prepare(sql), sql)
      if (key === 'batch') return async statements => {
        attempted += statements.length
        if (statements.some(s => reject(s.text, s.params))) throw Error('D1_ERROR: synthetic transfer boundary network failure')
        if (statements.some(s => /UPDATE transfer_operation_receipts SET status='committed'/.test(s.text))) batches++
        try { return await target.batch(statements) } finally {
          committed = f.sql.prepare("SELECT COUNT(*) n FROM transfer_operation_receipts WHERE status='committed'").get().n > 0
        }
      }
      return target[key]
    } })
    f.env.CACHE = { get: async () => null, put: async () => { throw Error('Synthetic unavailable KV') }, delete: async () => {} }
    if (['ack', 'tail', 'unknown'].includes(scenario)) f.loseNextCommitAcknowledgement()
    const body = { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: fragments, reason: 'Transfer boundary fixture', transfer_provenance_version: 1, client_request_id: 'boundary-' + scenario, ...(route === 'bulk' ? { items: [{ productId: 1, quantity: fragments }] } : {}) }
    const url = route === 'bulk' ? '/branches/transfer-bulk' : '/' + route + '/transfer'
    const result = await f.call(url, body)
    const versions = () => f.sql.prepare("SELECT namespace,version FROM cache_versions WHERE namespace IN('stock','products') ORDER BY namespace").all()
    console.log('TRANSFER_BOUNDARY ' + JSON.stringify({ tier, route, scenario, fragments, attempted, batches, status: result.status, outcomeReads, settingsReads, failures: [...failures], versions: versions() }))
    assert.ok(attempted <= (tier === 'free' ? 50 : 1000))
    if (result.status === 409) {
      assert.equal(tier, 'free')
      assert.ok(fragments > 1, 'one ordinary received date must remain usable')
      assert.equal(result.json.code, 'transfer_query_budget_exceeded')
      assert.equal(batches, 0)
      assert.equal(f.state().physical, fragments)
      assert.equal(f.state().movements.length, 0)
      assert.equal(f.state().history.length, 0)
      return
    }
    assert.equal(result.status, scenario === 'unknown' ? 503 : 200, JSON.stringify(result.json))
    if (scenario !== 'unknown') assert.equal(result.json.replayed, ['ack', 'tail'].includes(scenario))
    assert.equal(batches, 1, 'the mutation is dispatched once even if its acknowledgement is lost')
    assert.equal(f.state().physical, 0)
    assert.equal(f.state().cache, fragments)
    f.env.DB = raw
    const stable = f.state()
    assert.equal((await f.call(url, body)).status, 200)
    assert.deepEqual(f.state(), stable, 'same-key recovery must preserve all stock and history')
    assert.deepEqual(versions().map(row => row.namespace), ['products', 'stock'], 'normal and recovered success must refresh both stock readers')
    if (scenario !== 'unknown') assert.ok(settingsReads > 0, 'normal and recovered commits reach the notification tail')
    if (scenario === 'tail') for (const kind of ['versions', 'handoff', 'settings', ...(tier === 'free' ? ['quota'] : [])]) assert.ok([...failures].some(key => key.startsWith(kind + ':')), kind)
  } finally { f.sql.close() }
}

async function main() {
  const worker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const route of ['inventory', 'branches', 'bulk']) for (const scenario of ['normal', 'ack', 'tail', 'unknown']) await exercise(worker, tier, route, scenario)
  for (const fragments of [2, 3, 4, 5, 6]) for (const route of ['inventory', 'branches', 'bulk']) for (const tier of ['free', 'paid']) await exercise(worker, tier, route, 'tail', fragments)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { exercise }
