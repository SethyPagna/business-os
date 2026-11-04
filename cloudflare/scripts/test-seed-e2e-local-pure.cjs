// scripts/seed-e2e-local.cjs against a freshly migrated local database.
//
// WHY THIS EXISTS. The seed is the first step of the Playwright "system" tier (real Worker, real D1), and nothing in
// the release gate ever ran it, so it rotted silently: migrations 0242/0243/0258 made raw writes to products and
// branch_stock abort (product_has_stock, stock_transaction_required) and the seed failed at its products INSERT until
// someone happened to try the system tier on 3 Nov 2026. This runs the REAL apply-local-migrations.cjs and the REAL seed,
// the same two commands the e2e README gives, in a throw-away directory, so the next stock-schema migration that the
// seed does not understand turns this test red instead of the system tier.
//
// Local only, structurally: both scripts open one sqlite file under --persist-to; no wrangler, no network.
//
// Run: node scripts/test-seed-e2e-local-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-e2e-local-'))
const d1Dir = path.join(persist, 'v3', 'd1', 'miniflare-D1DatabaseObject')
fs.mkdirSync(d1Dir, { recursive: true })
const dbFile = path.join(d1Dir, 'seed-test.sqlite')
new Database(dbFile).close() // what `wrangler d1 execute --local` leaves behind: an empty file the scripts can find

function node(script) {
  return spawnSync(process.execPath, [path.join(__dirname, script), '--persist-to', persist], { encoding: 'utf8' })
}
function open() { return new Database(dbFile) }
function shopStock(db) {
  return db.prepare(`SELECT p.name, p.stock_quantity AS cache, s.quantity AS shop
    FROM products p JOIN branch_stock s ON s.product_id = p.id JOIN branches b ON b.id = s.branch_id AND b.name = 'shop'
    WHERE p.name LIKE 'E2E Product %' ORDER BY p.name`).all()
}
const permitRows = (db) => db.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key = 'stock_transaction_permit'").get().n

const SEEDED = [
  { name: 'E2E Product 001 Aurelia', cache: 40, shop: 40 },
  { name: 'E2E Product 002 Belle Roux', cache: 25, shop: 25 },
  { name: 'E2E Product 003 Cendre', cache: 60, shop: 60 },
]

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 6).join('\n  ')}`) }
}

try {
  const migrated = node('apply-local-migrations.cjs')
  assert.equal(migrated.status, 0, `migrations must apply: ${migrated.stderr || migrated.stdout}`)

  check('the migrated schema really refuses a bare stock write (so a green seed below is not vacuous)', () => {
    const db = open()
    try {
      assert.throws(() => db.prepare("INSERT INTO products (name, selling_price_usd, stock_quantity, is_active) VALUES ('bare write', 1, 1, 1)").run(),
        /stock_transaction_required/)
    } finally { db.close() }
  })

  check('the seed succeeds on a freshly migrated database and stocks the shop with the seeded quantities', () => {
    const seeded = node('seed-e2e-local.cjs')
    assert.equal(seeded.status, 0, `seed must exit 0 (it failed with stock_transaction_required before the permit): ${seeded.stderr}`)
    const db = open()
    try { assert.deepEqual(shopStock(db), SEEDED) } finally { db.close() }
  })

  check('the seed leaves no stock_transaction_permit behind, and a bare stock write is still refused afterwards', () => {
    const db = open()
    try {
      assert.equal(permitRows(db), 0)
      // An UPDATE of zero rows fires no trigger, so prove there are rows before reading a refusal into the result.
      assert.ok(db.prepare('SELECT COUNT(*) AS n FROM branch_stock').get().n > 0, 'the seed stocked nothing')
      assert.throws(() => db.prepare('UPDATE branch_stock SET quantity = quantity + 1').run(), /stock_transaction_required/)
    } finally { db.close() }
  })

  check('a second run succeeds (the README starts the Worker once and seeds again; a stocked product cannot be deleted)', () => {
    const again = node('seed-e2e-local.cjs')
    assert.equal(again.status, 0, `re-seed must exit 0 (it failed with product_has_stock when it deleted products): ${again.stderr}`)
    const db = open()
    try {
      assert.deepEqual(shopStock(db), SEEDED)
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products WHERE name LIKE 'E2E Product %'").get().n, 3, 'still exactly three products, not six')
    } finally { db.close() }
  })

  check('re-seeding restores the seeded stock and keeps the product ids after stock was sold', () => {
    const db = open()
    let before
    try {
      before = db.prepare("SELECT id, name FROM products WHERE name LIKE 'E2E Product %' ORDER BY name").all()
      // Sell down through the same permit the Worker opens, so the test does not weaken the guard it is checking.
      db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit', value FROM system_flags WHERE key = 'stock_schema_epoch'")
      db.exec("UPDATE branch_stock SET quantity = quantity - 3; UPDATE products SET stock_quantity = stock_quantity - 3")
      db.exec("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'")
      assert.notDeepEqual(shopStock(db), SEEDED, 'the control must have moved stock')
    } finally { db.close() }
    const reseeded = node('seed-e2e-local.cjs')
    assert.equal(reseeded.status, 0, reseeded.stderr)
    const after = open()
    try {
      assert.deepEqual(shopStock(after), SEEDED)
      assert.deepEqual(after.prepare("SELECT id, name FROM products WHERE name LIKE 'E2E Product %' ORDER BY name").all(), before,
        'an UPDATE keeps ids; earlier sale rows keep pointing at the same products')
      assert.equal(permitRows(after), 0)
    } finally { after.close() }
  })
} finally {
  fs.rmSync(persist, { recursive: true, force: true })
}

if (failed) { console.error(`${failed} check(s) failed`); process.exitCode = 1 } else console.log('seed-e2e-local pure checks passed')
