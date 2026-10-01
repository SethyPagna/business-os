const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const projectRoot = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), 'utf8')

const salesRoute = read('cloudflare', 'src', 'routes', 'sales.ts')
const returnsRoute = read('cloudflare', 'src', 'routes', 'returns.ts')
const salesImportCommit = read('cloudflare', 'src', 'lib', 'salesImportCommit.ts')
const stockActionCommit = read('cloudflare', 'src', 'lib', 'stockActionCommit.ts')
const notifications = read('cloudflare', 'src', 'routes', 'notifications.ts')
const staticHeaders = read('frontend', 'public', '_headers')

assert.match(
  salesRoute,
  /client_request_id = \? AND client_request_id <> '' LIMIT 1/,
  'sale idempotency lookup must include the predicate of its partial unique index',
)
const returnsAst = ts.createSourceFile('returns.ts', returnsRoute, ts.ScriptTarget.Latest, true)
const returnRequestQueries = []
let supplierReturnIdQuery
function collectReturnRequestQueries(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'prepare' && node.arguments.length === 1
    && ts.isStringLiteralLike(node.arguments[0])
    && /^SELECT\s+id\s+FROM\s+returns\s+WHERE\s+client_request_id\s*=/i.test(node.arguments[0].text)) {
    returnRequestQueries.push(node.arguments[0].text)
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(returnsAst) === 'returnIdExpression'
    && node.initializer && ts.isStringLiteralLike(node.initializer)) {
    supplierReturnIdQuery = node.initializer.text.slice(1, -1)
  }
  ts.forEachChild(node, collectReturnRequestQueries)
}
collectReturnRequestQueries(returnsAst)
assert.equal(returnRequestQueries.length, 4, 'customer and supplier occupied, committed and catch queries must be checked')
assert.ok(supplierReturnIdQuery, 'the atomic supplier children must resolve the actual return header query')
assert.match(
  returnsRoute,
  /FROM return_create_receipts WHERE actor_id=\? AND request_id=\? LIMIT 1/,
  'customer return replay must use the actor-scoped immutable receipt lookup',
)
assert.match(
  salesImportCommit,
  /client_request_id = @client_request_id AND client_request_id <> ''/,
  'historical sale line linkage must use the sales request-id index',
)
assert.equal(
  (stockActionCommit.match(/client_request_id = @clientRequestId AND client_request_id <> ''/g) || []).length,
  5,
  'stock-action product/sale request-id lookups must all use their partial indexes',
)

assert.doesNotMatch(
  notifications,
  /COALESCE\(sale_status, 'completed'\) = 'awaiting_(?:payment|delivery)'/,
  'notification status equality must not wrap the indexed sale_status column',
)
assert.match(notifications, /WHERE sale_status = 'awaiting_payment'/)
assert.match(notifications, /WHERE sale_status = 'awaiting_delivery'/)

assert.match(staticHeaders, /\/assets\/\*[\s\S]*max-age=31536000, immutable/)
assert.match(staticHeaders, /\/index\.html[\s\S]*max-age=0, must-revalidate/)
assert.match(staticHeaders, /^\/[\r\n]+\s+Cache-Control: public, max-age=0, must-revalidate/m)

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    client_request_id TEXT,
    sale_status TEXT,
    created_at TEXT
  );
  CREATE UNIQUE INDEX idx_sales_client_request_unique_pg
    ON sales(client_request_id)
    WHERE client_request_id IS NOT NULL AND client_request_id <> '';
  CREATE INDEX idx_sales_status_created_pg
    ON sales(sale_status, created_at DESC, id DESC);

  CREATE TABLE return_create_receipts (
    id TEXT PRIMARY KEY,
    actor_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    UNIQUE(actor_id, request_id)
  );

  CREATE TABLE products (id INTEGER PRIMARY KEY, client_request_id TEXT);
  CREATE UNIQUE INDEX idx_products_client_request_unique_pg
    ON products(client_request_id)
    WHERE client_request_id IS NOT NULL AND client_request_id <> '';
`)
const returnsDb = openDb(loadAll()).db
assert.equal(returnsDb.limits.exprDepth, 100)
returnsDb.prepare("INSERT INTO returns(id,return_number,client_request_id) VALUES(1,'R1','return:ខ្មែរ'),(2,'R2',''),(3,'R3',''),(4,'R4',NULL)").run()

function plan(sql, params = []) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join('\n')
}

assert.match(
  plan("SELECT id FROM sales WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1", ['sale:1']),
  /idx_sales_client_request_unique_pg/,
)
function returnQueryParams(sql, key) {
  return sql.includes('@supplier_write_key') ? { supplier_write_key: key } : key
}
function assertReturnRequestIndex(sql) {
  const queryPlan = returnsDb.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(returnQueryParams(sql, 'return:ខ្មែរ')).map(row => row.detail).join('\n')
  assert.match(queryPlan, /SEARCH returns USING (?:COVERING )?INDEX idx_returns_client_request_unique_pg/, sql)
  assert.doesNotMatch(queryPlan, /SCAN returns/, sql)
  assert.match(sql, /\bclient_request_id\s*<>\s*''/, 'each actual lookup must state its partial-index predicate')
  for (const key of ['return:ខ្មែរ', 'missing', '', null]) {
    assert.deepEqual(returnsDb.prepare(sql).all(returnQueryParams(sql, key)).map(row => ({ id: row.id })), key === 'return:ខ្មែរ' ? [{ id: 1 }] : [])
  }
}
for (const sql of [...returnRequestQueries, supplierReturnIdQuery]) {
  assertReturnRequestIndex(sql)
  const wrongPredicate = sql.replace(/\s+AND\s+client_request_id\s*<>\s*''/i, '')
  assert.notEqual(wrongPredicate, sql, 'the wrong-predicate control must actually change the query')
  assert.throws(() => assertReturnRequestIndex(wrongPredicate), error => error.code === 'ERR_ASSERTION' && /SCAN returns/.test(error.actual))
}
assert.match(
  plan('SELECT id FROM return_create_receipts WHERE actor_id=? AND request_id=? LIMIT 1', [7, 'return:1']),
  /sqlite_autoindex_return_create_receipts/,
)
assert.match(
  plan("SELECT id FROM products WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1", ['product:1']),
  /idx_products_client_request_unique_pg/,
)
assert.match(
  plan("SELECT id FROM sales WHERE sale_status = 'awaiting_delivery' ORDER BY created_at DESC LIMIT 25"),
  /idx_sales_status_created_pg/,
)

db.close()
returnsDb.close()
console.log('PASS request-id, notification-status, and static-cache hot-path contracts')
