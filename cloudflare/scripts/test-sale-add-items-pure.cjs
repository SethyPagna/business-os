// Adding products to an EXISTING sale (S4-24b, lib/saleLineAddition.ts).
//
// This is stock-correctness code, so every case here is driven against a
// real in-memory schema carrying the same CHECK(quantity >= 0) constraints
// production has -- not against a mock that would happily accept an
// oversell.
//
//   1. guard: which statuses accept a line, and that recorded returns
//      refuse one whatever the status label says
//   2. completed sale + one line   -> branch stock, product rollup, the
//                                     line's lot, a 'sale' movement, and an
//                                     allocation row with released_quantity 0
//   3. multi-lot FIFO split        -> both lots drawn oldest-first, the
//                                     movement's batch_id left NULL (not
//                                     attributable), one allocation row per lot
//   4. awaiting_payment sale       -> NOTHING moves, but the lot attribution
//                                     is still recorded with
//                                     released_quantity = quantity
//   5. two lines, one product      -> the second cannot re-take the units
//                                     the first already allocated
//   6. totals                      -> subtotal re-summed, discount/tax/
//                                     delivery/tender FROZEN, change
//                                     re-derived by the shared function
//   7. UNDO                        -> reverses the line AND its stock: every
//                                     one of the four stock tables is back to
//                                     its pre-addition number, the units land
//                                     in the SAME lots, and the sale's money
//                                     columns are restored
//   8. oversell                    -> the strict decrement aborts the whole
//                                     batch through the CHECK constraint
//   9. source locks on routes/sales.ts + lib/undoAppliers.ts wiring
//
// Run: node scripts/test-sale-add-items-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const salesStatus = compile('salesStatus.ts')
const productBatches = compile('productBatches.ts', {
  './db': {},
  './batchCode': compile('batchCode.ts'),
  './sqlBinding': compile('sqlBinding.ts'),
})
const saleTransitions = compile('saleTransitions.ts', { './salesStatus': salesStatus, './productBatches': productBatches })
const saleTotals = compile('saleTotals.ts')
const subject = compile('saleLineAddition.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
})

const {
  SALE_STATUSES_ACCEPTING_NEW_LINES,
  guardSaleLineAddition,
  saleStatusDeductsStock,
  allocateNewSaleLines,
  planSaleLineAddition,
  buildAllocationStatements,
  planSaleLineRemoval,
  plannedLineFromRecord,
  recomputeSaleMoneyAfterLineChange,
  saleMoneyUpdateStatement,
} = subject

