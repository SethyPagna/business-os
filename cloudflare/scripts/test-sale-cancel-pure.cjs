// Sale cancellation + the transition kernel (Part 383 R3,
// lib/saleTransitions.ts). Every loophole the rebuild closed has a case:
//
//   1. cancel from completed        -> FULL restore (branch, product,
//                                      batch, allocations released) as a
//                                      new 'return' movement whose reason
//                                      names the cancellation
//   2. cancel from partial_return   -> restores exactly the UN-returned
//                                      remainder (old code restored 0:
//                                      those units silently vanished)
//   3. cancel from awaiting_payment -> no stock was out; nothing moves
//   4. un-cancel                    -> re-deducts INCLUDING the line's
//                                      batch (old deduct path skipped
//                                      batches), only back to
//                                      status_before_cancel
//   5. completed -> awaiting_payment with a prior partial return
//                                   -> restores qty - returned, not qty
//                                      (old code double-added the
//                                      returned portion)
//   6. guards: manual flips into partial_return/returned are refused;
//      out of partial_return only cancellation is allowed
//   7. allocateReturnedQuantities: item-level + product-level rows both
//      count, capped per line
//
// plus source locks on routes/sales.ts + routes/returns.ts wiring.
//
// Run: node scripts/test-sale-cancel-pure.cjs
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
const subject = compile('saleTransitions.ts', { './salesStatus': salesStatus, './productBatches': productBatches })
const {
  CANCEL_REASONS,
  normalizeCancelReason,
  cancelReasonLabel,
  heldQuantity,
  allocateReturnedQuantities,
  guardSaleStatusTransition,
  planSaleStockTransition,
} = subject

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock_quantity REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0 CHECK(quantity >= 0), UNIQUE(product_id, branch_id));
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0 CHECK(quantity >= 0), updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE sale_item_batch_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_item_id INTEGER, batch_id INTEGER, branch_id INTEGER, quantity REAL, released_at TEXT, released_quantity REAL NOT NULL DEFAULT 0);
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT,
      branch_id INTEGER, movement_type TEXT, quantity REAL, unit_cost_usd REAL, unit_cost_khr REAL,
      reason TEXT, reference_id INTEGER, user_id INTEGER, user_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      batch_id INTEGER);
  `)
  const apply = (statements) => {
    const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params || {})))
    return run()
  }
  return { sqlite, apply }
}

const ITEM = { id: 11, product_id: 10, product_name: 'Serum', quantity: 5, cost_price_usd: 4, cost_price_khr: 0, branch_id: 1, batch_id: 77 }

function seedSoldState(sqlite, { shelf = 20, batch = 8 } = {}) {
  // The sale already deducted its 5 units: shelf and batch reflect that.
  sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', @shelf)`).run({ shelf })
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, @shelf)`).run({ shelf })
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (77, 1, @batch)`).run({ batch })
  sqlite.prepare(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_at) VALUES (11, 77, 1, 5, NULL)`).run()
}

// ---- helpers ---------------------------------------------------------------
assert.strictEqual(normalizeCancelReason('Mistake'), 'mistake')
assert.strictEqual(normalizeCancelReason('buyer_refused'), 'buyer_refused')
assert.strictEqual(normalizeCancelReason('no such'), null)
assert.strictEqual(cancelReasonLabel('buyer_refused'), "Buyer didn't buy")
assert.deepStrictEqual([...CANCEL_REASONS], ['mistake', 'buyer_refused', 'other'])
assert.strictEqual(heldQuantity('completed', 5, 0), 5)
assert.strictEqual(heldQuantity('partial_return', 5, 2), 3)
assert.strictEqual(heldQuantity('returned', 5, 5), 0)
assert.strictEqual(heldQuantity('awaiting_payment', 5, 0), 0)
assert.strictEqual(heldQuantity('cancelled', 5, 2), 0)
console.log('PASS reasons + held() math')

// ---- 1: cancel from completed, nothing returned ---------------------------
{
  const { sqlite, apply } = setup()
  seedSoldState(sqlite)
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus: 'completed', newStatus: 'cancelled', items: [ITEM],
    returnedByItem: new Map([[11, 0]]),
    reason: 'Sale cancelled (Mistake) -- rang up the wrong customer',
    userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(plan.deductions.length, 0)
  assert.strictEqual(plan.restoredUnits, 5)
  apply(plan.statements)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock').get().quantity, 25)
  assert.strictEqual(sqlite.prepare('SELECT stock_quantity FROM products').get().stock_quantity, 25)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock').get().quantity, 13, 'the batch the line sold from gets its units back')
  assert.ok(sqlite.prepare('SELECT released_at FROM sale_item_batch_allocations').get().released_at, 'allocation released')
  const movement = sqlite.prepare(`SELECT movement_type, quantity, reason FROM inventory_movements`).get()
  assert.strictEqual(movement.movement_type, 'return')
  assert.strictEqual(movement.quantity, 5, 'stock comes back as a NEW positive movement, the original sale movement untouched')
  assert.match(movement.reason, /Sale cancelled \(Mistake\)/)
  console.log('PASS cancel from completed restores shelf + product + batch with a cancellation-noted movement')
}

// ---- 2: cancel from partial_return (the vanished-units loophole) ----------
{
  const { sqlite, apply } = setup()
  seedSoldState(sqlite, { shelf: 22, batch: 10 }) // 2 of 5 already returned+restocked
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus: 'partial_return', newStatus: 'cancelled', items: [ITEM],
    returnedByItem: new Map([[11, 2]]),
    reason: 'Sale cancelled (Other) -- buyer kept nothing',
    userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(plan.restoredUnits, 3, 'restores exactly the un-returned remainder (old code restored 0)')
  apply(plan.statements)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock').get().quantity, 25)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock').get().quantity, 13)
  console.log('PASS cancel from partial_return restores the un-returned remainder, never double-adds')
}

// ---- 3: cancel from awaiting_payment --------------------------------------
{
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus: 'awaiting_payment', newStatus: 'cancelled', items: [ITEM],
    returnedByItem: new Map(),
    reason: 'Sale cancelled (Buyer didn\'t buy)',
    userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(plan.statements.length, 0, 'nothing was out, nothing moves')
  console.log('PASS cancel from awaiting_payment moves no stock')
}

// ---- 4: un-cancel re-deducts INCLUDING the batch --------------------------
{
  const { sqlite, apply } = setup()
  // Cancelled state: units are back on the shelf/batch, allocation released.
  sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', 25)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 25)`).run()
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (77, 1, 13)`).run()
  sqlite.prepare(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_at) VALUES (11, 77, 1, 5, datetime('now'))`).run()
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus: 'cancelled', newStatus: 'completed', items: [ITEM],
    returnedByItem: new Map([[11, 0]]),
    reason: 'Sale cancellation reverted (back to completed)',
    userId: 9, userName: 'Sokha',
  })
  assert.deepStrictEqual(plan.deductions, [{ product_id: 10, branch_id: 1, quantity: 5 }], 'the route pre-checks exactly this')
  apply(plan.statements)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock').get().quantity, 20)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock').get().quantity, 8, 'the batch is re-deducted too -- the old deduct path skipped batches entirely')
  assert.strictEqual(sqlite.prepare('SELECT released_at FROM sale_item_batch_allocations').get().released_at, null, 'allocation active again')
  const movement = sqlite.prepare(`SELECT movement_type, quantity FROM inventory_movements`).get()
  assert.strictEqual(movement.movement_type, 'sale')
  assert.strictEqual(movement.quantity, -5)

  // A lot that cannot cover the re-deduct aborts the whole transition.
  const short = setup()
  short.sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', 25)`).run()
  short.sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 25)`).run()
  short.sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (77, 1, 2)`).run()
  assert.throws(() => short.apply(plan.statements), /CHECK|constraint/i)
  assert.strictEqual(short.sqlite.prepare('SELECT quantity FROM branch_stock').get().quantity, 25, 'atomic rollback: nothing moved')
  console.log('PASS un-cancel re-deducts shelf + batch atomically (strict, like a sale)')
}

