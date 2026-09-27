// U-cost3 (refuter R-cost2, E1 live half): a writer that RETIRES a lot
// (product_batches.is_active = 0) must re-derive the catalog cost in the same
// write. The 0195 triggers fire on branch_batch_stock rows and on lot
// INSERT/DELETE, never on a lot UPDATE; with nothing on hand the formula
// falls back to the newest ACTIVE lot, so retiring that lot moves the figure.
// Before this fix two writers left products.cost_price_usd on the retired
// lot's cost, and every later sale snapshotted it:
//   - DELETE /api/batches/:id (routes/batches.ts), the lot deactivate;
//   - POST /api/inventory/movements/:id/revert of a receipt
//     (lib/stockRevert.ts -> planUnreceiveBatchStock), whose stock decrement
//     fires the trigger while the lot is still active, then retires it.
// Fixture: lot A (5.00) received first and sold out, lot B (9.00) received
// later. Retiring B with nothing on hand must leave the catalog at A's 5.00
// (the 0195 fallback: newest active received lot); the stale figure is 9.00.
// Both writers are exercised through the real Hono routes on the real
// migration chain (better-sqlite3), only auth/broadcast/cache/telegram stubbed.
//
// Run (from cloudflare/): node scripts/test-catalog-cost-lot-retire-native.cjs
// CATALOG_RETIRE_SRC=<dir> runs the same checks against another src tree
// (e.g. the pre-fix one, where both checks fail).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const srcDir = process.env.CATALOG_RETIRE_SRC || path.join(__dirname, '../src')
let sqlite
let waits = []
const user = { id: 7, name: 'Operator', permissions: JSON.stringify({ inventory: true, product_cost_edit: true, product_cost_view: true }) }
const modules = new Map()

function wrapDb() {
  const run = (statement, params) => {
    const r = Array.isArray(params) ? statement.run(...params) : statement.run(params || {})
    return { ...r, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }
  }
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      return {
        get: async (params) => Array.isArray(params) ? statement.get(...params) : statement.get(params || {}),
        all: async (params) => Array.isArray(params) ? statement.all(...params) : statement.all(params || {}),
        run: async (params) => run(statement, params),
      }
    },
    async batch(statements) {
      return sqlite.transaction(() => statements.map(({ sql, params }) => run(sqlite.prepare(sql), params)))()
    },
  }
}

function load(relative) {
  if (modules.has(relative)) return modules.get(relative)
  const module = { exports: {} }
  modules.set(relative, module.exports)
  const code = ts.transpileModule(fs.readFileSync(path.join(srcDir, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', 'module', code)(module.exports, (id) => {
    if (id === 'hono') return require('hono')
    const name = id.split('/').at(-1)
    if (name === 'db') return { ...load('lib/db.ts'), getDb: wrapDb }
    if (name === 'auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === 'broadcastHub') return { broadcast: async () => {} }
    if (name === 'cache') return { bumpVersion: async () => {} }
    if (name === 'telegram') return { formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [], sendTelegramEvent: async () => {} }
    if (id.startsWith('../lib/') || id.startsWith('./')) {
      const resolved = `lib/${name}.ts`
      if (fs.existsSync(path.join(srcDir, resolved))) return load(resolved)
    }
    return new Proxy({}, { get: (_target, property) => () => { throw new Error(`Unexpected dependency ${id}.${String(property)}`) } })
  }, module)
  modules.set(relative, module.exports)
  return module.exports
}

const inventory = load('routes/inventory.ts').default
const batches = load('routes/batches.ts').default
for (const app of [inventory, batches]) app.onError((error, c) => c.json({ error: error.message }, 500))

function fresh() {
  sqlite = new Database(':memory:')
  const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter((file) => file.endsWith('.sql')).sort()
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  sqlite.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)")
  sqlite.exec("INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr) VALUES(1,'Widget',0,0,0)")
  waits = []
}

async function call(app, url, method, body) {
  const response = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, {}, {
    waitUntil: (promise) => { waits.push(Promise.resolve(promise)) }, passThroughOnException: () => {},
  })
  await Promise.all(waits.splice(0))
  return { status: response.status, body: await response.json() }
}
const receive = (unitCostUsd, receivedDate, quantity) => call(inventory, '/adjust', 'POST', {
  productId: 1, type: 'add', quantity, reason: 'Restock', branchId: 1, supplierName: 'Acme', unitCostUsd, batchId: 'new', receivedDate,
})
const catalogUsd = () => sqlite.prepare('SELECT cost_price_usd c FROM products WHERE id = 1').get().c
const lotId = (cost) => sqlite.prepare('SELECT id FROM product_batches WHERE unit_cost_usd = ?').get(cost).id
// Sells a lot out without the POS: the branch_batch_stock write fires the 0195
// trigger exactly as a sale's decrement does.
const sellOut = (lot) => sqlite.prepare('UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = ?').run(lot)

