const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { openDb } = require('./harness/d1compat.cjs')
const directory = path.resolve(__dirname, '../migrations')
const name = '0187_return_export_revision.sql'
const sql = fs.readFileSync(path.join(directory, name), 'utf8')
assert.equal(sql.includes('\r'), false, 'trigger SQL is LF-only')
const tables = ['returns', 'return_items', 'return_replacement_items', 'customers', 'sales', 'products']
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT,total_refund_usd REAL,customer_id INTEGER);
  CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,product_name TEXT,stock_action TEXT);
  CREATE TABLE return_replacement_items(id INTEGER PRIMARY KEY,return_id INTEGER,product_name TEXT);
  CREATE TABLE customers(id INTEGER PRIMARY KEY,is_anonymous INTEGER);
  CREATE TABLE sales(id INTEGER PRIMARY KEY,receipt_number TEXT);
  CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT,barcode TEXT,brand TEXT,name_normalized TEXT,brand_compact TEXT);
  INSERT INTO returns VALUES(1,'completed',1.234567,1);
  INSERT INTO return_items VALUES(1,1,'historical','damaged');
  INSERT INTO return_replacement_items VALUES(1,1,'historical replacement');
  INSERT INTO customers VALUES(1,0);
  INSERT INTO sales VALUES(1,'historic receipt');
  INSERT INTO products VALUES(1,'sku','barcode','brand','normalized','compact');
  INSERT INTO system_flags(key,value) VALUES('business_dataset_generation','{"generation":"separate-owner"}');`)
const rows = () => tables.map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all())
const before = rows()
db.exec(sql)
assert.deepEqual(rows(), before, 'migration does not recalculate or rewrite historical business data')
const raw = () => db.prepare("SELECT value FROM system_flags WHERE key='returns_export_revision'").get()?.value
const revision = () => JSON.parse(raw()).revision
assert.equal(revision(), 0)
assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'return_export_revision_%'").get().n, 18)
const mutations = {
  returns: "UPDATE returns SET status='cancelled' WHERE id=2",
  return_items: "UPDATE return_items SET return_id=3,product_name='renamed',stock_action='damaged' WHERE id=2",
  return_replacement_items: "UPDATE return_replacement_items SET return_id=3,product_name='new replacement' WHERE id=2",
  customers: "UPDATE customers SET is_anonymous=1 WHERE id=2",
  sales: "UPDATE sales SET receipt_number='changed replacement receipt' WHERE id=2",
  products: "UPDATE products SET sku='new',barcode='new',brand='new',name_normalized='new',brand_compact='new' WHERE id=2",
}
let checks = 0
for (const mode of ['ordinary', 'restore']) {
  if (mode === 'restore') db.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\"}')")
  for (const table of tables) {
    for (const statement of ['INSERT INTO ' + table + '(id) VALUES(2)', mutations[table], 'DELETE FROM ' + table + ' WHERE id=2']) {
      const old = revision()
      db.exec(statement)
      assert.equal(revision(), old + 1, mode + ': ' + statement)
      checks++
    }
  }
}
assert.equal(db.prepare("SELECT value FROM system_flags WHERE key='business_dataset_generation'").get().value, '{"generation":"separate-owner"}')
const committed = raw()
db.exec('BEGIN; UPDATE customers SET is_anonymous=1 WHERE id=1;')
assert.notEqual(raw(), committed)
db.exec('ROLLBACK')
assert.equal(raw(), committed, 'rolled-back business write rolls back freshness too')
assert.throws(() => db.exec(sql), /already exists/)
assert.equal(raw(), committed, 'raw migration rerun never resets live revision')
const setFlag = value => db.prepare("UPDATE system_flags SET value=? WHERE key='returns_export_revision'").run(value)
setFlag('{"revision":9007199254740990}')
db.exec("UPDATE sales SET receipt_number='edge' WHERE id=1")
assert.equal(revision(), Number.MAX_SAFE_INTEGER, 'last safe integer remains exact')
db.exec("UPDATE sales SET receipt_number='overflow' WHERE id=1")
assert.equal(revision(), null, 'overflow poisons instead of wrapping or aliasing a prior revision')
for (const value of ['{"revision":null}', 'not json', '{}', '{"revision":-1}', '{"revision":1.5}', '{"revision":"1"}', '{"revision":true}', '{"revision":9007199254740992}', '[]']) {
  setFlag(value)
  db.exec('UPDATE customers SET is_anonymous=1 WHERE id=1')
  assert.equal(raw(), '{"revision":null}', 'invalid counter never silently resets: ' + value)
  db.exec('UPDATE customers SET is_anonymous=0 WHERE id=1')
  assert.equal(revision(), null, 'poison remains sticky')
}
db.exec("DELETE FROM system_flags WHERE key='returns_export_revision'; UPDATE customers SET is_anonymous=1 WHERE id=1;")
assert.equal(raw(), undefined, 'missing metadata is not lazily reseeded by writes')
assert.throws(() => db.exec(sql), /already exists/)
assert.equal(raw(), undefined, 'rerun does not reseed a missing flag either')
db.close()
// Apply to the real append-only chain as well, not just the targeted fixture.
const chain = openDb(fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < name).sort().map(file => fs.readFileSync(path.join(directory, file), 'utf8')))
chain.db.exec("INSERT INTO system_flags(key,value) VALUES('returns_export_revision','{\"revision\":42}')")
chain.db.exec(sql)
assert.equal(chain.db.prepare("SELECT value FROM system_flags WHERE key='returns_export_revision'").get().value, '{"revision":42}', 'first migration application also preserves existing counter state')
assert.throws(() => chain.db.exec(sql), /already exists/)
chain.db.close()
console.log('PASS 0187 native SQLite: ' + checks + ' ordinary/restore I/U/D transitions, historical precision unchanged, rollback, rerun, overflow/corruption/missing fail-closed metadata, complete migration chain')
