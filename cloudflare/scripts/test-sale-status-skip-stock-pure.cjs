// S4-2: the admin-only "Don't touch stock" option on a sale status change.
//
// THE INCIDENT THIS EXISTS FOR. The 2026-09-02 reconciliation rewrote every
// product quantity to the physically-counted truth, a count that ALREADY
// assumes the migrated old-system sales are completed. On 2026-09-03 an
// admin bulk-flipped 7 of those sales awaiting_payment -> completed and the
// transition kernel deducted 9 units that were already accounted for.
//
// What this test pins:
//
//   1. skipStock emits ZERO statements -- no branch_stock, no
//      products.stock_quantity, no branch_batch_stock, no allocation
//      release, and above all NO inventory_movements row (a movement row
//      asserts units physically moved, and none did).
//   2. Running the same plan against a real in-memory schema leaves EVERY
//      stock table byte-identical to the pre-transition snapshot.
//   3. Without the flag the existing behaviour is unchanged -- the plan is
//      deep-equal to the same plan built by a call that never mentions
//      skipStock at all (the flag is not a refactor in disguise).
//   4. restoredUnits/deductedUnits stay 0 under the skip and skippedUnits
//      reports what was NOT moved, so the audit trail cannot read as if
//      stock had moved.
//   5. The dangerous sequel: a sale completed WITHOUT stock, then cancelled.
//      Replaying the cancel normally would ADD units the system never took
//      (invent stock); replaying it with the sticky skip moves nothing.
//   6. Source locks on routes/sales.ts: the admin gate is isAdminControlUser
//      and refuses rather than silently downgrading; the skip is persisted
//      on the sale AND in the audit payload; it is re-read on every later
//      transition; damaged lots are skipped with the rest.
//   7. Migration 0109 actually adds the columns the route writes.
//
// Run: node scripts/test-sale-status-skip-stock-pure.cjs
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
const { planSaleStockTransition, heldQuantity } = compile('saleTransitions.ts', {
  './salesStatus': salesStatus,
  './productBatches': productBatches,
})

// A migrated old-system sale: two lines in branch 2, each drawn from one lot.
const ITEMS = [
  { id: 1, product_id: 10, product_name: 'Migrated A', quantity: 4, cost_price_usd: 1.5, cost_price_khr: 6000, branch_id: 2, batch_id: 77, allocations: [{ id: 501, batch_id: 77, quantity: 4, released_quantity: 4 }] },
  { id: 2, product_id: 11, product_name: 'Migrated B', quantity: 5, cost_price_usd: 2, cost_price_khr: 8000, branch_id: 2, batch_id: 88, allocations: [{ id: 502, batch_id: 88, quantity: 5, released_quantity: 5 }] },
]
const NO_RETURNS = new Map()

