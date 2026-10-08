const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const guard = {}
const source = fs.readFileSync(path.join(__dirname, '../src/lib/productStockGuard.ts'), 'utf8')
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(guard)

for (const value of [0, false, '0', 'false', '', 2]) {
  assert.throws(() => guard.assertProductStatusInput({ is_active: value }), error => error.code === 'product_status_unsupported' && error.status === 409)
}
for (const body of [{}, { is_active: null }, { is_active: 1 }, { is_active: true }, { is_active: '1' }]) {
  guard.assertProductStatusInput(body)
}
const db = new Database(':memory:')
db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER,stock_quantity REAL);
  INSERT INTO products VALUES(1,1,0),(2,0,0),(3,0,5);`)
assert.deepEqual(db.prepare(`SELECT id FROM products p WHERE ${guard.catalogProductSql()} ORDER BY id`).all(), [{ id: 1 }])
assert.deepEqual(db.prepare(`SELECT id FROM products p WHERE ${guard.catalogProductSql('p', false)} ORDER BY id`).all(), [{ id: 1 }])
assert.throws(() => guard.catalogProductSql('p;DELETE'), /Invalid/)
const refusal = new guard.ProductStatusUnsupportedError()
assert.equal(guard.productStockGuardError(refusal), refusal)
assert.equal(guard.productStockGuardError(new Error('D1_ERROR', { cause: new Error('product_status_unsupported') })).code, 'product_status_unsupported')
assert.equal(guard.productStockGuardError(new Error('product has immutable transfer provenance')), null)
assert.doesNotMatch(guard.PRODUCT_HAS_STOCK_MESSAGE, /activat|inactive|stay active/i)
db.close()
console.log('PASS product catalog membership, removed stock exclusion, legacy status input and localized refusal contract')
