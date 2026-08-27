// Proves the POS/sales stock deduction is STRICT, not clamped (Part 360).
//
// Before: availability was a plain READ, then the deduction used
// MAX(0, quantity - sold). Two concurrent sales of the last unit both passed
// the read and the clamp silently floored stock at 0 -- an oversell with no
// error and lost stock. Now branch_stock / branch_batch_stock carry a
// CHECK(quantity >= 0) (migration 0058) and the sale write paths use plain
// subtraction, so a race turns into a real constraint failure that rolls the
// whole sale transaction back.
//
// This checks three things against a real in-memory SQLite:
//   1. migration 0058 is valid SQL, rebuilds both tables with the CHECK, and
//      defensively floors any pre-existing negative row during the copy.
//   2. the exact deduction pattern the route now uses (plain subtraction in an
//      atomic batch) COMMITS a within-stock sale and ABORTS + fully rolls back
//      an oversell -- never a silent clamp.
//   3. routes/sales.ts actually ships that pattern (no MAX(0, ...) on the sale
//      deduction) and uses the strict batch helper -- a guard so a future edit
//      can't quietly reintroduce the clamp.

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

let failed = 0
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0058_stock_nonnegative_check.sql'), 'utf8')

function preMigrationDb() {
  const db = new Database(':memory:')
  // The pre-0058 shape (mirrors 0001_init.sql), so we exercise the real rebuild.
  db.exec(`
    CREATE TABLE branch_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL, quantity REAL DEFAULT 0, rfid_confirmed_qty REAL DEFAULT 0);
    CREATE TABLE branch_batch_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL, quantity REAL DEFAULT 0, created_at TEXT, updated_at TEXT);
  `)
  return db
}

test('migration 0058 rebuilds with the CHECK and floors pre-existing negatives', () => {
  const db = preMigrationDb()
  db.prepare(`INSERT INTO branch_stock(id, product_id, branch_id, quantity, rfid_confirmed_qty) VALUES (1, 10, 1, 5, 2)`).run()
  db.prepare(`INSERT INTO branch_stock(id, product_id, branch_id, quantity) VALUES (2, 11, 1, -3)`).run() // historical drift
  db.prepare(`INSERT INTO branch_batch_stock(id, batch_id, branch_id, quantity) VALUES (1, 101, 1, -1)`).run()
  db.exec(migration)
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE id=1`).get().quantity, 5, 'valid row preserved')
  assert.strictEqual(db.prepare(`SELECT rfid_confirmed_qty FROM branch_stock WHERE id=1`).get().rfid_confirmed_qty, 2, 'rfid column preserved')
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE id=2`).get().quantity, 0, 'negative floored to 0')
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_batch_stock WHERE id=1`).get().quantity, 0, 'negative batch floored')
  // The CHECK is now live.
  assert.throws(() => db.prepare(`UPDATE branch_stock SET quantity = -1 WHERE id=1`).run(), /CHECK constraint/)
  assert.throws(() => db.prepare(`UPDATE branch_batch_stock SET quantity = -1 WHERE id=1`).run(), /CHECK constraint/)
  // The unique index the ON CONFLICT clauses depend on survived the rebuild.
  assert.throws(() => db.prepare(`INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (10, 1, 1)`).run(), /UNIQUE/)
})

test('a within-stock sale commits; an oversell aborts and fully rolls back (no clamp)', () => {
  const db = preMigrationDb()
  db.prepare(`INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (10, 1, 5)`).run()
  db.exec(migration)
  db.exec(`CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, quantity REAL, branch_id INTEGER)`)

  // The exact statements the route now emits, as one atomic batch.
  const saleBatch = (qty) => db.transaction(() => {
    db.prepare(`INSERT INTO sale_items (product_id, quantity, branch_id) VALUES (10, ?, 1)`).run(qty)
    db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 0)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - ?`).run(qty)
  })

  saleBatch(3)() // within stock
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1`).get().quantity, 2)
  assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 1)

  // Oversell of the remaining 2: must throw AND roll the whole batch back --
  // no clamp to 0, and the sale_items row must NOT survive.
  assert.throws(() => saleBatch(5)(), /CHECK constraint/)
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1`).get().quantity, 2, 'stock unchanged -- not clamped to 0')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 1, 'the oversell sale line rolled back with the deduction')

  // Selling exactly the remainder is allowed (boundary).
  saleBatch(2)()
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1`).get().quantity, 0)
})

test('multi-batch: a lot is guarded by ITS OWN stock, not the product total', () => {
  // The nuance: a product's stock is separated across lots. branch_stock is
  // the aggregate (10), but a sale that draws from a SPECIFIC lot is bounded
  // by that lot's branch_batch_stock, not the total. Lot A = 4, Lot B = 6.
  const db = preMigrationDb()
  db.prepare(`INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (10, 1, 10)`).run()
  db.prepare(`INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (501, 1, 4)`).run() // Lot A
  db.prepare(`INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (502, 1, 6)`).run() // Lot B
  db.exec(migration)
  db.exec(`CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, quantity REAL, branch_id INTEGER, batch_id INTEGER)`)

  // The route's batch-line statements: strict lot decrement + strict aggregate
  // decrement, as one atomic batch.
  const saleFromLot = (batchId, qty) => db.transaction(() => {
    db.prepare(`INSERT INTO sale_items (product_id, quantity, branch_id, batch_id) VALUES (10, ?, 1, ?)`).run(qty, batchId)
    db.prepare(`UPDATE branch_batch_stock SET quantity = quantity - ? WHERE batch_id = ? AND branch_id = 1`).run(qty, batchId)
    db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 0)
                ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity - ?`).run(qty)
  })

  // Selling 5 from Lot A (only 4) must FAIL even though the product total (10)
  // could "cover" it -- lots are not one pool.
  assert.throws(() => saleFromLot(501, 5)(), /CHECK constraint/)
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id=501`).get().quantity, 4, 'Lot A untouched')
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE product_id=10`).get().quantity, 10, 'aggregate untouched -- whole sale rolled back')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM sale_items`).get().n, 0)

  // Selling 4 from Lot A (exactly its stock) is fine and moves both ledgers.
  saleFromLot(501, 4)()
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id=501`).get().quantity, 0)
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_batch_stock WHERE batch_id=502`).get().quantity, 6, 'Lot B independent')
  assert.strictEqual(db.prepare(`SELECT quantity FROM branch_stock WHERE product_id=10`).get().quantity, 6)
})

test('routes/sales.ts ships the strict pattern (no MAX(0) clamp on the sale deduction)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  assert.ok(src.includes('decrementBatchStockStrictStatement'), 'uses the strict batch-decrement helper')
  // The two branch_stock sale deductions must be plain subtraction now.
  assert.ok(
    src.includes('DO UPDATE SET quantity = branch_stock.quantity - @quantity'),
    'branch_stock deduction is plain subtraction',
  )
  assert.ok(
    !/DO UPDATE SET quantity = MAX\(0, branch_stock\.quantity - @quantity\)/.test(src),
    'no MAX(0, ...) clamp remains on any branch_stock sale deduction',
  )
  // The race is reported as a 409 stock conflict, not an opaque 500.
  assert.ok(src.includes("code: 'stock_conflict'"), 'a concurrent-oversell abort is mapped to a 409 stock_conflict')
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll sales oversell-strict tests passed')
