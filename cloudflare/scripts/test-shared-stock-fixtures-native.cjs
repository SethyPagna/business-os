const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')
const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

async function main() {
  const resolve = withProductStockGuard(request => { throw new Error(`unmapped ${request}`) })
  const tx = resolve('./stockTransaction')
  assert.equal(tx, resolve('../lib/stockTransaction'))
  assert.throws(() => resolve('./unknown'), /unmapped/)
  const d1 = openDb(loadAll())
  const raw = d1.db
  const count = () => raw.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").get().n
  const writes = []
  const db = {
    batchOnce: async statements => { writes.push(statements); return d1.batch(statements) },
    batch: async statements => { writes.push(statements); return d1.batch(statements) },
  }
  try {
    assert.throws(() => raw.exec("INSERT INTO products(id,name) VALUES(88001,'raw')"), /stock_transaction_required/)
    const result = await tx.executeStockTransaction(db, [{ sql: "INSERT INTO products(id,name) VALUES(88001,'admitted')" }, { sql: 'SELECT id FROM products WHERE id=88001' }], 'once')
    assert.equal(result.length, 2)
    assert.equal(result[1].results[0].id, 88001)
    assert.equal(writes[0].length, 4)
    assert.match(writes[0][0].sql, /INSERT INTO system_flags/)
    assert.match(writes[0][3].sql, /DELETE FROM system_flags/)
    assert.equal(count(), 0)
    for (const fence of ['maintenance', 'epoch']) {
      if (fence === 'maintenance') await tx.executeStockTransaction(db, [{ sql: "INSERT INTO system_flags(key,value) VALUES('maintenance','{}')" }], 'once')
      else raw.exec("UPDATE system_flags SET value='future-schema' WHERE key='stock_schema_epoch'")
      await assert.rejects(tx.executeStockTransaction(db, [{ sql: "UPDATE products SET name='forbidden' WHERE id=88001" }], 'retry'), resolve('../lib/stockTransaction').StockTransactionUnavailableError)
      assert.equal(raw.prepare('SELECT name FROM products WHERE id=88001').get().name, 'admitted')
      assert.equal(count(), 0)
      raw.exec("DELETE FROM system_flags WHERE key='maintenance'")
    }
    await assert.rejects(tx.executeStockTransaction({ batchOnce: async () => [] }, [{ sql: 'SELECT 1' }], 'once'), resolve('../lib/stockTransaction').StockTransactionOutcomeUnknownError)
    console.log('PASS shared loader uses the real singleton dispatcher, fences, results and error classes')
  } finally { raw.close() }
  const h = await H.startWorker()
  try {
    await H.seedProduct(h, 88001, 'Seed', 5, 7)
    assert.equal((await h.one('SELECT stock_quantity FROM products WHERE id=88001')).stock_quantity, 7)
    assert.equal((await h.one('SELECT quantity FROM branch_stock WHERE product_id=88001')).quantity, 7)
    assert.equal((await h.one('SELECT quantity FROM branch_batch_stock WHERE batch_id=93001')).quantity, 7)
    await assert.rejects(h.db.prepare("UPDATE products SET stock_quantity=9 WHERE id=88001").run(), /stock_transaction_required/)
    await assert.rejects(H.seedProduct(h, 88002, 'Invalid negative stock', 5, -1))
    assert.equal(await h.one('SELECT id FROM products WHERE id=88002'), undefined)
    assert.equal((await h.one("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")).n, 0)
    await H.seedProduct(h, 88002, 'Zero stock', 5, 0)
    assert.equal((await h.one('SELECT stock_quantity FROM products WHERE id=88002')).stock_quantity, 0)
    console.log('PASS explicit native fixture seed is atomic, leaves no permit, and keeps raw writes guarded')
  } finally { await h.mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
