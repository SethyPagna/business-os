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
const additions = load('saleLineAddition.ts')
// Exercise the planner against legacy inactive-positive state. Migration 0154
// prevents that state at the database boundary and has its own invariant tests.
const migrationsDir = path.resolve(__dirname, '../migrations')
const db = openDb(fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql') && file < '0154')
  .sort().map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8')))
db.exec("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1); INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',0)")
const receive = (branchId, quantity, receivedDate) => db.batch(batches.planReceiveBatchStock({ productId: 1, branchId, quantity, receivedDate }).statements)
const plan = (quantity, extra = {}) => batches.planReconcileBranchSnapshot({ productId: 1, branchId: 1, quantity, receivedDate: '10/09/2026', ...extra })
const snapshot = (quantity, extra) => db.batch(plan(quantity, extra))
const lots = (branchId = 1) => db.prepare(`SELECT pb.id,pb.received_at,pb.batch_key,pb.is_active,bbs.quantity
  FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id=pb.id
  WHERE pb.variant_product_id=1 AND bbs.branch_id=? ORDER BY pb.id`).all([branchId])
function parity(expected) {
  assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, expected)
  assert.equal(lots().reduce((sum, lot) => sum + lot.quantity, 0), expected, 'all attributed lots equal the branch snapshot')
  assert.equal(db.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, expected + 8)
  assert.equal(lots(2).reduce((sum, lot) => sum + lot.quantity, 0), 8, 'other branch is unchanged')
}
const setActive = (id, active) => db.prepare('UPDATE product_batches SET is_active=? WHERE id=?').run([active, id])

async function main() {
  await receive(1, 4, '02/01/2026')
  await receive(1, 6, '04/03/2026')
  await receive(2, 8, '04/03/2026')
  const archivedId = lots()[0].id
  setActive(archivedId, 0)
  const original = lots()
  await snapshot(10)
  parity(10)
  assert.deepEqual(lots(), original, 'same-count import cannot duplicate archived units')
  assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true })).reduce((sum, lot) => sum + lot.quantity, 0), 6)
  setActive(archivedId, 1)
  assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true })).reduce((sum, lot) => sum + lot.quantity, 0), 10, 'reactivation reveals exactly the original total')
  setActive(archivedId, 0)
  await snapshot(15, { batchId: 100 })
  parity(15)
  assert.deepEqual(lots().map((lot) => [lot.is_active, lot.quantity]), [[0, 4], [1, 6], [1, 5]])
  const grown = lots()
  await snapshot(15)
  assert.deepEqual(lots(), grown, 'redelivery is idempotent')
  await snapshot(3)
  parity(3)
  assert.deepEqual(lots().map((lot) => lot.quantity), [3, 0, 0], 'shrink ranks inactive provenance too')
  assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true })).length, 0, 'archived units remain unavailable to POS')
  const unlotted = additions.allocateNewSaleLines([{ productId: 1, productName: 'A', branchId: 1, quantity: 1, unitPriceUsd: 1, unlottedStock: true }], new Map(), 'completed')
  await assert.rejects(db.batch(additions.planUnlottedSaleLineGuards(unlotted)), /constraint/i, 'archived provenance cannot be sold as unlotted stock')
  await snapshot(0)
  parity(0)
  assert.ok(lots().every((lot) => lot.quantity === 0), 'zero snapshot empties inactive stock too')
  setActive(archivedId, 1)
  assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true })).length, 0, 'reactivation after zero cannot resurrect stock')
  await snapshot(5)
  parity(5)
  assert.equal(lots().find((lot) => lot.id === 100).quantity, 5)
  console.log('PASS inactive ordinary lots: unchanged/grow/repeat/shrink/zero/regrow, reactivation, POS and unlotted parity, branch isolation')

  // A snapshot lot can itself be archived. Residual growth needs a new active
  // receipt without adding the previously archived quantity a second time.
  setActive(100, 0)
  await snapshot(7, { batchId: 200 })
  parity(7)
  assert.deepEqual(lots().filter((lot) => lot.quantity > 0).map((lot) => [lot.id, lot.is_active, lot.quantity]), [[100, 0, 5], [200, 1, 2]])
  assert.equal(lots().find((lot) => lot.id === 200).received_at, '2026-09-10')
  assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true }))[0].quantity, 2)
  await snapshot(9)
  parity(9)
  assert.equal(lots().find((lot) => lot.id === 200).quantity, 4, 'subsequent growth reuses the active replacement')
  const repeated = lots()
  await snapshot(9)
  assert.deepEqual(lots(), repeated)
  setActive(200, 0)
  await snapshot(10)
  parity(10)
  const third = lots().find((lot) => lot.quantity === 1)
  assert.ok(third && third.is_active === 1 && third.id !== 100 && third.id !== 200)
  assert.equal(lots().find((lot) => lot.id === 100).is_active, 0)
  assert.equal(lots().find((lot) => lot.id === 200).is_active, 0)
  setActive(100, 1)
  setActive(200, 1)
  assert.equal((await batches.listBatchesForProduct(db, 1, 1, { onlyAvailable: true })).reduce((sum, lot) => sum + lot.quantity, 0), 10)
  console.log('PASS archived snapshot lots: residual-only active replacement, replacement reuse, repeated archive and reactivation')

  const beforeFailure = lots()
  await assert.rejects(db.batch([...plan(20), { sql: 'INSERT INTO sale_bulk_guards(guard_value) VALUES(0)' }]), /constraint/i)
  assert.deepEqual(lots(), beforeFailure)
  parity(10)
  setActive(100, 0)
  await snapshot(0)
  parity(0)
  await snapshot(4)
  parity(4)
  assert.equal(lots().find((lot) => lot.id === 100).is_active, 0)
  console.log('PASS atomic rollback and archived snapshot zero/regrow')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
