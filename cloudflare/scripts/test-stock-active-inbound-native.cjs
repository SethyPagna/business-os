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

async function routeControls() {
  const fixturePath = path.join(__dirname, 'test-sale-bulk-status-pure.cjs')
  const source = fs.readFileSync(fixturePath, 'utf8')
  const end = source.indexOf('async function run() {')
  assert.ok(end > 0)
  const { fixture, seed, sales, snapshot } = new Function('require', '__dirname',
    source.slice(0, end) + '\nreturn { fixture, seed, sales, snapshot }')(require, __dirname)
  const f = fixture()
  seed(f, 1)
  f.sql.exec('UPDATE branch_stock SET quantity=0 WHERE product_id=1; UPDATE products SET stock_quantity=0 WHERE id=1; UPDATE products SET is_active=0 WHERE id=1')
  const before = snapshot(f)
  const refusal = await f.call(sales, '/1/status', {sale_status:'cancelled',cancel_reason:'mistake',expected_updated_at:'same-second',client_request_id:'inactive-cancel'}, 'PATCH')
  assert.equal(refusal.status,409,JSON.stringify(refusal.body))
  assert.equal(refusal.body.code,'product_has_stock')
  assert.equal(snapshot(f),before,'refused cancellation preserves stock, money, audit and operation state')
  f.sql.close()

  const { fixture: sessionFixture, loadStockSession, user, receiveRequest, receiptState } = require('./test-stock-session-atomic.cjs')
  const sessions = loadStockSession()
  const g = sessionFixture()
  g.sql.exec('UPDATE products SET is_active=0 WHERE id=1')
  const initial = receiptState(g.sql)
  await assert.rejects(sessions.commitStockSession(g.env,user,receiveRequest('inactive-receipt')),error => error.code==='product_has_stock' && error.status===409)
  assert.deepEqual(receiptState(g.sql),initial)
  g.sql.exec('UPDATE products SET is_active=1 WHERE id=1')
  const request = receiveRequest('replay-after-deactivation')
  const receipt = await sessions.commitStockSession(g.env,user,request)
  g.sql.exec('UPDATE branch_batch_stock SET quantity=0; UPDATE branch_stock SET quantity=0; UPDATE products SET stock_quantity=0 WHERE id=1; UPDATE products SET is_active=0 WHERE id=1')
  const depleted = receiptState(g.sql)
  const replay = await sessions.commitStockSession(g.env,user,request)
  assert.equal(replay.replayed,true)
  assert.equal(replay.operationId,receipt.operationId)
  assert.deepEqual(receiptState(g.sql),depleted,'successful receipt replay has no new admission or effects')
  g.sql.close()
  console.log('PASS real cancellation route exact409/no effects; inactive receipt refuses and successful replay survives depletion/deactivation')
}
routeControls().catch(error => { console.error(error); process.exitCode = 1 })
