const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const source = fs.readFileSync(path.join(__dirname, '../src/lib/productStockGuard.ts'), 'utf8')
const moduleExports = {}
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(moduleExports)
const guard = moduleExports
const db = new Database(':memory:')
db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER,stock_quantity REAL);
  CREATE TABLE branch_stock(product_id INTEGER,quantity REAL);
  CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER);
  CREATE TABLE branch_batch_stock(batch_id INTEGER,quantity REAL);
  CREATE TABLE damaged_stock_lots(product_id INTEGER,quantity_remaining REAL);
  INSERT INTO products VALUES(1,1,2),(2,1,0),(3,1,0),(4,1,0),(5,1,0),(6,0,0),(7,1,0);
  INSERT INTO branch_stock VALUES(2,3),(7,-2),(7,2);
  INSERT INTO product_batches VALUES(10,3);
  INSERT INTO branch_batch_stock VALUES(10,4);
  INSERT INTO damaged_stock_lots VALUES(4,5);`)
const adapter = { prepare(sql) { const statement = db.prepare(sql); return { all: async params => statement.all(params), get: async params => statement.get(params) } } }
async function main() {
  assert.deepEqual(await guard.stockedProductIds(adapter, [1,2,3,4,5,6,7,1]), [1,2,3,4,7])
  await assert.rejects(guard.assertProductsHaveNoStock(adapter, [4]), error => error.code === 'product_has_stock' && error.status === 409)
  await guard.assertProductsHaveNoStock(adapter, [5,6])
  await assert.rejects(guard.assertProductsActive(adapter, [6]), error => error.code === 'product_has_stock')
  await guard.assertProductsActive(adapter, [5])
  const statement = guard.productStockGuardStatement([2])
  assert.throws(() => db.prepare(statement.sql).get(statement.params), /product_has_stock/)
  const zero = guard.productStockGuardStatement([5])
  db.prepare(zero.sql).get(zero.params)
  const inactive = guard.productStockGuardStatement([6], 'active')
  assert.throws(() => db.prepare(inactive.sql).get(inactive.params), /product_has_stock/)
  assert.equal(guard.productStockGuardError(new Error('product has immutable transfer provenance')), null)
  assert.equal(guard.productStockGuardError(new Error('CHECK constraint failed: quantity >= 0')), null)
  assert.equal(guard.productStockGuardError(new Error('D1_ERROR', { cause: new Error('product_has_stock: SQLITE_CONSTRAINT') })).status, 409)
  const cyclic = new Error('unknown'); cyclic.cause = cyclic
  assert.equal(guard.productStockGuardError(cyclic), null)
  assert.throws(() => guard.productHasStockSql('p; DROP TABLE products'), /Invalid/)
  console.log('PASS four independent ledgers, zero/inactive controls, atomic guard SQL and narrow error mapping')
  db.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
