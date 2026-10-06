const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Hono } = require('hono')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const root = path.resolve(__dirname, '..')
const actor = { id: 7, username: 'stock-user', name: 'Stock User', organization_id: null, role_id: null,
  permissions: JSON.stringify({ inventory: true, products: true, product_cost_edit: true, product_cost_view: true }), is_active: 1 }
const cache = new Map()
function load(relative) {
  if (cache.has(relative)) return cache.get(relative).exports
  const file = path.join(root, 'src', relative)
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
  const module = { exports: {} }
  cache.set(relative, module)
  new Function('require', 'module', 'exports', compiled)(request => {
    if (request === '../lib/auth' || request === './auth') return { requireAuth: async (c, next) => { c.set('user', actor); await next() } }
    if (request === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
    if (request === './cache' || request === '../lib/cache') return { bumpVersion: async () => {}, getVersion: async () => 0, cacheKey: (...args) => args.join(':'), cachedJson: async (c, key, ttl, fn) => c.json(await fn()) }
    if (request === './telegram' || request === '../lib/telegram') return { sendTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
    if (request.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), request)) + '.ts')
    return require(request)
  }, module, module.exports)
  return module.exports
}
const receiving = load('lib/receivingBranch.ts')
if (process.argv.includes('--wrong-preflight')) receiving.requireReceivingBranch = async () => {}
if (process.argv.includes('--wrong-guard')) receiving.receivingBranchAssertion = () => ({ sql: 'SELECT 1', params: {} })
const { D1Compat } = load('lib/db.ts')
const lot = load('lib/stockLotAdjustment.ts')
const app = new Hono()
app.route('/api/inventory', load('routes/inventory.ts').default)
app.route('/api/batches', load('routes/batches.ts').default)
function world({ operations = true, active = true } = {}) {
  lot.resetStockLotSetSchemaProbe()
  load('lib/stockMutationReceipt.ts').resetStockMutationReceiptSchemaProbe()
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  assert.equal(raw.limits.exprDepth, 100)
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  raw.exec(`INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,${active ? 1 : 0});
    INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(1,'Serum','SER',2,0,10,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,10);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active)
      VALUES(10,1,'OLD','OLD','2026-09-02',1,3,1),(11,1,'NEW','NEW','2026-09-09',2,5,1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(10,1,3),(11,1,7);`)
  raw.exec('PRAGMA foreign_keys=ON')
  if (!operations) raw.exec('DROP TABLE stock_lot_adjustment_operations')
  const control = { before: null, failAfter: false, batches: 0, barrier: 0 }
  function prepared(sql, values = []) {
    const execute = () => {
      assert(values.length <= 100, 'D1 bind limit')
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { success: true, results: sqliteD1Call(statement, 'all', values), meta: { changes: 0 } }
      const r = sqliteD1Call(statement, 'run', values)
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
    }
    return { bind: (...bound) => prepared(sql, bound), first: async () => execute().results[0] || null, all: async () => execute(), run: async () => execute(), execute, sql }
  }
  const env = { DB: { prepare: prepared, batch: async statements => {
    control.batches++
    if (control.before) { const action = control.before; control.before = null; action(raw) }
    raw.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map(statement => statement.execute())
      if (control.failAfter) throw Error('injected deterministic failure')
      raw.exec('COMMIT')
      return results
    } catch (error) { raw.exec('ROLLBACK'); throw error }
  } } }
  return { raw, env, db: new D1Compat(env.DB), control }
}
const request = (scope = 'lot', quantity = scope === 'lot' ? 5 : 12) => ({ productId: 1, branchId: 1, batchId: 10, quantity, setScope: scope, reason: 'Physical count', conditionTag: null })
const apply = (f, body = request(), key = 'set-request-0001') => lot.applyStockLotSet(f.db, actor, key, body, async () => { f.control.barrier++ })
const snapshot = f => JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','inventory_movements','stock_lot_adjustment_operations','action_history','audit_logs','damaged_stock_lots']
  .filter(table => f.raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
  .map(table => [table, f.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const quantities = f => [f.raw.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=10').get().quantity,
  f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity,
  f.raw.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity]
async function http(f, route, scope = 'lot') {
  const pending = []
  const response = await app.request(route === 'adjust' ? '/api/inventory/adjust' : '/api/batches/10/branches/1', {
    method: route === 'adjust' ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...request(scope), type: 'set', client_request_id: 'http-set-00001' }),
  }, f.env, { waitUntil: p => pending.push(p) })
  await Promise.all(pending)
  return { status: response.status, body: await response.json() }
}
const failures = []
async function check(name, action) {
  try { await action(); console.log('PASS ' + name) } catch (error) { failures.push(name); console.error('FAIL ' + name, error) }
}
// CUTOVER-LR (owner ruling 6 Oct 2026): a Set addressed to a disabled branch never writes into it. Here the only
// branch is disabled and no active branch could take the change, so every direction refuses
// branch_retired_no_successor before the receipt barrier; with an active successor the Set asks for the confirmed
// branch and lands there (scripts/test-cutover-lr-adjust-pure.cjs, test-cutover-lr-batches-pure.cjs).
async function main() {
  for (const scope of ['lot','branch']) {
    await check(`inactive positive ${scope} refuses before receipt barrier or batch`, async () => {
      const f = world({ active: false }), before = snapshot(f)
      const result = await apply(f, request(scope))
      assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.code, 'branch_retired_no_successor')
      assert.equal(f.control.barrier, 0); assert.equal(f.control.batches, 0); assert.equal(snapshot(f), before)
    })
    await check(`active positive ${scope} commits exact quantities and metadata`, async () => {
      const f = world(), original = f.raw.prepare('SELECT received_at,unit_cost_usd FROM product_batches WHERE id=10').get()
      const result = await apply(f, request(scope))
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.deepEqual(quantities(f), [5,12,12])
      assert.deepEqual(f.raw.prepare('SELECT received_at,unit_cost_usd FROM product_batches WHERE id=10').get(), original)
      assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM action_history').get().n, 1)
    })
    await check(`retirement race ${scope} rolls back every business row`, async () => {
      const f = world(), before = snapshot(f)
      f.control.before = raw => raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
      const result = await apply(f, request(scope))
      assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.code, 'receiving_branch_inactive')
      assert.equal(f.control.barrier, 1); assert.equal(snapshot(f), before)
      assert.equal(f.raw.prepare('SELECT is_active FROM branches WHERE id=1').get().is_active, 0)
    })
    await check(`inactive ${scope} equal/decrease is refused too and writes nothing`, async () => {
      for (const delta of [0,-1]) {
        const f = world({ active: false }), before = snapshot(f)
        const result = await apply(f, request(scope, (scope === 'lot' ? 3 : 10) + delta))
        assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.code, 'branch_retired_no_successor')
        assert.deepEqual(quantities(f), [3,10,10]); assert.equal(snapshot(f), before); assert.equal(f.control.barrier, 0)
      }
    })
  }
  await check('exact successful operation replay precedes inactivity; changed intent conflicts', async () => {
    const f = world(), body = request(), first = await apply(f, body)
    assert.equal(first.status, 200)
    f.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before = snapshot(f), barriers = f.control.barrier
    const replay = await apply(f, body)
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(replay.body.operation_id, first.body.operation_id)
    const changed = await apply(f, request('lot',6))
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'idempotency_conflict')
    assert.equal(snapshot(f), before); assert.equal(f.control.barrier, barriers)
  })
  // CUTOVER-LR: an Undo cannot carry a confirmed redirect, so the inverse of a Set at a branch that has since been
  // disabled is refused with the cutover's coded closure instead of writing stock back into that branch.
  await check('historical inverse at a since-disabled branch is closed (undo_closed_branch_retired) and writes nothing', async () => {
    const f = world(), result = await apply(f, request('lot',1))
    assert.equal(result.status, 200)
    f.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const id = result.body.action_history_id
    const payload = () => JSON.parse(f.raw.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(id).undo_payload)
    const before = snapshot(f)
    await assert.rejects(lot.replayStockLotSet(f.env, actor, 'undo', id, 0, payload()),
      (error) => error.statusCode === 409 && error.code === 'undo_closed_branch_retired')
    assert.deepEqual(quantities(f), [1,8,8]); assert.equal(snapshot(f), before)
    f.raw.exec('UPDATE branches SET is_active=1 WHERE id=1')
    await lot.replayStockLotSet(f.env, actor, 'undo', id, 0, payload())
    assert.deepEqual(quantities(f), [3,10,10], 'while the branch is active the exact inverse still applies')
    await lot.replayStockLotSet(f.env, actor, 'redo', id, 1, payload())
    assert.deepEqual(quantities(f), [1,8,8])
  })
  await check('state CAS and maintenance race remain atomic', async () => {
    for (const maintenance of [false,true]) {
      const f = world(); let before
      f.control.before = raw => {
        raw.exec(maintenance ? `INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')` : 'UPDATE branch_stock SET quantity=11 WHERE product_id=1')
        before = snapshot(f)
      }
      const result = await apply(f)
      assert.equal(result.status, maintenance ? 503 : 409); assert.equal(snapshot(f), before)
    }
  })
  await check('positive receiving guard also covers missing operation schema', async () => {
    for (const active of [false,true]) {
      const f = world({ operations: false, active })
      const result = await apply(f)
      assert.equal(result.status, active ? 200 : 409)
      assert.deepEqual(quantities(f), active ? [5,12,12] : [3,10,10])
    }
  })
  await check('public inventory scopes and batch PATCH refuse inactive positive stock', async () => {
    for (const [route,scope] of [['adjust','lot'],['adjust','branch'],['batch','lot']]) {
      const f = world({ active: false }), before = snapshot(f)
      const result = await http(f,route,scope)
      assert.equal(result.status,409,JSON.stringify(result.body)); assert.equal(result.body.code,'branch_retired_no_successor')
      assert.equal(snapshot(f),before)
    }
  })
  await check('public original receipt replay after retirement never moves stock twice', async () => {
    for (const route of ['adjust','batch']) {
      const f = world(), first = await http(f,route)
      assert.equal(first.status,200,JSON.stringify(first.body))
      f.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
      const before = snapshot(f), replay = await http(f,route)
      assert.equal(replay.status,200,JSON.stringify(replay.body)); assert.equal(replay.body.replayed,true)
      assert.equal(snapshot(f),before)
    }
  })
  if (failures.length) { console.error(`${failures.length} failed: ${failures.join('; ')}`); process.exitCode = 1 }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