// ---- 5: completed -> awaiting_payment after a partial return --------------
{
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus: 'completed', newStatus: 'awaiting_payment', items: [ITEM],
    returnedByItem: new Map([[11, 2]]),
    reason: 'Sale status changed from completed to awaiting_payment',
    userId: 9, userName: 'Sokha',
  })
  assert.strictEqual(plan.restoredUnits, 3, 'restores qty - returned; the old code restored the full 5, double-adding the returned 2')
  console.log('PASS completed -> awaiting_payment restores only what is still out')
}

// ---- 6: transition guards -------------------------------------------------
{
  assert.strictEqual(guardSaleStatusTransition('completed', 'returned', null).ok, false, 'manual flip into returned is refused')
  assert.strictEqual(guardSaleStatusTransition('completed', 'partial_return', null).ok, false)
  assert.strictEqual(guardSaleStatusTransition('partial_return', 'completed', null).ok, false, 'out of a return status only cancellation is allowed')
  assert.strictEqual(guardSaleStatusTransition('partial_return', 'cancelled', null).ok, true)
  assert.strictEqual(guardSaleStatusTransition('cancelled', 'completed', 'completed').ok, true)
  assert.strictEqual(guardSaleStatusTransition('cancelled', 'awaiting_delivery', 'completed').ok, false, 'un-cancel only back to where it was')
  assert.strictEqual(guardSaleStatusTransition('cancelled', 'partial_return', 'partial_return').ok, true, 'a sale cancelled while partial_return goes back to partial_return')
  assert.strictEqual(guardSaleStatusTransition('cancelled', 'completed', null).ok, true, 'legacy cancelled rows (no recorded before-status) un-cancel to completed')
  assert.strictEqual(guardSaleStatusTransition('awaiting_payment', 'completed', null).ok, true)
  console.log('PASS transition guards: returns flow owns its statuses, un-cancel is a one-way door back')
}

