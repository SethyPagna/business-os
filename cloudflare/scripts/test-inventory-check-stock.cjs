const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { transformSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', code)(id => load(path.resolve(path.dirname(file), `${id}.ts`)), module, module.exports)
  return module.exports
}
const api = load(path.join(__dirname, '../src/lib/inventoryCheckStock.ts'))
let passed = 0
async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
function fixture() {
  const db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  db.exec("INSERT INTO products(id,name,stock_quantity) VALUES(900001,'Example',0),(900002,'Other',0); INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(900001,900001,'test-lot');")
  db.exec("INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1)")
  return db
}
const snapshot = db => ['products', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'product_batches', 'inventory_movements', 'system_flags'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
function adapter(db) {
  return { calls: 0, statements: 0, async batch(statements) {
    this.calls++; this.statements += statements.length
    db.exec('PRAGMA query_only=ON')
    db.exec('BEGIN')
    try {
      const result = statements.map(({ sql, params = {} }) => ({ results: db.prepare(sql).all(params), success: true }))
      db.exec('COMMIT')
      return result
    } catch (error) { db.exec('ROLLBACK'); throw error }
    finally { db.exec('PRAGMA query_only=OFF') }
  } }
}
async function read(db, options = {}) {
  const before = snapshot(db)
  const changes = db.prepare('SELECT total_changes() AS count').get().count
  const proxy = adapter(db)
  const rows = await api.readInventoryCheckStock(proxy, { productIds: [900001], ...options })
  assert.deepEqual(snapshot(db), before, 'stock read leaves every business row and flag unchanged')
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count, changes, 'read cannot write any other table either')
  assert.equal(proxy.calls, 1)
  assert.equal(proxy.statements, 2, 'one schema probe and one set-based read, never per-product queries')
  return rows[0]
}
const seedBranch = (db, quantity, branchId = 1) => db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,?,?)').run(branchId, quantity)
const seedLot = (db, quantity, branchId = 1) => db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,?,?)').run(branchId, quantity)
const seedDamage = (db, quantity, branchId = 1) => db.prepare('INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining) VALUES(900001,?,?,?)').run(branchId, Math.max(0, quantity), quantity)
const cacheQty = (db, quantity) => db.prepare('UPDATE products SET stock_quantity=? WHERE id=900001').run(quantity)

