const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const batchCode = compile('batchCode.ts')
const subject = compile('stockActionCommit.ts', { './db': {}, './batchCode': batchCode })

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock_quantity REAL DEFAULT 0,
      cost_price_usd REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      UNIQUE(product_id, branch_id));
    CREATE TABLE product_batches (id INTEGER PRIMARY KEY, variant_product_id INTEGER,
      batch_key TEXT, lot_code TEXT, expiry_date TEXT, received_at TEXT, is_active INTEGER DEFAULT 1);
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, receipt_number TEXT, client_request_id TEXT UNIQUE,
      cashier_name TEXT, branch_id INTEGER, branch_name TEXT, payment_method TEXT, payment_currency TEXT,
      subtotal_usd REAL, total_usd REAL, amount_paid_usd REAL, sale_status TEXT, notes TEXT,
      items TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER,
      product_name TEXT, quantity REAL, unit TEXT, applied_price_usd REAL, cost_price_usd REAL,
      total_usd REAL, branch_id INTEGER, price_mode TEXT, base_price_usd REAL, batch_id INTEGER,
      batch_label TEXT, batch_expiry_date TEXT);
    CREATE TABLE sale_item_batch_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_item_id INTEGER,
      batch_id INTEGER, branch_id INTEGER, quantity REAL, lot_code TEXT, expiry_date TEXT);
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER,
      product_name TEXT, branch_id INTEGER, branch_name TEXT, movement_type TEXT, quantity REAL,
      unit_cost_usd REAL, total_cost_usd REAL, reason TEXT, reference_id INTEGER, created_at TEXT);
  `)
  sqlite.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0056_import_stock_action_commits.sql'), 'utf8'))
  sqlite.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0057_import_stock_action_guards.sql'), 'utf8'))
  sqlite.exec(`
    INSERT INTO products(id, name, stock_quantity, cost_price_usd) VALUES (10, 'Serum', 10, 4.25);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (10, 1, 10);
    INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, expiry_date, received_at)
      VALUES (101, 10, 'late', 'LATE', '2027-12-31', '2026-01-01'),
             (102, 10, 'early', 'EARLY', '2026-12-31', '2026-01-02'),
             (103, 10, 'no expiry', 'NO EXPIRY', NULL, '2026-01-03');
    INSERT INTO branch_batch_stock(batch_id, branch_id, quantity)
      VALUES (101, 1, 4), (102, 1, 3), (103, 1, 3);
  `)

  const db = {
    prepare(sql) {
      return {
        get(params) { return Promise.resolve(sqlite.prepare(sql).get(params)) },
        all(params) { return Promise.resolve(sqlite.prepare(sql).all(params)) },
        run(params) {
          const info = sqlite.prepare(sql).run(params)
          return Promise.resolve({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) })
        },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params)))
      return Promise.resolve(run())
    },
  }
  return { sqlite, db }
}

const base = {
  jobId: 'job-sale',
  saleGroupKey: 'sale',
  date: '08/27/2026',
  lines: [
    { rowNumber: 2, productId: 10, productName: 'Serum', branchId: 1, branchName: 'Shop', quantity: 2, sellingPriceUsd: 10 },
    { rowNumber: 3, productId: 10, productName: 'Serum', branchId: 1, branchName: 'Shop', quantity: 4, sellingPriceUsd: 11, costPriceUsd: 5 },
  ],
}

;(async () => {
  const { sqlite, db } = setup()
  const first = await subject.applyUnifiedStockSale(db, base)
  const retry = await subject.applyUnifiedStockSale(db, base)
  assert.strictEqual(first.alreadyApplied, false)
  assert.strictEqual(retry.alreadyApplied, true)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM sales`).get().n, 1, 'one header per sale group')
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM sale_items`).get().n, 2)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_movements`).get().n, 2)
  assert.strictEqual(sqlite.prepare(`SELECT SUM(quantity) AS n FROM inventory_movements`).get().n, -6)
  assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1`).get().quantity, 4)
  assert.strictEqual(sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 4)
  assert.deepStrictEqual(sqlite.prepare(`SELECT batch_id, quantity FROM branch_batch_stock ORDER BY batch_id`).all(), [
    { batch_id: 101, quantity: 1 }, { batch_id: 102, quantity: 0 }, { batch_id: 103, quantity: 3 },
  ], 'FIFO consumes earliest expiry first')
  assert.strictEqual(sqlite.prepare(`SELECT SUM(quantity) AS n FROM sale_item_batch_allocations`).get().n, 6)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_guards`).get().n, 0)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits WHERE status = 'applied'`).get().n, 1)

  const explicit = setup()
  await subject.applyUnifiedStockSale(explicit.db, {
    ...base, jobId: 'job-explicit', saleGroupKey: 'sale2',
    lines: [{ ...base.lines[0], quantity: 2, batchLabel: '  NO   EXPIRY ' }],
  })
  assert.strictEqual(explicit.sqlite.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id = 103`).get().quantity, 1,
    'an explicit normalized batch label wins over FIFO')
  assert.strictEqual(explicit.sqlite.prepare(`SELECT batch_id FROM sale_item_batch_allocations`).get().batch_id, 103)

  const reserved = setup()
  await subject.applyUnifiedStockSale(reserved.db, {
    ...base, jobId: 'job-reserved', saleGroupKey: 'sale3',
    lines: [
      { ...base.lines[0], quantity: 3 },
      { ...base.lines[1], quantity: 3, batchLabel: 'EARLY' },
    ],
  })
  assert.strictEqual(reserved.sqlite.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id = 102`).get().quantity, 0)
  assert.strictEqual(reserved.sqlite.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id = 101`).get().quantity, 1,
    'explicit choices reserve stock before unlabelled FIFO lines')

  const oversold = setup()
  oversold.sqlite.prepare(`UPDATE branch_stock SET quantity = 1`).run()
  await assert.rejects(() => subject.applyUnifiedStockSale(oversold.db, base), /guard_value|CHECK constraint/)
  assert.strictEqual(oversold.sqlite.prepare(`SELECT COUNT(*) AS n FROM sales`).get().n, 0)
  assert.strictEqual(oversold.sqlite.prepare(`SELECT COUNT(*) AS n FROM sale_items`).get().n, 0)
  assert.strictEqual(oversold.sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits`).get().n, 0)
  assert.strictEqual(oversold.sqlite.prepare(`SELECT quantity FROM branch_stock`).get().quantity, 1)

  const batchRace = setup()
  const normalBatch = batchRace.db.batch
  batchRace.db.batch = (statements) => {
    batchRace.sqlite.prepare(`UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = 102`).run()
    return normalBatch(statements)
  }
  await assert.rejects(() => subject.applyUnifiedStockSale(batchRace.db, base), /guard_value|CHECK constraint/)
  assert.strictEqual(batchRace.sqlite.prepare(`SELECT COUNT(*) AS n FROM sales`).get().n, 0,
    'a live batch-stock race fails the entire sale')
  assert.strictEqual(batchRace.sqlite.prepare(`SELECT quantity FROM branch_stock`).get().quantity, 10)

  const failed = setup()
  failed.sqlite.exec(`CREATE TRIGGER reject_sale_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT, 'forced sale movement failure'); END;`)
  await assert.rejects(() => subject.applyUnifiedStockSale(failed.db, base), /forced sale movement failure/)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM sales`).get().n, 0)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM sale_item_batch_allocations`).get().n, 0)
  assert.strictEqual(failed.sqlite.prepare(`SELECT quantity FROM branch_stock`).get().quantity, 10)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits`).get().n, 0)

  const bounded = setup()
  await assert.rejects(() => subject.applyUnifiedStockSale(bounded.db, {
    ...base,
    lines: Array.from({ length: 9 }, (_, index) => ({ ...base.lines[0], rowNumber: index + 2, quantity: 0.1 })),
  }), /8-line safety limit/)
  await assert.rejects(() => subject.applyUnifiedStockSale(bounded.db, { ...base, saleGroupKey: '', lines: base.lines }), /Sale group is required/)
  await assert.rejects(() => subject.applyUnifiedStockSale(bounded.db, { ...base, date: '13\/40\/2026' }), /Sale date is invalid/)

  console.log('PASS grouped stock sales are bounded, FIFO, transaction-asserted, rollback-safe, and retry-idempotent')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
