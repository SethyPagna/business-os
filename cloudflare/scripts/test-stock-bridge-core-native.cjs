const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Hono } = require('hono')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')

const actor = { id: 7, username: 'admin', name: 'Fixture', role: 'admin', is_system: 1, permissions: JSON.stringify({ inventory: true, products: true, product_cost_edit: true, product_cost_view: true }) }
const cache = new Map()
function load(file, sourceOverride) {
  file = path.posix.normalize(file)
  if (!sourceOverride && cache.has(file)) return cache.get(file).exports
  const m = { exports: {} }; if (!sourceOverride) cache.set(file, m)
  const source = sourceOverride || fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
  const req = name => {
    if (name === '../lib/auth' || name === './auth') return { requireAuth: async (c, next) => { c.set('user', actor); await next() } }
    if (name === '../lib/cache' || name === './cache') return { bumpVersion: async () => {}, bumpVersions: async () => {} }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.endsWith('/telegram') || name === './telegram') return { sendTelegramEvent: async () => {}, sendReturnTelegramEvent: async () => {}, formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [] }
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), `${name}.ts`))
    return require(name)
  }
  new Function('require', 'module', 'exports', code)(req, m, m.exports)
  return m.exports
}

const sql = new DatabaseSync(':memory:')
const migrationDirectory = path.join(__dirname, '../migrations')
const admissionMigrations = ['0243_stock_schema_epoch.sql', '0258_catalog_cost_admission.sql']
for (const file of fs.readdirSync(migrationDirectory).filter(file => file.endsWith('.sql') && !admissionMigrations.includes(file)).sort()) {
  sql.exec(fs.readFileSync(path.join(migrationDirectory, file), 'utf8'))
}
sql.exec(`INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1);
  INSERT INTO products(id,name,stock_quantity,cost_price_usd,is_active) VALUES(1001,'Stock',7,2,1),(1002,'Empty',0,2,1);
  INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1001,1,7),(1002,1,0);
  INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,received_quantity,unit_cost_usd,received_cost_usd,is_active)
    VALUES(1001,1001,'fixture','fixture','2026-10-08',7,2,14,1);
  INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1001,1,7);`)
sql.exec('BEGIN IMMEDIATE')
try { for (const file of admissionMigrations) sql.exec(fs.readFileSync(path.join(migrationDirectory, file), 'utf8')); sql.exec('COMMIT') }
catch (e) { sql.exec('ROLLBACK'); throw e }
sql.limits.exprDepth = 100

let failSql, loseAck = false, calls = 0, attempts = 0
function result(text, params) {
  if (failSql?.test(text)) { failSql = null; throw Error('fixture transaction failure') }
  const stmt = sql.prepare(text)
  const before = sql.prepare('SELECT total_changes() n').get().n
  const rows = stmt.columns().length ? sqliteD1Call(stmt, 'all', params) : (sqliteD1Call(stmt, 'run', params), [])
  const meta = sql.prepare('SELECT total_changes()-? changes,last_insert_rowid() last_row_id').get(before)
  return { success: true, results: rows, meta }
}
const raw = {
  prepare(text) {
    const wrap = params => ({ text, params, bind: (...p) => wrap(p),
      async first(column) { const row = sqliteD1Call(sql.prepare(text), 'get', params); return column ? row?.[column] ?? null : row ?? null },
      async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
      async run() { return result(text, params) } })
    return wrap([])
  },
  async batch(statements) {
    calls++; attempts += statements.length
    sql.exec('BEGIN IMMEDIATE')
    let results
    try { results = statements.map(s => result(s.text, s.params)); sql.exec('COMMIT') }
    catch (e) { sql.exec('ROLLBACK'); throw e }
    if (loseAck) { loseAck = false; throw Error('D1_ERROR: network lost acknowledgement') }
    return results
  },
}
const db = new (load('lib/db.ts').D1Compat)(raw)
const batches = load('lib/productBatches.ts')
const receipts = load('lib/stockMutationReceipt.ts')
const executor = load('lib/stockTransaction.ts')
const set = load('lib/stockLotAdjustment.ts')
const state = () => JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','inventory_movements','action_history','stock_mutation_receipts'].map(table => sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
const permits = () => Number(sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n)
const totals = () => [sql.prepare('SELECT stock_quantity q FROM products WHERE id=1001').get().q, sql.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1001 AND branch_id=1').get().q, sql.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=1001 AND branch_id=1').get().q]
let checks = 0
async function check(name, fn) { await fn(); assert.equal(permits(), 0); checks++; console.log(`PASS ${name}`) }

