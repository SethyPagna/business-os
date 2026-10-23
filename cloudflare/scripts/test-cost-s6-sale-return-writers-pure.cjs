const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// Cost-unknown slice S6 (owner, 14 Oct 2026): "if cost is 0$ then it is 0 for loss. if it is none,
// it should also be unknown."
//
// The sale / return / stock-edit movement writers used to turn "no cost recorded" into 0
// (`|| 0`, `Number(x) || 0`, a literal 0, or an INSERT that named no cost column and stored the
// DEFAULT 0). A 0 on a movement now means "free", so those writers must keep NULL as NULL, keep a
// recorded 0 as 0, and carry the item's OWN cost (its line snapshot, its held lot, its source lot)
// instead of inventing one.
//
// Every case runs the writer's real SQL against a real SQLite database built from the real
// migration chain (all four movement cost columns are DEFAULT 0 there, so an omitted column or a
// literal 0 is visible), and every case pairs the NULL case with a recorded-$0 control and a
// recorded-cost control, so neither a `|| 0` nor a `> 0` implementation passes.
//
// COST_S6_SRC_ROOT points the whole test at another copy of the Worker (the base commit) so the
// same file can be run red-before / green-after.
//
// Run: node scripts/test-cost-s6-sale-return-writers-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')
const currentAdmission = withProductStockGuard(require)('./stockTransaction')

const root = process.env.COST_S6_SRC_ROOT ? path.resolve(process.env.COST_S6_SRC_ROOT) : path.join(__dirname, '..')
const REAL = new Set([
  'salesStatus', 'productBatches', 'receivingBranch', 'batchCode', 'sqlBinding', 'moneyPrecision', 'saleTotals',
  'saleMoneyPrecision', 'financialPrecision', 'saleLineAddition','saleRaisedAfterPayment', 'saleItemPricing', 'promotionRules', 'saleTransitions',
  'saleAmendments', 'returnsStock', 'stockCondition', 'productDelete', 'actorSnapshot',
])
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const require_ = (name) => {
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      return REAL.has(path.posix.basename(name)) ? load(target) : {}
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(withProductStockGuard(require_), mod, mod.exports)
  return mod.exports
}

const migrations = path.join(__dirname, '..', 'migrations')
const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
for (const file of fs.readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))

const COST = 'unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr'
const movementCosts = () => db.prepare(`SELECT movement_type, quantity, ${COST} FROM inventory_movements ORDER BY id`).all()
const clearMovements = () => db.prepare('DELETE FROM inventory_movements').run()
const run = (statements) => db.transaction(() => statements.map(({ sql, params }) => db.prepare(sql).run(params || {})))()
const isMovementInsert = (statement) => /^\s*INSERT INTO inventory_movements/i.test(statement.sql)
const runMovementsOnly = (statements) => run(statements.filter(isMovementInsert))
const ONLY_MOVEMENT = (statements) => {
  const movements = statements.filter(isMovementInsert)
  assert.equal(movements.length, 1, 'the plan writes exactly one movement row')
  return movements
}

