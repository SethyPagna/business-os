const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(relative) {
  relative = path.posix.normalize(relative.endsWith('.ts') ? relative : relative + '.ts')
  if (cache.has(relative)) return cache.get(relative).exports
  const module = { exports: {} }; cache.set(relative, module)
  const source = fs.readFileSync(path.join(root, 'src', relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', compiled)(request => {
    if (['./importMaintenanceFence', '../durable-objects/broadcastHub', './cache'].includes(request)) return new Proxy({}, { get: () => () => { throw Error('Unexpected effect ' + request) } })
    assert.ok(request.startsWith('.'), 'Unexpected dependency ' + request)
    return load(path.posix.join(path.posix.dirname(relative), request))
  }, module, module.exports)
  return module.exports
}
const journal = load('lib/branchCutoverJournal')
const child = load('lib/branchCutoverChild')
const { D1Compat } = load('lib/db')
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = { id: 7, username: 'operator', name: 'Operator', organization_id: 1, role_id: null, permissions: '{"branches":true}', is_active: 1 }
const budget = { tier: 'paid', alreadyUsed: 0, remainingReads: 0, completionQueries: 0, retryQueries: 0, safetyQueries: 0, extraAtomicStatements: 0 }
function world(lots = [1], untracked = 0) {
  const raw = new DatabaseSync(':memory:'); raw.limits.exprDepth = 100
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(file => file.endsWith('.sql')).sort()) raw.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  raw.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0);
    INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) VALUES(7,'operator','fixture','Operator',1,'{"branches":true}',1);
    INSERT INTO products(id,name,sku,is_active,cost_price_usd,cost_price_khr) VALUES(1,'Product','P1',1,2.5,10000);`)
  for (const [i, quantity] of lots.entries()) {
    raw.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,notes,batch_number,unit_cost_usd,is_active) VALUES(?,1,?,?,'2026-01-01','2027-01-01','Original note',?,?,1)").run(i + 1, 'lot-' + i, 'lot-' + i, i + 1, i + 1)
    raw.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(i + 1, quantity)
  }
  const quantity = lots.reduce((a, b) => a + b, 0) + untracked
  raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,?),(1,2,0)').run(quantity)
  raw.prepare('UPDATE products SET stock_quantity=?,cost_price_usd=2.5,cost_price_khr=10000 WHERE id=1').run(quantity)
  raw.prepare('INSERT INTO system_flags(key,value) VALUES(?,?)').run('branch_cutover_control_incarnation', uuid(99))
  const stats = { reads: 0, batches: 0, binds: 0, statements: 0, sql: [], before: null, after: null, failAt: -1, unreadable: false }
  function prepared(sql, values = []) {
    assert.ok(values.length <= 100); stats.binds = Math.max(stats.binds, values.length)
    const execute = () => {
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))] : values
      const statement = raw.prepare(sql)
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return { success: true, results: statement.all(...args), meta: { changes: 0 } }
      const result = statement.run(...args)
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
    }
    return { sql, values, bind: (...bound) => prepared(sql, bound), execute,
      all: async () => { stats.reads++; stats.sql.push(sql); if (stats.unreadable) throw Error('proof unavailable'); return execute() }, run: async () => execute() }
  }
  const db = new D1Compat({ prepare: prepared, batch: async statements => {
    stats.batches++; stats.statements = statements.length
    if (stats.before) { const hook = stats.before; stats.before = null; await hook(raw) }
    raw.exec('BEGIN IMMEDIATE')
    let result
    try { result = statements.map((statement, i) => { if (i === stats.failAt) throw Error('injected boundary'); return statement.execute() }); raw.exec('COMMIT') }
    catch (error) { raw.exec('ROLLBACK'); throw error }
    if (stats.after) { const hook = stats.after; stats.after = null; hook(raw) }
    return result
  } })
  return { raw, db, stats, quantity }
}
const ownership = row => ({ operationId: row.operation_id, actorId: row.actor_id, organizationId: row.organization_id, controlIncarnation: row.control_incarnation, token: row.maintenance_token })
async function planned(w, transfer = {}) {
  let row = (await journal.beginBranchCutoverJournal(w.db, { operationId: uuid(1), beginRequestId: 'cutover_begin_001', actorId: 7, organizationId: '1', controlIncarnation: uuid(99), token: uuid(2), sourceBranchId: 1, targetBranchId: 2,
    intentJson: '{"action":"retire","sourceBranchId":1,"targetBranchId":2}', sourcePreimageJson: '{"id":1,"name":"Shop"}', targetPreimageJson: '{"id":2,"name":"Warehouse"}' })).row
  row = await journal.checkpointBranchCutoverJournal(w.db, ownership(row), row.revision, { phase: 'capturing', records: 1, cursorJson: '{"id":1}', digest: 'a'.repeat(64) })
  row = await journal.sealBranchCutoverManifest(w.db, ownership(row), row.revision, JSON.stringify({ version: 1, sourceBranchId: 1, targetBranchId: 2, capturedRecords: 1, movingProducts: 1, sourceQuantityText: String(w.quantity), sourceLotQuantityText: String(w.quantity), anomalies: 0, captureDigest: row.capture_digest }))
  row = await journal.finishBranchCutoverSnapshots(w.db, ownership(row), row.revision)
  const envelope = { version: 1, kind: 'branch-cutover-child', operationId: row.operation_id, sequence: 0, actorId: 7, organizationId: '1', controlIncarnation: row.control_incarnation, sourceBranchId: 1, targetBranchId: 2, reason: 'Retire Shop', transfer: { productId: 1, quantity: w.quantity, batchId: null, ...transfer } }
  const childJson = JSON.stringify(envelope)
  row = await journal.sealBranchCutoverChild(w.db, ownership(row), row.revision, childJson)
  w.stats.batches = 0; w.stats.reads = 0; w.stats.sql = []
  return { row, proof: ownership(row), expected: { sequence: 0, childJson } }
}
const execute = (w, p, overrides = {}) => child.executePlannedBranchCutoverChild(w.db, overrides.actor || actor, overrides.proof || p.proof, overrides.expected || p.expected, overrides.budget || budget, overrides.organizationId === undefined ? 1 : overrides.organizationId)
const tables = ['branch_stock', 'branch_batch_stock', 'product_batches', 'products', 'inventory_movements', 'stock_transfers', 'transfer_operation_receipts', 'transfer_operation_members', 'action_history', 'audit_logs', 'branch_cutovers', 'system_flags']
const snapshot = w => JSON.stringify(Object.fromEntries(tables.map(table => [table, w.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
let checks = 0
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name) }
async function main() {
  await check('actual one-batch transfer and journal progress', async () => {
    const w = world(); const p = await planned(w); const result = await execute(w, p)
    assert.equal(result.replayed, false); assert.equal(result.row.next_sequence, 1); assert.equal(result.row.planned_child_json, null)
    assert.equal(w.stats.batches, 1); assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=1').get().quantity, 0)
    assert.equal(w.raw.prepare('SELECT quantity FROM branch_stock WHERE branch_id=2').get().quantity, 1)
    assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n, 1)
    w.raw.close()
  })
  console.log(`${checks} branch cutover child native groups passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
