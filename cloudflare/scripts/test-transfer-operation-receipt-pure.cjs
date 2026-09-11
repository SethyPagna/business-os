// Real Hono handlers, permission policy, receipt/stock/lot helpers and SQLite.
// Only session acquisition, duplicate-product resolution and notifications are mocked.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
let sqlite, beforeBatch = null, waits = [], mergeTarget = null, failStatement = null
let user = { id: 7, name: 'Operator', permissions: JSON.stringify({ branches: true, inventory: true }) }
const modules = new Map()
function wrapDb() {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      return Object.fromEntries(['get', 'all', 'run'].map((method) => [method, async (params) => Array.isArray(params) ? statement[method](...params) : statement[method](params || {})]))
    },
    async batch(statements) {
      if (beforeBatch) { const mutate = beforeBatch; beforeBatch = null; mutate() }
      return sqlite.transaction(() => statements.map(({ sql, params }) => {
        if (failStatement && sql.includes(failStatement)) throw new Error('injected statement failure')
        return sqlite.prepare(sql).run(params || {})
      }))()
    },
  }
}
const realLibraries = new Set(['operationWriteReadiness', 'db', 'sqlBinding', 'batchCode', 'productBatches', 'branchRoles', 'branchRoleGuards', 'canonicalBranchIdentity', 'transferOperationReceipt', 'transferOperation', 'permissions', 'actorSnapshot', 'undoAppliers'])
function load(relative) {
  if (modules.has(relative)) return modules.get(relative)
  const module = { exports: {} }
  modules.set(relative, module.exports)
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', 'module', code)(module.exports, (id) => {
    if (id === 'hono') return require('hono')
    const name = id.split('/').at(-1)
    if (name === 'db') return { ...load('lib/db.ts'), getDb: wrapDb }
    if (name === 'auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (realLibraries.has(name)) return load(`lib/${name}.ts`)
    if (name === 'productIdentity') return { findIdentityMatch: async () => mergeTarget, findIdentityMatches: async () => new Map() }
    if (name === 'saleBulkUpdate') return { SALE_BULK_UPDATE_KINDS: new Set(['sale.fields.bulk']), BULK_UPDATE_KIND: 'sale.fields.bulk', BULK_CUSTOMER_UPDATE_KIND: 'sale.customer.bulk', MULTI_CUSTOMER_UPDATE_KIND: 'sale.customer.v2.bulk', SINGLE_CUSTOMER_UPDATE_KIND: 'sale.customer.single' }
    if (name === 'saleBulkStatus') return { BULK_STATUS_KIND: 'sale.status.bulk' }
    if (name === 'returnBulkAction') return { RETURN_BULK_ACTION_KIND: 'return.fields.bulk' }
    if (name === 'stockSession') return { STOCK_SESSION_KIND: 'stock.session' }
    if (name === 'saleSettlementAction') return { SALE_SETTLEMENT_ACTION_KIND: 'sale.settlement' }
    if (name === 'productDelete') return { PRODUCT_REMOVE_ACTION_KIND: 'product.remove' }
    if (name === 'broadcastHub') return { broadcast: async () => {} }
    if (name === 'cache') return { bumpVersion: async () => {} }
    if (name === 'telegram') return { formatTransferTelegramLines: () => [], sendTelegramEvent: async () => {} }
    // Unrelated routes are registered but never called by these tests.
    return new Proxy({}, { get: (_target, property) => () => { throw new Error(`Unexpected dependency ${id}.${String(property)}`) } })
  }, module)
  modules.set(relative, module.exports)
  return module.exports
}
const apps = { branches: load('routes/branches.ts').default, inventory: load('routes/inventory.ts').default }
for (const app of Object.values(apps)) app.onError((error, c) => c.json({ error: error.message }, 500))

