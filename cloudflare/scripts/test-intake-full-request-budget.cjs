const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const header = fs.readFileSync(path.join(__dirname, 'test-stock-session-route-budget-native.cjs'), 'utf8').split('const metrics=')[0]
const load = new Function('require', '__dirname', header + ';return load;')(require, __dirname)
globalThis.__WORKER_BUILD_REVISION__ = 'intake-budget-fixture'
globalThis.__WORKER_BUILT_AT__ = '2026-10-08T00:00:00Z'
let build = 0
let observed
const metrics = load('lib/requestMetrics.ts')
const originalMiddleware = metrics.requestMetricsMiddleware
metrics.requestMetricsMiddleware = async (c, next) => {
  await originalMiddleware(c, next)
  observed = c.get('requestMetrics')
}
const worker = load('index.ts').default
const core = load('lib/coreDataInvariants.ts')
const { fixture } = require('./test-stock-session-atomic.cjs')
globalThis.fetch = async () => new Response('{"ok":true,"result":{"message_id":1}}')

async function world(tier, mode, verified, options = {}) {
  const f = fixture()
  f.env.PLAN_TIER = tier
  load('lib/planTier.ts').__resetPlanTierCacheForTests()
  await core.ensureCoreDataInvariants(f.env)
  f.sql.exec(`INSERT INTO users(id,username,name,password,role_id,permissions,is_active)
    SELECT 7,'admin','Admin','fixture',id,'{"all":true}',1 FROM roles WHERE code='admin' LIMIT 1`)
  await core.ensureCoreDataInvariants(f.env)
  const lot = await load('lib/productBatches.ts').receiveBatchStock(load('lib/db.ts').getDb(f.env), {
    productId: 1, branchId: 1, quantity: 5, receivedDate: '2026-09-05', unitCostUsd: 2, supplierName: 'Fixture Supplier',
  })
  if (mode === 'zero') f.sql.exec('UPDATE branch_stock SET quantity=0; UPDATE branch_batch_stock SET quantity=0; UPDATE products SET stock_quantity=0')
  const token = 'intake-budget-cookie'
  f.sql.prepare('INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(7,?,?,?,NULL)').run(
    createHash('sha256').update(token).digest('hex'), new Date(Date.now() - 29 * 86400000).toISOString(), new Date(Date.now() + 86400000).toISOString())
  f.env.BROADCAST_HUB = { idFromName: n => n, get: () => ({ fetch: async () => new Response('{}') }) }
  f.env.CACHE = { get: async () => null, put: async () => { throw Error('KV unavailable') }, delete: async () => {} }
  f.env.TELEGRAM_BOT_TOKEN = 'local-fixture-token'
  f.env.BUSINESS_OS_ADMIN_URL = 'https://admin.budget.example'
  f.sql.prepare("INSERT INTO settings(key,value) VALUES('telegram_chat_id','123456') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  globalThis.__WORKER_BUILD_HASH__ = 'unique-intake-' + ++build
  if (verified) f.sql.prepare('INSERT INTO system_flags(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    'core_invariants_build', JSON.stringify({ status: 'verified', build: globalThis.__WORKER_BUILD_REVISION__ + ':' + globalThis.__WORKER_BUILD_HASH__, at: Date.now(), watermark: 1 }))
  let physical = 0
  let failures = new Set()
  let completionFault = options.completionFault
  const raw = f.env.DB
  const dispatch = (statements, params) => {
    physical += statements.length
    if (tier === 'free') assert.ok(physical <= 50, `conservative app cap exceeded: ${physical}`)
    for (const sql of statements) {
      if (completionFault && /UPDATE stock_mutation_receipts SET response_status/.test(sql)) throw Error('constraint failed: synthetic completion failure')
      const kind = /SELECT namespace, version FROM cache_versions/.test(sql) ? 'cache-read'
        : /INSERT INTO quota_usage/.test(sql) ? 'quota'
          : /INSERT INTO cache_versions/.test(sql) ? 'cache-write'
            : /INSERT INTO audit_log/.test(sql) ? 'audit:' + JSON.stringify(params)
              : /SELECT key, value FROM settings WHERE key IN/.test(sql) ? 'telegram'
                : /SELECT stock_quantity,/.test(sql) ? 'on-hand'
                  : /SELECT id,\s*batch_number,\s*lot_code FROM product_batches/.test(sql) ? 'post-read'
                  : /UPDATE stock_mutation_receipts SET response_status/.test(sql) ? 'completion' : null
      if (kind && options.tailRetries && !failures.has(kind)) {
        failures.add(kind)
        throw Error('D1_ERROR: network synthetic tail retry')
      }
    }
  }
  const statement = p => new Proxy(p, { get(t, key) {
    if (key === 'bind') return (...v) => statement(t.bind(...v))
    if (['all', 'run', 'first'].includes(key)) return (...v) => { dispatch([t.text], t.params); return t[key](...v) }
    return t[key]
  } })
  f.env.DB = new Proxy(raw, { get(t, key) {
    if (key === 'prepare') return sql => statement(t.prepare(sql))
    if (key === 'batch') return ss => { assert.ok(ss.every(s => s.params.length <= 100)); dispatch(ss.map(s => s.text)); return t.batch(ss) }
    return t[key]
  } })
  const body = mode === 'receive' ? { product_id: 1, branch_id: 1, quantity: 3, batch_id: lot.batchId, unit_cost_usd: 2, supplier_name: 'Fixture Supplier' }
    : { productId: 1, branchId: 1, type: 'add', quantity: mode === 'zero' ? 0 : 3, batchId: lot.batchId, reason: 'Fixture count',
      ...(mode.startsWith('correction') ? { attribution: 'correction' } : { unitCostUsd: 2, supplierName: 'Fixture Supplier' }),
      ...(mode.includes('tagged') ? { conditionTag: 'broken' } : {}),
      ...(mode === 'optional-tagged' ? { batchId: 'new', freeQuantity: 2, sellingPriceUsd: 5 } : {}) }
  body.client_request_id = `intake-budget-${build}`
  const effects = () => ({
    stock: f.sql.prepare('SELECT SUM(quantity) AS n FROM branch_stock').get().n,
    lots: f.sql.prepare('SELECT SUM(quantity) AS n FROM branch_batch_stock').get().n,
    received: f.sql.prepare('SELECT SUM(received_quantity) AS n FROM product_batches').get().n,
    movement: f.sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,
    held: f.sql.prepare('SELECT COALESCE(SUM(quantity_remaining),0) AS n FROM damaged_stock_lots').get().n,
    written: f.sql.prepare('SELECT COALESCE(SUM(written),0) AS n FROM stock_mutation_receipts').get().n,
  })
  const call = async (cold = false) => {
    if (cold) { load('lib/schemaProbe.ts').__resetSchemaProbeCacheForTests(); load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe() }
    physical = 0; failures = new Set()
    const pending = []
    const response = await worker.fetch(new Request('https://admin.budget.example' + (mode === 'receive' ? '/api/batches' : '/api/inventory/adjust'), {
      method: 'POST', headers: { cookie: 'bos_session=' + token, 'content-type': 'application/json', origin: 'https://admin.budget.example' }, body: JSON.stringify(body),
    }), f.env, { waitUntil(p) { pending.push(Promise.resolve(p)) }, passThroughOnException() {} })
    const tasks = await Promise.allSettled(pending)
    assert.equal(observed.invocation.attemptedStatements, physical, 'full physical binding attempts equal invocation admission count')
    assert.equal(tasks.filter(x => x.status === 'rejected').length, 0)
    return { status: response.status, body: await response.json(), physical, failures: [...failures], effects: effects() }
  }
  return { ...f, call, effects, restoreCompletion: () => { completionFault = false } }
}

;(async () => {
  let cases = 0
  for (const tier of ['free', 'paid']) for (const verified of [true, false]) {
    for (const mode of ['correction', 'correction-tagged', 'add', 'add-tagged', 'receive', 'optional-tagged', 'zero']) {
      const f = await world(tier, mode, verified, { tailRetries: true })
      const before = f.effects()
      const first = await f.call(true)
      if (mode === 'zero') { assert.equal(first.status, 400); assert.deepEqual(first.effects, before) }
      else {
        if (first.status === 503) {
          assert.equal(tier, 'free'); assert.equal(first.body.code, 'stock_request_query_budget_exceeded')
          assert.deepEqual(first.effects, before, 'budget refusal precedes all stock/tag/history effects')
        } else assert.equal(first.status, 200)
        const retry = await f.call()
        assert.equal(retry.status, 200, `same ID warm retry ${tier}/${verified}/${mode}`)
        const replay = await f.call()
        assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true)
        assert.deepEqual(replay.effects, retry.effects, 'successful same ID retry is never applied twice')
        console.log(JSON.stringify({ tier, verified, mode, first: first.physical, status: first.status, retry: retry.physical, retries: retry.failures }))
      }
      f.sql.close(); cases++
    }
  }
  for (const tier of ['free', 'paid']) {
    const f = await world(tier, 'add', true, { completionFault: true })
    const first = await f.call(true)
    assert.equal(first.status, 503); assert.equal(first.body.code, 'stock_request_outcome_unknown')
    assert.equal(first.effects.stock, 8); assert.equal(first.effects.written, 1)
    f.restoreCompletion()
    const replay = await f.call()
    assert.equal(replay.status, 409); assert.equal(replay.body.code, 'stock_request_partially_applied')
    assert.deepEqual(replay.effects, first.effects)
    f.sql.close(); cases++
  }
  console.log(`PASS ${cases} actual-index/auth/cold-core cases with binding parity, tail retries, stable-ID recovery and completion uncertainty`)
})().catch(error => { console.error(error); process.exitCode = 1 })