let checks = 0
const failures = []
const ok = (label) => { checks++; console.log(`PASS ${label}`) }
// Each section reports on its own so a red run names every writer that still invents a cost, not just the first.
async function section(name, body) {
  try { await body() } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(String.fromCharCode(10))[0]}`)
  }
}

const UNKNOWN = { unit_cost_usd: null, unit_cost_khr: null, total_cost_usd: null, total_cost_khr: null }
const ZERO = { unit_cost_usd: 0, unit_cost_khr: 0, total_cost_usd: 0, total_cost_khr: 0 }

// ---------------------------------------------------------------------------
// 1. saleTransitions: cancel (stock comes back) and re-activate (stock leaves again)
// ---------------------------------------------------------------------------
;(async () => {
await section("saleTransitions cancel/reactivate", () => {
  const { planSaleStockTransition } = load('lib/saleTransitions.ts')
  const item = (cost) => ({ id: 11, product_id: 10, product_name: 'Serum', quantity: 5, cost_price_usd: cost.usd, cost_price_khr: cost.khr, branch_id: 1, batch_id: null })
  const transition = (oldStatus, newStatus, cost) => planSaleStockTransition({
    saleId: 1, oldStatus, newStatus, items: [item(cost)], returnedByItem: new Map([[11, 0]]), reason: 'cost test', userId: 9, userName: 'Sokha',
  }).statements

  for (const [label, oldStatus, newStatus, type] of [['cancel', 'completed', 'cancelled', 'return'], ['reactivate', 'cancelled', 'completed', 'sale']]) {
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(transition(oldStatus, newStatus, { usd: null, khr: null })))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity: type === 'return' ? 5 : -5, ...UNKNOWN }], `${label}: a line with no recorded cost stores NULL on all four columns (old: 0 and the DEFAULT 0 totals)`)
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(transition(oldStatus, newStatus, { usd: 0, khr: 0 })))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity: type === 'return' ? 5 : -5, ...ZERO }], `${label}: a recorded $0 stays 0, it is not turned into unknown`)
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(transition(oldStatus, newStatus, { usd: 4, khr: 100 })))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity: type === 'return' ? 5 : -5, unit_cost_usd: 4, unit_cost_khr: 100, total_cost_usd: 20, total_cost_khr: 500 }], `${label}: a recorded cost carries its unit and its total`)
  }
  ok('saleTransitions cancel/reactivate: NULL stays NULL, $0 stays 0, a cost carries its total')
})

// ---------------------------------------------------------------------------
// 2. saleAmendments: decrease (units back to the shelf) and increase (units off the shelf)
// ---------------------------------------------------------------------------
await section("saleAmendments decrease/increase", () => {
  const { planLineQuantityDecrease, planLineQuantityIncrease } = load('lib/saleAmendments.ts')
  const sale = { id: 77, sale_status: 'completed', branch_id: 1, exchange_rate: 4100, subtotal_usd: 6, total_usd: 6, stock_skipped: 0 }
  const line = (usd, khr) => ({ id: 1, product_id: 10, product_name: 'Serum', quantity: 2, applied_price_usd: 3, cost_price_usd: usd, cost_price_khr: khr, branch_id: 1 })
  const decrease = (usd, khr) => planLineQuantityDecrease({
    saleId: 77, sale, line: line(usd, khr), removedQuantity: 2, allocations: [{ id: 1, batch_id: 501, branch_id: 1, quantity: 2, released_quantity: 0 }],
    exchangeRate: 4100, reason: 'cost test', userId: 9, userName: 'Sokha',
  }).statements
  const increase = (usd, khr) => planLineQuantityIncrease({
    saleId: 77, sale, line: line(usd, khr), addedQuantity: 3, lots: [{ batchId: 501, lotCode: 'L-501', expiryDate: null, available: 8 }],
    exchangeRate: 4100, userId: 9, userName: 'Sokha', existingAllocations: [],
  }).statements
  for (const [label, plan, type, quantity] of [['decrease', decrease, 'return', 2], ['increase', increase, 'sale', -3]]) {
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(plan(null, null)))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity, ...UNKNOWN }], `amendment ${label}: an unrecorded line cost stays unknown (old: Number(null) || 0)`)
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(plan(0, 0)))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity, ...ZERO }], `amendment ${label}: a recorded $0 stays 0`)
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(plan(1.5, 6000)))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity, unit_cost_usd: 1.5, unit_cost_khr: 6000, total_cost_usd: 1.5 * Math.abs(quantity), total_cost_khr: 6000 * Math.abs(quantity) }], `amendment ${label}: a recorded cost carries its total`)
  }
  ok('saleAmendments line decrease/increase: NULL stays NULL, $0 stays 0')
})

// ---------------------------------------------------------------------------
// 3. saleLineAddition: a line added to a sale, and the undo that removes it again
// ---------------------------------------------------------------------------
await section("saleLineAddition add/remove", () => {
  const { allocateNewSaleLines, planSaleLineAddition, planSaleLineRemoval } = load('lib/saleLineAddition.ts')
  const lots = () => new Map([['10:1', [{ batchId: 501, lotCode: 'L-501', expiryDate: null, available: 8 }]]])
  const newLine = (usd, khr) => ({ productId: 10, productName: 'Serum', quantity: 3, branchId: 1, unitPriceUsd: 3, costPriceUsd: usd, costPriceKhr: khr, batchId: null, batchLabel: null, batchExpiryDate: null })
  const addition = (usd, khr) => planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines: allocateNewSaleLines([newLine(usd, khr)], lots(), 'completed'), exchangeRate: 4100, userId: 9, userName: 'Sokha' }).statements
  const removal = (usd, khr) => planSaleLineRemoval({
    saleId: 77, reason: 'cost test', userId: 9, userName: 'Sokha',
    lines: [{ saleItemId: 5, productId: 10, productName: 'Serum', quantity: 3, branchId: 1, heldUnits: 3, unitPriceUsd: 3, lineTotalUsd: 9, costPriceUsd: usd, costPriceKhr: khr, takes: [{ batchId: 501, quantity: 3 }] }],
  }).statements
  for (const [label, plan, type, quantity] of [['addition', addition, 'sale', -3], ['removal', removal, 'return', 3]]) {
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(plan(null, null)))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity, ...UNKNOWN }], `line ${label}: unknown cost, unknown totals (old: DEFAULT 0 total)`)
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(plan(0, 0)))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity, ...ZERO }], `line ${label}: recorded $0 stays 0`)
    clearMovements()
    runMovementsOnly(ONLY_MOVEMENT(plan(2, 8000)))
    assert.deepEqual(movementCosts(), [{ movement_type: type, quantity, unit_cost_usd: 2, unit_cost_khr: 8000, total_cost_usd: 6, total_cost_khr: 24000 }], `line ${label}: a recorded cost carries its total`)
  }
  ok('saleLineAddition add/remove: NULL stays NULL, $0 stays 0, totals are written')
})

// ---------------------------------------------------------------------------
// 4. returnsStock: the damaged-return movements and the replacement hand-out
// ---------------------------------------------------------------------------
await section("returnsStock damaged-return and replacement", () => {
  const { planDamagedReturnLine, planReplacementStock } = load('lib/returnsStock.ts')
  const damaged = (usd, khr, disposition) => planDamagedReturnLine({
    productId: 10, productName: 'Serum', branchId: 1, batchId: null, returnIdSql: '(SELECT 123)', quantity: 2, reason: 'broken',
    userId: 9, userName: 'Sokha', tag: 'damaged', disposition, unitCostUsd: usd, unitCostKhr: khr,
  }).filter(isMovementInsert)
  for (const [label, disposition, types] of [['keep', 'keep', ['damage_in']], ['remove', 'remove', ['damage_in', 'write_off']]]) {
    clearMovements()
    run(damaged(null, null, disposition))
    assert.deepEqual(movementCosts().map((row) => [row.movement_type, row.unit_cost_usd, row.unit_cost_khr, row.total_cost_usd, row.total_cost_khr]), types.map((type) => [type, null, null, null, null]), `damaged return (${label}): unknown cost stays unknown on every movement it writes`)
    clearMovements()
    run(damaged(0, 0, disposition))
    assert.deepEqual(movementCosts().map((row) => [row.unit_cost_usd, row.total_cost_usd]), types.map(() => [0, 0]), `damaged return (${label}): a recorded $0 stays 0`)
    clearMovements()
    run(damaged(5, 20000, disposition))
    assert.deepEqual(movementCosts().map((row) => [row.unit_cost_usd, row.total_cost_usd, row.total_cost_khr]), types.map(() => [5, 10, 40000]), `damaged return (${label}): a recorded cost carries its total`)
  }
  const replacement = (usd, khr) => planReplacementStock({
    productId: 10, productName: 'Serum', branchId: 1, batchId: null, quantity: 2, unitCostUsd: usd, unitCostKhr: khr, returnIdSql: '(SELECT 123)', returnNumber: 'R-1', userId: 9, userName: 'Sokha',
  }).statements.filter(isMovementInsert)
  clearMovements()
  run(replacement(null, null))
  assert.deepEqual(movementCosts(), [{ movement_type: 'replacement_out', quantity: -2, ...UNKNOWN }], 'replacement hand-out: a product with no recorded cost is unknown, not 0')
  clearMovements()
  run(replacement(0, 0))
  assert.deepEqual(movementCosts(), [{ movement_type: 'replacement_out', quantity: -2, ...ZERO }], 'replacement hand-out: recorded $0 stays 0')
  clearMovements()
  run(replacement(3, 12000))
  assert.deepEqual(movementCosts(), [{ movement_type: 'replacement_out', quantity: -2, unit_cost_usd: 3, unit_cost_khr: 12000, total_cost_usd: 6, total_cost_khr: 24000 }], 'replacement hand-out: a recorded cost carries its total')
  ok('returnsStock damaged-return and replacement movements: NULL stays NULL, $0 stays 0')
})

// ---------------------------------------------------------------------------
// 5. productDelete: the restore of a removed product's sellable stock
// ---------------------------------------------------------------------------
await section("productDelete sellable restore", () => {
  const { productRemoveReplayStatements } = load('lib/productDelete.ts')
  const plan = (batchCost, extraLot) => ({
    version: 1, product_id: 10, reason: 'cost test', product: { id: 10, name: 'Serum', is_active: 1 },
    branch_stock: [{ id: 1, product_id: 10, branch_id: 1, branch_name: 'Shop', quantity: 4, rfid_confirmed_qty: 0 }],
    batches: [{ id: 501, variant_product_id: 10, unit_cost_usd: batchCost, is_active: 1, updated_at: 't' }, ...(extraLot ? [{ id: 502, variant_product_id: 10, unit_cost_usd: 9, is_active: 1, updated_at: 't' }] : [])],
    branch_batch_stock: [{ id: 1, batch_id: 501, branch_id: 1, quantity: extraLot ? 1 : 4, product_id: 10 }, ...(extraLot ? [{ id: 2, batch_id: 502, branch_id: 1, quantity: 3, product_id: 10 }] : [])],
    product_images: [], child_links: [], damaged_lots: [], source_bytes: 0, state_digest: 'x',
  })
  const restore = (p) => productRemoveReplayStatements({
    snapshot: { plan: p, transition_stamp: '2026-10-14 10:00:00' }, operation: { operation_id: 'op-1', review_id: null, undo_snapshot_id: 1 }, direction: 'undo',
    user: { id: 1, name: 'Admin', username: 'admin' }, expectedGeneration: 1, historyId: 1, transitionStamp: '2026-10-14 11:00:00', transitionRequestId: 'req-1',
  }).filter(isMovementInsert)
  const sellable = (statements) => statements.filter((statement) => /json_each\(@rows\)/.test(statement.sql))
  clearMovements()
  run(sellable(restore(plan(null, false))))
  assert.deepEqual(movementCosts(), [{ movement_type: 'add', quantity: 4, ...UNKNOWN }], 'restoring sellable stock held in one lot with no recorded cost writes NULL (old: DEFAULT 0 = a recorded $0)')
  clearMovements()
  run(sellable(restore(plan(0, false))))
  assert.deepEqual(movementCosts(), [{ movement_type: 'add', quantity: 4, unit_cost_usd: 0, unit_cost_khr: null, total_cost_usd: 0, total_cost_khr: null }], 'a lot recorded at $0 restores at $0')
  clearMovements()
  run(sellable(restore(plan(3.5, false))))
  assert.deepEqual(movementCosts(), [{ movement_type: 'add', quantity: 4, unit_cost_usd: 3.5, unit_cost_khr: null, total_cost_usd: 14, total_cost_khr: null }], 'a lot with a recorded cost restores at that lot cost, not the catalog cost')
  clearMovements()
  run(sellable(restore(plan(3.5, true))))
  assert.deepEqual(movementCosts(), [{ movement_type: 'add', quantity: 4, ...UNKNOWN, unit_cost_khr: null }], 'stock spread over two lots has no single honest unit cost: NULL, never a blend')
  ok('productDelete sellable restore: lot cost or NULL, never the DEFAULT 0')
})

// ---------------------------------------------------------------------------
// 6. received_cost_usd running sums: an unknown earlier receipt never becomes known money
// ---------------------------------------------------------------------------
await section("received_cost_usd running sums", async () => {
  const { planReceiveBatchStock } = load('lib/productBatches.ts')
  function lotFixture(receivedCost) {
    seedStockFixture(db, () => {
    db.exec('DELETE FROM branch_batch_stock; DELETE FROM product_batches; DELETE FROM branch_stock; UPDATE products SET stock_quantity = 0; DELETE FROM products; DELETE FROM branches; DELETE FROM stock_session_guards')
    db.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1)").run()
    db.prepare("INSERT INTO products(id,name,is_active,stock_quantity) VALUES(10,'Serum',1,0)").run()
    db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity,received_cost_usd) VALUES(501,10,'2026-09-01','L-501','2026-09-01',1,3,?)").run(receivedCost)
    })
    assert.throws(() => db.prepare("INSERT INTO products(name) VALUES('unadmitted fixture probe')").run(), /stock_transaction_required/)
  }
  const receive = (preimageCost, unitCost = 2) => planReceiveBatchStock({
    productId: 10, branchId: 1, quantity: 5, receivedDate: '2026-09-01', batchId: 501, unitCostUsd: unitCost,
    receiptCostPreimage: { batchExists: true, receivedCostUsd: preimageCost },
  }).statements
  const receivedCostAfter = () => db.prepare('SELECT received_cost_usd, received_quantity FROM product_batches WHERE id=501').get()
  const receiveDb = { batch: async statements => run(statements) }
  const runReceivePlan = statements => currentAdmission.executeStockTransaction(receiveDb, statements, 'retry')

  lotFixture(null)
  await runReceivePlan(receive(null))
  assert.deepEqual(receivedCostAfter(), { received_cost_usd: null, received_quantity: 8 }, 'a lot whose first receipt had no recorded money stays unknown when 5 known units are added (old: 0 + 5 x 2 = 10)')
  lotFixture(0)
  await runReceivePlan(receive(0))
  assert.deepEqual(receivedCostAfter(), { received_cost_usd: 10, received_quantity: 8 }, 'a lot recorded at $0 is a known zero: the known receipt adds to it')
  lotFixture(6)
  await runReceivePlan(receive(6))
  assert.deepEqual(receivedCostAfter(), { received_cost_usd: 16, received_quantity: 8 }, 'known + known sums')
  lotFixture(6)
  await runReceivePlan(receive(6, 0))
  assert.deepEqual(receivedCostAfter(), { received_cost_usd: 6, received_quantity: 8 }, 'a free receipt ($0 unit) added to a known lot adds 0, and the total stays known')

  // The two other running-sum writers apply a signed change to the stored total.
  const stockSessionSource = fs.readFileSync(path.join(root, 'src', 'lib', 'stockSession.ts'), 'utf8').replace(/\r\n/g, '\n')
  const stockInEditSource = fs.readFileSync(path.join(root, 'src', 'lib', 'stockInLineEdit.ts'), 'utf8').replace(/\r\n/g, '\n')
  const sessionSet = /sets\.push\('(received_cost_usd=[^']*@rc[^']*)'\)/.exec(stockSessionSource)
  const editSet = /sets\.push\('(received_cost_usd=[^']*@rcChange[^']*)'\)/.exec(stockInEditSource)
  assert.ok(sessionSet && editSet, 'both running-sum writers are found in the source')
  for (const [label, set, param] of [['stockSession replay', sessionSet[1], 'rc'], ['stockInLineEdit delta', editSet[1], 'rcChange']]) {
    const apply = (stored, change) => {
      db.prepare('UPDATE product_batches SET received_cost_usd = ? WHERE id = 501').run(stored)
      db.prepare(`UPDATE product_batches SET ${set} WHERE id = 501`).run({ [param]: change })
      return db.prepare('SELECT received_cost_usd FROM product_batches WHERE id=501').get().received_cost_usd
    }
    assert.equal(apply(null, 5), null, `${label}: an unknown stored total never becomes known by adding to it (old: COALESCE(x,0)+5)`)
    assert.equal(apply(0, 5), 5, `${label}: a recorded $0 total is known and adds`)
    assert.equal(apply(6, 5), 11, `${label}: known + known sums`)
    assert.equal(apply(6, -9), 0, `${label}: the total never goes below 0`)
  }
  ok('received_cost_usd running sums keep an unknown total unknown (receipt plan, stock-session replay, stock-in line edit)')
})

// ---------------------------------------------------------------------------
// 7. Source locks for the writers that need a database flow to execute (covered by the route tests
//    named here): no cost-inventing coercion is left on a cost field in the slice's files.
// ---------------------------------------------------------------------------
await section("no cost-inventing coercion in source", () => {
  const strip = (text) => text.replace(/\r\n/g, '\n')
  const read = (rel) => strip(fs.readFileSync(path.join(root, 'src', rel), 'utf8'))
  const bad = []
  const patterns = [
    [/cost_price_(usd|khr)\)\s*\|\|\s*0/, 'Number(x.cost_price_*) || 0'],
    [/cost_price_(usd|khr)\s*\|\|\s*0/, 'x.cost_price_* || 0'],
    [/unit_cost_(usd|khr)[^\n]{0,40}\|\|\s*0/, 'unit_cost_* || 0'],
    [/costUsd:\s*0\b|costKhr:\s*0\b/, 'a literal 0 cost on a stock delta'],
  ]
  for (const rel of ['lib/saleTransitions.ts', 'lib/saleAmendments.ts', 'lib/saleBulkStatus.ts', 'lib/returnBulkAction.ts', 'lib/returnsStock.ts', 'lib/saleLineAddition.ts']) {
    const text = read(rel)
    for (const [pattern, label] of patterns) if (pattern.test(text)) bad.push(`${rel}: ${label}`)
  }
  const returns = read('routes/returns.ts')
  for (const [pattern, label] of [
    [/toNumber\(item\.cost_price_usd \?\? item\.unit_cost_usd, 0\)/, 'supplier return cost coerced to 0'],
    [/toNumber\(meta\.cost_price_usd\)/, 'replacement line cost coerced to 0'],
    [/@quantity, 0, 0, @reason/, 'a literal 0, 0 cost on the damage reversal movement'],
    [/COALESCE\(p\.cost_price_usd,0\)=json_extract/, 'the product-cost guard coalescing NULL to 0'],
  ]) if (pattern.test(returns)) bad.push(`routes/returns.ts: ${label}`)
  assert.deepEqual(bad, [], `cost-inventing coercions left in the sale/return writers: ${bad.join('; ')}`)
  ok('no cost-inventing coercion is left in the sale/return writer files')
})

if (failures.length) {
  console.log(`FAILED ${failures.length} section(s)`)
  process.exit(1)
}
console.log(`OK - ${checks} checks passed`)

})().catch(error => { console.error(error); process.exitCode = 1 })