function fresh(count = 3, from = 1, beforeMigration = null) {
  sqlite = new Database(':memory:')
  const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter(file => file.endsWith('.sql') && (!beforeMigration || file < beforeMigration)).sort()
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  sqlite.exec("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1),(3,'Other',1)")
  for (let id = 1; id <= count; id++) {
    sqlite.prepare('INSERT INTO products(id,name,stock_quantity) VALUES(?,?,10)').run(id, `Product ${id}`)
    sqlite.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,10)').run(id, from)
    sqlite.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at) VALUES(?,?,?,?,'2026-09-01')").run(id, id, `lot-${id}`, `lot-${id}`)
    sqlite.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,10)').run(id, from)
  }
  beforeBatch = null; waits = []; mergeTarget = null; failStatement = null
  user = { id: 7, name: 'Operator', permissions: JSON.stringify({ branches: true, inventory: true }) }
}
async function request(app, route, body, method = 'POST') {
  const response = await apps[app].request(route, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) }, {}, {
    waitUntil: (promise) => { waits.push(Promise.resolve(promise)) }, passThroughOnException: () => {},
  })
  await Promise.all(waits.splice(0))
  return { status: response.status, body: await response.json() }
}
function intent(from, count, key = 'transfer_test_001', bulk = true) {
  const common = { transfer_provenance_version: 1, fromBranchId: from, toBranchId: from === 1 ? 2 : 1, reason: 'Restock', client_request_id: key }
  return bulk ? { ...common, items: Array.from({ length: count }, (_, index) => ({ productId: index + 1, quantity: 2.5 })) } : { ...common, productId: 1, quantity: 2.5 }
}
function counts() {
  return Object.fromEntries(['transfer_operation_receipts', 'audit_logs', 'stock_transfers', 'inventory_movements'].map((table) => [table, sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))
}
let checks = 0
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`) }
async function main() {
  for (const from of [1, 2]) for (const [app, route, count] of [
    ['branches', '/transfer', 1], ['inventory', '/transfer', 1], ['branches', '/transfer-bulk', 3], ['branches', '/transfer-bulk', 200],
  ]) await check(`${app}${route} ${from}→${from === 1 ? 2 : 1}, ${count} products: one commit/replay/conflict`, async () => {
    fresh(count, from)
    const body = intent(from, count, 'transfer_test_001', route.endsWith('bulk'))
    const first = await request(app, route, body)
    assert.equal(first.status, 200, JSON.stringify(first))
    assert.equal(first.body.replayed, false)
    const after = counts()
    assert.deepEqual(after, { transfer_operation_receipts: 1, audit_logs: 1, stock_transfers: count, inventory_movements: count * 2 })
    const replay = await request(app, route, body)
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true)
    assert.deepEqual(counts(), after)
    const changed = await request(app, route, { ...body, reason: 'Changed intent' })
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'idempotency_conflict')
    assert.deepEqual(counts(), after)
    for (let id = 1; id <= count; id++) {
      assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_stock WHERE product_id=?').get(id).n, 10)
      assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(id, from).quantity, 7.5)
      assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_batch_stock WHERE batch_id=?').get(id).n, 10)
      assert.equal(sqlite.prepare('SELECT stock_quantity FROM products WHERE id=?').get(id).stock_quantity, 10)
    }
    assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_stock').get().n, count * 10)
    sqlite.close()
  })
  for (const [app, route] of [['branches', '/transfer'], ['branches', '/transfer-bulk'], ['inventory', '/transfer']]) {
    for (const mutation of ['delete', 'drain', 'deactivate', 'delete-lot', 'deactivate-lot']) await check(`${app}${route}: ${mutation} source after preflight rolls back`, async () => {
      fresh()
      beforeBatch = () => sqlite.exec(mutation === 'delete' ? 'DELETE FROM branch_stock WHERE product_id=1 AND branch_id=1'
        : mutation === 'delete-lot' ? 'DELETE FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1'
        : mutation === 'deactivate-lot' ? 'UPDATE product_batches SET is_active=0 WHERE id=1'
        : mutation === 'drain' ? 'UPDATE branch_stock SET quantity=0 WHERE product_id=1 AND branch_id=1'
          : 'UPDATE branches SET is_active=0 WHERE id=2')
      const response = await request(app, route, intent(1, 3, 'transfer_race_001', route.endsWith('bulk')))
      assert.equal(response.status, 500)
      assert.deepEqual(counts(), { transfer_operation_receipts: 0, audit_logs: 0, stock_transfers: 0, inventory_movements: 0 })
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM branch_stock WHERE branch_id=2').get().n, 0)
      assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_batch_stock').get().n, mutation === 'delete-lot' ? 20 : 30)
      sqlite.close()
    })
    for (const change of [{ reason: '' }, { toBranchId: 1 }, { toBranchId: 3 }, { client_request_id: '' }]) await check(`${app}${route}: invalid ${Object.keys(change)[0]} refuses without writes`, async () => {
      fresh()
      const body = { ...intent(1, 3, 'transfer_invalid_001', route.endsWith('bulk')), ...change }
      const result = await request(app, route, body)
      assert.equal(result.status, 400)
      assert.equal(counts().transfer_operation_receipts, 0)
      assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_stock').get().n, 30)
      sqlite.close()
    })
    for (const tier of [false, 'view', 'review']) await check(`${app}${route}: ${tier} permission refuses before any effect`, async () => {
      fresh()
      user.permissions = JSON.stringify({ branches: tier, inventory: tier })
      const result = await request(app, route, intent(1, 3, 'transfer_deny_001', route.endsWith('bulk')))
      assert.equal(result.status, 403)
      assert.equal(counts().transfer_operation_receipts, 0)
      assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_stock').get().n, 30)
      sqlite.close()
    })
    await check(`${app}${route}: duplicate concurrent request moves stock once`, async () => {
      fresh()
      const body = intent(1, 3, 'transfer_concurrent_001', route.endsWith('bulk'))
      const results = await Promise.all([request(app, route, body), request(app, route, body)])
      assert.deepEqual(results.map((result) => result.status), [200, 200])
      assert.equal(counts().transfer_operation_receipts, 1)
      assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 7.5)
      sqlite.close()
    })
  }
  await check('explicit lot deleted after preflight rolls back branch totals and receipt', async () => {
    fresh()
    beforeBatch = () => sqlite.exec('DELETE FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1')
    const result = await request('branches', '/transfer', { ...intent(1, 1, 'transfer_explicit_001', false), batchId: 1 })
    assert.equal(result.status, 500)
    assert.equal(counts().transfer_operation_receipts, 0)
    assert.equal(sqlite.prepare('SELECT SUM(quantity) AS n FROM branch_stock').get().n, 30)
    sqlite.close()
  })
  console.log(`${checks} transfer operation route scenarios passed`)
}
module.exports = { fresh, request, intent, counts, load, wrapDb, apps,
  getDb: () => sqlite,
  setUser: value => { user = value },
  setMerge: value => { mergeTarget = value },
  failAt: value => { failStatement = value },
  beforeBatch: value => { beforeBatch = value },
}
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })
