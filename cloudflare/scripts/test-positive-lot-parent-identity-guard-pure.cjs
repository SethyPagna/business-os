const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const dir = path.join(__dirname, '../migrations')
const file = '0155_positive_lot_parent_identity_guard.sql'
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const base = new Database(':memory:')
for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.sql') && f < file).sort()) base.exec(fs.readFileSync(path.join(dir, name), 'utf8'))
const schema = base.serialize()
base.close()
function fixture(migrate = true) {
  const db = new Database(schema)
  db.exec("INSERT INTO products(id,name) VALUES(900001,'Parent guard product'); INSERT INTO branches(id,name) VALUES(900001,'Shop'),(900002,'Warehouse')")
  db.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active,unit_cost_usd,received_quantity,received_cost_usd,notes)
    VALUES(900001,900001,'original-receipt','2026-09-03',1,17.5,12,210,'Original receipt metadata'),
          (900002,900001,'zero-stock-receipt','2026-09-04',0,19,5,95,'Historical receipt metadata');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,0),(900001,900002,0.25),(900002,900001,0)`)
  if (migrate) db.exec(sql)
  return db
}
const snapshot = db => ['product_batches', 'branch_batch_stock'].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all())
const orphanCount = db => db.prepare('SELECT COUNT(*) n FROM branch_batch_stock b LEFT JOIN product_batches p ON p.id=b.batch_id WHERE b.quantity>0 AND p.id IS NULL').get().n
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }

check('pre-0155 positive controls reproduce both parent orphan paths', () => {
  for (const statement of ['DELETE FROM product_batches WHERE id=900001', 'UPDATE product_batches SET id=900003 WHERE id=900001']) {
    const db = fixture(false)
    db.exec(statement)
    assert.equal(orphanCount(db), 1)
    db.close()
  }
})
check('migration is LF-only and applies to the complete fresh schema', () => {
  assert(!sql.includes('\r'))
  const db = new Database(schema)
  db.exec(sql)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE '%0155'").get().n, 4)
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  db.close()
})
check('migration changes no stored rows or existing 0154 triggers', () => {
  const db = fixture(false), before = snapshot(db)
  const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE '%0154' ORDER BY name").all()
  db.exec(sql)
  assert.deepEqual(snapshot(db), before)
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE '%0154' ORDER BY name").all(), triggers)
  db.close()
})
check('positive stock in any branch rejects parent deletion and preserves complete rows', () => {
  const db = fixture(), before = snapshot(db)
  assert.throws(() => db.exec('DELETE FROM product_batches WHERE id=900001'), /Cannot delete a received lot/)
  assert.deepEqual(snapshot(db), before)
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('positive stock rejects ID changes and preserves dates, costs and stock identity', () => {
  const db = fixture(), before = snapshot(db)
  assert.throws(() => db.exec('UPDATE product_batches SET id=900003 WHERE id=900001'), /Cannot change the identity/)
  assert.deepEqual(snapshot(db), before)
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('an unchanged ID assignment and ordinary metadata update remain permitted', () => {
  const db = fixture()
  db.exec("UPDATE product_batches SET id=id, notes='Corrected note' WHERE id=900001")
  assert.equal(db.prepare('SELECT notes FROM product_batches WHERE id=900001').get().notes, 'Corrected note')
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('SQLite rowid alias cannot bypass stocked parent identity protection', () => {
  const db = fixture(), before = snapshot(db)
  assert.throws(() => db.exec('UPDATE product_batches SET rowid=900003 WHERE id=900001'), /Cannot orphan positive branch stock|Cannot change the identity/)
  assert.deepEqual(snapshot(db), before)
  db.close()
})
check('zero-stock historical parent ID change and deletion remain permitted', () => {
  const db = fixture()
  db.exec('UPDATE product_batches SET id=900003 WHERE id=900002')
  assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=900003').get().is_active, 0)
  db.exec('DELETE FROM product_batches WHERE id=900003')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE id=900003').get().n, 0)
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('clearing every branch permits parent deletion within the same transaction', () => {
  const db = fixture()
  db.transaction(() => {
    db.exec('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=900001')
    db.exec('DELETE FROM product_batches WHERE id=900001')
  })()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE id=900001').get().n, 0)
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('failure rolls back earlier metadata and branch changes in the same transaction', () => {
  const db = fixture(), before = snapshot(db)
  assert.throws(() => db.transaction(() => {
    db.exec("UPDATE product_batches SET notes='Intermediate' WHERE id=900001")
    db.exec('UPDATE branch_batch_stock SET quantity=1 WHERE batch_id=900001 AND branch_id=900001')
    db.exec('DELETE FROM product_batches WHERE id=900001')
  })(), /Cannot delete a received lot/)
  assert.deepEqual(snapshot(db), before)
  db.close()
})
check('multi-row deletion aborts the whole statement when a stocked parent is encountered', () => {
  const db = fixture(), before = snapshot(db)
  assert.throws(() => db.exec('DELETE FROM product_batches WHERE id IN(900001,900002)'), /Cannot delete a received lot/)
  assert.deepEqual(snapshot(db), before)
  db.close()
})
check('pre-0155 REPLACE positive controls reproduce orphaning with default recursive triggers', () => {
  for (const statement of [
    "INSERT OR REPLACE INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(900003,900001,'original-receipt',1)",
    "UPDATE OR REPLACE product_batches SET batch_key='original-receipt' WHERE id=900002",
  ]) {
    const db = fixture(false)
    assert.equal(db.pragma('recursive_triggers', { simple: true }), 0)
    db.exec(statement)
    assert.equal(orphanCount(db), 1)
    db.close()
  }
})
check('INSERT OR REPLACE cannot silently remove another stocked parent on a unique-key collision', () => {
  for (const statement of [
    "INSERT OR REPLACE INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(900003,900001,'original-receipt',1)",
    "INSERT OR REPLACE INTO product_batches(variant_product_id,batch_key,is_active) VALUES(900001,'original-receipt',1)",
  ]) {
    const db = fixture(), before = snapshot(db)
    assert.equal(db.pragma('recursive_triggers', { simple: true }), 0)
    assert.throws(() => db.exec(statement), /Cannot orphan positive branch stock/)
    assert.deepEqual(snapshot(db), before)
    assert.equal(orphanCount(db), 0)
    db.close()
  }
})
check('UPDATE OR REPLACE cannot strand another stocked parent on a unique-key collision', () => {
  const db = fixture(), before = snapshot(db)
  assert.equal(db.pragma('recursive_triggers', { simple: true }), 0)
  assert.throws(() => db.exec("UPDATE OR REPLACE product_batches SET batch_key='original-receipt',is_active=1 WHERE id=900002"), /Cannot orphan positive branch stock/)
  assert.deepEqual(snapshot(db), before)
  db.close()
})
check('replacing a zero-stock historical parent remains allowed', () => {
  const db = fixture()
  db.exec("INSERT OR REPLACE INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(900003,900001,'zero-stock-receipt',0)")
  assert.equal(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE id=900002').get().n, 0)
  assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=900003').get().is_active, 0)
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('normal keyed UPSERT and INSERT OR IGNORE preserve an existing stocked parent', () => {
  const db = fixture()
  db.exec("INSERT INTO product_batches(variant_product_id,batch_key,is_active,notes) VALUES(900001,'original-receipt',1,'Upserted note') ON CONFLICT(variant_product_id,batch_key) DO UPDATE SET notes=excluded.notes")
  assert.equal(db.prepare('SELECT notes FROM product_batches WHERE id=900001').get().notes, 'Upserted note')
  db.exec("INSERT OR IGNORE INTO product_batches(variant_product_id,batch_key,is_active) VALUES(900001,'original-receipt',1)")
  assert.equal(orphanCount(db), 0)
  db.close()
})
check('postcheck uses the positive-stock partial index and parent primary key lookup', () => {
  const db = fixture()
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM branch_batch_stock bbs INDEXED BY idx_branch_batch_stock_positive_batch_0155 WHERE bbs.quantity>0 AND NOT EXISTS (SELECT 1 FROM product_batches WHERE id=bbs.batch_id)').all().map(r => r.detail).join('\n')
  assert.match(plan, /idx_branch_batch_stock_positive_batch_0155/)
  assert.match(plan, /INTEGER PRIMARY KEY/)
  db.close()
})
console.log(`${passed} positive-lot parent identity checks passed`)
