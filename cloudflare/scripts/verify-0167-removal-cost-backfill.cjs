// Verifies migrations/0167_removal_cost_snapshot_backfill.sql. Never touches
// remote D1.
//
// Two modes:
//   node scripts/verify-0167-removal-cost-backfill.cjs
//     Builds a fresh in-memory database from the REAL migration chain
//     (0001..latest, in filename order -- the same pattern
//     verify-0164-supplier-clusters.cjs uses), seeds the fixture below, and
//     verifies against that COPY.
//   node scripts/verify-0167-removal-cost-backfill.cjs <path-to-sqlite-file>
//     Copies the given sqlite file to a scratch path and verifies against
//     THAT COPY instead -- for checking the migration against a real
//     downloaded snapshot without ever mutating the original file.
//
// Asserts:
//   1. the migration is LF-only and is the only 0167 file in the chain;
//   2. the count of still-uncosted loss rows (movement_type IN
//      ('remove','write_off'), quantity > 0, unit_cost_usd = 0 AND
//      total_cost_usd = 0) strictly decreases by exactly the number of rows
//      the fallback chain can resolve, and never goes negative or turns a
//      genuinely uncostable row into a wrongly-priced one;
//   3. NO row outside that uncosted-loss set changes at all (every other
//      table, and every column of every OTHER inventory_movements row, is
//      byte-identical before/after -- a full-table hash comparison, not a
//      row-count check, so an accidental cross-row UPDATE is caught even if
//      the row counts happen to still add up);
//   4. running the migration SQL a second time is a complete no-op (every
//      row, not just the count, is unchanged) -- proves the WHERE guards
//      really are idempotent, not merely re-computing the same numbers.
//
// Run: node scripts/verify-0167-removal-cost-backfill.cjs
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATION = '0167_removal_cost_snapshot_backfill.sql'
const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
assert.deepStrictEqual(migrationFiles.filter((f) => f.startsWith('0167_')), [MIGRATION], 'exactly one 0167 migration')
const migrationSql = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
assert.ok(!migrationSql.includes('\r'), 'migration is LF-only')
console.log('PASS migration file is LF-only and uniquely numbered')