// A (5.00) received and sold out, then B (9.00) received: the shelf is B.
async function seed() {
  fresh()
  assert.equal((await receive(5, '01/09/2026', 1)).status, 200)
  sellOut(lotId(5))
  assert.equal(catalogUsd(), 5, 'nothing on hand: the newest active lot (A) stands in')
  const b = await receive(9, '02/09/2026', 2)
  assert.equal(b.status, 200, JSON.stringify(b))
  assert.equal(catalogUsd(), 9, 'the shelf is B')
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name} - ${e.stack}`); process.exitCode = 1 }
}

async function main() {
  await check('DELETE /batches/:id retiring the newest lot with nothing on hand re-derives to the fallback lot', async () => {
    await seed()
    const b = lotId(9)
    sellOut(b)
    assert.equal(catalogUsd(), 9, 'sold out: the newest active lot is still B')
    const retired = await call(batches, `/${b}`, 'DELETE')
    assert.equal(retired.status, 200, JSON.stringify(retired))
    assert.equal(sqlite.prepare('SELECT is_active a FROM product_batches WHERE id = ?').get(b).a, 0)
    assert.equal(catalogUsd(), 5, 'B retired: the catalog falls back to A, not the retired 9.00')
    // A refused deactivation (stock still on hand) writes nothing.
    const a = lotId(5)
    sqlite.prepare('UPDATE branch_batch_stock SET quantity = 3 WHERE batch_id = ?').run(a)
    const before = sqlite.prepare('SELECT cost_price_usd, updated_at FROM products WHERE id = 1').get()
    const refused = await call(batches, `/${a}`, 'DELETE')
    assert.equal(refused.status, 400, JSON.stringify(refused))
    assert.deepEqual(sqlite.prepare('SELECT cost_price_usd, updated_at FROM products WHERE id = 1').get(), before)
  })

  await check('reverting the only receipt of the newest lot re-derives to the fallback lot', async () => {
    await seed()
    const b = lotId(9)
    const receipt = sqlite.prepare("SELECT id FROM inventory_movements WHERE batch_id = ? AND movement_type IN ('add', 'stock_in') AND quantity > 0").get(b).id
    const reverted = await call(inventory, `/movements/${receipt}/revert`, 'POST')
    assert.equal(reverted.status, 200, JSON.stringify(reverted))
    assert.equal(sqlite.prepare('SELECT is_active a FROM product_batches WHERE id = ?').get(b).a, 0, 'the un-received lot is retired')
    assert.equal(catalogUsd(), 5, 'B un-received: the catalog falls back to A, not the reverted 9.00')
  })

  await check('control: a revert that leaves stock on hand still weighs what is on hand', async () => {
    fresh()
    assert.equal((await receive(4, '01/09/2026', 2)).status, 200)
    assert.equal((await receive(8, '02/09/2026', 2)).status, 200)
    assert.equal(catalogUsd(), 6)
    const receipt = sqlite.prepare("SELECT id FROM inventory_movements WHERE batch_id = ? AND quantity > 0").get(lotId(8)).id
    assert.equal((await call(inventory, `/movements/${receipt}/revert`, 'POST')).status, 200)
    assert.equal(catalogUsd(), 4)
  })

  console.log(`\n${checks} checks passed`)
}

main()
