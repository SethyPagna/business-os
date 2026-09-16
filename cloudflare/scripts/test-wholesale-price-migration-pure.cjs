// Proves migration 0111 actually performs the VIP -> wholesale data move the
// shop owner ruled on (2026-09-04), against a REAL SQLite database with the
// REAL migration chain applied -- not by reading the SQL and believing it.
//
// The point of testing a data migration is that it runs exactly once against
// production and cannot be re-run to fix a mistake. The three things that
// would actually hurt if they were wrong:
//   1. the numbers must ARRIVE in wholesale_price_* (a move that silently
//      copied nothing would leave 9,552 products with no price tier at all);
//   2. the VIP columns must END UP ZERO (leaving them populated would mean
//      the app still has two rival prices, which is the ambiguity the ruling
//      settled);
//   3. the guard must hold: a row that somehow already carries a real
//      wholesale price must NOT be overwritten by the VIP one.
//
// Run (from cloudflare/): node scripts/test-wholesale-price-migration-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { DatabaseSync } = require('node:sqlite')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const TARGET = '0111_wholesale_price_is_the_vip_price.sql'

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  ✗ ${name}`)
    console.error(error)
  }
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
assert.ok(files.includes(TARGET), `${TARGET} must exist in migrations/`)

// Apply everything BEFORE 0111, so we can seed the pre-migration world.
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = OFF')
for (const file of files) {
  if (file >= TARGET) continue
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
}

// Seed the four cases that matter. Case D is the one production does not
// currently contain (0 rows carry both) but which the guard exists for.
db.exec(`
  INSERT INTO products (id, name, selling_price_usd, selling_price_khr,
                        special_price_usd, special_price_khr,
                        wholesale_price_usd, wholesale_price_khr) VALUES
    (1, 'A: a normal VIP row',        12, 49200,  8, 32800, 0, 0),
    (2, 'B: no tier at all',          12, 49200,  0,     0, 0, 0),
    (3, 'C: USD tier, blank KHR',     12, 49200,  7,     0, 0, 0),
    (4, 'D: already has wholesale',   12, 49200,  8, 32800, 5, 20500)
`)

const before = db.prepare('SELECT COUNT(*) AS n FROM products WHERE COALESCE(special_price_usd,0) <> 0').get()
assert.equal(before.n, 3, 'seed sanity: three rows should carry a VIP price before the migration')

// --- run the migration under test ----------------------------------------
db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, TARGET), 'utf8'))

const rows = db.prepare('SELECT id, special_price_usd, special_price_khr, wholesale_price_usd, wholesale_price_khr FROM products ORDER BY id').all()
const byId = new Map(rows.map((r) => [Number(r.id), r]))

console.log(`\n${TARGET}`)

check('the VIP numbers arrive in the wholesale columns', () => {
  assert.equal(byId.get(1).wholesale_price_usd, 8)
  assert.equal(byId.get(1).wholesale_price_khr, 32800)
})

check('a row with no tier price is left entirely alone', () => {
  assert.equal(byId.get(2).wholesale_price_usd, 0)
  assert.equal(byId.get(2).wholesale_price_khr, 0)
  assert.equal(byId.get(2).special_price_usd, 0)
})

check('a USD-only tier moves its USD side and leaves the blank KHR side blank', () => {
  // The two columns move independently, so a row priced only in dollars does
  // not acquire a bogus 0-riel "price" that some surface could render.
  assert.equal(byId.get(3).wholesale_price_usd, 7)
  assert.equal(byId.get(3).wholesale_price_khr, 0)
})

check('an existing REAL wholesale price is never overwritten by the VIP one', () => {
  // Production has 0 such rows today (surveyed), but the migration runs at
  // deploy time, not survey time -- the guard is what makes that survey
  // still true when it executes.
  assert.equal(byId.get(4).wholesale_price_usd, 5, 'the row kept its own wholesale price')
  assert.equal(byId.get(4).wholesale_price_khr, 20500)
})

check('the VIP columns are zero on every row afterwards', () => {
  for (const row of rows) {
    assert.equal(row.special_price_usd, 0, `product ${row.id} still carries a VIP USD price`)
    assert.equal(row.special_price_khr, 0, `product ${row.id} still carries a VIP KHR price`)
  }
})

check('the VIP columns still EXIST -- they are retired, not dropped', () => {
  // Deliberate: dropping a column rewrites a 166 MB production table, and a
  // stale PWA till tab still POSTing special_price_usd would hard-fail its
  // whole product save against a missing column. Kept, they absorb that
  // write as a harmless 0.
  const columns = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name)
  assert.ok(columns.includes('special_price_usd'), 'special_price_usd must be kept as inert ballast')
  assert.ok(columns.includes('special_price_khr'), 'special_price_khr must be kept as inert ballast')
})

check('re-running the migration is a no-op (safe if it is ever replayed)', () => {
  db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, TARGET), 'utf8'))
  const again = db.prepare('SELECT id, wholesale_price_usd, wholesale_price_khr FROM products ORDER BY id').all()
  assert.equal(Number(again[0].wholesale_price_usd), 8, 'a replay must not zero the moved prices')
  assert.equal(Number(again[3].wholesale_price_usd), 5)
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll 0111 wholesale migration checks passed')
