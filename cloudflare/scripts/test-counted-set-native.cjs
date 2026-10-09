const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { fixture, loadStockSession } = require('./test-stock-session-atomic.cjs')

const bundleFile = path.join(__dirname, 'test-branch-transfer-request-budget-epoch-native.cjs')
const bundle = new Module(bundleFile, module)
bundle.filename = bundleFile
bundle.paths = module.paths
bundle._compile(fs.readFileSync(bundleFile, 'utf8').split('async function main(){')[0] + '\nmodule.exports={bundleWorker}', bundleFile)

async function world(makeWorker, tier, shape = 'receipt', seedExtra = () => {}) {
  const f = fixture(sql => {
    const total = shape === 'split' ? 6 : shape === 'zero' ? 0 : shape === 'reversed' ? 10 : 7
    sql.exec(`UPDATE products SET stock_quantity=${total} WHERE id=1;
      UPDATE branch_stock SET quantity=${total} WHERE product_id=1 AND branch_id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
        VALUES(1,1,'set-first','2026-09-01',2,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,${shape === 'split' ? 1 : shape === 'null' ? 5 : total});`)
    if (shape === 'split') sql.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
      VALUES(2,1,'set-second','2026-09-02',2,1);INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,5);`)
    if (shape !== 'zero') sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
      VALUES(1,1,1,${shape === 'null' ? 'NULL' : 1},${shape === 'split' ? 4 : 3},${shape === 'reversed' ? 0 : shape === 'split' ? 4 : 3},'damaged','remove',2);`)
    seedExtra(sql)
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
  const concurrentDb = loadStockSession('lib/db.ts').getDb({ DB: raw })
  const competeBeforeCommit = statements => f.beforeCommit(() => loadStockSession('lib/stockTransaction.ts').executeStockTransaction(concurrentDb, statements, 'once'))
  return { ...f, call, state, set, competeBeforeCommit }
}