// ---------------------------------------------------------------------------
// A schema with production's real constraints.
// ---------------------------------------------------------------------------
function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock_quantity REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0 CHECK(quantity >= 0), UNIQUE(product_id, branch_id));
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0 CHECK(quantity >= 0), updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE sale_item_batch_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_item_id INTEGER, batch_id INTEGER,
      branch_id INTEGER, quantity REAL, lot_code TEXT, expiry_date TEXT, released_at TEXT, released_quantity REAL NOT NULL DEFAULT 0);
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT,
      branch_id INTEGER, movement_type TEXT, quantity REAL, unit_cost_usd REAL, unit_cost_khr REAL,
      reason TEXT, reference_id INTEGER, user_id INTEGER, user_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      batch_id INTEGER);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER, product_name TEXT,
      quantity REAL, applied_price_usd REAL, applied_price_khr REAL, cost_price_usd REAL, cost_price_khr REAL,
      total_usd REAL, total_khr REAL, branch_id INTEGER, price_mode TEXT,
      base_price_usd REAL, base_price_khr REAL, batch_id INTEGER, batch_label TEXT, batch_expiry_date TEXT);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, receipt_number TEXT, sale_status TEXT, branch_id INTEGER,
      exchange_rate REAL DEFAULT 4100, subtotal_usd REAL, subtotal_khr REAL, discount_usd REAL DEFAULT 0,
      membership_discount_usd REAL DEFAULT 0, tax_usd REAL DEFAULT 0, is_delivery INTEGER DEFAULT 0,
      delivery_fee_usd REAL DEFAULT 0, delivery_fee_paid_by TEXT DEFAULT 'customer',
      total_usd REAL, total_khr REAL, amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
      change_usd REAL DEFAULT 0, change_khr REAL DEFAULT 0, updated_at TEXT);
  `)
  const apply = (statements) => {
    const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params || {})))
    return run()
  }
  return { sqlite, apply }
}

// One product, 20 on the shelf at branch 1, split across two lots:
// lot 501 (older, 8 units) and lot 502 (newer, 6 units); 6 units are legacy
// aggregate stock the lot ledger never tracked.
function seedShelf(sqlite, { shelf = 20, lot501 = 8, lot502 = 6 } = {}) {
  sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', @shelf)`).run({ shelf })
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, @shelf)`).run({ shelf })
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (501, 1, @q)`).run({ q: lot501 })
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (502, 1, @q)`).run({ q: lot502 })
}

// FIFO availability exactly as readFifoLotAvailabilityForCart would return
// it: oldest received first.
const lotsFor = (a = 8, b = 6) => new Map([['10:1', [
  { batchId: 501, lotCode: 'L-501', expiryDate: '2027-01-01', available: a },
  { batchId: 502, lotCode: 'L-502', expiryDate: '2027-06-01', available: b },
]]])

const LINE = (quantity, overrides = {}) => ({
  productId: 10,
  productName: 'Serum',
  quantity,
  branchId: 1,
  unitPriceUsd: 3,
  costPriceUsd: 1.5,
  costPriceKhr: 6000,
  batchId: null,
  batchLabel: null,
  batchExpiryDate: null,
  ...overrides,
})

const num = (sqlite, sql, params = {}) => {
  const row = sqlite.prepare(sql).get(params)
  return row ? Number(Object.values(row)[0]) : 0
}

// ---- 1: the status guard ---------------------------------------------------
assert.deepStrictEqual([...SALE_STATUSES_ACCEPTING_NEW_LINES].sort(), ['awaiting_delivery', 'awaiting_payment', 'completed'])
for (const status of ['completed', 'awaiting_delivery', 'awaiting_payment']) {
  assert.deepStrictEqual(guardSaleLineAddition(status), { ok: true }, `${status} must accept a new line`)
}
for (const status of ['cancelled', 'returned', 'partial_return']) {
  const result = guardSaleLineAddition(status)
  assert.strictEqual(result.ok, false, `${status} must refuse a new line`)
  assert.ok(result.error && result.error.length > 20, `${status} must say why in plain words`)
}
// The label is not the authority: a sale still marked 'completed' underneath
// real return records is refused too.
assert.strictEqual(guardSaleLineAddition('completed', true).ok, false)
assert.match(guardSaleLineAddition('completed', true).error, /Returns flow/i)
// And only the two deducted statuses move stock.
assert.strictEqual(saleStatusDeductsStock('completed'), true)
assert.strictEqual(saleStatusDeductsStock('awaiting_delivery'), true)
assert.strictEqual(saleStatusDeductsStock('awaiting_payment'), false)
console.log('PASS 1 -- which statuses accept a new line, and which move stock for it')

// ---- 2: a line added to a completed sale moves real stock ------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const lines = allocateNewSaleLines([LINE(5)], lotsFor(), 'completed')
  assert.strictEqual(lines[0].heldUnits, 5, 'a completed sale holds the new units out')
  assert.deepStrictEqual(lines[0].takes.map((t) => [t.batchId, t.quantity]), [[501, 5]], 'oldest lot first')
  assert.strictEqual(lines[0].movementBatchId, 501, 'one lot covered the line, so the movement is attributable')

  const plan = planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines, exchangeRate: 4100, userId: 9, userName: 'Sokha' })
  assert.strictEqual(plan.deductedUnits, 5)
  assert.deepStrictEqual(plan.deductions, [{ product_id: 10, branch_id: 1, quantity: 5 }])
  assert.strictEqual(plan.addedSubtotalUsd, 15)

  const results = apply(plan.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 15, 'branch stock went down by 5')
  assert.strictEqual(num(sqlite, 'SELECT stock_quantity FROM products'), 15, 'the all-branches rollup moved too')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 3, 'the drawn lot went down by 5')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 502'), 6, 'the untouched lot is untouched')

  const movement = sqlite.prepare(`SELECT * FROM inventory_movements`).get()
  assert.strictEqual(movement.movement_type, 'sale')
  assert.strictEqual(movement.quantity, -5, 'a sale movement is negative')
  assert.strictEqual(movement.batch_id, 501)
  assert.strictEqual(movement.reference_id, 77)
  assert.strictEqual(movement.user_name, 'Sokha')

  const item = sqlite.prepare('SELECT * FROM sale_items').get()
  assert.strictEqual(item.sale_id, 77)
  assert.strictEqual(item.total_usd, 15)
  assert.strictEqual(item.total_khr, 61500)
  assert.strictEqual(item.batch_id, 501, 'a single-lot line stamps its lot on the row')
  assert.strictEqual(item.base_price_usd, 3, 'base defaults to applied: no manual discount')

  const saleItemId = Number(results[plan.saleItemStatementIndexByLine[0]].lastInsertRowid)
  apply(buildAllocationStatements(plan.lines, [saleItemId]))
  const alloc = sqlite.prepare('SELECT * FROM sale_item_batch_allocations').get()
  assert.strictEqual(alloc.batch_id, 501)
  assert.strictEqual(alloc.quantity, 5)
  assert.strictEqual(alloc.released_quantity, 0, 'the units are OUT with the sale')
  assert.strictEqual(alloc.released_at, null)
  assert.strictEqual(alloc.lot_code, 'L-501')
}
console.log('PASS 2 -- a line added to a completed sale deducts branch, product, lot, and logs a sale movement')

// ---- 3: a line that spans two lots ----------------------------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const lines = allocateNewSaleLines([LINE(11)], lotsFor(), 'completed')
  assert.deepStrictEqual(lines[0].takes.map((t) => [t.batchId, t.quantity]), [[501, 8], [502, 3]], 'FIFO drains the older lot first')
  assert.strictEqual(lines[0].movementBatchId, null, 'a multi-lot line is not attributable to one lot')

  const plan = planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines, exchangeRate: 4100, userId: null, userName: null })
  const results = apply(plan.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 9)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 0)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 502'), 3)
  assert.strictEqual(sqlite.prepare('SELECT batch_id FROM inventory_movements').get().batch_id, null)
  assert.strictEqual(sqlite.prepare('SELECT batch_id FROM sale_items').get().batch_id, null, 'and the row keeps NULL too')

  const saleItemId = Number(results[plan.saleItemStatementIndexByLine[0]].lastInsertRowid)
  apply(buildAllocationStatements(plan.lines, [saleItemId]))
  const allocs = sqlite.prepare('SELECT batch_id, quantity FROM sale_item_batch_allocations ORDER BY id').all()
  assert.deepStrictEqual(allocs, [{ batch_id: 501, quantity: 8 }, { batch_id: 502, quantity: 3 }],
    'the per-lot detail is what makes a later return go back to the right lots')
}
console.log('PASS 3 -- a multi-lot line drains FIFO and records one allocation row per lot')

// ---- 4: awaiting_payment records the line and moves NOTHING ----------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const lines = allocateNewSaleLines([LINE(5)], lotsFor(), 'awaiting_payment')
  assert.strictEqual(lines[0].heldUnits, 0, 'nothing has left the shelf on an unpaid sale')
  const plan = planSaleLineAddition({ saleId: 77, saleStatus: 'awaiting_payment', lines, exchangeRate: 4100, userId: null, userName: null })
  assert.strictEqual(plan.deductedUnits, 0)
  assert.deepStrictEqual(plan.deductions, [])
  const results = apply(plan.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 20, 'branch stock untouched')
  assert.strictEqual(num(sqlite, 'SELECT stock_quantity FROM products'), 20, 'product rollup untouched')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 8, 'lot untouched')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM inventory_movements'), 0, 'and no movement was invented')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_items'), 1, 'the line itself IS recorded')

  const saleItemId = Number(results[plan.saleItemStatementIndexByLine[0]].lastInsertRowid)
  apply(buildAllocationStatements(plan.lines, [saleItemId]))
  const alloc = sqlite.prepare('SELECT * FROM sale_item_batch_allocations').get()
  assert.strictEqual(alloc.released_quantity, 5,
    'the lot attribution is recorded as fully released -- the later completing transition draws it back down')
  assert.ok(alloc.released_at, 'and stamped, same shape POST / gives a non-deducting sale')
}
console.log('PASS 4 -- a line added to an awaiting-payment sale moves no stock but still records its lots')

// ---- 5: two lines of one product cannot double-take a lot -----------------
{
  const lines = allocateNewSaleLines([LINE(5), LINE(5)], lotsFor(), 'completed')
  assert.deepStrictEqual(lines[0].takes.map((t) => [t.batchId, t.quantity]), [[501, 5]])
  assert.deepStrictEqual(lines[1].takes.map((t) => [t.batchId, t.quantity]), [[501, 3], [502, 2]],
    'the second line sees the first line has already taken 5 of lot 501')
}
console.log('PASS 5 -- two lines of the same product share one pool of lot availability')

// ---- 6: the totals rules --------------------------------------------------
{
  // A sale of $40 with a $5 cash discount, $2 tax, a $3 customer-paid
  // delivery fee, paid $40 in cash. Adding $15 of goods must move the
  // subtotal and the total ONLY.
  const sale = {
    exchange_rate: 4100,
    discount_usd: 5,
    membership_discount_usd: 0,
    tax_usd: 2,
    is_delivery: 1,
    delivery_fee_usd: 3,
    delivery_fee_paid_by: 'customer',
    amount_paid_usd: 40,
    amount_paid_khr: 0,
  }
  const before = recomputeSaleMoneyAfterLineChange({ sale, subtotalUsd: 40 })
  assert.strictEqual(before.totalUsd, 40, '40 - 5 + 2 + 3')
  assert.strictEqual(before.changeUsd, 0)

  const after = recomputeSaleMoneyAfterLineChange({ sale, subtotalUsd: 55 })
  assert.strictEqual(after.subtotalUsd, 55, 'subtotal is re-summed from the lines')
  assert.strictEqual(after.totalUsd, 55, '55 - 5 (discount FROZEN) + 2 (tax FROZEN) + 3 (fee FROZEN)')
  assert.strictEqual(after.amountPaidUsd, 40, 'the customer did not hand over more money')
  assert.strictEqual(after.subtotalKhr, Math.round(55 * 4100))
  assert.strictEqual(after.totalKhr, Math.round(55 * 4100))
  // The consequence the shop actually sees: an outstanding balance appears.
  assert.strictEqual(Math.round((after.totalUsd - after.amountPaidUsd) * 100) / 100, 15)

  // A discount that recomputed pro-rata would have grown from 5 to 6.875 and
  // silently handed the customer $1.88 -- pin that it does not.
  assert.notStrictEqual(after.totalUsd, 55 - 6.875 + 2 + 3)

  // A store-absorbed delivery fee stays out of the total, same rule as POST /.
  const storePaid = recomputeSaleMoneyAfterLineChange({ sale: { ...sale, delivery_fee_paid_by: 'store' }, subtotalUsd: 55 })
  assert.strictEqual(storePaid.totalUsd, 52)

  // A genuinely-zero tender must survive rather than falling back to the new
  // total -- the exact bug lib/saleTotals.ts documents.
  const unpaid = recomputeSaleMoneyAfterLineChange({
    sale: { ...sale, amount_paid_usd: 0, amount_paid_khr: 0 },
    subtotalUsd: 55,
  })
  assert.strictEqual(unpaid.amountPaidUsd, 0, 'zero tendered stays zero, it does not become "paid in full"')
  assert.strictEqual(unpaid.totalUsd, 55)
}
console.log('PASS 6 -- subtotal is recomputed; discount, tax, delivery fee and tender stay frozen')

// ---- 7: UNDO reverses the line AND its stock ------------------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  sqlite.prepare(`INSERT INTO sales (id, receipt_number, sale_status, branch_id, exchange_rate,
    subtotal_usd, subtotal_khr, discount_usd, tax_usd, total_usd, total_khr, amount_paid_usd, change_usd, change_khr)
    VALUES (77, '20260904-101500', 'completed', 1, 4100, 40, 164000, 5, 2, 37, 151700, 37, 0, 0)`).run()

  const moneyBefore = { subtotal_usd: 40, subtotal_khr: 164000, total_usd: 37, total_khr: 151700, change_usd: 0, change_khr: 0 }

  // Forward: an 11-unit line spanning both lots (the hardest case to reverse).
  const lines = allocateNewSaleLines([LINE(11)], lotsFor(), 'completed')
  const plan = planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines, exchangeRate: 4100, userId: 9, userName: 'Sokha' })
  const money = recomputeSaleMoneyAfterLineChange({
    sale: sqlite.prepare('SELECT * FROM sales WHERE id = 77').get(),
    subtotalUsd: 40 + plan.addedSubtotalUsd,
  })
  const moneyAfter = {
    subtotal_usd: money.subtotalUsd, subtotal_khr: money.subtotalKhr,
    total_usd: money.totalUsd, total_khr: money.totalKhr,
    change_usd: money.changeUsd, change_khr: money.changeKhr,
  }
  const results = apply([...plan.statements, saleMoneyUpdateStatement(77, moneyAfter)])
  const saleItemId = Number(results[plan.saleItemStatementIndexByLine[0]].lastInsertRowid)
  apply(buildAllocationStatements(plan.lines, [saleItemId]))

  assert.strictEqual(num(sqlite, 'SELECT total_usd FROM sales WHERE id = 77'), 70, '40 + 33 - 5 + 2')
  assert.strictEqual(num(sqlite, 'SELECT subtotal_usd FROM sales WHERE id = 77'), 73)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 9)

  // Undo, exactly as the 'sale.add_items' applier replays it.
  const record = {
    saleItemId,
    productId: 10,
    productName: 'Serum',
    quantity: 11,
    branchId: 1,
    heldUnits: plan.lines[0].heldUnits,
    unitPriceUsd: 3,
    lineTotalUsd: 33,
    costPriceUsd: 1.5,
    costPriceKhr: 6000,
    takes: plan.lines[0].takes,
  }
  const removal = planSaleLineRemoval({
    saleId: 77, lines: [record], reason: 'Undo: items added to sale 20260904-101500 removed', userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(removal.restoredUnits, 11)
  apply([...removal.statements, saleMoneyUpdateStatement(77, moneyBefore)])

  // The whole point: every number is back where it started.
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 20, 'branch stock restored')
  assert.strictEqual(num(sqlite, 'SELECT stock_quantity FROM products'), 20, 'product rollup restored')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 8, 'lot 501 got its 8 back')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 502'), 6, 'lot 502 got its 3 back')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_items'), 0, 'the added line is gone')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_item_batch_allocations'), 0, 'and so is its lot attribution')
  assert.strictEqual(num(sqlite, 'SELECT subtotal_usd FROM sales WHERE id = 77'), 40, 'the sale is back to its old subtotal')
  assert.strictEqual(num(sqlite, 'SELECT total_usd FROM sales WHERE id = 77'), 37, 'and its old total')

  // Stock came back as a NEW movement, not by editing the original one.
  const movements = sqlite.prepare('SELECT movement_type, quantity, reason FROM inventory_movements ORDER BY id').all()
  assert.strictEqual(movements.length, 2, 'the sale movement is still on the ledger')
  assert.strictEqual(movements[0].movement_type, 'sale')
  assert.strictEqual(movements[0].quantity, -11)
  assert.strictEqual(movements[1].movement_type, 'return')
  assert.strictEqual(movements[1].quantity, 11)
  assert.match(movements[1].reason, /Undo/, 'and the reason says what happened')

  // REDO re-draws the SAME lots, not whatever FIFO would pick now.
  const redoLines = [plannedLineFromRecord(record)]
  assert.deepStrictEqual(redoLines[0].takes.map((t) => [t.batchId, t.quantity]), [[501, 8], [502, 3]])
  const redoPlan = planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines: redoLines, exchangeRate: 4100, userId: 9, userName: 'Sokha' })
  apply([...redoPlan.statements, saleMoneyUpdateStatement(77, moneyAfter)])
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 0)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 502'), 3)
  assert.strictEqual(num(sqlite, 'SELECT total_usd FROM sales WHERE id = 77'), 70)
}
console.log('PASS 7 -- undo reverses the line, its lots, its stock and the sale money; redo re-draws the same lots')

// ---- 7b: undoing a line that never moved stock moves none back ------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const lines = allocateNewSaleLines([LINE(5)], lotsFor(), 'awaiting_payment')
  const plan = planSaleLineAddition({ saleId: 78, saleStatus: 'awaiting_payment', lines, exchangeRate: 4100, userId: null, userName: null })
  const results = apply(plan.statements)
  const saleItemId = Number(results[plan.saleItemStatementIndexByLine[0]].lastInsertRowid)
  const removal = planSaleLineRemoval({
    saleId: 78,
    lines: [{ saleItemId, productId: 10, productName: 'Serum', quantity: 5, branchId: 1, heldUnits: 0, unitPriceUsd: 3, lineTotalUsd: 15, costPriceUsd: 1.5, costPriceKhr: 6000, takes: plan.lines[0].takes }],
    reason: 'Undo', userId: null, userName: null,
  })
  assert.strictEqual(removal.restoredUnits, 0, 'nothing went out, so nothing comes back')
  apply(removal.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 20, 'and the shelf is not credited twice')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 8)
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM inventory_movements'), 0)
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_items'), 0)
}
console.log('PASS 7b -- undoing a non-deducting line credits nothing back (symmetry with heldQuantity)')

// ---- 8: an oversell aborts the whole batch, it is never clamped -----------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite, { shelf: 4, lot501: 4, lot502: 0 })
  // The plan was built against availability read a moment ago; a concurrent
  // sale has since taken the units. branch_stock's CHECK is the real guard.
  const lines = allocateNewSaleLines([LINE(5)], lotsFor(5, 0), 'completed')
  const plan = planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines, exchangeRate: 4100, userId: null, userName: null })
  assert.throws(() => apply(plan.statements), /CHECK constraint failed/i, 'an oversell must abort, not clamp')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 4, 'and nothing at all was applied')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_items'), 0, 'no orphan line survived the rollback')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM inventory_movements'), 0)
}
console.log('PASS 8 -- an oversell aborts the whole batch through the CHECK constraint')

// ---- 8b: the same, for a product with NO lot ledger at all ---------------
// Case 8 is caught by branch_batch_stock's CHECK, so it would still pass if
// the branch_stock deduction were silently clamped with MAX(0, ...). This
// case has no lots, so branch_stock's own CHECK is the only guard left --
// a clamp here would swallow the oversell and lose stock quietly, which is
// exactly the failure POST /'s own comment warns about.
{
  const { sqlite, apply } = setup()
  sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', 4)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 4)`).run()
  const lines = allocateNewSaleLines([LINE(5)], new Map(), 'completed')
  assert.deepStrictEqual(lines[0].takes, [], 'untracked stock is allocated to no lot, exactly as at checkout')
  const plan = planSaleLineAddition({ saleId: 77, saleStatus: 'completed', lines, exchangeRate: 4100, userId: null, userName: null })
  assert.throws(() => apply(plan.statements), /CHECK constraint failed/i,
    'branch_stock must abort, never clamp -- a clamped deduction loses the units with no error')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 4)
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_items'), 0)
}
console.log('PASS 8b -- an unlotted oversell aborts on branch_stock itself, it is never clamped')

