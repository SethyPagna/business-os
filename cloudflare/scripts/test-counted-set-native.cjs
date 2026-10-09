const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { fixture } = require('./test-stock-session-atomic.cjs')

const bundleFile = path.join(__dirname, 'test-branch-transfer-request-budget-epoch-native.cjs')
const bundle = new Module(bundleFile, module)
bundle.filename = bundleFile
bundle.paths = module.paths
bundle._compile(fs.readFileSync(bundleFile, 'utf8').split('async function main(){')[0] + '\nmodule.exports={bundleWorker}', bundleFile)

async function world(makeWorker, tier, shape = 'receipt') {
  const f = fixture(sql => {
    const total = shape === 'split' ? 6 : shape === 'zero' ? 0 : 7
    sql.exec(`UPDATE products SET stock_quantity=${total} WHERE id=1;
      UPDATE branch_stock SET quantity=${total} WHERE product_id=1 AND branch_id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
        VALUES(1,1,'set-first','2026-09-01',2,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,${shape === 'split' ? 1 : shape === 'null' ? 5 : total});`)
    if (shape === 'split') sql.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
      VALUES(2,1,'set-second','2026-09-02',2,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,5);`)
    if (shape !== 'zero') sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
      VALUES(1,1,1,${shape === 'null' ? 'NULL' : 1},${shape === 'split' ? 4 : 3},${shape === 'split' ? 4 : 3},'damaged','remove',2);`)
  })
  const worker = makeWorker()
  f.env.PLAN_TIER = tier
  f.env.BUSINESS_OS_ADMIN_PASSWORD = 'synthetic-admin-password'
  f.env.PASSWORD_PEPPER = 'synthetic-native-pepper-at-least-32-characters'
  f.env.CACHE = { get: async () => null, put: async () => {}, delete: async () => {} }
  f.env.BROADCAST_HUB = { idFromName: x => x, get: () => ({ fetch: async () => new Response('{}') }) }
  await worker.ensureCoreDataInvariants(f.env)
  f.sql.exec(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active)
    SELECT 7,'admin','Admin','synthetic',id,'{"all":true}',1 FROM roles WHERE code='admin' LIMIT 1`)
  const token = 'counted-set-native'
  const now = Date.now()
  f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at)VALUES(7,?,?,?,?)')
    .run(createHash('sha256').update(token).digest('hex'), new Date(now - 3600000).toISOString(), new Date(now + 86400000).toISOString(), new Date(now).toISOString())
  let queries = 0
  const raw = f.env.DB
  const wrap = statement => new Proxy(statement, { get(target, key) {
    if (key === 'bind') return (...args) => wrap(target.bind(...args))
    if (['first', 'all', 'run'].includes(key)) return (...args) => { queries++; return target[key](...args) }
    return target[key]
  } })
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'prepare') return sql => wrap(target.prepare(sql))
    if (key === 'batch') return statements => { queries += statements.length; return target.batch(statements) }
    return target[key]
  } })
  async function call(url, body, method = 'POST') {
    queries = 0
    const tasks = []
    const response = await worker.default.fetch(new Request('https://admin.business.test/api' + url, {
      method, headers: { cookie: 'bos_session=' + token, 'content-type': 'application/json', origin: 'https://admin.business.test' }, body: JSON.stringify(body),
    }), f.env, { waitUntil: promise => tasks.push(Promise.resolve(promise)), passThroughOnException() {} })
    while (tasks.length) await Promise.all(tasks.splice(0))
    const json = await response.json()
    console.log(JSON.stringify({ tier, shape, url, status: response.status, queries, code: json.code }))
    assert.ok(queries <= (tier === 'free' ? 50 : 1000), 'count includes all request tails')
    return { status: response.status, json }
  }
  const state = () => ({
    physical: f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity,
    cache: f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,
    lots: f.sql.prepare('SELECT batch_id,quantity FROM branch_batch_stock ORDER BY batch_id').all(),
    tags: f.sql.prepare('SELECT id,batch_id,quantity_remaining FROM damaged_stock_lots ORDER BY id').all(),
    movements: f.sql.prepare('SELECT * FROM inventory_movements ORDER BY id').all(),
    operations: f.sql.prepare('SELECT * FROM stock_lot_adjustment_operations ORDER BY id').all(),
    history: f.sql.prepare('SELECT * FROM action_history ORDER BY id').all(),
  })
  const set = (quantity, key, extra = {}) => call('/inventory/adjust', {
    type: 'set', setScope: 'lot', productId: 1, branchId: 1, batchId: 1, quantity,
    reason: 'Physical count', client_request_id: key, ...extra,
  })
  return { ...f, call, state, set }
}

async function main() {
  const makeWorker = await bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) {
    const f = await world(makeWorker, tier)
    try {
      const before = f.state()
      assert.equal((await f.set(2, 'set-below-tagged')).status, 409)
      assert.deepEqual(f.state(), before, 'refusal must roll back stock, movements, operation and history')
      assert.equal((await f.call('/batches/1/branches/1', { quantity: 2, client_request_id: 'patch-below-tagged' }, 'PATCH')).status, 409)
      assert.deepEqual(f.state(), before, 'received-date editor shares the same guard')
      assert.equal((await f.set(10, 'set-same-total')).status, 200)
      assert.deepEqual(f.state(), before, 'no-op must preserve tags and append no stock history')
      f.failWhenSqlMatches(/UPDATE stock_lot_adjustment_operations SET history_id=/)
      assert.equal((await f.set(8, 'set-final-failure')).status, 409)
      assert.deepEqual(f.state(), before, 'late failure rolls back all stock and history')
      const saved = await f.set(8, 'set-ordinary-eight')
      assert.equal(saved.status, 200)
      assert.equal(f.state().physical, 8)
      assert.equal(f.state().tags[0].quantity_remaining, 3)
      const applied = f.state()
      assert.equal((await f.set(8, 'set-ordinary-eight')).status, 200)
      assert.deepEqual(f.state(), applied, 'request replay cannot remove a second time')
      const historyId = saved.json.action_history_id
      assert.equal((await f.call(`/action-history/${historyId}/undo`, { expected_generation: 0 })).status, 200)
      assert.equal(f.state().physical, 10)
      assert.equal((await f.call('/inventory/adjust', { productId: 1, branchId: 1, batchId: 1, type: 'remove', quantity: 6, conditionTag: 'damaged', reason: 'Tag remaining ordinary stock', client_request_id: 'set-replay-retagged' })).status, 200)
      const retagged = f.state()
      assert.equal(retagged.tags.reduce((n, row) => n + row.quantity_remaining, 0), 9)
      assert.equal((await f.call(`/action-history/${historyId}/redo`, { expected_generation: 1 })).status, 409)
      const refused = f.state()
      assert.deepEqual(refused.lots, retagged.lots)
      assert.deepEqual(refused.tags, retagged.tags)
      assert.deepEqual(refused.movements, retagged.movements)
      assert.equal(refused.physical, 10, 'redo cannot consume subsequently tagged units')
      assert.equal(refused.operations[0].generation, 1)
    } finally { f.sql.close() }
    const upward = await world(makeWorker, tier)
    try {
      const saved = await upward.set(12, 'set-upward-twelve')
      assert.equal(saved.status, 200)
      assert.equal((await upward.call('/inventory/adjust', { productId: 1, branchId: 1, batchId: 1, type: 'remove', quantity: 8, conditionTag: 'damaged', reason: 'Tag after correction', client_request_id: 'set-upward-retagged' })).status, 200)
      const before = upward.state()
      assert.equal(before.tags.reduce((n, row) => n + row.quantity_remaining, 0), 11)
      assert.equal((await upward.call(`/action-history/${saved.json.action_history_id}/undo`, { expected_generation: 0 })).status, 409)
      const after = upward.state()
      assert.equal(after.physical, 12, 'undo of an increase cannot consume newly tagged units')
      assert.deepEqual(after.tags, before.tags)
      assert.deepEqual(after.movements, before.movements)
      assert.equal(after.operations[0].generation, 0)
    } finally { upward.sql.close() }
    for (const shape of ['split', 'null', 'zero']) {
      const g = await world(makeWorker, tier, shape)
      try {
        const before = g.state()
        if (shape === 'split') {
          assert.equal((await g.set(3, 'split-lot-floor')).status, 409)
          assert.deepEqual(g.state(), before, 'branch total is sufficient but selected receipt would strand its tags')
          assert.equal((await g.set(7, 'split-branch-floor', { setScope: 'branch' })).status, 409)
          assert.deepEqual(g.state(), before)
          assert.equal((await g.set(7, 'split-other-lot', { setScope: 'branch', batchId: 2 })).status, 200)
          assert.equal(g.state().physical, 7)
          assert.equal(g.state().tags[0].quantity_remaining, 4)
          assert.deepEqual(g.state().lots.map(row => row.quantity), [5, 2])
        } else {
          assert.equal((await g.set(0, 'set-zero-control')).status, 200)
          assert.equal(g.state().physical, shape === 'zero' ? 0 : 5)
          assert.deepEqual(g.state().tags, before.tags, 'genuine NULL tag remains reserved and unaltered')
        }
      } finally { g.sql.close() }
    }
  }
  console.log('PASS counted Set receipt/branch floors, NULL/zero controls, sibling PATCH, atomic rollback and replay after retagging')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
