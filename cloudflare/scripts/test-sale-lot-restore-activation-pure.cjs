const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')

const cache = new Map()
function load(file) {
  const absolute = path.resolve(__dirname, '../src/lib', file)
  if (cache.has(absolute)) return cache.get(absolute).exports
  const mod = { exports: {} }
  cache.set(absolute, mod)
  const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', 'module', output)(mod.exports, (request) => request.startsWith('.')
    ? load(path.resolve(path.dirname(absolute), `${request}.ts`)) : require(request), mod)
  return mod.exports
}
const batches = load('productBatches.ts')
const transitions = load('saleTransitions.ts')
const amendments = load('saleAmendments.ts')
const additions = load('saleLineAddition.ts')
const migrationDir = path.resolve(__dirname, '../migrations')
const migrationSql = fs.readdirSync(migrationDir).filter((file) => file.endsWith('.sql')).sort()
  .map((file) => fs.readFileSync(path.join(migrationDir, file), 'utf8'))

function fixture() {
  const db = openDb(migrationSql)
  db.exec(`INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1);
    INSERT INTO products(id,name,stock_quantity,cost_price_usd) VALUES(1,'Serum',0,2.5);
    INSERT INTO sales(id,receipt_number,sale_status,total_usd) VALUES(1,'RESTORE-1','completed',15);
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,batch_id,applied_price_usd,cost_price_usd,total_usd)
      VALUES(1,1,1,'Serum',3,1,1,5,2.5,15);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,expiry_date,is_active,unit_cost_usd)
      VALUES(1,1,'first','Original lot','2026-01-02','2027-01-02',0,2.5),
            (2,1,'untouched','Other lot','2026-03-04',NULL,0,3);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0),(1,2,0);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,0),(2,2,0);
    INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,lot_code,expiry_date,released_quantity)
      VALUES(1,1,1,1,3,'Original lot','2027-01-02',0);`)
  return db
}
const actor = { saleId: 1, reason: 'Correction', userId: null, userName: 'Tester' }
const item = { id: 1, product_id: 1, product_name: 'Serum', quantity: 3, branch_id: 1, batch_id: 1,
  cost_price_usd: 2.5, cost_price_khr: 10000, applied_price_usd: 5 }
const allocation = { id: 1, batch_id: 1, branch_id: 1, quantity: 3, released_quantity: 0 }
const transition = (extra = {}) => transitions.planSaleStockTransition({ ...actor, oldStatus: 'completed', newStatus: 'cancelled',
  items: [{ ...item, allocations: [allocation] }], returnedByItem: new Map(), ...extra })
const decrease = (removedQuantity, extra = {}) => amendments.planLineQuantityDecrease({ ...actor, sale: { sale_status: 'completed' },
  line: item, allocations: [allocation], removedQuantity, exchangeRate: 4000, ...extra })
const removal = (heldUnits = 3) => additions.planSaleLineRemoval({ ...actor, lines: [{ saleItemId: 1,
  productId: 1, productName: 'Serum', branchId: 1, quantity: 3, heldUnits, unitPriceUsd: 5,
  lineTotalUsd: 15, costPriceUsd: 2.5, costPriceKhr: 10000,
  takes: [{ batchId: 1, quantity: 3, lotCode: 'Original lot', expiryDate: '2027-01-02' }] }] })