async function main() {
  const makeWorker = await bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) {
    const combined = await world(makeWorker, tier, 'zero')
    try {
      assert.equal((await combined.set(7, 'split-decimal-start')).status, 200)
      for (const quantity of [0.1, 0.2]) assert.equal((await combined.call('/inventory/adjust', {
        type: 'remove', productId: 1, branchId: 1, batchId: 1, quantity, conditionTag: 'damaged', reason: 'Separate tags',
        client_request_id: 'split-decimal-tag-' + Math.round(quantity * 10),
      })).status, 200)
      const saved = await combined.set(0.3, 'split-decimal-target')
      assert.equal(saved.status, 200, 'separate decimal tags sum exactly to the entered quantity')
      assert.equal(combined.state().physical, 0.3)
      for (const operation of combined.state().operations) {
        assert.equal('counted_tags' in JSON.parse(operation.before_json), false)
        assert.equal('counted_receipts' in JSON.parse(operation.after_json), false)
      }
      assert.equal((await combined.call(`/action-history/${saved.json.action_history_id}/undo`, { expected_generation: 0 })).status, 200)
      assert.equal((await combined.call(`/action-history/${saved.json.action_history_id}/redo`, { expected_generation: 1 })).status, 200)
      const before = combined.state()
      assert.equal((await combined.set(0.299999, 'split-decimal-below')).status, 409)
      assert.deepEqual(combined.state(), before)
      assert.equal((await combined.set(1, 'split-decimal-race-start')).status, 200)
      const priorRace = combined.state()
      for (const mutation of [
        "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd) VALUES(30,1,1,1,0.1,0.1,'expired','remove',2)",
        'UPDATE damaged_stock_lots SET quantity_remaining=0.05 WHERE id=30',
        'DELETE FROM damaged_stock_lots WHERE id=30',
      ]) {
        combined.competeBeforeCommit([{ sql: mutation }])
        assert.equal((await combined.set(0.5, 'split-decimal-race-' + mutation.slice(0, 6))).status, 409)
        assert.equal(combined.state().physical, 1, 'a changed tag row set requires a fresh quantity decision')
        assert.deepEqual(combined.state().operations, priorRace.operations)
        assert.deepEqual(combined.state().movements, priorRace.movements)
      }
    } finally { combined.sql.close() }
    const nullTag = await world(makeWorker, tier, 'zero', sql => sql.exec(`
      UPDATE products SET stock_quantity=0.7 WHERE id=1;
      UPDATE branch_stock SET quantity=0.7 WHERE product_id=1 AND branch_id=1;
      UPDATE branch_batch_stock SET quantity=0.7 WHERE batch_id=1;
      INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
        VALUES(1,1,1,NULL,0.3,0.3,'damaged','remove',2);`))
    try {
      assert.equal((await nullTag.set(0.4, 'null-decimal-target')).status, 200, 'NULL reservation subtracts receipt quantity exactly')
      assert.equal(nullTag.state().physical, 0.7)
      assert.equal(nullTag.state().lots[0].quantity, 0.4)
      assert.equal(nullTag.state().tags[0].quantity_remaining, 0.3)
    } finally { nullTag.sql.close() }
    const otherLots = await world(makeWorker, tier, 'zero', sql => sql.exec(`
      UPDATE products SET stock_quantity=0.9 WHERE id=1;
      UPDATE branch_stock SET quantity=0.9 WHERE product_id=1 AND branch_id=1;
      UPDATE branch_batch_stock SET quantity=0.7 WHERE batch_id=1;
      INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,is_active)
        VALUES(2,1,'other-a','2026-09-02',2,1),(3,1,'other-b','2026-09-03',2,1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,0.1),(3,1,0.1);
      INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
        VALUES(1,1,1,NULL,0.3,0.3,'damaged','remove',2);`))
    try {
      otherLots.competeBeforeCommit([
        { sql: 'UPDATE branch_batch_stock SET quantity=0.15 WHERE batch_id=2 AND branch_id=1' },
        { sql: 'UPDATE branch_batch_stock SET quantity=0.05 WHERE batch_id=3 AND branch_id=1' },
      ])
      assert.equal((await otherLots.set(0.4, 'null-other-receipts-race')).status, 409)
      assert.deepEqual(otherLots.state().lots.map(row => row.quantity), [0.7, 0.15, 0.05])
      assert.equal(otherLots.state().physical, 1.2)
      assert.equal(otherLots.state().operations.length, 0)
    } finally { otherLots.sql.close() }
    const reassigned = await world(makeWorker, tier, 'null')
    try {
      reassigned.competeBeforeCommit([{ sql: 'UPDATE damaged_stock_lots SET batch_id=1 WHERE id=1' }])
      assert.equal((await reassigned.set(4, 'tag-receipt-reassigned')).status, 409)
      assert.equal(reassigned.state().physical, 10)
      assert.equal(reassigned.state().tags[0].batch_id, 1)
      assert.equal(reassigned.state().operations.length, 0)
    } finally { reassigned.sql.close() }
    const bounded = await world(makeWorker, tier, 'zero')
    try {
      assert.equal((await bounded.set(1, 'bounded-tag-capacity-start')).status, 200)
      bounded.competeBeforeCommit([{ sql: `WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<10001)
        INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
        SELECT n+30000,1,1,1,0.000001,0.000001,'damaged','remove',2 FROM ids` }])
      assert.equal((await bounded.set(0.9, 'bounded-tag-capacity-race')).status, 409)
      assert.equal((await bounded.set(0.9, 'bounded-tag-capacity-refresh')).status, 409, 'a truncated row set cannot authorize a write')
      assert.equal(bounded.sql.prepare('SELECT COUNT(*) AS n FROM damaged_stock_lots').get().n, 10001)
      assert.equal(bounded.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 1)
      assert.equal(bounded.sql.prepare('SELECT COUNT(*) AS n FROM stock_lot_adjustment_operations').get().n, 1)
    } finally { bounded.sql.close() }
    for (const scope of ['lot', 'branch', 'patch']) {
      const f = await world(makeWorker, tier, 'zero', sql => sql.exec(`
        INSERT INTO branches(id,name,is_active) VALUES(2,'Other branch',1);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0.2);
        UPDATE products SET stock_quantity=0.2 WHERE id=1;`))
      try {
        assert.equal((await f.set(7, 'fraction-initial-seven')).status, 200)
        assert.equal((await f.call('/inventory/adjust', { productId: 1, branchId: 1, batchId: 1, type: 'remove', quantity: 0.3,
          conditionTag: 'damaged', reason: 'Fractional tag', client_request_id: 'fraction-tag-three' })).status, 200)
        const saved = scope === 'patch'
          ? await f.call('/batches/1/branches/1', { quantity: 0.3, client_request_id: 'fraction-patch-three' }, 'PATCH')
          : await f.set(0.3, 'fraction-set-three', { setScope: scope })
        assert.equal(saved.status, 200, `${tier}/${scope}: equality with a decimal tagged subset is valid`)
        const exact = quantity => {
          const state = f.state()
          assert.equal(state.physical, quantity)
          assert.equal(state.cache, Number((quantity + 0.2).toFixed(1)), 'cache preserves the other branch exactly')
          assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity, 0.2)
          assert.equal(state.lots[0].quantity, quantity)
          assert.equal(state.tags[0].quantity_remaining, 0.3)
        }
        exact(0.3)
        const historyId = saved.json.action_history_id
        assert.ok(Number.isSafeInteger(historyId))
        assert.equal((await f.call(`/action-history/${historyId}/undo`, { expected_generation: 0 })).status, 200)
        exact(7)
        assert.equal((await f.call(`/action-history/${historyId}/redo`, { expected_generation: 1 })).status, 200)
        exact(0.3)
        assert.equal((await f.set(0.5, 'fraction-later-change')).status, 200)
        assert.equal((await f.call(`/action-history/${historyId}/undo`, { expected_generation: 2 })).status, 200)
        exact(7.2)
        assert.equal((await f.call(`/action-history/${historyId}/redo`, { expected_generation: 3 })).status, 200)
        exact(0.5)
        const before = f.state()
        assert.equal((await f.set(0.299999, 'fraction-actually-below')).status, 409)
        assert.deepEqual(f.state(), before, 'strict subset refusal must not gain a rounding tolerance')
        const invalid = await f.set(1e-25, 'fraction-unsupported-input')
        assert.equal(invalid.status, 400)
        assert.equal(invalid.json.code, 'invalid_quantity')
        assert.deepEqual(f.state(), before, 'unsupported decimal input must fail explicitly before stock or history writes')
        for (const replay of [false, true]) {
          const competingBranch = replay ? 0.6 : 0.4
          const competingCache = replay ? 1.1 : 0.9
          f.competeBeforeCommit([
            { sql: 'UPDATE branch_stock SET quantity=@quantity WHERE product_id=1 AND branch_id=2', params: { quantity: competingBranch } },
            { sql: 'UPDATE products SET stock_quantity=@quantity WHERE id=1', params: { quantity: competingCache } },
          ])
          const result = replay
            ? await f.call(`/action-history/${historyId}/undo`, { expected_generation: 4 })
            : await f.set(0.4, 'fraction-raced-other-branch')
          assert.equal(result.status, 409, 'a competing branch update cannot be overwritten in the shared cache')
          const after = f.state()
          assert.equal(after.physical, 0.5)
          assert.equal(after.cache, competingCache)
          assert.deepEqual(after.lots, before.lots)
          assert.deepEqual(after.tags, before.tags)
          assert.deepEqual(after.operations, before.operations)
          assert.deepEqual(after.movements, before.movements)
        }
      } finally { f.sql.close() }
    }
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
module.exports = { world, bundleWorker: bundle.exports.bundleWorker }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
