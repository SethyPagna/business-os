const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/returnExportWindow.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const loaded = { exports: {} }
new Function('exports', 'module', compiled)(loaded.exports, loaded)
const { returnExportWindow } = loaded.exports
const { returnsStatementParams } = require('../../frontend/src/utils/returnsExportWindow.ts')

const vectors = [
  { startDate: '2024-01-01', endDate: '2024-12-31' },
  { startDate: '2025-01-01', endDate: '2025-12-31' },
  { startDate: '2024-02-29', endDate: '2025-02-27' },
  { startDate: '2026-09-20', endDate: '2026-09-20', startTime: '23:59', endTime: '23:59' },
  { startDate: '2026-09-20', endDate: '2027-09-20', startTime: '08:00', endTime: '07:59' },
  { startDate: '2023-12-01', endDate: '2024-02-29' },
]
for (const range of vectors) {
  const query = returnsStatementParams(range)
  assert.deepEqual(returnExportWindow(query), { createdFrom: query.createdFrom, createdTo: query.createdTo })
  if (!range.startTime) assert.deepEqual(returnExportWindow(range), returnExportWindow(query), 'full-day and exact front/backend intervals agree')
}
const day = { startDate: '2026-09-20', endDate: '2026-09-20' }
assert.deepEqual(returnExportWindow({ ...day, createdFrom: '2026-09-20T00:00:00+07:00', createdTo: '2026-09-20T00:01:00+07:00' }), {
  createdFrom: '2026-09-19 17:00:00', createdTo: '2026-09-19 17:01:00',
})
for (const invalid of [
  {}, { startDate: day.startDate }, { endDate: day.endDate },
  { ...day, startDate: '2026-02-29' }, { ...day, endDate: '2026-02-30' },
  { ...day, endDate: '2026-09-19' },
  { startDate: '2024-01-01', endDate: '2025-01-01' },
  { startDate: '2024-02-29', endDate: '2025-02-28' },
  { ...day, createdFrom: '2026-09-19 17:00:00' },
  { ...day, createdTo: '2026-09-19 17:01:00' },
  { ...day, createdFrom: '2026-09-19 17:00:00', createdTo: '2026-09-19 17:00:00' },
  { ...day, createdFrom: '2026-09-19 17:01:00', createdTo: '2026-09-19 17:00:00' },
  { ...day, createdFrom: '2026-09-19 17:00:01', createdTo: '2026-09-19 17:01:00' },
  { ...day, createdFrom: '2026-09-19T17:00:00+99:00', createdTo: '2026-09-19 17:01:00' },
  { ...day, createdFrom: '2025-09-19 17:00:00', createdTo: '2026-09-19 17:01:00' },
  { ...day, startTime: '08:00' },
]) assert.throws(() => returnExportWindow(invalid), RangeError, JSON.stringify(invalid))

const raw = new DatabaseSync(':memory:')
raw.exec(`CREATE TABLE returns(id INTEGER PRIMARY KEY,created_at TEXT,status TEXT,customer_id INTEGER);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,product_name TEXT);
 CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT);
 CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER);
 CREATE TABLE sales(id INTEGER PRIMARY KEY,receipt_number TEXT);
 CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE return_write_revisions(return_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);
 CREATE TABLE sale_write_revisions(sale_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);
 CREATE TABLE stock_session_revisions(entity_type TEXT,entity_key TEXT,revision INTEGER NOT NULL,PRIMARY KEY(entity_type,entity_key));`)
function installTriggers(file, prefix) {
  const sql = fs.readFileSync(path.join(root, 'migrations', file), 'utf8')
  const blocks = sql.match(/CREATE TRIGGER[\s\S]*?\bEND;/g) || []
  const matching = blocks.filter(block => block.startsWith(`CREATE TRIGGER ${prefix}`))
  assert.equal(matching.length, 3)
  matching.forEach(block => raw.exec(block))
}
installTriggers('0125_return_bulk_actions.sql', 'return_revision_returns_')
installTriggers('0125_return_bulk_actions.sql', 'return_revision_items_')
installTriggers('0124_stock_session_operations.sql', 'stock_revision_products_')
installTriggers('0120_sale_bulk_status_actions.sql', 'sale_revision_sales_')
raw.exec(`INSERT INTO customers VALUES(1,0); INSERT INTO products VALUES(1,'before');
 INSERT INTO sales VALUES(1,'receipt');
 INSERT INTO returns VALUES(1,'2026-09-19 17:00:00','completed',1);
 INSERT INTO return_items VALUES(1,1,'before');`)
const revisions = () => JSON.stringify({
  returns: raw.prepare('SELECT * FROM return_write_revisions ORDER BY return_id').all(),
  products: raw.prepare('SELECT * FROM stock_session_revisions ORDER BY entity_type,entity_key').all(),
  sales: raw.prepare('SELECT * FROM sale_write_revisions ORDER BY sale_id').all(),
})
for (const sql of ["UPDATE returns SET status='cancelled' WHERE id=1", "UPDATE return_items SET product_name='after' WHERE id=1", "UPDATE products SET sku='after' WHERE id=1", "UPDATE sales SET receipt_number='after' WHERE id=1"]) {
  const before = revisions(); raw.exec(sql); assert.notEqual(revisions(), before, sql)
}
const beforeCustomer = revisions()
raw.exec('UPDATE customers SET is_anonymous=1 WHERE id=1')
assert.equal(revisions(), beforeCustomer, 'PROVEN GAP: live export customer marker changes without any existing return/product/sale revision')
assert.equal(raw.prepare('SELECT EXISTS(SELECT 1 FROM customers c WHERE c.id=r.customer_id AND c.is_anonymous=1) AS marker FROM returns r').get().marker, 1)
raw.exec(`INSERT INTO system_flags VALUES('maintenance','{"mode":"restore"}')`)
const beforeRestore = revisions()
raw.exec("UPDATE returns SET status='completed' WHERE id=1; UPDATE products SET sku='restored' WHERE id=1")
assert.equal(revisions(), beforeRestore, 'PROVEN GAP: restore explicitly suppresses these revision triggers')

raw.exec("DELETE FROM returns; INSERT INTO returns VALUES(2,'2026-09-19T17:00:00Z','completed',1),(3,'2026-09-20 16:59:59','completed',1),(4,'2026-09-20T17:00:00Z','completed',1)")
const bounds = returnExportWindow(day)
assert.deepEqual(raw.prepare('SELECT id FROM returns WHERE datetime(created_at)>=@createdFrom AND datetime(created_at)<@createdTo ORDER BY id').all(bounds).map(row => row.id), [2, 3])
const next = returnExportWindow({ startDate: '2026-09-21', endDate: '2026-09-21' })
assert.deepEqual(raw.prepare('SELECT id FROM returns WHERE datetime(created_at)>=@createdFrom AND datetime(created_at)<@createdTo ORDER BY id').all(next).map(row => row.id), [4], 'adjacent statements have no duplicate or missing boundary')
raw.close()
console.log('PASS export window parity/native SQLite boundaries; existing revision guards cover return/items/products/sales but expose customer/restore gaps. Endpoint intentionally NOT wired.')
