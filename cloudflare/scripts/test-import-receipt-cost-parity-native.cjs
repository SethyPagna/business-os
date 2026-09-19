// Native SQLite execution of the actual additive-product-import statement
// composer and chunk runner. No copied receipt SQL or fake database success.
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const lib = path.join(__dirname, '../src/lib')
function compile(source, dependencies = {}) {
  const module = { exports: {} }
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('exports', 'require', 'module', js)(module.exports, name => {
    assert.ok(name in dependencies, `unexpected dependency ${name}`)
    return dependencies[name]
  }, module)
  return module.exports
}
const read = name => fs.readFileSync(path.join(lib, name + '.ts'), 'utf8').replace(/\r\n/g, '\n')
const money = compile(read('moneyPrecision'))
const batches = compile(read('productBatches'), {
  './batchCode': compile(read('batchCode')), './moneyPrecision': money,
  './sqlBinding': compile(read('sqlBinding')),
})
const catalog = compile(read('catalogCostRecompute'), { './moneyPrecision': money })
const source = read('importEngine')
const start = source.indexOf('const group: Array<{ sql: string; params: Record<string, unknown> }> = [rowGuardStatement(r.rowNumber), ...rowWriteGroup]')
const end = source.indexOf('\n            }\n          } else {', start)
assert.ok(start > 0 && end > start, 'locate actual additive receipt composer')
const { compose } = compile(`
  import { resolveReceiptLotTarget } from './productBatches'
  import { catalogCostRecomputeStatement } from './catalogCostRecompute'
  import { multiplyMoney4 } from './moneyPrecision'
  export function compose(context: any) {
    let { r, d, receiptUnitCostUsd, receiptLots, receiptBaselines, nextBatchId,
      rowGuardStatement, jobId, nowIso, mode } = context
    let rowWriteGroup = []
    ${source.slice(start, end)}
    return { group, nextBatchId }
  }
`, { './productBatches': batches, './catalogCostRecompute': catalog, './moneyPrecision': money })
const chunkStart = source.indexOf('const D1_IMPORT_BATCH_CHUNK_SIZE =')
const chunkEnd = source.indexOf('// Chunked + resumable', chunkStart)
const { runD1BatchGroupsInChunks } = compile(source.slice(chunkStart, chunkEnd))

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY, stock_quantity REAL DEFAULT 0,
      cost_price_usd REAL DEFAULT 99, purchase_price_usd REAL DEFAULT 99,
      cost_price_khr REAL DEFAULT 400, purchase_price_khr REAL DEFAULT 400);
    INSERT INTO products(id) VALUES(1);
    CREATE TABLE branches(id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO branches VALUES(1,'Shop'),(2,'Warehouse');
    CREATE TABLE product_batches(id INTEGER PRIMARY KEY, variant_product_id INTEGER,
      batch_key TEXT, lot_code TEXT, expiry_date TEXT, received_at TEXT, is_active INTEGER,
      notes TEXT, batch_number INTEGER, unit_cost_usd REAL, received_quantity REAL,
      received_cost_usd REAL, received_branch_id INTEGER, created_at TEXT, updated_at TEXT,
      UNIQUE(variant_product_id,batch_key), UNIQUE(variant_product_id,batch_number));
    CREATE TABLE branch_stock(product_id INTEGER, branch_id INTEGER, quantity REAL,
      UNIQUE(product_id,branch_id));
    CREATE TABLE branch_batch_stock(batch_id INTEGER, branch_id INTEGER, quantity REAL,
      updated_at TEXT, UNIQUE(batch_id,branch_id));
    CREATE TABLE inventory_movements(product_id INTEGER, product_name TEXT, branch_id INTEGER,
      branch_name TEXT, movement_type TEXT, quantity REAL, unit_cost_usd REAL,
      total_cost_usd REAL, reason TEXT, created_at TEXT, batch_id INTEGER);
    CREATE TABLE product_cost_entries(id INTEGER PRIMARY KEY, product_id INTEGER, cost_usd REAL,
      baseline_batch_id INTEGER);
    CREATE TABLE row_guards(row_number INTEGER PRIMARY KEY);
  `)
  const sizes = []
  const db = { async batch(statements) {
    sizes.push(statements.length)
    sqlite.transaction(() => statements.forEach(({ sql, params }) => sqlite.prepare(sql).run(params)))()
  } }
  let nextBatchId = 0
  let row = 0
  const receiptLots = new Map()
  const receiptBaselines = new Map()
  function plan(cost, branch = 1, quantity = 1) {
    const rowNumber = ++row
    const planned = compose({
      r: { existingId: 1, rowNumber }, d: { received_date: '2026-09-20', lot_code: 'Same label',
        stock_quantity: quantity, branch_id: branch, name: 'Serum' },
      receiptUnitCostUsd: cost, receiptLots, receiptBaselines, nextBatchId,
      rowGuardStatement: number => ({ sql: 'INSERT INTO row_guards VALUES(@number)', params: { number } }),
      jobId: 'job', nowIso: '2026-09-20T10:00:00Z', mode: 'merge_stock',
    })
    nextBatchId = planned.nextBatchId
    return planned.group
  }
  return { sqlite, db, sizes, plan, receiptLots, receiptBaselines }
}

;(async () => {
  const fixture = setup()
  const groups = [3, 5, 7, 5, 0].map((cost, index) => fixture.plan(cost, index % 2 + 1))
  await runD1BatchGroupsInChunks(fixture.db, groups)
  assert.deepEqual(fixture.sqlite.prepare('SELECT cost_price_usd, purchase_price_usd, cost_price_khr FROM products').get(),
    { cost_price_usd: 5, purchase_price_usd: 5, cost_price_khr: 400 })
  assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) n FROM product_batches').get().n, 4)
  assert.deepEqual(fixture.sqlite.prepare('SELECT received_quantity, received_cost_usd FROM product_batches WHERE unit_cost_usd=5').get(),
    { received_quantity: 2, received_cost_usd: 10 })
  assert.deepEqual(fixture.sqlite.prepare('SELECT unit_cost_usd FROM inventory_movements').all().map(row => row.unit_cost_usd), [3, 5, 7, 5, 0])
  assert.equal(fixture.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 5)
  await assert.rejects(() => fixture.db.batch(groups[0]), /UNIQUE/)
  assert.equal(fixture.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 5, 'journal replay cannot double count')

  const wide = setup()
  await runD1BatchGroupsInChunks(wide.db, [wide.plan(2), wide.plan(200)])
  assert.equal(wide.sqlite.prepare('SELECT cost_price_usd FROM products').get().cost_price_usd, 101)
  const baseline = wide.sqlite.prepare('SELECT MAX(id) id FROM product_batches').get().id
  wide.sqlite.prepare('INSERT INTO product_cost_entries VALUES(1,1,9,@baseline)').run({ baseline })
  wide.receiptBaselines.set(1, baseline)
  await wide.db.batch(wide.plan(2))
  assert.equal(wide.sqlite.prepare('SELECT COUNT(*) n FROM product_batches WHERE unit_cost_usd=2').get().n, 2, 'same old price after override is a new receipt lot')
  assert.equal(wide.sqlite.prepare('SELECT cost_price_usd FROM products').get().cost_price_usd, 5.5)
  assert.equal(wide.sqlite.prepare('SELECT COUNT(*) n FROM product_cost_entries').get().n, 1, 'receipts never mint manual overrides')

  const stale = setup()
  const staleGroup = stale.plan(3)
  stale.sqlite.exec('INSERT INTO product_cost_entries VALUES(1,1,9,99)')
  await assert.rejects(() => stale.db.batch(staleGroup), /malformed JSON/)
  assert.equal(stale.sqlite.prepare('SELECT COUNT(*) n FROM row_guards').get().n, 0)
  assert.equal(stale.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 0)

  const failed = setup()
  failed.sqlite.exec(`CREATE TRIGGER deny_catalog BEFORE UPDATE OF cost_price_usd ON products BEGIN SELECT RAISE(ABORT,'catalog failed'); END`)
  await assert.rejects(() => failed.db.batch(failed.plan(3)), /catalog failed/)
  for (const table of ['row_guards', 'product_batches', 'branch_stock', 'inventory_movements']) {
    assert.equal(failed.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, `${table} rolls back with catalog failure`)
  }

  const precision = setup()
  await runD1BatchGroupsInChunks(precision.db, [precision.plan(.0003, 1, .5), precision.plan(.0003, 2, .5)])
  assert.equal(precision.sqlite.prepare('SELECT received_cost_usd FROM product_batches').get().received_cost_usd, .0004)
  assert.deepEqual(precision.sqlite.prepare('SELECT total_cost_usd FROM inventory_movements').all().map(row => row.total_cost_usd), [.0002, .0002])

  const chunked = setup()
  await runD1BatchGroupsInChunks(chunked.db, Array.from({ length: 100 }, () => chunked.plan(5)))
  assert.ok(chunked.sizes.length > 1)
  assert.ok(chunked.sizes.every(size => size <= 300), 'whole receipt groups respect 300-statement packs')
  assert.equal(chunked.sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 100)
  assert.equal(chunked.sqlite.prepare('SELECT COUNT(*) n FROM row_guards').get().n, 100)
  assert.equal(chunked.sqlite.prepare('SELECT COUNT(*) n FROM product_batches').get().n, 1, 'same-chunk reservations top up one same-price lot')
  console.log('PASS native product-import receipt price identity, mean, override, journal rollback, precision and chunk budgets')
})().catch(error => { console.error(error); process.exitCode = 1 })