const baseInput = (extra = {}) => ({
  saleId: 4242,
  oldStatus: 'awaiting_payment',
  newStatus: 'completed',
  items: ITEMS,
  returnedByItem: NO_RETURNS,
  reason: 'Sale status changed from awaiting_payment to completed',
  userId: 1,
  userName: 'admin',
  ...extra,
})

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock_quantity REAL DEFAULT 0, updated_at TEXT);
    CREATE TABLE branch_stock (product_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0 CHECK(quantity >= 0), UNIQUE(product_id, branch_id));
    CREATE TABLE branch_batch_stock (batch_id INTEGER, branch_id INTEGER, quantity REAL DEFAULT 0 CHECK(quantity >= 0), updated_at TEXT, UNIQUE(batch_id, branch_id));
    CREATE TABLE sale_item_batch_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_item_id INTEGER, batch_id INTEGER, branch_id INTEGER, quantity REAL, released_at TEXT, released_quantity REAL NOT NULL DEFAULT 0);
    CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_name TEXT,
      branch_id INTEGER, movement_type TEXT, quantity REAL, unit_cost_usd REAL, unit_cost_khr REAL,
      reason TEXT, reference_id TEXT, user_id INTEGER, user_name TEXT, batch_id INTEGER);
    INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Migrated A', 40), (11, 'Migrated B', 50);
    INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 2, 40), (11, 2, 50);
    INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (77, 2, 40), (88, 2, 50);
    INSERT INTO sale_item_batch_allocations (id, sale_item_id, batch_id, branch_id, quantity, released_at, released_quantity)
      VALUES (501, 1, 77, 2, 4, datetime('now'), 4), (502, 2, 88, 2, 5, datetime('now'), 5);
  `)
  return sqlite
}

// Named parameters straight through, the way lib/db.ts's batch() binds them.
function apply(sqlite, statements) {
  for (const statement of statements) sqlite.prepare(statement.sql).run(statement.params)
}

function snapshot(sqlite) {
  return JSON.stringify({
    products: sqlite.prepare('SELECT id, stock_quantity, updated_at FROM products ORDER BY id').all(),
    branch: sqlite.prepare('SELECT product_id, branch_id, quantity FROM branch_stock ORDER BY product_id, branch_id').all(),
    lots: sqlite.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id').all(),
    allocations: sqlite.prepare('SELECT id, released_quantity, released_at FROM sale_item_batch_allocations ORDER BY id').all(),
    movements: sqlite.prepare('SELECT id, product_id, movement_type, quantity, reason, batch_id FROM inventory_movements ORDER BY id').all(),
  })
}

// ---- 1 + 4. the skip emits nothing at all --------------------------------
{
  const skipped = planSaleStockTransition(baseInput({ skipStock: true }))
  assert.deepStrictEqual(skipped.statements, [], 'skipStock must emit ZERO stock statements')
  assert.deepStrictEqual(skipped.deductions, [], 'skipStock must claim no stock, so nothing to pre-flight')
  assert.strictEqual(skipped.restoredUnits, 0, 'skipStock restored nothing')
  assert.strictEqual(skipped.deductedUnits, 0, 'skipStock deducted nothing')
  assert.strictEqual(skipped.skippedUnits, 9, 'skipStock reports the 9 units it deliberately did not move')

  const sql = skipped.statements.map((statement) => statement.sql).join('\n')
  for (const forbidden of ['inventory_movements', 'branch_stock', 'branch_batch_stock', 'products', 'sale_item_batch_allocations']) {
    assert.ok(!sql.includes(forbidden), `skipStock must not touch ${forbidden}`)
  }
  console.log('PASS 1: skip_stock emits zero statements -- no movement row, no branch/product/lot/allocation write')
}

// ---- 2. against a real schema, every stock table is untouched -------------
{
  const sqlite = setup()
  const before = snapshot(sqlite)
  const skipped = planSaleStockTransition(baseInput({ skipStock: true }))
  apply(sqlite, skipped.statements)
  assert.strictEqual(snapshot(sqlite), before, 'a skipped transition must leave every stock table byte-identical')
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0, 'no inventory movement was written')
  // ... while the SAME transition without the flag really does deduct 9.
  const moved = planSaleStockTransition(baseInput())
  apply(sqlite, moved.statements)
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 2').get().quantity, 36, 'without the flag branch stock still drops by 4')
  assert.strictEqual(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id = 11 AND branch_id = 2').get().quantity, 45, 'without the flag branch stock still drops by 5')
  assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 2, 'without the flag both sale movements are written')
  console.log('PASS 2: skipped transition changes nothing on disk; the same transition unskipped still deducts 9 units')
}

// ---- 3. the un-skipped path is byte-for-byte what it always was ----------
{
  const untouched = planSaleStockTransition(baseInput())
  for (const explicitFalse of [{ skipStock: false }, { skipStock: undefined }]) {
    assert.deepStrictEqual(
      planSaleStockTransition(baseInput(explicitFalse)),
      untouched,
      `passing ${JSON.stringify(explicitFalse)} must produce exactly the plan the flag-free call produces`,
    )
  }
  // The same equality across every non-skipping transition shape the route
  // can reach, so "unchanged" is not a claim about one happy path.
  const shapes = [
    ['completed', 'awaiting_payment'],
    ['completed', 'cancelled'],
    ['cancelled', 'completed'],
    ['awaiting_payment', 'awaiting_delivery'],
    ['awaiting_delivery', 'completed'],
  ]
  for (const [oldStatus, newStatus] of shapes) {
    const plain = planSaleStockTransition(baseInput({ oldStatus, newStatus }))
    const withFalse = planSaleStockTransition(baseInput({ oldStatus, newStatus, skipStock: false }))
    assert.deepStrictEqual(withFalse, plain, `${oldStatus} -> ${newStatus} must be unchanged when the flag is off`)
    const withSkip = planSaleStockTransition(baseInput({ oldStatus, newStatus, skipStock: true }))
    assert.deepStrictEqual(withSkip.statements, [], `${oldStatus} -> ${newStatus} must move nothing when the flag is on`)
    const expectedSkipped = plain.restoredUnits + plain.deductedUnits
    assert.strictEqual(withSkip.skippedUnits, expectedSkipped, `${oldStatus} -> ${newStatus} must report exactly the units it withheld`)
  }
  console.log(`PASS 3: the flag-off plan is identical to today's across ${shapes.length + 1} transition shapes`)
}

