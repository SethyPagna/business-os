const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const f = require('./test-stock-bridge-core-native.cjs')
const { sql, raw, db, load } = f
const executor = load('lib/stockTransaction.ts')
const products = load('lib/productWrites.ts')
const fold = load('lib/createFold.ts')
const env = { DB: raw, PLAN_TIER: 'paid' }
let checks = 0
async function check(name, run) { await run(); assert.equal(f.permits(), 0); checks++; console.log(`PASS ${name}`) }
async function main() {
  await check('numeric installation order requires no ambient permit or monetary rewrite', async () => {
    const empty = new DatabaseSync(':memory:')
    try {
      const dir = path.join(__dirname, '../migrations')
      for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
        empty.exec('BEGIN')
        try { empty.exec(fs.readFileSync(path.join(dir, file), 'utf8')); empty.exec('COMMIT') }
        catch (error) { empty.exec('ROLLBACK'); throw new Error(`${file}: ${error.message}`) }
      }
      assert.equal(empty.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
      assert.equal(empty.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'catalog_cost_admission_%_0258'").get().n, 5)
    } finally { empty.close() }
  })
  await check('all four unpermitted acquisition fields refuse including same-value writes', async () => {
    const before = f.state()
    for (const field of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) {
      assert.throws(() => sql.exec(`UPDATE products SET ${field}=${field} WHERE id=1001`), /stock_transaction_required/)
      assert.throws(() => sql.exec(`UPDATE products SET ${field}=3.2 WHERE id=1001`), /stock_transaction_required/)
    }
    assert.equal(f.state(), before)
  })
  await check('entry insert update delete and lot cost cannot bypass acquisition admission', async () => {
    await executor.executeStockTransaction(db, [{ sql: "INSERT INTO product_cost_entries(product_id,cost_usd,source) VALUES(1002,7,'manual')" }], 'retry')
    const before = JSON.stringify(sql.prepare('SELECT * FROM product_cost_entries').all())
    for (const text of ["INSERT INTO product_cost_entries(product_id,cost_usd,source) VALUES(1002,0,'manual')",
      'UPDATE product_cost_entries SET cost_usd=0 WHERE product_id=1002', 'DELETE FROM product_cost_entries WHERE product_id=1002',
      'UPDATE product_batches SET unit_cost_usd=3.2 WHERE id=1001']) assert.throws(() => sql.exec(text), /stock_transaction_required/)
    assert.equal(JSON.stringify(sql.prepare('SELECT * FROM product_cost_entries').all()), before)
  })
  await check('current nullable and genuine zero product writes use one admitted transaction', async () => {
    for (const value of [null, 0, 7]) {
      await products.updateRow(env, 'products', 1002, { cost_price_usd: value })
      assert.equal(sql.prepare('SELECT cost_price_usd FROM products WHERE id=1002').get().cost_price_usd, value)
    }
    await products.updateRow(env, 'products', 1002, { cost_price_khr: 0 })
    assert.equal(sql.prepare('SELECT cost_price_khr FROM products WHERE id=1002').get().cost_price_khr, 0)
  })
  await check('current create fold cost and metadata-only control remain available', async () => {
    const duplicate = sql.prepare('SELECT * FROM products WHERE id=1002').get()
    const folded = await fold.foldCreateIntoExisting(env, { id: null, name: 'Fixture' }, duplicate, duplicate.name, { cost_price_usd: 14 })
    assert.equal(folded.success, true)
    assert.ok(sql.prepare('SELECT COUNT(*) n FROM product_cost_entries WHERE product_id=1002').get().n > 1)
    await db.prepare("UPDATE products SET name='Metadata only' WHERE id=1002").run()
    await db.prepare("UPDATE product_batches SET notes='Metadata only' WHERE id=1001").run()
  })
  await check('date-only lot recompute refuses an old writer atomically', async () => {
    await executor.executeStockTransaction(db, [{ sql: `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,unit_cost_usd,is_active)
      VALUES(2001,1002,'date-first','date-first','2026-10-01',3,1),(2002,1002,'date-last','date-last','2026-10-02',4,1)` }], 'retry')
    assert.equal(sql.prepare('SELECT cost_price_usd FROM products WHERE id=1002').get().cost_price_usd, 4)
    const before = f.state()
    assert.throws(() => sql.exec("UPDATE product_batches SET received_at='2026-10-14' WHERE id=2001"), /stock_transaction_required/)
    assert.equal(f.state(), before)
    await executor.executeStockTransaction(db, [{ sql: "UPDATE product_batches SET received_at='2026-10-14' WHERE id=2001" }], 'retry')
    assert.equal(sql.prepare('SELECT received_at FROM product_batches WHERE id=2001').get().received_at, '2026-10-14')
    assert.equal(sql.prepare('SELECT cost_price_usd FROM products WHERE id=1002').get().cost_price_usd, 3)
  })
  console.log(`PASS ${checks} cost admission groups on native SQLite`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => sql.close())
