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
      selling_price_usd REAL DEFAULT 0, special_price_usd REAL DEFAULT 0, cost_price_usd REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      UNIQUE(product_id, branch_id));
    CREATE TABLE product_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, variant_product_id INTEGER,
      batch_key TEXT, lot_code TEXT, received_at TEXT, is_active INTEGER, notes TEXT, batch_number INTEGER,
      UNIQUE(variant_product_id, batch_key), UNIQUE(variant_product_id, batch_number));
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0,
      updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER,
      product_name TEXT, branch_id INTEGER, branch_name TEXT, movement_type TEXT, quantity REAL,
      reason TEXT, created_at TEXT);
  `)
  sqlite.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0056_import_stock_action_commits.sql'), 'utf8'))
  sqlite.prepare(`INSERT INTO products(id, name) VALUES (10, 'Serum')`).run()
  sqlite.prepare(`INSERT INTO branches(id, name) VALUES (1, 'Shop')`).run()

  const db = {
    prepare(sql) {
      return {
        get(params) { return Promise.resolve(sqlite.prepare(sql).get(params)) },
        run(params) { const info = sqlite.prepare(sql).run(params); return Promise.resolve({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }) },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params)))
      return Promise.resolve(run())
    },
  }
  return { sqlite, db }
}

const input = {
  jobId: 'job-1', rowNumber: 2, productId: 10, productName: 'Serum',
  branchId: 1, branchName: 'Shop', quantity: 2, date: '08/27/2026',
  batchLabel: 'LOT A', sellingPriceUsd: 12.345, vipPriceUsd: 10, costPriceUsd: 5,
}

;(async () => {
  const { sqlite, db } = setup()
  const first = await subject.applyUnifiedStockAdd(db, input)
  const retry = await subject.applyUnifiedStockAdd(db, input)
  assert.strictEqual(first.alreadyApplied, false)
  assert.strictEqual(retry.alreadyApplied, true)
  assert.deepStrictEqual(sqlite.prepare(`SELECT stock_quantity, selling_price_usd, special_price_usd, cost_price_usd FROM products WHERE id = 10`).get(), {
    stock_quantity: 2, selling_price_usd: 12.35, special_price_usd: 10, cost_price_usd: 5,
  })
  assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_stock`).get().quantity, 2)
  assert.strictEqual(sqlite.prepare(`SELECT quantity FROM branch_batch_stock`).get().quantity, 2)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get().n, 1)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_movements`).get().n, 1)
  assert.strictEqual(sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits WHERE status = 'applied'`).get().n, 1)

  await assert.rejects(() => subject.applyUnifiedStockAdd(db, { ...input, rowNumber: 3, quantity: -1 }), /greater than 0/)

  const failed = setup()
  failed.sqlite.exec(`CREATE TRIGGER reject_movement BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT, 'forced movement failure'); END;`)
  await assert.rejects(() => subject.applyUnifiedStockAdd(failed.db, input), /forced movement failure/)
  assert.strictEqual(failed.sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get().stock_quantity, 0)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM product_batches`).get().n, 0)
  assert.strictEqual(failed.sqlite.prepare(`SELECT COUNT(*) AS n FROM import_stock_action_commits`).get().n, 0)
  console.log('PASS unified stock add commits batch/branch/product/movement/ledger atomically and is retry-idempotent')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