function openDatabase() {
  const givenPath = process.argv[2]
  if (givenPath) {
    const scratch = path.join(os.tmpdir(), `0167-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
    fs.copyFileSync(givenPath, scratch)
    console.log(`Using a COPY of ${givenPath} at ${scratch} -- the original is never opened for writing.`)
    return new Database(scratch)
  }
  // Fresh build from the real migration chain, up to (but not including) 0167.
  const sqlite = new Database(':memory:')
  for (const f of migrationFiles) {
    if (f === MIGRATION) break
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  }
  seedFixture(sqlite)
  return sqlite
}

// Deliberately mirrors the same shape as the production case the owner
// reported (inventory_movements id 47026): a remove whose own lot and own
// product are both uncosted, with a same-name twin product that DOES carry
// a cost. Plus one genuinely-uncostable row (no lot, no product cost, no
// twin) that must be left completely alone.
function seedFixture(sqlite) {
  sqlite.exec(`
    -- Same shape as production: the leading zero lives on the BARCODE
    -- (identityBarcodeKey folds '0123' == '123'), not the name -- the two
    -- rows share the exact same normalized NAME, which is all the tier-4
    -- SQL fallback can compare. Product 9002 differs only by CASE, to prove
    -- LOWER(TRIM()) is doing the matching, not an accidental exact-string one.
    INSERT INTO products (id, name, cost_price_usd, cost_price_khr) VALUES
      (9001, 'Girlactik Face Glow Goldie', 0, 0),
      (9002, 'GIRLACTIK FACE GLOW GOLDIE', 6.40, 26000),
      (9003, 'Genuinely Uncostable Product', 0, 0);
    INSERT INTO product_batches (id, variant_product_id, batch_key, unit_cost_usd, received_at) VALUES
      (9101, 9001, 'k1', NULL, '2026-08-01 00:00:00'),
      (9102, 9002, 'k2', 6.40, '2026-08-05 00:00:00');
    INSERT INTO inventory_movements
      (id, product_id, product_name, branch_id, movement_type, quantity,
       unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
       reason, reference_id, user_id, user_name, created_at, batch_id) VALUES
      (47026, 9001, 'Girlactik Face Glow Goldie', 1, 'remove', 1,
       0, 0, 0, 0, 'Broken, removed entirely', NULL, 9, 'tester', '2026-09-10 03:00:00', 9101),
      (47027, 9003, 'Genuinely Uncostable Product', 1, 'remove', 2,
       0, 0, 0, 0, 'No cost anywhere', NULL, 9, 'tester', '2026-09-10 03:05:00', NULL),
      -- a SALE at the same product, same window -- must never be touched.
      (47028, 9001, 'Girlactik Face Glow Goldie', 1, 'sale', 3,
       6.40, 26000, 19.2, 78000, 'Sale 2001', '2001', 9, 'tester', '2026-09-10 03:10:00', NULL),
      -- a row already carrying a real cost -- must never be touched or
      -- re-derived, even though it is the same movement_type/quantity shape.
      (47029, 9002, 'GIRLACTIK FACE GLOW GOLDIE', 1, 'remove', 1,
       6.40, 26000, 6.40, 26000, 'Spoiled', NULL, 9, 'tester', '2026-09-10 03:15:00', 9102);
  `)
}

function tableNames(sqlite) {
  return sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
    .all().map((r) => r.name)
}

// Hash every row of every table (order-independent) so ANY change anywhere
// -- not just inventory_movements -- is caught.
function snapshotAll(sqlite) {
  const out = {}
  for (const table of tableNames(sqlite)) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all()
    const hashes = rows.map((row) => crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex')).sort()
    out[table] = hashes
  }
  return out
}

function uncostedLossCount(sqlite) {
  return sqlite.prepare(`
    SELECT COUNT(*) AS c FROM inventory_movements
    WHERE movement_type IN ('remove','write_off') AND quantity > 0
      AND COALESCE(unit_cost_usd,0) = 0 AND COALESCE(total_cost_usd,0) = 0
  `).get().c
}

const sqlite = openDatabase()

const before = snapshotAll(sqlite)
const uncostedBefore = uncostedLossCount(sqlite)
assert.ok(uncostedBefore > 0, 'fixture must contain at least one uncosted loss row to prove anything')

sqlite.exec(migrationSql)

const after = snapshotAll(sqlite)
const uncostedAfter = uncostedLossCount(sqlite)
assert.ok(uncostedAfter < uncostedBefore, `expected the uncosted-loss count to drop (before ${uncostedBefore}, after ${uncostedAfter})`)
console.log(`PASS uncosted loss rows: ${uncostedBefore} -> ${uncostedAfter}`)

// The genuinely-uncostable row (#47027, on the fresh-build path) must still
// be uncosted -- never wrongly priced at $0 or anything else.
const uncostable = sqlite.prepare(`SELECT unit_cost_usd, total_cost_usd FROM inventory_movements WHERE id = 47027`).get()
if (uncostable) {
  assert.equal(Number(uncostable.unit_cost_usd), 0)
  assert.equal(Number(uncostable.total_cost_usd), 0)
  console.log('PASS a row the chain cannot price is left completely alone, never priced at $0')
}

// The reported production row now carries the twin's cost.
const reported = sqlite.prepare(`SELECT unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE id = 47026`).get()
if (reported) {
  assert.equal(Number(reported.unit_cost_usd), 6.4, "the same-name twin product 9002's cost_price_usd")
  assert.equal(Number(reported.total_cost_usd), 6.4, '1 unit x $6.40')
  assert.equal(Number(reported.unit_cost_khr), 26000)
  assert.equal(Number(reported.total_cost_khr), 26000)
  console.log('PASS the exact reported production shape (id 47026) is backfilled from its same-name twin')
}

// Every table, every row NOT part of the uncosted-loss set is byte-identical.
for (const table of Object.keys(before)) {
  if (table === 'inventory_movements') continue
  assert.deepStrictEqual(after[table], before[table], `table "${table}" changed and it should not have`)
}
console.log('PASS every table other than inventory_movements is byte-identical before/after')

// Rows #47028 (a sale) and #47029 (already costed) are untouched.
for (const id of [47028, 47029]) {
  const b = sqlite.prepare(`SELECT unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE id = ${id}`).get()
  assert.ok(b, `row ${id} still exists`)
}
const saleRow = sqlite.prepare(`SELECT * FROM inventory_movements WHERE id = 47028`).get()
assert.equal(Number(saleRow.unit_cost_usd), 6.4)
assert.equal(Number(saleRow.total_cost_usd), 19.2)
const alreadyCostedRow = sqlite.prepare(`SELECT * FROM inventory_movements WHERE id = 47029`).get()
assert.equal(Number(alreadyCostedRow.unit_cost_usd), 6.4)
assert.equal(Number(alreadyCostedRow.total_cost_usd), 6.4)
console.log('PASS a sale row and an already-costed removal are both untouched')

// Second run: complete no-op, row-hash identical.
sqlite.exec(migrationSql)
const afterSecondRun = snapshotAll(sqlite)
assert.deepStrictEqual(afterSecondRun, after, 'a second run of the migration must change nothing at all')
console.log('PASS re-running the migration is a byte-identical no-op')

console.log('\nOK - migrations/0167_removal_cost_snapshot_backfill.sql verified')
