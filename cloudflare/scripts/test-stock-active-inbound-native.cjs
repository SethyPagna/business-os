const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const cache = new Map()
function load(file) {
  const resolved = path.resolve(__dirname, '../src/lib', file)
  if (cache.has(resolved)) return cache.get(resolved).exports
  const module = { exports: {} }
  cache.set(resolved, module)
  const output = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'module', 'require', output)(module.exports, module, request =>
    request.startsWith('.') ? load(path.relative(path.join(__dirname, '../src/lib'), path.resolve(path.dirname(resolved), `${request}.ts`))) : require(request))
  return module.exports
}

const transitions = load('saleTransitions.ts')
const batches = load('productBatches.ts')
const db = new Database(':memory:')
db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER,stock_quantity REAL);
  CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER,is_active INTEGER,updated_at TEXT);
  CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL,updated_at TEXT,UNIQUE(batch_id,branch_id));
  INSERT INTO products VALUES(1,0,0),(2,1,0);
  INSERT INTO product_batches VALUES(10,1,0,NULL),(20,2,0,NULL);`)
function run(statements) {
  return db.transaction(() => statements.forEach(statement => db.prepare(statement.sql).run(statement.params)))()
}
function transition(extra = {}) {
  return transitions.planSaleStockTransition({saleId:1,oldStatus:'completed',newStatus:'cancelled',
    items:[{id:1,product_id:1,product_name:'Inactive',branch_id:1,quantity:2}],
    returnedByItem:new Map(),reason:'cancel',userId:1,userName:'Staff',...extra})
}

const cancellation = transition()
assert.match(cancellation.statements[0].sql, /product_has_stock/, 'restoring cancellation must admit the product before effects')
assert.throws(() => run([cancellation.statements[0]]), /product_has_stock/)
const skipped = transition({skipStock:true})
assert.deepEqual(skipped.statements, [], 'stock-skipped historical cancellation has no admission or stock effect')
const neutral = transition({oldStatus:'awaiting_payment',newStatus:'completed'})
assert.deepEqual(neutral.statements, [], 'settling already-held stock remains neutral')
assert.throws(() => run(batches.restoreBatchStockStatements(10,1,2)), /product_has_stock/)
assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=10').get().is_active,0,'refusal precedes lot reactivation')
run(batches.restoreBatchStockStatements(20,1,2))
assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=20').get().quantity,2)
console.log('PASS inactive cancellation and lot restore refuse before effects; active restore and neutral/skip controls')
db.close()