async function main() {
  await check('validated pre-0243 schema and genuine zero remain known zero', async () => {
    const db = fixture()
    const row = await read(db)
    assert.equal(row.quantity, 0)
    assert.equal(row.consistent, true)
    assert.deepEqual(row.flags, [])
    db.close()
  })
  await check('branch, lot, cache and damage single-ledger controls preserve evidence rather than invent allocation', async () => {
    for (const [kind, seed, expected] of [
      ['branch', db => seedBranch(db, 7), null],
      ['lot', db => seedLot(db, 7), null],
      ['cache', db => cacheQty(db, 7), null],
      ['damage', db => seedDamage(db, 7), 7],
    ]) {
      const db = fixture(); seed(db)
      const row = await read(db)
      assert.equal(row.quantity, expected, kind)
      assert.equal(row[`recorded_${kind === 'branch' ? 'ordinary' : kind === 'damage' ? 'damaged' : kind}_quantity`], 7, kind)
      if (expected === null) assert.equal(row.consistent, false, kind)
      if (kind === 'branch') assert.equal((await read(db, { branchId: 1 })).quantity, 7, 'known branch stock survives global cache warning')
      if (kind === 'cache' || kind === 'lot') assert.equal((await read(db, { branchId: 1 })).quantity, null, 'unallocated stock is not silently out-of-stock')
      db.close()
    }
  })
  await check('overlapping branch/lot/cache counts once and legacy damage adds exactly once', async () => {
    const db = fixture(); seedBranch(db, 10); seedLot(db, 10); cacheQty(db, 10); seedDamage(db, 3)
    for (const options of [{}, { branchId: 1 }]) {
      const row = await read(db, options)
      assert.equal(row.quantity, 13)
      assert.equal(row.recorded_ordinary_quantity, 10)
      assert.equal(row.recorded_lot_quantity, 10)
      assert.equal(row.recorded_cache_quantity, 10)
      assert.equal(row.recorded_damaged_quantity, 3)
      assert.equal(row.consistent, true)
    }
    const query = api.buildInventoryCheckStockQuery({ productIds: [900001] })
    const wrongSum = db.prepare(`SELECT recorded_ordinary_quantity+recorded_lot_quantity+recorded_cache_quantity+recorded_damaged_quantity AS quantity FROM (${query.rowsSql})`).get(query.params).quantity
    assert.equal(wrongSum, 33)
    assert.notEqual(wrongSum, 13, 'the overlap control discriminates summing all ledgers')
    db.close()
  })
  await check('lot excess is checked per branch, not only against a cancelling global total', async () => {
    const db = fixture(); seedBranch(db, 5); seedBranch(db, 5, 2); cacheQty(db, 10); seedLot(db, 10)
    assert.equal((await read(db)).quantity, null)
    assert.equal((await read(db, { branchId: 1 })).quantity, null)
    assert.equal((await read(db, { branchId: 2 })).quantity, 5)
    assert.ok((await read(db)).flags.includes('lot_exceeds_ordinary'))
    db.close()
  })
  await check('ordinary stock need not be fully lot allocated; fractional quantities stay exact without rounding/flooring', async () => {
    const db = fixture(); seedBranch(db, 0.75); seedLot(db, 0.25); cacheQty(db, 0.75); seedDamage(db, 0.125)
    const row = await read(db)
    assert.equal(row.quantity, 0.875)
    assert.equal(row.consistent, true)
    db.close()
  })
  await check('null-branch damage is counted globally once and never assigned to an arbitrary branch', async () => {
    const db = fixture(); seedBranch(db, 10); cacheQty(db, 10); seedDamage(db, 2, null)
    const all = await read(db)
    assert.equal(all.quantity, 12)
    assert.equal(all.unallocated_damaged_quantity, 2)
    assert.ok(all.flags.includes('unallocated_damaged'))
    const branch = await read(db, { branchId: 1 })
    assert.equal(branch.quantity, null)
    assert.equal(branch.recorded_ordinary_quantity, 10)
    assert.equal(branch.recorded_damaged_quantity, 0)
    db.close()
  })
  await check('negative and null anomalies cannot cancel into known zero or get silently floored', async () => {
    const db = fixture(); db.exec('PRAGMA ignore_check_constraints=ON'); seedBranch(db, -2); seedBranch(db, 2, 2); db.exec('PRAGMA ignore_check_constraints=OFF')
    const row = await read(db)
    assert.equal(row.recorded_ordinary_quantity, 0)
    assert.equal(row.quantity, null)
    assert.ok(row.flags.includes('negative_quantity'))
    assert.equal((await read(db, { branchId: 1 })).recorded_ordinary_quantity, -2)
    db.close()
    const nullDb = fixture(); seedBranch(nullDb, null)
    const nullRow = await read(nullDb)
    assert.equal(nullRow.recorded_ordinary_quantity, null)
    assert.equal(nullRow.quantity, null)
    assert.ok(nullRow.flags.includes('invalid_quantity'))
    nullDb.close()
  })
  await check('negative damaged evidence and missing branch allocations stay unknown', async () => {
    const db = fixture(); seedDamage(db, -1, null)
    assert.equal((await read(db)).recorded_damaged_quantity, -1)
    assert.equal((await read(db)).quantity, null)
    assert.equal((await read(db, { branchId: 1 })).quantity, null)
    db.close()
  })
  await check('selected zero branch is known when stock is fully allocated elsewhere', async () => {
    const db = fixture(); seedBranch(db, 8, 2); seedLot(db, 8, 2); cacheQty(db, 8)
    assert.equal((await read(db, { branchId: 1 })).quantity, 0)
    assert.equal((await read(db, { branchId: 2 })).quantity, 8)
    db.close()
  })
  await check('zero unallocated damage stays zero, while orphan branches and negative lot quantities remain visible anomalies', async () => {
    const zero = fixture(); seedDamage(zero, 0, null)
    assert.equal((await read(zero)).quantity, 0)
    assert.equal((await read(zero, { branchId: 1 })).quantity, 0)
    assert.deepEqual((await read(zero)).flags, [])
    zero.close()
    const orphan = fixture(); seedBranch(orphan, 4, 900003); cacheQty(orphan, 4)
    assert.equal((await read(orphan)).recorded_ordinary_quantity, 4)
    assert.equal((await read(orphan)).quantity, null)
    assert.ok((await read(orphan)).flags.includes('invalid_allocation'))
    orphan.close()
    const orphanDamage = fixture(); seedDamage(orphanDamage, 2, 900003)
    assert.equal((await read(orphanDamage)).quantity, 2)
    assert.equal((await read(orphanDamage)).unallocated_damaged_quantity, 2)
    assert.equal((await read(orphanDamage, { branchId: 1 })).quantity, null)
    orphanDamage.close()
    const negative = fixture(); seedBranch(negative, 2); cacheQty(negative, 2)
    negative.exec('PRAGMA ignore_check_constraints=ON'); seedLot(negative, -1); negative.exec('PRAGMA ignore_check_constraints=OFF')
    assert.equal((await read(negative)).recorded_lot_quantity, -1)
    assert.equal((await read(negative)).quantity, null)
    negative.close()
  })
  await check('future/counted epochs, lost installed epoch and changed historical physical schema refuse', async () => {
    for (const epoch of ['counted-stock-v1', 'future-v999', '']) {
      const db = fixture(); db.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").run(epoch)
      await assert.rejects(() => read(db), error => error.code === 'inventory_check_stock_schema_unavailable')
      db.close()
    }
    const db = fixture(); db.exec("CREATE TRIGGER stock_epoch_test_0243 AFTER UPDATE ON branch_stock BEGIN SELECT 1; END;")
    await assert.rejects(() => read(db), error => error.code === 'inventory_check_stock_schema_unavailable')
    db.close()
    const changed = fixture(); changed.exec('ALTER TABLE damaged_stock_lots ADD COLUMN counted_in_ordinary INTEGER')
    await assert.rejects(() => read(changed), error => error.code === 'inventory_check_stock_schema_unavailable')
    changed.close()
    const maintenance = fixture(); maintenance.exec("INSERT INTO system_flags(key,value) VALUES('maintenance','restoring')")
    await assert.rejects(() => read(maintenance), error => error.code === 'inventory_check_stock_schema_unavailable')
    maintenance.close()
    const invalidFlag = fixture()
    assert.throws(() => invalidFlag.prepare("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch',?)").run(null), /NOT NULL/, 'actual historical schema rejects a null epoch value before it can be read')
    invalidFlag.close()
  })
  await check('explicit legacy epoch accepts the same schema and bounded JSON IDs cannot broaden the selection', async () => {
    const db = fixture(); db.exec("INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch','legacy-separate-pool-v1')")
    assert.equal((await read(db)).quantity, 0)
    const proxy = adapter(db)
    assert.deepEqual(await api.readInventoryCheckStock(proxy, { productIds: [] }), [])
    assert.equal((await api.readInventoryCheckStock(proxy, {})).length >= 2, true)
    for (const options of [{ productIds: [0] }, { productIds: [1.5] }, { productIds: Array.from({ length: 501 }, (_, i) => i + 1) }, { branchId: 0 }]) assert.throws(() => api.buildInventoryCheckStockQuery(options), /Invalid Inventory stock scope/)
    db.close()
  })
  console.log(`PASS ${passed} actual SQLite Inventory stock-read groups; no business writes`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
