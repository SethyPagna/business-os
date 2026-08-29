// Real-SQLite test of migration 0081_reconcile_lot_ledger_multilot.sql.
//
// Why this exists. 0079 already reconciled branch_batch_stock to
// branch_stock, but only for products with exactly ONE active lot -- correct
// when it was written, inert once the Aug-28 stock-history import gave 6,007
// of 6,104 products several lots each. On production that left 10,415 units
// of real stock outside the lot ledger, and since the POS requires a lot with
// stock before it will add a batch-tracked product to a cart, 30 Shop
// products were unsellable while plainly showing stock.
//
// The migration is a data rewrite against a live database, so it is tested
// the way the rest of this suite tests migrations: the real chain applied to
// real SQLite (the same engine D1 runs), the world seeded as it stood BEFORE
// the migration, then the migration file itself executed -- not a paraphrase
// of it. Every case below is a shape actually measured on production.
//
// Run: node scripts/test-lot-ledger-reconcile-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATION = '0081_reconcile_lot_ledger_multilot.sql'
const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

function dbBefore(stopAt) {
  const sqlite = new Database(':memory:')
  for (const file of migrationFiles) {
    if (file === stopAt) break
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  return sqlite
}
function applyMigration(sqlite, file) {
  sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

function seed() {
  const sqlite = dbBefore(MIGRATION)
  sqlite.exec(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Warehouse', 1), (2, 'Shop', 1)`)
  const product = sqlite.prepare(`INSERT INTO products (id, name, is_active, stock_quantity) VALUES (?, ?, 1, ?)`)
  const opening = sqlite.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, notes, batch_number)
    VALUES (?, ?, ?, ?, '2026-08-27', 1, 'Received via product import', 1)`)
  const historical = sqlite.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, notes, batch_number)
    VALUES (?, ?, ?, ?, '2025-01-05', 1, 'Unified stock import job-1, row ' || ?, 2)`)
  const branchStock = sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)`)
  const lotStock = sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, ?, ?)`)

  // A: the Warehouse shape -- stock at a branch the opening lot never
  //    reached, with no lot row there at all. 1,225 rows / 10,298 units.
  product.run(1, 'Warehouse only', 10)
  opening.run(101, 1, '08272026', '08272026')
  lotStock.run(101, 2, 0)            // the opening lot lives at Shop, holding nothing
  branchStock.run(1, 1, 10)

  // B: the Shop shape -- historical lots parked at 0 by the migration pack's
  //    Step 4e, opening lot short of the branch total.
  product.run(2, 'Partly lotted', 10)
  opening.run(102, 2, '08272026', '08272026')
  historical.run(202, 2, '01052025', '01052025', 7)
  lotStock.run(102, 2, 3)
  lotStock.run(202, 2, 0)
  branchStock.run(2, 2, 10)

  // C: already correct -- must not be touched at all.
  product.run(3, 'Already correct', 5)
  opening.run(103, 3, '08272026', '08272026')
  historical.run(203, 3, '01052025', '01052025', 9)
  lotStock.run(103, 2, 2)
  lotStock.run(203, 2, 3)
  branchStock.run(3, 2, 5)

  // D: the reversed shape -- 8 pairs on production, every one of them lot
  //    stock standing against zero branch stock.
  product.run(4, 'Phantom lot stock', 0)
  opening.run(104, 4, '08272026', '08272026')
  historical.run(204, 4, '01052025', '01052025', 11)
  lotStock.run(104, 2, 0)
  lotStock.run(204, 2, 11)
  branchStock.run(4, 2, 0)

  // E: reversed but not to zero -- the other lots alone claim more than the
  //    branch holds, so the opening lot cannot simply take the difference.
  product.run(5, 'Over-lotted, some real stock', 5)
  opening.run(105, 5, '08272026', '08272026')
  historical.run(205, 5, '01052025', '01052025', 13)
  lotStock.run(105, 2, 1)
  lotStock.run(205, 2, 8)
  branchStock.run(5, 2, 5)
  return sqlite
}

