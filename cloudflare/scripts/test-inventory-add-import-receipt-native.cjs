const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')
function compile(name, dependencies = {}, allowUncalledStubs = false) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', name + '.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const module = { exports: {} }
  new Function('exports', 'require', 'module', code)(module.exports, request => {
    if (request in dependencies) return dependencies[request]
    assert.ok(allowUncalledStubs, `unregistered dependency ${request}`)
    return {} // Worker/queue integrations are not called by these exported planners.
  }, module)
  return module.exports
}
const money = compile('moneyPrecision')
const sqlBinding = compile('sqlBinding')
const batches = compile('productBatches', { './moneyPrecision': money, './sqlBinding': sqlBinding, './batchCode': compile('batchCode') })
const catalog = compile('catalogCostRecompute', { './moneyPrecision': money })
const engine = compile('importEngine', { './productBatches': batches, './catalogCostRecompute': catalog,
  './moneyPrecision': money, './sqlBinding': sqlBinding, './stockReceiptGate': compile('stockReceiptGate') }, true)
const row = (rowNumber, cost, quantity = 1, branch = 1) => ({
  rowNumber, action: 'create', existingId: 1, identifier: 'P', changes: {}, message: null,
  data: { product_id: 1, product_name: 'P', branch_id: branch, branch_name: branch === 1 ? 'Shop' : 'Warehouse',
    quantity, signedQuantity: quantity, movement_type: 'in', reason: 'import',
    unit_cost_usd: cost, unit_cost_khr: null, total_cost_usd: cost === null ? null : money.multiplyMoney4(cost, quantity), total_cost_khr: null,
    inventory_receipt_plan_version: 1, free_goods: cost === 0, receipt_date_explicit: true, created_at: '2026-09-20T00:00:00.000Z' },
})
function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,stock_quantity REAL DEFAULT 0,cost_price_usd REAL DEFAULT 99,
      purchase_price_usd REAL DEFAULT 99,cost_price_khr REAL DEFAULT 400,purchase_price_khr REAL DEFAULT 400,updated_at TEXT);
    INSERT INTO products(id) VALUES(1);
    CREATE TABLE product_batches(id INTEGER PRIMARY KEY AUTOINCREMENT,variant_product_id INTEGER,batch_key TEXT,lot_code TEXT,
      received_at TEXT,expiry_date TEXT,is_active INTEGER,notes TEXT,batch_number INTEGER,supplier_id INTEGER,supplier_name TEXT,
      unit_cost_usd REAL,payment_status TEXT,credit_due_date TEXT,received_quantity REAL,received_branch_id INTEGER,
      received_cost_usd REAL,updated_at TEXT,UNIQUE(variant_product_id,batch_key),UNIQUE(variant_product_id,batch_number));
    CREATE TABLE branch_stock(product_id INTEGER,branch_id INTEGER,quantity REAL,UNIQUE(product_id,branch_id));
    CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL,updated_at TEXT,UNIQUE(batch_id,branch_id));
    CREATE TABLE stock_session_guards(guard_value INTEGER NOT NULL CHECK(guard_value=1));
    CREATE TABLE product_cost_entries(id INTEGER PRIMARY KEY,product_id INTEGER,cost_usd REAL,baseline_batch_id INTEGER);
    CREATE TABLE inventory_movements(product_id INTEGER,product_name TEXT,branch_id INTEGER,branch_name TEXT,movement_type TEXT,
      quantity REAL,unit_cost_usd REAL,unit_cost_khr REAL,total_cost_usd REAL,total_cost_khr REAL,reason TEXT,created_at TEXT,batch_id INTEGER);
    CREATE TABLE row_guards(row_number INTEGER PRIMARY KEY);
  `)
  const batchSizes = []
  let reads = 0
  const db = {
    prepare(sql) { return {
      async get(params = {}) { reads++; return sqlite.prepare(sql).get(params) },
      async all(params = {}) { reads++; return sqlite.prepare(sql).all(params) },
    } },
    async batch(statements) {
      batchSizes.push(statements.length)
      sqlite.transaction(() => statements.forEach(({ sql, params }) => sqlite.prepare(sql).run(params || {})))()
    },
  }
  const guard = number => ({ sql: 'INSERT INTO row_guards VALUES(@number)', params: { number } })
  const plan = rows => engine.planInventoryImportReceiptGroups(db, rows, guard)
  const apply = async rows => engine.runD1BatchGroupsInChunks(db, await plan(rows))
  return { sqlite, db, plan, apply, batchSizes, reads: () => reads }
}

;(async () => {
  const precise = setup()
  await precise.apply([row(1, 3.1234, 2)])
  assert.equal(precise.sqlite.prepare('SELECT unit_cost_usd FROM product_batches').get().unit_cost_usd, 3.1234)
  assert.deepEqual(precise.sqlite.prepare('SELECT unit_cost_usd,total_cost_usd FROM inventory_movements').get(), { unit_cost_usd: 3.1234, total_cost_usd: 6.2468 })
  assert.equal(precise.sqlite.prepare('SELECT cost_price_usd FROM products').get().cost_price_usd, 3.1234)
  const fixture = setup()
  const groups = await fixture.plan([row(1, 3, 2, 1), row(2, 5, 1, 2), row(3, 3, 1, 2)])
  await engine.runD1BatchGroupsInChunks(fixture.db, groups)
  assert.deepEqual(fixture.sqlite.prepare('SELECT stock_quantity,cost_price_usd,cost_price_khr FROM products').get(), { stock_quantity: 4, cost_price_usd: 4, cost_price_khr: 400 })
  assert.deepEqual(fixture.sqlite.prepare('SELECT branch_id,quantity FROM branch_stock ORDER BY branch_id').all(), [{ branch_id: 1, quantity: 2 }, { branch_id: 2, quantity: 2 }])
  assert.equal(fixture.sqlite.prepare('SELECT SUM(quantity) total FROM branch_batch_stock').get().total, 4)
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM product_batches').get().n, 2)
  assert.equal(fixture.sqlite.prepare('SELECT received_cost_usd FROM product_batches WHERE unit_cost_usd=3').get().received_cost_usd, 9)
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements WHERE batch_id IS NOT NULL').get().n, 3)
  await assert.rejects(() => fixture.db.batch(groups[0]), /UNIQUE/)
  assert.equal(fixture.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 4)
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM stock_session_guards').get().n, 0)
  const baseline = fixture.sqlite.prepare('SELECT MAX(id) id FROM product_batches').get().id
  fixture.sqlite.prepare('INSERT INTO product_cost_entries VALUES(1,1,9,@baseline)').run({ baseline })
  await fixture.apply([row(4, 3)])
  assert.equal(fixture.sqlite.prepare('SELECT cost_price_usd FROM products').get().cost_price_usd, 6)
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM product_cost_entries').get().n, 1)

  const unknown = setup()
  await assert.rejects(() => unknown.apply([row(1, null)]), /must carry its unit cost/)
  await unknown.apply([row(2, 0)])
  assert.equal(unknown.sqlite.prepare('SELECT cost_price_usd FROM products').get().cost_price_usd, 99, 'declared free receipt never overrides known catalog cost')
  assert.deepEqual(unknown.sqlite.prepare('SELECT unit_cost_usd FROM inventory_movements').all().map(value => value.unit_cost_usd), [0])
  const small = setup()
  await small.apply([row(1, .0003, .5), row(2, .0003, .5)])
  assert.equal(small.sqlite.prepare('SELECT received_cost_usd FROM product_batches').get().received_cost_usd, .0004)

  const failed = setup()
  failed.sqlite.exec(`CREATE TRIGGER refuse_catalog BEFORE UPDATE OF cost_price_usd ON products BEGIN SELECT RAISE(ABORT,'catalog failure'); END`)
  await assert.rejects(() => failed.apply([row(1, 3)]), /catalog failure/)
  for (const table of ['product_batches', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'row_guards']) {
    assert.equal(failed.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `${table} rolls back`)
  }
  const stale = setup()
  const staleGroups = await stale.plan([row(1, 3)])
  stale.sqlite.exec('INSERT INTO product_cost_entries VALUES(1,1,9,5)')
  await assert.rejects(() => engine.runD1BatchGroupsInChunks(stale.db, staleGroups), /CHECK/)
  assert.equal(stale.sqlite.prepare('SELECT COUNT(*) n FROM row_guards').get().n, 0)
  assert.equal(stale.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 0)

  const many = setup()
  await many.apply(Array.from({ length: 100 }, (_, index) => row(index + 1, 3)))
  assert.equal(many.reads(), 3, 'same-product rows use bounded chunk reads, not per-row queries')
  assert.ok(many.batchSizes.length > 1 && many.batchSizes.every(size => size <= 300))
  assert.equal(many.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 100)
  assert.equal(many.sqlite.prepare('SELECT COUNT(*) n FROM product_batches').get().n, 1)
  const old = row(1, 3)
  delete old.data.inventory_receipt_plan_version
  await assert.rejects(() => setup().plan([old]), /Analyze.*again/)
  console.log('PASS native versioned inventory-add receipts: 4dp, all stock ledgers, mean, override, journal replay/rollback, required cost and chunk budgets')
})().catch(error => { console.error(error); process.exitCode = 1 })