function stock(db, expected) {
  assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, expected)
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, expected)
  assert.equal(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().quantity, expected)
  const lot = db.prepare('SELECT is_active,received_at,expiry_date,unit_cost_usd,lot_code FROM product_batches WHERE id=1').get()
  assert.deepEqual({ ...lot }, { is_active: expected > 0 ? 1 : lot.is_active, received_at: '2026-01-02',
    expiry_date: '2027-01-02', unit_cost_usd: 2.5, lot_code: 'Original lot' })
  assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=2').get().is_active, 0)
  assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=2').get().quantity, 0)
  assert.equal(db.prepare('SELECT total_usd FROM sales WHERE id=1').get().total_usd, 15)
}
async function main() {
  {
    const db = fixture()
    db.exec('UPDATE product_batches SET is_active=NULL WHERE id=1')
    await db.batch(transition().statements)
    stock(db, 3)
    assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true }))[0].id, 1)
    assert.equal(db.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE id=1').get().released_quantity, 3)
  }
  {
    const db = fixture()
    db.exec('UPDATE product_batches SET is_active=NULL WHERE id=1')
    await assert.rejects(db.batch([...transition().statements,
      { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)' }]), /constraint/i)
    stock(db, 0)
    assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, null)
    assert.equal(db.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE id=1').get().released_quantity, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
  }
  console.log('PASS nullable legacy active flag: cancellation activates original dated lot and failure restores NULL atomically')
  for (const oldStatus of ['completed', 'awaiting_payment', 'awaiting_delivery', 'partial_return']) {
    const db = fixture()
    await db.batch(transition({ oldStatus }).statements)
    stock(db, 3)
    assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true }))[0].id, 1)
    assert.equal(db.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE id=1').get().released_quantity, 3)
    await db.batch(transition({ oldStatus: 'cancelled' }).statements)
    stock(db, 3)
    await db.batch(transition({ oldStatus: 'cancelled', newStatus: oldStatus,
      items: [{ ...item, allocations: [{ ...allocation, released_quantity: 3 }] }] }).statements)
    stock(db, 0)
    assert.equal(db.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE id=1').get().released_quantity, 0)
  }
  console.log('PASS cancellation, repeated cancellation, status restore and selectable original lot for four held statuses')
  {
    const db = fixture()
    db.exec('DELETE FROM sale_item_batch_allocations')
    db.exec('DELETE FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1')
    await db.batch(transition({ items: [item] }).statements)
    stock(db, 3)
  }
  {
    const db = fixture()
    db.exec('UPDATE sale_item_batch_allocations SET released_quantity=1 WHERE id=1')
    await db.batch(transition({ oldStatus: 'partial_return', returnedByItem: new Map([[1, 1]]),
      items: [{ ...item, allocations: [{ ...allocation, released_quantity: 1 }] }] }).statements)
    stock(db, 2)
  }
  console.log('PASS legacy explicit batch with missing branch-lot row and partial-return outstanding quantity')
  for (const removed of [1, 3]) {
    const db = fixture()
    await db.batch(decrease(removed).statements)
    stock(db, removed)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, removed === 3 ? 0 : 1)
    if (removed === 1) {
      assert.equal(db.prepare('SELECT quantity FROM sale_items').get().quantity, 2)
      assert.equal(db.prepare('SELECT quantity FROM sale_item_batch_allocations').get().quantity, 2)
    }
  }
  {
    const db = fixture()
    await db.batch(removal().statements)
    stock(db, 3)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_item_batch_allocations').get().n, 0)
  }
  console.log('PASS quantity decrease, full removal and Add Items undo restore the original archived lot')
  for (const plan of [transition(), decrease(1), decrease(3), removal()]) {
    const db = fixture()
    await assert.rejects(db.batch([...plan.statements, { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)' }]), /constraint/i)
    stock(db, 0)
    assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, 0)
    assert.equal(db.prepare('SELECT quantity FROM sale_items WHERE id=1').get().quantity, 3)
    assert.equal(db.prepare('SELECT released_quantity FROM sale_item_batch_allocations WHERE id=1').get().released_quantity, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
  }
  console.log('PASS downstream failure rolls back activation, lot/branch/product stock, allocations and movements')
  for (const plan of [transition({ skipStock: true }), transition({ newStatus: 'awaiting_payment' }),
    decrease(1, { sale: { sale_status: 'completed', stock_skipped: 1 } }),
    decrease(1, { allocations: [{ ...allocation, released_quantity: 3 }] }), removal(0)]) {
    const db = fixture()
    await db.batch(plan.statements)
    stock(db, 0)
    assert.equal(db.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, 0)
  }
  assert.deepEqual(batches.restoreBatchStockStatements(1, 1, 0), [])
  assert.deepEqual(batches.restoreBatchStockStatements(1, 1, -1), [])
  console.log('PASS no activation for skipped, already released or zero-delta stock')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