// ---- 7: returned-quantity allocation --------------------------------------
{
  const items = [
    { ...ITEM, id: 11, quantity: 3 },
    { ...ITEM, id: 12, quantity: 4 },
  ]
  const allocated = allocateReturnedQuantities(
    items,
    new Map([[11, 1]]),      // one unit returned against line 11 directly
    new Map([[10, 5]]),      // five more recorded product-level (no sale_item_id)
  )
  assert.strictEqual(allocated.get(11), 3, 'line 11: 1 direct + 2 allocated = its full 3, capped')
  assert.strictEqual(allocated.get(12), 3, 'line 12 takes the remaining 3 of the product-level 5')
  console.log('PASS product-level returns allocate across lines, capped at each line quantity')
}

// ---- 8: Z0 -- cancel/un-cancel restore to the SAME lots via allocations ---
{
  // A line drew 5 units across TWO lots (2 from lot 77, 3 from lot 88) --
  // its sale_items.batch_id is NULL, but the allocations record which lots.
  const { sqlite, apply } = setup()
  sqlite.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Serum', 20)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 20)`).run()
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (77, 1, 0)`).run() // lot 77 fully drawn
  sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (88, 1, 5)`).run() // lot 88 partly drawn
  sqlite.prepare(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_quantity, released_at) VALUES (11, 77, 1, 2, 0, NULL)`).run()
  sqlite.prepare(`INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, branch_id, quantity, released_quantity, released_at) VALUES (11, 88, 1, 3, 0, NULL)`).run()
  const multiItem = { id: 11, product_id: 10, product_name: 'Serum', quantity: 5, cost_price_usd: 4, cost_price_khr: 0, branch_id: 1, batch_id: null,
    allocations: [
      { id: 1, batch_id: 77, quantity: 2, released_quantity: 0 },
      { id: 2, batch_id: 88, quantity: 3, released_quantity: 0 },
    ] }
  const plan = planSaleStockTransition({
    saleId: 1, oldStatus: 'completed', newStatus: 'cancelled', items: [multiItem],
    returnedByItem: new Map([[11, 0]]), reason: 'Sale cancelled (Mistake)', userId: 9, userName: 'Sokha',
  })
  apply(plan.statements)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 77').get().quantity, 2, 'lot 77 gets its 2 units back -- not a new batch')
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 88').get().quantity, 8, 'lot 88 gets its 3 units back')
  const rel = sqlite.prepare('SELECT batch_id, released_quantity FROM sale_item_batch_allocations ORDER BY batch_id').all()
  assert.strictEqual(rel[0].released_quantity, 2, 'lot 77 allocation fully released')
  assert.strictEqual(rel[1].released_quantity, 3, 'lot 88 allocation fully released')
  console.log('PASS Z0: a multi-lot line cancels back into its exact lots, never a new batch')

  // Un-cancel re-takes from the SAME lots, forward order, capped at released.
  const plan2 = planSaleStockTransition({
    saleId: 1, oldStatus: 'cancelled', newStatus: 'completed',
    items: [{ ...multiItem, allocations: [{ id: 1, batch_id: 77, quantity: 2, released_quantity: 2 }, { id: 2, batch_id: 88, quantity: 3, released_quantity: 3 }] }],
    returnedByItem: new Map([[11, 0]]), reason: 'reverted', userId: 9, userName: 'Sokha',
  })
  apply(plan2.statements)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 77').get().quantity, 0, 'lot 77 re-deducted its 2 units')
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = 88').get().quantity, 5, 'lot 88 re-deducted its 3 units')
  console.log('PASS Z0: un-cancel re-deducts from the same lots the sale drew from')
}

// ---- source locks: the route + returns flow actually wire this ------------
{
  const salesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  // Z0: the sale write path auto-allocates FIFO lots and records them, and
  // the transition/returns paths restore to the same lots.
  assert.match(salesSrc, /readFifoLotAvailabilityForCart\(db, fifoPairs\)/, 'sale checkout auto-allocates from FIFO lots (one batched read for the whole cart)')
  assert.match(salesSrc, /autoAllocationsByItemIndex/, 'sale checkout records multi-lot allocations')
  assert.match(salesSrc, /FROM sale_item_batch_allocations WHERE sale_item_id IN/, 'the transition route fetches each line\'s allocations')
  const returnsBatchSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'returns.ts'), 'utf8')
  assert.match(returnsBatchSrc, /fetchSaleItemAllocations/, 'returns restock consults recorded allocations for multi-lot lines')
  assert.match(salesSrc, /guardSaleStatusTransition\(oldStatus, saleStatus, sale\.status_before_cancel \|\| null\)/, 'route must consult the transition guard')
  assert.match(salesSrc, /planSaleStockTransition\(\{/, 'route must build stock statements through the kernel')
  assert.match(salesSrc, /COALESCE\(r\.status, 'completed'\) != 'cancelled'\s*\n\s*AND COALESCE\(r\.return_scope, 'customer'\) = 'customer'/, 'returned-quantity query counts non-cancelled customer returns -- and deliberately does NOT filter return_to_stock (a damaged return is written off, not still out)')
  const returnedQuerySql = salesSrc.slice(salesSrc.indexOf('SELECT ri.sale_item_id'), salesSrc.indexOf('GROUP BY ri.sale_item_id'))
  assert.ok(returnedQuerySql.length > 0 && !/return_to_stock/.test(returnedQuerySql), 'the returned-quantity SQL itself must not filter on return_to_stock')
  assert.match(salesSrc, /normalizeCancelReason\(body\.cancel_reason\)/, 'cancel requires its reason')
  assert.match(salesSrc, /needs a note saying what happened/, "reason 'other' requires the note")
  assert.match(salesSrc, /DELETE FROM fees WHERE id = @feeId/, 'un-cancel removes the linked lost-fee row')
  assert.match(salesSrc, /INSERT INTO fees \(fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id, notes, created_by, created_by_name\)/, 'the lost fee lands in the fees ledger, linked to the sale')
  const returnsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'returns.ts'), 'utf8')
  assert.match(returnsSrc, /=== 'cancelled'\) \{\s*\n\s*throw new Error\('This sale is cancelled/, 'returns refuse a cancelled sale -- the double-restock loophole')
  console.log('PASS routes wire the kernel: reason required, fee row linked/removed, returns refuse cancelled sales')
}

console.log('All sale-cancellation tests passed')
