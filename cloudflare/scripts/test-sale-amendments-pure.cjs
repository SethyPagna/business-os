// Amending a recorded sale as an append-only ledger (S4-30,
// lib/saleAmendments.ts + migration 0115).
//
// This is stock- and money-correctness code, so every case here runs against
// a real in-memory schema carrying production's real CHECK(quantity >= 0)
// constraints AND migration 0115's real triggers -- the migration file is
// read off disk and executed, not retyped, so a trigger that stops working
// fails here rather than in production.
//
//    1. append-only is enforced by the DATABASE: UPDATE and DELETE on a
//       ledger row both abort, and the row survives the attempt
//    2. the two views disagree exactly as intended: the receipt sees net
//       state, the detail sees the whole history
//    3. a REMOVAL vanishes from the receipt but persists in the ledger --
//       the sale_items row is gone, the ledger still knows the product,
//       the quantity, the actor and the time
//    4. INCREASE  -> units leave the shelf, oldest lot first, allocation
//                    rows appended, line quantity and totals raised
//    5. DECREASE  -> units return to the SAME lots in REVERSE draw order,
//                    the allocation row shrinks, the line survives
//    6. REMOVE    -> as above but the allocation rows go and the line row
//                    is DELETED (not zeroed -- a 0-qty row would print)
//    7. a STOCK-SKIPPED sale (S4-2's sticky flag) moves NOTHING in either
//       direction -- no take on an increase, no invented stock on a decrease
//    8. an awaiting_payment sale HOLDS stock (S4-3), so an amendment moves
//       it and its allocation rows carry released_quantity = 0
//    9. a sale with RECORDED RETURNS is refused, for every kind, whatever
//       the status label says
//   10. the EDIT WINDOW: inside it anyone may amend, outside it only an
//       admin, and an unparseable created_at does not grant a free pass
//   11. DELIVERY FEE: $1.50 -> $2.00, the sale row shows the net $2.00 and
//       the total moves by exactly $0.50, while the ledger shows both
//   12. money: subtotal re-summed, both discounts FROZEN
//   13. an oversell aborts the whole batch through the CHECK constraint
//   14. summarizeAmendments: a removal that was undone is not still
//       reported as removed
//   15. source locks: routes/sales.ts and lib/undoAppliers.ts are actually
//       wired to the ledger
//   16. TAX follows the owner's settings switch rather than being frozen:
//       the switch itself (including the absent-key fallback that keeps an
//       existing shop unchanged), the one case that recomputes, and the four
//       that deliberately keep the recorded amount and say why -- plus a
//       source lock that the till and the Worker read the switch identically
//
// Run: node scripts/test-sale-amendments-pure.cjs
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
const financialPrecision = compile('financialPrecision.ts')
const saleLineAddition = compile('saleLineAddition.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
  './financialPrecision': financialPrecision,
})
const subject = compile('saleAmendments.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './saleTotals': saleTotals,
  './saleLineAddition': saleLineAddition,
})

const {
  AMENDMENT_KINDS,
  SALE_STATUSES_ACCEPTING_AMENDMENTS,
  DEFAULT_AMENDMENT_WINDOW_MINUTES,
  resolveAmendmentWindowMinutes,
  parseSqliteTimestampMs,
  guardSaleAmendment,
  saleSkipsStock,
  saleAmendmentMovesStock,
  amendmentHeldUnits,
  planLineQuantityIncrease,
  planLineQuantityDecrease,
  guardDeliveryFeeAmendment,
  planDeliveryFeeChange,
  recomputeSaleMoneyAfterAmendment,
  amendedSaleKeepsReceiptNumber,
  amendmentEntryStatement,
  reversingKind,
  summarizeAmendments,
  resolveTaxSettings,
  taxableBaseUsd,
  resolveAmendedTaxUsd,
  saleTaxUpdateStatement,
} = subject

// ---------------------------------------------------------------------------
// A schema with production's real constraints AND migration 0115's real
// triggers, read off disk so this test cannot drift from what ships.
// ---------------------------------------------------------------------------
const MIGRATION_0115 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '0115_sale_amendments.sql'),
  'utf8',
)

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
    -- stock_skipped is S4-2's sticky flag (migration 0114, a lane that has not
    -- merged into this one's base). It is present HERE so this test can pin
    -- that the kernel honours it the moment 0114 lands; case 7b drives the
    -- pre-merge shape, where the column simply is not there.
    CREATE TABLE sales (id INTEGER PRIMARY KEY, receipt_number TEXT, sale_status TEXT, branch_id INTEGER,
      exchange_rate REAL DEFAULT 4100, subtotal_usd REAL, subtotal_khr REAL, discount_usd REAL DEFAULT 0,
      membership_discount_usd REAL DEFAULT 0, tax_usd REAL DEFAULT 0, is_delivery INTEGER DEFAULT 0,
      delivery_fee_usd REAL DEFAULT 0, delivery_fee_khr REAL DEFAULT 0, delivery_fee_paid_by TEXT DEFAULT 'customer',
      total_usd REAL, total_khr REAL, amount_paid_usd REAL DEFAULT 0, amount_paid_khr REAL DEFAULT 0,
      change_usd REAL DEFAULT 0, change_khr REAL DEFAULT 0, stock_skipped INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT);
  `)
  sqlite.exec(MIGRATION_0115)
  const apply = (statements) => {
    const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params || {})))
    return run()
  }
  return { sqlite, apply }
}

// One product, 20 on the shelf at branch 1, split across lot 501 (older,
// 8 units) and lot 502 (newer, 6 units); 6 units are legacy aggregate stock
// the lot ledger never tracked.
function seedShelf(sqlite, { shelf = 20, lot501 = 8, lot502 = 6 } = {}) {
  sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', @shelf)`).run({ shelf })
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, @shelf)`).run({ shelf })
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (501, 1, @q)`).run({ q: lot501 })
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (502, 1, @q)`).run({ q: lot502 })
}

// A recorded sale: 2 x Serum at $3, delivery $1.50, already paid $7.50.
function seedSale(sqlite, overrides = {}) {
  const sale = {
    id: 77,
    receipt_number: 'RCP-000123',
    sale_status: 'completed',
    branch_id: 1,
    exchange_rate: 4100,
    subtotal_usd: 6,
    tax_usd: 0,
    discount_usd: 0,
    is_delivery: 1,
    delivery_fee_usd: 1.5,
    total_usd: 7.5,
    amount_paid_usd: 7.5,
    stock_skipped: 0,
    created_at: '2026-09-04 10:00:00',
    ...overrides,
  }
  sqlite.prepare(`INSERT INTO sales (id, receipt_number, sale_status, branch_id, exchange_rate, subtotal_usd,
    tax_usd, discount_usd, is_delivery, delivery_fee_usd, total_usd, amount_paid_usd, stock_skipped, created_at)
    VALUES (@id, @receipt_number, @sale_status, @branch_id, @exchange_rate, @subtotal_usd,
    @tax_usd, @discount_usd, @is_delivery, @delivery_fee_usd, @total_usd, @amount_paid_usd, @stock_skipped, @created_at)`).run(sale)
  sqlite.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, applied_price_usd,
    cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id)
    VALUES (1, 77, 10, 'Serum', 2, 3, 1.5, 6000, 6, 24600, 1)`).run()
  return sale
}