// ---- 5. the dangerous sequel: cancelling a sale completed WITHOUT stock ---
{
  // held(completed) says these 9 units are out with the sale. They are not:
  // the system never took them. Replaying the cancel the normal way would
  // add 9 units that do not exist.
  assert.strictEqual(heldQuantity('completed', 4, 0), 4, 'held() still believes a completed line holds its units')
  const naiveCancel = planSaleStockTransition(baseInput({ oldStatus: 'completed', newStatus: 'cancelled' }))
  assert.strictEqual(naiveCancel.restoredUnits, 9, 'a normal cancel WOULD add 9 units back -- units this sale never took')

  const sqlite = setup()
  const before = snapshot(sqlite)
  // Sticky: routes/sales.ts re-reads sales.stock_skipped and passes it again.
  const stickyCancel = planSaleStockTransition(baseInput({ oldStatus: 'completed', newStatus: 'cancelled', skipStock: true }))
  apply(sqlite, stickyCancel.statements)
  assert.strictEqual(snapshot(sqlite), before, 'cancelling a stock-skipped sale must invent no stock')
  assert.strictEqual(stickyCancel.restoredUnits, 0, 'nothing was restored')
  assert.strictEqual(stickyCancel.skippedUnits, 9, 'the 9 phantom units are reported as withheld, not moved')
  console.log('PASS 5: cancelling a stock-skipped sale invents nothing (the sticky flag is what stops it)')
}

// ---- 6. the route actually wires it, admin-gated ------------------------
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  const handler = src.slice(src.indexOf("app.patch('/:id/status'"), src.indexOf("app.patch('/:id/customer'"))
  assert.ok(handler.length > 0, 'PATCH /:id/status handler must be findable')

  // Server-side permission, on the EXISTING admin pattern, refusing loudly.
  assert.match(handler, /const skipStockRequested = body\.skip_stock === true/, 'the route reads the skip_stock flag off the body')
  assert.match(handler, /if \(skipStockRequested && !isAdminControlUser\(user\)\) \{[\s\S]*?403\)/, 'a non-admin sending skip_stock is REFUSED with 403, not silently obeyed')
  assert.match(src, /import \{[^}]*isAdminControlUser[^}]*\} from '\.\.\/lib\/permissions'/, 'the admin check is the existing isAdminControlUser, not a new role check')

  // Sticky, and threaded into BOTH stock paths (regular lines + damaged lots).
  assert.match(handler, /const saleAlreadyStockSkipped = Number\(sale\.stock_skipped \|\| 0\) === 1/, 'the route re-reads the persisted flag')
  assert.match(handler, /const skipStock = skipStockRequested \|\| saleAlreadyStockSkipped/, 'once skipped, always skipped')
  assert.match(handler, /skipStock,\s*\n\s*\}\)/, 'the flag is passed into planSaleStockTransition')
  assert.match(handler, /if \(skipStock\) \{\s*\n\s*skippedDamagedUnits \+= Math\.abs\(delta\)/, 'damaged-lot moves are skipped with the rest, not half-applied')

  // Recorded, on the sale AND in the audit trail.
  assert.match(handler, /updates\.push\(\s*\n?\s*'stock_skipped = 1'/, 'the sale is stamped stock_skipped = 1')
  assert.match(handler, /stock_skipped_at = datetime\('now'\)/, 'when it was skipped is recorded')
  assert.match(handler, /stock_skipped_by_name = @stock_skipped_by_name/, 'who skipped it is recorded')
  assert.match(handler, /stockSkipped: true/, 'the audit payload says stock was deliberately skipped')
  assert.match(handler, /stockSkippedUnits: totalSkippedUnits/, 'the audit payload records how many units were withheld')
  assert.match(handler, /stockSkipSource: skipStockRequested \? 'requested' : 'sale_already_stock_skipped'/, 'the audit payload distinguishes a fresh request from an inherited skip')
  console.log('PASS 6: route enforces admin server-side and records the skip on the sale + in the audit trail')
}

// ---- 7. migration 0109 provides the columns the route writes -------------
{
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0109_sales_stock_skipped.sql'), 'utf8')
  for (const column of ['stock_skipped', 'stock_skipped_at', 'stock_skipped_by_name']) {
    assert.ok(migration.includes(`ADD COLUMN ${column}`), `migration 0109 must add sales.${column}`)
  }
  assert.match(migration, /stock_skipped INTEGER NOT NULL DEFAULT 0/, 'existing rows must default to today\'s behaviour')
  // The migration has to actually run on a sales-shaped table.
  const sqlite = new Database(':memory:')
  sqlite.exec('CREATE TABLE sales (id INTEGER PRIMARY KEY, sale_status TEXT)')
  sqlite.exec(migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n'))
  sqlite.prepare("INSERT INTO sales (id, sale_status) VALUES (1, 'completed')").run()
  assert.strictEqual(sqlite.prepare('SELECT stock_skipped FROM sales WHERE id = 1').get().stock_skipped, 0, 'a fresh row is not stock-skipped')
  console.log('PASS 7: migration 0109 applies and defaults every existing sale to unchanged behaviour')
}

console.log('All sale status skip-stock tests passed')