// ---- 9: source locks on the wiring ---------------------------------------
{
  const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  assert.match(route, /app\.post\('\/:id\/items'/, 'the endpoint exists')
  // ...and is REGISTERED, which the text match above cannot tell you. A
  // splice that lands one line early puts the whole route inside the handler
  // above it, after that handler's `return`: it still typechecks, the text
  // is still there, and the endpoint simply 404s forever. So parse the file
  // and require the registration to be a TOP-LEVEL statement.
  {
    const parsed = ts.createSourceFile('sales.ts', route, ts.ScriptTarget.ES2020, true)
    const registered = parsed.statements.some((statement) => {
      if (!ts.isExpressionStatement(statement)) return false
      let call = statement.expression
      while (ts.isAwaitExpression(call)) call = call.expression
      if (!ts.isCallExpression(call)) return false
      const callee = call.expression
      if (!ts.isPropertyAccessExpression(callee)) return false
      if (callee.expression.getText() !== 'app' || callee.name.getText() !== 'post') return false
      const first = call.arguments[0]
      return !!first && ts.isStringLiteral(first) && first.text === '/:id/items'
    })
    assert.ok(registered, 'POST /:id/items must be registered at the top level of routes/sales.ts, not nested inside another handler')
  }
  assert.match(route, /getActionTier\(user, 'sales', 'add_items'\) !== 'full'/, 'and is gated SERVER-side on the granular action at full tier')
  assert.match(route, /guardSaleLineAddition\(saleStatus, !!returnedRow\)/, 'the status guard is given the returns evidence, not just the label')
  assert.match(route, /readFifoLotAvailabilityForCart/, 'lots come from the checkout FIFO reader, not a second copy')
  assert.match(route, /assertUpdatedAtMatch\('sale', sale, getExpectedUpdatedAt\(body\)\)/, 'optimistic concurrency, same as the other sale writes')
  assert.match(route, /recordSaleAddItemsUndoSnapshot/, 'a real undo payload is recorded')
  assert.match(route, /saleMoneyUpdateStatement\(saleId, moneyAfter\)/, 'the money update rides the SAME atomic batch as the lines')
  // The peer-owned status handler must be untouched by this lane.
  assert.match(route, /app\.patch\('\/:id\/status'/, 'the status route is still there')

  const appliers = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
  // Registration is checked by LOADING the module and asking its own
  // resolver, not by matching text: an applier can be spelled correctly and
  // still sit outside the APPLIERS table, in which case the history row's
  // Undo button silently does nothing -- the exact failure this lane was
  // told not to repeat.
  {
    const undoModule = compile('undoAppliers.ts', {
      './db': { getDb: () => ({}) },
      './audit': { audit: async () => {} },
      '../durable-objects/broadcastHub': { broadcast: async () => {} },
      './branchWrites': { branchUpdateStatements: () => [] },
      './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
      './saleLineAddition': subject,
    })
    const resolved = undoModule.resolveUndoApplier({ applier: 'sale.add_items', snapshot_id: 1 })
    assert.ok(resolved, "resolveUndoApplier must find 'sale.add_items' -- an unregistered applier makes Undo a no-op")
    assert.strictEqual(resolved.permission, 'sales')
    assert.strictEqual(resolved.action, 'add_items',
      'the replay is gated on the same granular action the route gates on')
    const payload = { applier: 'sale.add_items', snapshot_id: 1 }
    assert.strictEqual(undoModule.isServerReplayable({ reversible: 1, status: 'undoable' }, payload, payload), true,
      'so the history row is server-replayable and its Undo survives a reload')
  }
  assert.match(appliers, /'sale\.add_items':\s*\{/, 'the applier is registered, so resolveUndoApplier can find it')
  assert.match(appliers, /action: 'add_items'/, 'and declares the same granular action the route gates on')
  assert.match(appliers, /planSaleLineRemoval/, 'undo goes through the shared reversal planner')
  assert.match(appliers, /planSaleLineAddition/, 'and redo through the shared forward planner -- no second copy of the SQL')

  const actions = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'permissionActions.ts'), 'utf8')
  assert.match(actions, /key: 'add_items'/, 'the action is offered in the permissions UI, so it can actually be granted')
}
console.log('PASS 9 -- route, applier and permission-action wiring are all in place')

console.log('\nAll sale add-items checks passed.')
