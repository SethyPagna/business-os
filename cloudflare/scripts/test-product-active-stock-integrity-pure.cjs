const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
function compile(source) { return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText }
const guard = {}
new Function('exports', compile(fs.readFileSync(path.join(__dirname, '../src/lib/productStockGuard.ts'), 'utf8')))(guard)
const database = new Database(':memory:')
database.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,is_active INTEGER,stock_quantity REAL,updated_at TEXT);
  CREATE TABLE branch_stock(product_id INTEGER,branch_id INTEGER,quantity REAL);
  CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER);
  CREATE TABLE branch_batch_stock(batch_id INTEGER,quantity REAL);
  CREATE TABLE damaged_stock_lots(product_id INTEGER,quantity_remaining REAL);`)
const adapter = {
  prepare(sql) { const statement = database.prepare(sql); return { all: async params => statement.all(params ?? {}), get: async params => statement.get(params ?? {}) } },
  batch: async statements => database.transaction(() => statements.map(({sql,params}) => {
    const statement = database.prepare(sql)
    return statement[statement.reader ? 'all' : 'run'](params ?? {})
  }))(),
}
const exported = {}
new Function('require', 'exports', compile(fs.readFileSync(path.join(__dirname, '../src/lib/dataIntegrity.ts'), 'utf8') + '\nexport { checkStockQuantities }'))(
  name => name === './db' ? { getDb: () => adapter } : name === './productStockGuard' ? guard : (() => { throw Error(name) })(), exported,
)
function seed(active, quantity) {
  database.exec(`DELETE FROM products; DELETE FROM branch_stock;
    INSERT INTO products VALUES(1,${active},0,NULL),(2,1,-1,NULL);
    INSERT INTO branch_stock VALUES(1,1,${quantity}),(2,1,-1);`)
}
function snapshot() { return JSON.stringify([database.prepare('SELECT * FROM products').all(),database.prepare('SELECT * FROM branch_stock').all()]) }
async function main() {
  seed(0, 5)
  const before = snapshot()
  await assert.rejects(exported.checkStockQuantities({}, true), error => error.code === 'product_has_stock')
  assert.equal(snapshot(), before, 'refusal must precede even unrelated negative-stock repair')
  const report = await exported.checkStockQuantities({}, false)
  assert.ok(report.errors.length)
  assert.equal(snapshot(), before, 'diagnostic mode stays read-only')
  for (const [active, quantity] of [[1,5],[0,0]]) {
    seed(active, quantity)
    await exported.checkStockQuantities({}, true)
    assert.equal(database.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, quantity)
  }
  const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/system.ts'), 'utf8')
  const ast = ts.createSourceFile('system.ts', routeSource, ts.ScriptTarget.Latest, true)
  const call = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.arguments[0]?.text === '/repair-integrity').expression
  const callback = call.arguments[1].getText(ast)
  const route = new Function('hasPermission','runDataIntegrityCheck','productStockGuardError', `return ${compile(`const handler = ${callback}`).replace('const handler = ', '').replace(/;\s*$/, '')}`)(
    () => true, () => { throw new guard.ProductStockGuardError() }, guard.productStockGuardError,
  )
  const response = await route({ get: () => ({}), env: {}, json: (body,status=200) => ({body,status}) })
  assert.equal(response.status,409)
  assert.equal(response.body.code,'product_has_stock')
  database.close()
  console.log('PASS integrity repair refuses inactive inbound cache correction before writes; active/zero controls and route409')
}
main().catch(error => { console.error(error); process.exitCode=1 })