// The two units the sale already took, attributed to lot 501.
function seedAllocation(sqlite, { quantity = 2, released = 0, batchId = 501 } = {}) {
  sqlite.prepare(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, lot_code, released_quantity)
    VALUES (1, @batch_id, 1, @quantity, 'L-501', @released)`).run({ quantity, released, batch_id: batchId })
}

const LINE = (overrides = {}) => ({
  id: 1,
  product_id: 10,
  product_name: 'Serum',
  quantity: 2,
  applied_price_usd: 3,
  cost_price_usd: 1.5,
  cost_price_khr: 6000,
  branch_id: 1,
  ...overrides,
})

const lotsFor = (a = 8, b = 6) => [
  { batchId: 501, lotCode: 'L-501', expiryDate: '2027-01-01', available: a },
  { batchId: 502, lotCode: 'L-502', expiryDate: '2027-06-01', available: b },
]

const num = (sqlite, sql, params = {}) => {
  const row = sqlite.prepare(sql).get(params)
  return row ? Number(Object.values(row)[0]) : 0
}

const allocationsOf = (sqlite, saleItemId = 1) => sqlite
  .prepare('SELECT id, batch_id, branch_id, quantity, released_quantity FROM sale_item_batch_allocations WHERE sale_item_id = ? ORDER BY id ASC')
  .all(saleItemId)

const ENTRY = (overrides = {}) => ({
  saleId: 77,
  kind: 'line_removed',
  totalBeforeUsd: 7.5,
  totalAfterUsd: 4.5,
  userId: 9,
  userName: 'Sokha',
  ...overrides,
})

// ---- 1: APPEND-ONLY, enforced by the database ------------------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  seedSale(sqlite)
  apply([amendmentEntryStatement(ENTRY({
    kind: 'line_removed', saleItemId: 1, productId: 10, productName: 'Serum',
    quantityBefore: 2, quantityAfter: 0, unitsMoved: 2,
  }))])
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_amendments'), 1)

  assert.throws(
    () => sqlite.prepare(`UPDATE sale_amendments SET quantity_after = 99 WHERE id = 1`).run(),
    /append-only/i,
    'an UPDATE on a ledger row must abort',
  )
  assert.throws(
    () => sqlite.prepare(`DELETE FROM sale_amendments WHERE id = 1`).run(),
    /append-only/i,
    'a DELETE of a ledger row must abort',
  )
  // The row survived both attempts, unchanged.
  const row = sqlite.prepare('SELECT * FROM sale_amendments WHERE id = 1').get()
  assert.strictEqual(row.quantity_after, 0, 'the refused UPDATE changed nothing')
  assert.strictEqual(row.quantity_delta, -2, 'the delta is derived, not supplied')
  assert.strictEqual(row.user_name, 'Sokha', 'the actor is recorded')
  assert.ok(row.created_at, 'the time is recorded')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_amendments'), 1)

  // And the kind CHECK is real: an invented kind is refused outright.
  assert.throws(
    () => apply([amendmentEntryStatement(ENTRY({ kind: 'line_price_changed' }))]),
    /CHECK constraint/i,
    'a kind outside the closed set must be refused by the schema',
  )
}
console.log('PASS 1 -- the ledger is append-only, and the database is what enforces it')

// ---- 2 + 3: the two views disagree exactly as intended ---------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const sale = seedSale(sqlite)
  seedAllocation(sqlite, { quantity: 2, released: 0 })

  // The customer changed their mind: take the Serum off the sale entirely.
  const plan = planLineQuantityDecrease({
    saleId: 77,
    sale,
    line: LINE(),
    removedQuantity: 2,
    allocations: allocationsOf(sqlite),
    exchangeRate: 4100,
    reason: 'Line removed from sale #77',
    userId: 9,
    userName: 'Sokha',
  })
  apply([...plan.statements, amendmentEntryStatement(ENTRY({
    kind: 'line_removed', saleItemId: 1, productId: 10, productName: 'Serum',
    quantityBefore: 2, quantityAfter: 0, unitsMoved: plan.unitsMoved,
    totalBeforeUsd: 7.5, totalAfterUsd: 1.5,
  }))])

  // WHAT THE RECEIPT SEES -- net state. routes/sales.ts builds the response's
  // `items` from exactly this query, and Sales.tsx hands it to <Receipt>.
  const receiptItems = sqlite.prepare('SELECT * FROM sale_items WHERE sale_id = 77 ORDER BY id ASC').all()
  assert.strictEqual(receiptItems.length, 0, 'a removed line does not appear on the receipt AT ALL')

  // WHAT THE DETAIL SEES -- the whole history, including the line the receipt
  // will never show again.
  const ledger = sqlite.prepare('SELECT * FROM sale_amendments WHERE sale_id = 77 ORDER BY id ASC').all()
  assert.strictEqual(ledger.length, 1)
  assert.strictEqual(ledger[0].kind, 'line_removed')
  assert.strictEqual(ledger[0].product_name, 'Serum', 'the ledger is now the ONLY record that Serum was on this sale')
  assert.strictEqual(ledger[0].quantity_before, 2)
  assert.strictEqual(ledger[0].quantity_delta, -2)
  assert.strictEqual(ledger[0].user_name, 'Sokha')

  // The disagreement is the feature, stated as an assertion.
  assert.notStrictEqual(
    receiptItems.length,
    ledger.filter((entry) => entry.product_id === 10).length,
    'the receipt and the detail view are SUPPOSED to disagree about this sale',
  )

  // And the stock came back, to the lot it came from.
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 22, 'the two units returned to branch stock')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 10, 'to the SAME lot')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 502'), 6, 'the untouched lot is untouched')
  assert.strictEqual(allocationsOf(sqlite).length, 0, 'the emptied allocation row is gone')
  const movement = sqlite.prepare(`SELECT * FROM inventory_movements`).get()
  assert.strictEqual(movement.movement_type, 'return', 'stock comes back with a note, never by editing the original movement')
  assert.strictEqual(movement.quantity, 2)
  assert.strictEqual(movement.batch_id, 501, 'one lot covered it, so the movement is attributable')
}
console.log('PASS 2/3 -- a removal vanishes from the receipt and persists in the ledger, stock and lots restored')

// ---- 4: INCREASE -- "1 and now 2" ------------------------------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const sale = seedSale(sqlite)
  seedAllocation(sqlite, { quantity: 2, released: 0 })

  const plan = planLineQuantityIncrease({
    saleId: 77, sale, line: LINE(), addedQuantity: 3,
    lots: lotsFor(), exchangeRate: 4100, userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(plan.quantityBefore, 2)
  assert.strictEqual(plan.quantityAfter, 5)
  assert.strictEqual(plan.unitsMoved, -3, 'three units leave the shelf')
  assert.strictEqual(plan.subtotalDeltaUsd, 9, '3 more at $3')
  assert.deepStrictEqual(plan.takes.map((t) => [t.batchId, t.quantity]), [[501, 3]], 'oldest lot first')

  apply(plan.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM sale_items WHERE id = 1'), 5, 'the line now says 5')
  assert.strictEqual(num(sqlite, 'SELECT total_usd FROM sale_items WHERE id = 1'), 15, 'and its total followed')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 17)
  assert.strictEqual(num(sqlite, 'SELECT stock_quantity FROM products'), 17)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 5)
  const allocations = allocationsOf(sqlite)
  assert.strictEqual(allocations.length, 2, 'a NEW allocation row is appended, the original is untouched')
  assert.strictEqual(allocations[0].quantity, 2)
  assert.strictEqual(allocations[1].quantity, 3)
  assert.strictEqual(allocations[1].released_quantity, 0, 'the new units are physically out with the sale')
  const movement = sqlite.prepare(`SELECT * FROM inventory_movements`).get()
  assert.strictEqual(movement.movement_type, 'sale')
  assert.strictEqual(movement.quantity, -3)
}
console.log('PASS 4 -- an increase draws units oldest-lot-first and appends its allocation')

// ---- 5: DECREASE -- partial, the line survives -----------------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const sale = seedSale(sqlite)
  // This line drew across two lots: 501 first (2), then 502 (1).
  sqlite.prepare(`UPDATE sale_items SET quantity = 3, total_usd = 9 WHERE id = 1`).run()
  seedAllocation(sqlite, { quantity: 2, released: 0, batchId: 501 })
  seedAllocation(sqlite, { quantity: 1, released: 0, batchId: 502 })

  const plan = planLineQuantityDecrease({
    saleId: 77, sale, line: LINE({ quantity: 3 }), removedQuantity: 1,
    allocations: allocationsOf(sqlite), exchangeRate: 4100,
    reason: 'Quantity decreased on sale #77', userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(plan.quantityAfter, 2)
  assert.strictEqual(plan.unitsMoved, 1)
  assert.strictEqual(plan.subtotalDeltaUsd, -3)
  // REVERSE draw order: the last-drawn unit (lot 502) is the one that goes back.
  assert.deepStrictEqual(plan.takes.map((t) => [t.batchId, t.quantity]), [[502, 1]], 'last drawn comes back first')

  apply(plan.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM sale_items WHERE id = 1'), 2, 'the line survives at 2')
  assert.strictEqual(num(sqlite, 'SELECT total_usd FROM sale_items WHERE id = 1'), 6)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 502'), 7, 'lot 502 got its unit back')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 8, 'lot 501 was not touched')
  const allocations = allocationsOf(sqlite)
  assert.strictEqual(allocations.length, 1, 'the emptied 502 row is gone, the 501 row remains')
  assert.strictEqual(allocations[0].batch_id, 501)
  assert.strictEqual(allocations[0].quantity, 2)
}
console.log('PASS 5 -- a decrease returns units to the SAME lots in reverse draw order')

// ---- 6: REMOVE deletes the line row, never zeroes it -----------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const sale = seedSale(sqlite)
  seedAllocation(sqlite, { quantity: 2, released: 0 })
  const plan = planLineQuantityDecrease({
    saleId: 77, sale, line: LINE(), removedQuantity: 2,
    allocations: allocationsOf(sqlite), exchangeRate: 4100,
    reason: 'removed', userId: 9, userName: 'Sokha',
  })
  apply(plan.statements)
  const rows = sqlite.prepare('SELECT * FROM sale_items WHERE sale_id = 77').all()
  assert.strictEqual(rows.length, 0, 'a removal DELETES the row -- a 0-quantity row would print as "0 x Serum"')
}
console.log('PASS 6 -- a removed line is deleted, not zeroed')

// ---- 7: a STOCK-SKIPPED sale moves nothing, in EITHER direction ------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const sale = seedSale(sqlite, { stock_skipped: 1 })
  seedAllocation(sqlite, { quantity: 2, released: 0 })

  assert.strictEqual(saleSkipsStock(sale), true)
  assert.strictEqual(saleAmendmentMovesStock(sale), false, 'the sticky flag beats the status')
  assert.strictEqual(amendmentHeldUnits(sale, 5), 0, 'and it beats heldQuantity() too')

  // Increase: the line rises, the shelf does not.
  const up = planLineQuantityIncrease({
    saleId: 77, sale, line: LINE(), addedQuantity: 3,
    lots: lotsFor(), exchangeRate: 4100, userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(up.unitsMoved, 0, 'a stock-skipped sale takes no units')
  apply(up.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM sale_items WHERE id = 1'), 5, 'the sale still records the goods')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 20, 'branch stock is untouched')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 8, 'the lot is untouched')
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM inventory_movements'), 0, 'and nothing was written to the movement ledger')

  // Decrease: this is the one that would INVENT stock if the flag were ignored.
  const down = planLineQuantityDecrease({
    saleId: 77, sale, line: LINE({ quantity: 5 }), removedQuantity: 5,
    allocations: allocationsOf(sqlite), exchangeRate: 4100,
    reason: 'removed', userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(down.unitsMoved, 0, 'a sale the system never took units for must not have units invented for it')
  apply(down.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 20, 'still 20 -- no stock was conjured')
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = 501'), 8)
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM inventory_movements'), 0)
}
// 7b: the PRE-MERGE shape -- S4-2's column does not exist yet, so `SELECT *`
// simply does not return the field. The kernel must then behave exactly as it
// does today rather than treating "absent" as "skip".
{
  const withoutColumn = { sale_status: 'completed', is_delivery: 1 }
  assert.strictEqual(saleSkipsStock(withoutColumn), false, 'an absent flag is not a set flag')
  assert.strictEqual(saleAmendmentMovesStock(withoutColumn), true, 'so stock moves exactly as it does today')
  assert.strictEqual(amendmentHeldUnits(withoutColumn, 4), 4)
}
console.log('PASS 7 -- a stock-skipped sale moves nothing either way, and an absent flag changes nothing')

// ---- 8: S4-3 -- an awaiting_payment sale HOLDS stock, so amendments move it
// This case asserted the opposite until S4-3. The units of an unpaid order
// are promised to that buyer and are off the shelf, so amending the order
// amends what is off the shelf, exactly as for a completed sale. "Moves
// nothing" now belongs solely to the stock_skipped flag, which case 7 covers.
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  const sale = seedSale(sqlite, { sale_status: 'awaiting_payment' })
  assert.strictEqual(saleAmendmentMovesStock(sale), true, 'S4-3: an unpaid order holds its units')
  const plan = planLineQuantityIncrease({
    saleId: 77, sale, line: LINE(), addedQuantity: 2,
    lots: lotsFor(), exchangeRate: 4100, userId: 9, userName: 'Sokha',
  })
  // Negative = units leaving the shelf, the same sign convention case 4 uses.
  assert.strictEqual(plan.unitsMoved, -2, 'two more units are promised, so two more leave the shelf')
  apply(plan.statements)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 18, 'the shelf really drops')
  const allocations = allocationsOf(sqlite)
  assert.strictEqual(allocations.length, 1, 'the lot attribution is recorded')
  assert.strictEqual(allocations[0].released_quantity, 0,
    'and the units are OUT with the sale, so none are marked released')
}
console.log('PASS 8 -- an awaiting_payment sale holds stock, so an amendment moves it')

// ---- 9: recorded returns refuse EVERY kind ---------------------------------
{
  const base = { saleCreatedAt: '2026-09-04 10:00:00', windowMinutes: 120, isAdmin: false, nowMs: Date.parse('2026-09-04T10:05:00Z') }
  for (const status of ['completed', 'awaiting_delivery', 'awaiting_payment']) {
    assert.strictEqual(guardSaleAmendment({ ...base, saleStatus: status, hasRecordedReturns: false }).ok, true, `${status} accepts an amendment`)
  }
  for (const status of ['cancelled', 'returned', 'partial_return']) {
    const result = guardSaleAmendment({ ...base, saleStatus: status, hasRecordedReturns: false })
    assert.strictEqual(result.ok, false, `${status} refuses an amendment`)
    assert.ok(result.error.length > 20, `${status} says why in plain words`)
  }
  // The label is not the authority: a sale still marked 'completed' underneath
  // real return records is refused too, and an ADMIN is refused as well --
  // this one is not a permission question.
  const underReturns = guardSaleAmendment({ ...base, saleStatus: 'completed', hasRecordedReturns: true })
  assert.strictEqual(underReturns.ok, false)
  assert.strictEqual(underReturns.code, 'returns')
  assert.strictEqual(
    guardSaleAmendment({ ...base, saleStatus: 'completed', hasRecordedReturns: true, isAdmin: true }).ok,
    false,
    'not even an admin may amend underneath recorded returns',
  )
  assert.deepStrictEqual([...SALE_STATUSES_ACCEPTING_AMENDMENTS].sort(), ['awaiting_delivery', 'awaiting_payment', 'completed'])
}
console.log('PASS 9 -- recorded returns refuse every amendment, whatever the status label says')

// ---- 10: the edit window ---------------------------------------------------
{
  assert.strictEqual(DEFAULT_AMENDMENT_WINDOW_MINUTES, 120)
  assert.strictEqual(resolveAmendmentWindowMinutes(''), 120, 'blank falls back')
  assert.strictEqual(resolveAmendmentWindowMinutes(null), 120)
  assert.strictEqual(resolveAmendmentWindowMinutes('not a number'), 120)
  assert.strictEqual(resolveAmendmentWindowMinutes('-5'), 120, 'garbage falls back')
  assert.strictEqual(resolveAmendmentWindowMinutes('30'), 30)
  assert.strictEqual(resolveAmendmentWindowMinutes('0'), 0, '0 means "admin only" and is honoured, not treated as unset')

  // The timestamp is parsed as UTC. Read as LOCAL time this test would pass or
  // fail depending on the machine's zone, which is exactly the trap.
  assert.strictEqual(parseSqliteTimestampMs('2026-09-04 10:00:00'), Date.parse('2026-09-04T10:00:00Z'))
  assert.strictEqual(parseSqliteTimestampMs('2026-09-04T10:00:00Z'), Date.parse('2026-09-04T10:00:00Z'))
  assert.ok(Number.isNaN(parseSqliteTimestampMs('')))

  const at = (iso) => Date.parse(iso)
  const base = { saleStatus: 'completed', hasRecordedReturns: false, saleCreatedAt: '2026-09-04 10:00:00', windowMinutes: 120 }

  const inside = guardSaleAmendment({ ...base, isAdmin: false, nowMs: at('2026-09-04T11:30:00Z') })
  assert.strictEqual(inside.ok, true, '90 minutes in is inside a 120-minute window')
  assert.strictEqual(inside.outsideWindow, false)

  const outside = guardSaleAmendment({ ...base, isAdmin: false, nowMs: at('2026-09-04T13:30:00Z') })
  assert.strictEqual(outside.ok, false, '210 minutes in is outside it')
  assert.strictEqual(outside.code, 'window')
  assert.match(outside.error, /2-hour window/, 'and the message names the real window, not a hard-coded one')

  const adminOutside = guardSaleAmendment({ ...base, isAdmin: true, nowMs: at('2026-09-04T13:30:00Z') })
  assert.strictEqual(adminOutside.ok, true, 'an admin amends outside the window')
  assert.strictEqual(adminOutside.outsideWindow, true, 'and the route is told it was outside, so it can record that')

  // The window is measured from the SALE, not from the last amendment -- a
  // chain of small edits must not keep a sale open forever.
  assert.strictEqual(
    guardSaleAmendment({ ...base, isAdmin: false, nowMs: at('2026-09-05T09:00:00Z') }).ok,
    false,
    'a day later is closed however many amendments happened in between',
  )

  // An unparseable created_at does NOT grant an unlimited window.
  const broken = guardSaleAmendment({ ...base, saleCreatedAt: 'not a date', isAdmin: false, nowMs: at('2026-09-04T10:00:01Z') })
  assert.strictEqual(broken.ok, false, 'a row with no usable timestamp is treated as outside the window, not inside it')
  assert.strictEqual(guardSaleAmendment({ ...base, saleCreatedAt: 'not a date', isAdmin: true, nowMs: at('2026-09-04T10:00:01Z') }).ok, true)

  // windowMinutes 0: nobody but an admin, and the message says so.
  const noWindow = guardSaleAmendment({ ...base, windowMinutes: 0, isAdmin: false, nowMs: at('2026-09-04T10:00:01Z') })
  assert.strictEqual(noWindow.ok, false)
  assert.match(noWindow.error, /admin/i)

  // Status and returns are checked BEFORE the window: a sale that can never be
  // amended must not send a cashier off to find an admin who would be refused too.
  const cancelledAndLate = guardSaleAmendment({ ...base, saleStatus: 'cancelled', isAdmin: false, nowMs: at('2026-09-06T10:00:00Z') })
  assert.strictEqual(cancelledAndLate.code, 'status', 'the permanent reason wins over the timing one')
}
console.log('PASS 10 -- the edit window, its default, its setting, the admin bypass, and the UTC trap')

// ---- 11 + 12: the delivery fee, and what stays frozen ----------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite)
  // A sale with real tax and a real discount, so "frozen" is actually tested.
  const sale = seedSale(sqlite, { tax_usd: 0.6, discount_usd: 1, total_usd: 7.1, amount_paid_usd: 7.1 })
  sqlite.prepare(`UPDATE sales SET tax_usd = 0.6, discount_usd = 1 WHERE id = 77`).run()
  const stored = sqlite.prepare('SELECT * FROM sales WHERE id = 77').get()

  assert.strictEqual(guardDeliveryFeeAmendment(stored).ok, true)
  assert.strictEqual(
    guardDeliveryFeeAmendment({ ...stored, is_delivery: 0 }).ok,
    false,
    'a counter sale has no delivery fee to correct',
  )

  // "before 1.5 dollar delivery, then we add another 0.5"
  const plan = planDeliveryFeeChange({ saleId: 77, sale: stored, newFeeUsd: 2, exchangeRate: 4100 })
  assert.strictEqual(plan.feeBeforeUsd, 1.5)
  assert.strictEqual(plan.feeAfterUsd, 2)
  assert.strictEqual(plan.feeDeltaUsd, 0.5, 'the ledger records the +$0.50 the owner asked to see')

  const before = recomputeSaleMoneyAfterAmendment({ sale: stored, subtotalUsd: 6, changeExchangeRate: null })
  const after = recomputeSaleMoneyAfterAmendment({ sale: stored, subtotalUsd: 6, deliveryFeeUsdOverride: 2, changeExchangeRate: null })
  // 6 - 1 discount + 0.6 tax + 1.5 delivery = 7.10 -> with 2.00 delivery = 7.60
  assert.strictEqual(before.totalUsd, 7.1)
  assert.strictEqual(after.totalUsd, 7.6, 'the total moved by exactly the fee delta and nothing else')

  apply([
    ...plan.statements,
    amendmentEntryStatement(ENTRY({
      kind: 'delivery_fee_changed',
      amountBeforeUsd: plan.feeBeforeUsd, amountAfterUsd: plan.feeAfterUsd,
      totalBeforeUsd: before.totalUsd, totalAfterUsd: after.totalUsd,
    })),
  ])

  // WHAT THE RECEIPT SEES: one number, $2.00. The customer cannot tell.
  assert.strictEqual(num(sqlite, 'SELECT delivery_fee_usd FROM sales WHERE id = 77'), 2)
  assert.strictEqual(num(sqlite, 'SELECT delivery_fee_khr FROM sales WHERE id = 77'), 8200, 'and the riel column followed')
  // WHAT THE DETAIL SEES: both.
  const entry = sqlite.prepare(`SELECT * FROM sale_amendments WHERE kind = 'delivery_fee_changed'`).get()
  assert.strictEqual(entry.amount_before_usd, 1.5)
  assert.strictEqual(entry.amount_after_usd, 2)
  assert.strictEqual(entry.amount_delta_usd, 0.5)
  assert.strictEqual(entry.total_before_usd, 7.1)
  assert.strictEqual(entry.total_after_usd, 7.6)

  // Both DISCOUNTS are frozen, proved rather than asserted in a comment: they
  // are absolute amounts with no stored rate, and changing one is a money
  // decision rather than a correction.
  assert.strictEqual(num(sqlite, 'SELECT discount_usd FROM sales WHERE id = 77'), 1)
  // A fee correction touches no line, so it changes no taxable base and
  // therefore writes no tax -- the stored amount is still exactly what the till
  // recorded. Case 16 below is where tax that DOES follow the lines is proved.
  assert.strictEqual(num(sqlite, 'SELECT tax_usd FROM sales WHERE id = 77'), 0.6)
  const grown = recomputeSaleMoneyAfterAmendment({ sale: stored, subtotalUsd: 12, changeExchangeRate: null })
  assert.strictEqual(grown.totalUsd, 13.1,
    'with no tax override the stored amount rides through: recomputing tax is a decision the caller makes, never a side effect of re-totalling')

  // The receipt number never changes.
  assert.strictEqual(amendedSaleKeepsReceiptNumber(), true)
  assert.strictEqual(sqlite.prepare('SELECT receipt_number FROM sales WHERE id = 77').get().receipt_number, 'RCP-000123')
}
console.log('PASS 11/12 -- the delivery fee nets to one number on the receipt and shows both in the ledger; discounts frozen, tax untouched by a fee-only change')

// ---- 13: an oversell aborts the whole batch --------------------------------
{
  const { sqlite, apply } = setup()
  seedShelf(sqlite, { shelf: 2, lot501: 2, lot502: 0 })
  const sale = seedSale(sqlite)
  const plan = planLineQuantityIncrease({
    saleId: 77, sale, line: LINE(), addedQuantity: 5,
    lots: [{ batchId: 501, lotCode: 'L-501', expiryDate: null, available: 5 }],
    exchangeRate: 4100, userId: 9, userName: 'Sokha',
  })
  assert.throws(() => apply(plan.statements), /CHECK constraint/i, 'the strict decrement is the real race guard')
  // Nothing half-applied: the line is still 2 and the shelf is still 2.
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM sale_items WHERE id = 1'), 2)
  assert.strictEqual(num(sqlite, 'SELECT quantity FROM branch_stock'), 2)
  assert.strictEqual(num(sqlite, 'SELECT COUNT(*) FROM sale_amendments'), 0, 'and no ledger entry was written for a write that did not happen')
}
console.log('PASS 13 -- an oversell aborts the batch, nothing half-applies, no ledger entry')

// ---- 14: summarizeAmendments -----------------------------------------------
{
  assert.deepStrictEqual([...AMENDMENT_KINDS], [
    'line_added', 'line_quantity_increased', 'line_quantity_decreased', 'line_removed', 'delivery_fee_changed',
  ])
  assert.strictEqual(reversingKind('line_added'), 'line_removed')
  assert.strictEqual(reversingKind('line_removed'), 'line_added')
  assert.strictEqual(reversingKind('line_quantity_increased'), 'line_quantity_decreased')

  assert.deepStrictEqual(summarizeAmendments([]), {
    amended: false, entryCount: 0, removedLines: [],
    originalTotalUsd: null, currentTotalUsd: null,
    deliveryFeeBeforeUsd: null, deliveryFeeAfterUsd: null,
  })

  const removedOnly = summarizeAmendments([
    { id: 1, kind: 'line_removed', product_id: 10, product_name: 'Serum', quantity_before: 2, quantity_after: 0, total_before_usd: 7.5, total_after_usd: 1.5 },
  ])
  assert.strictEqual(removedOnly.amended, true)
  assert.deepStrictEqual(removedOnly.removedLines, [{ productId: 10, productName: 'Serum', quantity: 2 }])
  assert.strictEqual(removedOnly.originalTotalUsd, 7.5, 'what the first receipt said')
  assert.strictEqual(removedOnly.currentTotalUsd, 1.5, 'what a reprint says now')

  // A removal that was undone is NOT still reported as removed -- the header
  // describes the sale, not a moment in its history. The ENTRIES both survive.
  const removedThenRestored = summarizeAmendments([
    { id: 1, kind: 'line_removed', product_id: 10, product_name: 'Serum', quantity_before: 2, quantity_after: 0, total_before_usd: 7.5, total_after_usd: 1.5 },
    { id: 2, kind: 'line_added', product_id: 10, product_name: 'Serum', quantity_before: 0, quantity_after: 2, total_before_usd: 1.5, total_after_usd: 7.5, via: 'undo' },
  ])
  assert.deepStrictEqual(removedThenRestored.removedLines, [], 'the goods came back, so the header does not claim otherwise')
  assert.strictEqual(removedThenRestored.entryCount, 2, 'but BOTH entries are still in the trail')
  assert.strictEqual(removedThenRestored.currentTotalUsd, 7.5)

  const feeTwice = summarizeAmendments([
    { id: 1, kind: 'delivery_fee_changed', amount_before_usd: 1.5, amount_after_usd: 2, total_before_usd: 7.5, total_after_usd: 8 },
    { id: 2, kind: 'delivery_fee_changed', amount_before_usd: 2, amount_after_usd: 2.25, total_before_usd: 8, total_after_usd: 8.25 },
  ])
  assert.strictEqual(feeTwice.deliveryFeeBeforeUsd, 1.5, 'the FIRST known fee')
  assert.strictEqual(feeTwice.deliveryFeeAfterUsd, 2.25, 'and the latest one')
}
console.log('PASS 14 -- the detail summary describes the sale, not a moment in its history')

// ---- 15: source locks ------------------------------------------------------
{
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  const appliers = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')

  assert.ok(routes.includes("from '../lib/saleAmendments'"), 'routes/sales.ts must use the kernel, not its own copy of these rules')
  assert.ok(/app\.post\('\/:id\/amendments'/.test(routes), 'the amendment endpoint must exist')
  assert.ok(/app\.get\('\/:id\/amendments'/.test(routes), 'the detail view needs a read endpoint')
  assert.ok(routes.includes("getActionTier(user, 'sales', 'amend')"), 'amendments must be gated on their own granular action')

  // S4-24b is SUBSUMED, not duplicated: its endpoint writes a ledger entry, so
  // there is one way to add a line and one audit trail for it.
  const addItemsBlock = routes.slice(routes.indexOf("app.post('/:id/items'"), routes.indexOf("app.post('/:id/amendments'"))
  assert.ok(addItemsBlock.includes('amendmentEntryStatement'), 'POST /:id/items must write a line_added ledger entry')
  assert.ok(addItemsBlock.includes("kind: 'line_added'"), 'and it must be recorded as line_added')

  // The Undo button writes INTO the ledger rather than around it.
  assert.ok(appliers.includes('amendmentEntryStatement'), "the 'sale.add_items' applier must append a compensating entry")
  assert.ok(appliers.includes("via: 'undo'") && appliers.includes("via: 'redo'"), 'both directions must be recorded')

  // Nothing anywhere may UPDATE or DELETE a ledger row -- the triggers would
  // abort it, but a source lock catches it at review time instead of at 9pm.
  for (const [name, source] of [['routes/sales.ts', routes], ['lib/undoAppliers.ts', appliers], ['lib/saleAmendments.ts', fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'saleAmendments.ts'), 'utf8')]]) {
    assert.ok(!/UPDATE\s+sale_amendments/i.test(source), `${name} must never UPDATE a ledger row`)
    assert.ok(!/DELETE\s+FROM\s+sale_amendments/i.test(source), `${name} must never DELETE a ledger row`)
  }
}
console.log('PASS 15 -- routes and the undo applier are wired to the one ledger, and nothing rewrites it')

// ---------------------------------------------------------------------------
// 16. TAX is a settings switch, not a value frozen at sale time.
//
// The owner ruled on 2026-09-04: "tax can turn on off in settings which will
// show based on that, if off, doesn't show." These cases pin the switch itself
// and every case where an amendment DECLINES to recompute -- the declines are
// the interesting half, because each one keeps a real recorded amount rather
// than inventing a rate for it.
// ---------------------------------------------------------------------------
{
  // The absent key is the whole compatibility story: an install that has never
  // seen this switch behaves exactly as it did before it existed.
  assert.deepStrictEqual(resolveTaxSettings(undefined, '10'), { enabled: true, rate: 0.1 },
    'with the switch unset, a positive rate means tax is on -- the behaviour before the switch existed')
  assert.deepStrictEqual(resolveTaxSettings(undefined, '0'), { enabled: false, rate: 0 },
    'and a zero rate means off, which is what POS already inferred')
  assert.deepStrictEqual(resolveTaxSettings(undefined, ''), { enabled: false, rate: 0 })
  // An explicit answer overrides the inference in BOTH directions.
  assert.strictEqual(resolveTaxSettings('false', '10').enabled, false, 'off wins over a set rate')
  assert.strictEqual(resolveTaxSettings('true', '10').enabled, true)
  // These values reach the settings table from more than one writer, so
  // anything a shop would read as "no" counts as off.
  for (const off of ['0', 'off', 'no', 'FALSE', ' false ']) {
    assert.strictEqual(resolveTaxSettings(off, '10').enabled, false, `"${off}" must read as off`)
  }
  // The rate stays a percent in storage and a multiplier in code.
  assert.strictEqual(resolveTaxSettings('true', '7.5').rate, 0.075)
  assert.strictEqual(resolveTaxSettings('true', 'abc').rate, 0, 'garbage is not a rate')
  assert.strictEqual(resolveTaxSettings('true', '-5').rate, 0, 'and neither is a negative one')

  // The base is subtotal less BOTH discounts, floored at zero -- the same base
  // POS.tsx applies the rate to.
  const discounted = { discount_usd: 2, membership_discount_usd: 1 }
  assert.strictEqual(taxableBaseUsd(discounted, 20), 17)
  assert.strictEqual(taxableBaseUsd({ discount_usd: 50 }, 20), 0, 'a discount larger than the sale cannot make the base negative')

  const on = { enabled: true, rate: 0.1 }

  // The everyday case: this sale WAS taxed at today's rate, so tax follows the
  // lines. $10 of goods at 10% became $1.00; adding $10 more makes it $2.00.
  const followed = resolveAmendedTaxUsd({
    sale: { tax_usd: 1 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 20, settings: on,
  })
  assert.deepStrictEqual(followed, { taxUsd: 2, recomputed: true, reason: 'recomputed' })

  // A sale that was rung up WITHOUT tax never grows one, however the switch is
  // set now -- the customer already holds a receipt with no tax line on it.
  assert.deepStrictEqual(
    resolveAmendedTaxUsd({ sale: { tax_usd: 0 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 20, settings: on }),
    { taxUsd: 0, recomputed: false, reason: 'no_tax_on_sale' },
    'the tax row stays absent, which is the owner\'s "if off, doesn\'t show"')

  // Off means "stop charging it", NOT "erase what was charged". Zeroing a
  // historical amount would leave that receipt's own arithmetic wrong.
  assert.deepStrictEqual(
    resolveAmendedTaxUsd({ sale: { tax_usd: 1 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 20, settings: { enabled: false, rate: 0.1 } }),
    { taxUsd: 1, recomputed: false, reason: 'tax_disabled' })

  // No usable rate: there is nothing to recompute WITH, so the amount stands.
  assert.deepStrictEqual(
    resolveAmendedTaxUsd({ sale: { tax_usd: 1 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 20, settings: { enabled: true, rate: 0 } }),
    { taxUsd: 1, recomputed: false, reason: 'no_rate' })

  // THE ONE THAT MATTERS MOST: a migrated sale, or one taxed before the rate
  // changed, carries an amount today's rate would never have produced.
  // Solving for its own rate is exactly the retro-derivation that was ruled
  // out, so the amount is kept verbatim and the caller is TOLD.
  const legacy = resolveAmendedTaxUsd({
    sale: { tax_usd: 3.42 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 20, settings: on,
  })
  assert.deepStrictEqual(legacy, { taxUsd: 3.42, recomputed: false, reason: 'rate_mismatch' })

  // A cent of tolerance, because the stored amount went through the same
  // rounding the till used -- but not a cent more.
  assert.strictEqual(resolveAmendedTaxUsd({ sale: { tax_usd: 1.01 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 10, settings: on }).recomputed, true)
  assert.strictEqual(resolveAmendedTaxUsd({ sale: { tax_usd: 1.05 }, taxableBaseBeforeUsd: 10, taxableBaseAfterUsd: 10, settings: on }).recomputed, false)

  // Tax reaches the total through the SAME recompute every other money field
  // does, so an amendment can never round differently from a checkout.
  const sale = {
    exchange_rate: 4100, discount_usd: 0, membership_discount_usd: 0, tax_usd: 1,
    is_delivery: 0, delivery_fee_usd: 0, delivery_fee_paid_by: 'customer',
    amount_paid_usd: 11, amount_paid_khr: 0,
  }
  const frozen = recomputeSaleMoneyAfterAmendment({ sale, subtotalUsd: 20 })
  assert.strictEqual(frozen.totalUsd, 21, 'without an override the stored tax rides through untouched')
  const followedTotals = recomputeSaleMoneyAfterAmendment({ sale, subtotalUsd: 20, taxUsdOverride: 2 })
  assert.strictEqual(followedTotals.totalUsd, 22, 'and the override lands in the total, not beside it')
  // Passing null must not be read as "set tax to zero".
  assert.strictEqual(recomputeSaleMoneyAfterAmendment({ sale, subtotalUsd: 20, taxUsdOverride: null }).totalUsd, 21)

  // The write-back is a plain UPDATE of the two tax columns and nothing else:
  // it must never touch subtotal or total, which the money statement owns.
  const stmt = saleTaxUpdateStatement(7, 2.005, 4100)
  assert.ok(/UPDATE sales SET tax_usd/.test(stmt.sql))
  assert.ok(!/total_usd|subtotal_usd/.test(stmt.sql), 'the tax statement owns tax only')
  assert.strictEqual(stmt.params.tax_usd, 2.01, 'rounded the way every other USD amount in this codebase is')
  assert.strictEqual(stmt.params.tax_khr, Math.round(2.01 * 4100))
  assert.strictEqual(saleTaxUpdateStatement(7, -3, 4100).params.tax_usd, 0, 'a negative tax is not a thing')

  // Source lock: the till and the Worker must read the switch the same way, or
  // an amendment will silently disagree with the checkout that created the
  // sale. Neither side may go back to reading the raw rate on its own.
  const pos = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')
  assert.ok(pos.includes('effectiveTaxRate(settings.tax_enabled, settings.tax_rate)'),
    'POS must apply the rate through the shared helper so the switch actually stops tax being charged')
  assert.ok(!/parseFloat\(asText\(settings\.tax_rate/.test(pos),
    'and must not keep its own copy of the old rate-only rule beside it')
  const routesTax = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  assert.ok(routesTax.includes('readAmendmentMoneySettings'), 'the routes must read the tax settings, not assume them')
  assert.ok(routesTax.includes('planAmendedTax'), 'and route every amendment kind through the one tax decision')
}
console.log('PASS 16 -- tax follows the settings switch, and every refusal to recompute is named')

console.log('\nAll sale-amendment ledger checks passed.')
