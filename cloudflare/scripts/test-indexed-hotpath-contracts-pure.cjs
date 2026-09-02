const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

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
assert.equal(
  (returnsRoute.match(/client_request_id = \? AND client_request_id <> '' LIMIT 1/g) || []).length,
  2,
  'both return idempotency doors must include the partial-index predicate',
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

  CREATE TABLE returns (id INTEGER PRIMARY KEY, client_request_id TEXT);
  CREATE UNIQUE INDEX idx_returns_client_request_unique_pg
    ON returns(client_request_id)
    WHERE client_request_id IS NOT NULL AND client_request_id <> '';

  CREATE TABLE products (id INTEGER PRIMARY KEY, client_request_id TEXT);
  CREATE UNIQUE INDEX idx_products_client_request_unique_pg
    ON products(client_request_id)
    WHERE client_request_id IS NOT NULL AND client_request_id <> '';
`)

function plan(sql, params = []) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join('\n')
}

assert.match(
  plan("SELECT id FROM sales WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1", ['sale:1']),
  /idx_sales_client_request_unique_pg/,
)
assert.match(
  plan("SELECT id FROM returns WHERE client_request_id = ? AND client_request_id <> '' LIMIT 1", ['return:1']),
  /idx_returns_client_request_unique_pg/,
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
console.log('PASS request-id, notification-status, and static-cache hot-path contracts')
