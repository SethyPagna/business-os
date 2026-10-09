const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb, applyMigrations } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const conversion = fs.readFileSync(path.join(__dirname, '../migrations/0246_counted_tagged_stock.sql'), 'utf8')
function seedBeforeFence(db) {
  db.exec(`
    INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Fixture',1,1);
    INSERT INTO products(id,name,stock_quantity,is_active) VALUES(1,'Fixture',7,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,7);
    INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(1,1,'fixture',1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,7);
    INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)
      VALUES(1,1,1,1,3,3,'damaged','remove');
  `)
}
const quantities = db => [
  db.prepare('SELECT stock_quantity AS n FROM products WHERE id=1').get().n,
  db.prepare('SELECT quantity AS n FROM branch_stock WHERE product_id=1 AND branch_id=1').get().n,
  db.prepare('SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().n,
  db.prepare('SELECT quantity_remaining AS n FROM damaged_stock_lots WHERE id=1').get().n,
]
const flags = db => db.prepare("SELECT key,value FROM system_flags WHERE key IN ('stock_schema_epoch','maintenance','stock_transaction_permit') ORDER BY key").all()
  .map(row => ({ ...row }))
const journalCount = db => db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='counted_stock_conversion_lots'").get().n

async function main() {
  const current = openDb(loadAll(), { seedBeforeFence })
  try {
    assert.deepEqual(quantities(current), [10,10,10,3])
    assert.deepEqual(flags(current), [{key:'stock_schema_epoch',value:'counted-tagged-subset-v1'}])
    assert.equal(current.prepare('SELECT credited_quantity AS n FROM counted_stock_conversion_lots WHERE lot_id=1').get().n, 3)
    assert.equal(current.db.limits.exprDepth, 100)
    console.log('PASS full ordered real migration chain converts legacy S7/D3 to physical T10/D3 without leaked authority')
    applyMigrations(current, [conversion])
    assert.deepEqual(quantities(current), [10,10,10,3])
    assert.deepEqual(flags(current), [{key:'stock_schema_epoch',value:'counted-tagged-subset-v1'}])
    assert.equal(current.prepare('SELECT COUNT(*) AS n FROM counted_stock_conversion_lots').get().n, 1)
    console.log('PASS real conversion replay changes neither physical quantity nor journal')
    for (const sql of [
      'UPDATE products SET stock_quantity=11 WHERE id=1',
      'UPDATE branch_stock SET quantity=11 WHERE product_id=1',
      'UPDATE branch_batch_stock SET quantity=11 WHERE batch_id=1',
      'UPDATE damaged_stock_lots SET quantity_remaining=2 WHERE id=1',
      "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')",
    ]) assert.throws(() => current.exec(sql), /stock_transaction_required/)
    await assert.rejects(current.batch([
      {sql:"INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')"},
      {sql:'UPDATE branch_stock SET quantity=11 WHERE product_id=1'},
    ]), /stock_transaction_required/)
    assert.deepEqual(flags(current), [{key:'stock_schema_epoch',value:'counted-tagged-subset-v1'}])
    assert.deepEqual(quantities(current), [10,10,10,3])
    console.log('PASS raw stock/maintenance writers and obsolete permits remain refused and atomic')
  } finally { current.db.close() }

  const legacy = openDb(loadAll({through:245}), { seedBeforeFence })
  try {
    assert.deepEqual(quantities(legacy), [7,7,7,3])
    assert.equal(journalCount(legacy), 0)
    // Unmodified SQL must still reject an operator who omitted maintenance.
    legacy.exec('BEGIN IMMEDIATE')
    assert.throws(() => legacy.exec(conversion), /counted_conversion_exclusion_required/)
    legacy.exec('ROLLBACK')
    assert.equal(journalCount(legacy), 0)
    assert.throws(() => applyMigrations(legacy, [conversion + "\nSELECT json_extract('[1]','$[fixture_after_conversion_failure]');"]), /fixture_after_conversion_failure/)
    assert.deepEqual(quantities(legacy), [7,7,7,3])
    assert.deepEqual(flags(legacy), [{key:'stock_schema_epoch',value:'legacy-separate-pool-v1'}])
    assert.equal(journalCount(legacy), 0)
    assert.throws(() => legacy.exec('UPDATE branch_stock SET quantity=8 WHERE product_id=1'), /stock_transaction_required/)
    applyMigrations(legacy, [conversion])
    assert.deepEqual(quantities(legacy), [10,10,10,3])
    console.log('PASS failure after real conversion rolls back quantities, journal, epoch, maintenance and permit; recovery succeeds')
  } finally { legacy.db.close() }

  for (const through of [83,194,242]) {
    const historic = openDb(loadAll({through}))
    try {
      assert.equal(journalCount(historic), 0)
      if (historic.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='system_flags'").get().n) {
        assert.equal(historic.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_schema_epoch'").get().n, 0)
      }
    } finally { historic.db.close() }
  }
  console.log('PASS explicit historical migration boundaries remain unconverted')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
