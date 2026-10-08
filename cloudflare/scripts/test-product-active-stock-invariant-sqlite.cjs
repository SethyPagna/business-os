const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0242_product_active_stock_invariant.sql'
const migrationPath = path.join(directory, migration)
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : ''
const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()) {
  base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
}
const schema = base.serialize()
base.close()
const refusal = /product_has_stock/
let passed = 0
function check(name, run) { run(); passed++; console.log(`PASS ${name}`) }
function fixture(apply = true) {
  const db = new Database(schema)
  db.exec(`INSERT INTO products(id,name,is_active,stock_quantity) VALUES(900001,'Active',1,0),(900002,'Inactive',0,0);
    INSERT INTO branches(id,name,is_active) VALUES(900001,'Active branch',1),(900002,'Retired branch',0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_at)
    VALUES(900001,900001,'active-lot',1,'2026-10-01'),(900002,900002,'inactive-product-lot',1,'2026-10-01');`)
  if (apply) db.exec(sql)
  return db
}
const seeders = {
  cache: db => db.exec('UPDATE products SET stock_quantity=1 WHERE id=900001'),
  branch: db => db.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,900002,1)'),
  lot: db => db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900002,1)'),
  damaged: db => db.exec('INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining) VALUES(900001,900002,1,1)'),
}
function snapshot(db) {
  return ['products', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'product_batches', 'inventory_movements']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
}

for (const [ledger, seed] of Object.entries(seeders)) {
  check(`${ledger}-only stock refuses deactivation, simultaneous cache zeroing and deletion without effects`, () => {
    const db = fixture()
    seed(db)
    const before = snapshot(db)
    assert.throws(() => db.exec('UPDATE products SET is_active=0 WHERE id=900001'), refusal)
    assert.throws(() => db.exec('UPDATE products SET is_active=0,stock_quantity=0 WHERE id=900001'), refusal)
    assert.throws(() => db.exec('DELETE FROM products WHERE id=900001'), refusal)
    assert.deepEqual(snapshot(db), before)
    db.close()
  })
}
check('zero-stock deactivation and zero children remain allowed', () => {
  const db = fixture()
  db.exec(`UPDATE products SET is_active=0 WHERE id=900001;
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,900001,0);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,0);
    INSERT INTO damaged_stock_lots(product_id,quantity_remaining) VALUES(900001,0);`)
  assert.equal(db.prepare('SELECT is_active FROM products WHERE id=900001').get().is_active, 0)
  db.close()
})
check('nonzero branch rows cannot cancel each other into deactivation permission', () => {
  const db = fixture()
  db.exec('PRAGMA ignore_check_constraints=ON')
  db.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,900001,1),(900001,900002,-1)')
  db.exec('PRAGMA ignore_check_constraints=OFF')
  assert.throws(() => db.exec('UPDATE products SET is_active=0 WHERE id=900001'), refusal)
  db.close()
})
check('inactive product creation and cached stock increments refuse', () => {
  const db = fixture()
  assert.throws(() => db.exec("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(900003,'No',0,1)"), refusal)
  assert.throws(() => db.exec('UPDATE products SET stock_quantity=1 WHERE id=900002'), refusal)
  db.close()
})
const inbound = [
  ['branch_stock', 'product_id,branch_id,quantity', '900002,900001,1', 'quantity', 'product_id', 900002],
  ['branch_batch_stock', 'batch_id,branch_id,quantity', '900002,900001,1', 'quantity', 'batch_id', 900002],
  ['damaged_stock_lots', 'product_id,quantity_remaining', '900002,1', 'quantity_remaining', 'product_id', 900002],
]
for (const [table, columns, values, quantity, identity, id] of inbound) {
  check(`${table} inactive insert, update, UPSERT and identity reassignment refuse`, () => {
    const db = fixture()
    assert.throws(() => db.exec(`INSERT INTO ${table}(${columns}) VALUES(${values})`), refusal)
    db.exec(`INSERT INTO ${table}(${columns}) VALUES(${values.replace(/1$/, '0')})`)
    assert.throws(() => db.exec(`UPDATE ${table} SET ${quantity}=1 WHERE ${identity}=${id}`), refusal)
    db.exec(`DELETE FROM ${table}; INSERT INTO ${table}(${columns}) VALUES(${values.replace('900002', '900001')})`)
    assert.throws(() => db.exec(`UPDATE ${table} SET ${identity}=900002`), refusal)
    if (table !== 'damaged_stock_lots') {
      db.exec(`INSERT INTO ${table}(${columns}) VALUES(${values.replace(/1$/, '0')})`)
      assert.throws(() => db.exec(`INSERT INTO ${table}(${columns}) VALUES(${values.replace(/1$/, '0')})
        ON CONFLICT(${identity},branch_id) DO UPDATE SET ${quantity}=1`), refusal)
    }
    db.close()
  })
}
check('stocked batch cannot be reparented onto an inactive product', () => {
  const db = fixture()
  seeders.lot(db)
  assert.throws(() => db.exec('UPDATE product_batches SET variant_product_id=900002 WHERE id=900001'), refusal)
  assert.throws(() => db.exec("INSERT OR REPLACE INTO product_batches(id,variant_product_id,batch_key) VALUES(900001,900002,'replacement')"), refusal)
  db.close()
})
check('late refusal rolls back earlier writes in the same transaction', () => {
  const db = fixture()
  const before = snapshot(db)
  assert.throws(() => db.transaction(() => {
    seeders.branch(db)
    db.exec('UPDATE products SET stock_quantity=1 WHERE id=900002')
  })(), refusal)
  assert.deepEqual(snapshot(db), before)
  db.close()
})
check('legacy stocked inactive metadata and stock removal are not blocked', () => {
  const db = fixture(false)
  seeders.branch(db)
  db.exec('UPDATE products SET is_active=0 WHERE id=900001')
  db.exec(sql)
  db.exec("UPDATE products SET name='Visible legacy' WHERE id=900001; UPDATE branch_stock SET quantity=0 WHERE product_id=900001")
  assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE product_id=900001').get().quantity, 0)
  db.close()
})
check('migration preserves existing transfer-provenance trigger and uses LF SQL', () => {
  const db = fixture()
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='transfer_product_identity_update'").get().n, 1)
  assert(!sql.includes('\r'))
  assert(sql.includes('product_has_stock'))
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  db.close()
})
console.log(`${passed} product stock invariant checks passed`)
