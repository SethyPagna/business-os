const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { Hono } = require('hono')
const { fixture, user } = require('./test-stock-session-atomic.cjs')

const sourceRoot = process.env.INTAKE_SOURCE_ROOT || path.join(__dirname, '..')
function modules(actor = user, realEffects = false) {
  const cache = new Map()
  const load = file => {
    file = path.posix.normalize(file)
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const source = fs.readFileSync(path.join(sourceRoot, 'src', file), 'utf8')
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
    const req = name => {
      if (name === '../lib/auth' || name === './auth') return { requireAuth: async (c, next) => { c.set('user', actor); await next() } }
      if (!realEffects && (name.endsWith('/cache') || name === './cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {} }
      if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
      if (name.endsWith('/telegram') || name === './telegram') return { sendTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
      if (!realEffects && name === '../lib/audit') return { audit: async () => {}, changedFields: () => [] }
      if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), `${name}.ts`))
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load
}

async function setup(mode, actor = user, realEffects = false) {
  const f = fixture()
  const load = modules(actor, realEffects)
  const db = load('lib/db.ts').getDb(f.env)
  const lot = await load('lib/productBatches.ts').receiveBatchStock(db, { productId: 1, branchId: 1, quantity: 5, receivedDate: '2026-09-05', unitCostUsd: 2, supplierName: 'Fixture Supplier' })
  const app = new Hono()
  app.route('/api/inventory', load('routes/inventory.ts').default)
  app.route('/api/batches', load('routes/batches.ts').default)
  const body = mode.startsWith('receive')
    ? { product_id: 1, branch_id: 1, quantity: 3, batch_id: lot.batchId, unit_cost_usd: 2, supplier_name: 'Fixture Supplier' }
    : { productId: 1, branchId: 1, type: 'add', quantity: 3, batchId: lot.batchId, reason: 'Counted fixture',
        ...(mode.startsWith('correction') ? { attribution: 'correction' } : { unitCostUsd: 2, supplierName: 'Fixture Supplier' }),
        ...(mode.endsWith('tagged') ? { conditionTag: 'broken' } : {}) }
  body.client_request_id = `intake-${mode}-request-0001`
  const url = mode.startsWith('receive') ? '/api/batches' : '/api/inventory/adjust'
  const send = async (request = body) => {
    const pending = []
    const res = await app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, f.env, { waitUntil(p) { pending.push(Promise.resolve(p)) } })
    await Promise.allSettled(pending)
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
  const state = () => JSON.stringify(['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'damaged_stock_lots', 'inventory_movements', 'action_history']
    .map(table => f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
  return { ...f, load, send, state, body, lot }
}

let failures = 0
let passed = 0
const budgets = []
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`) }
}

async function main() {
  if (process.env.INTAKE_NEGATIVE_CONTROL) {
    for (const mode of ['correction-tagged', 'add', 'receive']) await check(`${mode} discriminates legacy split or fail-open`, async () => {
      const f = await setup(mode)
      const before = f.state()
      if (mode === 'correction-tagged') f.failWhenSqlMatches(/INSERT INTO damaged_stock_lots/)
      if (mode === 'add') {
        f.failWhenSqlMatches(/INSERT INTO inventory_movements/)
        const prepare = f.env.DB.prepare
        f.env.DB.prepare = text => {
          const statement = prepare(text)
          if (!/INSERT INTO inventory_movements/.test(text)) return statement
          const bind = statement.bind
          statement.bind = (...args) => {
            const bound = bind(...args)
            bound.run = async () => { throw new Error('injected standalone movement fault') }
            return bound
          }
          return statement
        }
      }
      if (mode === 'receive') f.sql.exec('DROP TABLE stock_mutation_receipts')
      const refusal = await f.send()
      assert.notEqual(refusal.status, 200)
      assert.equal(f.state(), before)
    })
    console.log(JSON.stringify({ passed, failures, negativeControl: true }))
    if (failures) process.exitCode = 1
    return
  }
  for (const mode of process.env.INTAKE_CONTROLS_ONLY ? [] : ['correction', 'correction-tagged', 'add', 'add-tagged', 'receive']) {
    const probe = await setup(mode)
    let attempts = 0
    globalThis[Symbol.for('business-os.request-metrics.v1')] = { d1Start(n) { attempts += n }, d1Call() {} }
    let result
    try { result = await probe.send() } finally { delete globalThis[Symbol.for('business-os.request-metrics.v1')] }
    await check(`${mode} actual route success and receipt replay`, async () => {
      assert.equal(result.status, 200, JSON.stringify(result))
      const branch = probe.sql.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').get().q
      assert.equal(branch, mode.endsWith('tagged') ? 5 : 8)
      const held = probe.sql.prepare('SELECT COALESCE(SUM(quantity_remaining),0) q FROM damaged_stock_lots').get().q
      assert.equal(held, mode.endsWith('tagged') ? 3 : 0)
      assert.equal(probe.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE movement_type=?").get(mode.startsWith('correction') ? 'adjustment' : 'add').n, 1)
      assert.equal(probe.sql.prepare('SELECT received_quantity q FROM product_batches WHERE id=?').get(probe.lot.batchId).q, mode.startsWith('correction') ? 5 : 8)
      assert.ok(attempts <= 50, `actual attempted statements ${attempts}`)
      budgets.push({ mode, attempts, batch: probe.lastBatchLength() })
      const before = probe.state()
      const replay = await probe.send()
      assert.equal(replay.status, 200)
      assert.equal(replay.body.replayed, true)
      assert.equal(probe.state(), before)
    })
    const length = probe.lastBatchLength()
    for (let index = 0; index <= length; index++) await check(`${mode} rollback before statement ${index} of ${length}`, async () => {
      const f = await setup(mode)
      const before = f.state()
      if (index === length) {
        const batch = f.env.DB.batch
        f.env.DB.batch = statements => batch([...statements, { text: 'SELECT 1', params: [] }])
      }
      f.failBatchStatement(index)
      const refused = await f.send()
      assert.notEqual(refused.status, 200, JSON.stringify(refused))
      assert.equal(f.state(), before)
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts').get().n, 0)
      assert.equal((await f.send()).status, 200, 'same request is retryable after rollback')
    })
    await check(`${mode} durable lost acknowledgement never repeats stock`, async () => {
      const f = await setup(mode)
      f.loseNextCommitAcknowledgement()
      const refused = await f.send()
      assert.notEqual(refused.status, 200)
      const after = f.state()
      const receipt = f.sql.prepare('SELECT written FROM stock_mutation_receipts').get()
      assert.equal(receipt.written, 1)
      const retry = await f.send()
      assert.equal(retry.status, 409)
      assert.equal(retry.body.code, 'stock_request_partially_applied')
      assert.equal(f.state(), after)
    })
    await check(`${mode} missing receipt table refuses before writes`, async () => {
      const f = await setup(mode)
      f.sql.exec('DROP TABLE stock_mutation_receipts')
      const before = f.state()
      const result = await f.send()
      assert.equal(result.status, 503)
      assert.equal(result.body.code, 'stock_receipt_unavailable')
      assert.equal(f.state(), before)
    })
  }
  await check('receive without stable ID refuses before writes', async () => {
    const f = await setup('receive')
    const before = f.state()
    const { client_request_id, ...body } = f.body
    assert.equal((await f.send(body)).body.code, 'client_request_id_required')
    assert.equal(f.state(), before)
  })
  await check('transient required receipt claim failure is retryable and never invokes stock writer', async () => {
    const f = await setup('correction-tagged')
    const original = f.env.DB.prepare
    let failing = true
    let injected = 0
    f.env.DB.prepare = text => {
      if (failing && /INSERT INTO stock_mutation_receipts/.test(text)) {
        injected++
        throw new Error('D1_ERROR: network transient receipt claim')
      }
      return original(text)
    }
    const before = f.state()
    assert.equal((await f.send()).body.code, 'stock_receipt_unavailable')
    assert.equal(injected, 1)
    assert.equal(f.state(), before)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM stock_mutation_receipts').get().n, 0)
    failing = false
    assert.equal((await f.send()).status, 200)
  })
  for (const mode of ['correction-tagged', 'add-tagged', 'receive']) await check(`${mode} cold Free with actual audit/cache effects stays within 50 attempted statements`, async () => {
    const f = await setup(mode, user, true)
    f.env.PLAN_TIER = 'free'
    let attempts = 0
    globalThis[Symbol.for('business-os.request-metrics.v1')] = { d1Start(n) { attempts += n }, d1Call() {} }
    let result
    try { result = await f.send() } finally { delete globalThis[Symbol.for('business-os.request-metrics.v1')] }
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.ok(attempts <= 50, `actual attempted statements with tails ${attempts}`)
    budgets.push({ mode, tier: 'free', actualEffects: true, attempts })
  })
  for (const variant of ['new-free-price', 'unlock-match', 'unlock-sibling']) await check(`cold Free tagged intake ${variant} keeps optional paths within 50 attempts`, async () => {
    const f = await setup('add-tagged', user, true)
    f.env.PLAN_TIER = 'free'
    const request = { ...f.body, batchId: 'new', freeQuantity: 2,
      ...(variant === 'new-free-price' ? { sellingPriceUsd: 5 } : {
        unlockPricing: true, pricing: { cost_usd: 2, selling_price_usd: 5, barcode: variant === 'unlock-match' ? 'SER-1' : 'DIFFERENT-1' },
      }) }
    let attempts = 0
    globalThis[Symbol.for('business-os.request-metrics.v1')] = { d1Start(n) { attempts += n }, d1Call() {} }
    let result
    try { result = await f.send(request) } finally { delete globalThis[Symbol.for('business-os.request-metrics.v1')] }
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.ok(attempts <= 50, `actual attempted statements with optional fields ${attempts}`)
    budgets.push({ variant, tier: 'free', actualEffects: true, attempts })
  })
  await check('zero quantity and scoped Set stale quantities retain their guards', async () => {
    const f = await setup('correction')
    const before = f.state()
    const zero = await f.send({ ...f.body, quantity: 0 })
    assert.equal(zero.status, 400, JSON.stringify(zero))
    assert.equal(f.state(), before)
    const unchanged = await f.send({ productId: 1, branchId: 1, batchId: f.lot.batchId, type: 'set', setScope: 'lot', quantity: 5,
      client_request_id: 'scoped-set-zero-0001', reason: 'Unchanged count' })
    assert.equal(unchanged.status, 200, JSON.stringify(unchanged))
    assert.equal(f.state(), before)
    const stale = { productId: 1, branchId: 1, batchId: f.lot.batchId, type: 'set', setScope: 'lot', quantity: 8, expectedLotQuantity: 4,
      client_request_id: 'scoped-set-stale-0001', reason: 'Count fixture' }
    assert.equal((await f.send(stale)).status, 409)
    assert.equal(f.state(), before)
    const current = { ...stale, expectedLotQuantity: 5 }
    f.failWhenSqlMatches(/DO UPDATE SET written=excluded.written/)
    assert.notEqual((await f.send(current)).status, 200)
    assert.equal(f.state(), before)
    assert.equal((await f.send(current)).status, 200)
  })
  await check('removed product and wrong selected lot refuse all intake effects', async () => {
    const f = await setup('correction-tagged')
    const before = f.state()
    assert.equal((await f.send({ ...f.body, batchId: 9999 })).status, 409)
    assert.equal(f.state(), before)
    f.sql.exec('INSERT INTO products(id,name,is_active,stock_quantity) VALUES(2,\'Removed fixture\',0,0)')
    const removed = f.state()
    assert.equal((await f.send({ ...f.body, productId: 2, batchId: 'new', attribution: undefined, unitCostUsd: 2, supplierName: 'Fixture Supplier' })).status, 409)
    assert.equal(f.state(), removed)
  })
  console.log(JSON.stringify({ passed, failures, budgets }))
  if (failures) process.exitCode = 1
}
module.exports = { setup }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