async function main() {
  await check('actual old unpermitted writer refuses', async () => {
    const before = state()
    await assert.rejects(db.batch([{ sql: 'UPDATE products SET stock_quantity=99 WHERE id=1001' }]), /stock_transaction_required/)
    assert.equal(state(), before)
  })
  await check('receive and remove keep all ledgers under installed guard', async () => {
    const received = await batches.receiveBatchStock(db, { productId: 1001, branchId: 1, batchId: 1001, quantity: 3, historicalReceiptReplay: true })
    assert.equal(received.batchId, 1001); assert.deepEqual(totals(), [10,10,10])
    await batches.removeStockFromBatch(db, { productId: 1001, branchId: 1, batchId: 1001, quantity: 2 })
    assert.deepEqual(totals(), [8,8,8])
  })
  await check('identity creation preserves result index with and without caller guard', async () => {
    const source = { lot_code: 'destination-a', expiry_date: null, received_at: '2026-10-08', notes: null }
    const first = await batches.resolveDestinationBatch(db, source, 1002)
    const second = await batches.resolveDestinationBatch(db, { ...source, lot_code: 'destination-b' }, 1002, { writeGuard: { sql: 'SELECT 1' } })
    assert.ok(first > 1001 && second > first)
    assert.equal(sql.prepare('SELECT variant_product_id p FROM product_batches WHERE id=?').get(first).p, 1002)
  })
  await check('later failure rolls back all physical ledgers', async () => {
    const before = state(); failSql = /UPDATE products SET stock_quantity/
    await assert.rejects(batches.removeStockFromBatch(db, { productId: 1001, branchId: 1, batchId: 1001, quantity: 1 }), /fixture transaction failure/)
    assert.equal(state(), before)
  })
  await check('missing and future epoch refuse before effects', async () => {
    for (const value of [null, 'counted-tag-v2']) {
      if (value === null) sql.exec("DELETE FROM system_flags WHERE key='stock_schema_epoch'")
      else sql.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").run(value)
      const before = state()
      await assert.rejects(batches.removeStockFromBatch(db, { productId: 1001, branchId: 1, batchId: 1001, quantity: 1 }), e => e.code === 'stock_schema_unavailable')
      assert.equal(state(), before)
    }
    sql.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(executor.STOCK_SCHEMA_EPOCH)
  })
  await check('receipt admission charges both permit statements and preserves lost-ACK once', async () => {
    sql.exec("INSERT INTO stock_mutation_receipts(actor_id,request_id,kind,request_json) VALUES(7,'bridge-native-receipt','adjust','[]')")
    let admitted = 0, committed = false
    const mark = { statement: () => ({ sql: "UPDATE stock_mutation_receipts SET written=1 WHERE request_id='bridge-native-receipt'" }), admit: n => { admitted = n }, committed: () => { committed = true } }
    const statement = { sql: 'UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=1002' }
    const beforeCalls = calls, beforeAttempts = attempts
    loseAck = true
    await assert.rejects(receipts.executeStockMutationBatch(db, [statement], mark), /lost acknowledgement/)
    assert.equal(admitted, 4); assert.equal(attempts-beforeAttempts, 4); assert.equal(calls-beforeCalls, 1); assert.equal(committed, false)
    assert.equal(sql.prepare('SELECT stock_quantity q FROM products WHERE id=1002').get().q, 1)
    assert.equal(sql.prepare("SELECT written FROM stock_mutation_receipts WHERE request_id='bridge-native-receipt'").get().written, 1)
  })
  await check('budget refusal remains before permit and receipt writes', async () => {
    const before = state(), beforeCalls = calls
    const mark = { statement: () => ({ sql: 'SELECT 1' }), admit: n => { assert.equal(n,4); throw new receipts.StockMutationBudgetError() }, committed: () => assert.fail('must not commit') }
    await assert.rejects(receipts.executeStockMutationBatch(db, [{ sql: 'UPDATE products SET stock_quantity=9 WHERE id=1002' }], mark), receipts.StockMutationBudgetError)
    assert.equal(calls,beforeCalls); assert.equal(state(), before)
  })
  await check('actual lot SET and replay keep guarded history with physical effects', async () => {
    const input = { productId: 1001, branchId: 1, batchId: 1001, setScope: 'lot', quantity: 6, reason: 'Fixture count' }
    const response = await set.applyStockLotSet(db, actor, 'bridge-native-set-01', input)
    assert.equal(response.status, 200, JSON.stringify(response)); assert.deepEqual(totals(), [6,6,6])
    const before = state(); const replay = await set.applyStockLotSet(db, actor, 'bridge-native-set-01', input)
    assert.equal(replay.body.replayed, true); assert.equal(state(), before)
  })
  await check('lot SET undo and redo compensate under epoch and retain history', async () => {
    const history = () => sql.prepare("SELECT * FROM action_history WHERE entity='stock_quantity_set' ORDER BY id DESC LIMIT 1").get()
    const row = history(), before = state()
    sql.prepare("UPDATE system_flags SET value='counted-tag-v2' WHERE key='stock_schema_epoch'").run()
    await assert.rejects(set.replayStockLotSet({ DB: raw }, actor, 'undo', row.id, 0, JSON.parse(row.undo_payload)), e => e.code === 'stock_schema_unavailable')
    assert.equal(state(), before)
    sql.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(executor.STOCK_SCHEMA_EPOCH)
    await set.replayStockLotSet({ DB: raw }, actor, 'undo', row.id, 0, JSON.parse(row.undo_payload))
    assert.deepEqual(totals(), [8,8,8]); assert.equal(history().id, row.id)
    await set.replayStockLotSet({ DB: raw }, actor, 'redo', row.id, 1, JSON.parse(history().redo_payload))
    assert.deepEqual(totals(), [6,6,6]); assert.equal(history().id, row.id)
  })
  await check('metadata edit stays available; lot deactivation uses guarded transaction', async () => {
    const app = new Hono(); app.route('/api/batches', load('routes/batches.ts').default)
    const pending = []; const ctx = { waitUntil(p) { pending.push(Promise.resolve(p)) } }
    const emptyId = sql.prepare("SELECT id FROM product_batches WHERE variant_product_id=1002 AND batch_key='destination-a'").get().id
    const metadata = await app.request(`/api/batches/${emptyId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'metadata' }) }, { DB: raw }, ctx)
    assert.equal(metadata.status, 200, await metadata.clone().text())
    const removed = await app.request(`/api/batches/${emptyId}`, { method: 'DELETE' }, { DB: raw }, ctx)
    assert.equal(removed.status, 200, await removed.clone().text())
    assert.equal(sql.prepare('SELECT is_active a FROM product_batches WHERE id=?').get(emptyId).a, 0)
    await Promise.allSettled(pending)
  })
  await check('maintenance blocks physical changes without blocking lot metadata', async () => {
    await executor.executeStockTransaction(db, [{ sql: "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')" }], 'once')
    const before = state()
    await assert.rejects(batches.removeStockFromBatch(db, { productId: 1001, branchId: 1, batchId: 1001, quantity: 1 }), e => e.code === 'stock_schema_unavailable')
    assert.equal(state(), before)
    await db.prepare("UPDATE product_batches SET notes='metadata during hold' WHERE id=1001").run()
    assert.equal(sql.prepare('SELECT notes FROM product_batches WHERE id=1001').get().notes, 'metadata during hold')
  })
  console.log(`PASS ${checks} actual core writer groups on native SQLite with full0243 schema`)
}

module.exports = { sql, raw, db, load, actor, state, permits,
  failSql(pattern) { failSql = pattern }, loseNextAcknowledgement() { loseAck = true },
  counts: () => ({ calls, attempts }) }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => sql.close())
