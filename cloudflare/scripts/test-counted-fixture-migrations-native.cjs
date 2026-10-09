const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fixture } = require('./test-stock-session-atomic.cjs')

function seedStock(sql) {
  sql.exec(`
    UPDATE products SET stock_quantity=7 WHERE id=1;
    UPDATE branch_stock SET quantity=7 WHERE product_id=1 AND branch_id=1;
    INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(1,1,'fixture-receipt',1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,7);
    INSERT INTO damaged_stock_lots(product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)
      VALUES(1,1,1,3,3,'damaged','remove');
  `)
}

const flags = sql => sql.prepare("SELECT key,value FROM system_flags WHERE key IN ('stock_schema_epoch','stock_transaction_permit','maintenance') ORDER BY key").all()
const quantities = sql => [
  sql.prepare('SELECT stock_quantity AS n FROM products WHERE id=1').get().n,
  sql.prepare('SELECT quantity AS n FROM branch_stock WHERE product_id=1 AND branch_id=1').get().n,
  sql.prepare('SELECT quantity AS n FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().n,
  sql.prepare('SELECT quantity_remaining AS n FROM damaged_stock_lots WHERE id=1').get().n,
]

async function main() {
  const current = fixture(seedStock)
  try {
    assert.deepEqual(quantities(current.sql), [10,10,10,3])
    assert.deepEqual(flags(current.sql), [{key:'stock_schema_epoch',value:'counted-tagged-subset-v1'}])
    assert.equal(current.sql.prepare('SELECT credited_quantity AS n FROM counted_stock_conversion_lots WHERE lot_id=1').get().n,3)
    assert.throws(() => current.sql.exec('UPDATE branch_stock SET quantity=11 WHERE product_id=1'), /stock_transaction_required/)
    assert.deepEqual(quantities(current.sql), [10,10,10,3])

    const result = await current.env.DB.batch([
      current.env.DB.prepare("INSERT INTO system_flags(key,value) VALUES('fixture-returning','value') RETURNING key,value"),
      current.env.DB.prepare('SELECT stock_quantity AS n FROM products WHERE id=1'),
    ])
    assert.deepEqual(result[0].results, [{key:'fixture-returning',value:'value'}])
    assert.equal(result[0].meta.changes,1)
    assert.deepEqual(result[1].results,[{n:10}])
    assert.equal(result[1].meta.changes,0)
    await assert.rejects(current.env.DB.batch([
      current.env.DB.prepare("INSERT INTO system_flags(key,value) VALUES('fixture-rollback','value') RETURNING key"),
      current.env.DB.prepare("SELECT json_extract('[1]','$[fixture_final_guard]')"),
    ]), /fixture_final_guard/)
    assert.equal(current.sql.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='fixture-rollback'").get().n,0)
    console.log('PASS actual counted migration, no leaked maintenance/permit, direct-write refusal, RETURNING metadata and atomic rollback')
  } finally { current.sql.close() }

  const legacy = fixture(seedStock,{legacyStock:true})
  try {
    assert.deepEqual(quantities(legacy.sql),[7,7,7,3])
    assert.deepEqual(flags(legacy.sql),[{key:'stock_schema_epoch',value:'legacy-separate-pool-v1'}])
    assert.equal(legacy.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='counted_stock_conversion_lots'").get().n,0)
    const migration=fs.readFileSync(path.join(__dirname,'../migrations/0246_counted_tagged_stock.sql'),'utf8')
    assert.throws(() => legacy.sql.transaction(() => legacy.sql.exec(migration))(), /counted_conversion_exclusion_required/)
    assert.deepEqual(quantities(legacy.sql),[7,7,7,3])
    assert.equal(legacy.sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='counted_stock_conversion_lots'").get().n,0)
    console.log('PASS explicit pre-conversion fixture retains unmodified migration refusal and rollback')
  } finally { legacy.sql.close() }
}

main().catch(error => {console.error(error);process.exitCode=1})