const lotQty = (sqlite, batchId, branchId) => {
  const row = sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = ?').get(batchId, branchId)
  return row ? row.quantity : null
}
const ledgerTotals = (sqlite) => sqlite.prepare(`
  SELECT COALESCE((SELECT SUM(quantity) FROM branch_stock), 0) AS branch_total,
         COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
                   JOIN product_batches pb ON pb.id = bbs.batch_id AND pb.is_active = 1), 0) AS lot_total
`).get()

check('the ledger disagrees before the migration and agrees after it', () => {
  const sqlite = seed()
  const before = ledgerTotals(sqlite)
  assert.strictEqual(before.branch_total, 30, 'seeded branch stock')
  assert.strictEqual(before.lot_total, 28, 'seeded lot stock disagrees -- short in two places, over in two others')
  applyMigration(sqlite, MIGRATION)
  const after = ledgerTotals(sqlite)
  assert.strictEqual(after.branch_total, 30, 'branch_stock is authoritative and is never rewritten')
  assert.strictEqual(after.lot_total, 30, 'the lot ledger now sums to the same figure')
})

check('a branch the opening lot never reached gets its own lot row', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  assert.strictEqual(lotQty(sqlite, 101, 1), 10, 'the whole branch quantity lands on the opening lot')
  assert.strictEqual(lotQty(sqlite, 101, 2), 0, 'the branch it already had a row at is untouched')
})

check('a partly-lotted branch tops up only the opening lot; parked historical lots stay 0', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  // The 3 units already lotted here sit on the opening lot itself, so it
  // goes 3 -> 10 rather than being topped up to 7: 'others' is what the
  // product's OTHER lots hold, and the parked historical lot holds nothing.
  assert.strictEqual(lotQty(sqlite, 102, 2), 10, 'opening lot ends holding the whole branch quantity')
  assert.strictEqual(lotQty(sqlite, 202, 2), 0, 'the parked historical lot from Step 4e is not revived')
})

check('a pair that already agrees is left exactly as it was', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  assert.strictEqual(lotQty(sqlite, 103, 2), 2, 'opening lot untouched')
  assert.strictEqual(lotQty(sqlite, 203, 2), 3, 'historical lot untouched -- its attribution is real and kept')
})

check('lot stock standing against zero branch stock is cleared, not left to fail at sale time', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  assert.strictEqual(lotQty(sqlite, 204, 2), 0, 'the phantom units are gone')
  assert.strictEqual(lotQty(sqlite, 104, 2), 0, 'and the opening lot matches the branch: nothing')
})

check('when other lots alone exceed the branch, they are zeroed and the opening lot takes the real quantity', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  assert.strictEqual(lotQty(sqlite, 205, 2), 0, 'the over-claiming historical lot is zeroed')
  assert.strictEqual(lotQty(sqlite, 105, 2), 5, 'the opening lot carries the branch quantity')
})

check('running it twice changes nothing, and it leaves no helper table behind', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  const snapshot = sqlite.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id').all()
  applyMigration(sqlite, MIGRATION)
  const again = sqlite.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id').all()
  assert.deepStrictEqual(again, snapshot, 'idempotent -- a second run plans nothing')
  const leftovers = sqlite.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_lot_ledger_reconcile'`).get()
  assert.strictEqual(leftovers.n, 0, 'the helper table is dropped')
})

check('every quantity it writes satisfies the CHECK (quantity >= 0) the schema enforces', () => {
  const sqlite = seed()
  applyMigration(sqlite, MIGRATION)
  const negative = sqlite.prepare('SELECT COUNT(*) AS n FROM branch_batch_stock WHERE quantity < 0').get()
  assert.strictEqual(negative.n, 0, 'no negative lot quantity is ever written')
})

console.log(`\nAll ${passed} lot-ledger reconciliation checks passed.`)
